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
});
