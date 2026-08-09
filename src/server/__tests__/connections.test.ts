import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as createConnHandler, GET as listConnHandler } from '../../pages/api/analytics/connections/index';
import { PATCH as updateConnHandler, DELETE as deleteConnHandler } from '../../pages/api/analytics/connections/[id]';
import { analyticsDb } from '../db/analytics';
import { fastcronService } from '../services/fastcron-service';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    listWorkspaceConnections: vi.fn(),
    getWorkspaceConnection: vi.fn(),
    createWorkspaceConnection: vi.fn(),
    updateWorkspaceConnection: vi.fn(),
    softDeleteWorkspaceConnection: vi.fn(),
  },
}));

vi.mock('../services/fastcron-service', () => ({
  fastcronService: {
    disableFastCronJob: vi.fn().mockResolvedValue(true),
    enableFastCronJob: vi.fn().mockResolvedValue(true),
    deleteFastCronJob: vi.fn().mockResolvedValue(true),
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

describe('Pinterest Connection CRUD Suite (V16 Project 3 Ownership)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'a1b2c3d4-e5f6-7890-1234-56789abcdef0';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an account in Project 3 analytics_connections with server-resolved workspace', async () => {
    (analyticsDb.createWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_enabled: true,
      created_at: new Date().toISOString(),
    });

    const req = new Request('http://localhost/api/analytics/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: 'hymumdotcom',
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
      'hymumdotcom',
      true
    );
  });

  it('updates connection display_name and analytics toggle via PATCH', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_enabled: true,
    });

    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymum_global',
      analytics_enabled: false,
    });

    const req = new Request(`http://localhost/api/analytics/connections/${connectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: 'hymum_global',
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
    expect(json.connection.display_name).toBe('hymum_global');
  });

  it('returns 404 when attempting to PATCH or DELETE a connection belonging to another workspace', async () => {
    // getWorkspaceConnection returns null for cross-workspace attempt
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue(null);

    const req = new Request(`http://localhost/api/analytics/connections/${connectionId}`, {
      method: 'DELETE',
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await deleteConnHandler({
      params: { id: connectionId },
      request: req,
      locals,
    } as any);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Connection not found in this workspace');
  });

  it('soft-deletes connection and disables associated FastCron jobs', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_fastcron_job_id: 1122,
      top_pins_fastcron_job_id: 3344,
    });

    (analyticsDb.softDeleteWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      deleted_at: new Date().toISOString(),
    });

    const req = new Request(`http://localhost/api/analytics/connections/${connectionId}`, {
      method: 'DELETE',
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId, runtime: { env: {} } };
    const res = await deleteConnHandler({
      params: { id: connectionId },
      request: req,
      locals,
    } as any);

    expect(res.status).toBe(200);
    expect(fastcronService.disableFastCronJob).toHaveBeenCalledWith(workspaceId, 1122, expect.anything());
    expect(fastcronService.disableFastCronJob).toHaveBeenCalledWith(workspaceId, 3344, expect.anything());
    expect(analyticsDb.softDeleteWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId
    );
  });

  it('POST /api/analytics/connections succeeds with canonical cookie + owner membership', async () => {
    (analyticsDb.createWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_enabled: true,
      created_at: new Date().toISOString(),
    });

    const req = new Request('http://localhost/api/analytics/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: 'hymumdotcom',
      }),
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await createConnHandler({ request: req, locals } as any);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.connection_id).toBe(connectionId);
  });

  it('POST returns 403 (not 400) when membership missing or unauthorized', async () => {
    const { assertWorkspaceAccess } = await import('../auth/workspace-guard');
    (assertWorkspaceAccess as any).mockRejectedValueOnce(
      new Error('Forbidden: User attacker is not a member of workspace ws-unauthorized.')
    );

    const req = new Request('http://localhost/api/analytics/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: 'hymumdotcom',
      }),
    });

    const locals = { user: { id: 'attacker' }, supabase: {}, activeWorkspaceId: 'ws-unauthorized' };
    const res = await createConnHandler({ request: req, locals } as any);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Forbidden');
  });
});
