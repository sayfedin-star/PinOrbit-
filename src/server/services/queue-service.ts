import type { SupabaseClient } from '@supabase/supabase-js';
import { assertWorkspaceAccess } from '../auth/workspace-guard';
import { schedulingDb, type PinRecord, type AccountRecord } from '../db/scheduling';

/**
 * Service for operational pin queue management and scheduling execution.
 */
export const queueService = {
  async getQueueStatus(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    options?: { accountId?: string; status?: string; limit?: number; offset?: number }
  ): Promise<{ pins: PinRecord[]; count: number }> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return schedulingDb.getPins(schedulingClient, workspaceId, userId, options);
  },

  async schedulePin(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    pinData: Omit<PinRecord, 'id' | 'workspace_id' | 'created_at' | 'updated_at' | 'attempts' | 'last_error_code' | 'last_error_message' | 'processing_started_at' | 'posted_at'>
  ): Promise<PinRecord> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return schedulingDb.createPin(schedulingClient, workspaceId, userId, pinData);
  },

  async cancelPin(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    pinId: string
  ): Promise<PinRecord> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return schedulingDb.updatePinStatus(schedulingClient, workspaceId, userId, pinId, {
      status: 'cancelled',
    });
  },

  async retryPin(
    schedulingClient: SupabaseClient,
    userId: string,
    workspaceId: string,
    pinId: string
  ): Promise<PinRecord> {
    await assertWorkspaceAccess(schedulingClient, workspaceId, userId);
    return schedulingDb.updatePinStatus(schedulingClient, workspaceId, userId, pinId, {
      status: 'pending',
      last_error_code: null,
      last_error_message: null,
    });
  },
};
