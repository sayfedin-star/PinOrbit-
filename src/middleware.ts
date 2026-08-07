import { defineMiddleware } from 'astro:middleware';
import { dbClients } from './server/db/clients';
import { validateUserSession } from './server/auth/session';

export const onRequest = defineMiddleware(async (context, next) => {
  // Initialize request-scoped Project 1 Scheduling / Auth client
  const supabase = dbClients.getSchedulingSSR({
    cookies: {
      get(key: string) {
        return context.cookies.get(key);
      },
      set(key: string, value: string, options: Record<string, unknown>) {
        context.cookies.set(key, value, options);
      },
      delete(key: string, options: Record<string, unknown>) {
        context.cookies.delete(key, options);
      },
    },
  });

  // Attach client and resolve identity server-side
  context.locals.supabase = supabase;

  const session = await validateUserSession(supabase);
  context.locals.user = session.user;
  context.locals.isAuthenticated = session.isAuthenticated;

  // Extract optional workspace header or cookie if present
  const workspaceCookie = context.cookies.get('pinorbit_workspace_id')?.value;
  if (workspaceCookie) {
    context.locals.activeWorkspaceId = workspaceCookie;
  }

  // Enforce server-side route guards for protected paths
  const url = new URL(context.request.url);
  const isProtectedPath = url.pathname.startsWith('/dashboard') || 
                          url.pathname.startsWith('/accounts') || 
                          url.pathname.startsWith('/competitors') || 
                          url.pathname.startsWith('/imports') || 
                          url.pathname.startsWith('/logs') || 
                          url.pathname.startsWith('/audit');

  if (isProtectedPath && !session.isAuthenticated) {
    return context.redirect(`/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  return next();
});
