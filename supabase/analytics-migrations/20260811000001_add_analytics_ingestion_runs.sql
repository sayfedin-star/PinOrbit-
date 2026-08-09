-- ============================================================================
-- Migration: Add analytics_ingestion_runs and revoked_at to Project 3
-- Project: Project 3 (Analytics Data Warehouse & Control Plane - jxdkbwnwtjelznmauwpc)
-- Version: V17 Final Standalone Edition
-- ============================================================================

-- 1. Add revoked_at to analytics_connections for self-contained revocation tracking
ALTER TABLE public.analytics_connections
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- 2. Create self-contained operational log table
CREATE TABLE IF NOT EXISTS public.analytics_ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  connection_id UUID NOT NULL
    REFERENCES public.analytics_connections(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('account_analytics','top_pins')),
  job_type TEXT NOT NULL CHECK (job_type IN ('daily_sync','manual_sync','backfill','ping')),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','completed','failed')),
  request_context JSONB,
  rows_processed INTEGER NOT NULL DEFAULT 0,
  error_details JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 3. Composite index for fast health queries & snitch checks
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_conn
  ON public.analytics_ingestion_runs (connection_id, channel, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_ws
  ON public.analytics_ingestion_runs (workspace_id, started_at DESC);

-- 4. Enable Row Level Security
ALTER TABLE public.analytics_ingestion_runs ENABLE ROW LEVEL SECURITY;

-- 5. Service Role Full Access Policy
DROP POLICY IF EXISTS "service_role_analytics_ingestion_runs_all" ON public.analytics_ingestion_runs;
CREATE POLICY "service_role_analytics_ingestion_runs_all"
  ON public.analytics_ingestion_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
