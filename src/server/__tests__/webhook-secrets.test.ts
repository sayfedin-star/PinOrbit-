import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getEffectiveSecret,
  ensureGlobalSecret,
  regenerate,
  removeWorkspaceOverride,
  getSecretStatus,
  GLOBAL_KEY,
  wsKey,
} from '../services/webhook-secrets';

describe('Cloudflare KV Webhook Secrets Service Suite (V19)', () => {
  const wsId = '00000000-0000-0000-0000-000000000001';

  let mockKvStore: Map<string, string>;
  let mockKvNamespace: any;
  let mockRuntimeEnv: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvStore = new Map<string, string>();
    mockKvNamespace = {
      get: vi.fn(async (key: string) => mockKvStore.get(key) || null),
      put: vi.fn(async (key: string, val: string) => {
        mockKvStore.set(key, val);
      }),
      delete: vi.fn(async (key: string) => {
        mockKvStore.delete(key);
      }),
    };

    mockRuntimeEnv = {
      INGEST_SECRETS_KV: mockKvNamespace,
      INGEST_SECRET_KEY: 'env_fallback_secret_123',
    };
  });

  it('B2: Strict 3-step resolution order: ws override -> global secret -> env fallback', async () => {
    // 1. Initially only env exists
    mockRuntimeEnv.INGEST_SECRETS_KV = undefined;
    const resEnv = await getEffectiveSecret(wsId, mockRuntimeEnv);
    expect(resEnv.source).toBe('env');
    expect(resEnv.value).toBe('env_fallback_secret_123');

    // 2. Global secret in KV takes precedence over env
    mockRuntimeEnv.INGEST_SECRETS_KV = mockKvNamespace;
    mockKvStore.set(GLOBAL_KEY, 'global_secret_uuid_abc');
    const resGlobal = await getEffectiveSecret(wsId, mockRuntimeEnv);
    expect(resGlobal.source).toBe('global');
    expect(resGlobal.value).toBe('global_secret_uuid_abc');

    // 3. Workspace override takes highest precedence over global and env
    mockKvStore.set(wsKey(wsId), 'ws_override_uuid_xyz');
    const resWs = await getEffectiveSecret(wsId, mockRuntimeEnv);
    expect(resWs.source).toBe('workspace');
    expect(resWs.value).toBe('ws_override_uuid_xyz');
  });

  it('B2: Auto-generates global secret on first view if KV is uninitialized', async () => {
    expect(mockKvStore.has(GLOBAL_KEY)).toBe(false);

    const generated = await ensureGlobalSecret(mockRuntimeEnv);
    expect(generated).toBeDefined();
    expect(generated.length).toBeGreaterThan(10);
    expect(mockKvStore.get(GLOBAL_KEY)).toBe(generated);

    // Subsequent calls return the existing global secret
    const secondCall = await ensureGlobalSecret(mockRuntimeEnv);
    expect(secondCall).toBe(generated);
  });

  it('B2: Regenerate immediately rotates value with no grace period', async () => {
    mockKvStore.set(GLOBAL_KEY, 'old_global_secret');

    const rotatedGlobal = await regenerate('global', undefined, mockRuntimeEnv);
    expect(rotatedGlobal).not.toBe('old_global_secret');
    expect(mockKvStore.get(GLOBAL_KEY)).toBe(rotatedGlobal);

    // Workspace regenerate
    const rotatedWs = await regenerate('workspace', wsId, mockRuntimeEnv);
    expect(rotatedWs).toBeDefined();
    expect(mockKvStore.get(wsKey(wsId))).toBe(rotatedWs);
  });

  it('B2: removeWorkspaceOverride deletes ONLY ws key; global secret remains untouched', async () => {
    mockKvStore.set(GLOBAL_KEY, 'persistent_global_secret');
    mockKvStore.set(wsKey(wsId), 'temporary_ws_override');

    await removeWorkspaceOverride(wsId, mockRuntimeEnv);

    expect(mockKvStore.has(wsKey(wsId))).toBe(false);
    expect(mockKvStore.get(GLOBAL_KEY)).toBe('persistent_global_secret');

    // After removing override, effective secret falls back to global
    const effective = await getEffectiveSecret(wsId, mockRuntimeEnv);
    expect(effective.source).toBe('global');
    expect(effective.value).toBe('persistent_global_secret');
  });

  it('getSecretStatus returns full UI metadata', async () => {
    mockKvStore.set(GLOBAL_KEY, 'global_secret_123');

    const status1 = await getSecretStatus(wsId, mockRuntimeEnv);
    expect(status1.hasOverride).toBe(false);
    expect(status1.source).toBe('global');
    expect(status1.secret).toBe('global_secret_123');

    mockKvStore.set(wsKey(wsId), 'override_secret_456');
    const status2 = await getSecretStatus(wsId, mockRuntimeEnv);
    expect(status2.hasOverride).toBe(true);
    expect(status2.source).toBe('workspace');
    expect(status2.secret).toBe('override_secret_456');
  });
});
