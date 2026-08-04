-- Migration: 20260804_setup_pg_cron.sql
-- Description: Enable pg_cron and pg_net extensions and set up the 1-minute publish scheduler job

-- 1. Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant permissions on cron schema to postgres/service_role
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA cron TO postgres;

--------------------------------------------------------------------------------
-- OPTION 1: AUTOMATIC SCHEDULE USING GUC DATABASE SETTINGS
-- (Requires app.settings.supabase_url and app.settings.service_role_key configured)
--------------------------------------------------------------------------------
DO $$
BEGIN
  -- Unschedule existing job if it already exists to allow idempotent re-running
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-pending-pins-every-minute') THEN
    PERFORM cron.unschedule('process-pending-pins-every-minute');
  END IF;

  -- Schedule job: Runs every minute ('* * * * *')
  PERFORM cron.schedule(
    'process-pending-pins-every-minute',
    '* * * * *',
    $$
    SELECT net.http_post(
      url := COALESCE(
        current_setting('app.settings.supabase_url', true),
        'https://your-project-ref.supabase.co'
      ) || '/functions/v1/process-pending-pins',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          current_setting('app.settings.service_role_key', true),
          'YOUR_SERVICE_ROLE_KEY'
        )
      ),
      body := '{}'::jsonb
    );
    $$
  );
END $$;

--------------------------------------------------------------------------------
-- OPTION 2: DIRECT SETUP IN SUPABASE SQL EDITOR (Recommended for quick testing)
-- Simply replace <YOUR_PROJECT_REF> and <YOUR_SERVICE_ROLE_KEY> below:
--------------------------------------------------------------------------------
/*
SELECT cron.schedule(
  'process-pending-pins-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/process-pending-pins',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <YOUR_SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
*/

--------------------------------------------------------------------------------
-- OPERATIONAL HELPER QUERIES FOR MANAGEMENT & MONITORING
--------------------------------------------------------------------------------

-- Query A: Inspect active cron jobs
-- SELECT jobid, schedule, command, nodename, nodeport, database, username, active, jobname FROM cron.job;

-- Query B: Inspect recent cron job execution history & logs
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- Query C: Unschedule / remove the scheduler cron job if needed
-- SELECT cron.unschedule('process-pending-pins-every-minute');
