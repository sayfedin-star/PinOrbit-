-- ============================================================================
-- MIGRATION: 20260807060000_pins_slimming_and_pin_delivery_logs.sql
-- PURPOSE:
--   1. Create public.pin_delivery_logs as append-only operational/audit log
--   2. Keep public.pins lightweight for queue selection and status updates
--   3. Add helper function to append delivery log events
--   4. Add retention cleanup for old delivery logs
--   5. Register optional pg_cron cleanup job for delivery log retention
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CREATE PIN DELIVERY LOGS TABLE
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pin_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id UUID NOT NULL REFERENCES public.pins(id) ON DELETE CASCADE,
    attempt_no INT NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
    event_type TEXT NOT NULL,
    provider TEXT,
    http_status INT,
    error_code INT,
    error_message TEXT,
    response_excerpt TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pin_delivery_logs_event_type_chk CHECK (char_length(event_type) > 0),
    CONSTRAINT pin_delivery_logs_provider_len_chk CHECK (provider IS NULL OR char_length(provider) <= 100),
    CONSTRAINT pin_delivery_logs_error_message_len_chk CHECK (error_message IS NULL OR char_length(error_message) <= 2000),
    CONSTRAINT pin_delivery_logs_response_excerpt_len_chk CHECK (response_excerpt IS NULL OR char_length(response_excerpt) <= 4000)
);

COMMENT ON TABLE public.pin_delivery_logs IS
  'Append-only per-attempt and per-event delivery history for pins. Keeps public.pins lightweight for operational queue access.';

COMMENT ON COLUMN public.pin_delivery_logs.metadata IS
  'Flexible structured metadata for provider payload fragments, response details, and diagnostics. Keep documents small.';

-- ----------------------------------------------------------------------------
-- 2. INDEXES
-- ----------------------------------------------------------------------------

-- Main access path: fetch recent logs for a given pin
CREATE INDEX IF NOT EXISTS idx_pin_delivery_logs_pin_created
  ON public.pin_delivery_logs (pin_id, created_at DESC);

-- Secondary access path: inspect recent failures/rate limits by event type
CREATE INDEX IF NOT EXISTS idx_pin_delivery_logs_event_created
  ON public.pin_delivery_logs (event_type, created_at DESC);

-- Retention and purge efficiency
CREATE INDEX IF NOT EXISTS idx_pin_delivery_logs_created_at
  ON public.pin_delivery_logs (created_at ASC);

-- Optional hot subset for failure-centric operational review
CREATE INDEX IF NOT EXISTS idx_pin_delivery_logs_failures_created
  ON public.pin_delivery_logs (created_at DESC)
  WHERE event_type IN ('failed', 'rate_limited', 'provider_error');

-- ----------------------------------------------------------------------------
-- 3. ENABLE RLS
-- ----------------------------------------------------------------------------

ALTER TABLE public.pin_delivery_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage pin delivery logs" ON public.pin_delivery_logs;
DROP POLICY IF EXISTS "Workspace members can read pin delivery logs" ON public.pin_delivery_logs;

CREATE POLICY "Admins can manage pin delivery logs"
  ON public.pin_delivery_logs
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Workspace members can read pin delivery logs"
  ON public.pin_delivery_logs
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.pins p
      JOIN public.accounts a ON a.id = p.account_id
      WHERE p.id = pin_delivery_logs.pin_id
        AND public.is_workspace_member(a.workspace_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 4. HELPER FUNCTION TO APPEND LOG EVENTS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.append_pin_delivery_log(
  p_pin_id UUID,
  p_attempt_no INT DEFAULT 1,
  p_event_type TEXT DEFAULT 'info',
  p_provider TEXT DEFAULT NULL,
  p_http_status INT DEFAULT NULL,
  p_error_code INT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_response_excerpt TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.pin_delivery_logs (
    pin_id,
    attempt_no,
    event_type,
    provider,
    http_status,
    error_code,
    error_message,
    response_excerpt,
    metadata
  )
  VALUES (
    p_pin_id,
    GREATEST(COALESCE(p_attempt_no, 1), 1),
    COALESCE(NULLIF(BTRIM(p_event_type), ''), 'info'),
    NULLIF(BTRIM(p_provider), ''),
    p_http_status,
    p_error_code,
    CASE
      WHEN p_error_message IS NULL THEN NULL
      ELSE LEFT(p_error_message, 2000)
    END,
    CASE
      WHEN p_response_excerpt IS NULL THEN NULL
      ELSE LEFT(p_response_excerpt, 4000)
    END,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.append_pin_delivery_log(
  UUID, INT, TEXT, TEXT, INT, INT, TEXT, TEXT, JSONB
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.append_pin_delivery_log(
  UUID, INT, TEXT, TEXT, INT, INT, TEXT, TEXT, JSONB
) FROM anon;

GRANT EXECUTE ON FUNCTION public.append_pin_delivery_log(
  UUID, INT, TEXT, TEXT, INT, INT, TEXT, TEXT, JSONB
) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. RETENTION CLEANUP FUNCTION
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purge_old_pin_delivery_logs(
  p_keep_success_days INT DEFAULT 60,
  p_keep_failure_days INT DEFAULT 180,
  p_workspace_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.pin_delivery_logs
  WHERE event_type IN ('queued', 'dispatched', 'success', 'published', 'info')
    AND created_at < NOW() - MAKE_INTERVAL(days => GREATEST(p_keep_success_days, 1))
    AND (p_workspace_id IS NULL OR EXISTS (
      SELECT 1 FROM public.pins p
      WHERE p.id = pin_delivery_logs.pin_id
        AND p.workspace_id = p_workspace_id
    ));

  DELETE FROM public.pin_delivery_logs
  WHERE event_type IN ('failed', 'rate_limited', 'provider_error')
    AND created_at < NOW() - MAKE_INTERVAL(days => GREATEST(p_keep_failure_days, 1))
    AND (p_workspace_id IS NULL OR EXISTS (
      SELECT 1 FROM public.pins p
      WHERE p.id = pin_delivery_logs.pin_id
        AND p.workspace_id = p_workspace_id
    ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_pin_delivery_logs(INT, INT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_old_pin_delivery_logs(INT, INT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_old_pin_delivery_logs(INT, INT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_pin_delivery_logs(INT, INT, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. OPTIONAL PG_CRON REGISTRATION FOR LOG RETENTION
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    BEGIN
      PERFORM cron.unschedule('weekly-pin-delivery-log-retention');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'weekly-pin-delivery-log-retention',
      '30 3 * * 0',
      $cmd$
        SELECT public.purge_old_pin_delivery_logs(60, 180);
      $cmd$
    );
  END IF;
END $$;
