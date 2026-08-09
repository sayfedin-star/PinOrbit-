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

    // R6.1 Reconcile Algorithm Step 1 & 2: Check storedId with cron_get
    let storedId = isAnalytics ? connection.analytics_fastcron_job_id : connection.top_pins_fastcron_job_id;
    let verifiedJobId: number | null = null;

    if (storedId) {
      const getRes = await this.fastcronCall('cron_get', { id: storedId }, token);
      if (getRes.success && (getRes.data?.id || getRes.data?.data?.id || getRes.data?.status === 'OK' || getRes.data?.status === 'success')) {
        const rawId = getRes.data?.id ?? getRes.data?.data?.id ?? storedId;
        const parsedStoredId = rawId != null && !isNaN(Number(rawId)) ? Number(rawId) : storedId;
        verifiedJobId = parsedStoredId;
      } else {
        console.warn(`[FastCron] Stored job ${storedId} for ${channel} not found in FastCron (404/deleted). Treating as missing.`);
        storedId = null;
      }
    }

    // Prepare FastCron job parameters with per-pipeline offsets (V20.1)
    const startOffset = isAnalytics
      ? (connection.analytics_start_offset_days ?? 7)
      : (connection.top_pins_start_offset_days ?? 7);
    const endOffset = isAnalytics
      ? (connection.analytics_end_offset_days ?? 1)
      : (connection.top_pins_end_offset_days ?? 2);

    const postData = isAnalytics
      ? JSON.stringify({
          job_type: 'daily_sync',
          channel: 'account_analytics',
          connection_id: connectionId,
          analytics_start_offset_days: startOffset,
          analytics_end_offset_days: endOffset,
        })
      : JSON.stringify({
          job_type: 'daily_sync',
          channel: 'top_pins',
          connection_id: connectionId,
          top_pins_start_offset_days: startOffset,
          top_pins_end_offset_days: endOffset,
          num_of_pins: connection.top_pins_num_of_pins || 50,
          sort_modes: connection.top_pins_sort_modes || SORT_MODES,
        });

    const jobName = `PinOrbit ${isAnalytics ? 'analytics' : 'top-pins'} — ${workspaceId.substring(0, 8)} — ${connection.display_name}`;

    const jobParams: Record<string, any> = {
      name: jobName,
      expression: cronValidation.cron,
      timezone: settings?.timezone || 'UTC',
      url: webhookUrl!,
      httpMethod: 'POST',
      http_method: 'POST',
      httpHeaders: 'Content-Type: application/json',
      http_headers: 'Content-Type: application/json',
      postData: postData,
      post_data: postData,
      instances: connection.fastcron_instances !== undefined ? connection.fastcron_instances : 1,
      notify: connection.fastcron_notify !== undefined ? connection.fastcron_notify : true,
      timeout: connection.fastcron_timeout || 30,
    };

    if (verifiedJobId) {
      // Step 2 Found: Execute cron_edit
      jobParams.id = verifiedJobId;
      const editResult = await this.fastcronCall('cron_edit', jobParams, token);
      if (!editResult.success) {
        const statusField = isAnalytics ? 'analytics_schedule_status' : 'top_pins_schedule_status';
        await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
          [statusField]: 'error',
        });
        return {
          success: false,
          connection_id: connectionId,
          channel,
          schedule_status: 'error',
          error: editResult.error || 'Failed to update FastCron schedule.',
        };
      }

      // Persist verified id and status (single UPDATE per channel)
      await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
        [isAnalytics ? 'analytics_fastcron_job_id' : 'top_pins_fastcron_job_id']: verifiedJobId,
        [isAnalytics ? 'analytics_schedule_status' : 'top_pins_schedule_status']: 'synced',
        [isAnalytics ? 'analytics_cron_expression' : 'top_pins_cron_expression']: cronValidation.cron,
      });
    } else {
      // Step 3 Missing: Create job (cron_batch_add ONLY when BOTH channels missing and both URLs configured)
      const otherChannelStoredId = isAnalytics ? connection.top_pins_fastcron_job_id : connection.analytics_fastcron_job_id;
      const bothMissing = !storedId && !otherChannelStoredId;

      if (bothMissing && channel === 'analytics' && connection.top_pins_webhook_url) {
        const cronTopPins = this.parseTimeToCron(connection.top_pins_sync_time || '04:30');
        const batchItems = [
          {
            name: `PinOrbit analytics — ${workspaceId.substring(0, 8)} — ${connection.display_name}`,
            expression: cronValidation.cron,
            timezone: settings?.timezone || 'UTC',
            url: webhookUrl!,
            httpMethod: 'POST',
            http_method: 'POST',
            httpHeaders: 'Content-Type: application/json',
            http_headers: 'Content-Type: application/json',
            postData: JSON.stringify({
              job_type: 'daily_sync',
              channel: 'account_analytics',
              connection_id: connectionId,
              analytics_start_offset_days: connection.analytics_start_offset_days ?? 7,
              analytics_end_offset_days: connection.analytics_end_offset_days ?? 1,
            }),
            post_data: JSON.stringify({
              job_type: 'daily_sync',
              channel: 'account_analytics',
              connection_id: connectionId,
              analytics_start_offset_days: connection.analytics_start_offset_days ?? 7,
              analytics_end_offset_days: connection.analytics_end_offset_days ?? 1,
            }),
            instances: connection.fastcron_instances !== undefined ? connection.fastcron_instances : 1,
            notify: connection.fastcron_notify !== undefined ? connection.fastcron_notify : true,
            timeout: connection.fastcron_timeout || 30,
          },
          {
            name: `PinOrbit top-pins — ${workspaceId.substring(0, 8)} — ${connection.display_name}`,
            expression: cronTopPins.cron || '30 4 * * *',
            timezone: settings?.timezone || 'UTC',
            url: connection.top_pins_webhook_url,
            httpMethod: 'POST',
            http_method: 'POST',
            httpHeaders: 'Content-Type: application/json',
            http_headers: 'Content-Type: application/json',
            postData: JSON.stringify({
              job_type: 'daily_sync',
              channel: 'top_pins',
              connection_id: connectionId,
              top_pins_start_offset_days: connection.top_pins_start_offset_days ?? 7,
              top_pins_end_offset_days: connection.top_pins_end_offset_days ?? 2,
              num_of_pins: connection.top_pins_num_of_pins || 50,
              sort_modes: connection.top_pins_sort_modes || SORT_MODES,
            }),
            post_data: JSON.stringify({
              job_type: 'daily_sync',
              channel: 'top_pins',
              connection_id: connectionId,
              top_pins_start_offset_days: connection.top_pins_start_offset_days ?? 7,
              top_pins_end_offset_days: connection.top_pins_end_offset_days ?? 2,
              num_of_pins: connection.top_pins_num_of_pins || 50,
              sort_modes: connection.top_pins_sort_modes || SORT_MODES,
            }),
            instances: connection.fastcron_instances !== undefined ? connection.fastcron_instances : 1,
            notify: connection.fastcron_notify !== undefined ? connection.fastcron_notify : true,
            timeout: connection.fastcron_timeout || 30,
          },
        ];

        const batchRes = await this.fastcronCall(
          'cron_batch_add',
          { data: batchItems, jobs: batchItems, timezone: settings?.timezone || 'UTC' },
          token
        );

        if (!batchRes.success) {
          await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
            analytics_schedule_status: 'error',
          });
          return {
            success: false,
            connection_id: connectionId,
            channel,
            schedule_status: 'error',
            error: batchRes.error || 'FastCron batch creation failed.',
          };
        }

        const batchList = Array.isArray(batchRes.data?.data)
          ? batchRes.data.data
          : Array.isArray(batchRes.data)
          ? batchRes.data
          : [];
        const rawId0 = batchList[0]?.id ?? (Array.isArray(batchRes.data?.ids) ? batchRes.data.ids[0] : batchRes.data?.id);
        const rawId1 = batchList[1]?.id ?? (Array.isArray(batchRes.data?.ids) ? batchRes.data.ids[1] : null);

        const idA = rawId0 != null && !isNaN(Number(rawId0)) ? Number(rawId0) : null;
        const idB = rawId1 != null && !isNaN(Number(rawId1)) ? Number(rawId1) : null;

        // R8.2 / R9.2: Check numeric extraction for current channel
        if (!idA) {
          if (idB) {
            await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
              top_pins_fastcron_job_id: idB,
              top_pins_schedule_status: 'synced',
              top_pins_cron_expression: cronTopPins.cron || '30 4 * * *',
              analytics_schedule_status: 'error',
            });
          } else {
            await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
              analytics_schedule_status: 'error',
            });
          }
          return {
            success: false,
            connection_id: connectionId,
            channel,
            schedule_status: 'error',
            error: 'FastCron batch creation failed to return a valid numeric job id for analytics.',
          };
        }

        verifiedJobId = idA;

        // R8.3: Persist channel job id IMMEDIATELY after extraction
        await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
          analytics_fastcron_job_id: idA,
          analytics_schedule_status: 'synced',
          analytics_cron_expression: cronValidation.cron,
          ...(idB
            ? {
                top_pins_fastcron_job_id: idB,
                top_pins_schedule_status: 'synced',
                top_pins_cron_expression: cronTopPins.cron || '30 4 * * *',
              }
            : {}),
        });
      } else {
        // Single cron_add
        const addRes = await this.fastcronCall('cron_add', jobParams, token);
        if (!addRes.success) {
          const statusField = isAnalytics ? 'analytics_schedule_status' : 'top_pins_schedule_status';
          await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
            [statusField]: 'error',
          });
          return {
            success: false,
            connection_id: connectionId,
            channel,
            schedule_status: 'error',
            error: addRes.error || 'FastCron creation failed.',
          };
        }

        // R8.2: extract id as (data.id ?? data.data.id). If extraction fails -> schedule_status 'error', return success:false. NEVER report 'synced' without a numeric id.
        const returnedId =
          addRes.data?.id ??
          addRes.data?.data?.id ??
          (Array.isArray(addRes.data?.ids) ? addRes.data.ids[0] : null);
        const parsedId = returnedId != null && !isNaN(Number(returnedId)) ? Number(returnedId) : null;

        if (!parsedId) {
          const statusField = isAnalytics ? 'analytics_schedule_status' : 'top_pins_schedule_status';
          await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
            [statusField]: 'error',
          });
          return {
            success: false,
            connection_id: connectionId,
            channel,
            schedule_status: 'error',
            error: 'FastCron creation failed to return a valid numeric job id.',
          };
        }

        verifiedJobId = parsedId;

        // R8.3: Persist the channel job id to analytics_connections IMMEDIATELY after extraction (single UPDATE per channel)
        await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
          [isAnalytics ? 'analytics_fastcron_job_id' : 'top_pins_fastcron_job_id']: verifiedJobId,
          [isAnalytics ? 'analytics_schedule_status' : 'top_pins_schedule_status']: 'synced',
          [isAnalytics ? 'analytics_cron_expression' : 'top_pins_cron_expression']: cronValidation.cron,
        });
      }
    }

    // R8.4 Orphan Cleanup guards (all mandatory):
    // - Run ONLY when verifiedJobId != null
    // - Delete ONLY jobs where job.url === CURRENT channel webhook URL AND jId !== verifiedJobId
    // - NEVER delete jobs whose url equals the OTHER channel's webhook URL
    if (verifiedJobId != null) {
      try {
        const listRes = await this.fastcronCall('cron_list', { keyword: 'PinOrbit' }, token);
        const jobsList =
          listRes.data?.data ||
          listRes.data?.jobs ||
          (Array.isArray(listRes.data) ? listRes.data : []);
        if (Array.isArray(jobsList)) {
          const currentWebhookUrl = webhookUrl?.trim();
          const otherWebhookUrl = (
            isAnalytics ? connection.top_pins_webhook_url : connection.analytics_webhook_url
          )?.trim();

          for (const job of jobsList) {
            const jobUrl = job.url?.trim();
            const jId = job.id != null ? parseInt(String(job.id), 10) : null;
            if (!jId) continue;

            // Guard 1: NEVER delete jobs whose url equals the OTHER channel's webhook URL
            if (otherWebhookUrl && jobUrl === otherWebhookUrl) {
              continue;
            }

            // Guard 2: Delete ONLY jobs where job.url === CURRENT channel webhook URL AND jId !== verifiedJobId
            if (currentWebhookUrl && jobUrl === currentWebhookUrl && jId !== verifiedJobId) {
              console.log(
                `[FastCron] Removing orphan duplicate job ${jId} for current channel URL ${currentWebhookUrl}`
              );
              await this.fastcronCall('cron_delete', { id: jId }, token);
            }
          }
        }
      } catch (cleanErr) {
        console.warn('[FastCron] Orphan cleanup non-fatal warning:', cleanErr);
      }
    }

    // Final DB update ensuring current channel status is synced
    await analyticsDb.updateWorkspaceConnection(workspaceId, connectionId, {
      [isAnalytics ? 'analytics_fastcron_job_id' : 'top_pins_fastcron_job_id']: verifiedJobId,
      [isAnalytics ? 'analytics_schedule_status' : 'top_pins_schedule_status']: 'synced',
      [isAnalytics ? 'analytics_cron_expression' : 'top_pins_cron_expression']: cronValidation.cron,
    });

    return {
      success: true,
      connection_id: connectionId,
      channel,
      schedule_status: 'synced',
      fastcron_job_id: verifiedJobId,
      message: `FastCron schedule successfully synced for ${channel} (Job ID: ${verifiedJobId}).`,
    };
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
    runtimeEnv: Record<string, any>,
    overrides?: { from_date?: string; to_date?: string; start_date?: string; end_date?: string }
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

    // Per-pipeline date offsets and manual override resolution (V20.1)
    const startOffset = isAnalytics
      ? (connection.analytics_start_offset_days ?? 7)
      : (connection.top_pins_start_offset_days ?? 7);
    const endOffset = isAnalytics
      ? (connection.analytics_end_offset_days ?? 1)
      : (connection.top_pins_end_offset_days ?? 2);

    const fromOverride = overrides?.from_date || overrides?.start_date;
    const toOverride = overrides?.to_date || overrides?.end_date;

    let startDate: string;
    let endDate: string;

    if (fromOverride && toOverride) {
      if (fromOverride >= toOverride) {
        return {
          success: false,
          connection_id: connectionId,
          channel,
          mode: 'sync',
          error: 'Manual run override Start Date must be strictly before End Date.',
        };
      }
      startDate = fromOverride;
      endDate = toOverride;
    } else {
      const now = new Date();
      const startDateObj = new Date(now.getTime() - startOffset * 24 * 60 * 60 * 1000);
      const endDateObj = new Date(now.getTime() - endOffset * 24 * 60 * 60 * 1000);
      startDate = startDateObj.toISOString().split('T')[0];
      endDate = endDateObj.toISOString().split('T')[0];
    }

    const jobId = isAnalytics
      ? connection.analytics_fastcron_job_id
      : connection.top_pins_fastcron_job_id;

    const settings = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);
    const token = this.resolveFastCronToken(settings?.fastcron_token, runtimeEnv);

    const payloadObj = isAnalytics
      ? {
          job_type: 'manual_sync',
          channel: 'account_analytics',
          connection_id: connectionId,
          start_date: startDate,
          end_date: endDate,
          analytics_start_offset_days: startOffset,
          analytics_end_offset_days: endOffset,
        }
      : {
          job_type: 'manual_sync',
          channel: 'top_pins',
          connection_id: connectionId,
          start_date: startDate,
          end_date: endDate,
          top_pins_start_offset_days: startOffset,
          top_pins_end_offset_days: endOffset,
          num_of_pins: connection.top_pins_num_of_pins || 50,
          sort_modes: connection.top_pins_sort_modes || SORT_MODES,
        };

    // If Job ID and Token exist -> Dispatches cron_run
    if (jobId && token) {
      const payload = JSON.stringify(payloadObj);

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
    try {
      const res = await fetch(webhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadObj),
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
