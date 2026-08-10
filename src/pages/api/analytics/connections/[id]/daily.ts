export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../../../server/db/analytics';

export const GET: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const connectionId = params.id;

  if (!user || !schedulingClient) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: authentication required.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!workspaceId || !connectionId) {
    return new Response(
      JSON.stringify({ success: false, error: 'workspace and connection ID required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);

    const url = new URL(request.url);
    const fromDate = url.searchParams.get('from_date') || undefined;
    const toDate = url.searchParams.get('to_date') || undefined;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.max(1, parseInt(url.searchParams.get('page_size') || '25', 10));
    const sortField = url.searchParams.get('sort') || 'metric_date';
    const isDesc = (url.searchParams.get('dir') || 'desc').toLowerCase() === 'desc';
    const query = (url.searchParams.get('q') || '').toLowerCase().trim();

    const result = await analyticsDb.getConnectionDailyMetrics(
      workspaceId,
      connectionId,
      fromDate,
      toDate
    );

    let rows = result.rows;

    if (query) {
      rows = rows.filter(r => r.metric_date.toLowerCase().includes(query));
    }

    rows.sort((a: any, b: any) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (valA < valB) return isDesc ? 1 : -1;
      if (valA > valB) return isDesc ? -1 : 1;
      return 0;
    });

    const total = rows.length;
    const start = (page - 1) * pageSize;
    const pagedRows = rows.slice(start, start + pageSize);

    return new Response(JSON.stringify({ 
      success: true, 
      data: {
        rows: pagedRows,
        total,
        totals: result.totals
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    const isAuth = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized');
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to retrieve connection daily metrics.',
      }),
      {
        status: isAuth ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
