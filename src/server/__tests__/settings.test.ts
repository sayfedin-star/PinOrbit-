import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET as getSettingsHandler, POST as postSettingsHandler } from '../../pages/api/analytics/settings';
import { GET as getConnSettingsHandler, POST as postConnSettingsHandler } from '../../pages/api/analytics/connections/[id]/settings';
import { fastcronService } from '../services/fastcron-service';
import { analyticsDb } from '../db/analytics';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    getWorkspaceAnalyticsSettings: vi.fn(),
    upsertWorkspaceAnalyticsSettings: vi.fn(),
    getWorkspaceConnection: vi.fn(),
    updateWorkspaceConnection: vi.fn(),
    getLatestFailedRun: vi.fn().mockResolvedValue(null),
    getConnectionHealth: vi.fn().mockResolvedValue({
      total_runs: 10,
      consecutive_failures: 0,
      last_success_at: new Date().toISOString(),
      revoked: false,
    }),
  },
}));

vi.mock('../db/clients', () => ({
  getServerEnv: vi.fn().mockImplementation((runtimeEnv?: any) => ({
    INGEST_SECRET_KEY: 'test_ingest_key',
    FASTCRON_API_TOKEN: runtimeEnv && 'FASTCRON_API_TOKEN' in runtimeEnv ? runtimeEnv.FASTCRON_API_TOKEN : 'default_fastcron_token_12345',
    TOKEN_KEK: 'pinorbit_dev_token_kek_00000000',
  })),
}));

vi.mock('../auth/workspace-guard', () => ({
  assertWorkspaceAccess: vi.fn().mockResolvedValue({
    id: 'mem-1',
    role: 'owner',
    isAdmin: true,
    isOwner: true,
  }),
}));

describe('Pinner Analytics Settings & Security Suite (V20.1 Per-Pipeline Date Offsets)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'a1b2c3d4-e5f6-7890-1234-56789abcdef0';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates Make.com and Integromat webhook domain allowlist', () => {
    expect(fastcronService.validateWebhookUrl('https://hook.make.com/test').valid).toBe(true);
    expect(fastcronService.validateWebhookUrl('https://hook.eu1.make.com/123').valid).toBe(true);
    expect(fastcronService.validateWebhookUrl('https://hook.integromat.com/abc').valid).toBe(true);

    // Insecure HTTP
    expect(fastcronService.validateWebhookUrl('http://hook.make.com/test').valid).toBe(false);
    // Disallowed domain
    expect(fastcronService.validateWebhookUrl('https://evil-site.com/webhook').valid).toBe(false);
    // Invalid URL
    expect(fastcronService.validateWebhookUrl('not-a-url').valid).toBe(false);
  });

  it('converts 24-hour HH:MM time strings to standard cron format', () => {
    expect(fastcronService.parseTimeToCron('04:00').cron).toBe('0 4 * * *');
    expect(fastcronService.parseTimeToCron('04:30').cron).toBe('30 4 * * *');
    expect(fastcronService.parseTimeToCron('18:45').cron).toBe('45 18 * * *');
    expect(fastcronService.parseTimeToCron('25:00').valid).toBe(false);
    expect(fastcronService.parseTimeToCron('invalid').valid).toBe(false);
  });

  it('never serializes raw fastcron_token in GET response (security & masking)', async () => {
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      workspace_id: workspaceId,
      timezone: 'UTC',
      is_sync_enabled: true,
      auto_backfill_on_connect: false,
      fastcron_token: 'secret_raw_token_super_confidential_123',
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await getSettingsHandler({ locals } as any);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.fastcron_token_configured).toBe(true);
    // Verify raw token is NOT in response
    expect((json.data as any).fastcron_token).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('secret_raw_token_super_confidential_123');
  });

  it('V20.2: validates per-pipeline date offset bounds and ordering (equal offsets allowed, inverted rejected with 422)', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_start_offset_days: 7,
      analytics_end_offset_days: 1,
      top_pins_start_offset_days: 7,
      top_pins_end_offset_days: 2,
    });

    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      display_name: 'hymumdotcom',
      analytics_start_offset_days: 5,
      analytics_end_offset_days: 5,
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };

    // 1. Legal same-day range: Pipeline A end offset == start offset (5 == 5)
    const res1 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analytics_start_offset_days: 5,
          analytics_end_offset_days: 5, // equal -> legal (same-day)
        }),
      }),
      locals,
    } as any);
    expect(res1.status).toBe(200);

    // 2. Violation: Pipeline A start offset > 90
    const res2 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analytics_start_offset_days: 95,
        }),
      }),
      locals,
    } as any);
    expect(res2.status).toBe(422);

    // 3. Violation: Pipeline B end offset > start offset (inverted range)
    const res3 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          top_pins_start_offset_days: 3,
          top_pins_end_offset_days: 4, // greater -> invalid
        }),
      }),
      locals,
    } as any);
    expect(res3.status).toBe(422);
  });

  it('V20.1: per-connection settings update resets ONLY the modified pipeline status to pending', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/old',
      analytics_sync_time: '04:00',
      analytics_schedule_status: 'synced',
      analytics_start_offset_days: 7,
      analytics_end_offset_days: 1,
      top_pins_webhook_url: 'https://hook.make.com/toppins',
      top_pins_sync_time: '04:30',
      top_pins_schedule_status: 'synced',
      top_pins_start_offset_days: 7,
      top_pins_end_offset_days: 2,
    });

    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      display_name: 'hymumdotcom',
      analytics_schedule_status: 'pending',
      top_pins_schedule_status: 'synced',
      analytics_start_offset_days: 14,
      analytics_end_offset_days: 2,
    });

    const req = new Request(`http://localhost/api/analytics/connections/${connectionId}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analytics_start_offset_days: 14,
        analytics_end_offset_days: 2,
      }),
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await postConnSettingsHandler({
      params: { id: connectionId },
      request: req,
      locals,
    } as any);

    expect(res.status).toBe(200);
    expect(analyticsDb.updateWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      expect.objectContaining({
        analytics_start_offset_days: 14,
        analytics_end_offset_days: 2,
        analytics_schedule_status: 'pending',
      })
    );
    // Verify top_pins_schedule_status was NOT reset to pending
    const callArgs = (analyticsDb.updateWorkspaceConnection as any).mock.calls[0][2];
    expect(callArgs.top_pins_schedule_status).toBeUndefined();
  });

  it('V23: asserts HTTP 422 for invalid top_pins_num_of_pins, sort_modes, fastcron_timeout, instances, and notify', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      top_pins_num_of_pins: 50,
      top_pins_sort_modes: ['IMPRESSION'],
      fastcron_timeout: 30,
      fastcron_instances: 1,
      fastcron_notify: true,
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };

    // 1. Invalid num_of_pins (< 1)
    const res1 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ top_pins_num_of_pins: 0 }),
      }),
      locals,
    } as any);
    expect(res1.status).toBe(422);

    // 2. Invalid num_of_pins (> 50)
    const res2 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ top_pins_num_of_pins: 51 }),
      }),
      locals,
    } as any);
    expect(res2.status).toBe(422);

    // 3. Empty sort_modes
    const res3 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ top_pins_sort_modes: [] }),
      }),
      locals,
    } as any);
    expect(res3.status).toBe(422);

    // 4. Invalid sort_mode string
    const res4 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ top_pins_sort_modes: ['INVALID_SORT_KEY'] }),
      }),
      locals,
    } as any);
    expect(res4.status).toBe(422);

    // 5. Invalid fastcron_timeout (< 5)
    const res5 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fastcron_timeout: 4 }),
      }),
      locals,
    } as any);
    expect(res5.status).toBe(422);

    // 6. Invalid fastcron_instances (> 5)
    const res6 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fastcron_instances: 6 }),
      }),
      locals,
    } as any);
    expect(res6.status).toBe(422);

    // 7. Invalid fastcron_notify (non-boolean)
    const res7 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fastcron_notify: 'true' }),
      }),
      locals,
    } as any);
    expect(res7.status).toBe(422);

    // 8. R16: Invalid fastcron_token (< 16 chars)
    const res8 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analytics_fastcron_token: 'short_token' }),
      }),
      locals,
    } as any);
    expect(res8.status).toBe(422);
    const json8 = await res8.json();
    expect(json8.error).toContain('FastCron API Token must be at least 16 characters');
  });

  it('R16.3: accepts valid per-connection fastcron_token and GET masks it as has_fastcron_token boolean', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      fastcron_token: 'custom_conn_token_123456789',
    });

    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      display_name: 'hymumdotcom',
      fastcron_token: 'custom_conn_token_123456789',
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };

    // 1. GET response verification
    const getRes = await getConnSettingsHandler({
      params: { id: connectionId },
      locals,
    } as any);
    if (getRes.status !== 200) {
      console.log('GET 500 error:', await getRes.clone().text());
    }
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.success).toBe(true);
    expect(getJson.data.has_fastcron_token).toBe(true);
    // V25 C9: Assert token_fingerprint
    expect(getJson.data.token_fingerprint).toBe('••••6789');
    expect((getJson.data as any).fastcron_token).toBeUndefined();
    expect(JSON.stringify(getJson)).not.toContain('custom_conn_token_123456789');

    // 2. POST update verification
    const postRes = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analytics_fastcron_token: 'custom_conn_token_123456789' }),
      }),
      locals,
    } as any);
    expect(postRes.status).toBe(200);
    expect(analyticsDb.updateWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      expect.objectContaining({ analytics_fastcron_token: expect.stringMatching(/^v1:/) })
    );
  });

  it('R16.3: FastCron token resolution hierarchy: connection -> workspace -> env -> null', async () => {
    const runtimeEnv = { FASTCRON_API_TOKEN: 'env_token_value_123456' };

    // 1. Connection token takes highest priority
    const t1 = await fastcronService.resolveFastCronToken(
      'conn_token_value_123456',
      'workspace_token_value_123456',
      runtimeEnv
    );
    expect(t1).toBe('conn_token_value_123456');

    // 2. Workspace token used if connection token is null/empty
    const t2 = await fastcronService.resolveFastCronToken(
      null,
      'workspace_token_value_123456',
      runtimeEnv
    );
    expect(t2).toBe('workspace_token_value_123456');

    // 3. Env token used if connection & workspace tokens are null
    const t3 = await fastcronService.resolveFastCronToken(null, null, runtimeEnv);
    expect(t3).toBe('env_token_value_123456');

    // 4. Null returned if all are absent or < 16 chars
    const t4 = await fastcronService.resolveFastCronToken('', 'short', { FASTCRON_API_TOKEN: '' });
    expect(t4).toBeNull();
  });

  it('V23: top_pins offset or parameter change resets top_pins_schedule_status to pending', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      top_pins_schedule_status: 'synced',
      top_pins_start_offset_days: 7,
      top_pins_end_offset_days: 2,
    });

    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      top_pins_schedule_status: 'pending',
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          top_pins_start_offset_days: 14,
          top_pins_end_offset_days: 3,
        }),
      }),
      locals,
    } as any);

    expect(res.status).toBe(200);
    expect(analyticsDb.updateWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      expect.objectContaining({
        top_pins_start_offset_days: 14,
        top_pins_end_offset_days: 3,
        top_pins_schedule_status: 'pending',
      })
    );

    // Test num_of_pins change
    await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          top_pins_num_of_pins: 25,
        }),
      }),
      locals,
    } as any);

    expect(analyticsDb.updateWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      expect.objectContaining({
        top_pins_num_of_pins: 25,
        top_pins_schedule_status: 'pending',
      })
    );

    // Test sort_modes change
    await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          top_pins_sort_modes: ['IMPRESSION', 'SAVE'],
        }),
      }),
      locals,
    } as any);

    expect(analyticsDb.updateWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      expect.objectContaining({
        top_pins_sort_modes: ['IMPRESSION', 'SAVE'],
        top_pins_schedule_status: 'pending',
      })
    );
  });

  it('GET returns health object with total_runs, consecutive_failures, last_success_at', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'health-test-conn',
    });
    (analyticsDb.getConnectionHealth as any).mockResolvedValue({
      total_runs: 42,
      consecutive_failures: 1,
      last_success_at: '2026-08-10T12:00:00Z',
      revoked: false,
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await getConnSettingsHandler({
      params: { id: connectionId },
      locals,
    } as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.health).toEqual({
      total_runs: 42,
      consecutive_failures: 1,
      last_success_at: '2026-08-10T12:00:00Z',
      revoked: false,
    });
  });

  it('GET returns token fingerprints (••••XXXX format)', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'token-fingerprint-conn',
      analytics_fastcron_token: '1234567890abcdef',
      top_pins_fastcron_token: 'abcdef1234567890',
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await getConnSettingsHandler({
      params: { id: connectionId },
      locals,
    } as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.has_analytics_fastcron_token).toBe(true);
    expect(json.data.analytics_token_fingerprint).toBe('••••cdef');
    expect(json.data.has_top_pins_fastcron_token).toBe(true);
    expect(json.data.top_pins_token_fingerprint).toBe('••••7890');
  });

  it('POST encrypts token with TOKEN_KEK', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'encrypt-test-conn',
    });
    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'encrypt-test-conn',
      analytics_fastcron_token: 'v1:encrypted:data',
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analytics_fastcron_token: 'valid_custom_token_123456',
        }),
      }),
      locals,
    } as any);

    expect(res.status).toBe(200);
    expect(analyticsDb.updateWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      expect.objectContaining({
        analytics_fastcron_token: expect.stringMatching(/^v1:/),
      })
    );
  });

  it('POST rejects token < 16 chars with 422', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'short-token-conn',
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analytics_fastcron_token: 'short_token_123', // 15 chars (< 16)
        }),
      }),
      locals,
    } as any);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('at least 16 characters');
  });

  it('POST clears token when empty string', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'clear-token-conn',
    });
    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'clear-token-conn',
      analytics_fastcron_token: null,
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analytics_fastcron_token: '',
        }),
      }),
      locals,
    } as any);

    expect(res.status).toBe(200);
    expect(analyticsDb.updateWorkspaceConnection).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      expect.objectContaining({
        analytics_fastcron_token: null,
      })
    );
  });

  it('rejects invalid timezone with 422', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'tz-conn',
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: 'Invalid/Non_Existent_Timezone_12345',
        }),
      }),
      locals,
    } as any);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Invalid timezone');
  });

  it('accepts valid timezone and updates workspace settings', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'tz-conn',
    });
    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'tz-conn',
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: 'America/New_York',
        }),
      }),
      locals,
    } as any);

    expect(res.status).toBe(200);
    expect(analyticsDb.upsertWorkspaceAnalyticsSettings).toHaveBeenCalledWith(
      workspaceId,
      { timezone: 'America/New_York' }
    );
  });
});

