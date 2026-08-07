import type { SupabaseClient } from '@supabase/supabase-js';
import { assertWorkspaceAccess } from '../auth/workspace-guard';
import { analyticsDb, type ImportSessionRecord, type MetricSummary } from '../db/analytics';

/**
 * High-level server-only service for Analytics & Reporting.
 * Mandatory Guard: Every method calls assertWorkspaceAccess against Project 1 before touching Project 3.
 */
export const analyticsService = {
  async getImportHistory(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    accountId?: string
  ): Promise<ImportSessionRecord[]> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return analyticsDb.listImportSessions(workspaceId, accountId);
  },

  async recordImport(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    session: Omit<ImportSessionRecord, 'id' | 'created_at'>
  ): Promise<ImportSessionRecord> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return analyticsDb.recordImportSession(workspaceId, session);
  },

  async getPerformanceSummary(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string
  ): Promise<MetricSummary> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return analyticsDb.getMetricsSummary(workspaceId);
  },
};
