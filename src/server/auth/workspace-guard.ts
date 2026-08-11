import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/http-error';

export interface WorkspaceMembership {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

export interface WorkspaceContext {
  workspaceId: string;
  role: string;
  isOwner: boolean;
  isAdmin: boolean;
}

/**
 * Mandatory security gatekeeper for multi-project operations.
 * Validates that the authenticated user belongs to the requested workspace in Project 1.
 * Throws or returns an authorization error if validation fails.
 */
export async function assertWorkspaceAccess(
  schedulingClient: SupabaseClient,
  workspaceId: string,
  userId: string
): Promise<WorkspaceContext> {
  if (!workspaceId || !userId) {
    throw new HttpError(401, 'Unauthorized: missing workspace or user identifier.');
  }

  const { data, error } = await schedulingClient
    .from('workspace_memberships')
    .select('id, workspace_id, user_id, role, created_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new HttpError(403, `Forbidden: User ${userId} is not a member of workspace ${workspaceId}.`);
  }

  return {
    workspaceId: data.workspace_id,
    role: data.role,
    isOwner: data.role === 'owner',
    isAdmin: data.role === 'admin' || data.role === 'owner',
  };
}

/**
 * Lists all active workspaces for an authenticated user.
 */
export async function getUserWorkspaces(
  schedulingClient: SupabaseClient,
  userId: string
): Promise<Array<{ id: string; name: string; slug: string | null; role: string }>> {
  const { data, error } = await schedulingClient
    .from('workspace_memberships')
    .select('workspace_id, role, workspaces(id, name, slug)')
    .eq('user_id', userId);

  if (error || !data) {
    return [];
  }

  return data
    .filter((item: any) => item.workspaces)
    .map((item: any) => ({
      id: item.workspaces.id,
      name: item.workspaces.name,
      slug: item.workspaces.slug,
      role: item.role,
    }));
}
