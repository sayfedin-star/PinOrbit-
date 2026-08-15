-- Migration: 20260818000000_fastcron_tokens_and_schedule_meta.sql
-- Description: Create fastcron_tokens registry with RLS policies and link to posting_schedules

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

ALTER TABLE public.fastcron_tokens ENABLE ROW LEVEL SECURITY;

-- 1. SELECT: Workspace members can view tokens in their workspace
CREATE POLICY "fastcron_tokens_select_workspace_member"
  ON public.fastcron_tokens
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = fastcron_tokens.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- 2. INSERT: Workspace admins/owners can insert tokens
CREATE POLICY "fastcron_tokens_insert_workspace_admin"
  ON public.fastcron_tokens
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = fastcron_tokens.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

-- 3. UPDATE: Workspace admins/owners can update tokens
CREATE POLICY "fastcron_tokens_update_workspace_admin"
  ON public.fastcron_tokens
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = fastcron_tokens.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = fastcron_tokens.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

-- 4. DELETE: Workspace admins/owners can delete tokens
CREATE POLICY "fastcron_tokens_delete_workspace_admin"
  ON public.fastcron_tokens
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = fastcron_tokens.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

-- 5. ALL: Service role bypass for backend jobs
CREATE POLICY "fastcron_tokens_service_role_all"
  ON public.fastcron_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add metadata columns and foreign key to posting_schedules
ALTER TABLE public.posting_schedules
  ADD COLUMN IF NOT EXISTS fastcron_token_id UUID REFERENCES public.fastcron_tokens(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_dispatched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_posting_schedules_fastcron_token_id ON public.posting_schedules(fastcron_token_id);
