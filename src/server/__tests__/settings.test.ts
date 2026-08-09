import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET as getSettingsHandler, POST as postSettingsHandler } from '../../pages/api/analytics/settings';
import { POST as postConnSettingsHandler } from '../../pages/api/analytics/connections/[id]/settings';
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

describe('Pinner Analytics Settings & Security Suite (V16)', () => {
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

  it('per-connection settings update resets channel schedule status to pending when URL or time changes', async () => {
    (analyticsDb.getWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      workspace_id: workspaceId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/old',
      analytics_sync_time: '04:00',
      analytics_schedule_status: 'synced',
    });

    (analyticsDb.updateWorkspaceConnection as any).mockResolvedValue({
      id: connectionId,
      display_name: 'hymumdotcom',
      analytics_webhook_url: 'https://hook.make.com/new',
      analytics_sync_time: '05:00',
      analytics_cron_expression: '0 5 * * *',
      analytics_schedule_status: 'pending',
    });

    const req = new Request(`http://localhost/api/analytics/connections/${connectionId}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analytics_webhook_url: 'https://hook.make.com/new',
        analytics_sync_time: '05:00',
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
        analytics_webhook_url: 'https://hook.make.com/new',
        analytics_schedule_status: 'pending',
      })
    );
  });
});
