-- ============================================================================
-- migration: 20260806190000_production_master_security_and_rollups
-- purpose:
--   - enforce unified admin-only RLS across operational tables
--   - add long-term competitor_daily_snapshots rollup storage
--   - preserve raw competitor_snapshots for 30-day intraday debugging
--   - harden logs with webhook diagnostic fields and constraints
--   - add query-backed indexes
--   - register pg_cron jobs safely with exception isolation
-- notes:
--   - do not modify previously applied migrations
--   - keep this migration safe re-runnable (IF NOT EXISTS / IF EXISTS guards)
-- ============================================================================


-- ============================================================================
-- 1. verify system functions
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n
      ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'is_admin'
  ) THEN
    RAISE EXCEPTION
      'CRITICAL: public.is_admin() function does not exist. Ensure admin authorization logic is applied first.';
  END IF;
END
$$;


-- ============================================================================
-- 2. create daily rollup table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.competitor_daily_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  profile_reach BIGINT DEFAULT 0,
  profile_views BIGINT DEFAULT 0,
  follower_count INT DEFAULT 0,
  pin_count     INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ux_competitor_daily_snapshot UNIQUE (competitor_id, snapshot_date)
);


-- ============================================================================
-- 3. drop all legacy and partial RLS policies on operational tables
-- ============================================================================

-- accounts — drop all legacy anon / partial policies
DROP POLICY IF EXISTS "Allow anon select on accounts"          ON public.accounts;
DROP POLICY IF EXISTS "Allow anon read accounts"               ON public.accounts;
DROP POLICY IF EXISTS "Allow anon update on accounts"          ON public.accounts;
DROP POLICY IF EXISTS "Allow authenticated update on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow admin select on accounts"         ON public.accounts;
DROP POLICY IF EXISTS "Allow admin insert on accounts"         ON public.accounts;
DROP POLICY IF EXISTS "Allow admin update on accounts"         ON public.accounts;
DROP POLICY IF EXISTS "Admins can manage accounts"             ON public.accounts;

-- boards — drop all legacy anon / partial policies
DROP POLICY IF EXISTS "Allow anon select on boards"      ON public.boards;
DROP POLICY IF EXISTS "Allow anon read boards"           ON public.boards;
DROP POLICY IF EXISTS "Allow admin select on boards"     ON public.boards;
DROP POLICY IF EXISTS "Allow admin insert on boards"     ON public.boards;
DROP POLICY IF EXISTS "Allow admin update on boards"     ON public.boards;
DROP POLICY IF EXISTS "Admins can manage boards"         ON public.boards;

-- pins — drop all legacy anon / partial policies
DROP POLICY IF EXISTS "Allow anon select on pins"  ON public.pins;
DROP POLICY IF EXISTS "Allow anon read pins"       ON public.pins;
DROP POLICY IF EXISTS "Allow admin select on pins" ON public.pins;
DROP POLICY IF EXISTS "Allow admin insert on pins" ON public.pins;
DROP POLICY IF EXISTS "Allow admin update on pins" ON public.pins;
DROP POLICY IF EXISTS "Admins can manage pins"     ON public.pins;

-- logs — drop all legacy anon / partial policies
DROP POLICY IF EXISTS "Allow anon select on logs"  ON public.logs;
DROP POLICY IF EXISTS "Allow anon read logs"       ON public.logs;
DROP POLICY IF EXISTS "Allow admin select on logs" ON public.logs;
DROP POLICY IF EXISTS "Admins can manage logs"     ON public.logs;

-- competitors — drop user-scoped and partial policies
DROP POLICY IF EXISTS "Users can manage their own competitors" ON public.competitors;
DROP POLICY IF EXISTS "Admins can manage competitors"         ON public.competitors;

-- competitor_snapshots — drop user-scoped and partial policies
DROP POLICY IF EXISTS "Users can manage snapshots for their competitors" ON public.competitor_snapshots;
DROP POLICY IF EXISTS "Admins can manage competitor snapshots"           ON public.competitor_snapshots;

-- competitor_boards — drop user-scoped and partial policies
DROP POLICY IF EXISTS "Users can manage board strategy for their competitors" ON public.competitor_boards;
DROP POLICY IF EXISTS "Admins can manage competitor boards"                   ON public.competitor_boards;

-- competitor_daily_snapshots — drop any prior attempt
DROP POLICY IF EXISTS "Admins can manage daily snapshots" ON public.competitor_daily_snapshots;


-- ============================================================================
-- 4. enable RLS on all operational tables
-- ============================================================================

ALTER TABLE public.accounts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pins                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitors               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_boards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_daily_snapshots ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 5. create unified admin-only policies
-- ============================================================================

CREATE POLICY "Admins can manage accounts"
  ON public.accounts
  FOR ALL
  TO authenticated
  USING      ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins can manage boards"
  ON public.boards
  FOR ALL
  TO authenticated
  USING      ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins can manage pins"
  ON public.pins
  FOR ALL
  TO authenticated
  USING      ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins can manage logs"
  ON public.logs
  FOR ALL
  TO authenticated
  USING      ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins can manage competitors"
  ON public.competitors
  FOR ALL
  TO authenticated
  USING      ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins can manage competitor snapshots"
  ON public.competitor_snapshots
  FOR ALL
  TO authenticated
  USING      ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins can manage competitor boards"
  ON public.competitor_boards
  FOR ALL
  TO authenticated
  USING      ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins can manage daily snapshots"
  ON public.competitor_daily_snapshots
  FOR ALL
  TO authenticated
  USING      ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));


-- ============================================================================
-- 6. backfill competitor_daily_snapshots from raw snapshots
--    (latest snapshot per competitor per UTC day)
-- ============================================================================

INSERT INTO public.competitor_daily_snapshots (
  competitor_id,
  snapshot_date,
  profile_reach,
  profile_views,
  follower_count,
  pin_count,
  created_at
)
SELECT
  ranked.competitor_id,
  ranked.snapshot_date,
  ranked.profile_reach,
  ranked.profile_views,
  ranked.follower_count,
  ranked.pin_count,
  NOW()
FROM (
  SELECT
    cs.competitor_id,
    (cs.recorded_at AT TIME ZONE 'UTC')::date AS snapshot_date,
    cs.profile_reach,
    cs.profile_views,
    cs.follower_count,
    cs.pin_count,
    row_number() OVER (
      PARTITION BY cs.competitor_id, (cs.recorded_at AT TIME ZONE 'UTC')::date
      ORDER BY cs.recorded_at DESC, cs.id DESC
    ) AS rn
  FROM public.competitor_snapshots cs
) ranked
WHERE ranked.rn = 1
ON CONFLICT (competitor_id, snapshot_date)
DO UPDATE SET
  profile_reach  = EXCLUDED.profile_reach,
  profile_views  = EXCLUDED.profile_views,
  follower_count = EXCLUDED.follower_count,
  pin_count      = EXCLUDED.pin_count,
  created_at     = NOW();


-- ============================================================================
-- 7. logging diagnostics — add diagnostic columns + range/length constraints
-- ============================================================================

ALTER TABLE public.logs
  ADD COLUMN IF NOT EXISTS event_type     TEXT,
  ADD COLUMN IF NOT EXISTS http_status    SMALLINT,
  ADD COLUMN IF NOT EXISTS response_body  TEXT,
  ADD COLUMN IF NOT EXISTS error_message  TEXT;

DO $$
BEGIN

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_logs_http_status'
  ) THEN
    ALTER TABLE public.logs
      ADD CONSTRAINT chk_logs_http_status
      CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_logs_response_body_length'
  ) THEN
    ALTER TABLE public.logs
      ADD CONSTRAINT chk_logs_response_body_length
      CHECK (response_body IS NULL OR char_length(response_body) <= 4000);
  END IF;

END
$$;


-- ============================================================================
-- 8. performance indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_snapshots_comp_time
  ON public.competitor_snapshots (competitor_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_snapshots_competitor_date
  ON public.competitor_daily_snapshots (competitor_id, snapshot_date DESC);

-- guard index creation on pins.scheduled_for — column may not exist on all envs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'pins'
      AND column_name  = 'scheduled_for'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_pins_pending_scheduled
      ON public.pins (account_id, scheduled_for)
      WHERE status = 'pending';
  ELSE
    RAISE NOTICE
      'Skipping idx_pins_pending_scheduled: public.pins.scheduled_for column does not exist.';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_competitor_boards_activity
  ON public.competitor_boards (competitor_id, last_pinned_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_logs_account_created_desc
  ON public.logs (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_logs_event_type_created_desc
  ON public.logs (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_logs_errors_created_desc
  ON public.logs (created_at DESC)
  WHERE status = 'error';


-- ============================================================================
-- 9. automated dual pg_cron pipeline with exception isolation
-- ============================================================================

DO $$
DECLARE
  job_rollup_id BIGINT;
  job_prune_id  BIGINT;
BEGIN

  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN

    BEGIN

      -- unschedule existing rollup job if present
      SELECT jobid INTO job_rollup_id
      FROM cron.job
      WHERE jobname = 'refresh-competitor-daily-snapshots';

      IF job_rollup_id IS NOT NULL THEN
        PERFORM cron.unschedule(job_rollup_id);
      END IF;

      -- register daily rollup at 02:45 UTC
      PERFORM cron.schedule(
        'refresh-competitor-daily-snapshots',
        '45 2 * * *',
        $cmd$
          INSERT INTO public.competitor_daily_snapshots (
            competitor_id,
            snapshot_date,
            profile_reach,
            profile_views,
            follower_count,
            pin_count,
            created_at
          )
          SELECT
            competitor_id,
            snapshot_date,
            profile_reach,
            profile_views,
            follower_count,
            pin_count,
            NOW()
          FROM (
            SELECT
              cs.competitor_id,
              (cs.recorded_at AT TIME ZONE 'UTC')::date AS snapshot_date,
              cs.profile_reach,
              cs.profile_views,
              cs.follower_count,
              cs.pin_count,
              row_number() OVER (
                PARTITION BY cs.competitor_id,
                             (cs.recorded_at AT TIME ZONE 'UTC')::date
                ORDER BY cs.recorded_at DESC, cs.id DESC
              ) AS rn
            FROM public.competitor_snapshots cs
          ) latest
          WHERE rn = 1
          ON CONFLICT (competitor_id, snapshot_date)
          DO UPDATE SET
            profile_reach  = EXCLUDED.profile_reach,
            profile_views  = EXCLUDED.profile_views,
            follower_count = EXCLUDED.follower_count,
            pin_count      = EXCLUDED.pin_count,
            created_at     = NOW();
        $cmd$
      );

      -- unschedule existing prune job if present
      SELECT jobid INTO job_prune_id
      FROM cron.job
      WHERE jobname = 'prune-old-competitor-snapshots';

      IF job_prune_id IS NOT NULL THEN
        PERFORM cron.unschedule(job_prune_id);
      END IF;

      -- register 30-day raw snapshot pruning at 03:00 UTC
      PERFORM cron.schedule(
        'prune-old-competitor-snapshots',
        '0 3 * * *',
        $cmd$
          DELETE FROM public.competitor_snapshots
          WHERE recorded_at < NOW() - INTERVAL '30 days';
        $cmd$
      );

      RAISE NOTICE 'pg_cron jobs successfully registered.';

    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron job registration skipped due to error: %', SQLERRM;
    END;

  ELSE
    RAISE NOTICE 'pg_cron extension is not enabled on this database; skipping cron job registration.';
  END IF;

END
$$;
