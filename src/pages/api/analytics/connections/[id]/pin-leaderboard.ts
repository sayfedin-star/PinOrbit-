export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../../../server/db/analytics';
import type { PinnerSortBy } from '../../../../../lib/types';
import { errorStatus } from '../../../../../server/lib/http-error';

const ALLOWED_SORT_MODES = new Set(['IMPRESSION', 'OUTBOUND_CLICK', 'SAVE', 'ENGAGEMENT', 'PIN_CLICK']);

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
  const rawSort = url.searchParams.get('sort_by');

  if (!rawSort || !ALLOWED_SORT_MODES.has(rawSort.toUpperCase())) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'sort_by query parameter is required and must be one of: IMPRESSION, OUTBOUND_CLICK, SAVE, ENGAGEMENT, PIN_CLICK.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const sortBy = rawSort.toUpperCase() as PinnerSortBy;

  let days = 30;
  const rawDays = url.searchParams.get('days');
  if (rawDays) {
    const parsedDays = parseInt(rawDays, 10);
    if (Number.isInteger(parsedDays) && parsedDays >= 7 && parsedDays <= 180) {
      days = parsedDays;
    }
  }

  let limit = 25;
  const rawLimit = url.searchParams.get('limit');
  if (rawLimit) {
    const parsedLimit = parseInt(rawLimit, 10);
    if (Number.isInteger(parsedLimit) && parsedLimit >= 10 && parsedLimit <= 100) {
      limit = parsedLimit;
    }
  }

  const query = url.searchParams.get('q') || undefined;

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);

    const items = await analyticsDb.getPinLeaderboard(
      workspaceId,
      connectionId,
      sortBy,
      days,
      limit,
      query
    );

    return new Response(
      JSON.stringify({
        success: true,
        data: items,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to retrieve pin leaderboard.',
      }),
      {
        status: errorStatus(err),
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
