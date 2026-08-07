-- ==============================================================================
-- Migration: 20260808000000_init_competitors_schema.sql
-- Project: Project 2 (Competitors - Server-Only Database)
-- Domain: Competitor Profiles, Boards, Time-Series Snapshots, and Daily Rollups
-- ==============================================================================

-- 1. Competitors Table (Tenant boundary: workspace_id)
CREATE TABLE IF NOT EXISTS public.competitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    user_id UUID,
    username VARCHAR NOT NULL,
    full_name TEXT,
    niche VARCHAR,
    profile_reach BIGINT DEFAULT 0,
    profile_views BIGINT DEFAULT 0,
    follower_count INTEGER DEFAULT 0,
    pin_count INTEGER DEFAULT 0,
    avatar_url TEXT,
    website_url TEXT,
    domain_verified BOOLEAN DEFAULT false,
    notes TEXT,
    tags TEXT[] DEFAULT '{}'::text[],
    account_type VARCHAR DEFAULT 'competitor',
    last_checked_at TIMESTAMPTZ,
    last_pin_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ux_competitors_workspace_username UNIQUE (workspace_id, username)
);

-- 2. Competitor Boards Table
CREATE TABLE IF NOT EXISTS public.competitor_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
    board_id VARCHAR NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    url TEXT,
    pin_count INTEGER DEFAULT 0,
    follower_count INTEGER DEFAULT 0,
    board_created_at TIMESTAMPTZ,
    last_pinned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_competitor_board UNIQUE (competitor_id, board_id)
);

-- 3. Competitor Time-Series Snapshots
CREATE TABLE IF NOT EXISTS public.competitor_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
    profile_reach BIGINT DEFAULT 0,
    profile_views BIGINT DEFAULT 0,
    follower_count INTEGER DEFAULT 0,
    pin_count INTEGER DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Competitor Daily Rollups
CREATE TABLE IF NOT EXISTS public.competitor_daily_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    profile_reach BIGINT DEFAULT 0,
    profile_views BIGINT DEFAULT 0,
    follower_count INTEGER DEFAULT 0,
    pin_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ux_competitor_daily_snapshot UNIQUE (competitor_id, snapshot_date)
);

-- 5. Competitor Ingestion Jobs
CREATE TABLE IF NOT EXISTS public.competitor_ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    competitor_id UUID REFERENCES public.competitors(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    items_processed INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Covering Indexes
CREATE INDEX IF NOT EXISTS idx_competitors_workspace_id 
    ON public.competitors (workspace_id);

CREATE INDEX IF NOT EXISTS idx_competitors_account_type 
    ON public.competitors (workspace_id, account_type);

CREATE INDEX IF NOT EXISTS idx_competitor_boards_competitor_id 
    ON public.competitor_boards (competitor_id);

CREATE INDEX IF NOT EXISTS idx_competitor_boards_workspace_id 
    ON public.competitor_boards (workspace_id);

CREATE INDEX IF NOT EXISTS idx_competitor_boards_activity 
    ON public.competitor_boards (competitor_id, last_pinned_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_competitor_id 
    ON public.competitor_snapshots (competitor_id);

CREATE INDEX IF NOT EXISTS idx_snapshots_comp_time 
    ON public.competitor_snapshots (competitor_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_snapshots_competitor_date 
    ON public.competitor_daily_snapshots (competitor_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_competitor_ingestion_jobs_workspace_status 
    ON public.competitor_ingestion_jobs (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_competitor_ingestion_jobs_competitor_id 
    ON public.competitor_ingestion_jobs (competitor_id);

-- 7. Trigger to Auto-Sync Board Workspace ID
CREATE OR REPLACE FUNCTION public.sync_competitor_board_workspace_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.workspace_id IS NULL THEN
        SELECT workspace_id INTO NEW.workspace_id FROM public.competitors WHERE id = NEW.competitor_id;
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_competitor_board_workspace_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_competitor_board_workspace_id() TO service_role;

DROP TRIGGER IF EXISTS trg_sync_competitor_board_workspace_id ON public.competitor_boards;
CREATE TRIGGER trg_sync_competitor_board_workspace_id
    BEFORE INSERT OR UPDATE ON public.competitor_boards
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_competitor_board_workspace_id();

-- 8. Enable Row Level Security (RLS) & Server-Only Grant Isolation
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_ingestion_jobs ENABLE ROW LEVEL SECURITY;

-- Server-only policies (Project 2 is purely backend-accessed via service_role)
CREATE POLICY "Allow service_role full access on competitors"
    ON public.competitors
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on competitor_boards"
    ON public.competitor_boards
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on competitor_snapshots"
    ON public.competitor_snapshots
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on competitor_daily_snapshots"
    ON public.competitor_daily_snapshots
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service_role full access on competitor_ingestion_jobs"
    ON public.competitor_ingestion_jobs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
