-- ==============================================================================
-- Migration: 20260811000000_remove_analytics_control_plane.sql
-- Project: Project 1 (Scheduling / Auth Authority)
-- Target Ref: eygdoetdwqllvsxpvoex
-- Domain: Revert Analytics Additions from Project 1
-- ==============================================================================

-- 1. Remove analytics-specific columns from accounts table
ALTER TABLE public.accounts
  DROP COLUMN IF EXISTS analytics_enabled,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS last_analytics_sync_at;

-- 2. Drop workspace_analytics_settings from Project 1 (moved to Project 3)
DROP TABLE IF EXISTS public.workspace_analytics_settings CASCADE;
