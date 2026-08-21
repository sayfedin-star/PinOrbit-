-- Migration: 20260827000000_expand_retention_control.sql
-- Expand workspace_retention_settings to support full per-workspace data-lifecycle control (P1/P2/P3)
-- All automation defaults to DISABLED (false).

ALTER TABLE public.workspace_retention_settings
  ADD COLUMN IF NOT EXISTS auto_prune_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_terminal_days INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS retention_logs_days INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS import_sessions_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS p2_prune_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS competitor_snapshots_days INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS competitor_jobs_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS p3_prune_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ingestion_runs_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS top_pins_raw_days INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS top_pins_downsample_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analytics_daily_keep_days INTEGER; -- RESERVED: not enforced yet; daily analytics are never auto-purged.
