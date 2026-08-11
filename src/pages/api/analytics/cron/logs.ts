export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../../server/db/analytics';
import { fastcronService } from '../../../../server/services/fastcron-service';

export const GET: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const runtimeEnv = (locals as { runtime?: { env?: Record<string, any> }; runtimeEnv?: Record<string, any> })?.runtime?.env || (locals as { runtimeEnv?: Record<string, any> })?.runtimeEnv || {};

  if (!user || !schedulingClient) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: authentication required.' }),
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

  const url = new URL(request.url);
  const connectionId = url.searchParams.get('connection_id');
  const channel = url.searchParams.get('channel') as 'analytics' | 'top_pins';

  if (!connectionId) {
    return new Response(
      JSON.stringify({ success: false, error: 'connection_id query parameter is required.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (channel !== 'analytics' && channel !== 'top_pins') {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'channel must be either "analytics" or "top_pins".',
      }),
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

    const isAnalytics = channel === 'analytics';
    const jobId = isAnalytics
      ? connection.analytics_fastcron_job_id
      : connection.top_pins_fastcron_job_id;

    if (!jobId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'job_not_configured',
          message: `No FastCron job ID configured for ${channel} on this connection.`,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const logResult = await fastcronService.getCronLogs(
      workspaceId,
      connectionId,
      jobId,
      runtimeEnv
    );

    if (!logResult.success) {
      const statusCode = logResult.error?.includes('403 Forbidden') ? 403 : 400;
      return new Response(
        JSON.stringify({
          success: false,
          error: logResult.error || 'Failed to fetch FastCron execution logs.',
        }),
        {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        channel,
        logs: logResult.logs || [],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    const isAuth = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized');
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Internal server error while fetching cron logs.',
      }),
      {
        status: isAuth ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
