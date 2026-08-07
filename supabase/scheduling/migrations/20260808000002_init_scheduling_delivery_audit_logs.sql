-- ==============================================================================
-- Migration: 20260808000002_init_scheduling_delivery_audit_logs.sql
-- Project: Project 1 (Scheduling / Auth Authority)
-- Domain: Delivery Logs, Operational System Logs, and Audit Trail
-- ==============================================================================

-- 1. Pin Delivery Logs (Per-attempt execution & diagnostics history)
CREATE TABLE IF NOT EXISTS public.pin_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id UUID NOT NULL REFERENCES public.pins(id) ON DELETE CASCADE,
    attempt_no INTEGER NOT NULL DEFAULT 1,
    event_type TEXT NOT NULL,
    provider TEXT,
    http_status INTEGER,
    error_code INTEGER,
    error_message TEXT,
    response_excerpt TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Operational System Logs Table
CREATE TABLE IF NOT EXISTS public.logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id UUID REFERENCES public.pins(id) ON DELETE CASCADE,
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
    webhook_id UUID REFERENCES public.account_webhooks(id) ON DELETE SET NULL,
    status TEXT,
    message TEXT,
    webhook_used TEXT,
    event_type TEXT,
    http_status SMALLINT,
    response_body TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Audit Log Table (Tracking configuration and administrative changes)
CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    action TEXT NOT NULL,
    old_data JSONB,
    new_data JSONB,
    changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Covering Indexes for Performance & Queries
CREATE INDEX IF NOT EXISTS idx_pin_delivery_logs_pin_created 
    ON public.pin_delivery_logs (pin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pin_delivery_logs_created_at 
    ON public.pin_delivery_logs (created_at);

CREATE INDEX IF NOT EXISTS idx_pin_delivery_logs_event_created 
    ON public.pin_delivery_logs (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_logs_account_id 
    ON public.logs (account_id);

CREATE INDEX IF NOT EXISTS idx_logs_pin_id 
    ON public.logs (pin_id);

CREATE INDEX IF NOT EXISTS idx_logs_webhook_id 
    ON public.logs (webhook_id);

CREATE INDEX IF NOT EXISTS idx_logs_account_created_desc 
    ON public.logs (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_record_id 
    ON public.audit_log (record_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by 
    ON public.audit_log (changed_by);

CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at 
    ON public.audit_log (changed_at DESC);

-- 5. Audit Logging Trigger Function
CREATE OR REPLACE FUNCTION public.log_admin_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.audit_log (
        table_name,
        record_id,
        action,
        old_data,
        new_data,
        changed_by,
        changed_at
    )
    VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
        (SELECT auth.uid()),
        now()
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_admin_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_admin_changes() TO service_role;

-- 6. Attach Audit Triggers
DROP TRIGGER IF EXISTS audit_accounts_trigger ON public.accounts;
CREATE TRIGGER audit_accounts_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.accounts
    FOR EACH ROW EXECUTE FUNCTION public.log_admin_changes();

DROP TRIGGER IF EXISTS audit_account_webhooks_trigger ON public.account_webhooks;
CREATE TRIGGER audit_account_webhooks_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.account_webhooks
    FOR EACH ROW EXECUTE FUNCTION public.log_admin_changes();

DROP TRIGGER IF EXISTS audit_boards_trigger ON public.boards;
CREATE TRIGGER audit_boards_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.boards
    FOR EACH ROW EXECUTE FUNCTION public.log_admin_changes();

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.pin_delivery_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies: Pin Delivery Logs
CREATE POLICY "Allow workspace members or admins to read pin delivery logs"
    ON public.pin_delivery_logs
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1 FROM public.pins p
            WHERE p.id = pin_delivery_logs.pin_id
              AND public.is_workspace_member(p.workspace_id)
        )
    );

CREATE POLICY "Admins can insert pin delivery logs"
    ON public.pin_delivery_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update pin delivery logs"
    ON public.pin_delivery_logs
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete pin delivery logs"
    ON public.pin_delivery_logs
    FOR DELETE
    TO authenticated
    USING (public.is_admin());

CREATE POLICY "Allow service_role full access on pin_delivery_logs"
    ON public.pin_delivery_logs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 9. RLS Policies: System Logs
CREATE POLICY "Allow workspace members or admins to read logs"
    ON public.logs
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1 FROM public.accounts a
            WHERE a.id = logs.account_id
              AND public.is_workspace_member(a.workspace_id)
        )
    );

CREATE POLICY "Admins can insert logs"
    ON public.logs
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update logs"
    ON public.logs
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete logs"
    ON public.logs
    FOR DELETE
    TO authenticated
    USING (public.is_admin());

CREATE POLICY "Allow service_role full access on logs"
    ON public.logs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 10. RLS Policies: Audit Log
CREATE POLICY "Allow admin select on audit_log"
    ON public.audit_log
    FOR SELECT
    TO authenticated
    USING (public.is_admin());

CREATE POLICY "Allow service_role full access on audit_log"
    ON public.audit_log
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
