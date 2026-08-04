-- Migration: 20260804_pins_retry_system.sql
-- Description: Add retry tracking columns and performance indexes to pins table

ALTER TABLE pins 
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS last_failure_reason TEXT NULL,
ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS failure_type TEXT NULL;

-- Add indexes for fast lookup and scheduling
CREATE INDEX IF NOT EXISTS idx_pins_account_id ON pins(account_id);
CREATE INDEX IF NOT EXISTS idx_pins_status ON pins(status);
CREATE INDEX IF NOT EXISTS idx_pins_status_next_retry ON pins(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_pins_scheduled_for ON pins(scheduled_for);
