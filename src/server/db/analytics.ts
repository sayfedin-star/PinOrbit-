import { dbClients } from './clients';
import type {
  AccountAnalyticsDaily,
  AccountAnalyticsSummary,
  TopPinSnapshot,
  DailyWorkspaceMetric,
  PinnerSortBy,
  WorkspaceAnalyticsSettings,
  PinnerConnection,
} from '../../lib/types';

export interface ImportSessionRecord {
  id: string;
  account_id: string;
  source_type: string;
  source_label: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  imported_rows: number;
  created_by: string | null;
  created_at: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  error_details?: any;
}

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
 * Server-Only Project 3 (Analytics Data Warehouse) & Operational Ingestion Data Layer.
 * Directives:
 * 1. Must never be imported from browser code.
 * 2. Every operation MUST enforce workspace_id tenant boundary.
 * 3. Project 1 import_sessions is the operational source of truth for ingestion tracking.
 */
export const analyticsDb = {
  // ============================================================================
  // Project 1 Operational Tracking
  // ============================================================================

  /**
   * Records an operational import/ingestion session in Project 1 (Operational Truth).
   */
  async recordOperationalImportSession(
    workspaceId: string,
    session: {
      account_id: string;
      source_type: string;
      source_label?: string | null;
      total_rows: number;
      valid_rows: number;
      invalid_rows: number;
      imported_rows: number;
      status: 'pending' | 'processing' | 'completed' | 'failed';
      error_details?: any;
      created_by?: string | null;
    }
  ): Promise<ImportSessionRecord> {
    if (!workspaceId || !session.account_id) {
      throw new Error('Tenant Boundary Violation: workspaceId and account_id are required.');
    }

    const schedulingAdmin = dbClients.getSchedulingAdmin();
    const { data, error } = await schedulingAdmin
      .from('import_sessions')
      .insert({
        workspace_id: workspaceId,
        account_id: session.account_id,
        source_type: session.source_type,
        source_label: session.source_label || null,
        total_rows: session.total_rows,
        valid_rows: session.valid_rows,
        invalid_rows: session.invalid_rows,
        imported_rows: session.imported_rows,
        status: session.status,
        error_details: session.error_details || null,
        created_by: session.created_by || null,
      })
      .select()
      .single();

    if (error) {
      // Fallback: Also try writing to Project 3 import_sessions if Project 1 had an issue
      try {
        const analyticsClient = dbClients.getAnalytics();
        const fallbackRes = await analyticsClient
          .from('import_sessions')
          .insert({
            workspace_id: workspaceId,
            account_id: session.account_id,
            source_type: session.source_type,
            source_label: session.source_label || null,
            total_rows: session.total_rows,
            valid_rows: session.valid_rows,
            invalid_rows: session.invalid_rows,
            imported_rows: session.imported_rows,
            created_by: session.created_by || null,
          })
          .select()
          .single();
        if (!fallbackRes.error && fallbackRes.data) {
          return fallbackRes.data as ImportSessionRecord;
        }
      } catch {
        // Ignore fallback failure
      }
      throw error;
    }

    return data as ImportSessionRecord;
  },

  /**
   * Lists historical operational import sessions for an account within an authorized workspace.
   */
  async listImportSessions(
    workspaceId: string,
    accountId?: string,
    limit = 20
  ): Promise<ImportSessionRecord[]> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required for analytics queries.');
    }

    // Try Project 1 first (Operational Truth)
    try {
      const schedulingAdmin = dbClients.getSchedulingAdmin();
      let query = schedulingAdmin
        .from('import_sessions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        return data as ImportSessionRecord[];
      }
    } catch {
      // Fall back to Project 3 import_sessions
    }

    // Fallback to Project 3 import_sessions
    const client = dbClients.getAnalytics();
    let query = client
      .from('import_sessions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;
    if (error) return [];

    return (data as ImportSessionRecord[]) || [];
  },

  /**
   * Legacy recordImportSession wrapper.
   */
  async recordImportSession(
    workspaceId: string,
    session: Omit<ImportSessionRecord, 'id' | 'created_at'>
  ): Promise<ImportSessionRecord> {
    return this.recordOperationalImportSession(workspaceId, {
      account_id: session.account_id,
      source_type: session.source_type,
      source_label: session.source_label,
      total_rows: session.total_rows,
      valid_rows: session.valid_rows,
      invalid_rows: session.invalid_rows,
      imported_rows: session.imported_rows,
      status: session.status || 'completed',
      error_details: session.error_details,
      created_by: session.created_by,
    });
  },

  // ============================================================================
  // Project 3 Pinner Analytics Persistence (V11/V12 Locked)
  // ============================================================================

  /**
   * Batch upserts daily metrics for a Pinterest connection.
   */
  async upsertAccountDailyMetrics(
    workspaceId: string,
    connectionId: string,
    records: Partial<AccountAnalyticsDaily>[]
  ): Promise<number> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }
    if (!records.length) return 0;

    const client = dbClients.getAnalytics();
    const rowsToUpsert = records.map((r) => ({
      ...r,
      workspace_id: workspaceId,
      connection_id: connectionId,
      recorded_at: r.recorded_at || new Date().toISOString(),
    }));

    const { error } = await client.from('account_analytics_daily').upsert(rowsToUpsert, {
      onConflict: 'workspace_id,connection_id,metric_date',
    });

    if (error) throw error;
    return rowsToUpsert.length;
  },

  /**
   * Upserts the account analytics summary row.
   */
  async upsertAccountSummary(
    workspaceId: string,
    connectionId: string,
    summary: Partial<AccountAnalyticsSummary>
  ): Promise<void> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }

    const client = dbClients.getAnalytics();
    const rowToUpsert = {
      ...summary,
      workspace_id: workspaceId,
      connection_id: connectionId,
      recorded_at: summary.recorded_at || new Date().toISOString(),
    };

    const { error } = await client.from('account_analytics_summaries').upsert(rowToUpsert, {
      onConflict: 'workspace_id,connection_id,window_start,window_end',
    });

    if (error) throw error;
  },

  /**
   * Batch upserts ranked top pins snapshots.
   */
  async upsertTopPinsSnapshots(
    workspaceId: string,
    connectionId: string,
    snapshots: Partial<TopPinSnapshot>[]
  ): Promise<number> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }
    if (!snapshots.length) return 0;

    const client = dbClients.getAnalytics();
    const rowsToUpsert = snapshots.map((s) => ({
      ...s,
      workspace_id: workspaceId,
      connection_id: connectionId,
      recorded_at: s.recorded_at || new Date().toISOString(),
    }));

    const { error } = await client.from('top_pins_snapshots').upsert(rowsToUpsert, {
      onConflict: 'workspace_id,connection_id,pin_id,window_start,window_end,sort_by',
    });

    if (error) throw error;
    return rowsToUpsert.length;
  },

  /**
   * Batch upserts derived tenant daily metrics.
   */
  async upsertDailyWorkspaceMetrics(
    workspaceId: string,
    metrics: Partial<DailyWorkspaceMetric>[]
  ): Promise<number> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }
    if (!metrics.length) return 0;

    const client = dbClients.getAnalytics();
    const rowsToUpsert = metrics.map((m) => ({
      ...m,
      workspace_id: workspaceId,
      recorded_at: m.recorded_at || new Date().toISOString(),
    }));

    const { error } = await client.from('daily_workspace_metrics').upsert(rowsToUpsert, {
      onConflict: 'workspace_id,metric_date',
    });

    if (error) throw error;
    return rowsToUpsert.length;
  },

  /**
   * Upserts URL performance records.
   */
  async upsertUrlPerformance(
    workspaceId: string,
    records: Array<{
      destination_url: string;
      period_date: string;
      total_clicks?: number;
      total_impressions?: number;
      total_pins_active?: number;
    }>
  ): Promise<number> {
    if (!workspaceId || !records.length) return 0;

    const client = dbClients.getAnalytics();
    const rowsToUpsert = records.map((r) => ({
      ...r,
      workspace_id: workspaceId,
      total_clicks: r.total_clicks ?? 0,
      total_impressions: r.total_impressions ?? 0,
      total_pins_active: r.total_pins_active ?? 1,
    }));

    const { error } = await client.from('url_performance_history').upsert(rowsToUpsert, {
      onConflict: 'workspace_id,destination_url,period_date',
    });

    if (error) throw error;
    return rowsToUpsert.length;
  },

  // ============================================================================
  // Project 3 Query Operations (V11/V12 Locked)
  // ============================================================================

  /**
   * Retrieves account daily metrics within a date range.
   */
  async getAccountDailyMetrics(
    workspaceId: string,
    connectionId: string,
    startDate?: string,
    endDate?: string
  ): Promise<AccountAnalyticsDaily[]> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }

    const client = dbClients.getAnalytics();
    let query = client
      .from('account_analytics_daily')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('connection_id', connectionId)
      .order('metric_date', { ascending: true });

    if (startDate) query = query.gte('metric_date', startDate);
    if (endDate) query = query.lte('metric_date', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return (data as AccountAnalyticsDaily[]) || [];
  },

  /**
   * Retrieves the latest account summary.
   */
  async getAccountSummary(
    workspaceId: string,
    connectionId: string
  ): Promise<AccountAnalyticsSummary | null> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }

    const client = dbClients.getAnalytics();
    const { data, error } = await client
      .from('account_analytics_summaries')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('connection_id', connectionId)
      .order('window_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data as AccountAnalyticsSummary | null;
  },

  /**
   * Retrieves top pins snapshots for a given sort mode.
   */
  async getTopPinsSnapshots(
    workspaceId: string,
    connectionId: string,
    sortBy: PinnerSortBy = 'IMPRESSION',
    limit = 50
  ): Promise<TopPinSnapshot[]> {
    if (!workspaceId || !connectionId) {
      throw new Error('Tenant Boundary Violation: workspaceId and connectionId are required.');
    }

    const client = dbClients.getAnalytics();
    const { data, error } = await client
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
   * Retrieves tenant daily rollup metrics.
   */
  async getWorkspaceDailyMetrics(
    workspaceId: string,
    startDate?: string,
    endDate?: string
  ): Promise<DailyWorkspaceMetric[]> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    const client = dbClients.getAnalytics();
    let query = client
      .from('daily_workspace_metrics')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('metric_date', { ascending: true });

    if (startDate) query = query.gte('metric_date', startDate);
    if (endDate) query = query.lte('metric_date', endDate);

    const { data, error } = await query;
    if (error) throw error;
    return (data as DailyWorkspaceMetric[]) || [];
  },

  /**
   * Legacy getMetricsSummary calculation.
   */
  async getMetricsSummary(workspaceId: string): Promise<MetricSummary> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    const client = dbClients.getAnalytics();
    const { data } = await client
      .from('daily_workspace_metrics')
      .select('total_impressions, total_engagements, total_saves, total_pin_clicks')
      .eq('workspace_id', workspaceId)
      .order('metric_date', { ascending: false })
      .limit(30);

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
  // Project 1 Control Plane Settings & Connection Management (V15)
  // ============================================================================

  /**
   * Retrieves workspace analytics settings.
   */
  async getWorkspaceAnalyticsSettings(
    workspaceId: string
  ): Promise<WorkspaceAnalyticsSettings | null> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    const schedulingAdmin = dbClients.getSchedulingAdmin();
    const { data, error } = await schedulingAdmin
      .from('workspace_analytics_settings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error) throw error;
    return data as WorkspaceAnalyticsSettings | null;
  },

  /**
   * Upserts workspace analytics settings.
   */
  async upsertWorkspaceAnalyticsSettings(
    workspaceId: string,
    settings: Partial<WorkspaceAnalyticsSettings>
  ): Promise<WorkspaceAnalyticsSettings> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    const schedulingAdmin = dbClients.getSchedulingAdmin();
    const payload = {
      ...settings,
      workspace_id: workspaceId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await schedulingAdmin
      .from('workspace_analytics_settings')
      .upsert(payload, { onConflict: 'workspace_id' })
      .select()
      .single();

    if (error) throw error;
    return data as WorkspaceAnalyticsSettings;
  },

  /**
   * Lists active Pinterest connections in a workspace (filtering out soft-deleted).
   */
  async listWorkspaceConnections(workspaceId: string): Promise<PinnerConnection[]> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    const schedulingAdmin = dbClients.getSchedulingAdmin();
    const { data, error } = await schedulingAdmin
      .from('accounts')
      .select('id, workspace_id, account_name, is_active, analytics_enabled, deleted_at, created_at, last_published_at')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as PinnerConnection[]) || [];
  },

  /**
   * Creates a new Pinterest connection in Project 1 accounts.
   */
  async createWorkspaceConnection(
    workspaceId: string,
    accountName: string,
    analyticsEnabled = true
  ): Promise<PinnerConnection> {
    if (!workspaceId || !accountName) {
      throw new Error('Validation Error: workspaceId and accountName are required.');
    }

    const schedulingAdmin = dbClients.getSchedulingAdmin();
    const { data, error } = await schedulingAdmin
      .from('accounts')
      .insert({
        workspace_id: workspaceId,
        account_name: accountName.trim(),
        is_active: true,
        analytics_enabled: analyticsEnabled,
      })
      .select('id, workspace_id, account_name, is_active, analytics_enabled, deleted_at, created_at, last_published_at')
      .single();

    if (error) throw error;
    return data as PinnerConnection;
  },

  /**
   * Updates an existing connection in Project 1 accounts.
   */
  async updateWorkspaceConnection(
    workspaceId: string,
    connectionId: string,
    updates: { account_name?: string; analytics_enabled?: boolean }
  ): Promise<PinnerConnection> {
    if (!workspaceId || !connectionId) {
      throw new Error('Validation Error: workspaceId and connectionId are required.');
    }

    const schedulingAdmin = dbClients.getSchedulingAdmin();
    const updatePayload: Record<string, any> = {};
    if (updates.account_name !== undefined) {
      updatePayload.account_name = updates.account_name.trim();
    }
    if (updates.analytics_enabled !== undefined) {
      updatePayload.analytics_enabled = updates.analytics_enabled;
    }

    const { data, error } = await schedulingAdmin
      .from('accounts')
      .update(updatePayload)
      .eq('id', connectionId)
      .eq('workspace_id', workspaceId)
      .select('id, workspace_id, account_name, is_active, analytics_enabled, deleted_at, created_at, last_published_at')
      .single();

    if (error) throw error;
    return data as PinnerConnection;
  },

  /**
   * Soft-deletes a Pinterest connection in Project 1 accounts.
   */
  async softDeleteWorkspaceConnection(
    workspaceId: string,
    connectionId: string
  ): Promise<boolean> {
    if (!workspaceId || !connectionId) {
      throw new Error('Validation Error: workspaceId and connectionId are required.');
    }

    const schedulingAdmin = dbClients.getSchedulingAdmin();
    const { error } = await schedulingAdmin
      .from('accounts')
      .update({
        is_active: false,
        analytics_enabled: false,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', connectionId)
      .eq('workspace_id', workspaceId);

    if (error) throw error;
    return true;
  },
};
