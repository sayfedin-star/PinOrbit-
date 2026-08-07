import {
  createSchedulingSSRClient,
  createSchedulingAdminClient,
  createCompetitorsClient,
  createAnalyticsClient,
  getServerEnv,
  type ServerEnvConfig,
} from './client-factory';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Single Canonical Server Client Module for PinOrbit Greenfield Architecture.
 *
 * Directives:
 * 1. Project 1 (Scheduling) is the sole authority for identity, sessions, and workspaces.
 * 2. Projects 2 (Competitors) and 3 (Analytics) are server-only and require prior Project 1 authorization.
 * 3. Browser code never receives secrets or direct access to Projects 2 and 3.
 */

// Singleton instances for persistent server-side connection pooling
let competitorsClientInstance: SupabaseClient | null = null;
let analyticsClientInstance: SupabaseClient | null = null;
let schedulingAdminClientInstance: SupabaseClient | null = null;

export const dbClients = {
  /**
   * Returns a request-scoped client for Project 1 (Scheduling / Auth)
   * used in Astro SSR pages and API endpoints.
   */
  getSchedulingSSR(context: {
    cookies: {
      get: (key: string) => { value: string } | undefined;
      set: (key: string, value: string, options: Record<string, unknown>) => void;
      delete: (key: string, options: Record<string, unknown>) => void;
    };
  }): SupabaseClient {
    return createSchedulingSSRClient(context);
  },

  /**
   * Returns the server-only administrative client for Project 1 (Scheduling).
   */
  getSchedulingAdmin(): SupabaseClient {
    if (!schedulingAdminClientInstance) {
      schedulingAdminClientInstance = createSchedulingAdminClient();
    }
    return schedulingAdminClientInstance;
  },

  /**
   * Returns the server-only client for Project 2 (Competitors).
   * MUST only be called after verifying workspace membership via Project 1.
   */
  getCompetitors(): SupabaseClient {
    if (!competitorsClientInstance) {
      competitorsClientInstance = createCompetitorsClient();
    }
    return competitorsClientInstance;
  },

  /**
   * Returns the server-only client for Project 3 (Analytics).
   * MUST only be called after verifying workspace membership via Project 1.
   */
  getAnalytics(): SupabaseClient {
    if (!analyticsClientInstance) {
      analyticsClientInstance = createAnalyticsClient();
    }
    return analyticsClientInstance;
  },

  /**
   * Helper to inspect environment configuration on the server.
   */
  getConfig(): ServerEnvConfig {
    return getServerEnv();
  },
};

export {
  createSchedulingSSRClient,
  createSchedulingAdminClient,
  createCompetitorsClient,
  createAnalyticsClient,
  getServerEnv,
};
