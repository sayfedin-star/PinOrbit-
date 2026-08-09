import { dbClients } from './clients';
import type {
  AccountAnalyticsDaily,
  AccountAnalyticsSummary,
  TopPinSnapshot,
  DailyWorkspaceMetric,
  PinnerSortBy,
  WorkspaceAnalyticsSettings,
  AnalyticsConnection,
  AnalyticsIngestionRun,
} from '../../lib/types';

export interface MetricSummary {
  workspace_id: string;
  total_pins_posted: number;
  total_impressions: number;
  total_saves: number;
  total_clicks: number;
  engagement_rate: number;
}

export interface BoardAnalyticsRollup {
  board_id: string;
  board_name: string;
  total_pins: number;
  impressions_7d: number;
  impressions_30d: number;
  saves_30d: number;
  clicks_30d: number;
}

/**
 * Server-Only Project 3 (Analytics Data Warehouse & Standalone Control Plane) Data Layer.
 * Directives (V17 Final Standalone Edition):
 * 1. Must never be imported from browser code.
 * 2. Every analytics query/write uses ONLY Project 3 analyticsClient. Zero Project 1/2 calls.
 * 3. Operational ingestion history is tracked in public.analytics_ingestion_runs.
 */
export const analyticsDb = {
  // ============================================================================
  // Project 3 Operational Ingestion Run Tracking (V17 Final)
  // ============================================================================

  /**
   * Records the start of an ingestion run in Project 3 (status: processing).
   */
  async createIngestionRun(
    run: {
      workspace_id: string;
      connection_id: string;
      channel: 'account_analytics' | 'top_pins';
      job_type: 'daily_sync' | 'manual_sync' | 'backfill' | 'ping';
      status?: 'processing' | 'completed' | 'failed';
      request_context?: Record<string, any> | null;
      rows_processed?: number;
      error_details?: Record<string, any> | null;
    }
  ): Promise<AnalyticsIngestionRun> {
    if (!run.workspace_id || !run.connection_id) {
      throw new Error('Tenant Boundary Violation: workspace_id and connection_id are required.');
    }

    const analyticsClient = dbClients.getAnalytics();

    // R5.2 Stale Sweeper: update prior processing runs older than 30 minutes to failed
    try {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await analyticsClient
        .from('analytics_ingestion_runs')
        .update({
          status: 'failed',
          error_details: { error: 'stale_processing_timeout' },
          completed_at: new Date().toISOString(),
        })
        .eq('connection_id', run.connection_id)
        .eq('channel', run.channel)
        .eq('status', 'processing')
        .lt('started_at', thirtyMinutesAgo);
    } catch (sweepErr) {
      console.warn('[AnalyticsDb] Stale sweeper failed non-fatally:', sweepErr);
    }

    const { data, error } = await analyticsClient
      .from('analytics_ingestion_runs')
      .insert({
        workspace_id: run.workspace_id,
        connection_id: run.connection_id,
        channel: run.channel,
        job_type: run.job_type,
        status: run.status || 'processing',
        request_context: run.request_context || null,
        rows_processed: run.rows_processed || 0,
        error_details: run.error_details || null,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data as AnalyticsIngestionRun;
  },

  /**
   * Marks an ingestion run as completed in Project 3.
   */
  async completeIngestionRun(
    runId: string,
    rowsProcessed: number
  ): Promise<void> {
    if (!runId) return;
    const analyticsClient = dbClients.getAnalytics();
    const { error } = await analyticsClient
      .from('analytics_ingestion_runs')
      .update({
        status: 'completed',
        rows_processed: rowsProcessed,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);

    if (error) {
      console.warn('[AnalyticsDb] Failed to complete ingestion run:', runId, error);
    }
  },

  /**
   * Marks an ingestion run as failed in Project 3 with error details.
   */
  async failIngestionRun(
    runId: string,
    errorDetails: Record<string, any>
  ): Promise<void> {
    if (!runId) return;
    const analyticsClient = dbClients.getAnalytics();
    const { error } = await analyticsClient
      .from('analytics_ingestion_runs')
      .update({
        status: 'failed',
        error_details: errorDetails,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);

    if (error) {
      console.warn('[AnalyticsDb] Failed to fail ingestion run:', runId, error);
    }
  },

  /**
   * Lists recent ingestion runs for a connection within a workspace.
   */
  async listIngestionRuns(
    workspaceId: string,
    connectionId?: string,
    limit = 10
  ): Promise<AnalyticsIngestionRun[]> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    let query = analyticsClient
      .from('analytics_ingestion_runs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (connectionId) {
      query = query.eq('connection_id', connectionId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[AnalyticsDb] Failed to query ingestion runs:', error);
      return [];
    }

    return (data as AnalyticsIngestionRun[]) || [];
  },

  /**
   * Checks whether the last N consecutive runs for (connection_id, channel) are failed.
   */
  async checkConsecutiveFailures(
    connectionId: string,
    channel: 'account_analytics' | 'top_pins',
    requiredCount = 2
  ): Promise<boolean> {
    if (!connectionId) return false;

    const analyticsClient = dbClients.getAnalytics();
    const { data, error } = await analyticsClient
      .from('analytics_ingestion_runs')
      .select('status')
      .eq('connection_id', connectionId)
      .eq('channel', channel)
      .order('started_at', { ascending: false })
      .limit(requiredCount);

    if (error || !data || data.length < requiredCount) {
      return false;
    }

    return data.every((r) => r.status === 'failed');
  },

  // ============================================================================
  // Project 3 Ingestion Upserts (Strict Zero-Sum & Clean Upserts)
  // ============================================================================

  /**
   * Upserts daily account metrics (Project 3 account_analytics_daily).
   */
  async upsertAccountDailyMetrics(
    workspaceId: string,
    connectionId: string,
    rows: AccountAnalyticsDaily[]
  ): Promise<number> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }
    if (!rows || rows.length === 0) return 0;

    const analyticsClient = dbClients.getAnalytics();
    const payload = rows.map((r) => ({
      ...r,
      workspace_id: workspaceId,
      connection_id: connectionId,
      recorded_at: new Date().toISOString(),
    }));

    const { error } = await analyticsClient
      .from('account_analytics_daily')
      .upsert(payload, {
        onConflict: 'workspace_id,connection_id,metric_date',
        ignoreDuplicates: false,
      });

    if (error) throw error;
    return rows.length;
  },

  /**
   * Upserts precomputed account summary (Project 3 account_analytics_summaries).
   */
  async upsertAccountSummary(
    workspaceId: string,
    connectionId: string,
    summary: AccountAnalyticsSummary
  ): Promise<void> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    const payload = {
      ...summary,
      workspace_id: workspaceId,
      connection_id: connectionId,
      recorded_at: new Date().toISOString(),
    };

    const { error } = await analyticsClient
      .from('account_analytics_summaries')
      .upsert(payload, {
        onConflict: 'workspace_id,connection_id,window_start,window_end',
        ignoreDuplicates: false,
      });

    if (error) throw error;
  },

  /**
   * Upserts ranked top pin snapshots (Project 3 top_pins_snapshots).
   */
  async upsertTopPinsSnapshots(
    workspaceId: string,
    connectionId: string,
    pins: TopPinSnapshot[]
  ): Promise<number> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }
    if (!pins || pins.length === 0) return 0;

    const analyticsClient = dbClients.getAnalytics();
    const payload = pins.map((p) => ({
      ...p,
      workspace_id: workspaceId,
      connection_id: connectionId,
      recorded_at: new Date().toISOString(),
    }));

    const { error } = await analyticsClient
      .from('top_pins_snapshots')
      .upsert(payload, {
        onConflict: 'workspace_id,connection_id,pin_id,window_start,window_end,sort_by',
        ignoreDuplicates: false,
      });

    if (error) throw error;
    return pins.length;
  },

  /**
   * Upserts derived workspace rollups (Project 3 daily_workspace_metrics).
   */
  async upsertDailyWorkspaceMetrics(
    workspaceId: string,
    metrics: DailyWorkspaceMetric[]
  ): Promise<number> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }
    if (!metrics || metrics.length === 0) return 0;

    const analyticsClient = dbClients.getAnalytics();
    const payload = metrics.map((m) => ({
      ...m,
      workspace_id: workspaceId,
      recorded_at: new Date().toISOString(),
    }));

    const { error } = await analyticsClient
      .from('daily_workspace_metrics')
      .upsert(payload, {
        onConflict: 'workspace_id,metric_date',
        ignoreDuplicates: false,
      });

    if (error) throw error;
    return metrics.length;
  },

  /**
   * Upserts URL performance metrics (Project 3 url_performance_history).
   */
  async upsertUrlPerformance(
    workspaceId: string,
    urls: Array<{
      destination_url: string;
      period_date: string;
      total_impressions: number;
      total_clicks: number;
      total_pins_active: number;
    }>
  ): Promise<number> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }
    if (!urls || urls.length === 0) return 0;

    const analyticsClient = dbClients.getAnalytics();
    const payload = urls.map((u) => ({
      ...u,
      workspace_id: workspaceId,
      created_at: new Date().toISOString(),
    }));

    const { error } = await analyticsClient
      .from('url_performance_history')
      .upsert(payload, {
        onConflict: 'workspace_id,destination_url,period_date',
        ignoreDuplicates: false,
      });

    if (error) throw error;
    return urls.length;
  },

  // ============================================================================
  // Project 3 Query Operations
  // ============================================================================

  /**
   * Retrieves daily time-series metrics from Project 3.
   */
  async getDailyTimeSeries(
    workspaceId: string,
    connectionId: string,
    windowDays: number
  ): Promise<AccountAnalyticsDaily[]> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - windowDays);
    const startDateStr = startDate.toISOString().split('T')[0];

    const analyticsClient = dbClients.getAnalytics();
    const { data, error } = await analyticsClient
      .from('account_analytics_daily')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('connection_id', connectionId)
      .gte('metric_date', startDateStr)
      .order('metric_date', { ascending: true });

    if (error) throw error;
    return (data as AccountAnalyticsDaily[]) || [];
  },

  /**
   * Retrieves ranked top pins for an account from Project 3.
   */
  async getRankedTopPins(
    workspaceId: string,
    connectionId: string,
    sortBy: PinnerSortBy,
    limit = 50
  ): Promise<TopPinSnapshot[]> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    const { data, error } = await analyticsClient
      .from('top_pins_snapshots')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('connection_id', connectionId)
      .eq('sort_by', sortBy)
      .order('rank_position', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return (data as TopPinSnapshot[]) || [];
  },

  /**
   * Aggregates overview KPI metrics from Project 3 account_analytics_daily.
   */
  async getAccountOverviewMetrics(
    workspaceId: string,
    connectionId: string,
    windowDays: number
  ): Promise<{
    impressions: number;
    engagements: number;
    pinClicks: number;
    outboundClicks: number;
    saves: number;
    engagementRate: number;
    pinClickRate: number;
    outboundClickRate: number;
    saveRate: number;
    lastIngestedAt: string | null;
  }> {
    const dailyRows = await this.getDailyTimeSeries(workspaceId, connectionId, windowDays);

    let impressions = 0;
    let engagements = 0;
    let pinClicks = 0;
    let outboundClicks = 0;
    let saves = 0;
    let lastIngestedAt: string | null = null;

    for (const row of dailyRows) {
      impressions += Number(row.impressions || 0);
      engagements += Number(row.engagements || 0);
      pinClicks += Number(row.pin_clicks || 0);
      outboundClicks += Number(row.outbound_clicks || 0);
      saves += Number(row.saves || 0);
      if (!lastIngestedAt || row.updated_at > lastIngestedAt) {
        lastIngestedAt = row.updated_at;
      }
    }

    const engagementRate = impressions > 0 ? engagements / impressions : 0.0;
    const pinClickRate = impressions > 0 ? pinClicks / impressions : 0.0;
    const outboundClickRate = impressions > 0 ? outboundClicks / impressions : 0.0;
    const saveRate = impressions > 0 ? saves / impressions : 0.0;

    return {
      impressions,
      engagements,
      pinClicks,
      outboundClicks,
      saves,
      engagementRate: Math.min(1.0, engagementRate),
      pinClickRate: Math.min(1.0, pinClickRate),
      outboundClickRate: Math.min(1.0, outboundClickRate),
      saveRate: Math.min(1.0, saveRate),
      lastIngestedAt,
    };
  },

  /**
   * Computes high-level aggregated summary across an entire workspace for a given date range.
   */
  async getMetricSummary(
    workspaceId: string,
    startDate?: string,
    endDate?: string
  ): Promise<MetricSummary> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    let query = analyticsClient
      .from('daily_workspace_metrics')
      .select('total_impressions, total_engagements, total_saves, total_pin_clicks')
      .eq('workspace_id', workspaceId);

    if (startDate) query = query.gte('metric_date', startDate);
    if (endDate) query = query.lte('metric_date', endDate);

    const { data, error } = await query;
    if (error) throw error;

    let total_impressions = 0;
    let total_engagements = 0;
    let total_saves = 0;
    let total_clicks = 0;

    if (data && data.length > 0) {
      for (const row of data) {
        total_impressions += Number(row.total_impressions || 0);
        total_engagements += Number(row.total_engagements || 0);
        total_saves += Number(row.total_saves || 0);
        total_clicks += Number(row.total_pin_clicks || 0);
      }
    }

    const engagement_rate =
      total_impressions > 0 ? (total_engagements / total_impressions) : 0.0;

    return {
      workspace_id: workspaceId,
      total_pins_posted: 0,
      total_impressions,
      total_saves,
      total_clicks,
      engagement_rate: Math.min(1.0, engagement_rate),
    };
  },

  // ============================================================================
  // Project 3 Dedicated Analytics Control Plane (V17 Final Standalone)
  // ============================================================================

  /**
   * Retrieves workspace analytics settings from Project 3.
   */
  async getWorkspaceAnalyticsSettings(
    workspaceId: string
  ): Promise<WorkspaceAnalyticsSettings | null> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    const { data, error } = await analyticsClient
      .from('workspace_analytics_settings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error) throw error;
    return data as WorkspaceAnalyticsSettings | null;
  },

  /**
   * Upserts workspace analytics settings into Project 3.
   */
  async upsertWorkspaceAnalyticsSettings(
    workspaceId: string,
    settings: Partial<WorkspaceAnalyticsSettings>
  ): Promise<WorkspaceAnalyticsSettings> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    const payload = {
      ...settings,
      workspace_id: workspaceId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await analyticsClient
      .from('workspace_analytics_settings')
      .upsert(payload, { onConflict: 'workspace_id' })
      .select()
      .single();

    if (error) throw error;
    return data as WorkspaceAnalyticsSettings;
  },

  /**
   * Lists non-deleted analytics connections of a workspace from Project 3.
   */
  async listWorkspaceConnections(workspaceId: string): Promise<AnalyticsConnection[]> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    const { data, error } = await analyticsClient
      .from('analytics_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as AnalyticsConnection[]) || [];
  },

  /**
   * Gets a specific analytics connection in a workspace.
   */
  async getWorkspaceConnection(
    workspaceId: string,
    connectionId: string
  ): Promise<AnalyticsConnection | null> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    const { data, error } = await analyticsClient
      .from('analytics_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', connectionId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;
    return data as AnalyticsConnection | null;
  },

  /**
   * Creates a new analytics connection in Project 3.
   */
  async createWorkspaceConnection(
    workspaceId: string,
    displayName: string,
    analyticsEnabled = true
  ): Promise<AnalyticsConnection> {
    if (!workspaceId || !displayName) {
      throw new Error('Validation Error: workspaceId and displayName are required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    const { data, error } = await analyticsClient
      .from('analytics_connections')
      .insert({
        workspace_id: workspaceId,
        display_name: displayName.trim(),
        analytics_enabled: analyticsEnabled,
        analytics_sync_time: '04:00',
        analytics_cron_expression: '0 4 * * *',
        analytics_schedule_status: 'pending',
        top_pins_sync_time: '04:30',
        top_pins_cron_expression: '30 4 * * *',
        top_pins_schedule_status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return data as AnalyticsConnection;
  },

  /**
   * Updates an existing analytics connection in Project 3.
   * If analytics_enabled is set to true, automatically clears revoked_at.
   */
  async updateWorkspaceConnection(
    workspaceId: string,
    connectionId: string,
    updates: Partial<AnalyticsConnection>
  ): Promise<AnalyticsConnection> {
    if (!workspaceId || !connectionId) {
      throw new Error('Validation Error: workspaceId and connectionId are required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    const updatePayload: Record<string, any> = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    if (updates.display_name !== undefined) {
      updatePayload.display_name = updates.display_name.trim();
    }

    if (updates.analytics_enabled === true && updates.revoked_at === undefined) {
      updatePayload.revoked_at = null;
    }

    const { data, error } = await analyticsClient
      .from('analytics_connections')
      .update(updatePayload)
      .eq('id', connectionId)
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) throw error;
    return data as AnalyticsConnection;
  },

  /**
   * Soft-deletes an analytics connection in Project 3.
   */
  async softDeleteWorkspaceConnection(
    workspaceId: string,
    connectionId: string
  ): Promise<AnalyticsConnection> {
    if (!workspaceId || !connectionId) {
      throw new Error('Validation Error: workspaceId and connectionId are required.');
    }

    const analyticsClient = dbClients.getAnalytics();
    const { data, error } = await analyticsClient
      .from('analytics_connections')
      .update({
        analytics_enabled: false,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error) throw error;
    return data as AnalyticsConnection;
  },

  /**
   * Updates the last_analytics_sync_at timestamp for a connection in Project 3.
   */
  async updateConnectionLastSync(connectionId: string): Promise<void> {
    if (!connectionId) return;
    const analyticsClient = dbClients.getAnalytics();
    await analyticsClient
      .from('analytics_connections')
      .update({
        last_analytics_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId);
  },
};
