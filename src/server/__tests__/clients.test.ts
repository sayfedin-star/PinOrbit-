import { describe, it, expect, vi } from 'vitest';
import { dbClients, getServerEnv } from '../db/clients';
import { assertWorkspaceAccess } from '../auth/workspace-guard';
import { validateUserSession } from '../auth/session';

describe('PinOrbit v2 Multi-Project Server Architecture', () => {
  it('loads canonical environment configuration with default fallbacks', () => {
    const config = getServerEnv();
    expect(config.SCHEDULING_SUPABASE_URL).toBeDefined();
    expect(config.SCHEDULING_SUPABASE_PUBLISHABLE_KEY).toBeDefined();
    expect(config.COMPETITORS_SUPABASE_URL).toBeDefined();
    expect(config.ANALYTICS_SUPABASE_URL).toBeDefined();
  });

  it('instantiates singletons for Project 2 and Project 3', () => {
    const compClient1 = dbClients.getCompetitors();
    const compClient2 = dbClients.getCompetitors();
    expect(compClient1).toBe(compClient2);

    const analyticsClient1 = dbClients.getAnalytics();
    const analyticsClient2 = dbClients.getAnalytics();
    expect(analyticsClient1).toBe(analyticsClient2);
  });

  it('assertWorkspaceAccess throws error when user is not a workspace member', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Row not found' },
              }),
            }),
          }),
        }),
      }),
    } as any;

    await expect(
      assertWorkspaceAccess(mockSupabase, 'ws-123', 'user-456')
    ).rejects.toThrow('Forbidden: User user-456 is not a member of workspace ws-123.');
  });

  it('assertWorkspaceAccess returns workspace context when membership is verified', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  workspace_id: 'ws-123',
                  user_id: 'user-456',
                  role: 'owner',
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as any;

    const result = await assertWorkspaceAccess(mockSupabase, 'ws-123', 'user-456');
    expect(result.workspaceId).toBe('ws-123');
    expect(result.isOwner).toBe(true);
    expect(result.isAdmin).toBe(true);
  });

  it('validateUserSession returns unauthenticated state when user is not found', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('No session') }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      },
    } as any;

    const session = await validateUserSession(mockSupabase);
    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });

  it('F-07: getServerEnv throws in production if TOKEN_KEK is missing or < 16 chars', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalTokenKek = process.env.TOKEN_KEK;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.TOKEN_KEK;

      expect(() => getServerEnv({})).toThrow(/TOKEN_KEK is required in production/);

      // Short key (< 16 chars)
      expect(() => getServerEnv({ TOKEN_KEK: 'short_key_123' })).toThrow(/TOKEN_KEK is required in production/);

      // Valid key (>= 16 chars)
      const validEnv = getServerEnv({ TOKEN_KEK: 'valid_prod_token_kek_12345678' });
      expect(validEnv.TOKEN_KEK).toBe('valid_prod_token_kek_12345678');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalTokenKek !== undefined) {
        process.env.TOKEN_KEK = originalTokenKek;
      } else {
        delete process.env.TOKEN_KEK;
      }
      errorSpy.mockRestore();
    }
  });
});
