-- =============================================================================
-- Migration: 20260814000000_purge_support.sql
-- Purpose: V27 Atomic Data Purge & Audit Logging for Dedicated Analytics Schema
-- =============================================================================

-- 1. Analytics Purge Audit Log Table
CREATE TABLE IF NOT EXISTS public.analytics_purge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  targets text[] NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  deleted_counts jsonb NOT NULL,
  performed_by uuid NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_purge_log_conn 
  ON public.analytics_purge_log (workspace_id, connection_id, performed_at DESC);

-- Enable RLS and permissive policy aligned with Project 3 standard
ALTER TABLE public.analytics_purge_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'analytics_purge_log' 
      AND policyname = 'allow_all_analytics_purge_log'
  ) THEN
    CREATE POLICY allow_all_analytics_purge_log 
      ON public.analytics_purge_log 
      FOR ALL 
      TO anon, authenticated, service_role 
      USING (true) 
      WITH CHECK (true);
  END IF;
END $$;

-- 2. Atomic Purge Stored Procedure with Rollup Rebuild
CREATE OR REPLACE FUNCTION public.purge_analytics_data(
  p_workspace uuid,
  p_connection uuid,
  p_from date,
  p_to date,
  p_daily boolean,
  p_top_pins boolean,
  p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_ts timestamptz;
  v_excl timestamptz;
  c_daily int := 0;
  c_sum int := 0;
  c_roll_del int := 0;
  c_roll_rebuilt int := 0;
  c_pins int := 0;
  c_url int := 0;
  v_targets text[] := ARRAY[]::text[];
  v_log_id uuid;
BEGIN
  v_from_ts := p_from::timestamptz;
  v_excl := (p_to + 1)::timestamptz;

  IF p_daily THEN
    v_targets := array_append(v_targets, 'daily');

    -- Delete daily account metrics
    WITH del AS (
      DELETE FROM public.account_analytics_daily
      WHERE workspace_id = p_workspace
        AND connection_id = p_connection
        AND metric_date BETWEEN p_from AND p_to
      RETURNING id
    )
    SELECT count(*) INTO c_daily FROM del;

    -- Delete overlapping summary windows
    WITH del AS (
      DELETE FROM public.account_analytics_summaries
      WHERE workspace_id = p_workspace
        AND connection_id = p_connection
        AND window_end >= v_from_ts
        AND window_start < v_excl
      RETURNING id
    )
    SELECT count(*) INTO c_sum FROM del;

    -- Delete and rebuild daily_workspace_metrics rollups for affected dates
    WITH del AS (
      DELETE FROM public.daily_workspace_metrics
      WHERE workspace_id = p_workspace
        AND metric_date BETWEEN p_from AND p_to
      RETURNING id
    )
    SELECT count(*) INTO c_roll_del FROM del;

    -- Re-insert aggregated metrics from any remaining connections in workspace
    WITH rem AS (
      SELECT
        workspace_id,
        metric_date,
        COALESCE(SUM(impressions), 0)::bigint AS total_impressions,
        COALESCE(SUM(engagements), 0)::bigint AS total_engagements,
        COALESCE(SUM(saves), 0)::bigint AS total_saves,
        COALESCE(SUM(outbound_clicks), 0)::bigint AS total_outbound_clicks,
        COALESCE(SUM(pin_clicks), 0)::bigint AS total_pin_clicks,
        0::bigint AS total_profile_visits,
        0::bigint AS top_pin_impressions,
        0::bigint AS top_pin_outbound_clicks,
        0::bigint AS top_pin_saves,
        0::integer AS active_top_pins_count,
        now() AS recorded_at,
        now() AS created_at
      FROM public.account_analytics_daily
      WHERE workspace_id = p_workspace
        AND metric_date BETWEEN p_from AND p_to
      GROUP BY workspace_id, metric_date
    ),
    ins AS (
      INSERT INTO public.daily_workspace_metrics (
        workspace_id,
        metric_date,
        total_impressions,
        total_engagements,
        total_saves,
        total_outbound_clicks,
        total_pin_clicks,
        total_profile_visits,
        top_pin_impressions,
        top_pin_outbound_clicks,
        top_pin_saves,
        active_top_pins_count,
        recorded_at,
        created_at
      )
      SELECT
        workspace_id,
        metric_date,
        total_impressions,
        total_engagements,
        total_saves,
        total_outbound_clicks,
        total_pin_clicks,
        total_profile_visits,
        top_pin_impressions,
        top_pin_outbound_clicks,
        top_pin_saves,
        active_top_pins_count,
        recorded_at,
        created_at
      FROM rem
      RETURNING id
    )
    SELECT count(*) INTO c_roll_rebuilt FROM ins;
  END IF;

  IF p_top_pins THEN
    v_targets := array_append(v_targets, 'top_pins');

    -- Delete ranked top pin snapshots overlapping window
    WITH del AS (
      DELETE FROM public.top_pins_snapshots
      WHERE workspace_id = p_workspace
        AND connection_id = p_connection
        AND window_end >= v_from_ts
        AND window_start < v_excl
      RETURNING id
    )
    SELECT count(*) INTO c_pins FROM del;

    -- Delete URL performance records for period
    WITH del AS (
      DELETE FROM public.url_performance_history
      WHERE workspace_id = p_workspace
        AND period_date BETWEEN p_from AND p_to
      RETURNING id
    )
    SELECT count(*) INTO c_url FROM del;
  END IF;

  -- Insert audit log record
  INSERT INTO public.analytics_purge_log (
    workspace_id,
    connection_id,
    targets,
    from_date,
    to_date,
    deleted_counts,
    performed_by
  ) VALUES (
    p_workspace,
    p_connection,
    v_targets,
    p_from,
    p_to,
    jsonb_build_object(
      'daily_deleted', c_daily,
      'summaries_deleted', c_sum,
      'rollups_rebuilt', c_roll_rebuilt,
      'top_pins_deleted', c_pins,
      'url_perf_deleted', c_url
    ),
    p_performed_by
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'purge_log_id', v_log_id,
    'counts', jsonb_build_object(
      'daily_deleted', c_daily,
      'summaries_deleted', c_sum,
      'rollups_rebuilt', c_roll_rebuilt,
      'top_pins_deleted', c_pins,
      'url_perf_deleted', c_url
    )
  );
END;
$$;
