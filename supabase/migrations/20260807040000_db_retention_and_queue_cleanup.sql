-- ============================================================================
-- MIGRATION: 20260807040000_db_retention_and_queue_cleanup.sql
-- PURPOSE:
--   1. Safe cleanup of cron & net execution logs
--   2. Smart retention for old published pins
--   3. Queue recovery for stuck processing pins
--   4. Rate-limit backoff helper
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. PREREQUISITE COLUMNS ON PUBLIC.PINS
-- ----------------------------------------------------------------------------

ALTER TABLE public.pins
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code INT,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT;

-- ----------------------------------------------------------------------------
-- 1. HARDENED PURGE FUNCTION
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purge_system_logs_and_old_pins()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM cron.job_run_details
  WHERE end_time < NOW() - INTERVAL '3 days';

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
  WHERE status = 'published'
    AND updated_at < NOW() - INTERVAL '30 days';

  UPDATE public.pins
  SET status = 'pending',
      updated_at = NOW()
  WHERE status = 'processing'
    AND updated_at < NOW() - INTERVAL '15 minutes';
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. RATE LIMIT (429) BACKOFF & ERROR TRACKING
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_pin_rate_limit_backoff(
  p_pin_id UUID,
  p_error_code INT DEFAULT 429,
  p_error_message TEXT DEFAULT 'Rate limit exceeded'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.pins
  SET attempts = attempts + 1,
      status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END,
      scheduled_for = NOW() + INTERVAL '2 hours',
      last_error_code = p_error_code,
      last_error_message = SUBSTRING(p_error_message FROM 1 FOR 500),
      updated_at = NOW()
  WHERE id = p_pin_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. IDEMPOTENT PG_CRON REGISTRATION
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('daily-system-retention-purge');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'daily-system-retention-purge',
      '15 3 * * *',
      $cmd$ SELECT public.purge_system_logs_and_old_pins(); $cmd$
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. INITIAL IMMEDIATE PURGE
-- ----------------------------------------------------------------------------

SELECT public.purge_system_logs_and_old_pins();
