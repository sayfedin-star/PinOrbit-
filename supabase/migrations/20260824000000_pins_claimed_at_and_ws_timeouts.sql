-- Migration: 20260824000000_pins_claimed_at_and_ws_timeouts.sql

CREATE TABLE IF NOT EXISTS public.workspace_retention_settings (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  retention_posted_days INTEGER NOT NULL DEFAULT 30,
  processing_timeout_minutes INTEGER NOT NULL DEFAULT 45,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_retention_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'workspace_retention_settings' AND policyname = 'Users can view retention settings in their workspaces'
  ) THEN
    CREATE POLICY "Users can view retention settings in their workspaces" ON public.workspace_retention_settings
      FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'workspace_retention_settings' AND policyname = 'Admins can manage retention settings in their workspaces'
  ) THEN
    CREATE POLICY "Admins can manage retention settings in their workspaces" ON public.workspace_retention_settings
      FOR ALL USING (workspace_id IN (SELECT workspace_id FROM public.workspace_memberships WHERE user_id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

ALTER TABLE public.pins ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE public.workspace_retention_settings ADD COLUMN IF NOT EXISTS processing_timeout_minutes INTEGER NOT NULL DEFAULT 45;
ALTER TABLE public.workspace_retention_settings ADD COLUMN IF NOT EXISTS retention_posted_days INTEGER NOT NULL DEFAULT 30;

CREATE OR REPLACE FUNCTION public.claim_due_pins_simple(p_account_id uuid, p_limit integer DEFAULT 1)
 RETURNS TABLE(id uuid, account_id uuid, workspace_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.pins p
  SET status='processing', processing_started_at=now(), claimed_at=now(), attempts=p.attempts+1, last_attempt_at=now(), updated_at=now()
  WHERE p.id IN (
    SELECT q.id FROM public.pins q
    WHERE q.status='pending' AND q.account_id=p_account_id
      AND (q.next_retry_at IS NULL OR q.next_retry_at <= now())
    ORDER BY q.created_at ASC LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  RETURNING p.id, p.account_id, p.workspace_id;
END; $function$;
