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

describe('FastCron Full Service Suite (V20.1 Strict Directive A1, B6, Hotfix 3 POST Mandatory & Date Offsets)', () => {
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

  it('F1, F2, F4, V20.1: syncScheduleWithFastCron asserts httpMethod === "POST" and carries per-pipeline offsets in postData', async () => {
    let capturedCalls: Array<{ url: string; body: any }> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init?: any) => {
      capturedCalls.push({
        url,
        body: init?.body ? JSON.parse(init.body) : null,
      });
      return {
        status: 200,
        ok: true,
        json: async () => ({ status: 'OK', id: 7788 }),
      } as any;
    }) as any);

    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      fastcron_token: 'db_token_1234567890',
    });

    // 1. Single cron_add (when only one webhook is configured)
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'test_pinner',
      analytics_webhook_url: 'https://hook.make.com/analytics',
      top_pins_webhook_url: null,
      analytics_sync_time: '04:00',
      analytics_start_offset_days: 14,
      analytics_end_offset_days: 3,
      analytics_fastcron_job_id: null,
      top_pins_fastcron_job_id: null,
    });

    const addRes = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      mockRuntimeEnv
    );
    expect(addRes.success).toBe(true);

    const addCall = capturedCalls[0];
    expect(addCall.url).toContain('/cron_add');
    expect(addCall.body.httpMethod).toBe('POST');
    expect(addCall.body.httpHeaders).toBe('Content-Type: application/json');
    expect(addCall.body.postData).toBeDefined();

    const addPostData = JSON.parse(addCall.body.postData);
    expect(addPostData.analytics_start_offset_days).toBe(14);
    expect(addPostData.analytics_end_offset_days).toBe(3);

    // 2. cron_batch_add (both missing and both webhooks configured)
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'test_pinner',
      analytics_webhook_url: 'https://hook.make.com/analytics',
      top_pins_webhook_url: 'https://hook.make.com/toppins',
      analytics_sync_time: '04:00',
      top_pins_sync_time: '04:30',
      analytics_start_offset_days: 7,
      analytics_end_offset_days: 1,
      top_pins_start_offset_days: 10,
      top_pins_end_offset_days: 2,
      analytics_fastcron_job_id: null,
      top_pins_fastcron_job_id: null,
    });

    const batchAddRes = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      mockRuntimeEnv
    );
    expect(batchAddRes.success).toBe(true);

    const batchCall = capturedCalls[1];
    expect(batchCall.url).toContain('/cron_batch_add');
    const batchItems = batchCall.body.data || batchCall.body.jobs;
    expect(Array.isArray(batchItems)).toBe(true);
    expect(batchItems.length).toBe(2);

    const batchItemA = JSON.parse(batchItems[0].postData);
    expect(batchItemA.channel).toBe('account_analytics');
    expect(batchItemA.analytics_start_offset_days).toBe(7);
    expect(batchItemA.analytics_end_offset_days).toBe(1);

    const batchItemB = JSON.parse(batchItems[1].postData);
    expect(batchItemB.channel).toBe('top_pins');
    expect(batchItemB.top_pins_start_offset_days).toBe(10);
    expect(batchItemB.top_pins_end_offset_days).toBe(2);

    for (const item of batchItems) {
      expect(item.httpMethod).toBe('POST');
      expect(item.httpHeaders).toBe('Content-Type: application/json');
    }

    // 3. cron_edit (existing job id -> converts / ensures POST + offset propagation)
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'test_pinner',
      analytics_webhook_url: 'https://hook.make.com/analytics',
      analytics_sync_time: '05:00',
      analytics_start_offset_days: 21,
      analytics_end_offset_days: 4,
      analytics_fastcron_job_id: 7788,
    });

    const editRes = await fastcronService.syncScheduleWithFastCron(
      workspaceId,
      connectionId,
      'analytics',
      mockRuntimeEnv
    );
    expect(editRes.success).toBe(true);

    const editCall = capturedCalls[2];
    expect(editCall.url).toContain('/cron_edit');
    expect(editCall.body.id).toBe(7788);
    expect(editCall.body.httpMethod).toBe('POST');
    expect(editCall.body.httpHeaders).toBe('Content-Type: application/json');
    const editPostData = JSON.parse(editCall.body.postData);
    expect(editPostData.analytics_start_offset_days).toBe(21);
    expect(editPostData.analytics_end_offset_days).toBe(4);

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
