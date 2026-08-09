import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fastcronService } from '../services/fastcron-service';
import { analyticsDb } from '../db/analytics';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    getWorkspaceAnalyticsSettings: vi.fn(),
    recordOperationalImportSession: vi.fn().mockResolvedValue({ id: 'import-1' }),
  },
}));

describe('Manual Trigger Sync Suite', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'a1b2c3d4-e5f6-7890-1234-56789abcdef0';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats Channel A (Account Analytics) manual payload without sort_modes and with concrete dates', async () => {
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      workspace_id: workspaceId,
      analytics_webhook_url: 'https://hook.make.com/pipeline-a',
    });

    let sentPayload: any = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string, init: any) => {
      sentPayload = JSON.parse(init.body);
      return { ok: true, status: 200 } as any;
    }) as any);

    const result = await fastcronService.triggerManualSync(workspaceId, 'analytics', connectionId);

    expect(result.success).toBe(true);
    expect(sentPayload).toBeDefined();
    expect(sentPayload.job_type).toBe('manual_sync');
    expect(sentPayload.channel).toBe('account_analytics');
    expect(sentPayload.workspace_id).toBe(workspaceId);
    expect(sentPayload.connection_id).toBe(connectionId);
    expect(sentPayload.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sentPayload.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sentPayload.sort_modes).toBeUndefined();

    // Verify operational import session logged
    expect(analyticsDb.recordOperationalImportSession).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        account_id: connectionId,
        source_type: 'manual_analytics',
      })
    );

    fetchSpy.mockRestore();
  });

  it('formats Channel B (Top Pins) manual payload with all 5 sort modes', async () => {
    (analyticsDb.getWorkspaceAnalyticsSettings as any).mockResolvedValue({
      workspace_id: workspaceId,
      top_pins_webhook_url: 'https://hook.make.com/pipeline-b',
    });

    let sentPayload: any = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string, init: any) => {
      sentPayload = JSON.parse(init.body);
      return { ok: true, status: 200 } as any;
    }) as any);

    const result = await fastcronService.triggerManualSync(workspaceId, 'top_pins', connectionId);

    expect(result.success).toBe(true);
    expect(sentPayload).toBeDefined();
    expect(sentPayload.job_type).toBe('manual_sync');
    expect(sentPayload.channel).toBe('top_pins');
    expect(sentPayload.sort_modes).toEqual([
      'IMPRESSION',
      'OUTBOUND_CLICK',
      'SAVE',
      'ENGAGEMENT',
      'PIN_CLICK',
    ]);

    // Verify operational import session logged
    expect(analyticsDb.recordOperationalImportSession).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        account_id: connectionId,
        source_type: 'manual_top_pins',
      })
    );

    fetchSpy.mockRestore();
  });
});
