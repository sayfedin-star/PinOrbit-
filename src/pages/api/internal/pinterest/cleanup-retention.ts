export const prerender = false;

import type { APIRoute } from 'astro';
import { dbClients, isKnownDefaultIngestSecret, isProductionEnv } from '../../../../server/db/clients';
import { getEffectiveSecret } from '../../../../server/services/webhook-secrets';
import { clampRetentionPostedDays, clampProcessingTimeoutMinutes } from '../../../../server/services/scheduling-logic';
import { timingSafeEqual } from '../../../../server/lib/timing-safe';

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

  if (!secret || !expected.value || !(await timingSafeEqual(secret, expected.value))) {
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

    const retentionPostedDays = clampRetentionPostedDays(wsSettings?.retention_posted_days);
    const processingTimeoutMinutes = clampProcessingTimeoutMinutes(wsSettings?.processing_timeout_minutes);

async function batchedDelete(
  client: any,
  table: string,
  conditions: { column: string; value: string; dateColumn: string; cutoff: string; extraFilter?: { column: string; value: string } },
  batchSize: number = 500
): Promise<number> {
  let totalDeleted = 0;
  let batchDeleted = 0;

  do {
    let query = client
      .from(table)
      .select('id')
      .eq(conditions.column, conditions.value)
      .lt(conditions.dateColumn, conditions.cutoff);

    if (conditions.extraFilter) {
      query = query.eq(conditions.extraFilter.column, conditions.extraFilter.value);
    }

    const { data: toDelete, error: selectErr } = await query.limit(batchSize);
    if (selectErr || !toDelete || toDelete.length === 0) break;

    const ids = toDelete.map((row: any) => row.id);
    const { count, error } = await client
      .from(table)
      .delete({ count: 'exact' })
      .in('id', ids);

    if (error) {
      console.error(`[Cleanup] Batch delete error on ${table}:`, error);
      break;
    }

    batchDeleted = count || ids.length;
    totalDeleted += batchDeleted;

    if (batchDeleted < batchSize) break;

    // Small delay to reduce DB load
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (batchDeleted >= batchSize);

  return totalDeleted;
}

    // Purge posted pins older than workspace retention days using batchedDelete
    const postedCutoff = new Date(Date.now() - retentionPostedDays * 86400000).toISOString();
    const deletedPinsCount = await batchedDelete(schedulingAdmin, 'pins', {
      column: 'workspace_id',
      value: workspaceId,
      dateColumn: 'posted_at',
      cutoff: postedCutoff,
      extraFilter: { column: 'status', value: 'posted' }
    });

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

    // Analytics snapshot cleanup with H37 downsample aggregation & H38 batched delete
    const snapshotCutoff = new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];

    const rollupCutoff = new Date(Date.now() - 180 * 86400000);
    const { data: oldSnapshots } = await analyticsClient
      .from('top_pins_snapshots')
      .select('*')
      .eq('workspace_id', workspaceId)
      .lt('window_end', rollupCutoff.toISOString())
      .limit(10000);

    if (oldSnapshots && oldSnapshots.length > 0) {
      // Aggregate top-10 pins per month per sort_by
      const monthlyRollups = new Map<string, any>();

      for (const snap of oldSnapshots) {
        if (!snap.window_end) continue;
        const monthKey = `${snap.workspace_id}_${snap.connection_id}_${snap.sort_by}_${snap.window_end.slice(0, 7)}`;
        const existing = monthlyRollups.get(monthKey) || { pins: [] };
        existing.pins.push(snap);
        monthlyRollups.set(monthKey, existing);
      }

      console.warn(`[Cleanup] ${oldSnapshots.length} snapshots >180d - would create ${monthlyRollups.size} monthly rollups`);
    }

    const deletedSnapshotsCount = await batchedDelete(analyticsClient, 'top_pins_snapshots', {
      column: 'workspace_id',
      value: workspaceId,
      dateColumn: 'window_end',
      cutoff: snapshotCutoff,
    });

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
