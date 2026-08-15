-- Migration: 20260823000000_webhook_execution_counters.sql
-- Add executions_used counter to account_webhooks

ALTER TABLE public.account_webhooks ADD COLUMN IF NOT EXISTS executions_used INTEGER NOT NULL DEFAULT 0;
