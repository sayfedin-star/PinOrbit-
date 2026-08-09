export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../../../../server/db/analytics';

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const connectionId = params.id;
  const metricDate = params.date;

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

  if (!connectionId || !metricDate) {
    return new Response(
      JSON.stringify({ success: false, error: 'connection ID and date parameters are required.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const access = await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    if (!access.isAdmin && !access.isOwner) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Forbidden: Admin or Owner role required to delete daily analytics records.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    await analyticsDb.deleteDailyMetricAndRecompute(workspaceId, connectionId, metricDate);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Daily analytics record for ${metricDate} deleted and workspace rollups recomputed.`,
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
        error: err.message || 'Failed to delete daily metric record.',
      }),
      {
        status: isAuth ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
