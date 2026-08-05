-- Migration: 20260804_performance_indexes_and_relationships.sql
-- High-Performance Composite Indexes & Relational Integrity Optimizations

-- 1. Index for fast pagination and sorting by created_at per account
CREATE INDEX IF NOT EXISTS idx_pins_account_created
  ON public.pins (account_id, created_at DESC);

-- 2. Index for filtering pins by board_name per account
CREATE INDEX IF NOT EXISTS idx_pins_account_board
  ON public.pins (account_id, board_name);

-- 3. Index for filtering pins by scheduled_for date ranges
CREATE INDEX IF NOT EXISTS idx_pins_account_scheduled
  ON public.pins (account_id, scheduled_for DESC)
  WHERE scheduled_for IS NOT NULL;

-- 4. Index for fast log lookups by account_id and created_at
CREATE INDEX IF NOT EXISTS idx_logs_account_created
  ON public.logs (account_id, created_at DESC);

-- 5. Foreign key performance checks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_boards_account'
  ) THEN
    ALTER TABLE public.boards
      ADD CONSTRAINT fk_boards_account
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 6. Add RLS UPDATE & DELETE Policies for pins, boards, accounts
DROP POLICY IF EXISTS "Allow update on pins" ON public.pins;
CREATE POLICY "Allow update on pins" ON public.pins FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete on pins" ON public.pins;
CREATE POLICY "Allow delete on pins" ON public.pins FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow insert on pins" ON public.pins;
CREATE POLICY "Allow insert on pins" ON public.pins FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update on boards" ON public.boards;
CREATE POLICY "Allow update on boards" ON public.boards FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete on boards" ON public.boards;
CREATE POLICY "Allow delete on boards" ON public.boards FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow update on accounts" ON public.accounts;
CREATE POLICY "Allow update on accounts" ON public.accounts FOR UPDATE USING (true) WITH CHECK (true);

