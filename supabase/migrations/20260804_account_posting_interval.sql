-- Migration: 20260804_account_posting_interval.sql
-- Description: Add posting_interval_minutes column to public.accounts for per-account scheduling intervals

ALTER TABLE public.accounts 
ADD COLUMN IF NOT EXISTS posting_interval_minutes INTEGER DEFAULT 30 CHECK (posting_interval_minutes >= 1);

COMMENT ON COLUMN public.accounts.posting_interval_minutes IS 'Minutes between automated pin dispatches for this account (e.g. 15, 30, 60)';
