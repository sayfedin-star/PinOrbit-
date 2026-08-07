-- ==============================================================================
-- Migration: 20260808000001_init_scheduling_accounts_boards_pins.sql
-- Project: Project 1 (Scheduling / Auth Authority)
-- Domain: Accounts, Webhooks, Posting Windows, Boards, and Pin Queue
-- ==============================================================================

-- 1. Accounts Table (Pinterest Accounts scoped to Workspace)
CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    account_name TEXT NOT NULL,
    webhook_url TEXT,
    max_pins_per_day INTEGER DEFAULT 20,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    pinning_started_at TIMESTAMPTZ,
    posting_window_start TIME WITHOUT TIME ZONE,
    posting_window_end TIME WITHOUT TIME ZONE,
    timezone TEXT DEFAULT 'UTC',
    last_published_at TIMESTAMPTZ,
    posting_interval_minutes INTEGER DEFAULT 30,
    random_delay_minutes INTEGER DEFAULT 0,
    active_days TEXT[] DEFAULT ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    CONSTRAINT ux_accounts_workspace_name UNIQUE (workspace_id, account_name)
);

-- 2. Account Webhooks Table
CREATE TABLE IF NOT EXISTS public.account_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    webhook_url TEXT NOT NULL,
    monthly_capacity INTEGER NOT NULL DEFAULT 500,
    monthly_usage INTEGER NOT NULL DEFAULT 0,
    remaining_capacity INTEGER GENERATED ALWAYS AS (monthly_capacity - monthly_usage) STORED,
    priority INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    last_used_at TIMESTAMPTZ,
    last_failed_at TIMESTAMPTZ,
    last_failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unq_account_label UNIQUE (account_id, label),
    CONSTRAINT unq_account_webhook_url UNIQUE (account_id, webhook_url)
);

-- 3. Account Posting Windows Table
CREATE TABLE IF NOT EXISTS public.account_posting_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    posting_time TIME WITHOUT TIME ZONE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_account_posting_window UNIQUE (account_id, day_of_week, posting_time)
);

-- 4. Boards Table
CREATE TABLE IF NOT EXISTS public.boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    board_name TEXT NOT NULL,
    board_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ux_board_account_board_id UNIQUE (account_id, board_id)
);

-- 5. Pins (Operational Scheduling Queue) Table
CREATE TABLE IF NOT EXISTS public.pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    image_url TEXT NOT NULL,
    board_name TEXT,
    link TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'posted', 'failed', 'cancelled')),
    source TEXT DEFAULT 'direct',
    scheduled_for TIMESTAMPTZ,
    processing_started_at TIMESTAMPTZ,
    posted_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error_code INTEGER,
    last_error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Performance & Covering Indexes
CREATE INDEX IF NOT EXISTS idx_accounts_workspace_id 
    ON public.accounts (workspace_id);

CREATE INDEX IF NOT EXISTS idx_accounts_workspace_active 
    ON public.accounts (workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_account_webhooks_account_id 
    ON public.account_webhooks (account_id);

CREATE INDEX IF NOT EXISTS idx_account_webhooks_active_priority 
    ON public.account_webhooks (account_id, is_active, priority);

CREATE INDEX IF NOT EXISTS idx_account_posting_windows_account_id 
    ON public.account_posting_windows (account_id);

CREATE INDEX IF NOT EXISTS idx_account_posting_windows_acc_day 
    ON public.account_posting_windows (account_id, day_of_week, is_active);

CREATE INDEX IF NOT EXISTS idx_boards_workspace_id 
    ON public.boards (workspace_id);

CREATE INDEX IF NOT EXISTS idx_boards_account_id 
    ON public.boards (account_id);

CREATE INDEX IF NOT EXISTS idx_pins_workspace_id 
    ON public.pins (workspace_id);

CREATE INDEX IF NOT EXISTS idx_pins_account_id 
    ON public.pins (account_id);

CREATE INDEX IF NOT EXISTS idx_pins_workspace_status 
    ON public.pins (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_pins_pending_scheduled 
    ON public.pins (account_id, scheduled_for) 
    WHERE (status = 'pending');

CREATE INDEX IF NOT EXISTS idx_pins_processing_stale 
    ON public.pins (status, processing_started_at) 
    WHERE (status = 'processing');

-- 7. Functions and Workspace Auto-Sync Triggers
CREATE OR REPLACE FUNCTION public.sync_board_workspace_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.workspace_id IS NULL THEN
        SELECT workspace_id INTO NEW.workspace_id FROM public.accounts WHERE id = NEW.account_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_pin_workspace_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.workspace_id IS NULL THEN
        SELECT workspace_id INTO NEW.workspace_id FROM public.accounts WHERE id = NEW.account_id;
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_board_workspace_id ON public.boards;
CREATE TRIGGER trg_sync_board_workspace_id
    BEFORE INSERT OR UPDATE ON public.boards
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_board_workspace_id();

DROP TRIGGER IF EXISTS trg_sync_pin_workspace_id ON public.pins;
CREATE TRIGGER trg_sync_pin_workspace_id
    BEFORE INSERT OR UPDATE ON public.pins
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_pin_workspace_id();

-- 8. Enable Row Level Security (RLS)
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_posting_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pins ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies: Accounts
CREATE POLICY "Workspace access on accounts"
    ON public.accounts
    FOR ALL
    TO authenticated
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Allow service_role full access on accounts"
    ON public.accounts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 10. RLS Policies: Account Webhooks
CREATE POLICY "Workspace members can access account webhooks"
    ON public.account_webhooks
    FOR ALL
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.accounts a 
        WHERE a.id = account_webhooks.account_id 
          AND public.is_workspace_member(a.workspace_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.accounts a 
        WHERE a.id = account_webhooks.account_id 
          AND public.is_workspace_member(a.workspace_id)
    ));

CREATE POLICY "Allow service_role full access on account_webhooks"
    ON public.account_webhooks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 11. RLS Policies: Account Posting Windows
CREATE POLICY "Workspace members can access account posting windows"
    ON public.account_posting_windows
    FOR ALL
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.accounts a 
        WHERE a.id = account_posting_windows.account_id 
          AND public.is_workspace_member(a.workspace_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.accounts a 
        WHERE a.id = account_posting_windows.account_id 
          AND public.is_workspace_member(a.workspace_id)
    ));

CREATE POLICY "Allow service_role full access on account_posting_windows"
    ON public.account_posting_windows
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 12. RLS Policies: Boards
CREATE POLICY "Workspace access on boards"
    ON public.boards
    FOR ALL
    TO authenticated
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Allow service_role full access on boards"
    ON public.boards
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 13. RLS Policies: Pins
CREATE POLICY "Workspace access on pins"
    ON public.pins
    FOR ALL
    TO authenticated
    USING (public.is_workspace_member(workspace_id))
    WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Allow service_role full access on pins"
    ON public.pins
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
