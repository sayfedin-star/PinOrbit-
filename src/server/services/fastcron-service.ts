import { analyticsDb } from '../db/analytics';
import { getServerEnv } from '../db/clients';
import type {
  ScheduleSyncResponse,
  TriggerSyncResponse,
} from '../../lib/types';

export const FASTCRON_BASE = 'https://www.fastcron.com/api/v1';

const ALLOWED_WEBHOOK_HOSTS = [
  'hook.make.com',
  'hook.eu1.make.com',
  'hook.eu2.make.com',
  'hook.us1.make.com',
  'hook.us2.make.com',
  'hook.integromat.com',
];

export const SORT_MODES = [
  'IMPRESSION',
  'OUTBOUND_CLICK',
  'SAVE',
  'ENGAGEMENT',
  'PIN_CLICK',
];

export const fastcronService = {
  /**
   * Dispatches a request to FastCron API.
   * Strategy:
   * 1. Primary: POST JSON body.
   * 2. Fallback: On 404/405, fallback to GET query-string.
   * 3. Surface errors verbatim.
   */
  async fastcronCall(
    action: string,
    params: Record<string, any>,
    token: string
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    const url = `${FASTCRON_BASE}/${action}`;
    const payload = { token, ...params };

    try {
      let res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });

      if (res.status === 404 || res.status === 405) {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(payload)) {
          if (value !== undefined && value !== null) {
            searchParams.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
          }
        }
        res = await fetch(`${url}?${searchParams.toString()}`, {
          method: 'GET',
          signal: AbortSignal.timeout(8000),
        });
      }

      const data = await res.json().catch(() => ({}));

      if (
        data.status === 'OK' ||
        data.status === 'success' ||
        data.id ||
        data?.data?.id ||
        Array.isArray(data) ||
        Array.isArray(data?.data)
      ) {
        return { success: true, data };
      }

      const errorMsg =
        data.message ||
        data.error ||
        data.err_message ||
        (typeof data === 'string' && data.length > 0 ? data : `FastCron returned HTTP ${res.status}`);

      return { success: false, data, error: errorMsg };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'FastCron network request failed',
      };
    }
  },

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
  resolveFastCronToken(
    dbToken: string | null | undefined,
    runtimeEnv: Record<string, any>
  ): string | null {
    if (dbToken && dbToken.trim().length >= 16) {
      return dbToken.trim();
    }
    const env = getServerEnv(runtimeEnv);
    if (env.FASTCRON_API_TOKEN && env.FASTCRON_API_TOKEN.trim().length >= 16) {
      return env.FASTCRON_API_TOKEN.trim();
    }
    return null;
  },

  /**
   * Synchronizes schedule for a specific connection & channel with FastCron API.
   * Handles batch_add when both jobs are unconfigured, or add/edit accordingly.
   */
  async syncScheduleWithFastCron(
    workspaceId: string,
    connectionId: string,
    channel: 'analytics' | 'top_pins',
    runtimeEnv: Record<string, any>
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
    const token = this.resolveFastCronToken(settings?.fastcron_token, runtimeEnv);
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

    // Prepare FastCron job parameters
    const postData = JSON.stringify({
      job_type: 'daily_sync',
      channel: isAnalytics ? 'account_analytics' : 'top_pins',
      connection_id: connectionId,
    });

    const isEdit = Boolean(existingJobId);
    const bothMissing =
      !connection.analytics_fastcron_job_id && !connection.top_pins_fastcron_job_id;

    const jobParams: Record<string, any> = {
      name: `PinOrbit ${isAnalytics ? 'analytics' : 'top-pins'} — ${workspaceId.substring(0, 8)} — ${connection.display_name}`,
      expression: cronValidation.cron,
      timezone: settings?.timezone || 'UTC',
      url: webhookUrl!,
      http_method: 'POST',
      http_headers: 'Content-Type: application/json',
      post_data: postData,
      instances: 1,
      notify: true,
    };

    if (isEdit && existingJobId) {
      jobParams.id = existingJobId;
    }

    // Action routing
    let action = isEdit ? 'cron_edit' : 'cron_add';
    if (!isEdit && bothMissing && channel === 'analytics' && connection.top_pins_webhook_url) {
      // If both channels are being created together, batch_add is available
      action = 'cron_batch_add';
      const cronTopPins = this.parseTimeToCron(connection.top_pins_sync_time || '04:30');
      jobParams.jobs = [
        {
          name: `PinOrbit analytics — ${workspaceId.substring(0, 8)} — ${connection.display_name}`,
          expression: cronValidation.cron,
          timezone: settings?.timezone || 'UTC',
          url: webhookUrl!,
          http_method: 'POST',
          http_headers: 'Content-Type: application/json',
          post_data: JSON.stringify({ job_type: 'daily_sync', channel: 'account_analytics', connection_id: connectionId }),
          instances: 1,
          notify: true,
        },
        {
          name: `PinOrbit top-pins — ${workspaceId.substring(0, 8)} — ${connection.display_name}`,
          expression: cronTopPins.cron || '30 4 * * *',
          timezone: settings?.timezone || 'UTC',
          url: connection.top_pins_webhook_url,
          http_method: 'POST',
          http_headers: 'Content-Type: application/json',
          post_data: JSON.stringify({ job_type: 'daily_sync', channel: 'top_pins', connection_id: connectionId }),
          instances: 1,
          notify: true,
        },
      ];
    }

    const callResult = await this.fastcronCall(action, jobParams, token);

    if (callResult.success) {
      const returnedId =
        callResult.data?.id ||
        callResult.data?.data?.id ||
        (Array.isArray(callResult.data?.ids) ? callResult.data.ids[0] : null) ||
        existingJobId;

      const jobId = returnedId ? parseInt(String(returnedId), 10) : existingJobId;

      const updates: any = {};
      if (isAnalytics) {
        if (jobId) updates.analytics_fastcron_job_id = jobId;
        updates.analytics_schedule_status = 'synced';
        updates.analytics_cron_expression = cronValidation.cron;
      } else {
        if (jobId) updates.top_pins_fastcron_job_id = jobId;
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
        error: callResult.error || 'FastCron API returned an error.',
      };
    }
  },

  /**
   * Disables a FastCron job via cron_disable (safe soft-delete / pause).
   */
  async disableFastCronJob(
    workspaceId: string,
    jobId: number | null | undefined,
    runtimeEnv: Record<string, any>
  ): Promise<boolean> {
    if (!jobId) return true;
    const settings = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);
    const token = this.resolveFastCronToken(settings?.fastcron_token, runtimeEnv);
    if (!token) return false;

    const res = await this.fastcronCall('cron_disable', { id: jobId }, token);
    return res.success;
  },

  /**
   * Enables a FastCron job via cron_enable (re-enable connection).
   */
  async enableFastCronJob(
    workspaceId: string,
    jobId: number | null | undefined,
    runtimeEnv: Record<string, any>
  ): Promise<boolean> {
    if (!jobId) return true;
    const settings = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);
    const token = this.resolveFastCronToken(settings?.fastcron_token, runtimeEnv);
    if (!token) return false;

    const res = await this.fastcronCall('cron_enable', { id: jobId }, token);
    return res.success;
  },

  /**
   * Deletes a FastCron job via cron_delete API (reserved for stale 404 cleanup).
   */
  async deleteFastCronJob(
    workspaceId: string,
    jobId: number | null | undefined,
    runtimeEnv: Record<string, any>
  ): Promise<boolean> {
    if (!jobId) return true;
    const settings = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);
    const token = this.resolveFastCronToken(settings?.fastcron_token, runtimeEnv);
    if (!token) return false;

    const res = await this.fastcronCall('cron_delete', { id: jobId }, token);
    return res.success;
  },

  /**
   * Dispatches manual sync via cron_run (with legacy direct POST fallback) or test ping.
   */
  async triggerManualSync(
    workspaceId: string,
    connectionId: string,
    channel: 'analytics' | 'top_pins',
    mode: 'ping' | 'sync',
    runtimeEnv: Record<string, any>
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

    const jobId = isAnalytics
      ? connection.analytics_fastcron_job_id
      : connection.top_pins_fastcron_job_id;

    const settings = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);
    const token = this.resolveFastCronToken(settings?.fastcron_token, runtimeEnv);

    // If Job ID and Token exist -> Dispatches cron_run
    if (jobId && token) {
      const payload = JSON.stringify({
        job_type: 'manual_sync',
        channel: isAnalytics ? 'account_analytics' : 'top_pins',
        connection_id: connectionId,
        start_date: startDate,
        end_date: endDate,
        ...(channel === 'top_pins' && { sort_modes: SORT_MODES }),
      });

      const cronRunRes = await this.fastcronCall(
        'cron_run',
        { id: jobId, payload },
        token
      );

      if (cronRunRes.success) {
        return {
          success: true,
          connection_id: connectionId,
          channel,
          mode: 'sync',
          startDate,
          endDate,
          message: `Successfully triggered manual sync via FastCron cron_run for ${channel}.`,
        };
      } else {
        return {
          success: false,
          connection_id: connectionId,
          channel,
          mode: 'sync',
          startDate,
          endDate,
          error: cronRunRes.error || 'FastCron cron_run execution failed.',
        };
      }
    }

    // Legacy Fallback: Direct POST to channel webhook
    const directPayload = isAnalytics
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
          sort_modes: SORT_MODES,
          job_type: 'manual_sync',
          channel: 'top_pins',
        };

    try {
      const res = await fetch(webhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(directPayload),
        signal: AbortSignal.timeout(8000),
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

  /**
   * Fetches FastCron execution history logs for observability.
   */
  async getCronLogs(
    workspaceId: string,
    jobId: number | null | undefined,
    runtimeEnv: Record<string, any>
  ): Promise<{ success: boolean; logs?: any[]; error?: string }> {
    if (!jobId) {
      return { success: false, error: 'job_not_configured' };
    }

    const settings = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);
    const token = this.resolveFastCronToken(settings?.fastcron_token, runtimeEnv);
    if (!token) {
      return { success: false, error: 'FastCron API token not configured.' };
    }

    const res = await this.fastcronCall('cron_logs', { id: jobId }, token);
    if (!res.success) {
      return { success: false, error: res.error || 'Failed to fetch FastCron logs.' };
    }

    const logs =
      res.data?.logs ||
      res.data?.data?.logs ||
      res.data?.data ||
      (Array.isArray(res.data) ? res.data : []);

    return { success: true, logs: Array.isArray(logs) ? logs : [] };
  },
};
