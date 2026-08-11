import { defineMiddleware } from 'astro:middleware';
import { dbClients } from './server/db/clients';
import { validateUserSession } from './server/auth/session';
import { ACTIVE_WORKSPACE_COOKIE } from './lib/workspaces';

export const onRequest = defineMiddleware(async (context, next) => {
  // Merge Cloudflare Worker runtime secrets into process.env if available
  const runtimeEnv = (context.locals as { runtime?: { env?: Record<string, unknown> } })?.runtime?.env;
  if (runtimeEnv && typeof process !== 'undefined' && process.env) {
    Object.assign(process.env, runtimeEnv);
  }

  // Initialize request-scoped Project 1 Scheduling / Auth client
  const supabase = dbClients.getSchedulingSSR({
    cookies: {
      get(key: string) {
        const c = context.cookies.get(key);
        return c?.value;
      },
      set(key: string, value: string, options?: Record<string, unknown>) {
        context.cookies.set(key, value, {
          path: '/',
          sameSite: 'lax',
          secure: true,
          ...options,
        });
      },
      delete(key: string, options?: Record<string, unknown>) {
        context.cookies.delete(key, {
          path: '/',
          ...options,
        });
      },
    },
  });

  // Attach client and resolve identity server-side
  context.locals.supabase = supabase;

  const session = await validateUserSession(supabase);
  context.locals.user = session.user;
  context.locals.isAuthenticated = session.isAuthenticated;

  // Extract optional workspace header or cookie if present
  const workspaceCookie =
    context.cookies.get(ACTIVE_WORKSPACE_COOKIE)?.value ??
    context.cookies.get('pinorbit_workspace_id')?.value;

  if (workspaceCookie) {
    context.locals.activeWorkspaceId = workspaceCookie;
  }

  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // 1. Explicitly allow public routes, auth endpoints, internal webhook endpoints, and static assets
  const isPublicRoute =
    pathname === '/login' ||
    pathname.startsWith('/api/admin/bootstrap') ||
    pathname === '/api/internal/pinterest/ingest' ||
    pathname === '/api/internal/pinterest/daily-dispatch' ||
    pathname === '/api/internal/pinterest/cleanup-retention' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_astro') ||
    pathname === '/favicon.svg';

  if (isPublicRoute) {
    return next();
  }

  // 2. Protected paths requiring authentication
  const isProtectedPath =
    pathname.startsWith('/dashboard') || 
    pathname.startsWith('/analytics') ||
    pathname.startsWith('/accounts') || 
    pathname.startsWith('/competitors') || 
    pathname.startsWith('/imports') || 
    pathname.startsWith('/boards') ||
    pathname.startsWith('/pins') ||
    pathname.startsWith('/logs') || 
    pathname.startsWith('/audit');

  if (isProtectedPath && !session.isAuthenticated) {
    return context.redirect(`/login?redirect=${encodeURIComponent(pathname)}`);
  }

  return next();
});
