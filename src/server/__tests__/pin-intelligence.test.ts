import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET as getLeaderboardHandler } from '../../pages/api/analytics/connections/[id]/pin-leaderboard';
import { GET as getTrendsHandler } from '../../pages/api/analytics/connections/[id]/pin-trends';
import { POST as postRetentionHandler } from '../../pages/api/internal/pinterest/cleanup-retention';
import { analyticsDb } from '../db/analytics';
import { dbClients } from '../db/clients';
import { getEffectiveSecret } from '../services/webhook-secrets';

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

vi.mock('../db/clients', () => ({
  dbClients: {
    getAnalytics: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({ count: 15, error: null }),
          }),
          lt: vi.fn().mockResolvedValue({ count: 15, error: null }),
        }),
      }),
    }),
    getConfig: vi.fn().mockReturnValue({}),
  },
  getServerEnv: vi.fn().mockReturnValue({
    INGEST_SECRET_KEY: 'valid_test_secret_123',
  }),
}));

describe('Pin Intelligence & Retention Suite (V26.1)', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'conn-uuid-12345';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/analytics/connections/[id]/pin-leaderboard', () => {
    it('rejects missing or invalid sort_by with 400', async () => {
      const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };

      // Missing sort_by
      const res1 = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard'),
        locals,
      } as any);
      expect(res1.status).toBe(400);
      const json1 = await res1.json();
      expect(json1.error).toContain('sort_by query parameter is required');

      // Invalid sort_by
      const res2 = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?sort_by=INVALID'),
        locals,
      } as any);
      expect(res2.status).toBe(400);
      const json2 = await res2.json();
      expect(json2.error).toContain('sort_by query parameter is required');
    });

    it('returns per-sort leaderboard items without metric inflation', async () => {
      const mockItems = [
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
        },
      ];

      (analyticsDb.getPinLeaderboard as any).mockResolvedValue(mockItems);

      const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
      const res = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?sort_by=IMPRESSION&days=30&limit=25&q=decor'),
        locals,
      } as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].pin_id).toBe('5699937025406689');
      expect(json.data[0].trend).toBe('▲3');

      expect(analyticsDb.getPinLeaderboard).toHaveBeenCalledWith(
        workspaceId,
        connectionId,
        'IMPRESSION',
        30,
        25,
        'decor'
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
      };

      (analyticsDb.getPinLeaderboard as any).mockResolvedValue([mockSnapshotItem]);

      const locals = { user: { id: 'u1' }, supabase: {}, activeWorkspaceId: workspaceId };
      const res = await getLeaderboardHandler({
        params: { id: connectionId },
        request: new Request('http://localhost/api/analytics/connections/conn-uuid-12345/pin-leaderboard?sort_by=IMPRESSION&days=30&limit=25&q=50%25_Promo'),
        locals,
      } as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
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
      expect(json.deleted_count).toBe(15);
      expect(json.cutoff_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
