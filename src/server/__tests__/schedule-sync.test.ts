import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fastcronService } from '../services/fastcron-service';
import { analyticsDb } from '../db/analytics';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    getWorkspaceAnalyticsSettings: vi.fn(),
    getWorkspaceConnection: vi.fn(),
    updateWorkspaceConnection: vi.fn(),
  },
}));

describe('FastCron Per-Connection Schedule Synchronization Suite (V19 & R6)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'a1b2c3d4-e5f6-7890-1234-56789abcdef0';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves FastCron token from DB first, then environment', () => {
    // 1. DB token takes priority
    const resolvedDb = fastcronService.resolveFastCronToken('db_token_1234567890', {
      FASTCRON_API_TOKEN: 'env_token_1234567890',
    });
    expect(resolvedDb).toBe('db_token_1234567890');

    // 2. Env fallback when DB token absent
    const resolvedEnv = fastcronService.resolveFastCronToken(null, {
      FASTCRON_API_TOKEN: 'env_token_1234567890',
    });
    expect(resolvedEnv).toBe('env_token_1234567890');

    // 3. Null when both absent
    const resolvedNone = fastcronService.resolveFastCronToken(null, {
      FASTCRON_API_TOKEN: '',
    });
    expect(resolvedNone).toBeNull();
  });

  it('handles FastCron API creation (cron_add) vs edit (cron_edit) for connection', async () => {
    const fetchCalls: Array<{ url: string; body: any }> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init?: any) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      fetchCalls.push({ url: url.toString(), body });
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'OK', id: 9988, data: { id: 9988 } }),
      } as any;
    }) as any);

    // Initial sync (no existing job id -> cron_add)
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
      analytics_sync_time: '04:00',
      analytics_fastcron_job_id: null,
      top_pins_webhook_url: null,
    });

    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      workspace_id: workspaceId,
      fastcron_token: 'valid_fastcron_token_1234',
    });

    const addResult = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      {}
    );
    expect(addResult.success).toBe(true);
    expect(addResult.schedule_status).toBe('synced');
    expect(addResult.fastcron_job_id).toBe(9988);
    expect(fetchCalls.some((c) => c.url.includes('/cron_add'))).toBe(true);

    // Subsequent sync with existing job id -> cron_get + cron_edit
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
      analytics_sync_time: '05:00',
      analytics_fastcron_job_id: 9988,
    });

    const editResult = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      {}
    );
    expect(editResult.success).toBe(true);
    const editCall = fetchCalls.find((c) => c.url.includes('/cron_edit'));
    expect(editCall).toBeDefined();
    expect(editCall?.body.id).toBe(9988);

    fetchSpy.mockRestore();
  });

  it('sets status to error without crashing if token is missing or API fails', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
      analytics_sync_time: '04:00',
      analytics_fastcron_job_id: null,
    });

    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      workspace_id: workspaceId,
      fastcron_token: null,
    });

    const result = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      { FASTCRON_API_TOKEN: '' }
    );
    expect(result.success).toBe(false);
    expect(result.schedule_status).toBe('error');
    expect(result.error).toContain('FastCron API token not configured');

    expect(analyticsDb.updateWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      expect.objectContaining({
        analytics_schedule_status: 'error',
      })
    );
  });
});
