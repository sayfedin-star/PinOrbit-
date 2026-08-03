-- Migration: create_pinorbit_schema
-- Created for PinOrbit Pinterest Automation System

-- 1. Create accounts table
CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_name TEXT UNIQUE NOT NULL,
    webhook_url TEXT NOT NULL,
    max_pins_per_day INTEGER DEFAULT 20,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create boards table
CREATE TABLE IF NOT EXISTS public.boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    board_name TEXT NOT NULL,
    board_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create pins table
CREATE TABLE IF NOT EXISTS public.pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    image_url TEXT NOT NULL,
    board_name TEXT,
    link TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'failed')),
    source TEXT DEFAULT 'google_sheets',
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create logs table
CREATE TABLE IF NOT EXISTS public.logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id UUID REFERENCES public.pins(id) ON DELETE SET NULL,
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
    status TEXT CHECK (status IN ('success', 'error')),
    message TEXT,
    webhook_used TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for optimized querying
CREATE INDEX IF NOT EXISTS idx_pins_account_id_status ON public.pins (account_id, status);
CREATE INDEX IF NOT EXISTS idx_boards_account_id ON public.boards (account_id);
CREATE INDEX IF NOT EXISTS idx_logs_pin_id ON public.logs (pin_id);
CREATE INDEX IF NOT EXISTS idx_logs_account_id ON public.logs (account_id);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- Policies for anon role (SELECT only)
CREATE POLICY "Allow anon select on accounts" ON public.accounts FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon select on boards" ON public.boards FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon select on pins" ON public.pins FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon select on logs" ON public.logs FOR SELECT TO anon USING (true);

-- Policies for service_role (Full Access: INSERT, UPDATE, DELETE, SELECT)
CREATE POLICY "Allow service_role full access on accounts" ON public.accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow service_role full access on boards" ON public.boards FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow service_role full access on pins" ON public.pins FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow service_role full access on logs" ON public.logs FOR ALL TO service_role USING (true) WITH CHECK (true);
