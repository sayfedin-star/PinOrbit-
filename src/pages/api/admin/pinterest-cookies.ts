export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../server/auth/workspace-guard';
import { dbClients } from '../../../server/db/clients';
import { resolveTokenKek, encryptToken } from '../../../server/lib/token-crypto';
import { errorStatus } from '../../../server/lib/http-error';

function getRuntimeEnv(locals: any): Record<string, any> {
  return locals?.runtime?.env || locals?.runtimeEnv || {};
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function authenticateAdmin(request: Request, locals: any, explicitWorkspaceId?: string) {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const runtimeEnv = getRuntimeEnv(locals);

  if (!user || !schedulingClient) {
    return { error: jsonResponse({ success: false, error: 'Unauthorized: missing session' }, 401) };
  }

  const url = new URL(request.url);
  const workspaceId = explicitWorkspaceId || url.searchParams.get('workspace_id') || locals.activeWorkspaceId;

  if (!workspaceId) {
    return { error: jsonResponse({ success: false, error: 'Unauthorized: missing workspace identifier' }, 401) };
  }

  try {
    const wsCtx = await assertWorkspaceAccess(schedulingClient, workspaceId, user.id, 'admin');
    const competitorsClient = dbClients.getCompetitors(runtimeEnv);
    return { ok: { user, workspaceId: wsCtx.workspaceId, competitorsClient, runtimeEnv } };
  } catch (err: any) {
    const status = errorStatus(err);
    return { error: jsonResponse({ success: false, error: err.message || 'Forbidden: Access Denied' }, status) };
  }
}

export const GET: APIRoute = async ({ request, locals }) => {
  const auth = await authenticateAdmin(request, locals);
  if (auth.error) return auth.error;

  const { workspaceId, competitorsClient } = auth.ok!;

  try {
    const { data, error } = await competitorsClient
      .from('pinterest_cookies')
      .select('id, workspace_id, is_active, last_used_at, expires_at, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return jsonResponse({ success: true, cookies: data || [] }, 200);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to fetch cookies' }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  let body: any = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON payload' }, 400);
  }

  const auth = await authenticateAdmin(request, locals, body.workspace_id);
  if (auth.error) return auth.error;

  const { workspaceId, competitorsClient, runtimeEnv } = auth.ok!;
  const cookieValue = body.cookie_value;

  if (!cookieValue || typeof cookieValue !== 'string' || cookieValue.trim().length < 20) {
    return jsonResponse({ success: false, error: 'Invalid cookie value: must be at least 20 characters' }, 400);
  }

  try {
    const kek = await resolveTokenKek(runtimeEnv);
    if (!kek) {
      return jsonResponse({ success: false, error: 'TOKEN_KEK is not configured on the server' }, 500);
    }

    const encryptedValue = await encryptToken(cookieValue.trim(), kek);

    const { data, error } = await competitorsClient
      .from('pinterest_cookies')
      .insert({
        workspace_id: workspaceId,
        cookie_value: encryptedValue,
        is_active: true,
        expires_at: body.expires_at || null,
      })
      .select('id, workspace_id, is_active, last_used_at, expires_at, created_at, updated_at')
      .single();

    if (error) throw error;

    return jsonResponse({ success: true, cookie: data }, 201);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to save cookie' }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  let body: any = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON payload' }, 400);
  }

  const auth = await authenticateAdmin(request, locals, body.workspace_id);
  if (auth.error) return auth.error;

  const { workspaceId, competitorsClient } = auth.ok!;
  const { id, is_active } = body;

  if (!id || is_active === undefined) {
    return jsonResponse({ success: false, error: 'Missing id or is_active field' }, 400);
  }

  try {
    const { data, error } = await competitorsClient
      .from('pinterest_cookies')
      .update({
        is_active: Boolean(is_active),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select('id, workspace_id, is_active, last_used_at, expires_at, created_at, updated_at')
      .single();

    if (error) throw error;

    return jsonResponse({ success: true, cookie: data }, 200);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to update cookie' }, 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  let body: any = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    // Body optional if ID provided in query params
  }

  const url = new URL(request.url);
  const id = body.id || url.searchParams.get('id');

  if (!id) {
    return jsonResponse({ success: false, error: 'Cookie id is required' }, 400);
  }

  const auth = await authenticateAdmin(request, locals, body.workspace_id);
  if (auth.error) return auth.error;

  const { workspaceId, competitorsClient } = auth.ok!;

  try {
    const { error } = await competitorsClient
      .from('pinterest_cookies')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    return jsonResponse({ success: true }, 200);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to delete cookie' }, 500);
  }
};
