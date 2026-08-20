-- Migration: 20260825000001_add_competitor_retention_pruning.sql
-- Project: P2 Competitors DB

CREATE OR REPLACE FUNCTION public.purge_competitor_retention(
  p_keep_snapshot_days INT DEFAULT 90,
  p_keep_job_days INT DEFAULT 30,
  p_workspace_id UUID DEFAULT NULL  -- Optional: prune specific workspace only
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_del_snaps INT := 0;
  v_del_jobs INT := 0;
  v_snap_cutoff TIMESTAMPTZ := NOW() - (p_keep_snapshot_days || ' days')::INTERVAL;
  v_job_cutoff TIMESTAMPTZ := NOW() - (p_keep_job_days || ' days')::INTERVAL;
BEGIN
  -- Delete old raw snapshots (daily rollups preserved)
  WITH del_s AS (
    DELETE FROM public.competitor_snapshots
    WHERE recorded_at < v_snap_cutoff
      AND (p_workspace_id IS NULL OR EXISTS (
        SELECT 1 FROM public.competitors c
        WHERE c.id = competitor_snapshots.competitor_id
          AND c.workspace_id = p_workspace_id
      ))
    RETURNING id
  )
  SELECT count(*) INTO v_del_snaps FROM del_s;

  -- Delete old ingestion job records
  WITH del_j AS (
    DELETE FROM public.competitor_ingestion_jobs
    WHERE created_at < v_job_cutoff
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    RETURNING id
  )
  SELECT count(*) INTO v_del_jobs FROM del_j;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_snapshots', v_del_snaps,
    'deleted_jobs', v_del_jobs,
    'workspace_id', p_workspace_id,
    'executed_at', NOW()
  );
END;
$$;
