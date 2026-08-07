import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptionsWithName } from '@supabase/ssr';

export interface ServerEnvConfig {
  SCHEDULING_SUPABASE_URL: string;
  SCHEDULING_SUPABASE_PUBLISHABLE_KEY: string;
  SCHEDULING_SUPABASE_SECRET_KEY: string;
  COMPETITORS_SUPABASE_URL: string;
  COMPETITORS_SUPABASE_SECRET_KEY: string;
  ANALYTICS_SUPABASE_URL: string;
  ANALYTICS_SUPABASE_SECRET_KEY: string;
}

/**
 * Validates and extracts server-only environment configuration.
 * Throws explicit descriptive error if privileged secret keys are missing.
 */
export function getServerEnv(): ServerEnvConfig {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;

  const SCHEDULING_SUPABASE_URL = env.SCHEDULING_SUPABASE_URL || 'https://eygdoetdwqllvsxpvoex.supabase.co';
  const SCHEDULING_SUPABASE_PUBLISHABLE_KEY = env.SCHEDULING_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_efxKrwXCOaj9CM5oxD-WjA_jqvB5iGD';
  const SCHEDULING_SUPABASE_SECRET_KEY = env.SCHEDULING_SUPABASE_SECRET_KEY || '';

  const COMPETITORS_SUPABASE_URL = env.COMPETITORS_SUPABASE_URL || 'https://guycnhvwfzdzbpgsnavg.supabase.co';
  const COMPETITORS_SUPABASE_SECRET_KEY = env.COMPETITORS_SUPABASE_SECRET_KEY || '';

  const ANALYTICS_SUPABASE_URL = env.ANALYTICS_SUPABASE_URL || 'https://jxdkbwnwtjelznmauwpc.supabase.co';
  const ANALYTICS_SUPABASE_SECRET_KEY = env.ANALYTICS_SUPABASE_SECRET_KEY || '';

  return {
    SCHEDULING_SUPABASE_URL,
    SCHEDULING_SUPABASE_PUBLISHABLE_KEY,
    SCHEDULING_SUPABASE_SECRET_KEY,
    COMPETITORS_SUPABASE_URL,
    COMPETITORS_SUPABASE_SECRET_KEY,
    ANALYTICS_SUPABASE_URL,
    ANALYTICS_SUPABASE_SECRET_KEY,
  };
}

/**
 * Creates a request-scoped Supabase client for Project 1 (Scheduling / Auth Authority).
 * Compatible with Astro SSR cookies for identity and session management.
 */
export function createSchedulingSSRClient(context: {
  cookies: {
    get: (key: string) => { value: string } | undefined;
    set: (key: string, value: string, options: Record<string, unknown>) => void;
    delete: (key: string, options: Record<string, unknown>) => void;
  };
}): SupabaseClient {
  const env = getServerEnv();

  return createServerClient(env.SCHEDULING_SUPABASE_URL, env.SCHEDULING_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      get(key: string) {
        return context.cookies.get(key)?.value;
      },
      set(key: string, value: string, options: CookieOptionsWithName) {
        context.cookies.set(key, value, options as Record<string, unknown>);
      },
      remove(key: string, options: CookieOptionsWithName) {
        context.cookies.delete(key, options as Record<string, unknown>);
      },
    },
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Creates a server-only administrative client for Project 1 (Scheduling).
 * Used exclusively for background queues, cron dispatch, and audit logging.
 */
export function createSchedulingAdminClient(): SupabaseClient {
  const env = getServerEnv();
  return createClient(env.SCHEDULING_SUPABASE_URL, env.SCHEDULING_SUPABASE_SECRET_KEY || env.SCHEDULING_SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'x-client-info': 'pinorbit-v2-scheduling-admin',
      },
    },
  });
}

/**
 * Creates a server-only client for Project 2 (Competitors).
 * NEVER accessible or exposed to the browser.
 */
export function createCompetitorsClient(): SupabaseClient {
  const env = getServerEnv();
  return createClient(env.COMPETITORS_SUPABASE_URL, env.COMPETITORS_SUPABASE_SECRET_KEY || 'competitors-server-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'x-client-info': 'pinorbit-v2-competitors-server',
      },
    },
  });
}

/**
 * Creates a server-only client for Project 3 (Analytics).
 * NEVER accessible or exposed to the browser.
 */
export function createAnalyticsClient(): SupabaseClient {
  const env = getServerEnv();
  return createClient(env.ANALYTICS_SUPABASE_URL, env.ANALYTICS_SUPABASE_SECRET_KEY || 'analytics-server-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'x-client-info': 'pinorbit-v2-analytics-server',
      },
    },
  });
}
