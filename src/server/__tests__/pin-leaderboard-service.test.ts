import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyticsDb } from '../db/analytics';
import { dbClients } from '../db/clients';
import { fmtMetric, formatNum, formatPct } from '../../scripts/formatters';

vi.mock('../db/clients', () => ({
  dbClients: {
    getAnalytics: vi.fn(),
    getConfig: vi.fn(),
  },
  getServerEnv: vi.fn().mockReturnValue({}),
}));

describe('Pin Intelligence Leaderboard Engine & Formatters (V36)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'conn-uuid-12345';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Centralized fmtMetric helper', () => {
    it('formats counts and rates as fractions with zero division safety', () => {
      expect(formatNum(15420)).toBe('15,420');
      expect(formatNum(0)).toBe('0');
      expect(formatPct(0.0564)).toBe('5.64%');
      expect(formatPct(0)).toBe('0.00%');

      expect(fmtMetric(580, 0.0376)).toBe('580 (3.76%)');
      expect(fmtMetric(0, 0)).toBe('0 (0.00%)');
      expect(fmtMetric(1200, 0.125)).toBe('1,200 (12.50%)');
    });
  });

  describe('analyticsDb.getPinLeaderboard', () => {
    const mockRpcData = [
      {
        pin_id: 'pin-1',
        title: 'Boho Bedroom Styling',
        image_url: 'https://example.com/1.jpg',
        destination_url: 'https://example.com/decor-1',
        appearances: 10,
        best_rank: 2,
        total_impressions: 10000,
        total_engagements: 500,
        total_saves: 200,
        total_outbound_clicks: 100,
        total_pin_clicks: 400,
        last_seen: '2026-08-10',
        prev_rank: 5,
      },
      {
        pin_id: 'pin-2',
        title: 'Minimal Kitchen Setup',
        image_url: 'https://example.com/2.jpg',
        destination_url: '', // No link
        appearances: 2,
        best_rank: 1,
        total_impressions: 5000,
        total_engagements: 100,
        total_saves: 50,
        total_outbound_clicks: 0,
        total_pin_clicks: 50,
        last_seen: '2026-08-05',
        prev_rank: null,
      },
      {
        pin_id: 'pin-3',
        title: 'Outdoor Garden Plan',
        image_url: 'https://example.com/3.jpg',
        destination_url: 'https://example.com/garden',
        appearances: 6,
        best_rank: 4,
        total_impressions: 800,
        total_engagements: 40,
        total_saves: 10,
        total_outbound_clicks: 5,
        total_pin_clicks: 25,
        last_seen: '2026-08-08',
        prev_rank: 3,
      },
    ];

    it('calculates pooled rates and trend indicators accurately', async () => {
      (dbClients.getAnalytics as any).mockReturnValue({
        rpc: vi.fn().mockResolvedValue({ data: mockRpcData, error: null }),
      });

      const res = await analyticsDb.getPinLeaderboard(
        workspaceId,
        connectionId,
        'IMPRESSION',
        30,
        25,
        null,
        {}
      );

      expect(res.total_unique).toBe(3);
      expect(res.items).toHaveLength(3);

      const pin1 = res.items.find(i => i.pin_id === 'pin-1')!;
      expect(pin1.trend).toBe('▲3'); // prev 5 -> best 2 = ▲3
      expect(pin1.engagement_rate).toBeCloseTo(0.05); // 500/10000
      expect(pin1.outbound_click_rate).toBeCloseTo(0.01); // 100/10000
      expect(pin1.pin_click_rate).toBeCloseTo(0.04); // 400/10000
      expect(pin1.save_rate).toBeCloseTo(0.02); // 200/10000

      const pin2 = res.items.find(i => i.pin_id === 'pin-2')!;
      expect(pin2.trend).toBe('NEW');

      const pin3 = res.items.find(i => i.pin_id === 'pin-3')!;
      expect(pin3.trend).toBe('▼1'); // prev 3 -> best 4 = ▼1
    });

    it('filters by min_impressions, min_appearances, trend, and has_link', async () => {
      (dbClients.getAnalytics as any).mockReturnValue({
        rpc: vi.fn().mockResolvedValue({ data: mockRpcData, error: null }),
      });

      // Filter min_impressions: 1000
      const resImpr = await analyticsDb.getPinLeaderboard(
        workspaceId,
        connectionId,
        'IMPRESSION',
        30,
        25,
        null,
        { min_impressions: 1000 }
      );
      expect(resImpr.total_unique).toBe(2);
      expect(resImpr.items.map(i => i.pin_id)).toEqual(['pin-1', 'pin-2']);

      // Filter min_appearances: 5
      const resApp = await analyticsDb.getPinLeaderboard(
        workspaceId,
        connectionId,
        'IMPRESSION',
        30,
        25,
        null,
        { min_appearances: 5 }
      );
      expect(resApp.total_unique).toBe(2);
      expect(resApp.items.map(i => i.pin_id)).toEqual(['pin-1', 'pin-3']);

      // Filter trend: RISING
      const resRising = await analyticsDb.getPinLeaderboard(
        workspaceId,
        connectionId,
        'IMPRESSION',
        30,
        25,
        null,
        { trend: 'RISING' }
      );
      expect(resRising.total_unique).toBe(1);
      expect(resRising.items[0].pin_id).toBe('pin-1');

      // Filter has_link: true
      const resWithLink = await analyticsDb.getPinLeaderboard(
        workspaceId,
        connectionId,
        'IMPRESSION',
        30,
        25,
        null,
        { has_link: true }
      );
      expect(resWithLink.total_unique).toBe(2);
      expect(resWithLink.items.map(i => i.pin_id)).toEqual(['pin-1', 'pin-3']);
    });

    it('supports sorting and pagination with total_unique and page metadata', async () => {
      (dbClients.getAnalytics as any).mockReturnValue({
        rpc: vi.fn().mockResolvedValue({ data: mockRpcData, error: null }),
      });

      // Sort by best_rank (asc default)
      const resRank = await analyticsDb.getPinLeaderboard(
        workspaceId,
        connectionId,
        'IMPRESSION',
        30,
        25,
        null,
        { sort: 'best_rank' }
      );
      expect(resRank.items.map(i => i.pin_id)).toEqual(['pin-2', 'pin-1', 'pin-3']);

      // Pagination: page 2, page_size 1
      const resPaging = await analyticsDb.getPinLeaderboard(
        workspaceId,
        connectionId,
        'IMPRESSION',
        30,
        1,
        null,
        { page: 2, page_size: 1 }
      );
      expect(resPaging.total_unique).toBe(3);
      expect(resPaging.page).toBe(2);
      expect(resPaging.page_size).toBe(1);
      expect(resPaging.items).toHaveLength(1);
      expect(resPaging.items[0].pin_id).toBe('pin-2');
    });
  });
});
