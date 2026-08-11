import { describe, it, expect, beforeEach, vi } from 'vitest';
import { edgeCache } from '../services/edge-cache';

describe('Pinner Analytics Edge Cache Suite', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const connectionId = 'a1b2c3d4-e5f6-7890-1234-56789abcdef0';

  beforeEach(() => {
    edgeCache.clearMemory();
  });

  it('generates canonical cache keys matching specification', () => {
    const ovKey = edgeCache.keys.overview(workspaceId, connectionId, 30);
    expect(ovKey).toBe(`analytics:${workspaceId}:${connectionId}:overview:30d`);

    const topPinsKey = edgeCache.keys.topPins(workspaceId, connectionId, 'IMPRESSION', 30);
    expect(topPinsKey).toBe(`analytics:${workspaceId}:${connectionId}:top-pins:30d:IMPRESSION`);

    const tsKey = edgeCache.keys.timeseries(workspaceId, connectionId, 30);
    expect(tsKey).toBe(`analytics:${workspaceId}:${connectionId}:timeseries:30d`);
  });

  it('handles in-memory cache set, get (HIT), and MISS correctly', async () => {
    const key = edgeCache.keys.overview(workspaceId, connectionId, 30);

    // Initial read should be a MISS
    const miss = await edgeCache.get(key);
    expect(miss.status).toBe('MISS');
    expect(miss.data).toBeNull();

    // Set value
    const payload = { impressions: 50000, engagements: 2000 };
    await edgeCache.set(key, payload);

    // Subsequent read should be a HIT
    const hit = await edgeCache.get(key);
    expect(hit.status).toBe('HIT');
    expect(hit.data).toEqual(payload);
  });

  it('invalidates connection cache on demand', async () => {
    const ovKey = edgeCache.keys.overview(workspaceId, connectionId, 30);
    const topPinsKey = edgeCache.keys.topPins(workspaceId, connectionId, 'IMPRESSION', 30);

    await edgeCache.set(ovKey, { test: 1 });
    await edgeCache.set(topPinsKey, { test: 2 });

    expect((await edgeCache.get(ovKey)).status).toBe('HIT');
    expect((await edgeCache.get(topPinsKey)).status).toBe('HIT');

    await edgeCache.invalidateConnection(workspaceId, connectionId);

    expect((await edgeCache.get(ovKey)).status).toBe('MISS');
    expect((await edgeCache.get(topPinsKey)).status).toBe('MISS');
  });

  it('supports Cloudflare KV namespace integration if provided', async () => {
    const mockKv = {
      get: vi.fn().mockResolvedValue({ impressions: 9999 }),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ keys: [{ name: 'test-key' }] }),
    };

    const key = 'analytics:test:kv';
    const hit = await edgeCache.get(key, mockKv);

    expect(mockKv.get).toHaveBeenCalledWith(key, 'json');
    expect(hit.status).toBe('HIT');
    expect(hit.data).toEqual({ impressions: 9999 });

    await edgeCache.set(key, { impressions: 123 }, mockKv);
    expect(mockKv.put).toHaveBeenCalledWith(key, JSON.stringify({ impressions: 123 }), {
      expirationTtl: 21600,
    });
  });

  it('R10.1: does not cache empty DB results in pinnerAnalyticsService', async () => {
    const { pinnerAnalyticsService } = await import('../services/pinner-analytics-service');
    const { analyticsDb } = await import('../db/analytics');

    const mockScheduling = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'm1', workspace_id: workspaceId, user_id: 'u1', role: 'owner' },
          error: null,
        }),
      })),
    };

    vi.spyOn(analyticsDb, 'getAccountOverviewMetrics').mockResolvedValue({
      impressions: 0,
      engagements: 0,
      pinClicks: 0,
      outboundClicks: 0,
      saves: 0,
      engagementRate: 0,
      pinClickRate: 0,
      outboundClickRate: 0,
      saveRate: 0,
      lastIngestedAt: null,
    });
    vi.spyOn(analyticsDb, 'getRankedTopPins').mockResolvedValue([]);
    vi.spyOn(analyticsDb, 'getDailyTimeSeries').mockResolvedValue([]);

    // 1. Overview with empty results
    const ovRes = await pinnerAnalyticsService.getOverview(
      mockScheduling as any,
      'u1',
      workspaceId,
      connectionId,
      30
    );
    expect(ovRes.cacheStatus).toBe('MISS');
    const ovKey = edgeCache.keys.overview(workspaceId, connectionId, 30);
    const cachedOv = await edgeCache.get(ovKey);
    expect(cachedOv.status).toBe('MISS');
    expect(cachedOv.data).toBeNull();

    // 2. Top pins with empty results
    const tpRes = await pinnerAnalyticsService.getTopPins(
      mockScheduling as any,
      'u1',
      workspaceId,
      connectionId,
      'IMPRESSION',
      50
    );
    expect(tpRes.cacheStatus).toBe('MISS');
    const tpKey = edgeCache.keys.topPins(workspaceId, connectionId, 'IMPRESSION', 30);
    const cachedTp = await edgeCache.get(tpKey);
    expect(cachedTp.status).toBe('MISS');

    // 3. Timeseries with empty results
    const tsRes = await pinnerAnalyticsService.getTimeseries(
      mockScheduling as any,
      'u1',
      workspaceId,
      connectionId,
      30
    );
    expect(tsRes.cacheStatus).toBe('MISS');
    const tsKey = edgeCache.keys.timeseries(workspaceId, connectionId, 30);
    const cachedTs = await edgeCache.get(tsKey);
    expect(cachedTs.status).toBe('MISS');
  });

  it('R10.4: bypassCache bypasses cached data and refreshes cache entry', async () => {
    const { pinnerAnalyticsService } = await import('../services/pinner-analytics-service');
    const { analyticsDb } = await import('../db/analytics');

    const mockScheduling = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'm1', workspace_id: workspaceId, user_id: 'u1', role: 'owner' },
          error: null,
        }),
      })),
    };

    const ovKey = edgeCache.keys.overview(workspaceId, connectionId, 30);
    await edgeCache.set(ovKey, {
      impressions: 100,
      engagements: 10,
      pinClicks: 5,
      outboundClicks: 2,
      saves: 1,
      engagementRate: 0.1,
      outboundClickRate: 0.02,
      pinClickRate: 0.05,
      saveRate: 0.01,
      activeTopPinsCount: 1,
      windowStart: '2026-08-01',
      windowEnd: '2026-08-30',
      lastIngestedAt: null,
      connectionId,
      workspaceId,
    });

    vi.spyOn(analyticsDb, 'getAccountOverviewMetrics').mockResolvedValue({
      impressions: 48730,
      engagements: 1936,
      pinClicks: 1588,
      outboundClicks: 79,
      saves: 247,
      engagementRate: 0.039729,
      pinClickRate: 0.032588,
      outboundClickRate: 0.001621,
      saveRate: 0.005069,
      lastIngestedAt: '2026-08-09T18:46:08Z',
    });
    vi.spyOn(analyticsDb, 'getRankedTopPins').mockResolvedValue([]);

    // Regular read returns HIT
    const normalRead = await pinnerAnalyticsService.getOverview(
      mockScheduling as any,
      'u1',
      workspaceId,
      connectionId,
      30
    );
    expect(normalRead.cacheStatus).toBe('HIT');
    expect(normalRead.data.impressions).toBe(100);

    // Bypass read returns BYPASS and refreshes cache with 48730
    const bypassRead = await pinnerAnalyticsService.getOverview(
      mockScheduling as any,
      'u1',
      workspaceId,
      connectionId,
      30,
      undefined,
      true
    );
    expect(bypassRead.cacheStatus).toBe('BYPASS');
    expect(bypassRead.data.impressions).toBe(48730);

    // Subsequent normal read is a HIT with refreshed value
    const postBypassRead = await pinnerAnalyticsService.getOverview(
      mockScheduling as any,
      'u1',
      workspaceId,
      connectionId,
      30
    );
    expect(postBypassRead.cacheStatus).toBe('HIT');
    expect(postBypassRead.data.impressions).toBe(48730);
  });

  describe('Edge Cache Decision Table (Cases 1–5)', () => {
    const testKey = 'analytics:decision:table:test';

    it('Case 1: Memory fresh → HIT (memory)', async () => {
      const mockKv = {
        get: vi.fn().mockResolvedValue({ source: 'kv' }),
      };

      // Set fresh memory entry (TTL 3600s)
      await edgeCache.set(testKey, { source: 'memory-fresh' }, undefined, 3600);

      const result = await edgeCache.get(testKey, mockKv);
      expect(result.status).toBe('HIT');
      expect(result.data).toEqual({ source: 'memory-fresh' });
      expect(mockKv.get).not.toHaveBeenCalled();
    });

    it('Case 2: Memory stale + KV fresh → HIT (KV) and refresh memory entry', async () => {
      vi.useFakeTimers();
      try {
        const mockKv = {
          get: vi.fn().mockResolvedValue({ source: 'kv-fresh' }),
        };

        // Set memory entry with TTL 10s
        await edgeCache.set(testKey, { source: 'memory-stale' }, undefined, 10);

        // Advance time past TTL (e.g. 20s)
        vi.advanceTimersByTime(20_000);

        const result = await edgeCache.get(testKey, mockKv, 3600);
        expect(mockKv.get).toHaveBeenCalledWith(testKey, 'json');
        expect(result.status).toBe('HIT');
        expect(result.data).toEqual({ source: 'kv-fresh' });

        // Verify memory cache was refreshed with KV fresh data
        const subsequentMemoryOnly = await edgeCache.get(testKey, undefined);
        expect(subsequentMemoryOnly.status).toBe('HIT');
        expect(subsequentMemoryOnly.data).toEqual({ source: 'kv-fresh' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('Case 3: Memory stale + KV stale/absent → STALE with memory data', async () => {
      vi.useFakeTimers();
      try {
        const mockKv = {
          get: vi.fn().mockResolvedValue(null),
        };

        // Set memory entry with TTL 10s
        await edgeCache.set(testKey, { source: 'memory-stale' }, undefined, 10);

        // Advance time past TTL (e.g. 20s)
        vi.advanceTimersByTime(20_000);

        const result = await edgeCache.get(testKey, mockKv);
        expect(mockKv.get).toHaveBeenCalledWith(testKey, 'json');
        expect(result.status).toBe('STALE');
        expect(result.data).toEqual({ source: 'memory-stale' });
        expect(result.ttlRemaining).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('Case 4: No memory + KV fresh → HIT (KV)', async () => {
      const mockKv = {
        get: vi.fn().mockResolvedValue({ source: 'kv-fresh-only' }),
      };

      // Memory is clear
      const result = await edgeCache.get(testKey, mockKv, 3600);
      expect(mockKv.get).toHaveBeenCalledWith(testKey, 'json');
      expect(result.status).toBe('HIT');
      expect(result.data).toEqual({ source: 'kv-fresh-only' });

      // Verify memory was populated
      const subsequentMemoryOnly = await edgeCache.get(testKey, undefined);
      expect(subsequentMemoryOnly.status).toBe('HIT');
      expect(subsequentMemoryOnly.data).toEqual({ source: 'kv-fresh-only' });
    });

    it('Case 5: No memory + KV stale/absent → MISS', async () => {
      const mockKv = {
        get: vi.fn().mockResolvedValue(null),
      };

      // Memory is clear, KV returns null
      const result = await edgeCache.get(testKey, mockKv);
      expect(mockKv.get).toHaveBeenCalledWith(testKey, 'json');
      expect(result.status).toBe('MISS');
      expect(result.data).toBeNull();
    });
  });
});

