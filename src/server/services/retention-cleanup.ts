import { dbClients } from '../db/clients';
import { clampRetentionPostedDays, clampProcessingTimeoutMinutes } from './scheduling-logic';

export interface CleanupOverrides {
  p1?: boolean;
  p2?: boolean;
  p3?: boolean;
}

export async function runRetentionCleanup(
  workspaceId: string,
  runtimeEnv: Record<string, any>,
  opts?: { overrides?: CleanupOverrides; trigger?: 'api' | 'manual' }
): Promise<Record<string, any>> {
  const schedulingAdmin = dbClients.getSchedulingAdmin(runtimeEnv);
  const analyticsClient = dbClients.getAnalytics(runtimeEnv);

  // Read workspace retention settings (with fallbacks)
  const { data: wsSettings } = await schedulingAdmin
    .from('workspace_retention_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  const retentionPostedDays = clampRetentionPostedDays(wsSettings?.retention_posted_days);
  const processingTimeoutMinutes = clampProcessingTimeoutMinutes(wsSettings?.processing_timeout_minutes);
  const postedCutoff = new Date(Date.now() - retentionPostedDays * 86400000).toISOString();

  const warnings: string[] = [];

  // Effective gates based on explicit overrides or DB toggles (auto_prune_enabled defaults to true in schema)
  const effectiveP1 = opts?.overrides?.p1 ?? (wsSettings?.auto_prune_enabled ?? true);
  const effectiveP2 = opts?.overrides?.p2 ?? Boolean(wsSettings?.p2_prune_enabled);
  const effectiveP3 = opts?.overrides?.p3 ?? Boolean(wsSettings?.p3_prune_enabled);

  // 1. Unconditional Orphan Pin Sweep (outside gates)
  const sweepCutoff = new Date(Date.now() - processingTimeoutMinutes * 60000).toISOString();
  let sweptPinsCount = 0;
  try {
    const { count, error: sweepErr } = await schedulingAdmin
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
    sweptPinsCount = count ?? 0;
  } catch (err: any) {
    warnings.push(`Sweep failed: ${err.message}`);
  }

  // 2. Gate P1 (Posted pins, terminal pins, delivery logs, import sessions)
  let deletedPinsCount = 0;
  let deletedTerminalPinsCount = 0;
  let deletedDeliveryLogs = 0;
  let deletedImportSessions = 0;

  if (effectiveP1) {
    try {
      const { count: pinCount, error: pinDeleteErr } = await schedulingAdmin
        .from('pins')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('status', 'posted')
        .lt('posted_at', postedCutoff);

      if (pinDeleteErr) throw pinDeleteErr;
      deletedPinsCount = pinCount ?? 0;
    } catch (err: any) {
      warnings.push(`P1 pins cleanup failed: ${err.message}`);
    }

    if (wsSettings?.retention_terminal_days) {
      try {
        const termCutoff = new Date(Date.now() - wsSettings.retention_terminal_days * 86400000).toISOString();
        const { count, error } = await schedulingAdmin
          .from('pins')
          .delete()
          .eq('workspace_id', workspaceId)
          .in('status', ['failed', 'cancelled'])
          .lt('updated_at', termCutoff);
        if (!error && count !== null) deletedTerminalPinsCount = count;
      } catch (err: any) {
        warnings.push(`P1 terminal pins cleanup failed: ${err.message}`);
      }
    }

    if (wsSettings?.retention_logs_days) {
      try {
        const logCutoff = new Date(Date.now() - wsSettings.retention_logs_days * 86400000).toISOString();
        const { count, error } = await schedulingAdmin
          .from('pin_delivery_logs')
          .delete()
          .eq('workspace_id', workspaceId)
          .lt('created_at', logCutoff);
        if (!error && count !== null) deletedDeliveryLogs = count;
      } catch (err: any) {
        warnings.push(`P1 delivery logs cleanup failed: ${err.message}`);
      }
    }

    if (wsSettings?.import_sessions_days) {
      try {
        const sessionCutoff = new Date(Date.now() - wsSettings.import_sessions_days * 86400000).toISOString();
        const { count, error } = await schedulingAdmin
          .from('import_sessions')
          .delete()
          .eq('workspace_id', workspaceId)
          .lt('created_at', sessionCutoff);
        if (!error && count !== null) deletedImportSessions = count;
      } catch (err: any) {
        warnings.push(`P1 import sessions cleanup failed: ${err.message}`);
      }
    }
  }

  // 3. Gate P2 (Competitor snapshots and ingestion jobs)
  let p2Result: any = null;
  if (effectiveP2) {
    try {
      const competitorsClient = dbClients.getCompetitors?.(runtimeEnv);
      if (competitorsClient) {
        const snapDays = wsSettings?.competitor_snapshots_days ?? 90;
        const jobDays = wsSettings?.competitor_jobs_days ?? 30;
        const snapCutoff = new Date(Date.now() - snapDays * 86400000).toISOString();
        const jobCutoff = new Date(Date.now() - jobDays * 86400000).toISOString();

        let snapshotsCount = 0;
        let jobsCount = 0;

        const { count: sCount, error: sErr } = await competitorsClient
          .from('competitor_snapshots')
          .delete()
          .eq('workspace_id', workspaceId)
          .lt('created_at', snapCutoff);
        if (sErr) throw sErr;
        snapshotsCount = sCount ?? 0;

        const { count: jCount, error: jErr } = await competitorsClient
          .from('competitor_ingestion_jobs')
          .delete()
          .eq('workspace_id', workspaceId)
          .lt('created_at', jobCutoff);
        if (jErr) throw jErr;
        jobsCount = jCount ?? 0;

        p2Result = { snapshots: snapshotsCount, jobs: jobsCount };
      }
    } catch (err: any) {
      warnings.push(`P2 cleanup failed: ${err.message}`);
    }
  }

  // 4. Gate P3 (Analytics snapshots and ingestion runs)
  let deletedSnapshotsCount = 0;
  let deletedIngestionRuns = 0;
  if (effectiveP3) {
    try {
      const snapshotCutoff = new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];
      const { count: snapCount, error: snapErr } = await analyticsClient
        .from('top_pins_snapshots')
        .delete()
        .eq('workspace_id', workspaceId)
        .lt('window_end', snapshotCutoff);
      if (snapErr) throw snapErr;
      deletedSnapshotsCount = snapCount ?? 0;

      const runDays = wsSettings?.ingestion_runs_days ?? 90;
      const runCutoff = new Date(Date.now() - runDays * 86400000).toISOString();
      const { count: runCount, error: runErr } = await analyticsClient
        .from('analytics_ingestion_runs')
        .delete()
        .eq('workspace_id', workspaceId)
        .lt('created_at', runCutoff);
      if (runErr) throw runErr;
      deletedIngestionRuns = runCount ?? 0;
    } catch (err: any) {
      warnings.push(`P3 cleanup failed: ${err.message}`);
    }
  }

  // Construct consolidated payload
  const payload: Record<string, any> = {
    success: true,
    workspace_id: workspaceId,
    retention_posted_days: retentionPostedDays,
    processing_timeout_minutes: processingTimeoutMinutes,
    deleted_pins_count: deletedPinsCount,
    deleted_terminal_pins_count: deletedTerminalPinsCount,
    deleted_delivery_logs: deletedDeliveryLogs,
    deleted_import_sessions: deletedImportSessions,
    swept_pins_count: sweptPinsCount,
    p2: p2Result,
    deleted_ingestion_runs: deletedIngestionRuns,
    deleted_snapshots_count: deletedSnapshotsCount,
    posted_cutoff: postedCutoff,
    warnings,
  };

  // Fail-lazy telemetry upsert with complete NOT NULL fallback defaults
  try {
    const telemetryPayload = {
      ...(wsSettings ?? {}),
      workspace_id: workspaceId,
      auto_prune_enabled: wsSettings?.auto_prune_enabled ?? true,
      retention_posted_days: retentionPostedDays,
      retention_terminal_days: wsSettings?.retention_terminal_days ?? 90,
      retention_logs_days: wsSettings?.retention_logs_days ?? 14,
      import_sessions_days: wsSettings?.import_sessions_days ?? 30,
      processing_timeout_minutes: processingTimeoutMinutes,
      p2_prune_enabled: wsSettings?.p2_prune_enabled ?? false,
      competitor_snapshots_days: wsSettings?.competitor_snapshots_days ?? 90,
      competitor_jobs_days: wsSettings?.competitor_jobs_days ?? 30,
      p3_prune_enabled: wsSettings?.p3_prune_enabled ?? false,
      ingestion_runs_days: wsSettings?.ingestion_runs_days ?? 90,
      top_pins_raw_days: wsSettings?.top_pins_raw_days ?? 90,
      top_pins_downsample_enabled: wsSettings?.top_pins_downsample_enabled ?? true,
      analytics_daily_keep_days: wsSettings?.analytics_daily_keep_days ?? 90,
      last_cleanup_at: new Date().toISOString(),
      last_cleanup_result: {
        at: new Date().toISOString(),
        trigger: opts?.trigger ?? 'api',
        swept_pins: payload.swept_pins_count,
        warnings: payload.warnings,
        sections: {
          p1: {
            pins: payload.deleted_pins_count,
            terminal: payload.deleted_terminal_pins_count,
            logs: payload.deleted_delivery_logs,
            sessions: payload.deleted_import_sessions,
          },
          p2: payload.p2 ?? null,
          p3: {
            runs: payload.deleted_ingestion_runs,
            snapshots: payload.deleted_snapshots_count,
          },
        },
      },
      updated_at: new Date().toISOString(),
    };

    await schedulingAdmin
      .from('workspace_retention_settings')
      .upsert(telemetryPayload, { onConflict: 'workspace_id' });
  } catch (e) {
    console.warn('[Retention] telemetry write failed:', e);
  }

  return payload;
}
