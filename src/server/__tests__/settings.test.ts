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
  },
}));

vi.mock('../db/clients', () => ({
  getServerEnv: vi.fn().mockReturnValue({
    INGEST_SECRET_KEY: 'test_ingest_key',
    FASTCRON_API_TOKEN: 'default_fastcron_token_12345',
  }),
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

  it('V20.1: validates per-pipeline date offset bounds and ordering with 422 errors', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_start_offset_days: 7,
      analytics_end_offset_days: 1,
      top_pins_start_offset_days: 7,
      top_pins_end_offset_days: 2,
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };

    // 1. Violation: Pipeline A end offset >= start offset
    const res1 = await postConnSettingsHandler({
      params: { id: connectionId },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analytics_start_offset_days: 5,
          analytics_end_offset_days: 5, // equal -> invalid
        }),
      }),
      locals,
    } as any);
    expect(res1.status).toBe(422);

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

    // 3. Violation: Pipeline B end offset >= start offset
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
  });
});

