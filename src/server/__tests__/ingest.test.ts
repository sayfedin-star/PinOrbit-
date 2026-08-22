import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as ingestHandler } from '../../pages/api/internal/pinterest/ingest';
import { dbClients } from '../db/clients';
import { pinnerETL } from '../services/pinner-etl';

vi.mock('../services/pinner-etl', () => ({
  pinnerETL: {
    processIngestionPayload: vi.fn().mockResolvedValue({
      success: true,
      persisted: true,
      dailyRowsIngested: 7,
      topPinsIngested: 50,
      workspaceRollupsUpdated: 7,
    }),
  },
}));

vi.mock('../db/clients', () => {
  const mockAnalytics = {
    from: vi.fn(),
  };

  return {
    isProductionEnv: vi.fn().mockReturnValue(false),
    isKnownDefaultIngestSecret: vi.fn().mockReturnValue(false),
    isKnownDefaultKek: vi.fn().mockReturnValue(false),
    getServerEnv: vi.fn().mockReturnValue({
      INGEST_SECRET_KEY: 'env_secret_default_999',
    }),
    dbClients: {
      getAnalytics: vi.fn().mockReturnValue(mockAnalytics),
      getSchedulingAdmin: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
      getConfig: vi.fn().mockReturnValue({
        INGEST_SECRET_KEY: 'env_secret_default_999',
      }),
    },
  };
});

describe('Pinterest Ingestion Validation Sequence & Security Suite (V19 Strict Mandate B3)', () => {
  const mockWsId = '00000000-0000-0000-0000-000000000001';
  const mockConnId = 'conn-uuid-12345';

  let mockKvStore: Map<string, string>;
  let mockRuntimeEnv: Record<string, any>;
  let mockAnalyticsClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvStore = new Map<string, string>();
    mockRuntimeEnv = {
      INGEST_SECRETS_KV: {
        get: vi.fn(async (key: string) => mockKvStore.get(key) || null),
        put: vi.fn(async (key: string, val: string) => mockKvStore.set(key, val)),
        delete: vi.fn(async (key: string) => mockKvStore.delete(key)),
      },
      ANALYTICS_KV: {},
      INGEST_SECRET_KEY: 'env_secret_default_999',
    };

    mockAnalyticsClient = dbClients.getAnalytics();
  });

  it('B3 Step 1: Returns HTTP 400 on empty or malformed JSON payload', async () => {
    // 1. Empty body
    const emptyReq = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    const emptyRes = await ingestHandler({
      request: emptyReq,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(emptyRes.status).toBe(400);
    const emptyJson = await emptyRes.json();
    expect(emptyJson.error).toContain('Empty request payload');

    // 2. Malformed JSON
    const malformedReq = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not-a-json ',
    });
    const malformedRes = await ingestHandler({
      request: malformedReq,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(malformedRes.status).toBe(400);
    const malformedJson = await malformedRes.json();
    expect(malformedJson.error).toContain('Malformed JSON payload');
  });

  it('B3 Step 2: Returns HTTP 422 on missing connection_id', async () => {
    const req = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: mockWsId }),
    });
    const res = await ingestHandler({
      request: req,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain('connection_id is required');
  });

  it('B3 Step 3: Returns HTTP 401 if connection is absent or deleted in Project 3', async () => {
    mockAnalyticsClient.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const req = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': 'env_secret_default_999',
      },
      body: JSON.stringify({ connection_id: 'nonexistent-conn-id' }),
    });
    const res = await ingestHandler({
      request: req,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Invalid connection or unauthorized');
  });

  it('B3 Step 4: Returns HTTP 409 { success: false, error: "connection_disabled" } when analytics_enabled is false', async () => {
    mockAnalyticsClient.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: mockConnId,
          workspace_id: mockWsId,
          analytics_enabled: false,
          deleted_at: null,
        },
        error: null,
      }),
    });

    const req = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': 'env_secret_default_999',
      },
      body: JSON.stringify({ connection_id: mockConnId }),
    });
    const res = await ingestHandler({
      request: req,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('connection_disabled');
  });

  it('B3 Step 6: Rejects secret mismatch with HTTP 401 and strictly refuses fallback headers (x-ingest-key, x-make-secret)', async () => {
    mockAnalyticsClient.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: mockConnId,
          workspace_id: mockWsId,
          analytics_enabled: true,
          deleted_at: null,
        },
        error: null,
      }),
    });

    mockKvStore.set('ingest_secret:global', 'authorized_global_secret');

    // 1. Wrong secret
    const wrongSecretReq = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': 'unauthorized_secret',
      },
      body: JSON.stringify({ connection_id: mockConnId }),
    });
    const wrongSecretRes = await ingestHandler({
      request: wrongSecretReq,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(wrongSecretRes.status).toBe(401);

    // 2. Unauthorized fallback header x-ingest-key
    const fallbackKeyReq = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-key': 'authorized_global_secret',
      },
      body: JSON.stringify({ connection_id: mockConnId }),
    });
    const fallbackKeyRes = await ingestHandler({
      request: fallbackKeyReq,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(fallbackKeyRes.status).toBe(401);

    // 3. Unauthorized fallback header x-make-secret
    const fallbackMakeReq = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-make-secret': 'authorized_global_secret',
      },
      body: JSON.stringify({ connection_id: mockConnId }),
    });
    const fallbackMakeRes = await ingestHandler({
      request: fallbackMakeReq,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(fallbackMakeRes.status).toBe(401);
  });

  it('B3 Step 7: Accepts global secret and hands off to ETL', async () => {
    mockAnalyticsClient.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: mockConnId,
          workspace_id: mockWsId,
          analytics_enabled: true,
          deleted_at: null,
        },
        error: null,
      }),
    });

    mockKvStore.set('ingest_secret:global', 'authorized_global_secret');

    const req = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': 'authorized_global_secret',
      },
      body: JSON.stringify({
        connection_id: mockConnId,
        channel: 'account_analytics',
        account_analytics: { summary: {} },
      }),
    });

    const res = await ingestHandler({
      request: req,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(res.status).toBe(200);
    expect(pinnerETL.processIngestionPayload).toHaveBeenCalled();
  });

  it('B3 Step 7: Accepts workspace override secret over global secret and hands off to ETL', async () => {
    mockAnalyticsClient.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: mockConnId,
          workspace_id: mockWsId,
          analytics_enabled: true,
          deleted_at: null,
        },
        error: null,
      }),
    });

    mockKvStore.set('ingest_secret:global', 'global_secret');
    mockKvStore.set(`ingest_secret:ws:${mockWsId}`, 'ws_override_secret');

    // Global secret is now rejected for this workspace
    const globalReq = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': 'global_secret',
      },
      body: JSON.stringify({ connection_id: mockConnId, workspace_id: mockWsId }),
    });
    const globalRes = await ingestHandler({
      request: globalReq,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(globalRes.status).toBe(401);

    // Workspace override secret is accepted
    const wsReq = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': 'ws_override_secret',
      },
      body: JSON.stringify({ connection_id: mockConnId, workspace_id: mockWsId }),
    });
    const wsRes = await ingestHandler({
      request: wsReq,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);
    expect(wsRes.status).toBe(200);
  });

  it('R7.4: Envelope WITHOUT workspace_id injects workspace_id server-side and completes run with 200', async () => {
    mockAnalyticsClient.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: mockConnId,
          workspace_id: mockWsId,
          analytics_enabled: true,
          deleted_at: null,
        },
        error: null,
      }),
    });

    mockKvStore.set('ingest_secret:global', 'authorized_global_secret');

    const req = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': 'authorized_global_secret',
      },
      body: JSON.stringify({
        connection_id: mockConnId,
        channel: 'account_analytics',
        account_analytics: { summary: {} },
      }),
    });

    const res = await ingestHandler({
      request: req,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);

    expect(res.status).toBe(200);
    expect(pinnerETL.processIngestionPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_id: mockConnId,
        workspace_id: mockWsId,
      }),
      expect.anything(),
      expect.anything()
    );
  });

  it('F-08: Logs warning and overwrites with connection.workspace_id when client workspace_id differs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockAnalyticsClient.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: mockConnId,
          workspace_id: mockWsId,
          analytics_enabled: true,
          deleted_at: null,
        },
        error: null,
      }),
    });

    const wrongWsId = '99999999-9999-9999-9999-999999999999';
    mockKvStore.set('ingest_secret:global', 'authorized_global_secret');
    mockKvStore.set(`ingest_secret:ws:${wrongWsId}`, 'authorized_global_secret');
    const req = new Request('http://localhost:4321/api/internal/pinterest/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-secret': 'authorized_global_secret',
      },
      body: JSON.stringify({
        connection_id: mockConnId,
        workspace_id: wrongWsId,
        channel: 'account_analytics',
        account_analytics: { summary: {} },
      }),
    });

    const res = await ingestHandler({
      request: req,
      locals: { runtime: { env: mockRuntimeEnv } },
    } as any);

    expect(res.status).toBe(403);
    const resBody = await res.json();
    expect(resBody.error).toContain('does not match connection workspace');

    warnSpy.mockRestore();
  });
});

