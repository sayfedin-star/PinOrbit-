-- Migration: 20260803_account_scheduling.sql
-- Description: Add account scheduling information fields to public.accounts

ALTER TABLE public.accounts 
ADD COLUMN IF NOT EXISTS pinning_started_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS posting_window_start TIME NULL,
ADD COLUMN IF NOT EXISTS posting_window_end TIME NULL,
ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';
