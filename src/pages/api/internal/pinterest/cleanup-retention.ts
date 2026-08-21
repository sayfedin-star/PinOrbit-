export const prerender = false;

import type { APIRoute } from 'astro';
import { dbClients, isKnownDefaultIngestSecret, isProductionEnv } from '../../../../server/db/clients';
import { getEffectiveSecret } from '../../../../server/services/webhook-secrets';
import { clampRetentionPostedDays, clampProcessingTimeoutMinutes } from '../../../../server/services/scheduling-logic';

interface BatchedDeleteOptions {
  column: string;
  value: string;
  dateColumn: string;
  cutoff: string;
  extraFilter?: { column: string; value: string };
  batchSize?: number;
}

async function batchedDelete(
  client: any,
  table: string,
  options: BatchedDeleteOptions
): Promise<number> {
  let totalDeleted = 0;
  const batchSize = options.batchSize || 100;

  while (true) {
    let query = client
      .from(table)
      .select('id')
      .eq(options.column, options.value)
      .lt(options.dateColumn, options.cutoff)
      .limit(batchSize);

    if (options.extraFilter) {
      query = query.eq(options.extraFilter.column, options.extraFilter.value);
    }

    const { data: rows, error: selectErr } = await query;
    if (selectErr) throw selectErr;
    if (!rows || rows.length === 0) break;

    const ids = rows.map((r: any) => r.id);
    const { error: deleteErr } = await client
      .from(table)
      .delete()
      .in('id', ids);

    if (deleteErr) throw deleteErr;
    totalDeleted += ids.length;

    if (rows.length < batchSize) break;
  }

  return totalDeleted;
}

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

    // Read workspace retention settings (with fallbacks)
    const { data: wsSettings } = await schedulingAdmin
      .from('workspace_retention_settings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    const retentionPostedDays = clampRetentionPostedDays(wsSettings?.retention_posted_days);
    const processingTimeoutMinutes = clampProcessingTimeoutMinutes(wsSettings?.processing_timeout_minutes);
    const postedCutoff = new Date(Date.now() - retentionPostedDays * 86400000).toISOString();

    let deletedPinsCount = 0;
    let deletedTerminalCount = 0;
    let deletedLogs: any = 0;
    let deletedSessions = 0;
    let p2Result: any = null;
    let deletedRuns: any = 0;
    let deletedSnapshotsCount = 0;
    const warnings: string[] = [];

    // P1 Gate
    if (wsSettings?.auto_prune_enabled) {
      try {
        // 1. Purge posted pins older than workspace retention days
        const { count: delCount, error: pinDeleteErr } = await schedulingAdmin
          .from('pins')
          .delete({ count: 'exact' })
          .eq('workspace_id', workspaceId)
          .eq('status', 'posted')
          .lt('posted_at', postedCutoff);

        if (pinDeleteErr) throw pinDeleteErr;
        deletedPinsCount = delCount ?? 0;

        // 2. Terminal pins: failed & cancelled
        const terminalDays = typeof wsSettings?.retention_terminal_days === 'number' ? wsSettings.retention_terminal_days : 90;
        const terminalCutoff = new Date(Date.now() - terminalDays * 86400000).toISOString();
        const delFailed = await batchedDelete(schedulingAdmin, 'pins', {
          column: 'workspace_id',
          value: workspaceId,
          dateColumn: 'updated_at',
          cutoff: terminalCutoff,
          extraFilter: { column: 'status', value: 'failed' },
        });
        const delCancelled = await batchedDelete(schedulingAdmin, 'pins', {
          column: 'workspace_id',
          value: workspaceId,
          dateColumn: 'updated_at',
          cutoff: terminalCutoff,
          extraFilter: { column: 'status', value: 'cancelled' },
        });
        deletedTerminalCount = delFailed + delCancelled;

        // 3. Pin delivery logs RPC
        const logsDays = typeof wsSettings?.retention_logs_days === 'number' ? wsSettings.retention_logs_days : 14;
        const { data: logsData, error: logsErr } = await schedulingAdmin.rpc('purge_old_pin_delivery_logs', {
          p_keep_success_days: logsDays,
          p_keep_failure_days: Math.max(logsDays, 30),
          p_workspace_id: workspaceId,
        });
        if (logsErr) throw logsErr;
        deletedLogs = logsData ?? 'purged';

        // 4. Import sessions
        const importDays = typeof wsSettings?.import_sessions_days === 'number' ? wsSettings.import_sessions_days : 30;
        const sessionsCutoff = new Date(Date.now() - importDays * 86400000).toISOString();
        deletedSessions = await batchedDelete(schedulingAdmin, 'import_sessions', {
          column: 'workspace_id',
          value: workspaceId,
          dateColumn: 'created_at',
          cutoff: sessionsCutoff,
        });
      } catch (p1Err: any) {
        console.error('[Retention] P1 prune failed:', p1Err);
        warnings.push(`P1 prune failed: ${p1Err.message || String(p1Err)}`);
      }
    }

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

    // P2 Gate
    if (wsSettings?.p2_prune_enabled) {
      try {
        const competitorsClient = dbClients.getCompetitors(runtimeEnv);
        const compSnapshotsDays = typeof wsSettings?.competitor_snapshots_days === 'number' ? wsSettings.competitor_snapshots_days : 90;
        const compJobsDays = typeof wsSettings?.competitor_jobs_days === 'number' ? wsSettings.competitor_jobs_days : 30;
        const { data: p2Data, error: p2Err } = await competitorsClient.rpc('purge_competitor_retention', {
          p_keep_snapshot_days: compSnapshotsDays,
          p_keep_job_days: compJobsDays,
          p_workspace_id: workspaceId,
        });
        if (p2Err) throw p2Err;
        p2Result = p2Data;
      } catch (p2Err: any) {
        console.error('[Retention] P2 prune failed:', p2Err);
        warnings.push(`P2 prune failed: ${p2Err.message || String(p2Err)}`);
      }
    }

    // P3 Gate
    if (wsSettings?.p3_prune_enabled) {
      try {
        const analyticsClient = dbClients.getAnalytics(runtimeEnv);
        const ingestionRunsDays = typeof wsSettings?.ingestion_runs_days === 'number' ? wsSettings.ingestion_runs_days : 30;
        const { data: runsData, error: runsErr } = await analyticsClient.rpc('purge_old_analytics_ingestion_runs', {
          p_keep_days: ingestionRunsDays,
          p_workspace_id: workspaceId,
        });
        if (runsErr) throw runsErr;
        deletedRuns = runsData?.deleted_runs ?? 0;

        const topPinsRawDays = typeof wsSettings?.top_pins_raw_days === 'number' ? wsSettings.top_pins_raw_days : 180;
        const snapshotCutoff = new Date(Date.now() - topPinsRawDays * 86400000).toISOString().split('T')[0];
        const { count: snapCount, error: snapErr } = await analyticsClient
          .from('top_pins_snapshots')
          .delete({ count: 'exact' })
          .eq('workspace_id', workspaceId)
          .lt('window_end', snapshotCutoff);

        if (snapErr) throw snapErr;
        deletedSnapshotsCount = snapCount ?? 0;

        if (wsSettings?.top_pins_downsample_enabled) {
          console.warn('[Retention] Top pins downsampling requested for workspace:', workspaceId);
        }
      } catch (p3Err: any) {
        console.error('[Retention] P3 prune failed:', p3Err);
        warnings.push(`P3 prune failed: ${p3Err.message || String(p3Err)}`);
      }
    }

    const allDisabled = !wsSettings?.auto_prune_enabled && !wsSettings?.p2_prune_enabled && !wsSettings?.p3_prune_enabled;

    return new Response(
      JSON.stringify({
        success: true,
        workspace_id: workspaceId,
        auto_prune_enabled: Boolean(wsSettings?.auto_prune_enabled),
        p2_prune_enabled: Boolean(wsSettings?.p2_prune_enabled),
        p3_prune_enabled: Boolean(wsSettings?.p3_prune_enabled),
        retention_posted_days: retentionPostedDays,
        processing_timeout_minutes: processingTimeoutMinutes,
        deleted_pins_count: deletedPinsCount ?? 0,
        deleted_terminal_pins_count: deletedTerminalCount ?? 0,
        deleted_delivery_logs: deletedLogs ?? 0,
        deleted_import_sessions: deletedSessions ?? 0,
        swept_pins_count: sweptPinsCount ?? 0,
        p2: p2Result,
        deleted_ingestion_runs: deletedRuns,
        deleted_snapshots_count: deletedSnapshotsCount ?? 0,
        posted_cutoff: postedCutoff,
        warnings,
        message: allDisabled ? 'All pruning disabled. Only orphan recovery sweep ran.' : undefined,
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
