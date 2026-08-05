-- Migration: 20260804_account_active_days.sql
-- Add active_days column to accounts table for weekly publishing schedule control

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS active_days TEXT[] DEFAULT ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

COMMENT ON COLUMN public.accounts.active_days IS 'Days of the week when automated posting is active (e.g. Mon, Tue, Wed, Thu, Fri, Sat, Sun)';
