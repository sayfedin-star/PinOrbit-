-- Migration: 20260805_optimize_cron_logs_indexes.sql
-- Description: Optimize pg_cron execution guard, setup daily system log retention cleanup, and create targeted partial indexes.

-- 1. UNSCHEDULE OLD CRON & RE-SCHEDULE WITH CONDITIONAL EXISTS() GUARD
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-pending-pins-every-minute') THEN
    PERFORM cron.unschedule('process-pending-pins-every-minute');
  END IF;
END $$;

SELECT cron.schedule(
  'process-pending-pins-every-minute',
  '* * * * *',
  $$DO $$
  BEGIN
    -- Only trigger net.http_post if a candidate pin is actually due
    IF EXISTS (
      SELECT 1 FROM public.pins 
      WHERE status = 'pending' 
        AND (scheduled_for IS NULL OR scheduled_for <= NOW())
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      LIMIT 1
    ) THEN
      PERFORM net.http_post(
        url := COALESCE(current_setting('app.settings.supabase_url', true), 'https://your-project-ref.supabase.co') || '/functions/v1/process-pending-pins',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(current_setting('app.settings.service_role_key', true), 'YOUR_SERVICE_ROLE_KEY')
        ),
        body := '{}'::jsonb
      );
    END IF;
  END $$;$$
);

-- 2. AUTOMATED LOG RETENTION & PURGE PROCEDURE
CREATE OR REPLACE FUNCTION public.purge_system_logs()
RETURNS VOID AS $$
BEGIN
  -- Delete cron execution history older than 7 days
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'cron' AND table_name = 'job_run_details') THEN
    DELETE FROM cron.job_run_details WHERE start_time < NOW() - INTERVAL '7 days';
  END IF;

  -- Delete pg_net HTTP responses older than 3 days
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'net' AND table_name = '_http_response') THEN
    DELETE FROM net._http_response WHERE created < NOW() - INTERVAL '3 days';
  END IF;

  -- Clean application logs if table exists older than 30 days
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'logs') THEN
    DELETE FROM public.logs WHERE created_at < NOW() - INTERVAL '30 days';
  END IF;

  -- Clean audit logs if table exists older than 90 days (uses changed_at column)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
    DELETE FROM public.audit_log WHERE changed_at < NOW() - INTERVAL '90 days';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule daily log cleanup at 03:00 AM UTC
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-log-cleanup') THEN
    PERFORM cron.unschedule('daily-log-cleanup');
  END IF;
END $$;

SELECT cron.schedule(
  'daily-log-cleanup', 
  '0 3 * * *', 
  $$SELECT public.purge_system_logs();$$
);

-- 3. TARGETED PARTIAL INDEXES
CREATE INDEX IF NOT EXISTS idx_pins_pending_candidate 
  ON public.pins (account_id, scheduled_for ASC NULLS FIRST, next_retry_at ASC NULLS FIRST) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pins_posted_limit 
  ON public.pins (account_id, posted_at DESC) 
  WHERE status = 'posted';
