import type { SupabaseClient } from '@supabase/supabase-js';
import { assertWorkspaceAccess } from '../auth/workspace-guard';
import { analyticsDb } from '../db/analytics';
import { edgeCache, type CacheStatus } from './edge-cache';
import type {
  PinnerSortBy,
  TopPinSnapshot,
  AccountAnalyticsDaily,
  PinnerOverviewKPIs,
} from '../../lib/types';

export interface ServiceResponse<T> {
  data: T;
  cacheStatus: CacheStatus;
}

export interface BackfillChunk {
  chunkIndex: number;
  startDate: string;
  endDate: string;
}

/**
 * High-level server-only service for Pinner Analytics.
 * Mandatory Guard: Every method calls assertWorkspaceAccess against Project 1 before touching Project 3.
 */
export const pinnerAnalyticsService = {
  /**
   * Retrieves aggregated Overview KPIs for a Pinterest connection.
   */
  async getOverview(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    connectionId: string,
    windowDays = 30,
    kvNamespace?: any
  ): Promise<ServiceResponse<PinnerOverviewKPIs>> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);

    const cacheKey = edgeCache.keys.overview(workspaceId, connectionId, windowDays);
    const cached = await edgeCache.get<PinnerOverviewKPIs>(cacheKey, kvNamespace);

    if (cached.status === 'HIT' && cached.data) {
      return {
        data: cached.data,
        cacheStatus: 'HIT',
      };
    }

    // Fallback: Query Project 3
    const now = new Date();
    const startDateObj = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const startDate = startDateObj.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    const [summary, dailyRows, topPins] = await Promise.all([
      analyticsDb.getAccountSummary(workspaceId, connectionId),
      analyticsDb.getAccountDailyMetrics(workspaceId, connectionId, startDate, endDate),
      analyticsDb.getTopPinsSnapshots(workspaceId, connectionId, 'IMPRESSION', 50),
    ]);

    let impressions = 0;
    let engagements = 0;
    let pinClicks = 0;
    let outboundClicks = 0;
    let saves = 0;

    // Use daily aggregation if available, or summary as fallback
    if (dailyRows.length > 0) {
      for (const row of dailyRows) {
        impressions += Number(row.impressions || 0);
        engagements += Number(row.engagements || 0);
        pinClicks += Number(row.pin_clicks || 0);
        outboundClicks += Number(row.outbound_clicks || 0);
        saves += Number(row.saves || 0);
      }
    } else if (summary) {
      impressions = Number(summary.summary_impressions || 0);
      engagements = Number(summary.summary_engagements || 0);
      pinClicks = Number(summary.summary_pin_clicks || 0);
      outboundClicks = Number(summary.summary_outbound_clicks || 0);
      saves = Number(summary.summary_saves || 0);
    }

    const engagementRate =
      impressions > 0 ? parseFloat((engagements / impressions).toFixed(6)) : 0.0;
    const outboundClickRate =
      impressions > 0 ? parseFloat((outboundClicks / impressions).toFixed(6)) : 0.0;
    const pinClickRate =
      impressions > 0 ? parseFloat((pinClicks / impressions).toFixed(6)) : 0.0;
    const saveRate =
      impressions > 0 ? parseFloat((saves / impressions).toFixed(6)) : 0.0;

    const result: PinnerOverviewKPIs = {
      impressions,
      engagements,
      pinClicks,
      outboundClicks,
      saves,
      engagementRate,
      outboundClickRate,
      pinClickRate,
      saveRate,
      activeTopPinsCount: topPins.length,
      windowStart: startDate,
      windowEnd: endDate,
      lastIngestedAt: dailyRows[dailyRows.length - 1]?.recorded_at || summary?.recorded_at || null,
      connectionId,
      workspaceId,
    };

    // Cache the resolved overview
    await edgeCache.set(cacheKey, result, kvNamespace);

    return {
      data: result,
      cacheStatus: cached.status === 'STALE' ? 'STALE' : 'MISS',
    };
  },

  /**
   * Retrieves ranked Top Pins for a specified sort mode.
   */
  async getTopPins(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    connectionId: string,
    sortBy: PinnerSortBy = 'IMPRESSION',
    limit = 50,
    kvNamespace?: any
  ): Promise<ServiceResponse<TopPinSnapshot[]>> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);

    const cacheKey = edgeCache.keys.topPins(workspaceId, connectionId, sortBy, 30);
    const cached = await edgeCache.get<TopPinSnapshot[]>(cacheKey, kvNamespace);

    if (cached.status === 'HIT' && cached.data) {
      return {
        data: cached.data,
        cacheStatus: 'HIT',
      };
    }

    const snapshots = await analyticsDb.getTopPinsSnapshots(
      workspaceId,
      connectionId,
      sortBy,
      limit
    );

    await edgeCache.set(cacheKey, snapshots, kvNamespace);

    return {
      data: snapshots,
      cacheStatus: cached.status === 'STALE' ? 'STALE' : 'MISS',
    };
  },

  /**
   * Retrieves daily timeseries for charting.
   */
  async getTimeseries(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    connectionId: string,
    startDate?: string,
    endDate?: string,
    kvNamespace?: any
  ): Promise<ServiceResponse<AccountAnalyticsDaily[]>> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);

    const cacheKey = `${edgeCache.keys.timeseries(workspaceId, connectionId)}:${startDate || 'all'}:${endDate || 'all'}`;
    const cached = await edgeCache.get<AccountAnalyticsDaily[]>(cacheKey, kvNamespace);

    if (cached.status === 'HIT' && cached.data) {
      return {
        data: cached.data,
        cacheStatus: 'HIT',
      };
    }

    const dailyRows = await analyticsDb.getAccountDailyMetrics(
      workspaceId,
      connectionId,
      startDate,
      endDate
    );

    await edgeCache.set(cacheKey, dailyRows, kvNamespace);

    return {
      data: dailyRows,
      cacheStatus: cached.status === 'STALE' ? 'STALE' : 'MISS',
    };
  },

  /**
   * Generates sequential 7-day chunk ranges for historical 90-day backfills.
   */
  async generateHistoricalBackfillChunks(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    connectionId: string,
    totalDays = 90
  ): Promise<BackfillChunk[]> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);

    const chunks: BackfillChunk[] = [];
    const chunkSize = 7;
    const now = new Date();

    let endOffset = 1; // start from yesterday
    let chunkIndex = 1;

    while (endOffset < totalDays) {
      const startOffset = Math.min(totalDays, endOffset + chunkSize - 1);

      const endDateObj = new Date(now.getTime() - endOffset * 24 * 60 * 60 * 1000);
      const startDateObj = new Date(now.getTime() - startOffset * 24 * 60 * 60 * 1000);

      chunks.push({
        chunkIndex,
        startDate: startDateObj.toISOString().split('T')[0],
        endDate: endDateObj.toISOString().split('T')[0],
      });

      endOffset += chunkSize;
      chunkIndex++;
    }

    return chunks;
  },

  /**
   * Retrieves operational ingestion history for diagnostics.
   */
  async getOperationalStatus(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    connectionId?: string
  ) {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return analyticsDb.listImportSessions(workspaceId, connectionId, 10);
  },
};
