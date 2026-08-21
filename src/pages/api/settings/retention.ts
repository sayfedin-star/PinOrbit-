export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../server/auth/workspace-guard';
import { dbClients } from '../../../server/db/clients';
import { clampRetentionPostedDays, clampProcessingTimeoutMinutes } from '../../../server/services/scheduling-logic';

export const GET: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id') || locals.activeWorkspaceId;

  if (!user || !schedulingClient || !workspaceId) {
    return new Response(JSON.stringify({ error: 'Unauthorized or missing workspace ID' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id);
    const adminClient = dbClients.getSchedulingAdmin(runtimeEnv);

    const { data: settings, error } = await adminClient
      .from('workspace_retention_settings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!settings) {
      return new Response(
        JSON.stringify({
          workspace_id: workspaceId,
          retention_posted_days: 30,
          processing_timeout_minutes: 45,
          is_default: true,
          last_cleanup_at: null,
          last_cleanup_result: null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        workspace_id: settings.workspace_id,
        retention_posted_days: settings.retention_posted_days ?? 30,
        processing_timeout_minutes: settings.processing_timeout_minutes ?? 45,
        is_default: false,
        updated_at: settings.updated_at,
        last_cleanup_at: settings.last_cleanup_at ?? null,
        last_cleanup_result: settings.last_cleanup_result ?? null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to load retention settings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const schedulingClient = locals.supabase;
  const runtimeEnv = (locals as any)?.runtime?.env || (locals as any)?.runtimeEnv || {};

  if (!user || !schedulingClient) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const workspaceId = body.workspace_id || locals.activeWorkspaceId;
  if (!workspaceId) {
    return new Response(JSON.stringify({ error: 'workspace_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await assertWorkspaceAccess(schedulingClient, workspaceId, user.id, 'admin');
    const adminClient = dbClients.getSchedulingAdmin(runtimeEnv);

    // Fetch existing or fallback
    const { data: existing } = await adminClient
      .from('workspace_retention_settings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    const rawDays = body.retention_posted_days !== undefined ? body.retention_posted_days : existing?.retention_posted_days;
    const rawTimeout = body.processing_timeout_minutes !== undefined ? body.processing_timeout_minutes : existing?.processing_timeout_minutes;

    // Clamp ranges: days 1–365, minutes 5–240
    const clampedRetentionDays = clampRetentionPostedDays(rawDays);
    const clampedProcessingTimeoutMinutes = clampProcessingTimeoutMinutes(rawTimeout);

    const { data: saved, error: upsertErr } = await adminClient
      .from('workspace_retention_settings')
      .upsert(
        {
          ...(existing ?? {}),
          workspace_id: workspaceId,
          retention_posted_days: clampedRetentionDays,
          processing_timeout_minutes: clampedProcessingTimeoutMinutes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id' }
      )
      .select('workspace_id, retention_posted_days, processing_timeout_minutes, updated_at')
      .single();

    if (upsertErr) throw upsertErr;

    return new Response(
      JSON.stringify({
        success: true,
        workspace_id: saved.workspace_id,
        retention_posted_days: saved.retention_posted_days,
        processing_timeout_minutes: saved.processing_timeout_minutes,
        is_default: false,
        updated_at: saved.updated_at,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to update retention settings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
