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
    url := 'https://zeryyrmhdueezzwyodhq.supabase.co/functions/v1/update-competitors',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inplcnl5cm1oZHVlZXp6d3lvZGhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3MTA0MTQsImV4cCI6MjEwMTI4NjQxNH0.5erFNHK-KOc-cNVmz8VdTPPUs8B4IkObOt0NToRH-Q4"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
