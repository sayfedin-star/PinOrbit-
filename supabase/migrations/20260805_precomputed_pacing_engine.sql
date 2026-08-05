-- Migration: 20260805_precomputed_pacing_engine.sql
-- Description: Pre-computed Pacing Engine PL/pgSQL function to assign randomized target timestamps incorporating interval + random delay jitter

CREATE OR REPLACE FUNCTION public.reschedule_account_pending_pins(target_account_id UUID)
RETURNS VOID AS $$
DECLARE
  acc RECORD;
  pin_rec RECORD;
  next_slot TIMESTAMPTZ;
  interval_mins INT;
  delay_mins INT;
  jitter_mins INT;
BEGIN
  -- 1. Fetch account schedule settings
  SELECT * INTO acc FROM public.accounts WHERE id = target_account_id;
  IF NOT FOUND THEN RETURN; END IF;

  interval_mins := COALESCE(acc.posting_interval_minutes, 30);
  delay_mins := COALESCE(acc.random_delay_minutes, 0);

  -- 2. Determine baseline start time
  SELECT GREATEST(NOW(), COALESCE(MAX(posted_at), NOW()))
  INTO next_slot
  FROM public.pins
  WHERE account_id = target_account_id AND status = 'posted';

  IF next_slot IS NULL THEN
    next_slot := NOW();
  END IF;

  -- 3. Loop through all PENDING pins and apply interval + random delay jitter
  FOR pin_rec IN 
    SELECT id FROM public.pins 
    WHERE account_id = target_account_id AND status = 'pending'
    ORDER BY created_at ASC, id ASC
  LOOP
    -- Calculate random jitter between 0 and random_delay_minutes
    IF delay_mins > 0 THEN
      jitter_mins := floor(random() * (delay_mins + 1))::INT;
    ELSE
      jitter_mins := 0;
    END IF;

    -- Add interval + random jitter
    next_slot := next_slot + ((interval_mins + jitter_mins) || ' minutes')::INTERVAL;

    -- Update pin record with concrete randomized timestamp
    UPDATE public.pins 
    SET scheduled_for = next_slot 
    WHERE id = pin_rec.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.reschedule_account_pending_pins(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_account_pending_pins(UUID) TO service_role;
