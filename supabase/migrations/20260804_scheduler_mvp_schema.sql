-- Migration: 20260804_scheduler_mvp_schema.sql
-- Description: Update database schema for PinOrbit Scheduler MVP concurrency & tracking

-- 1. Safely drop any existing constraint on pins.status and apply updated check constraint
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT constraint_name 
    FROM information_schema.constraint_column_usage 
    WHERE table_name = 'pins' AND column_name = 'status'
  ) LOOP
    EXECUTE 'ALTER TABLE public.pins DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.pins ADD CONSTRAINT pins_status_check CHECK (status IN ('pending', 'processing', 'posted', 'failed'));

-- 2. Add processing_started_at column for locking & concurrency control
ALTER TABLE public.pins ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ NULL;

-- 3. Add last_published_at column to public.accounts
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMPTZ NULL;

-- 4. Create optimized index for scheduler candidate pin lookups
CREATE INDEX IF NOT EXISTS idx_pins_scheduler_eligible 
  ON public.pins (account_id, status, scheduled_for);

-- 5. Create index on processing_started_at for stale lock recovery
CREATE INDEX IF NOT EXISTS idx_pins_processing_stale 
  ON public.pins (status, processing_started_at) 
  WHERE status = 'processing';
