-- Migration: 20260825000001_add_ingestion_runs_pruning.sql
-- Project: P3 Analytics DB

CREATE OR REPLACE FUNCTION public.purge_old_analytics_ingestion_runs(
  p_keep_days INT DEFAULT 60,
  p_workspace_id UUID DEFAULT NULL  -- Optional: prune specific workspace only
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_del_count INT := 0;
  v_cutoff TIMESTAMPTZ := NOW() - (p_keep_days || ' days')::INTERVAL;
BEGIN
  WITH del AS (
    DELETE FROM public.analytics_ingestion_runs
    WHERE created_at < v_cutoff
      AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
    RETURNING id
  )
  SELECT count(*) INTO v_del_count FROM del;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_runs', v_del_count,
    'workspace_id', p_workspace_id,
    'executed_at', NOW()
  );
END;
$$;
