-- Migration: 20260825000002_fix_p1_retention_functions.sql
-- Project: P1 Scheduling DB

-- 1. Hardened Purge Function (targets status = 'posted')
CREATE OR REPLACE FUNCTION public.purge_system_logs_and_old_pins()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'cron'
      AND tablename = 'job_run_details'
  ) THEN
    DELETE FROM cron.job_run_details
    WHERE end_time < NOW() - INTERVAL '3 days';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'net'
      AND tablename = '_http_response'
  ) THEN
    DELETE FROM net._http_response
    WHERE created < NOW() - INTERVAL '3 days';
  END IF;

  DELETE FROM public.pins
  WHERE status = 'posted'
    AND updated_at < NOW() - INTERVAL '30 days';

  UPDATE public.pins
  SET status = 'pending',
      updated_at = NOW()
  WHERE status = 'processing'
    AND updated_at < NOW() - INTERVAL '15 minutes';
END;
$$;

-- 2. Tenant-scoped Delivery Logs Purge Function (with optional p_workspace_id)
CREATE OR REPLACE FUNCTION public.purge_old_pin_delivery_logs(
  p_keep_success_days INT DEFAULT 60,
  p_keep_failure_days INT DEFAULT 180,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.pin_delivery_logs
  WHERE event_type IN ('queued', 'dispatched', 'success', 'published', 'info')
    AND created_at < NOW() - MAKE_INTERVAL(days => GREATEST(p_keep_success_days, 1))
    AND (p_workspace_id IS NULL OR EXISTS (
      SELECT 1 FROM public.pins p
      WHERE p.id = pin_delivery_logs.pin_id
        AND p.workspace_id = p_workspace_id
    ));

  DELETE FROM public.pin_delivery_logs
  WHERE event_type IN ('failed', 'rate_limited', 'provider_error')
    AND created_at < NOW() - MAKE_INTERVAL(days => GREATEST(p_keep_failure_days, 1))
    AND (p_workspace_id IS NULL OR EXISTS (
      SELECT 1 FROM public.pins p
      WHERE p.id = pin_delivery_logs.pin_id
        AND p.workspace_id = p_workspace_id
    ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_pin_delivery_logs(INT, INT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_old_pin_delivery_logs(INT, INT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_old_pin_delivery_logs(INT, INT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_pin_delivery_logs(INT, INT, UUID) TO service_role;
