export const prerender = false;

import type { APIRoute } from 'astro';
import { dbClients, isKnownDefaultIngestSecret, isProductionEnv } from '../../../../server/db/clients';
import { getEffectiveSecret } from '../../../../server/services/webhook-secrets';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as { runtime?: { env?: Record<string, any> }; runtimeEnv?: Record<string, any> })?.runtime?.env || (locals as { runtimeEnv?: Record<string, any> })?.runtimeEnv || {};

  // 1. Extract and validate workspace_id from header or JSON body
  let workspaceId = request.headers.get('x-workspace-id')?.trim();

  const text = await request.text();
  if (text && text.trim().length > 0) {
    let body: Record<string, any>;
    try {
      body = JSON.parse(text);
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Malformed JSON payload: ' + err.message,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (body && typeof body.workspace_id === 'string' && body.workspace_id.trim().length > 0) {
      workspaceId = body.workspace_id.trim();
    }
  }

  if (!workspaceId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'workspace_id is required in JSON body or x-workspace-id header.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 2. Authenticate
  const secret = request.headers.get('x-ingest-secret') || request.headers.get('x-dispatch-secret');
  const expected = await getEffectiveSecret(workspaceId, runtimeEnv);

  if (isProductionEnv(runtimeEnv) && expected.source === 'env' && isKnownDefaultIngestSecret(expected.value)) {
    return new Response(JSON.stringify({ success: false, error: 'Service unavailable: ingest secret not configured on server.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  if (!secret || !expected.value || secret !== expected.value) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: invalid or missing x-ingest-secret.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 3. Dynamic Retention Cleanup & Orphan Sweep
  try {
    const schedulingAdmin = dbClients.getSchedulingAdmin(runtimeEnv);
    const analyticsClient = dbClients.getAnalytics(runtimeEnv);

    // Read workspace retention settings (with fallbacks)
    const { data: wsSettings } = await schedulingAdmin
      .from('workspace_retention_settings')
      .select('retention_posted_days, processing_timeout_minutes')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    const retentionPostedDays = wsSettings?.retention_posted_days ?? 30;
    const processingTimeoutMinutes = wsSettings?.processing_timeout_minutes ?? 45;

    // Purge posted pins older than workspace retention days
    const postedCutoff = new Date(Date.now() - retentionPostedDays * 86400000).toISOString();
    const { count: deletedPinsCount, error: pinDeleteErr } = await schedulingAdmin
      .from('pins')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('status', 'posted')
      .lt('posted_at', postedCutoff);

    if (pinDeleteErr) throw pinDeleteErr;

    // Sweep orphaned processing pins back to pending
    const sweepCutoff = new Date(Date.now() - processingTimeoutMinutes * 60000).toISOString();
    const { count: sweptPinsCount, error: sweepErr } = await schedulingAdmin
      .from('pins')
      .update({
        status: 'pending',
        processing_started_at: null,
        claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('status', 'processing')
      .lt('claimed_at', sweepCutoff)
      .lt('attempts', 2);

    if (sweepErr) throw sweepErr;

    // Analytics snapshot cleanup
    const snapshotCutoff = new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];
    const { count: deletedSnapshotsCount, error: snapErr } = await analyticsClient
      .from('top_pins_snapshots')
      .delete()
      .eq('workspace_id', workspaceId)
      .lt('window_end', snapshotCutoff);

    if (snapErr) throw snapErr;

    return new Response(
      JSON.stringify({
        success: true,
        workspace_id: workspaceId,
        retention_posted_days: retentionPostedDays,
        processing_timeout_minutes: processingTimeoutMinutes,
        deleted_pins_count: deletedPinsCount ?? 0,
        swept_pins_count: sweptPinsCount ?? 0,
        deleted_snapshots_count: deletedSnapshotsCount ?? 0,
        posted_cutoff: postedCutoff,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Retention cleanup failed.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
