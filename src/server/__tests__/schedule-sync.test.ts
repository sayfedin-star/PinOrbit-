import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fastcronService } from '../services/fastcron-service';
import { analyticsDb } from '../db/analytics';
import { dbClients } from '../db/clients';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    getWorkspaceAnalyticsSettings: vi.fn(),
    upsertWorkspaceAnalyticsSettings: vi.fn(),
  },
}));

vi.mock('../db/clients', () => ({
  dbClients: {
    getConfig: vi.fn().mockReturnValue({
      FASTCRON_API_TOKEN: '',
    }),
  },
}));

describe('FastCron Schedule Synchronization Suite', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves FastCron token from DB first, then environment', () => {
    // 1. DB token takes priority
    (dbClients.getConfig as any).mockReturnValue({ FASTCRON_API_TOKEN: 'env_token_1234567890' });
    const resolvedDb = fastcronService.resolveFastCronToken('db_token_1234567890');
    expect(resolvedDb).toBe('db_token_1234567890');

    // 2. Env fallback when DB token absent
    const resolvedEnv = fastcronService.resolveFastCronToken(null);
    expect(resolvedEnv).toBe('env_token_1234567890');

    // 3. Null when both absent
    (dbClients.getConfig as any).mockReturnValue({ FASTCRON_API_TOKEN: '' });
    const resolvedNone = fastcronService.resolveFastCronToken(null);
    expect(resolvedNone).toBeNull();
  });

  it('handles FastCron API creation (cron_add) vs edit (cron_edit)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
      return {
        ok: true,
        json: async () => ({ status: 'OK', id: 'fc_job_9988' }),
      } as any;
    }) as any);

    // Initial sync (no existing job id -> cron_add)
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      workspace_id: workspaceId,
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
      analytics_sync_time: '04:00',
      fastcron_token: 'valid_fastcron_token_1234',
      analytics_fastcron_job_id: null,
    });

    const addResult = await fastcronService.syncScheduleWithFastCron(workspaceId, 'analytics');
    expect(addResult.success).toBe(true);
    expect(addResult.schedule_status).toBe('synced');
    expect(addResult.fastcron_job_id).toBe('fc_job_9988');
    expect(fetchSpy.mock.calls[0][0].toString()).toContain('/cron_add');

    // Subsequent sync with existing job id -> cron_edit
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      workspace_id: workspaceId,
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
      analytics_sync_time: '05:00',
      fastcron_token: 'valid_fastcron_token_1234',
      analytics_fastcron_job_id: 'fc_job_9988',
    });

    const editResult = await fastcronService.syncScheduleWithFastCron(workspaceId, 'analytics');
    expect(editResult.success).toBe(true);
    expect(fetchSpy.mock.calls[1][0].toString()).toContain('/cron_edit');
    expect(fetchSpy.mock.calls[1][0].toString()).toContain('id=fc_job_9988');

    fetchSpy.mockRestore();
  });

  it('sets status to error without crashing if token is missing or API fails', async () => {
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      workspace_id: workspaceId,
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
      analytics_sync_time: '04:00',
      fastcron_token: null,
      analytics_fastcron_job_id: null,
    });
    (dbClients.getConfig as any).mockReturnValue({ FASTCRON_API_TOKEN: '' });

    const result = await fastcronService.syncScheduleWithFastCron(workspaceId, 'analytics');
    expect(result.success).toBe(false);
    expect(result.schedule_status).toBe('error');
    expect(result.error).toContain('FastCron API token not configured');

    expect(analyticsDb.upsertWorkspaceAnalyticsSettings).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        analytics_schedule_status: 'error',
      })
    );
  });
});
