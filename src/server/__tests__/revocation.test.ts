import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pinnerETL } from '../services/pinner-etl';
import { analyticsDb } from '../db/analytics';
import { dbClients } from '../db/clients';
import { PATCH as updateConnHandler } from '../../pages/api/analytics/connections/[id]';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    createIngestionRun: vi.fn().mockResolvedValue({ id: 'run-rev-1' }),
    failIngestionRun: vi.fn().mockResolvedValue(undefined),
    checkConsecutiveFailures: vi.fn().mockResolvedValue(false),
    getWorkspaceConnection: vi.fn(),
    updateWorkspaceConnection: vi.fn(),
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

describe('Project 3 Self-Contained Revocation & Re-enable Suite (V17)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'a1b2c3d4-e5f6-7890-1234-56789abcdef0';

  let mockUpdateFn: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateFn = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    vi.spyOn(dbClients, 'getAnalytics').mockReturnValue({
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => ({
          data: {
            id: connectionId,
            workspace_id: workspaceId,
            analytics_enabled: true,
          },
          error: null,
        })),
        update: mockUpdateFn,
      })),
    } as any);
  });

  it('sets analytics_enabled=false and revoked_at on 401 Unauthorized inside Project 3', async () => {
    const payload = {
      success: false,
      channel: 'account_analytics',
      workspace_id: workspaceId,
      connection_id: connectionId,
      error_details: {
        http_status: 401,
        error_code: 'UNAUTHORIZED',
        error_message: 'The OAuth token is expired or was revoked',
      },
    };

    const result = await pinnerETL.processIngestionPayload(payload as any);

    expect(result.success).toBe(false);
    expect(result.revoked).toBe(true);

    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        analytics_enabled: false,
        revoked_at: expect.any(String),
      })
    );
  });

  it('re-enabling a connection via PATCH clears revoked_at to null', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_enabled: false,
      revoked_at: '2026-08-08T00:00:00Z',
    });

    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_enabled: true,
      revoked_at: null,
    });

    const req = new Request(`http://localhost/api/analytics/connections/${connectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analytics_enabled: true,
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
    expect(json.connection.analytics_enabled).toBe(true);
    expect(json.connection.revoked_at).toBeNull();
  });
});
