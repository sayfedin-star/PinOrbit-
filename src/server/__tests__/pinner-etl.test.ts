import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pinnerETL } from '../services/pinner-etl';
import { analyticsDb } from '../db/analytics';
import { dbClients } from '../db/clients';
import type { PinnerIngestPayload } from '../../lib/types';

// Mock DB layer
vi.mock('../db/analytics', () => ({
  analyticsDb: {
    recordOperationalImportSession: vi.fn().mockResolvedValue({ id: 'mock-import-id' }),
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
    getSchedulingAdmin: vi.fn().mockReturnValue({
      from: vi.fn((table: string) => ({
        update: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      })),
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
        PIN_CLICK_RATE: 0.032595817375251426,
        SAVE: 404,
        SAVE_RATE: 0.005565811589011655,
        VIDEO_10S_VIEW: 12,
        VIDEO_AVG_WATCH_TIME: 4.521,
        VIDEO_MRC_VIEW: 8,
        VIDEO_START: 20,
        VIDEO_V50_WATCH_TIME: 2.311,
        QUARTILE_95_PERCENT_VIEW: 5,
      },
      daily_metrics: [
        {
          date: '2026-08-01',
          data_status: 'READY',
          metrics: {
            IMPRESSION: 10000,
            ENGAGEMENT: 400,
            ENGAGEMENT_RATE: 0.04,
            OUTBOUND_CLICK: 20,
            OUTBOUND_CLICK_RATE: 0.002,
            PIN_CLICK: 300,
            PIN_CLICK_RATE: 0.03,
            SAVE: 50,
            SAVE_RATE: 0.005,
            VIDEO_10S_VIEW: 2,
            VIDEO_AVG_WATCH_TIME: 3.1,
            VIDEO_MRC_VIEW: 1,
            VIDEO_START: 5,
            VIDEO_V50_WATCH_TIME: 1.5,
            QUARTILE_95_PERCENT_VIEW: 1,
          },
        },
        {
          date: '2026-08-02',
          data_status: 'PROCESSING', // Non-READY day
          metrics: {
            IMPRESSION: 5000,
            ENGAGEMENT: 200,
            ENGAGEMENT_RATE: 0.04,
            OUTBOUND_CLICK: 10,
            OUTBOUND_CLICK_RATE: 0.002,
            PIN_CLICK: 150,
            PIN_CLICK_RATE: 0.03,
            SAVE: 25,
            SAVE_RATE: 0.005,
          },
        },
      ],
    },
  };

  const samplePinterestTopPins = {
    IMPRESSION: {
      sort_by: 'IMPRESSION',
      pins: [
        {
          pin_id: '10485011674598527',
          title: 'Creamy Tuscan Garlic Chicken Recipe',
          destination_url: 'https://pinorbit.com/recipes/tuscan-chicken',
          image_url: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d',
          metrics: {
            IMPRESSION: 4172,
            ENGAGEMENT: 151,
            ENGAGEMENT_RATE: 0.036193672099712366,
            OUTBOUND_CLICK: 18,
            OUTBOUND_CLICK_RATE: 0.004314477468839885,
            PIN_CLICK: 120,
            PIN_CLICK_RATE: 0.028763183125599233,
            SAVE: 23,
            SAVE_RATE: 0.00551294343240652,
          },
          data_status: {
            IMPRESSION: 'READY',
            ENGAGEMENT: 'READY',
          },
        },
        {
          pin_id: '10485011674598528',
          title: 'Easy Homemade Pizza Dough',
          destination_url: 'https://pinorbit.com/recipes/pizza-dough',
          metrics: {
            IMPRESSION: 3200,
            ENGAGEMENT: 95,
            ENGAGEMENT_RATE: 0.0296875,
            OUTBOUND_CLICK: 12,
            OUTBOUND_CLICK_RATE: 0.00375,
            PIN_CLICK: 75,
            PIN_CLICK_RATE: 0.0234375,
            SAVE: 15,
            SAVE_RATE: 0.0046875,
          },
          data_status: {
            IMPRESSION: 'READY',
          },
        },
      ],
      date_availability: {
        is_realtime: false,
        latest_available_timestamp: 1786060799000,
      },
    },
  };

  it('processes valid normalized Make.com payload and persists to Project 3 and Project 1', async () => {
    const payload: PinnerIngestPayload = {
      success: true,
      request_id: 'test-run-001',
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

    // Verify Project 1 operational session recorded
    expect(analyticsDb.recordOperationalImportSession).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        account_id: connectionId,
        source_type: 'pinterest_full_sync',
        status: 'completed',
      })
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
          impressions: 3200,
        }),
      ])
    );

    // Verify Derived Workspace Metrics Rollup filters out non-READY days
    expect(analyticsDb.upsertDailyWorkspaceMetrics).toHaveBeenCalledWith(
      workspaceId,
      expect.arrayContaining([
        expect.objectContaining({
          metric_date: '2026-08-01',
          total_impressions: 10000, // Includes 2026-08-01 because data_status = 'READY'
        }),
      ])
    );
  });

  it('handles 401 Unauthorized by deactivating account in Project 1', async () => {
    const payload: PinnerIngestPayload = {
      success: false,
      workspace_id: workspaceId,
      connection_id: connectionId,
      error_details: {
        http_status: 401,
        error_code: 'UNAUTHORIZED',
        error_message: 'Pinterest authorization failed or token revoked',
        failed_module: 'Pinterest: Make an API Call',
      },
    };

    const result = await pinnerETL.processIngestionPayload(payload);

    expect(result.success).toBe(false);
    expect(result.persisted).toBe(false);
    expect(result.revoked).toBe(true);

    // Verify Project 1 operational failure session
    expect(analyticsDb.recordOperationalImportSession).toHaveBeenCalledWith(
      workspaceId,
      expect.objectContaining({
        account_id: connectionId,
        status: 'failed',
      })
    );

    // Failure streak is incremented to 1
    expect(pinnerETL.getFailureStreak(workspaceId)).toBe(1);
  });

  it('triggers Dead Mans Snitch alert on 2+ consecutive failures', async () => {
    const snitchSpy = vi.spyOn(pinnerETL, 'triggerDeadManSnitch').mockResolvedValue(true);

    const payload: PinnerIngestPayload = {
      success: false,
      workspace_id: workspaceId,
      connection_id: connectionId,
      error_details: {
        http_status: 500,
        error_code: 'API_ERROR',
        error_message: 'Pinterest API gateway error',
      },
    };

    // First failure
    await pinnerETL.processIngestionPayload(payload);
    expect(snitchSpy).not.toHaveBeenCalled();
    expect(pinnerETL.getFailureStreak(workspaceId)).toBe(1);

    // Second consecutive failure
    const secondResult = await pinnerETL.processIngestionPayload(payload);
    expect(pinnerETL.getFailureStreak(workspaceId)).toBe(2);
    expect(snitchSpy).toHaveBeenCalledWith(workspaceId, connectionId, 2, payload.error_details);
    expect(secondResult.snitchAlerted).toBe(true);
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
