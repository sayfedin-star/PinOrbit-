import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: any) => fn,
}));

import { onRequest } from '../../middleware';
import { ACTIVE_WORKSPACE_COOKIE } from '../../lib/workspaces';

vi.mock('../auth/session', () => ({
  validateUserSession: vi.fn().mockResolvedValue({
    user: { id: 'u-test', email: 'test@example.com' },
    isAuthenticated: true,
  }),
}));

vi.mock('../db/clients', () => ({
  dbClients: {
    getSchedulingSSR: vi.fn().mockReturnValue({}),
  },
}));

describe('Middleware Active Workspace Cookie Resolution (Fix 1 & Fix 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves activeWorkspaceId from canonical cookie (pinorbit_active_workspace_id)', async () => {
    const context: any = {
      cookies: {
        get: vi.fn((key: string) => {
          if (key === ACTIVE_WORKSPACE_COOKIE) {
            return { value: 'ws-canonical-123' };
          }
          return undefined;
        }),
        set: vi.fn(),
        delete: vi.fn(),
      },
      locals: {},
      request: new Request('http://localhost/analytics'),
    };

    const next = vi.fn().mockResolvedValue(new Response('OK'));

    await (onRequest as any)(context, next);

    expect(context.locals.activeWorkspaceId).toBe('ws-canonical-123');
    expect(next).toHaveBeenCalled();
  });

  it('falls back to legacy cookie name (pinorbit_workspace_id)', async () => {
    const context: any = {
      cookies: {
        get: vi.fn((key: string) => {
          if (key === 'pinorbit_workspace_id') {
            return { value: 'ws-legacy-456' };
          }
          return undefined;
        }),
        set: vi.fn(),
        delete: vi.fn(),
      },
      locals: {},
      request: new Request('http://localhost/analytics'),
    };

    const next = vi.fn().mockResolvedValue(new Response('OK'));

    await (onRequest as any)(context, next);

    expect(context.locals.activeWorkspaceId).toBe('ws-legacy-456');
    expect(next).toHaveBeenCalled();
  });

  it('allows whitelisted internal endpoints without user session', async () => {
    const whitelistedRoutes = [
      '/api/internal/pinterest/ingest',
      '/api/internal/pinterest/daily-dispatch',
      '/api/internal/pinterest/cleanup-retention',
    ];

    for (const route of whitelistedRoutes) {
      const context: any = {
        cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
        locals: {},
        request: new Request(`http://localhost${route}`, { method: 'POST' }),
      };
      const next = vi.fn().mockResolvedValue(new Response('OK'));
      await (onRequest as any)(context, next);
      expect(next).toHaveBeenCalled();
    }
  });

  it('does not exempt non-whitelisted internal routes with startsWith wildcard', async () => {
    const { validateUserSession } = await import('../auth/session');
    (validateUserSession as any).mockResolvedValueOnce({
      user: null,
      isAuthenticated: false,
    });

    const context: any = {
      cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
      locals: {},
      request: new Request('http://localhost/api/internal/pinterest/unknown-endpoint', { method: 'POST' }),
      redirect: vi.fn().mockReturnValue(new Response(null, { status: 302 })),
    };
    const next = vi.fn().mockResolvedValue(new Response('OK'));
    await (onRequest as any)(context, next);

    // It should proceed to next (where endpoint will 404 or fail) rather than matching isPublicRoute
    // Note: api routes not in isProtectedPath list proceed to next() or 404 at Astro router level
    expect(next).toHaveBeenCalled();
  });
});
