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

describe('FastCron Full Service Suite (R6 Reconcile Idempotency & Orphan Cleanup)', () => {
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

  it('R6.4: Idempotent 3x consecutive sync calls verify existing jobs with cron_get and purge orphan duplicates', async () => {
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      fastcron_token: 'db_token_1234567890',
    });

    // Mock in-memory connection state
    const mockConn: any = {
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
      top_pins_webhook_url: 'https://hook.make.com/pipeline-b',
      analytics_sync_time: '04:00',
      top_pins_sync_time: '04:30',
      analytics_schedule_status: 'pending',
      top_pins_schedule_status: 'pending',
      analytics_fastcron_job_id: null,
      top_pins_fastcron_job_id: null,
      analytics_start_offset_days: 7,
      analytics_end_offset_days: 1,
      top_pins_start_offset_days: 7,
      top_pins_end_offset_days: 2,
    };

    (analyticsDb.getWorkspaceConnection as any).mockImplementation(async () => ({ ...mockConn }));
    (analyticsDb.updateWorkspaceConnection as any).mockImplementation(async (_wsId: string, _connId: string, updates: any) => {
      Object.assign(mockConn, updates);
      return { ...mockConn };
    });

    // Simulated FastCron server job table
    let fastcronJobs: Array<{ id: number; name: string; url: string; expression: string }> = [];
    let nextJobId = 1001;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init?: any) => {
      const endpoint = url.split('/').pop()?.split('?')[0];
      const body = init?.body ? JSON.parse(init.body) : {};

      if (endpoint === 'cron_batch_add') {
        const id1 = nextJobId++;
        const id2 = nextJobId++;
        fastcronJobs.push({ id: id1, name: body.data[0].name, url: body.data[0].url, expression: body.data[0].expression });
        fastcronJobs.push({ id: id2, name: body.data[1].name, url: body.data[1].url, expression: body.data[1].expression });
        return {
          status: 200,
          ok: true,
          json: async () => ({ status: 'OK', ids: [id1, id2] }),
        } as any;
      }

      if (endpoint === 'cron_add') {
        const id = nextJobId++;
        fastcronJobs.push({ id, name: body.name, url: body.url, expression: body.expression });
        return {
          status: 200,
          ok: true,
          json: async () => ({ status: 'OK', id }),
        } as any;
      }

      if (endpoint === 'cron_get') {
        const job = fastcronJobs.find((j) => j.id === body.id);
        if (job) {
          return { status: 200, ok: true, json: async () => ({ status: 'OK', data: job }) } as any;
        } else {
          return { status: 404, ok: false, json: async () => ({ status: 'error', message: 'Job not found' }) } as any;
        }
      }

      if (endpoint === 'cron_edit') {
        const job = fastcronJobs.find((j) => j.id === body.id);
        if (job) {
          job.expression = body.expression;
          job.url = body.url;
        }
        return { status: 200, ok: true, json: async () => ({ status: 'OK' }) } as any;
      }

      if (endpoint === 'cron_list') {
        return {
          status: 200,
          ok: true,
          json: async () => ({ status: 'OK', jobs: [...fastcronJobs] }),
        } as any;
      }

      if (endpoint === 'cron_delete') {
        fastcronJobs = fastcronJobs.filter((j) => j.id !== body.id);
        return { status: 200, ok: true, json: async () => ({ status: 'OK' }) } as any;
      }

      return { status: 200, ok: true, json: async () => ({ status: 'OK' }) } as any;
    }) as any);

    // ==========================================
    // Sync Click 1 (Creation: batch add)
    // ==========================================
    const res1 = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      mockRuntimeEnv
    );
    expect(res1.success).toBe(true);
    expect(mockConn.analytics_fastcron_job_id).toBe(1001);
    expect(mockConn.top_pins_fastcron_job_id).toBe(1002);
    expect(fastcronJobs.length).toBe(2);

    // Simulate an orphan duplicate injected in FastCron by an external or legacy event
    fastcronJobs.push({ id: 9999, name: 'Orphan Pipeline A duplicate', url: 'https://hook.make.com/pipeline-a', expression: '0 4 * * *' });
    expect(fastcronJobs.length).toBe(3);

    // ==========================================
    // Sync Click 2 (Reconcile & Orphan Cleanup)
    // ==========================================
    const res2 = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      mockRuntimeEnv
    );
    expect(res2.success).toBe(true);
    expect(mockConn.analytics_fastcron_job_id).toBe(1001);
    // Verified: orphan job 9999 was cleaned up via cron_delete!
    expect(fastcronJobs.find((j) => j.id === 9999)).toBeUndefined();
    expect(fastcronJobs.length).toBe(2);

    // ==========================================
    // Sync Click 3 (Idempotent: Re-verify & Edit only)
    // ==========================================
    const res3 = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      mockRuntimeEnv
    );
    expect(res3.success).toBe(true);
    expect(mockConn.analytics_fastcron_job_id).toBe(1001);
    expect(mockConn.top_pins_fastcron_job_id).toBe(1002);
    expect(mockConn.analytics_schedule_status).toBe('synced');
    expect(fastcronJobs.length).toBe(2);

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
