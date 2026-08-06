import { supabase, isSupabaseConfigured, createAstroServerClient } from './supabase';
import type { Workspace } from './types';

export const ACTIVE_WORKSPACE_COOKIE = 'pinorbit_active_workspace_id';
export const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

export const DEFAULT_WORKSPACE: Workspace = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default Workspace',
  slug: 'default',
  created_at: new Date('2026-08-01T00:00:00Z').toISOString(),
  updated_at: new Date('2026-08-01T00:00:00Z').toISOString(),
};

/**
 * Returns the constant Default Workspace ID.
 */
export function getDefaultWorkspaceId(): string {
  return DEFAULT_WORKSPACE_ID;
}

/**
 * Fetches all available workspaces for the current user/admin session.
 * Safe to call from Astro frontmatter (SSR) and client side.
 * Uses official @supabase/ssr request-scoped server client when Astro cookies or request objects are provided in SSR.
 */
export async function getWorkspaces(
  cookiesOrClient?: any,
  request?: Request,
  responseHeaders?: Headers | any
): Promise<Workspace[]> {
  if (!isSupabaseConfigured) {
    return [DEFAULT_WORKSPACE];
  }

  let activeClient = supabase;

  // 1. If passed an explicit Supabase client instance
  if (cookiesOrClient && typeof cookiesOrClient.from === 'function') {
    activeClient = cookiesOrClient;
  }
  // 2. If passed Astro cookies or Request in SSR, create a request-scoped @supabase/ssr server client
  else if (cookiesOrClient && (typeof cookiesOrClient.get === 'function' || typeof cookiesOrClient.headers !== 'undefined')) {
    const serverClient = createAstroServerClient(cookiesOrClient, request, responseHeaders);
    if (serverClient) {
      activeClient = serverClient;
    }
  }

  if (!activeClient) {
    return [DEFAULT_WORKSPACE];
  }

  try {
    const { data, error } = await activeClient
      .from('workspaces')
      .select('*')
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) {
      return [DEFAULT_WORKSPACE];
    }

    return data as Workspace[];
  } catch (err) {
    console.warn('Error fetching workspaces from Supabase, falling back to default:', err);
    return [DEFAULT_WORKSPACE];
  }
}

/**
 * Extracts active workspace ID from Astro cookies, string cookie header, or client document.cookie.
 * Safe for both server side (Astro frontmatter) and client side.
 */
export function getActiveWorkspaceId(cookies?: any): string {
  // 1. Astro cookies object passed in frontmatter
  if (cookies && typeof cookies.get === 'function') {
    const val = cookies.get(ACTIVE_WORKSPACE_COOKIE)?.value;
    if (val) return val;
  }

  // 2. Raw Cookie Header string
  if (typeof cookies === 'string') {
    const match = cookies.match(new RegExp(`(?:^|; )${ACTIVE_WORKSPACE_COOKIE}=([^;]*)`));
    if (match && match[1]) return decodeURIComponent(match[1]);
  }

  // 3. Browser environment fallback
  if (typeof document !== 'undefined' && document.cookie) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${ACTIVE_WORKSPACE_COOKIE}=([^;]*)`));
    if (match && match[1]) return decodeURIComponent(match[1]);
  }

  return DEFAULT_WORKSPACE_ID;
}
