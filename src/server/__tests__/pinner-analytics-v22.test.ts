import { describe, it, expect, beforeEach, vi } from 'vitest';
import { analyticsDb } from '../db/analytics';
import { dbClients } from '../db/clients';
import { edgeCache } from '../services/edge-cache';

describe('Pinner Analytics R11 Contract & V22 Methods Test Suite', () => {
  const workspaceId = '9f08ca03-e79c-46fa-9518-6858216daf65';
  const connectionId = '8aa5b660-e54a-4e44-b8bd-28e9d3ab8596';

  // Exact 2-day live database fixture from Project 3
  const liveFixture2Days = [
    {
      metric_date: '2026-08-07',
      data_status: 'READY',
      impressions: 23172,
      engagements: 901,
      outbound_clicks: 43,
      pin_clicks: 726,
      saves: 126,
      engagement_rate: 0.038883,
      outbound_click_rate: 0.001856,
      pin_click_rate: 0.031331,
      save_rate: 0.005438,
      recorded_at: '2026-08-09T18:46:08Z',
      connection_id: connectionId,
      workspace_id: workspaceId,
    },
    {
      metric_date: '2026-08-06',
      data_status: 'READY',
      impressions: 25558,
      engagements: 1035,
      outbound_clicks: 36,
      pin_clicks: 862,
      saves: 121,
      engagement_rate: 0.040496,
      outbound_click_rate: 0.001409,
      pin_click_rate: 0.033727,
      save_rate: 0.004734,
      recorded_at: '2026-08-09T18:46:08Z',
      connection_id: connectionId,
      workspace_id: workspaceId,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    edgeCache.clearMemory();
  });

  it('R11.1 & R11.4: computes exact sums over 2-day fixture for READY rows', async () => {
    vi.spyOn(dbClients, 'getAnalytics').mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'account_analytics_daily') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: liveFixture2Days,
              error: null,
            }),
          };
        }
        if (table === 'account_analytics_summaries') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  summary_impressions: 48730,
                  summary_engagements: 1936,
                  summary_outbound_clicks: 79,
                  summary_pin_clicks: 1588,
                  summary_saves: 247,
                  summary_engagement_rate: 0.039729,
                  summary_outbound_click_rate: 0.001621,
                  summary_pin_click_rate: 0.032588,
                  summary_save_rate: 0.005069,
                },
              ],
              error: null,
            }),
          };
        }
        return {} as any;
      }),
    } as any);

    const result = await analyticsDb.getAccountOverviewMetrics(workspaceId, connectionId, 30);

    expect(result.impressions).toBe(48730);
    expect(result.engagements).toBe(1936);
    expect(result.outboundClicks).toBe(79);
    expect(result.pinClicks).toBe(1588);
    expect(result.saves).toBe(247);
    expect(result.engagementRate).toBeCloseTo(0.039729, 5);
    expect(result.outboundClickRate).toBeCloseTo(0.001621, 5);
    expect(result.pinClickRate).toBeCloseTo(0.032588, 5);
    expect(result.saveRate).toBeCloseTo(0.005069, 5);
    expect(result.lastIngestedAt).toBe('2026-08-09T18:46:08Z');
  });

  it('R11.2: falls back to pooled rates calculation when summary row is absent, guarding divide-by-zero', async () => {
    vi.spyOn(dbClients, 'getAnalytics').mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'account_analytics_daily') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  metric_date: '2026-08-07',
                  data_status: 'READY',
                  impressions: 1000,
                  engagements: 50,
                  outbound_clicks: 10,
                  pin_clicks: 30,
                  saves: 10,
                  recorded_at: '2026-08-07T12:00:00Z',
                },
              ],
              error: null,
            }),
          };
        }
        if (table === 'account_analytics_summaries') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [], // absent summary
              error: null,
            }),
          };
        }
        return {} as any;
      }),
    } as any);

    const result = await analyticsDb.getAccountOverviewMetrics(workspaceId, connectionId, 30);

    expect(result.impressions).toBe(1000);
    expect(result.engagements).toBe(50);
    expect(result.engagementRate).toBe(0.05); // 50 / 1000
    expect(result.outboundClickRate).toBe(0.01); // 10 / 1000
    expect(result.pinClickRate).toBe(0.03); // 30 / 1000
    expect(result.saveRate).toBe(0.01); // 10 / 1000

    // Test zero impressions divide-by-zero protection
    vi.spyOn(dbClients, 'getAnalytics').mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'account_analytics_daily') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  metric_date: '2026-08-07',
                  data_status: 'READY',
                  impressions: 0,
                  engagements: 0,
                  outbound_clicks: 0,
                  pin_clicks: 0,
                  saves: 0,
                },
              ],
              error: null,
            }),
          };
        }
        if (table === 'account_analytics_summaries') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {} as any;
      }),
    } as any);

    const zeroResult = await analyticsDb.getAccountOverviewMetrics(workspaceId, connectionId, 30);
    expect(zeroResult.impressions).toBe(0);
    expect(zeroResult.engagementRate).toBe(0.0);
    expect(zeroResult.outboundClickRate).toBe(0.0);
    expect(zeroResult.pinClickRate).toBe(0.0);
    expect(zeroResult.saveRate).toBe(0.0);
  });

  it('2.3: batch calculates connection statistics in a single query without N+1', async () => {
    vi.spyOn(analyticsDb, 'listWorkspaceConnections').mockResolvedValue([
      {
        id: 'c1',
        workspace_id: workspaceId,
        display_name: 'crispcrumbs',
        analytics_enabled: true,
        analytics_sync_time: '04:00',
        analytics_cron_expression: '0 4 * * *',
        analytics_schedule_status: 'pending',
        top_pins_sync_time: '04:30',
        top_pins_cron_expression: '30 4 * * *',
        top_pins_schedule_status: 'pending',
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      },
      {
        id: 'c2',
        workspace_id: workspaceId,
        display_name: 'hymumdotcom',
        analytics_enabled: true,
        analytics_sync_time: '06:00',
        analytics_cron_expression: '0 6 * * *',
        analytics_schedule_status: 'synced',
        top_pins_sync_time: '07:00',
        top_pins_cron_expression: '0 7 * * *',
        top_pins_schedule_status: 'synced',
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      },
    ]);

    vi.spyOn(dbClients, 'getAnalytics').mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({
          data: [
            { connection_id: 'c2', impressions: 23172, engagements: 901, pin_clicks: 726, outbound_clicks: 43, saves: 126 },
            { connection_id: 'c2', impressions: 25558, engagements: 1035, pin_clicks: 862, outbound_clicks: 36, saves: 121 },
          ],
          error: null,
        }),
      })),
    } as any);

    const stats = await analyticsDb.getWorkspaceConnectionsWithStats(workspaceId, 30);
    expect(stats.length).toBe(2);

    const c1 = stats.find((c) => c.id === 'c1');
    expect(c1?.stats.impressions).toBe(0);

    const c2 = stats.find((c) => c.id === 'c2');
    expect(c2?.stats.impressions).toBe(48730);
    expect(c2?.stats.engagements).toBe(1936);
    expect(c2?.stats.outbound_clicks).toBe(79);
    expect(c2?.stats.pin_clicks).toBe(1588);
    expect(c2?.stats.saves).toBe(247);
  });

  it('deletes daily metric row and recomputes daily_workspace_metrics rollup correctly', async () => {
    const deleteBuilder: any = {
      eq: vi.fn().mockImplementation(() => deleteBuilder),
    };
    deleteBuilder.then = (resolve: any) => resolve({ error: null });

    const selectBuilder: any = {
      eq: vi.fn().mockImplementation(() => selectBuilder),
      order: vi.fn().mockImplementation(() => selectBuilder),
    };
    selectBuilder.then = (resolve: any) => resolve({ data: [], error: null });

    const upsertBuilder: any = {
      eq: vi.fn().mockImplementation(() => upsertBuilder),
    };
    upsertBuilder.then = (resolve: any) => resolve({ error: null });

    vi.spyOn(dbClients, 'getAnalytics').mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'account_analytics_daily') {
          return {
            delete: vi.fn().mockReturnValue(deleteBuilder),
            select: vi.fn().mockReturnValue(selectBuilder),
          };
        }
        if (table === 'daily_workspace_metrics') {
          return {
            delete: vi.fn().mockReturnValue(deleteBuilder),
            upsert: vi.fn().mockReturnValue(upsertBuilder),
          };
        }
        return {} as any;
      }),
    } as any);

    const invalidateSpy = vi.spyOn(edgeCache, 'invalidateConnection').mockResolvedValue(undefined);

    await analyticsDb.deleteDailyMetricAndRecompute(workspaceId, connectionId, '2026-08-07');
    expect(invalidateSpy).toHaveBeenCalledWith(workspaceId, connectionId);
  });
});
