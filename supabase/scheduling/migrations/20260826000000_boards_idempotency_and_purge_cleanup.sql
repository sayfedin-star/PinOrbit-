-- Migration: Residual cleanup migration (P1 Scheduling)
-- 1. Add created_via_idempotency_key column to boards
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS created_via_idempotency_key TEXT;

-- 2. Partial unique index on (account_id, created_via_idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS ux_boards_account_idempotency_key
ON public.boards (account_id, created_via_idempotency_key)
WHERE created_via_idempotency_key IS NOT NULL;

-- 3. Drop legacy purge_old_pin_delivery_logs 2-argument signature if present
DROP FUNCTION IF EXISTS public.purge_old_pin_delivery_logs(INT, INT);
