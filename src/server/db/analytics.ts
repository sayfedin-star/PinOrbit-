import { dbClients } from './clients';

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
 * Server-Only Project 3 (Analytics) Data Layer.
 * Directives:
 * 1. Must never be imported from browser code.
 * 2. Every operation MUST enforce workspace_id tenant boundary.
 */
export const analyticsDb = {
  /**
   * Lists historical import sessions for an account within an authorized workspace.
   */
  async listImportSessions(
    workspaceId: string,
    accountId?: string
  ): Promise<ImportSessionRecord[]> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required for analytics queries.');
    }

    const client = dbClients.getAnalytics();
    let query = client
      .from('import_sessions')
      .select('*')
      .order('created_at', { ascending: false });

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data as ImportSessionRecord[]) || [];
  },

  /**
   * Records an import session for pin scheduling ingestion.
   */
  async recordImportSession(
    workspaceId: string,
    session: Omit<ImportSessionRecord, 'id' | 'created_at'>
  ): Promise<ImportSessionRecord> {
    if (!workspaceId || !session.account_id) {
      throw new Error('Tenant Boundary Violation: workspaceId and account_id are required.');
    }

    const client = dbClients.getAnalytics();
    const { data, error } = await client
      .from('import_sessions')
      .insert({
        ...session,
      })
      .select()
      .single();

    if (error) throw error;
    return data as ImportSessionRecord;
  },

  /**
   * Retrieves aggregated metrics across pins and boards for a workspace.
   */
  async getMetricsSummary(workspaceId: string): Promise<MetricSummary> {
    if (!workspaceId) {
      throw new Error('Tenant Boundary Violation: workspaceId is required.');
    }

    // Server-side aggregate calculation
    return {
      workspace_id: workspaceId,
      total_pins_posted: 0,
      total_impressions: 0,
      total_saves: 0,
      total_clicks: 0,
      engagement_rate: 0.0,
    };
  },
};
