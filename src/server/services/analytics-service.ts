import type { SupabaseClient } from '@supabase/supabase-js';
import { assertWorkspaceAccess } from '../auth/workspace-guard';
import { analyticsDb, type MetricSummary } from '../db/analytics';
import type { AnalyticsIngestionRun } from '../../lib/types';

/**
 * High-level server-only service for Analytics & Reporting.
 * Mandatory Guard: Every method calls assertWorkspaceAccess against Project 1 session before querying Project 3.
 */
export const analyticsService = {
  async getImportHistory(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    connectionId?: string
  ): Promise<AnalyticsIngestionRun[]> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return analyticsDb.listIngestionRuns(workspaceId, connectionId);
  },

  async getPerformanceSummary(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string
  ): Promise<MetricSummary> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return analyticsDb.getMetricSummary(workspaceId);
  },
};
