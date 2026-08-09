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
    if (isNaN(n)) return 0.0;
    return parseFloat(n.toFixed(3));
  };

  return {
    impressions: parseCount(raw.IMPRESSION),
    engagements: parseCount(raw.ENGAGEMENT),
    outbound_clicks: parseCount(raw.OUTBOUND_CLICK),
    pin_clicks: parseCount(raw.PIN_CLICK),
    saves: parseCount(raw.SAVE),
    video_10s_view: parseCount(raw.VIDEO_10S_VIEW),
    video_mrc_view: parseCount(raw.VIDEO_MRC_VIEW),
    video_start: parseCount(raw.VIDEO_START),
    quartile_95_percent_view: parseCount(raw.QUARTILE_95_PERCENT_VIEW),
    engagement_rate: parseRate(raw.ENGAGEMENT_RATE),
    outbound_click_rate: parseRate(raw.OUTBOUND_CLICK_RATE),
    pin_click_rate: parseRate(raw.PIN_CLICK_RATE),
    save_rate: parseRate(raw.SAVE_RATE),
    video_avg_watch_time: parseTiming(raw.VIDEO_AVG_WATCH_TIME),
    video_v50_watch_time: parseTiming(raw.VIDEO_V50_WATCH_TIME),
  };
}

/**
 * Pinner Analytics ETL & Ingestion Processing Engine.
 * Directives:
 * 1. Zero 429 retry logic in Astro SSR: Rate limiting is handled in Make.com proxy policies.
 * 2. On 401 UNAUTHORIZED: Immediately revoke/deactivate connection in Project 1.
 * 3. Dead Man's Snitch: Fire notification when ingestion fails for 2+ consecutive attempts.
 * 4. Respect Data Status: Exclude days with data_status != 'READY' from workspace rollup KPIs.
 * 5. Derive rank_position strictly from pins[] array index + 1.
 */
export const pinnerETL = {
  /**
   * Resets the failure streak for a workspace.
   */
  resetFailureStreak(workspaceId: string) {
    failureStreakTracker.delete(workspaceId);
  },

  /**
   * Gets current consecutive failure count for a workspace.
   */
  getFailureStreak(workspaceId: string): number {
    return failureStreakTracker.get(workspaceId)?.count || 0;
  },

  /**
   * Dispatches Dead Man's Snitch notification to configured webhook.
   */
  async triggerDeadManSnitch(
    workspaceId: string,
    connectionId: string,
    streakCount: number,
    errorDetails?: any
  ): Promise<boolean> {
    const env = dbClients.getConfig();
    const snitchUrl = env.SNITCH_WEBHOOK_URL;
    if (!snitchUrl) return false;

    try {
      const response = await fetch(snitchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alert_type: 'pinner_analytics_ingestion_failure',
          severity: 'CRITICAL',
          workspace_id: workspaceId,
          connection_id: connectionId,
          consecutive_failures: streakCount,
          timestamp: new Date().toISOString(),
          error_details: errorDetails,
          message: `[Dead Man's Snitch] Pinterest ingestion has failed for ${streakCount} consecutive attempts on workspace ${workspaceId}.`,
        }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch (e) {
      console.warn('[DeadManSnitch] Webhook dispatch error:', e);
      return false;
    }
  },

  /**
   * Handles 401 Unauthorized revocation in Project 1 (Scheduling).
   */
  async handleAccountRevocation(
    workspaceId: string,
    connectionId: string,
    errorDetails?: any
  ): Promise<void> {
    try {
      // 1. Deactivate in Project 3 analytics_connections
      const analyticsClient = dbClients.getAnalytics();
      await analyticsClient
        .from('analytics_connections')
        .update({
          analytics_enabled: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', connectionId)
        .eq('workspace_id', workspaceId);

      // 2. Log revocation event in Project 1 operational logs
      const schedulingAdmin = dbClients.getSchedulingAdmin();
      await schedulingAdmin.from('logs').insert({
        account_id: connectionId,
        status: 'error',
        message: `Pinterest account connection revoked (401 Unauthorized). Automation halted. Reason: ${errorDetails?.error_message || 'Token expired or access revoked'}`,
        event_type: 'account_revoked',
        http_status: 401,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[PinnerETL] Account revocation handler error:', e);
    }
  },

  /**
   * Main Ingestion Pipeline: Processes normalized payload from Make.com proxy.
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
    const nowIso = new Date().toISOString();

    // =========================================================================
    // Case 1: Ingestion Failed at Proxy / Pinterest Level
    // =========================================================================
    if (!success) {
      // 1. Increment failure streak
      const currentStreak = (failureStreakTracker.get(workspaceId)?.count || 0) + 1;
      failureStreakTracker.set(workspaceId, { count: currentStreak, lastFailedAt: nowIso });

      // 2. Record operational failure in Project 1 import_sessions
      await analyticsDb.recordOperationalImportSession(workspaceId, {
        account_id: connectionId,
        source_type: 'pinterest_api_sync',
        source_label: requestContext?.job_type || 'daily_sync',
        total_rows: 0,
        valid_rows: 0,
        invalid_rows: 0,
        imported_rows: 0,
        status: 'failed',
        error_details: errorDetails || { message: 'Make.com ingestion reported failure' },
      });

      // 3. Handle 401 Revocation
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
      if (currentStreak >= 2) {
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
        dailyRowsIngested: 0,
        summarySaved: false,
        topPinsIngested: 0,
        workspaceRollupsUpdated: 0,
        revoked: isRevoked,
        snitchAlerted: snitchFired,
        error: errorDetails?.error_message || 'Ingestion failed in Make.com proxy',
        details: errorDetails,
      };
    }

    // =========================================================================
    // Case 2: Ingestion Succeeded — Parse, Validate & Persist to Project 3
    // =========================================================================
    // Reset failure streak on success
    this.resetFailureStreak(workspaceId);

    // Normalize safely if account_analytics or top_pins_analytics are JSON strings
    let accountAnalytics = payload.account_analytics;
    if (typeof accountAnalytics === 'string') {
      try {
        accountAnalytics = JSON.parse(accountAnalytics);
      } catch {
        accountAnalytics = null;
      }
    }

    let topPinsAnalytics = payload.top_pins_analytics;
    if (typeof topPinsAnalytics === 'string') {
      try {
        topPinsAnalytics = JSON.parse(topPinsAnalytics);
      } catch {
        topPinsAnalytics = null;
      }
    }

    const hasAccountAnalytics = Boolean(
      accountAnalytics &&
        (accountAnalytics?.all?.daily_metrics?.length > 0 ||
          accountAnalytics?.all?.summary_metrics)
    );

    const hasTopPinsAnalytics = Boolean(
      topPinsAnalytics &&
        Object.keys(topPinsAnalytics).length > 0 &&
        Object.values(topPinsAnalytics).some(
          (val: any) => Array.isArray(val?.pins) && val.pins.length > 0
        )
    );

    // Strict V15 rule: At least one channel must be non-null on success
    if (!hasAccountAnalytics && !hasTopPinsAnalytics) {
      return {
        success: false,
        persisted: false,
        workspaceId,
        connectionId,
        dailyRowsIngested: 0,
        summarySaved: false,
        topPinsIngested: 0,
        workspaceRollupsUpdated: 0,
        revoked: false,
        snitchAlerted: false,
        error:
          'Payload rejected: At least one analytics channel (account_analytics or top_pins_analytics) must be provided when success is true.',
      };
    }

    // Dates for window
    const windowStart = requestContext?.start_date
      ? new Date(requestContext.start_date).toISOString()
      : nowIso;
    const windowEnd = requestContext?.end_date
      ? new Date(requestContext.end_date).toISOString()
      : nowIso;

    // --- 1. Account Daily Metrics Parsing ---
    const dailyMetricsRaw = accountAnalytics?.all?.daily_metrics || [];
    const dailyRows: Partial<AccountAnalyticsDaily>[] = [];

    for (const item of dailyMetricsRaw) {
      if (!item.date) continue;
      const normalized = normalizeMetrics(item.metrics);

      dailyRows.push({
        workspace_id: workspaceId,
        connection_id: connectionId,
        window_start: windowStart,
        window_end: windowEnd,
        metric_date: item.date,
        data_status: item.data_status || 'READY',
        impressions: normalized.impressions,
        engagements: normalized.engagements,
        outbound_clicks: normalized.outbound_clicks,
        pin_clicks: normalized.pin_clicks,
        saves: normalized.saves,
        video_10s_view: normalized.video_10s_view,
        video_mrc_view: normalized.video_mrc_view,
        video_start: normalized.video_start,
        quartile_95_percent_view: normalized.quartile_95_percent_view,
        engagement_rate: normalized.engagement_rate,
        outbound_click_rate: normalized.outbound_click_rate,
        pin_click_rate: normalized.pin_click_rate,
        save_rate: normalized.save_rate,
        video_avg_watch_time: normalized.video_avg_watch_time,
        video_v50_watch_time: normalized.video_v50_watch_time,
        raw_metrics: item.metrics || {},
        recorded_at: nowIso,
      });
    }

    // --- 2. Account Summary Parsing ---
    const summaryMetricsRaw = accountAnalytics?.all?.summary_metrics || null;
    let summaryRow: Partial<AccountAnalyticsSummary> | null = null;
    if (summaryMetricsRaw) {
      const normalizedSummary = normalizeMetrics(summaryMetricsRaw);
      summaryRow = {
        workspace_id: workspaceId,
        connection_id: connectionId,
        window_start: windowStart,
        window_end: windowEnd,
        summary_impressions: normalizedSummary.impressions,
        summary_engagements: normalizedSummary.engagements,
        summary_outbound_clicks: normalizedSummary.outbound_clicks,
        summary_pin_clicks: normalizedSummary.pin_clicks,
        summary_saves: normalizedSummary.saves,
        summary_video_10s_view: normalizedSummary.video_10s_view,
        summary_video_mrc_view: normalizedSummary.video_mrc_view,
        summary_video_start: normalizedSummary.video_start,
        summary_quartile_95_percent_view: normalizedSummary.quartile_95_percent_view,
        summary_engagement_rate: normalizedSummary.engagement_rate,
        summary_outbound_click_rate: normalizedSummary.outbound_click_rate,
        summary_pin_click_rate: normalizedSummary.pin_click_rate,
        summary_save_rate: normalizedSummary.save_rate,
        summary_video_avg_watch_time: normalizedSummary.video_avg_watch_time,
        summary_video_v50_watch_time: normalizedSummary.video_v50_watch_time,
        raw_summary: summaryMetricsRaw,
        recorded_at: nowIso,
      };
    }

    // --- 3. Top Pins Snapshots Parsing (5 Sort Modes) ---
    const sortModes: PinnerSortBy[] = [
      'IMPRESSION',
      'OUTBOUND_CLICK',
      'SAVE',
      'ENGAGEMENT',
      'PIN_CLICK',
    ];
    const topPinRows: Partial<TopPinSnapshot>[] = [];
    const destinationUrlsToTrack: Array<{
      destination_url: string;
      period_date: string;
      total_clicks?: number;
      total_impressions?: number;
    }> = [];

    for (const sortBy of sortModes) {
      let sortPayload = topPinsAnalytics?.[sortBy];
      if (typeof sortPayload === 'string') {
        try {
          sortPayload = JSON.parse(sortPayload);
        } catch {
          sortPayload = null;
        }
      }

      if (!sortPayload || !Array.isArray(sortPayload.pins)) continue;

      const dateAvailability = sortPayload.date_availability || null;
      const pinsList = sortPayload.pins.slice(0, 50); // Pinterest max 50

      pinsList.forEach((pin: any, index: number) => {
        if (!pin.pin_id) return;
        const normalized = normalizeMetrics(pin.metrics);
        const rankPosition = index + 1; // Derived from array index + 1

        topPinRows.push({
          workspace_id: workspaceId,
          connection_id: connectionId,
          window_start: windowStart,
          window_end: windowEnd,
          sort_by: sortBy,
          rank_position: rankPosition,
          pin_id: String(pin.pin_id),
          recorded_at: nowIso,
          impressions: normalized.impressions,
          engagement: normalized.engagements,
          outbound_clicks: normalized.outbound_clicks,
          pin_clicks: normalized.pin_clicks,
          saves: normalized.saves,
          video_10s_view: normalized.video_10s_view,
          video_mrc_view: normalized.video_mrc_view,
          video_start: normalized.video_start,
          quartile_95_percent_view: normalized.quartile_95_percent_view,
          engagement_rate: normalized.engagement_rate,
          outbound_click_rate: normalized.outbound_click_rate,
          pin_click_rate: normalized.pin_click_rate,
          save_rate: normalized.save_rate,
          video_avg_watch_time: normalized.video_avg_watch_time,
          video_v50_watch_time: normalized.video_v50_watch_time,
          data_status: pin.data_status || {},
          date_availability: dateAvailability,
          title: pin.title || null,
          destination_url: pin.destination_url || pin.link || null,
          image_url: pin.image_url || pin.media_url || null,
          pin_metadata: pin.pin_metadata || null,
          raw_metrics: pin.metrics || {},
          raw_pin: pin,
          raw_headers: rawHeaders || {},
        });

        if (pin.destination_url || pin.link) {
          destinationUrlsToTrack.push({
            destination_url: pin.destination_url || pin.link,
            period_date: windowEnd.split('T')[0],
            total_clicks: normalized.outbound_clicks,
            total_impressions: normalized.impressions,
          });
        }
      });
    }

    // --- 4. Derived Workspace Metrics Rollup ---
    const workspaceDailyMap = new Map<string, Partial<DailyWorkspaceMetric>>();

    for (const daily of dailyRows) {
      if (!daily.metric_date) continue;
      // Strict rule: Exclude non-READY days from workspace aggregations
      if (daily.data_status !== 'READY') continue;

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
    // Persist to Project 3 Tables
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
    // Operational Tracking in Project 1
    // =========================================================================
    const totalRowsCount = dailyRows.length + topPinRows.length + (summaryRow ? 1 : 0);
    const channelName = payload.channel || (hasAccountAnalytics && hasTopPinsAnalytics ? 'full_sync' : hasAccountAnalytics ? 'account_analytics' : 'top_pins');

    await analyticsDb.recordOperationalImportSession(workspaceId, {
      account_id: connectionId,
      source_type: `pinterest_${channelName}`,
      source_label: requestContext?.job_type || 'daily_sync',
      total_rows: totalRowsCount,
      valid_rows: totalRowsCount,
      invalid_rows: 0,
      imported_rows: totalRowsCount,
      status: 'completed',
    });

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
      dailyRowsIngested: dailyUpsertCount,
      summarySaved: true,
      topPinsIngested: topPinsUpsertCount,
      workspaceRollupsUpdated: rollupsUpsertCount,
      revoked: false,
      snitchAlerted: false,
    };
  },
};
