import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as createConnHandler } from '../../pages/api/analytics/connections/index';
import { PATCH as updateConnHandler, DELETE as deleteConnHandler } from '../../pages/api/analytics/connections/[id]';
import { analyticsDb } from '../db/analytics';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    listWorkspaceConnections: vi.fn(),
    createWorkspaceConnection: vi.fn(),
    updateWorkspaceConnection: vi.fn(),
    softDeleteWorkspaceConnection: vi.fn(),
  },
}));

vi.mock('../auth/workspace-guard', () => ({
  assertWorkspaceAccess: vi.fn().mockResolvedValue({
    id: 'mem-1',
    role: 'owner',
    isAdmin: true,
    isOwner: true,
  }),
}));

describe('Pinterest Connection CRUD Suite', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'conn-1234';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an account in Project 1 with analytics_enabled = true', async () => {
    (analyticsDb.createWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      account_name: 'HealthyBites_US',
      is_active: true,
      analytics_enabled: true,
      created_at: new Date().toISOString(),
    });

    const req = new Request('http://localhost/api/analytics/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        account_name: 'HealthyBites_US',
        analytics_enabled: true,
      }),
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await createConnHandler({ request: req, locals } as any);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.connection_id).toBe(connectionId);
    expect(analyticsDb.createWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      'HealthyBites_US',
      true
    );
  });

  it('updates account name and analytics toggle via PATCH', async () => {
    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      account_name: 'HealthyBites_Global',
      is_active: true,
      analytics_enabled: false,
    });

    const req = new Request(`http://localhost/api/analytics/connections/${connectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        account_name: 'HealthyBites_Global',
        analytics_enabled: false,
      }),
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await updateConnHandler({
      params: { id: connectionId },
      request: req,
      locals,
    } as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.account.account_name).toBe('HealthyBites_Global');
    expect(analyticsDb.updateWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      {
        account_name: 'HealthyBites_Global',
        analytics_enabled: false,
      }
    );
  });

  it('soft-deletes account without hard-deleting records', async () => {
    (analyticsDb.softDeleteWorkspaceConnection as any).mockResolvedValue(true);

    const req = new Request(
      `http://localhost/api/analytics/connections/${connectionId}?workspace_id=${workspaceId}`,
      { method: 'DELETE' }
    );

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await deleteConnHandler({
      params: { id: connectionId },
      request: req,
      locals,
    } as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toContain('soft-deleted');
    expect(analyticsDb.softDeleteWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId
    );
  });
});
