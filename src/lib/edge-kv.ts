export interface EdgeKVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  list(opts?: { prefix?: string }): Promise<{ keys: { name: string }[] }>;
  delete(key: string): Promise<void>;
}

export function getAnalyticsKV(locals: unknown): EdgeKVNamespace | undefined {
  const env = (locals as { runtime?: { env?: Record<string, unknown> } } | null)?.runtime?.env;
  return (env?.ANALYTICS_KV as EdgeKVNamespace | undefined) ?? undefined;
}
