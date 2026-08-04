-- Migration: 20260804_account_random_delay.sql
-- Description: Add random_delay_minutes column to public.accounts

ALTER TABLE public.accounts 
ADD COLUMN IF NOT EXISTS random_delay_minutes INTEGER DEFAULT 0 CHECK (random_delay_minutes >= 0);

COMMENT ON COLUMN public.accounts.random_delay_minutes IS 'Maximum random delay jitter in minutes added to per-account posting interval';
