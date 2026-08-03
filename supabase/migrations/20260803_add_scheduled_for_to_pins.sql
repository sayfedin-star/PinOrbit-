-- Migration: 20260803_add_scheduled_for_to_pins.sql
-- PinOrbit Importer: Add scheduled_for to pins & Create import_sessions audit table

-- 1. Add scheduled_for column to public.pins
ALTER TABLE public.pins ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ NULL;

-- Index for scheduled queries
CREATE INDEX IF NOT EXISTS idx_pins_scheduled_for ON public.pins (account_id, status, scheduled_for);

-- Allow authenticated admin users to insert pins (for scheduled post importer)
DROP POLICY IF EXISTS "Allow admin insert on pins" ON public.pins;
CREATE POLICY "Allow admin insert on pins"
  ON public.pins
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- 2. Create import_sessions table for tracking import jobs
CREATE TABLE IF NOT EXISTS public.import_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL, -- 'csv_upload' or 'google_sheets'
  source_label TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Enable RLS on import_sessions
ALTER TABLE public.import_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow admin select on import_sessions" ON public.import_sessions;
DROP POLICY IF EXISTS "Allow admin insert on import_sessions" ON public.import_sessions;

CREATE POLICY "Allow admin select on import_sessions"
  ON public.import_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Allow admin insert on import_sessions"
  ON public.import_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Allow service_role full access on import_sessions'
  ) THEN
    CREATE POLICY "Allow service_role full access on import_sessions"
      ON public.import_sessions
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
