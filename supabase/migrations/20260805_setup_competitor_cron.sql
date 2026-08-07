-- Migration: 20260805_setup_competitor_cron.sql
-- Description: Enable pg_cron and pg_net extensions and register automated update-competitors daily cron job.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule existing job if re-applying migration
SELECT cron.unschedule('update-competitors-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'update-competitors-daily');

-- Schedule daily competitor scraping at 02:00 UTC
SELECT cron.schedule(
  'update-competitors-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://your-project-ref.supabase.co/functions/v1/update-competitors',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer your-anon-key"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
