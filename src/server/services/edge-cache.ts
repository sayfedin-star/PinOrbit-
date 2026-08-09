/**
 * Edge Caching Layer for Pinner Analytics.
 * Directives:
 * 1. Cloudflare KV is a post-persistence read cache only.
 * 2. In local dev or non-KV environments, seamlessly falls back to an in-memory TTL store.
 * 3. Never write cache before database persistence completes.
 * 4. Cache TTL defaults to 6 hours (21600 seconds).
 * 5. Returns cache metadata for diagnostic X-Cache-Status (HIT / MISS / STALE) headers.
 */

export type CacheStatus = 'HIT' | 'MISS' | 'STALE' | 'BYPASS';

export interface CachedResponse<T> {
  data: T;
  status: CacheStatus;
  cachedAt?: number;
  ttlRemaining?: number;
}

interface InMemoryCacheEntry<T> {
  value: T;
  cachedAt: number;
  ttlMs: number;
}

// In-Memory fallback store for SSR and local environments
const memoryCache = new Map<string, InMemoryCacheEntry<any>>();

const DEFAULT_TTL_SECONDS = 6 * 60 * 60; // 6 hours

export const edgeCache = {
  /**
   * Generates canonical cache keys.
   */
  keys: {
    overview(workspaceId: string, connectionId: string, windowDays = 30): string {
      return `analytics:${workspaceId}:${connectionId}:overview:${windowDays}d`;
    },
    topPins(
      workspaceId: string,
      connectionId: string,
      sortBy = 'IMPRESSION',
      windowDays = 30,
      fromDate?: string,
      toDate?: string
    ): string {
      if (fromDate && toDate) {
        return `analytics:${workspaceId}:${connectionId}:top-pins:${fromDate}_${toDate}:${sortBy}`;
      }
      return `analytics:${workspaceId}:${connectionId}:top-pins:${windowDays}d:${sortBy}`;
    },
    timeseries(workspaceId: string, connectionId: string, windowDays = 30): string {
      return `analytics:${workspaceId}:${connectionId}:timeseries:${windowDays}d`;
    },
  },

  /**
   * Reads a cached item with fallback.
   */
  async get<T>(
    key: string,
    kvNamespace?: any,
    ttlSeconds = DEFAULT_TTL_SECONDS
  ): Promise<CachedResponse<T | null>> {
    const now = Date.now();

    // 1. Try Cloudflare KV if namespace is available in runtime context
    if (kvNamespace && typeof kvNamespace.get === 'function') {
      try {
        const raw = await kvNamespace.get(key, 'json');
        if (raw) {
          return {
            data: raw as T,
            status: 'HIT',
            cachedAt: now,
          };
        }
      } catch (e) {
        console.warn(`[EdgeCache] KV read error for key ${key}:`, e);
      }
    }

    // 2. Check in-memory store fallback
    const memoryEntry = memoryCache.get(key);
    if (memoryEntry) {
      const ageMs = now - memoryEntry.cachedAt;
      const ttlMs = memoryEntry.ttlMs;

      if (ageMs <= ttlMs) {
        return {
          data: memoryEntry.value as T,
          status: 'HIT',
          cachedAt: memoryEntry.cachedAt,
          ttlRemaining: Math.max(0, Math.floor((ttlMs - ageMs) / 1000)),
        };
      } else {
        // Stale entry
        return {
          data: memoryEntry.value as T,
          status: 'STALE',
          cachedAt: memoryEntry.cachedAt,
          ttlRemaining: 0,
        };
      }
    }

    return {
      data: null,
      status: 'MISS',
    };
  },

  /**
   * Sets a value in the cache after database persistence.
   */
  async set<T>(
    key: string,
    value: T,
    kvNamespace?: any,
    ttlSeconds = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    const now = Date.now();
    const ttlMs = ttlSeconds * 1000;

    // 1. In-memory store
    memoryCache.set(key, {
      value,
      cachedAt: now,
      ttlMs,
    });

    // 2. Cloudflare KV namespace if provided
    if (kvNamespace && typeof kvNamespace.put === 'function') {
      try {
        await kvNamespace.put(key, JSON.stringify(value), {
          expirationTtl: ttlSeconds,
        });
      } catch (e) {
        console.warn(`[EdgeCache] KV put error for key ${key}:`, e);
      }
    }
  },

  /**
   * Invalidates all cache entries for a connection.
   */
  async invalidateConnection(
    workspaceId: string,
    connectionId: string,
    kvNamespace?: any
  ): Promise<void> {
    const prefix = `analytics:${workspaceId}:${connectionId}:`;

    // Clear matching memory entries
    for (const key of memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        memoryCache.delete(key);
      }
    }

    // KV list & delete if supported
    if (kvNamespace && typeof kvNamespace.list === 'function' && typeof kvNamespace.delete === 'function') {
      try {
        const list = await kvNamespace.list({ prefix });
        for (const k of list.keys || []) {
          await kvNamespace.delete(k.name);
        }
      } catch (e) {
        console.warn(`[EdgeCache] KV invalidation error for prefix ${prefix}:`, e);
      }
    }
  },

  /**
   * Clears the entire in-memory cache (primarily for unit tests).
   */
  clearMemory(): void {
    memoryCache.clear();
  },
};
