-- ============================================================================
-- migration: 20260818000000_fastcron_tokens_and_schedule_meta
-- purpose:
--   - Create public.fastcron_tokens table for workspace token registry
--   - Add 5 RLS policies on fastcron_tokens (service_role, select, insert, update, delete)
--   - Add last_dispatched_at and fastcron_token_id to public.posting_schedules
-- ============================================================================

-- 1. Create fastcron_tokens table
CREATE TABLE IF NOT EXISTS public.fastcron_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_encrypted TEXT NOT NULL,
    token_masked TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for lookup
CREATE INDEX IF NOT EXISTS idx_fastcron_tokens_workspace_id ON public.fastcron_tokens(workspace_id);

-- Enable RLS
ALTER TABLE public.fastcron_tokens ENABLE ROW LEVEL SECURITY;

-- 2. Create 5 RLS policies for fastcron_tokens
DROP POLICY IF EXISTS "Service all fastcron tokens" ON public.fastcron_tokens;
CREATE POLICY "Service all fastcron tokens" ON public.fastcron_tokens
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Members read fastcron tokens" ON public.fastcron_tokens;
CREATE POLICY "Members read fastcron tokens" ON public.fastcron_tokens
    FOR SELECT TO authenticated USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Admins insert fastcron tokens" ON public.fastcron_tokens;
CREATE POLICY "Admins insert fastcron tokens" ON public.fastcron_tokens
    FOR INSERT TO authenticated WITH CHECK (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Admins update fastcron tokens" ON public.fastcron_tokens;
CREATE POLICY "Admins update fastcron tokens" ON public.fastcron_tokens
    FOR UPDATE TO authenticated USING (is_workspace_admin(workspace_id)) WITH CHECK (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Admins delete fastcron tokens" ON public.fastcron_tokens;
CREATE POLICY "Admins delete fastcron tokens" ON public.fastcron_tokens
    FOR DELETE TO authenticated USING (is_workspace_admin(workspace_id));

-- 3. Add columns to posting_schedules
ALTER TABLE public.posting_schedules
    ADD COLUMN IF NOT EXISTS last_dispatched_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS fastcron_token_id UUID REFERENCES public.fastcron_tokens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posting_schedules_fastcron_token_id ON public.posting_schedules(fastcron_token_id);
