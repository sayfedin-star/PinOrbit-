import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fastcronService } from '../services/fastcron-service';
import { analyticsDb } from '../db/analytics';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    getWorkspaceConnection: vi.fn(),
  },
}));

describe('Manual Trigger & Test Ping Sync Suite (V17 Standalone)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'a1b2c3d4-e5f6-7890-1234-56789abcdef0';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats Channel A (Account Analytics) manual sync payload with concrete dates', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
    });

    let sentPayload: any = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string, init: any) => {
      sentPayload = JSON.parse(init.body);
      return { ok: true, status: 200 } as any;
    }) as any);

    const result = await fastcronService.triggerManualSync(
      workspaceId,
      connectionId,
      'analytics',
      'sync'
    );

    expect(result.success).toBe(true);
    expect(sentPayload).toBeDefined();
    expect(sentPayload.job_type).toBe('manual_sync');
    expect(sentPayload.channel).toBe('account_analytics');
    expect(sentPayload.connection_id).toBe(connectionId);
    expect(sentPayload.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sentPayload.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sentPayload.sort_modes).toBeUndefined();

    fetchSpy.mockRestore();
  });

  it('formats Test Ping payload correctly when mode is ping', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
    });

    let sentPayload: any = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string, init: any) => {
      sentPayload = JSON.parse(init.body);
      return { ok: true, status: 200 } as any;
    }) as any);

    const result = await fastcronService.triggerManualSync(
      workspaceId,
      connectionId,
      'analytics',
      'ping'
    );

    expect(result.success).toBe(true);
    expect(sentPayload.job_type).toBe('ping');
    expect(sentPayload.channel).toBe('account_analytics');
    expect(sentPayload.connection_id).toBe(connectionId);

    fetchSpy.mockRestore();
  });
});
