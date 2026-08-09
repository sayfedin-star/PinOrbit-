import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET, POST } from '../../pages/api/analytics/settings';
import { fastcronService } from '../services/fastcron-service';
import { analyticsDb } from '../db/analytics';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    getWorkspaceAnalyticsSettings: vi.fn(),
    upsertWorkspaceAnalyticsSettings: vi.fn(),
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

describe('Pinner Analytics Settings & Security Suite', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';

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
      analytics_webhook_url: 'https://hook.make.com/analytics',
      top_pins_webhook_url: 'https://hook.make.com/top_pins',
      analytics_sync_time: '04:00',
      top_pins_sync_time: '04:30',
      timezone: 'UTC',
      analytics_enabled: true,
      top_pins_enabled: true,
      auto_backfill_on_connect: false,
      fastcron_token: 'secret_raw_token_super_confidential_123',
      analytics_schedule_status: 'synced',
      top_pins_schedule_status: 'synced',
    });

    const req = new Request(`http://localhost/api/analytics/settings?workspace_id=${workspaceId}`);
    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };

    const res = await GET({ request: req, locals } as any);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.has_fastcron_token).toBe(true);
    expect(json.data.fastcron_token_masked).toBe('••••••••');
    // Verify raw token is NOT in response
    expect((json.data as any).fastcron_token).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('secret_raw_token_super_confidential_123');
  });

  it('keeps existing token when submitting empty string in POST', async () => {
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      workspace_id: workspaceId,
      fastcron_token: 'existing_token_1234567890',
      analytics_sync_time: '04:00',
      top_pins_sync_time: '04:30',
      timezone: 'UTC',
    });

    (analyticsDb.upsertWorkspaceAnalyticsSettings as any).mockResolvedValue({
      workspace_id: workspaceId,
      fastcron_token: 'existing_token_1234567890',
      analytics_sync_time: '04:00',
      top_pins_sync_time: '04:30',
      timezone: 'UTC',
      analytics_enabled: true,
      top_pins_enabled: true,
      auto_backfill_on_connect: false,
      analytics_schedule_status: 'pending',
      top_pins_schedule_status: 'pending',
    });

    const req = new Request('http://localhost/api/analytics/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        fastcron_token: '', // Empty string submitted
        analytics_webhook_url: 'https://hook.make.com/test',
      }),
    });

    const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
    const res = await POST({ request: req, locals } as any);
    expect(res.status).toBe(200);

    // Verify upsert received existing token rather than empty string
    expect(analyticsDb.upsertWorkspaceAnalyticsSettings).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        fastcron_token: 'existing_token_1234567890',
      })
    );
  });
});
