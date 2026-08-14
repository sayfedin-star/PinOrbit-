export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../server/auth/workspace-guard';
import { dbClients, isKnownDefaultKek, isProductionEnv } from '../../../server/db/clients';
import { encryptToken, resolveTokenKek } from '../../../server/lib/token-crypto';
import { maskSecret } from '../../../server/services/webhook-secrets';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};

  if (!user || !schedulingClient) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!workspaceId) {
    return new Response(JSON.stringify({ error: 'Active workspace not found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    const adminClient = dbClients.getSchedulingAdmin(runtimeEnv);
    const { data: tokens, error } = await adminClient
      .from('fastcron_tokens')
      .select('id, workspace_id, name, token_masked, is_default, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return new Response(JSON.stringify(tokens || []), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to fetch tokens' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const workspaceId = locals.activeWorkspaceId;
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};

  if (!user || !schedulingClient) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!workspaceId) {
    return new Response(JSON.stringify({ error: 'Active workspace not found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const rawToken = typeof body.token === 'string' ? body.token.trim() : '';
  const isDefault = Boolean(body.is_default);

  if (!name) {
    return new Response(JSON.stringify({ error: 'Token name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (!rawToken || rawToken.length < 16) {
    return new Response(JSON.stringify({ error: 'FastCron token must be at least 16 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id, 'admin');
    const kek = await resolveTokenKek(runtimeEnv);
    if (!kek || (isProductionEnv(runtimeEnv) && isKnownDefaultKek(kek))) {
      return new Response(JSON.stringify({ error: 'TOKEN_KEK unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    const encrypted = await encryptToken(rawToken, kek);
    const masked = maskSecret(rawToken);
    const adminClient = dbClients.getSchedulingAdmin(runtimeEnv);

    if (isDefault) {
      await adminClient.from('fastcron_tokens').update({ is_default: false }).eq('workspace_id', workspaceId);
    }

    const { data: inserted, error: insertErr } = await adminClient
      .from('fastcron_tokens')
      .insert({
        workspace_id: workspaceId,
        name,
        token_encrypted: encrypted,
        token_masked: masked,
        is_default: isDefault,
      })
      .select('id, workspace_id, name, token_masked, is_default, created_at, updated_at')
      .single();

    if (insertErr || !inserted) throw insertErr || new Error('Failed to save token');

    return new Response(JSON.stringify(inserted), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to create token' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
