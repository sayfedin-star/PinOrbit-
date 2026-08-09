import { analyticsDb } from '../db/analytics';
import { dbClients } from '../db/clients';
import { edgeCache } from './edge-cache';
import type {
  PinnerIngestPayload,
  PinnerSortBy,
  PinnerRawMetrics,
  AccountAnalyticsDaily,
  AccountAnalyticsSummary,
  TopPinSnapshot,
  DailyWorkspaceMetric,
} from '../../lib/types';

// In-memory tracker for consecutive ingestion failures by workspace
const failureStreakTracker = new Map<string, { count: number; lastFailedAt: string }>();

export interface ETLProcessingResult {
  success: boolean;
  persisted: boolean;
  workspaceId: string;
  connectionId: string;
  runId?: string;
  dailyRowsIngested: number;
  summarySaved: boolean;
  topPinsIngested: number;
  workspaceRollupsUpdated: number;
  revoked: boolean;
  snitchAlerted: boolean;
  error?: string | null;
  details?: any;
}

/**
 * Normalizes Pinterest metrics ensuring proper BIGINT counts and NUMERIC(8,6) rates.
 */
function normalizeMetrics(raw: PinnerRawMetrics = {}) {
  const parseCount = (v: any): number => {
    if (v === undefined || v === null) return 0;
    const n = Number(v);
    return isNaN(n) || n < 0 ? 0 : Math.floor(n);
  };

  const parseRate = (v: any): number => {
    if (v === undefined || v === null) return 0.0;
    const n = Number(v);
    if (isNaN(n)) return 0.0;
    // Limit to 6 decimal places (NUMERIC(8,6))
    return parseFloat(n.toFixed(6));
  };

  const parseTiming = (v: any): number => {
    if (v === undefined || v === null) return 0.0;
    const n = Number(v);
    return isNaN(n) || n < 0 ? 0.0 : parseFloat(n.toFixed(2));
  };

  const impressions = parseCount(raw.IMPRESSION);
  const engagements = parseCount(raw.ENGAGEMENT);
  const saves = parseCount(raw.SAVE);
  const pinClicks = parseCount(raw.PIN_CLICK);
  const outboundClicks = parseCount(raw.OUTBOUND_CLICK);

  // Derived or provided rates
  const engagementRate =
    raw.ENGAGEMENT_RATE !== undefined
      ? parseRate(raw.ENGAGEMENT_RATE)
      : impressions > 0
      ? parseRate(engagements / impressions)
      : 0.0;

  const outboundClickRate =
    raw.OUTBOUND_CLICK_RATE !== undefined
      ? parseRate(raw.OUTBOUND_CLICK_RATE)
      : impressions > 0
      ? parseRate(outboundClicks / impressions)
      : 0.0;

  const pinClickRate =
    raw.PIN_CLICK_RATE !== undefined
      ? parseRate(raw.PIN_CLICK_RATE)
      : impressions > 0
      ? parseRate(pinClicks / impressions)
      : 0.0;

  const saveRate =
    raw.SAVE_RATE !== undefined
      ? parseRate(raw.SAVE_RATE)
      : impressions > 0
      ? parseRate(saves / impressions)
      : 0.0;

  return {
    impressions,
    engagements,
    engagement_rate: engagementRate,
    outbound_clicks: outboundClicks,
    outbound_click_rate: outboundClickRate,
    pin_clicks: pinClicks,
    pin_click_rate: pinClickRate,
    saves,
    save_rate: saveRate,
    video_mrc_views: parseCount(raw.VIDEO_MRC_VIEW),
    video_avg_watch_time: parseTiming(raw.VIDEO_AVG_WATCH_TIME),
    video_v50_watch_time: parseTiming(raw.VIDEO_V50_WATCH_TIME),
    total_comments: parseCount(raw.TOTAL_COMMENTS),
    total_reactions: parseCount(raw.TOTAL_REACTIONS),
  };
}

export const pinnerETL = {
  /**
   * Resets failure tracker for a workspace (useful for tests).
   */
  resetFailureStreak(workspaceId: string) {
    failureStreakTracker.delete(workspaceId);
  },

  /**
   * Triggers Dead Man's Snitch webhook on consecutive failures.
   */
  async triggerDeadManSnitch(
    workspaceId: string,
    connectionId: string,
    streakCount: number,
    lastError?: any
  ): Promise<boolean> {
    const env = dbClients.getConfig();
    const snitchUrl = env.SNITCH_WEBHOOK_URL;
    if (!snitchUrl) {
      console.warn('[DeadManSnitch] No SNITCH_WEBHOOK_URL configured.');
      return false;
    }

    try {
      const res = await fetch(snitchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'pinner_ingestion_failure_streak',
          workspace_id: workspaceId,
          connection_id: connectionId,
          consecutive_failures: streakCount,
          error_details: lastError || null,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });

      return res.ok;
    } catch (e) {
      console.warn('[DeadManSnitch] Webhook dispatch error:', e);
      return false;
    }
  },

  /**
   * Handles 401 Unauthorized revocation strictly in Project 3.
   */
  async handleAccountRevocation(
    workspaceId: string,
    connectionId: string,
    _errorDetails?: any
  ): Promise<void> {
    try {
      const analyticsClient = dbClients.getAnalytics();
      await analyticsClient
        .from('analytics_connections')
        .update({
          analytics_enabled: false,
          revoked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', connectionId)
        .eq('workspace_id', workspaceId);
    } catch (e) {
      console.error('[PinnerETL] Account revocation handler error in Project 3:', e);
    }
  },

  /**
   * Main Ingestion Pipeline: Processes normalized payload from Make.com proxy entirely in Project 3.
   */
  async processIngestionPayload(
    payload: PinnerIngestPayload,
    runtimeKvNamespace?: any
  ): Promise<ETLProcessingResult> {
    const {
      connection_id: connectionId,
      request_context: requestContext,
      success,
      raw_headers: rawHeaders,
      error_details: errorDetails,
    } = payload;

    if (!connectionId) {
      return {
        success: false,
        persisted: false,
        workspaceId: payload.workspace_id || 'unknown',
        connectionId: 'unknown',
        dailyRowsIngested: 0,
        summarySaved: false,
        topPinsIngested: 0,
        workspaceRollupsUpdated: 0,
        revoked: false,
        snitchAlerted: false,
        error: 'Validation Error: connection_id is required in ingestion payload.',
      };
    }

    // Validate connection_id against Project 3 analytics_connections
    const analyticsClient = dbClients.getAnalytics();
    const { data: connRow } = await analyticsClient
      .from('analytics_connections')
      .select('id, workspace_id, analytics_enabled, deleted_at')
      .eq('id', connectionId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!connRow) {
      return {
        success: false,
        persisted: false,
        workspaceId: payload.workspace_id || 'unknown',
        connectionId,
        dailyRowsIngested: 0,
        summarySaved: false,
        topPinsIngested: 0,
        workspaceRollupsUpdated: 0,
        revoked: false,
        snitchAlerted: false,
        error: `Validation Error: connection_id "${connectionId}" is not registered in Project 3 analytics_connections.`,
      };
    }

    const workspaceId = payload.workspace_id || connRow.workspace_id;
    const channel = (payload.channel === 'top_pins' || (payload.top_pins_analytics && !payload.account_analytics))
      ? 'top_pins'
      : 'account_analytics';
    const jobType = (requestContext?.job_type || 'daily_sync') as 'daily_sync' | 'manual_sync' | 'backfill' | 'ping';

    // Insert operational run log into Project 3 analytics_ingestion_runs
    const runRecord = await analyticsDb.createIngestionRun({
      workspace_id: workspaceId,
      connection_id: connectionId,
      channel,
      job_type: jobType,
      status: success ? 'processing' : 'failed',
      request_context: requestContext || null,
      error_details: errorDetails || null,
    });

    const nowIso = new Date().toISOString();

    // =========================================================================
    // Case 1: Ingestion Failed at Proxy / Pinterest Level
    // =========================================================================
    if (!success) {
      // 1. Increment failure streak
      const currentStreak = (failureStreakTracker.get(workspaceId)?.count || 0) + 1;
      failureStreakTracker.set(workspaceId, { count: currentStreak, lastFailedAt: nowIso });

      // 2. Fail run in Project 3
      await analyticsDb.failIngestionRun(
        runRecord.id,
        errorDetails || { message: 'Make.com ingestion reported failure' }
      );

      // 3. Handle 401 Revocation in Project 3
      let isRevoked = false;
      if (
        errorDetails?.http_status === 401 ||
        errorDetails?.error_code === 'UNAUTHORIZED' ||
        String(errorDetails?.error_message || '').toLowerCase().includes('unauthorized')
      ) {
        await this.handleAccountRevocation(workspaceId, connectionId, errorDetails);
        isRevoked = true;
      }

      // 4. Trigger Dead Man's Snitch if 2+ consecutive failures
      let snitchFired = false;
      const isDbConsecutiveFail = await analyticsDb.checkConsecutiveFailures(connectionId, channel, 2);
      if (currentStreak >= 2 || isDbConsecutiveFail) {
        snitchFired = await this.triggerDeadManSnitch(
          workspaceId,
          connectionId,
          currentStreak,
          errorDetails
        );
      }

      return {
        success: false,
        persisted: false,
        workspaceId,
        connectionId,
        runId: runRecord.id,
        dailyRowsIngested: 0,
        summarySaved: false,
        topPinsIngested: 0,
        workspaceRollupsUpdated: 0,
        revoked: isRevoked,
        snitchAlerted: snitchFired,
        error: errorDetails?.error_message || 'Make.com ingestion failed',
        details: { streak: currentStreak, rawHeaders },
      };
    }

    // =========================================================================
    // Case 2: Ingestion Succeeded — Parse & Transform Data
    // =========================================================================
    const hasAccountAnalytics = Boolean(payload.account_analytics);
    const hasTopPinsAnalytics = Boolean(payload.top_pins_analytics);

    if (!hasAccountAnalytics && !hasTopPinsAnalytics) {
      await analyticsDb.failIngestionRun(runRecord.id, {
        message: 'At least one analytics channel payload must be present when success=true',
      });

      return {
        success: false,
        persisted: false,
        workspaceId,
        connectionId,
        runId: runRecord.id,
        dailyRowsIngested: 0,
        summarySaved: false,
        topPinsIngested: 0,
        workspaceRollupsUpdated: 0,
        revoked: false,
        snitchAlerted: false,
        error: 'Validation Error: At least one analytics channel (account_analytics or top_pins_analytics) must be provided when success=true.',
      };
    }

    // Reset failure streak on success
    failureStreakTracker.delete(workspaceId);

    const dailyRows: AccountAnalyticsDaily[] = [];
    let summaryRow: AccountAnalyticsSummary | null = null;
    const topPinRows: TopPinSnapshot[] = [];
    const destinationUrlsToTrack: Array<{
      destination_url: string;
      period_date: string;
      total_impressions: number;
      total_clicks: number;
      total_pins_active: number;
    }> = [];

    // -------------------------------------------------------------------------
    // Parse Pipeline A: Account Daily Time Series & Summaries
    // -------------------------------------------------------------------------
    if (payload.account_analytics) {
      const { all } = payload.account_analytics;

      // Parse daily metrics array
      if (all?.daily_metrics && Array.isArray(all.daily_metrics)) {
        for (const item of all.daily_metrics) {
          if (!item.data_status || item.data_status === 'READY') {
            const metrics = normalizeMetrics(item.metrics);
            dailyRows.push({
              workspace_id: workspaceId,
              connection_id: connectionId,
              metric_date: item.date,
              window_start: item.date,
              window_end: item.date,
              data_status: item.data_status || 'READY',
              ...metrics,
              recorded_at: nowIso,
              updated_at: nowIso,
            } as any);
          }
        }
      }

      // Parse summary metrics
      if (all?.summary_metrics) {
        const metrics = normalizeMetrics(all.summary_metrics);
        const windowStart = requestContext?.start_date || (dailyRows[0]?.metric_date ?? nowIso.split('T')[0]);
        const windowEnd = requestContext?.end_date || (dailyRows[dailyRows.length - 1]?.metric_date ?? nowIso.split('T')[0]);

        summaryRow = {
          workspace_id: workspaceId,
          connection_id: connectionId,
          window_start: windowStart,
          window_end: windowEnd,
          ...metrics,
          recorded_at: nowIso,
          updated_at: nowIso,
        } as any;
      }
    }

    // -------------------------------------------------------------------------
    // Parse Pipeline B: Ranked Top Pins Snapshots
    // -------------------------------------------------------------------------
    const windowEnd = requestContext?.end_date || nowIso.split('T')[0];
    const windowStart = requestContext?.start_date || windowEnd;

    if (payload.top_pins_analytics && payload.top_pins_analytics.pins_by_sort_mode) {
      const { pins_by_sort_mode } = payload.top_pins_analytics;

      for (const [sortByRaw, pinsArray] of Object.entries(pins_by_sort_mode)) {
        const sortBy = sortByRaw.toUpperCase() as PinnerSortBy;
        if (!Array.isArray(pinsArray)) continue;

        pinsArray.forEach((pin, index) => {
          const metrics = normalizeMetrics(pin.metrics);
          topPinRows.push({
            workspace_id: workspaceId,
            connection_id: connectionId,
            pin_id: pin.pin_id,
            window_start: windowStart,
            window_end: windowEnd,
            title: pin.title || null,
            image_url: pin.image_url || null,
            destination_url: pin.destination_url || null,
            sort_by: sortBy,
            rank_position: index + 1,
            ...metrics,
            data_status: pin.data_status || 'READY',
            recorded_at: nowIso,
          } as any);

          if (pin.destination_url) {
            destinationUrlsToTrack.push({
              destination_url: pin.destination_url,
              period_date: windowEnd.split('T')[0],
              total_impressions: metrics.impressions,
              total_clicks: metrics.outbound_clicks + metrics.pin_clicks,
              total_pins_active: 1,
            });
          }
        });
      }
    }

    // -------------------------------------------------------------------------
    // Derive Workspace Rollups (daily_workspace_metrics)
    // -------------------------------------------------------------------------
    const workspaceDailyMap = new Map<string, DailyWorkspaceMetric>();

    for (const daily of dailyRows) {
      const dateKey = daily.metric_date;
      const existing = workspaceDailyMap.get(dateKey) || {
        workspace_id: workspaceId,
        metric_date: dateKey,
        total_impressions: 0,
        total_engagements: 0,
        total_saves: 0,
        total_outbound_clicks: 0,
        total_pin_clicks: 0,
        total_profile_visits: 0,
        top_pin_impressions: 0,
        top_pin_outbound_clicks: 0,
        top_pin_saves: 0,
        active_top_pins_count: 0,
        recorded_at: nowIso,
      };

      existing.total_impressions = (existing.total_impressions || 0) + (daily.impressions || 0);
      existing.total_engagements = (existing.total_engagements || 0) + (daily.engagements || 0);
      existing.total_saves = (existing.total_saves || 0) + (daily.saves || 0);
      existing.total_outbound_clicks = (existing.total_outbound_clicks || 0) + (daily.outbound_clicks || 0);
      existing.total_pin_clicks = (existing.total_pin_clicks || 0) + (daily.pin_clicks || 0);

      workspaceDailyMap.set(dateKey, existing);
    }

    // Add top pins aggregates if present
    if (topPinRows.length > 0) {
      const latestDate = windowEnd.split('T')[0];
      const latestWorkspaceMetric = workspaceDailyMap.get(latestDate) || {
        workspace_id: workspaceId,
        metric_date: latestDate,
        total_impressions: 0,
        total_engagements: 0,
        total_saves: 0,
        total_outbound_clicks: 0,
        total_pin_clicks: 0,
        total_profile_visits: 0,
        top_pin_impressions: 0,
        top_pin_outbound_clicks: 0,
        top_pin_saves: 0,
        active_top_pins_count: 0,
        recorded_at: nowIso,
      };

      const impressionTopPins = topPinRows.filter((p) => p.sort_by === 'IMPRESSION');
      latestWorkspaceMetric.active_top_pins_count = impressionTopPins.length;
      latestWorkspaceMetric.top_pin_impressions = impressionTopPins.reduce(
        (acc, p) => acc + (p.impressions || 0),
        0
      );
      latestWorkspaceMetric.top_pin_outbound_clicks = impressionTopPins.reduce(
        (acc, p) => acc + (p.outbound_clicks || 0),
        0
      );
      latestWorkspaceMetric.top_pin_saves = impressionTopPins.reduce(
        (acc, p) => acc + (p.saves || 0),
        0
      );

      workspaceDailyMap.set(latestDate, latestWorkspaceMetric);
    }

    const workspaceRollupRows = Array.from(workspaceDailyMap.values());

    // =========================================================================
    // Persistence Layer (Project 3 Upserts)
    // =========================================================================
    let dailyUpsertCount = 0;
    if (dailyRows.length > 0) {
      dailyUpsertCount = await analyticsDb.upsertAccountDailyMetrics(
        workspaceId,
        connectionId,
        dailyRows
      );
    }

    if (summaryRow) {
      await analyticsDb.upsertAccountSummary(workspaceId, connectionId, summaryRow);
    }

    let topPinsUpsertCount = 0;
    if (topPinRows.length > 0) {
      topPinsUpsertCount = await analyticsDb.upsertTopPinsSnapshots(
        workspaceId,
        connectionId,
        topPinRows
      );
    }

    let rollupsUpsertCount = 0;
    if (workspaceRollupRows.length > 0) {
      rollupsUpsertCount = await analyticsDb.upsertDailyWorkspaceMetrics(
        workspaceId,
        workspaceRollupRows
      );
    }

    if (destinationUrlsToTrack.length > 0) {
      await analyticsDb.upsertUrlPerformance(workspaceId, destinationUrlsToTrack);
    }

    // =========================================================================
    // Operational Ingestion Run Completion in Project 3
    // =========================================================================
    const totalRowsCount = dailyRows.length + topPinRows.length + (summaryRow ? 1 : 0);
    await analyticsDb.completeIngestionRun(runRecord.id, totalRowsCount);

    // =========================================================================
    // Edge Cache Invalidation & Post-Persistence Warmup
    // =========================================================================
    await edgeCache.invalidateConnection(workspaceId, connectionId, runtimeKvNamespace);
    await analyticsDb.updateConnectionLastSync(connectionId);

    return {
      success: true,
      persisted: true,
      workspaceId,
      connectionId,
      runId: runRecord.id,
      dailyRowsIngested: dailyUpsertCount,
      summarySaved: true,
      topPinsIngested: topPinsUpsertCount,
      workspaceRollupsUpdated: rollupsUpsertCount,
      revoked: false,
      snitchAlerted: false,
    };
  },
};
