export const prerender = false;

import type { APIRoute } from 'astro';
import { pinnerAnalyticsService } from '../../../server/services/pinner-analytics-service';
import type { PinnerSortBy } from '../../../lib/types';

export const GET: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;

  if (!user || !schedulingClient) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: authentication required.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id') || locals.activeWorkspaceId;
  const connectionId = url.searchParams.get('connection_id');
  const sortBy = (url.searchParams.get('sort_by') || 'IMPRESSION').toUpperCase() as PinnerSortBy;
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

  if (!workspaceId || !connectionId) {
    return new Response(
      JSON.stringify({ error: 'workspace_id and connection_id query parameters are required.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const kvNamespace = (locals as any)?.runtime?.env?.ANALYTICS_KV;
    const { data, cacheStatus } = await pinnerAnalyticsService.getTopPins(
      schedulingClient,
      user.id,
      workspaceId,
      connectionId,
      sortBy,
      limit,
      kvNamespace
    );

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache-Status': cacheStatus,
      },
    });
  } catch (err: any) {
    const isAuthError =
      err.message?.includes('Forbidden') || err.message?.includes('Unauthorized');
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to retrieve top pins.',
      }),
      {
        status: isAuthError ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
