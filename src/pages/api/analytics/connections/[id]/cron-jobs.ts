export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../../../server/db/analytics';
import { dbClients } from '../../../../../server/db/clients';

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const connectionId = params.id;
  const runtimeEnv = (locals as { runtime?: { env?: Record<string, any> }; runtimeEnv?: Record<string, any> })?.runtime?.env || (locals as { runtimeEnv?: Record<string, any> })?.runtimeEnv || {};

  if (!user || !schedulingClient) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: authentication required.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (!workspaceId) {
    return new Response(
      JSON.stringify({ success: false, error: 'Active workspace not found in session.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (!connectionId) {
    return new Response(
      JSON.stringify({ success: false, error: 'connection ID parameter is required.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    const connection = await analyticsDb.getWorkspaceConnection(workspaceId, connectionId);

    if (!connection) {
      return new Response(
        JSON.stringify({ success: false, error: 'Connection not found in this workspace.' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    let timezone = 'UTC';
    try {
      const wsSettings = await analyticsDb.getWorkspaceAnalyticsSettings(workspaceId);
      if (wsSettings?.timezone) {
        timezone = wsSettings.timezone;
      }
    } catch {
      timezone = 'UTC';
    }

    const analyticsClient = dbClients.getAnalytics(runtimeEnv);

    // Last runs: 10 per pipeline, ordered desc by started_at
    let runsA: Array<{ started_at: string; status: string }> = [];
    let runsB: Array<{ started_at: string; status: string }> = [];

    try {
      const { data: dataA } = await analyticsClient
        .from('analytics_ingestion_runs')
        .select('started_at, status')
        .eq('workspace_id', workspaceId)
        .eq('connection_id', connectionId)
        .eq('channel', 'account_analytics')
        .order('started_at', { ascending: false })
        .limit(10);
      if (Array.isArray(dataA)) {
        runsA = dataA;
      }
    } catch (err) {
      console.warn('[CronJobsAPI] Failed to fetch runs for account_analytics:', err);
    }

    try {
      const { data: dataB } = await analyticsClient
        .from('analytics_ingestion_runs')
        .select('started_at, status')
        .eq('workspace_id', workspaceId)
        .eq('connection_id', connectionId)
        .eq('channel', 'top_pins')
        .order('started_at', { ascending: false })
        .limit(10);
      if (Array.isArray(dataB)) {
        runsB = dataB;
      }
    } catch (err) {
      console.warn('[CronJobsAPI] Failed to fetch runs for top_pins:', err);
    }

    const formatRuns = (runs: Array<{ started_at: string; status: string }>) =>
      runs.map((r) => ({
        at: r.started_at,
        ok: r.status === 'completed',
      }));

    const responseBody = {
      success: true,
      connection_id: connection.id,
      timezone,
      pipelines: [
        {
          channel: 'account_analytics',
          label: 'Pipeline A: Account Analytics',
          job_id: connection.analytics_fastcron_job_id ?? null,
          cron_expression: connection.analytics_cron_expression || '0 4 * * *',
          sync_time: connection.analytics_sync_time || '04:00',
          schedule_status: connection.analytics_schedule_status || 'pending',
          live_status: null,
          last_runs: formatRuns(runsA),
        },
        {
          channel: 'top_pins',
          label: 'Pipeline B: Ranked Top Pins',
          job_id: connection.top_pins_fastcron_job_id ?? null,
          cron_expression: connection.top_pins_cron_expression || '30 4 * * *',
          sync_time: connection.top_pins_sync_time || '04:30',
          schedule_status: connection.top_pins_schedule_status || 'pending',
          live_status: null,
          last_runs: formatRuns(runsB),
        },
      ],
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    const isAuth = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized');
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to get cron jobs.' }),
      {
        status: isAuth ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
