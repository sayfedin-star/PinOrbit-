-- ==============================================================================
-- Migration: 20260810000000_add_analytics_control_plane.sql
-- Project: Project 1 (Scheduling / Auth Authority)
-- Target Ref: eygdoetdwqllvsxpvoex
-- Domain: Workspace Analytics Settings (Control Plane) & Account Analytics Flags
-- ==============================================================================

-- 1. Workspace Analytics Settings (Control Plane Configuration)
CREATE TABLE IF NOT EXISTS public.workspace_analytics_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
    analytics_webhook_url TEXT,
    top_pins_webhook_url TEXT,
    analytics_sync_time TEXT DEFAULT '04:00',
    top_pins_sync_time TEXT DEFAULT '04:30',
    timezone TEXT DEFAULT 'UTC',
    analytics_enabled BOOLEAN DEFAULT true,
    top_pins_enabled BOOLEAN DEFAULT true,
    auto_backfill_on_connect BOOLEAN DEFAULT false,
    fastcron_token TEXT,
    analytics_fastcron_job_id TEXT,
    top_pins_fastcron_job_id TEXT,
    analytics_schedule_status TEXT DEFAULT 'pending',
    top_pins_schedule_status TEXT DEFAULT 'pending',
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add analytics_enabled and soft-delete columns to accounts
ALTER TABLE public.accounts 
    ADD COLUMN IF NOT EXISTS analytics_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 3. Query Covering Indexes
CREATE INDEX IF NOT EXISTS idx_workspace_analytics_settings_ws 
    ON public.workspace_analytics_settings (workspace_id);

CREATE INDEX IF NOT EXISTS idx_accounts_workspace_active_analytics 
    ON public.accounts (workspace_id, is_active, analytics_enabled)
    WHERE (deleted_at IS NULL);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.workspace_analytics_settings ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workspace_analytics_settings' AND policyname = 'Workspace members can read analytics settings') THEN
        CREATE POLICY "Workspace members can read analytics settings"
            ON public.workspace_analytics_settings
            FOR SELECT
            TO authenticated
            USING (public.is_workspace_member(workspace_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workspace_analytics_settings' AND policyname = 'Workspace admins can insert analytics settings') THEN
        CREATE POLICY "Workspace admins can insert analytics settings"
            ON public.workspace_analytics_settings
            FOR INSERT
            TO authenticated
            WITH CHECK (public.is_workspace_member(workspace_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workspace_analytics_settings' AND policyname = 'Workspace admins can update analytics settings') THEN
        CREATE POLICY "Workspace admins can update analytics settings"
            ON public.workspace_analytics_settings
            FOR UPDATE
            TO authenticated
            USING (public.is_workspace_member(workspace_id))
            WITH CHECK (public.is_workspace_member(workspace_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workspace_analytics_settings' AND policyname = 'Allow service_role full access on workspace_analytics_settings') THEN
        CREATE POLICY "Allow service_role full access on workspace_analytics_settings"
            ON public.workspace_analytics_settings
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;
