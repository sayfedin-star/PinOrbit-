-- ============================================================================
-- MIGRATION: 20260807050000_account_timezones_and_posting_slots.sql
-- PURPOSE:
--   1. Add IANA timezone support to public.accounts with trigger validation
--   2. Create public.account_posting_windows normalized via account_id
--   3. Add diagnostic error tracking columns to public.pins
--   4. Build helper to compute the next valid UTC TIMESTAMPTZ posting slot
--   5. Restrict function execution privileges
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ADD IANA TIMEZONE & TRIGGER VALIDATION TO ACCOUNTS
-- ----------------------------------------------------------------------------

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

CREATE OR REPLACE FUNCTION public.validate_account_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.timezone IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names
    WHERE name = NEW.timezone
  ) THEN
    RAISE EXCEPTION 'Invalid IANA timezone identifier: "%". Must exist in pg_timezone_names catalog.', NEW.timezone;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_account_timezone ON public.accounts;

CREATE TRIGGER trg_validate_account_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_account_timezone();

-- Optional backfill example:
-- UPDATE public.accounts
-- SET timezone = 'Africa/Casablanca'
-- WHERE timezone = 'UTC';

-- ----------------------------------------------------------------------------
-- 2. CREATE ACCOUNT POSTING WINDOWS TABLE
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_posting_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    posting_time TIME NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ux_account_posting_window UNIQUE (account_id, day_of_week, posting_time)
);

CREATE INDEX IF NOT EXISTS idx_account_posting_windows_acc_day
  ON public.account_posting_windows (account_id, day_of_week, is_active);

-- ----------------------------------------------------------------------------
-- 3. ENSURE DIAGNOSTIC COLUMNS & PARTIAL QUEUE INDEX EXIST ON PUBLIC.PINS
-- ----------------------------------------------------------------------------

ALTER TABLE public.pins
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code INT,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_pins_pending_queue_utc
  ON public.pins (status, scheduled_for ASC)
  WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 4. RLS SECURITY HARDENING VIA ACCOUNT JOIN
-- ----------------------------------------------------------------------------

ALTER TABLE public.account_posting_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage account posting windows" ON public.account_posting_windows;
DROP POLICY IF EXISTS "Workspace members can read account posting windows" ON public.account_posting_windows;

CREATE POLICY "Admins can manage account posting windows"
  ON public.account_posting_windows FOR ALL TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Workspace members can read account posting windows"
  ON public.account_posting_windows FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = account_posting_windows.account_id
        AND public.is_workspace_member(a.workspace_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 5. FUNCTION: COMPUTE NEXT VALID UTC TIMESTAMPTZ SLOT
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_next_posting_slot(
  p_account_id UUID,
  p_from_utc TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_iana_tz TEXT;
  v_local_from TIMESTAMP;
  v_slot_record RECORD;
  v_candidate_local TIMESTAMP;
  v_candidate_utc TIMESTAMPTZ;
  v_day_offset INT;
BEGIN
  SELECT COALESCE(timezone, 'UTC') INTO v_iana_tz
  FROM public.accounts
  WHERE id = p_account_id;

  IF v_iana_tz IS NULL THEN
    v_iana_tz := 'UTC';
  END IF;

  v_local_from := p_from_utc AT TIME ZONE v_iana_tz;

  FOR v_day_offset IN 0..7 LOOP
    FOR v_slot_record IN
      SELECT day_of_week, posting_time
      FROM public.account_posting_windows
      WHERE account_id = p_account_id
        AND is_active = TRUE
        AND day_of_week = EXTRACT(DOW FROM (v_local_from + (v_day_offset || ' days')::INTERVAL))::INT
      ORDER BY posting_time ASC
    LOOP
      v_candidate_local := (v_local_from::DATE + v_day_offset) + v_slot_record.posting_time;

      IF v_candidate_local > v_local_from THEN
        v_candidate_utc := v_candidate_local AT TIME ZONE v_iana_tz;
        RETURN v_candidate_utc;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. FUNCTION EXECUTION PRIVILEGES
-- ----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.get_next_posting_slot(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_next_posting_slot(UUID, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_next_posting_slot(UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_posting_slot(UUID, TIMESTAMPTZ) TO service_role;
