-- Migration: 20260825000000_harden_analytics_purge_log_rls.sql
-- Project: P3 Analytics DB

-- 1. Drop overly permissive policy
DROP POLICY IF EXISTS "allow_all_analytics_purge_log" ON public.analytics_purge_log;
DROP POLICY IF EXISTS "sr_analytics_purge_log" ON public.analytics_purge_log;

-- 2. Create restrictive policy for service_role only
CREATE POLICY "sr_analytics_purge_log"
  ON public.analytics_purge_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Revoke all grants from anon/authenticated
REVOKE ALL ON public.analytics_purge_log FROM anon, authenticated;
GRANT ALL ON public.analytics_purge_log TO service_role;
