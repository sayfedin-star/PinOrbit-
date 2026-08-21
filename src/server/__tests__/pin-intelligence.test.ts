import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET as getLeaderboardHandler } from '../../pages/api/analytics/connections/[id]/pin-leaderboard';
import { GET as getTrendsHandler } from '../../pages/api/analytics/connections/[id]/pin-trends';
import { POST as postRetentionHandler } from '../../pages/api/internal/pinterest/cleanup-retention';
import { analyticsDb } from '../db/analytics';
import { dbClients } from '../db/clients';
import { getEffectiveSecret } from '../services/webhook-secrets';
import type { PinLeaderboardItem } from '../../lib/types';

vi.mock('../db/analytics', () => ({
  analyticsDb: {
    getPinLeaderboard: vi.fn(),
    getPinTrends: vi.fn(),
  },
}));

vi.mock('../auth/workspace-guard', () => ({
  assertWorkspaceAccess: vi.fn().mockResolvedValue({
    id: 'mem-1',
    role: 'owner',
    isAdmin: true,
    isOwner: true,
  }),
}));

vi.mock('../services/webhook-secrets', () => ({
  getEffectiveSecret: vi.fn().mockResolvedValue({ value: 'valid_test_secret_123', source: 'workspace' }),
}));

vi.mock('../db/clients', () => {
  const createQueryBuilder = () => {
    const q: any = {
      select: vi.fn(() => q),
      delete: vi.fn(() => q),
      update: vi.fn(() => q),
      upsert: vi.fn(() => q),
      eq: vi.fn(() => q),
      lt: vi.fn(() => q),
      in: vi.fn(() => q),
      limit: vi.fn().mockResolvedValue({ data: Array.from({ length: 15 }, (_, i) => ({ id: 'pin-' + i })), error: null }),
      then: (resolve: any, reject: any) =>
        Promise.resolve({ data: { auto_prune_enabled: true, retention_posted_days: 30, processing_timeout_minutes: 45 }, count: 15, error: null }).then(resolve, reject),
      maybeSingle: vi.fn().mockResolvedValue({ data: { auto_prune_enabled: true, retention_posted_days: 30, processing_timeout_minutes: 45 }, error: null }),
    };
    return q;
  };

  return {
    isProductionEnv: vi.fn().mockReturnValue(false),
    isKnownDefaultIngestSecret: vi.fn().mockReturnValue(false),
    isKnownDefaultKek: vi.fn().mockReturnValue(false),
    dbClients: {
      getAnalytics: vi.fn().mockReturnValue({
        from: vi.fn(() => createQueryBuilder()),
        rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
      }),
      getSchedulingAdmin: vi.fn().mockReturnValue({
        from: vi.fn(() => createQueryBuilder()),
        rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
      }),
      getConfig: vi.fn().mockReturnValue({}),
    },
    getServerEnv: vi.fn().mockReturnValue({
      INGEST_SECRET_KEY: 'valid_test_secret_123',
    }),
  };
});

describe('Pin Intelligence & Retention Suite (V26.1)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'conn-uuid-12345';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/analytics/connections/[id]/pin-leaderboard', () => {
    it('validates sort_by, page, page_size, sort, min_impressions, min_appearances, trend, has_link parameters', async () => {
      const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };

      // Invalid sort_by
      const res1 = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?sort_by=INVALID'),
        locals,
      } as any);
      expect(res1.status).toBe(400);
      const json1 = await res1.json();
      expect(json1.error).toContain('sort_by query parameter must be one of');

      // Invalid page (< 1)
      const res2 = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?page=0'),
        locals,
      } as any);
      expect(res2.status).toBe(400);
      const json2 = await res2.json();
      expect(json2.error).toContain('page query parameter must be an integer >= 1');

      // Invalid page_size
      const res3 = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?page_size=33'),
        locals,
      } as any);
      expect(res3.status).toBe(400);
      const json3 = await res3.json();
      expect(json3.error).toContain('page_size query parameter must be one of: 10, 25, 50, 100');

      // Invalid sort field
      const res4 = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?sort=unknown_column'),
        locals,
      } as any);
      expect(res4.status).toBe(400);
      const json4 = await res4.json();
      expect(json4.error).toContain('sort query parameter must be one of');

      // Invalid min_impressions (< 0)
      const res5 = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?min_impressions=-5'),
        locals,
      } as any);
      expect(res5.status).toBe(400);
      const json5 = await res5.json();
      expect(json5.error).toContain('min_impressions query parameter must be an integer >= 0');

      // Invalid min_appearances (< 1)
      const res6 = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?min_appearances=0'),
        locals,
      } as any);
      expect(res6.status).toBe(400);
      const json6 = await res6.json();
      expect(json6.error).toContain('min_appearances query parameter must be an integer >= 1');

      // Invalid trend
      const res7 = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?trend=EXPLODING'),
        locals,
      } as any);
      expect(res7.status).toBe(400);
      const json7 = await res7.json();
      expect(json7.error).toContain('trend query parameter must be one of: ALL, NEW, RISING, FALLING');

      // Invalid has_link
      const res8 = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?has_link=maybe'),
        locals,
      } as any);
      expect(res8.status).toBe(400);
      const json8 = await res8.json();
      expect(json8.error).toContain('has_link query parameter must be true or false');
    });

    it('returns per-sort leaderboard items with total_unique, page, page_size, and pooled rates', async () => {
      const mockResult = {
        items: [
          {
            pin_id: '5699937025406689',
            title: 'Aesthetic Living Room Decor',
            image_url: 'https://i.pinimg.com/600x/demo.jpg',
            appearances: 28,
            best_rank: 1,
            total_impressions: 15420,
            total_engagements: 580,
            total_saves: 245,
            total_outbound_clicks: 120,
            total_pin_clicks: 460,
            last_seen: '2026-08-10',
            prev_rank: 4,
            trend: '▲3',
            engagement_rate: 0.0376,
            outbound_click_rate: 0.0078,
            pin_click_rate: 0.0298,
            save_rate: 0.0159,
          },
        ],
        total_unique: 42,
        page: 2,
        page_size: 10,
      };

      (analyticsDb.getPinLeaderboard as any).mockResolvedValue(mockResult);

      const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
      const res = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?sort_by=IMPRESSION&days=30&page=2&page_size=10&sort=total_impressions&min_impressions=1000&min_appearances=2&trend=RISING&has_link=true&q=decor&unknown_foo=bar'),
        locals,
      } as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.total_unique).toBe(42);
      expect(json.page).toBe(2);
      expect(json.page_size).toBe(10);
      expect(json.data[0].pin_id).toBe('5699937025406689');
      expect(json.data[0].trend).toBe('▲3');
      expect(json.data[0].engagement_rate).toBeCloseTo(0.0376);

      expect(analyticsDb.getPinLeaderboard).toHaveBeenCalledWith(
        workspaceId,
        connectionId,
        'IMPRESSION',
        30,
        10,
        'decor',
        expect.objectContaining({
          page: 2,
          page_size: 10,
          sort: 'total_impressions',
          min_impressions: 1000,
          min_appearances: 2,
          trend: 'RISING',
          has_link: true,
        })
      );
    });

    it('N-3 & N-4: preserves PinLeaderboardItem response shape and tests wildcard queries', async () => {
      const mockSnapshotItem: PinLeaderboardItem = {
        pin_id: '1234567890123456',
        title: 'Special 50% Off_Promo',
        image_url: 'https://i.pinimg.com/736x/test.jpg',
        destination_url: 'https://example.com/promo',
        appearances: 5,
        best_rank: 1,
        total_impressions: 10500,
        total_engagements: 890,
        total_saves: 420,
        total_outbound_clicks: 210,
        total_pin_clicks: 680,
        last_seen: '2026-08-11',
        prev_rank: 2,
        trend: '▲1',
        engagement_rate: 0.0848,
        outbound_click_rate: 0.02,
        pin_click_rate: 0.0648,
        save_rate: 0.04,
      };

      (analyticsDb.getPinLeaderboard as any).mockResolvedValue({
        items: [mockSnapshotItem],
        total_unique: 1,
        page: 1,
        page_size: 25,
      });

      const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
      const res = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?sort_by=IMPRESSION&days=30&limit=25&q=50%25_Promo'),
        locals,
      } as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.total_unique).toBe(1);
      expect(json.page).toBe(1);
      expect(json.page_size).toBe(25);
      expect(json.data[0]).toMatchObject({
        pin_id: '1234567890123456',
        title: 'Special 50% Off_Promo',
        image_url: 'https://i.pinimg.com/736x/test.jpg',
        destination_url: 'https://example.com/promo',
        appearances: 5,
        best_rank: 1,
        total_impressions: 10500,
        total_engagements: 890,
        total_saves: 420,
        total_outbound_clicks: 210,
        total_pin_clicks: 680,
        last_seen: '2026-08-11',
        prev_rank: 2,
        trend: '▲1',
        engagement_rate: 0.0848,
      });
    });
  });

  describe('GET /api/analytics/connections/[id]/pin-trends', () => {
    it('rejects missing pin_id or sort_by with 400', async () => {
      const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };

      // Missing pin_id
      const res1 = await getTrendsHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-trends?sort_by=IMPRESSION'),
        locals,
      } as any);
      expect(res1.status).toBe(400);
      const json1 = await res1.json();
      expect(json1.error).toContain('pin_id query parameter is required');

      // Missing sort_by
      const res2 = await getTrendsHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-trends?pin_id=5699937025406689'),
        locals,
      } as any);
      expect(res2.status).toBe(400);
      const json2 = await res2.json();
      expect(json2.error).toContain('sort_by query parameter is required');
    });

    it('returns ordered chronological timeline snapshots', async () => {
      const mockPoints = [
        {
          window_end: '2026-08-01',
          rank_position: 4,
          impressions: 5000,
          engagements: 200,
          saves: 80,
          outbound_clicks: 40,
          pin_clicks: 160,
          engagement_rate: 0.04,
        },
        {
          window_end: '2026-08-08',
          rank_position: 1,
          impressions: 10420,
          engagements: 380,
          saves: 165,
          outbound_clicks: 80,
          pin_clicks: 300,
          engagement_rate: 0.0365,
        },
      ];

      (analyticsDb.getPinTrends as any).mockResolvedValue(mockPoints);

      const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
      const res = await getTrendsHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-trends?pin_id=5699937025406689&sort_by=SAVE&days=90'),
        locals,
      } as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].rank_position).toBe(4);
      expect(json.data[1].rank_position).toBe(1);

      expect(analyticsDb.getPinTrends).toHaveBeenCalledWith(
        workspaceId,
        connectionId,
        '5699937025406689',
        'SAVE',
        90
      );
    });
  });

  describe('POST /api/internal/pinterest/cleanup-retention', () => {
    it('returns 400 when workspace_id is missing', async () => {
      const res = await postRetentionHandler({
        request: new Request('http://localhost/api/internal/pinterest/cleanup-retention', {
          method: 'POST',
          headers: { 'x-ingest-secret': 'valid_test_secret_123' },
        }),
        locals: {},
      } as any);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('workspace_id is required');
    });

    it('returns 400 when JSON body is malformed', async () => {
      const res = await postRetentionHandler({
        request: new Request('http://localhost/api/internal/pinterest/cleanup-retention', {
          method: 'POST',
          headers: { 'x-ingest-secret': 'valid_test_secret_123' },
          body: '{ invalid-json }',
        }),
        locals: {},
      } as any);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Malformed JSON payload');
    });

    it('returns 401 when x-ingest-secret is missing or mismatched', async () => {
      const res = await postRetentionHandler({
        request: new Request('http://localhost/api/internal/pinterest/cleanup-retention', {
          method: 'POST',
          headers: {
            'x-ingest-secret': 'wrong_secret',
            'x-workspace-id': '9f08ca03-e79c-46fa-9518-6858216daf65',
          },
        }),
        locals: {},
      } as any);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('Unauthorized');
    });

    it('authenticates with x-ingest-secret and returns deleted_count with x-workspace-id header', async () => {
      const res = await postRetentionHandler({
        request: new Request('http://localhost/api/internal/pinterest/cleanup-retention', {
          method: 'POST',
          headers: {
            'x-ingest-secret': 'valid_test_secret_123',
            'x-workspace-id': '9f08ca03-e79c-46fa-9518-6858216daf65',
          },
        }),
        locals: {},
      } as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.deleted_pins_count).toBe(15);
      expect(json.posted_cutoff).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
  });
});
