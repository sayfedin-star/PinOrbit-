export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../../server/auth/workspace-guard';
import { regenerate } from '../../../../server/services/webhook-secrets';

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};

  if (!user || !schedulingClient) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: authentication required.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (!workspaceId) {
    return new Response(
      JSON.stringify({ success: false, error: 'Active workspace not found in session.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  let body: any = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON body.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const scope = body.scope === 'workspace' ? 'workspace' : 'global';

  try {
    const access = await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    if (!access.isAdmin && !access.isOwner) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Forbidden: Admin or Owner role required to rotate secrets.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // NEW CHECK: Global scope requires platform-level admin
    if (scope === 'global') {
      const { data: platformAdmin } = await schedulingClient
        .from('admin_users')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!platformAdmin) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Forbidden: Platform admin role required for global secret rotation.',
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    const nextSecret = await regenerate(
      scope,
      scope === 'workspace' ? workspaceId : undefined,
      runtimeEnv
    );

    return new Response(
      JSON.stringify({
        success: true,
        secret: nextSecret,
        scope,
        message: `Successfully rotated ${scope} secret. Make.com headers must be updated immediately.`,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    const isAuth = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized');
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to regenerate ingest secret.',
      }),
      {
        status: isAuth ? 403 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
