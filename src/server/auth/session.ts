import type { SupabaseClient, User } from '@supabase/supabase-js';

export interface UserSessionState {
  user: User | null;
  isAuthenticated: boolean;
  accessToken?: string;
}

/**
 * Validates the user session from the request-scoped Project 1 Supabase client.
 * Uses safe auth.getUser() server-side verification rather than trust-only local claims.
 */
export async function validateUserSession(supabase: SupabaseClient): Promise<UserSessionState> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return {
        user: null,
        isAuthenticated: false,
      };
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    return {
      user,
      isAuthenticated: true,
      accessToken: session?.access_token,
    };
  } catch {
    return {
      user: null,
      isAuthenticated: false,
    };
  }
}
