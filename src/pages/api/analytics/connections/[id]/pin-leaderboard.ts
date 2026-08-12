export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../../server/auth/workspace-guard';
import { analyticsDb } from '../../../../../server/db/analytics';
import type {
  PinnerSortBy,
  PinLeaderboardSortField,
  PinLeaderboardTrendFilter,
} from '../../../../../lib/types';
import { errorStatus } from '../../../../../server/lib/http-error';

const ALLOWED_SORT_MODES = new Set(['IMPRESSION', 'OUTBOUND_CLICK', 'SAVE', 'ENGAGEMENT', 'PIN_CLICK']);
const ALLOWED_PAGE_SIZES = new Set([10, 25, 50, 100]);
const ALLOWED_SORT_FIELDS = new Set([
  'appearances',
  'best_rank',
  'total_impressions',
  'total_saves',
  'last_seen',
  'total_engagements',
  'total_outbound_clicks',
  'total_pin_clicks',
]);
const ALLOWED_TREND_FILTERS = new Set(['ALL', 'NEW', 'RISING', 'FALLING']);

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

  // 1. Sort By (Ranking mode)
  const rawSortBy = url.searchParams.get('sort_by');
  let sortBy: PinnerSortBy = 'IMPRESSION';
  if (rawSortBy) {
    const upperSortBy = rawSortBy.toUpperCase();
    if (!ALLOWED_SORT_MODES.has(upperSortBy)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'sort_by query parameter must be one of: IMPRESSION, OUTBOUND_CLICK, SAVE, ENGAGEMENT, PIN_CLICK.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    sortBy = upperSortBy as PinnerSortBy;
  }

  // 2. Days
  let days = 30;
  const rawDays = url.searchParams.get('days');
  if (rawDays) {
    const parsedDays = parseInt(rawDays, 10);
    if (Number.isInteger(parsedDays) && parsedDays >= 7 && parsedDays <= 180) {
      days = parsedDays;
    }
  }

  // 3. Page (>= 1, default 1)
  let page = 1;
  const rawPage = url.searchParams.get('page');
  if (rawPage !== null) {
    const parsedPage = parseInt(rawPage, 10);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'page query parameter must be an integer >= 1.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    page = parsedPage;
  }

  // 4. Page Size (10 | 25 | 50 | 100, default 25)
  let pageSize = 25;
  const rawPageSize = url.searchParams.get('page_size') ?? url.searchParams.get('limit');
  if (rawPageSize !== null) {
    const parsedPageSize = parseInt(rawPageSize, 10);
    if (!Number.isInteger(parsedPageSize) || !ALLOWED_PAGE_SIZES.has(parsedPageSize)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'page_size query parameter must be one of: 10, 25, 50, 100.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    pageSize = parsedPageSize;
  }

  // 5. Sort Field
  let sortField: PinLeaderboardSortField = 'total_impressions';
  const rawSort = url.searchParams.get('sort');
  if (rawSort) {
    const lowerSort = rawSort.toLowerCase();
    if (!ALLOWED_SORT_FIELDS.has(lowerSort)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `sort query parameter must be one of: ${Array.from(ALLOWED_SORT_FIELDS).join(', ')}.`,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    sortField = lowerSort as PinLeaderboardSortField;
  }

  // 6. Sort Dir
  const rawDir = url.searchParams.get('dir')?.toLowerCase();
  const sortDir: 'asc' | 'desc' | undefined = rawDir === 'asc' || rawDir === 'desc' ? rawDir : undefined;

  // 7. Min Impressions (int >= 0)
  let minImpressions: number | undefined = undefined;
  const rawMinImpr = url.searchParams.get('min_impressions');
  if (rawMinImpr !== null) {
    const parsedMinImpr = parseInt(rawMinImpr, 10);
    if (!Number.isInteger(parsedMinImpr) || parsedMinImpr < 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'min_impressions query parameter must be an integer >= 0.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    minImpressions = parsedMinImpr;
  }

  // 8. Min Appearances (int >= 1)
  let minAppearances: number | undefined = undefined;
  const rawMinApp = url.searchParams.get('min_appearances');
  if (rawMinApp !== null) {
    const parsedMinApp = parseInt(rawMinApp, 10);
    if (!Number.isInteger(parsedMinApp) || parsedMinApp < 1) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'min_appearances query parameter must be an integer >= 1.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    minAppearances = parsedMinApp;
  }

  // 9. Trend (ALL | NEW | RISING | FALLING)
  let trend: PinLeaderboardTrendFilter = 'ALL';
  const rawTrend = url.searchParams.get('trend');
  if (rawTrend) {
    const upperTrend = rawTrend.toUpperCase();
    if (!ALLOWED_TREND_FILTERS.has(upperTrend)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'trend query parameter must be one of: ALL, NEW, RISING, FALLING.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    trend = upperTrend as PinLeaderboardTrendFilter;
  }

  // 10. Has Link (true / false)
  let hasLink: boolean | null = null;
  const rawHasLink = url.searchParams.get('has_link');
  if (rawHasLink !== null) {
    if (rawHasLink.toLowerCase() === 'true' || rawHasLink === '1') {
      hasLink = true;
    } else if (rawHasLink.toLowerCase() === 'false' || rawHasLink === '0') {
      hasLink = false;
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'has_link query parameter must be true or false.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  const query = url.searchParams.get('q') || undefined;

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);

    const result = await analyticsDb.getPinLeaderboard(
      workspaceId,
      connectionId,
      sortBy,
      days,
      pageSize,
      query,
      {
        page,
        page_size: pageSize,
        sort: sortField,
        sort_dir: sortDir,
        min_impressions: minImpressions,
        min_appearances: minAppearances,
        trend,
        has_link: hasLink,
      }
    );

    const items = Array.isArray(result) ? result : result.items;
    const totalUnique = Array.isArray(result) ? result.length : result.total_unique;
    const resultPage = Array.isArray(result) ? page : result.page;
    const resultPageSize = Array.isArray(result) ? pageSize : result.page_size;

    return new Response(
      JSON.stringify({
        success: true,
        data: items,
        total_unique: totalUnique,
        page: resultPage,
        page_size: resultPageSize,
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

