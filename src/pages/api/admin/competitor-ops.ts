export const prerender = false;

import type { APIRoute } from 'astro';
import { assertWorkspaceAccess } from '../../../server/auth/workspace-guard';
import { dbClients } from '../../../server/db/clients';
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
    // 1. Pipeline Settings
    const { data: pipelineSettings } = await competitorsClient
      .from('competitor_pipeline_settings')
      .select('id, workspace_id, is_enabled, dry_run, max_retries, updated_at')
      .eq('id', true)
      .maybeSingle();

    const fallbackSettings = {
      id: true,
      workspace_id: workspaceId,
      is_enabled: true,
      dry_run: false,
      max_retries: 3,
      updated_at: null,
    };

    // 2. Competitors with settings
    const { data: competitors, error: compErr } = await competitorsClient
      .from('competitors')
      .select('id, username, full_name, avatar_url, is_active, last_checked_at, profile_reach, profile_views, follower_count, pin_count, competitor_settings(is_active, update_frequency_hours, last_manual_update)')
      .eq('workspace_id', workspaceId)
      .order('username', { ascending: true });

    if (compErr) throw compErr;

    // 3. Recent 15 ingestion jobs
    const { data: jobs, error: jobsErr } = await competitorsClient
      .from('competitor_ingestion_jobs')
      .select('id, workspace_id, competitor_id, status, items_processed, error_message, started_at, completed_at, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(15);

    if (jobsErr) throw jobsErr;

    return jsonResponse(
      {
        success: true,
        settings: pipelineSettings || fallbackSettings,
        competitors: competitors || [],
        jobs: jobs || [],
      },
      200
    );
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to load competitor ops state' }, 500);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
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

  const isEnabled = body.is_enabled !== undefined ? Boolean(body.is_enabled) : true;
  const dryRun = body.dry_run !== undefined ? Boolean(body.dry_run) : false;
  const maxRetries = Number.isInteger(body.max_retries) ? Math.max(1, Math.min(10, body.max_retries)) : 3;

  try {
    const { data, error } = await competitorsClient
      .from('competitor_pipeline_settings')
      .upsert(
        {
          id: true,
          workspace_id: workspaceId,
          is_enabled: isEnabled,
          dry_run: dryRun,
          max_retries: maxRetries,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select('id, workspace_id, is_enabled, dry_run, max_retries, updated_at')
      .single();

    if (error) throw error;

    return jsonResponse({ success: true, settings: data }, 200);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to update pipeline settings' }, 500);
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
  const { competitor_id, is_active, update_frequency_hours } = body;

  if (!competitor_id) {
    return jsonResponse({ success: false, error: 'competitor_id is required' }, 400);
  }

  try {
    // 1. If is_active is provided, update competitors table
    if (is_active !== undefined) {
      await competitorsClient
        .from('competitors')
        .update({ is_active: Boolean(is_active) })
        .eq('id', competitor_id)
        .eq('workspace_id', workspaceId);
    }

    // 2. Fetch existing settings or default
    const { data: existing } = await competitorsClient
      .from('competitor_settings')
      .select('id, competitor_id, is_active, update_frequency_hours')
      .eq('competitor_id', competitor_id)
      .maybeSingle();

    const newActive = is_active !== undefined ? Boolean(is_active) : existing?.is_active ?? true;
    const newFreq = update_frequency_hours !== undefined ? Number(update_frequency_hours) : existing?.update_frequency_hours ?? 24;

    const { data: updatedSetting, error: settingErr } = await competitorsClient
      .from('competitor_settings')
      .upsert(
        {
          competitor_id,
          is_active: newActive,
          update_frequency_hours: newFreq,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'competitor_id' }
      )
      .select('id, competitor_id, is_active, update_frequency_hours, last_manual_update, updated_at')
      .single();

    if (settingErr) throw settingErr;

    return jsonResponse(
      {
        success: true,
        competitor_id,
        setting: updatedSetting,
      },
      200
    );
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to update competitor settings' }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  let body: any = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    // Empty body is valid for full update
  }

  const auth = await authenticateAdmin(request, locals, body.workspace_id);
  if (auth.error) return auth.error;

  const { workspaceId, competitorsClient, runtimeEnv } = auth.ok!;
  const competitorId = body.competitor_id || null;
  const username = body.username || null;

  try {
    // 1. Insert job with queued status
    const { data: job, error: jobErr } = await competitorsClient
      .from('competitor_ingestion_jobs')
      .insert({
        workspace_id: workspaceId,
        competitor_id: competitorId,
        status: 'queued',
        items_processed: 0,
      })
      .select('id, workspace_id, competitor_id, status, created_at')
      .single();

    if (jobErr) throw jobErr;

    // 2. Best-effort GitHub Actions repository_dispatch
    const token =
      runtimeEnv.GITHUB_DISPATCH_TOKEN ??
      (typeof process !== 'undefined' ? process.env.GITHUB_DISPATCH_TOKEN : undefined);
    const repo =
      runtimeEnv.GITHUB_REPO ??
      (typeof process !== 'undefined' ? process.env.GITHUB_REPO : undefined) ??
      'sayfedin-star/pinorbit-v2';

    let dispatched = false;
    let warning: string | null = null;

    if (token) {
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'pinorbit-console',
          },
          body: JSON.stringify({
            event_type: 'update-competitor',
            client_payload: {
              job_id: job.id,
              username: username || null,
              workspace_id: workspaceId,
            },
          }),
          signal: AbortSignal.timeout(8000),
        });

        dispatched = res.status === 204;
        if (!dispatched) {
          warning = `GitHub dispatch failed: HTTP ${res.status}`;
        }
      } catch (e: any) {
        warning = `GitHub dispatch error: ${e.message}`;
      }
    } else {
      warning = 'GITHUB_DISPATCH_TOKEN not configured — job queued; run GitHub Action manually.';
    }

    return jsonResponse(
      {
        success: true,
        job_id: job.id,
        dispatched,
        warning,
      },
      202
    );
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to dispatch competitor update' }, 500);
  }
};
