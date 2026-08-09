import type { SupabaseClient } from '@supabase/supabase-js';
import { assertWorkspaceAccess } from '../auth/workspace-guard';
import { analyticsDb } from '../db/analytics';
import { edgeCache, type CacheStatus } from './edge-cache';
import type {
  PinnerSortBy,
  TopPinSnapshot,
  AccountAnalyticsDaily,
  PinnerOverviewKPIs,
  AnalyticsIngestionRun,
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
 * Mandatory Guard: Every method calls assertWorkspaceAccess against Project 1 session before querying Project 3.
 * All DB operations are strictly against Project 3.
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

    const [overview, topPins] = await Promise.all([
      analyticsDb.getAccountOverviewMetrics(workspaceId, connectionId, windowDays),
      analyticsDb.getRankedTopPins(workspaceId, connectionId, 'IMPRESSION', 50),
    ]);

    const result: PinnerOverviewKPIs = {
      impressions: overview.impressions,
      engagements: overview.engagements,
      pinClicks: overview.pinClicks,
      outboundClicks: overview.outboundClicks,
      saves: overview.saves,
      engagementRate: overview.engagementRate,
      outboundClickRate: overview.outboundClickRate,
      pinClickRate: overview.pinClickRate,
      saveRate: overview.saveRate,
      activeTopPinsCount: topPins.length,
      windowStart: startDate,
      windowEnd: endDate,
      lastIngestedAt: overview.lastIngestedAt,
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

    const snapshots = await analyticsDb.getRankedTopPins(
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
    windowDays = 30,
    kvNamespace?: any
  ): Promise<ServiceResponse<AccountAnalyticsDaily[]>> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);

    const cacheKey = `${edgeCache.keys.timeseries(workspaceId, connectionId)}:${windowDays}`;
    const cached = await edgeCache.get<AccountAnalyticsDaily[]>(cacheKey, kvNamespace);

    if (cached.status === 'HIT' && cached.data) {
      return {
        data: cached.data,
        cacheStatus: 'HIT',
      };
    }

    const dailyRows = await analyticsDb.getDailyTimeSeries(
      workspaceId,
      connectionId,
      windowDays
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
  ): Promise<AnalyticsIngestionRun[]> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return analyticsDb.listIngestionRuns(workspaceId, connectionId, 10);
  },
};
