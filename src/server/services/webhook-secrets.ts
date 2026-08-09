import { getServerEnv } from '../db/clients';

export const GLOBAL_KEY = 'ingest_secret:global';
export const wsKey = (wsId: string) => `ingest_secret:ws:${wsId}`;

export interface IngestSecretResolution {
  value: string;
  source: 'workspace' | 'global' | 'env';
}

export interface IngestSecretStatus {
  secret: string;
  source: 'workspace' | 'global' | 'env';
  hasOverride: boolean;
}

/**
 * Resolves the effective ingest secret in strict immutable order:
 * 1. ingest_secret:ws:{wsId} (Workspace override)
 * 2. ingest_secret:global (Global secret)
 * 3. INGEST_SECRET_KEY env (Fallback)
 */
export async function getEffectiveSecret(
  wsId: string,
  runtimeEnv: Record<string, any>
): Promise<IngestSecretResolution> {
  const kv = runtimeEnv?.INGEST_SECRETS_KV;
  if (kv) {
    if (wsId) {
      const ws = await kv.get(wsKey(wsId));
      if (ws) return { value: ws, source: 'workspace' };
    }
    const g = await kv.get(GLOBAL_KEY);
    if (g) return { value: g, source: 'global' };
  }

  const serverConfig = getServerEnv(runtimeEnv);
  return { value: serverConfig.INGEST_SECRET_KEY ?? '', source: 'env' };
}

/**
 * Auto-generates global secret in KV on first view if absent.
 */
export async function ensureGlobalSecret(
  runtimeEnv: Record<string, any>
): Promise<string> {
  const kv = runtimeEnv?.INGEST_SECRETS_KV;
  if (!kv) {
    const serverConfig = getServerEnv(runtimeEnv);
    return serverConfig.INGEST_SECRET_KEY || '';
  }

  let g = await kv.get(GLOBAL_KEY);
  if (!g) {
    g = crypto.randomUUID();
    await kv.put(GLOBAL_KEY, g);
  }
  return g;
}

/**
 * Rotates secret immediately (no grace period) for global or workspace scope.
 */
export async function regenerate(
  scope: 'global' | 'workspace',
  wsId: string | undefined,
  runtimeEnv: Record<string, any>
): Promise<string> {
  const kv = runtimeEnv?.INGEST_SECRETS_KV;
  if (!kv) {
    throw new Error('Cloudflare KV namespace INGEST_SECRETS_KV is not configured in runtime environment.');
  }

  if (scope === 'workspace' && !wsId) {
    throw new Error('Workspace ID is required to generate workspace override secret.');
  }

  const key = scope === 'global' ? GLOBAL_KEY : wsKey(wsId!);
  const next = crypto.randomUUID();
  await kv.put(key, next);
  return next;
}

/**
 * Deletes ONLY the workspace override key; global secret remains untouched.
 */
export async function removeWorkspaceOverride(
  wsId: string,
  runtimeEnv: Record<string, any>
): Promise<void> {
  const kv = runtimeEnv?.INGEST_SECRETS_KV;
  if (kv && wsId) {
    await kv.delete(wsKey(wsId));
  }
}

/**
 * Retrieves the secret status for UI view, ensuring global secret exists if KV available.
 */
export async function getSecretStatus(
  wsId: string,
  runtimeEnv: Record<string, any>
): Promise<IngestSecretStatus> {
  const kv = runtimeEnv?.INGEST_SECRETS_KV;
  if (kv && wsId) {
    const ws = await kv.get(wsKey(wsId));
    if (ws) {
      return { secret: ws, source: 'workspace', hasOverride: true };
    }
  }

  const secret = await ensureGlobalSecret(runtimeEnv);
  return {
    secret,
    source: kv ? 'global' : 'env',
    hasOverride: false,
  };
}
