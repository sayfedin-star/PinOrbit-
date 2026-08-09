export const prerender = false;

import type { APIRoute } from 'astro';
import { pinnerAnalyticsService } from '../../../../../server/services/pinner-analytics-service';
import type { PinnerSortBy } from '../../../../../lib/types';

export const GET: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const connectionId = params.id;

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

  if (!connectionId) {
    return new Response(
      JSON.stringify({ success: false, error: 'connection ID parameter is required.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const url = new URL(request.url);
  const sortBy = (url.searchParams.get('sort_by') || 'IMPRESSION').toUpperCase() as PinnerSortBy;
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const bypassCache = url.searchParams.get('cache_bypass') === '1';
  const fromDate = url.searchParams.get('from_date') || undefined;
  const toDate = url.searchParams.get('to_date') || undefined;

  try {
    const kvNamespace = (locals as any)?.runtime?.env?.ANALYTICS_KV;
    const { data, cacheStatus } = await pinnerAnalyticsService.getTopPins(
      schedulingClient,
      user.id,
      workspaceId,
      connectionId,
      sortBy,
      limit,
      kvNamespace,
      bypassCache,
      fromDate,
      toDate
    );

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache-Status': cacheStatus,
      },
    });
  } catch (err: any) {
    const isAuth = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized');
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to retrieve top pins.',
      }),
      {
        status: isAuth ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
