import { analyticsDb } from '../db/analytics';
import { dbClients } from '../db/clients';
import type {
  ScheduleSyncResponse,
  TriggerSyncResponse,
} from '../../lib/types';

const ALLOWED_WEBHOOK_HOSTS = [
  'hook.make.com',
  'hook.eu1.make.com',
  'hook.eu2.make.com',
  'hook.us1.make.com',
  'hook.us2.make.com',
  'hook.integromat.com',
];

export const fastcronService = {
  /**
   * Validates webhook URL format and domain allowlist.
   */
  validateWebhookUrl(urlStr?: string | null): { valid: boolean; error?: string } {
    if (!urlStr || typeof urlStr !== 'string') {
      return { valid: false, error: 'Webhook URL is required.' };
    }

    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== 'https:') {
        return { valid: false, error: 'Webhook URL must use secure HTTPS protocol.' };
      }

      const host = parsed.hostname.toLowerCase();
      const isAllowed =
        ALLOWED_WEBHOOK_HOSTS.some((allowed) => host === allowed || host.endsWith('.' + allowed)) ||
        host.endsWith('.make.com') ||
        host.endsWith('.integromat.com');

      if (!isAllowed) {
        return {
          valid: false,
          error: `Webhook host "${host}" is not allowed. Must be a verified Make.com or Integromat domain.`,
        };
      }

      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid Webhook URL format.' };
    }
  },

  /**
   * Converts HH:MM (24-hour) format to standard cron expression: M H * * *
   */
  parseTimeToCron(timeStr?: string | null): { valid: boolean; cron?: string; error?: string } {
    if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr.trim())) {
      return { valid: false, error: 'Time must be in HH:MM (24-hour) format (e.g. 04:00).' };
    }

    const [hStr, mStr] = timeStr.trim().split(':');
    const hour = parseInt(hStr, 10);
    const minute = parseInt(mStr, 10);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return { valid: false, error: 'Hour must be between 0-23 and minute between 0-59.' };
    }

    return {
      valid: true,
      cron: `${minute} ${hour} * * *`,
    };
  },

  /**
   * Resolves the active FastCron token (Workspace DB token → env FASTCRON_API_TOKEN → null).
   */
  resolveFastCronToken(dbToken?: string | null): string | null {
    if (dbToken && dbToken.trim().length >= 16) {
      return dbToken.trim();
    }
    const env = dbClients.getConfig();
    if (env.FASTCRON_API_TOKEN && env.FASTCRON_API_TOKEN.trim().length >= 16) {
      return env.FASTCRON_API_TOKEN.trim();
    }
    return null;
  },

  /**
   * Synchronizes schedule for a specific connection & channel with FastCron API.
   */
  async syncScheduleWithFastCron(
    workspaceId: string,
    connectionId: string,
    channel: 'analytics' | 'top_pins'
  ): Promise<ScheduleSyncResponse> {
    const connection = await analyticsDb.getWorkspaceConnection(workspaceId, connectionId);
    if (!connection) {
      return {
        success: false,
        connection_id: connectionId,
        channel,
        schedule_status: 'error',
        error: 'Pinterest connection not found in this workspace.',
      };
    }

    const settings = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);
    const isAnalytics = channel === 'analytics';
    const webhookUrl = isAnalytics
      ? connection.analytics_webhook_url
      : connection.top_pins_webhook_url;
    const syncTime = isAnalytics ? connection.analytics_sync_time : connection.top_pins_sync_time;
    const existingJobId = isAnalytics
      ? connection.analytics_fastcron_job_id
      : connection.top_pins_fastcron_job_id;

    // Validate Webhook URL
    const urlValidation = this.validateWebhookUrl(webhookUrl);
    if (!urlValidation.valid) {
      const statusField = isAnalytics ? 'analytics_schedule_status' : 'top_pins_schedule_status';
      await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
        [statusField]: 'error',
      });
      return {
        success: false,
        connection_id: connectionId,
        channel,
        schedule_status: 'error',
        error: urlValidation.error || 'Invalid webhook URL for this channel.',
      };
    }

    // Validate Cron
    const cronValidation = this.parseTimeToCron(syncTime);
    if (!cronValidation.valid || !cronValidation.cron) {
      const statusField = isAnalytics ? 'analytics_schedule_status' : 'top_pins_schedule_status';
      await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
        [statusField]: 'error',
      });
      return {
        success: false,
        connection_id: connectionId,
        channel,
        schedule_status: 'error',
        error: cronValidation.error || 'Invalid sync time format.',
      };
    }

    // Resolve Token
    const token = this.resolveFastCronToken(settings?.fastcron_token);
    if (!token) {
      const statusField = isAnalytics ? 'analytics_schedule_status' : 'top_pins_schedule_status';
      await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
        [statusField]: 'error',
      });
      return {
        success: false,
        connection_id: connectionId,
        channel,
        schedule_status: 'error',
        error: 'FastCron API token not configured. Please provide a valid token in settings.',
      };
    }

    // Prepare FastCron payload
    const postData = JSON.stringify({
      job_type: 'daily_sync',
      channel: isAnalytics ? 'account_analytics' : 'top_pins',
      connection_id: connectionId,
    });

    const isEdit = Boolean(existingJobId);
    const endpoint = isEdit
      ? 'https://api.fastcron.com/v1/cron_edit'
      : 'https://api.fastcron.com/v1/cron_add';

    const params = new URLSearchParams();
    params.append('token', token);
    if (isEdit && existingJobId) {
      params.append('id', String(existingJobId));
    }
    params.append(
      'name',
      `PinOrbit ${isAnalytics ? 'analytics' : 'top-pins'} — ${workspaceId.substring(0, 8)} — ${connection.display_name}`
    );
    params.append('expression', cronValidation.cron);
    params.append('timezone', settings?.timezone || 'UTC');
    params.append('url', webhookUrl!);
    params.append('http_method', 'POST');
    params.append('http_headers', 'Content-Type: application/json');
    params.append('post_data', postData);

    try {
      const res = await fetch(`${endpoint}?${params.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(8000),
      });

      const data = await res.json().catch(() => ({}));

      if (data.status === 'OK' || data.status === 'success' || data.id || data?.data?.id) {
        const jobId = parseInt(String(data.id || data?.data?.id || existingJobId), 10);
        const updates: any = {};
        if (isAnalytics) {
          updates.analytics_fastcron_job_id = jobId;
          updates.analytics_schedule_status = 'synced';
          updates.analytics_cron_expression = cronValidation.cron;
        } else {
          updates.top_pins_fastcron_job_id = jobId;
          updates.top_pins_schedule_status = 'synced';
          updates.top_pins_cron_expression = cronValidation.cron;
        }

        await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, updates);

        return {
          success: true,
          connection_id: connectionId,
          channel,
          schedule_status: 'synced',
          fastcron_job_id: jobId,
          message: `FastCron schedule successfully ${isEdit ? 'updated' : 'created'} for ${channel}.`,
        };
      } else {
        const errorMsg = data.message || data.error || 'FastCron API returned an error.';
        const updates: any = {};
        if (isAnalytics) {
          updates.analytics_schedule_status = 'error';
        } else {
          updates.top_pins_schedule_status = 'error';
        }
        await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, updates);

        return {
          success: false,
          connection_id: connectionId,
          channel,
          schedule_status: 'error',
          error: errorMsg,
        };
      }
    } catch (err: any) {
      const updates: any = {};
      if (isAnalytics) {
        updates.analytics_schedule_status = 'error';
      } else {
        updates.top_pins_schedule_status = 'error';
      }
      await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, updates);

      return {
        success: false,
        connection_id: connectionId,
        channel,
        schedule_status: 'error',
        error: `Failed to contact FastCron API: ${err.message}`,
      };
    }
  },

  /**
   * Deletes a FastCron job via cron_delete API (best effort).
   */
  async deleteFastCronJob(
    workspaceId: string,
    jobId?: number | null
  ): Promise<boolean> {
    if (!jobId) return true;
    const settings = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);
    const token = this.resolveFastCronToken(settings?.fastcron_token);
    if (!token) return false;

    try {
      const res = await fetch(
        `https://api.fastcron.com/v1/cron_delete?token=${encodeURIComponent(token)}&id=${jobId}`,
        { method: 'GET', signal: AbortSignal.timeout(6000) }
      );
      return res.ok;
    } catch (e) {
      console.warn('[FastCron] Failed to delete cron job id:', jobId, e);
      return false;
    }
  },

  /**
   * Dispatches manual sync or test ping to a connection's Make.com webhook.
   */
  async triggerManualSync(
    workspaceId: string,
    connectionId: string,
    channel: 'analytics' | 'top_pins',
    mode: 'ping' | 'sync' = 'sync'
  ): Promise<TriggerSyncResponse> {
    const connection = await analyticsDb.getWorkspaceConnection(workspaceId, connectionId);
    if (!connection) {
      return {
        success: false,
        connection_id: connectionId,
        channel,
        mode,
        error: 'Connection not found in this workspace.',
      };
    }

    const isAnalytics = channel === 'analytics';
    const webhookUrl = isAnalytics
      ? connection.analytics_webhook_url
      : connection.top_pins_webhook_url;

    const urlValidation = this.validateWebhookUrl(webhookUrl);
    if (!urlValidation.valid) {
      return {
        success: false,
        connection_id: connectionId,
        channel,
        mode,
        error: urlValidation.error || 'Webhook URL not configured or invalid.',
      };
    }

    // If Test Ping mode
    if (mode === 'ping') {
      try {
        const res = await fetch(webhookUrl!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_type: 'ping',
            channel: isAnalytics ? 'account_analytics' : 'top_pins',
            connection_id: connectionId,
          }),
          signal: AbortSignal.timeout(8000),
        });

        return {
          success: res.ok,
          connection_id: connectionId,
          channel,
          mode: 'ping',
          webhookResponseStatus: res.status,
          message: res.ok ? 'Ping successful.' : `Webhook returned HTTP ${res.status}`,
        };
      } catch (err: any) {
        return {
          success: false,
          connection_id: connectionId,
          channel,
          mode: 'ping',
          error: `Ping failed: ${err.message}`,
        };
      }
    }

    // Concrete 7-day rolling window for manual sync
    const now = new Date();
    const endDateObj = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // yesterday
    const startDateObj = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const startDate = startDateObj.toISOString().split('T')[0];
    const endDate = endDateObj.toISOString().split('T')[0];

    const payload = isAnalytics
      ? {
          connection_id: connectionId,
          start_date: startDate,
          end_date: endDate,
          job_type: 'manual_sync',
          channel: 'account_analytics',
        }
      : {
          connection_id: connectionId,
          start_date: startDate,
          end_date: endDate,
          sort_modes: ['IMPRESSION', 'OUTBOUND_CLICK', 'SAVE', 'ENGAGEMENT', 'PIN_CLICK'],
          job_type: 'manual_sync',
          channel: 'top_pins',
        };

    try {
      const res = await fetch(webhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });

      // Record manual session in Project 1 operational log
      await analyticsDb.recordOperationalImportSession(workspaceId, {
        account_id: connectionId,
        source_type: isAnalytics ? 'manual_analytics' : 'manual_top_pins',
        source_label: 'manual_sync',
        total_rows: 0,
        valid_rows: 0,
        invalid_rows: 0,
        imported_rows: 0,
        status: 'pending',
      });

      return {
        success: res.ok,
        connection_id: connectionId,
        channel,
        mode: 'sync',
        startDate,
        endDate,
        webhookResponseStatus: res.status,
        message: res.ok
          ? `Successfully triggered ${channel} sync on Make.com proxy.`
          : `Make.com webhook returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        success: false,
        connection_id: connectionId,
        channel,
        mode: 'sync',
        startDate,
        endDate,
        error: `Webhook dispatch failed: ${err.message}`,
      };
    }
  },
};
