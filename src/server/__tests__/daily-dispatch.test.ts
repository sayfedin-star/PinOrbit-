import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../pages/api/internal/pinterest/daily-dispatch';
import { dbClients } from '../db/clients';

vi.mock('../db/clients', async () => {
  const actual = await vi.importActual<any>('../db/clients');
  return {
    ...actual,
    dbClients: {
      getAnalytics: vi.fn(),
    },
  };
});

describe('Daily Dispatch Endpoint Test Suite (F1, X2, X4, X5, X6)', () => {
  const mockConnectionId = 'conn-uuid-12345';
  const mockSecret = 'test_cron_dispatch_secret_998877';

  const mockConnection = {
    id: mockConnectionId,
    workspace_id: 'ws-uuid-0001',
    display_name: 'testconnection',
    analytics_enabled: true,
    deleted_at: null,
    analytics_webhook_url: 'https://hook.make.com/analytics-webhook',
    top_pins_webhook_url: 'https://hook.make.com/top-pins-webhook',
    analytics_start_offset_days: 7,
    analytics_end_offset_days: 1,
    top_pins_start_offset_days: 7,
    top_pins_end_offset_days: 2,
    top_pins_num_of_pins: 50,
    top_pins_sort_modes: ['IMPRESSION', 'OUTBOUND_CLICK', 'SAVE', 'ENGAGEMENT', 'PIN_CLICK'],
  };

  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { ...mockConnection }, error: null }),
    };

    (dbClients.getAnalytics as any).mockReturnValue(mockSupabase);
  });

  it('X2: returns 503 JSON when CRON_DISPATCH_SECRET is not configured in production', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const req = new Request('https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/daily-dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: mockConnectionId, channel: 'account_analytics' }),
    });

    const res = await POST({
      request: req,
      locals: { runtimeEnv: { CRON_DISPATCH_SECRET: '' } },
    } as any);

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('CRON_DISPATCH_SECRET not configured');

    process.env.NODE_ENV = prevEnv;
  });

  it('F1: returns 401 JSON on missing or invalid x-dispatch-secret header', async () => {
    const req = new Request('https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/daily-dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dispatch-secret': 'wrong_secret',
      },
      body: JSON.stringify({ connection_id: mockConnectionId, channel: 'account_analytics' }),
    });

    const res = await POST({
      request: req,
      locals: { runtimeEnv: { CRON_DISPATCH_SECRET: mockSecret } },
    } as any);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Unauthorized');
  });

  it('F1: returns 422 JSON on missing connection_id or channel', async () => {
    const req = new Request('https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/daily-dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dispatch-secret': mockSecret,
      },
      body: JSON.stringify({ connection_id: mockConnectionId }), // missing channel
    });

    const res = await POST({
      request: req,
      locals: { runtimeEnv: { CRON_DISPATCH_SECRET: mockSecret } },
    } as any);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Validation Error');
  });

  it('F1: returns 404 JSON on unknown or deleted connection', async () => {
    mockSupabase.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const req = new Request('https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/daily-dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dispatch-secret': mockSecret,
      },
      body: JSON.stringify({ connection_id: 'non-existent-id', channel: 'account_analytics' }),
    });

    const res = await POST({
      request: req,
      locals: { runtimeEnv: { CRON_DISPATCH_SECRET: mockSecret } },
    } as any);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('not found or has been deleted');
  });

  it('X6: returns 409 JSON when channel webhook URL is missing/empty', async () => {
    mockSupabase.maybeSingle.mockResolvedValueOnce({
      data: { ...mockConnection, analytics_webhook_url: null },
      error: null,
    });

    const req = new Request('https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/daily-dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dispatch-secret': mockSecret,
      },
      body: JSON.stringify({ connection_id: mockConnectionId, channel: 'account_analytics' }),
    });

    const res = await POST({
      request: req,
      locals: { runtimeEnv: { CRON_DISPATCH_SECRET: mockSecret } },
    } as any);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('webhook_not_configured');
  });

  it('X5: normalizes channel alias "analytics" to canonical "account_analytics" and forwards full payload', async () => {
    let capturedWebhookUrl = '';
    let capturedPayload: any = null;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string, init?: any) => {
      capturedWebhookUrl = url;
      capturedPayload = JSON.parse(init.body);
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true }),
      } as any;
    }) as any);

    const req = new Request('https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/daily-dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dispatch-secret': mockSecret,
      },
      body: JSON.stringify({ connection_id: mockConnectionId, channel: 'analytics' }),
    });

    const res = await POST({
      request: req,
      locals: { runtimeEnv: { CRON_DISPATCH_SECRET: mockSecret } },
    } as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    expect(capturedWebhookUrl).toBe(mockConnection.analytics_webhook_url);
    expect(capturedPayload.channel).toBe('account_analytics');
    expect(capturedPayload.job_type).toBe('daily_sync');
    expect(capturedPayload.connection_id).toBe(mockConnectionId);
    expect(capturedPayload.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(capturedPayload.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(capturedPayload.analytics_start_offset_days).toBe(7);
    expect(capturedPayload.analytics_end_offset_days).toBe(1);

    fetchSpy.mockRestore();
  });

  it('X4: honors manual override start_date and end_date when valid (start < end)', async () => {
    let capturedPayload: any = null;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (_url: string, init?: any) => {
      capturedPayload = JSON.parse(init.body);
      return { status: 200, ok: true, json: async () => ({ success: true }) } as any;
    }) as any);

    const req = new Request('https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/daily-dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dispatch-secret': mockSecret,
      },
      body: JSON.stringify({
        connection_id: mockConnectionId,
        channel: 'top_pins',
        start_date: '2026-08-01',
        end_date: '2026-08-08',
      }),
    });

    const res = await POST({
      request: req,
      locals: { runtimeEnv: { CRON_DISPATCH_SECRET: mockSecret } },
    } as any);

    expect(res.status).toBe(200);
    expect(capturedPayload.start_date).toBe('2026-08-01');
    expect(capturedPayload.end_date).toBe('2026-08-08');
    expect(capturedPayload.channel).toBe('top_pins');
    expect(capturedPayload.num_of_pins).toBe(50);
    expect(capturedPayload.sort_modes).toEqual(['IMPRESSION', 'OUTBOUND_CLICK', 'SAVE', 'ENGAGEMENT', 'PIN_CLICK']);

    fetchSpy.mockRestore();
  });

  it('X4: returns 422 JSON when manual override dates are reversed or malformed', async () => {
    const req = new Request('https://pinorbit-v2.o-i.workers.dev/api/internal/pinterest/daily-dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dispatch-secret': mockSecret,
      },
      body: JSON.stringify({
        connection_id: mockConnectionId,
        channel: 'top_pins',
        start_date: '2026-08-10',
        end_date: '2026-08-01', // reversed
      }),
    });

    const res = await POST({
      request: req,
      locals: { runtimeEnv: { CRON_DISPATCH_SECRET: mockSecret } },
    } as any);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('start_date must be strictly before end_date');
  });
});
