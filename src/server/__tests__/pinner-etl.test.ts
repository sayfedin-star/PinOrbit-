import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pinnerETL } from '../services/pinner-etl';
import { analyticsDb } from '../db/analytics';
import { dbClients } from '../db/clients';
import type { PinnerIngestPayload } from '../../lib/types';

// Mock DB layer
vi.mock('../db/analytics', () => ({
  analyticsDb: {
    createIngestionRun: vi.fn().mockResolvedValue({ id: 'mock-run-id' }),
    completeIngestionRun: vi.fn().mockResolvedValue(undefined),
    failIngestionRun: vi.fn().mockResolvedValue(undefined),
    checkConsecutiveFailures: vi.fn().mockResolvedValue(false),
    upsertAccountDailyMetrics: vi.fn().mockResolvedValue(2),
    upsertAccountSummary: vi.fn().mockResolvedValue(undefined),
    upsertTopPinsSnapshots: vi.fn().mockResolvedValue(5),
    upsertDailyWorkspaceMetrics: vi.fn().mockResolvedValue(2),
    upsertUrlPerformance: vi.fn().mockResolvedValue(1),
    updateConnectionLastSync: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../db/clients', () => ({
  dbClients: {
    getConfig: vi.fn().mockReturnValue({
      INGEST_SECRET_KEY: 'test-ingest-secret',
      SNITCH_WEBHOOK_URL: 'https://webhook.site/test-snitch',
    }),
    getAnalytics: vi.fn().mockReturnValue({
      from: vi.fn((table: string) => ({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => ({
          data: {
            id: 'a1b2c3d4-e5f6-7890-1234-56789abcdef0',
            workspace_id: '00000000-0000-0000-0000-000000000001',
            analytics_enabled: true,
          },
          error: null,
        })),
      })),
    }),
  },
}));

describe('Pinner Analytics ETL Processor Suite', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'a1b2c3d4-e5f6-7890-1234-56789abcdef0';

  beforeEach(() => {
    vi.clearAllMocks();
    pinnerETL.resetFailureStreak(workspaceId);
  });

  // Real Pinterest API v5 sample response
  const samplePinterestDailyAnalytics = {
    all: {
      summary_metrics: {
        IMPRESSION: 72586,
        ENGAGEMENT: 2911,
        ENGAGEMENT_RATE: 0.04010415231587358,
        OUTBOUND_CLICK: 139,
        OUTBOUND_CLICK_RATE: 0.001914969828892624,
        PIN_CLICK: 2366,
        PIN_CLICK_RATE: 0.03259581737525143,
        SAVE: 406,
        SAVE_RATE: 0.005593365111729535,
        TOTAL_COMMENTS: 1,
        TOTAL_REACTIONS: 3,
        VIDEO_AVG_WATCH_TIME: 0,
        VIDEO_MRC_VIEW: 0,
        VIDEO_V50_WATCH_TIME: 0,
      },
      daily_metrics: [
        {
          data_status: 'READY',
          date: '2026-08-01',
          metrics: {
            IMPRESSION: 10000,
            ENGAGEMENT: 400,
            ENGAGEMENT_RATE: 0.04,
            OUTBOUND_CLICK: 20,
            OUTBOUND_CLICK_RATE: 0.002,
            PIN_CLICK: 300,
            PIN_CLICK_RATE: 0.03,
            SAVE: 80,
            SAVE_RATE: 0.008,
          },
        },
        {
          data_status: 'READY',
          date: '2026-08-02',
          metrics: {
            IMPRESSION: 12000,
            ENGAGEMENT: 500,
            ENGAGEMENT_RATE: 0.0416,
            OUTBOUND_CLICK: 25,
            OUTBOUND_CLICK_RATE: 0.002,
            PIN_CLICK: 350,
            PIN_CLICK_RATE: 0.029,
            SAVE: 100,
            SAVE_RATE: 0.0083,
          },
        },
      ],
    },
  };

  const samplePinterestTopPins = {
    sort_by: 'IMPRESSION' as const,
    pins_by_sort_mode: {
      IMPRESSION: [
        {
          pin_id: '10485011674598527',
          title: 'Creamy Lemon Pasta',
          image_url: 'https://i.pinimg.com/236x/test1.jpg',
          destination_url: 'https://example.com/pasta',
          data_status: 'READY',
          metrics: {
            IMPRESSION: 4172,
            ENGAGEMENT: 121,
            ENGAGEMENT_RATE: 0.029,
            OUTBOUND_CLICK: 5,
            OUTBOUND_CLICK_RATE: 0.0012,
            PIN_CLICK: 98,
            PIN_CLICK_RATE: 0.0235,
            SAVE: 18,
            SAVE_RATE: 0.0043,
          },
        },
        {
          pin_id: '10485011674598528',
          title: 'Crispy Smashed Potatoes',
          image_url: 'https://i.pinimg.com/236x/test2.jpg',
          destination_url: 'https://example.com/potatoes',
          data_status: 'READY',
          metrics: {
            IMPRESSION: 3500,
            ENGAGEMENT: 95,
            ENGAGEMENT_RATE: 0.0271,
            OUTBOUND_CLICK: 3,
            OUTBOUND_CLICK_RATE: 0.0008,
            PIN_CLICK: 75,
            PIN_CLICK_RATE: 0.0214,
            SAVE: 17,
            SAVE_RATE: 0.0048,
          },
        },
      ],
      SAVE: [
        {
          pin_id: '10485011674598528',
          title: 'Crispy Smashed Potatoes',
          image_url: 'https://i.pinimg.com/236x/test2.jpg',
          destination_url: 'https://example.com/potatoes',
          data_status: 'READY',
          metrics: {
            IMPRESSION: 3500,
            ENGAGEMENT: 95,
            SAVE: 17,
          },
        },
      ],
    },
  };

  it('processes valid normalized Make.com payload and persists to Project 3', async () => {
    const payload: PinnerIngestPayload = {
      success: true,
      workspace_id: workspaceId,
      connection_id: connectionId,
      request_context: {
        start_date: '2026-08-01',
        end_date: '2026-08-08',
        job_type: 'daily_sync',
      },
      account_analytics: samplePinterestDailyAnalytics,
      top_pins_analytics: samplePinterestTopPins,
      raw_headers: {
        'x-ratelimit-limit': '60, 100;w=1;name="safety_net"',
        'x-ratelimit-remaining': '58',
        'x-ratelimit-reset': '50',
      },
    };

    const result = await pinnerETL.processIngestionPayload(payload);

    expect(result.success).toBe(true);
    expect(result.persisted).toBe(true);
    expect(result.revoked).toBe(false);

    // Verify Project 3 Ingestion Run created & completed
    expect(analyticsDb.createIngestionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: workspaceId,
        connection_id: connectionId,
        channel: 'account_analytics',
        job_type: 'daily_sync',
      })
    );
    expect(analyticsDb.completeIngestionRun).toHaveBeenCalledWith(
      'mock-run-id',
      expect.any(Number)
    );

    // Verify Project 3 Account Daily upsert
    expect(analyticsDb.upsertAccountDailyMetrics).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      expect.arrayContaining([
        expect.objectContaining({
          metric_date: '2026-08-01',
          impressions: 10000,
          engagements: 400,
          engagement_rate: 0.04,
          data_status: 'READY',
        }),
      ])
    );

    // Verify Project 3 Top Pins derivation: rank_position = index + 1
    expect(analyticsDb.upsertTopPinsSnapshots).toHaveBeenCalledWith(
      workspaceId,
      connectionId,
      expect.arrayContaining([
        expect.objectContaining({
          pin_id: '10485011674598527',
          rank_position: 1, // Derived from index 0 + 1
          sort_by: 'IMPRESSION',
          impressions: 4172,
        }),
        expect.objectContaining({
          pin_id: '10485011674598528',
          rank_position: 2, // Derived from index 1 + 1
          sort_by: 'IMPRESSION',
          impressions: 3500,
        }),
        expect.objectContaining({
          pin_id: '10485011674598528',
          rank_position: 1, // Derived from index 0 + 1 for SAVE sort mode
          sort_by: 'SAVE',
          impressions: 3500,
        }),
      ])
    );

    // Verify URL performance tracked
    expect(analyticsDb.upsertUrlPerformance).toHaveBeenCalledWith(
      workspaceId,
      expect.arrayContaining([
        expect.objectContaining({
          destination_url: 'https://example.com/pasta',
          total_impressions: 4172,
        }),
      ])
    );

    // Verify workspace rollups updated
    expect(analyticsDb.upsertDailyWorkspaceMetrics).toHaveBeenCalled();
  });

  it('handles 401 Unauthorized by deactivating account in Project 3', async () => {
    const payload: PinnerIngestPayload = {
      success: false,
      workspace_id: workspaceId,
      connection_id: connectionId,
      request_context: { job_type: 'daily_sync' },
      error_details: {
        http_status: 401,
        error_code: 'UNAUTHORIZED',
        error_message: 'The OAuth token is expired or was revoked',
      },
    };

    const result = await pinnerETL.processIngestionPayload(payload);

    expect(result.success).toBe(false);
    expect(result.persisted).toBe(false);
    expect(result.revoked).toBe(true);

    expect(analyticsDb.failIngestionRun).toHaveBeenCalledWith(
      'mock-run-id',
      expect.objectContaining({ http_status: 401 })
    );
  });

  it('triggers Dead Mans Snitch alert on 2+ consecutive failures', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      return { ok: true, status: 200 } as any;
    }) as any);

    const failurePayload: PinnerIngestPayload = {
      success: false,
      workspace_id: workspaceId,
      connection_id: connectionId,
      request_context: { job_type: 'daily_sync' },
      error_details: {
        http_status: 500,
        error_code: 'INTERNAL_SERVER_ERROR',
        error_message: 'Pinterest internal error',
      },
    };

    // Failure 1 -> No snitch yet
    const r1 = await pinnerETL.processIngestionPayload(failurePayload);
    expect(r1.snitchAlerted).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Failure 2 -> Triggers Snitch
    const r2 = await pinnerETL.processIngestionPayload(failurePayload);
    expect(r2.snitchAlerted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://webhook.site/test-snitch',
      expect.objectContaining({ method: 'POST' })
    );

    fetchSpy.mockRestore();
  });

  it('processes Account Analytics-only payload without top_pins_analytics', async () => {
    const payload: PinnerIngestPayload = {
      success: true,
      channel: 'account_analytics',
      workspace_id: workspaceId,
      connection_id: connectionId,
      request_context: {
        start_date: '2026-08-01',
        end_date: '2026-08-08',
        job_type: 'daily_sync',
      },
      account_analytics: samplePinterestDailyAnalytics,
      top_pins_analytics: null, // Null top pins
    };

    const result = await pinnerETL.processIngestionPayload(payload);
    expect(result.success).toBe(true);
    expect(result.persisted).toBe(true);
    expect(analyticsDb.upsertAccountDailyMetrics).toHaveBeenCalled();
    expect(analyticsDb.upsertTopPinsSnapshots).not.toHaveBeenCalled();
  });

  it('processes Top Pins-only payload without account_analytics', async () => {
    const payload: PinnerIngestPayload = {
      success: true,
      channel: 'top_pins',
      workspace_id: workspaceId,
      connection_id: connectionId,
      request_context: {
        start_date: '2026-08-01',
        end_date: '2026-08-08',
        job_type: 'daily_sync',
      },
      account_analytics: null, // Null account analytics
      top_pins_analytics: samplePinterestTopPins,
    };

    const result = await pinnerETL.processIngestionPayload(payload);
    expect(result.success).toBe(true);
    expect(result.persisted).toBe(true);
    expect(analyticsDb.upsertAccountDailyMetrics).not.toHaveBeenCalled();
    expect(analyticsDb.upsertTopPinsSnapshots).toHaveBeenCalled();
  });

  it('rejects payload when connection_id is not registered in Project 3 analytics_connections', async () => {
    // Override maybeSingle to simulate missing connection
    (dbClients.getAnalytics as any).mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    });

    const payload: PinnerIngestPayload = {
      success: true,
      workspace_id: workspaceId,
      connection_id: 'unknown-conn-id',
      account_analytics: samplePinterestDailyAnalytics,
    };

    const result = await pinnerETL.processIngestionPayload(payload);
    expect(result.success).toBe(false);
    expect(result.persisted).toBe(false);
    expect(result.error).toContain('is not registered in Project 3 analytics_connections');
  });
});
