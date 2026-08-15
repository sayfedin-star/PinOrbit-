-- Migration: Add cron_expression column to posting_schedules
-- Supports provider-agnostic custom cron expressions from Visual / Raw Cron Builder
ALTER TABLE public.posting_schedules ADD COLUMN IF NOT EXISTS cron_expression TEXT;
