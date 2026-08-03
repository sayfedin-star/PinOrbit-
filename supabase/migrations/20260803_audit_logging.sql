-- Migration: 20260803_audit_logging.sql
-- PinOrbit Audit Logging Migration for Accounts and Boards

-- 1. Create audit_log table
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL, -- INSERT / UPDATE / DELETE
  old_data JSONB,
  new_data JSONB,
  changed_by UUID,
  changed_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on audit_log
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- 2. Allow authenticated admins to SELECT from audit_log
DROP POLICY IF EXISTS "Allow admin select on audit_log" ON public.audit_log;
CREATE POLICY "Allow admin select on audit_log"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 3. Create reusable security definer trigger function
CREATE OR REPLACE FUNCTION public.log_admin_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec_id UUID;
  old_json JSONB := NULL;
  new_json JSONB := NULL;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    rec_id := OLD.id;
    old_json := to_jsonb(OLD);
  ELSIF (TG_OP = 'UPDATE') THEN
    rec_id := NEW.id;
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);
  ELSIF (TG_OP = 'INSERT') THEN
    rec_id := NEW.id;
    new_json := to_jsonb(NEW);
  END IF;

  INSERT INTO public.audit_log (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    changed_by,
    changed_at
  ) VALUES (
    TG_TABLE_NAME,
    rec_id,
    TG_OP,
    old_json,
    new_json,
    auth.uid(),
    now()
  );

  RETURN NULL;
END;
$$;

-- Revoke execute from unauthenticated/public roles
REVOKE EXECUTE ON FUNCTION public.log_admin_changes() FROM public;
REVOKE EXECUTE ON FUNCTION public.log_admin_changes() FROM anon;
GRANT EXECUTE ON FUNCTION public.log_admin_changes() TO authenticated;

-- 4. Create AFTER row triggers on accounts and boards
DROP TRIGGER IF EXISTS audit_accounts_trigger ON public.accounts;
CREATE TRIGGER audit_accounts_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_changes();

DROP TRIGGER IF EXISTS audit_boards_trigger ON public.boards;
CREATE TRIGGER audit_boards_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_changes();

-- 5. Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_log_table_name ON public.audit_log (table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_record_id ON public.audit_log (record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON public.audit_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by ON public.audit_log (changed_by);
