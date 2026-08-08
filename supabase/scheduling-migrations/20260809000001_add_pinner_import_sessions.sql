-- ==============================================================================
-- Migration: 20260809000001_add_pinner_import_sessions.sql
-- Project: Project 1 (Scheduling / Auth Authority)
-- Target Ref: eygdoetdwqllvsxpvoex
-- Domain: Operational Ingestion Tracking (Source of Truth for Ingestion Sessions)
-- ==============================================================================

-- 1. Import Sessions Table (Operational Ingestion Tracking)
CREATE TABLE IF NOT EXISTS public.import_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_label TEXT,
    total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
    valid_rows INTEGER NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
    invalid_rows INTEGER NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
    imported_rows INTEGER NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_details JSONB,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Performance & Query Composite Indexes
CREATE INDEX IF NOT EXISTS idx_import_sessions_workspace_created 
    ON public.import_sessions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_sessions_account_created 
    ON public.import_sessions (workspace_id, account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_sessions_status_created 
    ON public.import_sessions (workspace_id, status, created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.import_sessions ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'import_sessions' AND policyname = 'Workspace access on import_sessions') THEN
        CREATE POLICY "Workspace access on import_sessions"
            ON public.import_sessions
            FOR SELECT
            TO authenticated
            USING (public.is_workspace_member(workspace_id));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'import_sessions' AND policyname = 'Allow service_role full access on import_sessions') THEN
        CREATE POLICY "Allow service_role full access on import_sessions"
            ON public.import_sessions
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;
