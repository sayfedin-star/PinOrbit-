import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fastcronService, FASTCRON_BASE } from '../services/fastcron-service';
import { analyticsDb } from '../db/analytics';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    getWorkspaceAnalyticsSettings: vi.fn(),
    getWorkspaceConnection: vi.fn(),
    updateWorkspaceConnection: vi.fn(),
    listWorkspaceConnections: vi.fn(),
  },
}));

describe('FastCron Full Service Suite (V19 Strict Directive A1 & B6)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'conn-uuid-12345';
  const mockRuntimeEnv = { FASTCRON_API_TOKEN: 'valid_env_fastcron_token_12345' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('A1: Asserts FastCron base URL is exactly https://www.fastcron.com/api/v1', () => {
    expect(FASTCRON_BASE).toBe('https://www.fastcron.com/api/v1');
  });

  it('A1: fastcronCall performs POST JSON primary, falling back to GET on 404/405', async () => {
    let callIndex = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init?: any) => {
      callIndex++;
      if (callIndex === 1) {
        // First call: POST returns 405 Method Not Allowed
        expect(init?.method).toBe('POST');
        expect(url).toBe('https://www.fastcron.com/api/v1/cron_test');
        return {
          status: 405,
          ok: false,
          json: async () => ({ error: 'Method Not Allowed' }),
        } as any;
      } else {
        // Second call: GET fallback
        expect(init?.method).toBe('GET');
        expect(url).toContain('https://www.fastcron.com/api/v1/cron_test?');
        expect(url).toContain('token=test_token');
        return {
          status: 200,
          ok: true,
          json: async () => ({ status: 'OK', id: 5566 }),
        } as any;
      }
    }) as any);

    const result = await fastcronService.fastcronCall(
      'cron_test',
      { sample_param: 'value123' },
      'test_token'
    );

    expect(result.success).toBe(true);
    expect(result.data.id).toBe(5566);
    expect(callIndex).toBe(2);

    fetchSpy.mockRestore();
  });

  it('A1: fastcronCall surfaces FastCron error messages verbatim to caller', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      return {
        status: 200,
        ok: true,
        json: async () => ({ status: 'error', message: 'FastCron quota exceeded for user tier.' }),
      } as any;
    }) as any);

    const result = await fastcronService.fastcronCall(
      'cron_add',
      { name: 'test' },
      'test_token'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('FastCron quota exceeded for user tier.');

    fetchSpy.mockRestore();
  });

  it('B6: syncScheduleWithFastCron handles cron_add vs cron_edit vs batch_add matrix', async () => {
    let capturedUrl = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
      capturedUrl = url;
      return {
        status: 200,
        ok: true,
        json: async () => ({ status: 'OK', id: 7788 }),
      } as any;
    }) as any);

    // 1. Initial sync (both missing -> cron_batch_add when top_pins webhook also configured)
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'test_pinner',
      analytics_webhook_url: 'https://hook.make.com/analytics',
      top_pins_webhook_url: 'https://hook.make.com/toppins',
      analytics_sync_time: '04:00',
      top_pins_sync_time: '04:30',
      analytics_fastcron_job_id: null,
      top_pins_fastcron_job_id: null,
    });
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      fastcron_token: 'db_token_1234567890',
    });

    const batchAddRes = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      mockRuntimeEnv
    );
    expect(batchAddRes.success).toBe(true);
    expect(capturedUrl).toContain('/cron_batch_add');

    // 2. Edit existing job -> cron_edit
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'test_pinner',
      analytics_webhook_url: 'https://hook.make.com/analytics',
      analytics_sync_time: '05:00',
      analytics_fastcron_job_id: 7788,
    });

    const editRes = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      mockRuntimeEnv
    );
    expect(editRes.success).toBe(true);
    expect(capturedUrl).toContain('/cron_edit');

    fetchSpy.mockRestore();
  });

  it('B6: disableFastCronJob and enableFastCronJob use cron_disable and cron_enable', async () => {
    let capturedAction = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
      capturedAction = url;
      return {
        status: 200,
        ok: true,
        json: async () => ({ status: 'OK' }),
      } as any;
    }) as any);

    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      fastcron_token: 'db_token_1234567890',
    });

    // Disable
    const disableOk = await fastcronService.disableFastCronJob(workspaceId, 9900, mockRuntimeEnv);
    expect(disableOk).toBe(true);
    expect(capturedAction).toContain('/cron_disable');

    // Enable
    const enableOk = await fastcronService.enableFastCronJob(workspaceId, 9900, mockRuntimeEnv);
    expect(enableOk).toBe(true);
    expect(capturedAction).toContain('/cron_enable');

    fetchSpy.mockRestore();
  });

  it('B6: getCronLogs queries cron_logs endpoint and returns log entries', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
      expect(url).toContain('/cron_logs');
      return {
        status: 200,
        ok: true,
        json: async () => ({
          status: 'OK',
          logs: [
            { date: '2026-08-09 04:00:00', http_status: 200, output: 'OK 7 rows' },
          ],
        }),
      } as any;
    }) as any);

    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      fastcron_token: 'db_token_1234567890',
    });

    const logRes = await fastcronService.getCronLogs(workspaceId, 9900, mockRuntimeEnv);
    expect(logRes.success).toBe(true);
    expect(logRes.logs?.length).toBe(1);
    expect(logRes.logs?.[0].http_status).toBe(200);

    fetchSpy.mockRestore();
  });
});
