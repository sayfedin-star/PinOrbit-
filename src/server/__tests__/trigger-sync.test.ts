import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fastcronService } from '../services/fastcron-service';
import { analyticsDb } from '../db/analytics';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    getWorkspaceConnection: vi.fn(),
    getWorkspaceAnalyticsSettings: vi.fn(),
  },
}));

describe('Manual Trigger & Test Ping Sync Suite (V19 Safe Lifecycle & cron_run)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'a1b2c3d4-e5f6-7890-1234-56789abcdef0';
  const mockRuntimeEnv = { FASTCRON_API_TOKEN: 'valid_fastcron_token_12345' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('B6: Triggers FastCron cron_run when job ID and token exist', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
      analytics_fastcron_job_id: 8899,
    });
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      fastcron_token: 'db_token_1234567890',
    });

    let capturedUrl = '';
    let capturedBody: any = null;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body);
      return {
        status: 200,
        ok: true,
        json: async () => ({ status: 'OK' }),
      } as any;
    }) as any);

    const result = await fastcronService.triggerManualSync(
      workspaceId,
      connectionId,
      'analytics',
      'sync',
      mockRuntimeEnv
    );

    expect(result.success).toBe(true);
    expect(capturedUrl).toContain('/cron_run');
    expect(capturedBody.id).toBe(8899);
    expect(capturedBody.payload).toBeDefined();

    const innerPayload = JSON.parse(capturedBody.payload);
    expect(innerPayload.job_type).toBe('manual_sync');
    expect(innerPayload.channel).toBe('account_analytics');
    expect(innerPayload.connection_id).toBe(connectionId);
    expect(innerPayload.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(innerPayload.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    fetchSpy.mockRestore();
  });

  it('B6: Falls back gracefully to legacy direct POST when job ID is not configured', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
      analytics_fastcron_job_id: null,
    });
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      fastcron_token: null,
    });

    let sentPayload: any = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init: any) => {
      expect(url).toBe('https://hook.make.com/pipeline-a');
      sentPayload = JSON.parse(init.body);
      return { ok: true, status: 200 } as any;
    }) as any);

    const result = await fastcronService.triggerManualSync(
      workspaceId,
      connectionId,
      'analytics',
      'sync',
      mockRuntimeEnv
    );

    expect(result.success).toBe(true);
    expect(sentPayload).toBeDefined();
    expect(sentPayload.job_type).toBe('manual_sync');
    expect(sentPayload.channel).toBe('account_analytics');
    expect(sentPayload.connection_id).toBe(connectionId);
    expect(sentPayload.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sentPayload.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

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
      'ping',
      mockRuntimeEnv
    );

    expect(result.success).toBe(true);
    expect(sentPayload.job_type).toBe('ping');
    expect(sentPayload.channel).toBe('account_analytics');
    expect(sentPayload.connection_id).toBe(connectionId);

    fetchSpy.mockRestore();
  });
});
