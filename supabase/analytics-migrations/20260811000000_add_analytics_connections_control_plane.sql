-- ==============================================================================
-- Migration: 20260811000000_add_analytics_connections_control_plane.sql
-- Project: Project 3 (Analytics Data Warehouse & Control Plane)
-- Target Ref: jxdkbwnwtjelznmauwpc
-- Domain: Analytics Connections & Workspace Settings Control Plane
-- ==============================================================================

-- 1. Workspace-level orchestration settings (operator secrets & globals)
CREATE TABLE IF NOT EXISTS public.workspace_analytics_settings (
  workspace_id UUID PRIMARY KEY,
  fastcron_token TEXT,                                  -- write-only, masked in API
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_sync_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_backfill_on_connect BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Per-connection identity + dual pipeline configuration
CREATE TABLE IF NOT EXISTS public.analytics_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),        -- this IS the connection_id
  workspace_id UUID NOT NULL,
  display_name TEXT NOT NULL,
  analytics_enabled BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  last_analytics_sync_at TIMESTAMPTZ,

  -- Pipeline A: /v5/user_account/analytics
  analytics_webhook_url TEXT,
  analytics_sync_time TEXT NOT NULL DEFAULT '04:00',
  analytics_cron_expression TEXT NOT NULL DEFAULT '0 4 * * *',
  analytics_fastcron_job_id INTEGER,
  analytics_schedule_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (analytics_schedule_status IN ('synced','pending','error')),

  -- Pipeline B: /v5/user_account/analytics/top_pins
  top_pins_webhook_url TEXT,
  top_pins_sync_time TEXT NOT NULL DEFAULT '04:30',
  top_pins_cron_expression TEXT NOT NULL DEFAULT '30 4 * * *',
  top_pins_fastcron_job_id INTEGER,
  top_pins_schedule_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (top_pins_schedule_status IN ('synced','pending','error')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_analytics_connections_ws_name UNIQUE (workspace_id, display_name)
);

CREATE INDEX IF NOT EXISTS idx_analytics_connections_ws
  ON public.analytics_connections (workspace_id) WHERE deleted_at IS NULL;

-- 3. Row-Level Security (RLS)
ALTER TABLE public.workspace_analytics_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_connections ENABLE ROW LEVEL SECURITY;

-- 4. Service Role Full Access Policies (Tenant authorization enforced via server workspace-guard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'workspace_analytics_settings' 
    AND policyname = 'Allow service_role full access on workspace_analytics_settings'
  ) THEN
    CREATE POLICY "Allow service_role full access on workspace_analytics_settings"
      ON public.workspace_analytics_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'analytics_connections' 
    AND policyname = 'Allow service_role full access on analytics_connections'
  ) THEN
    CREATE POLICY "Allow service_role full access on analytics_connections"
      ON public.analytics_connections FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
