-- ==============================================================================
-- Migration: 20260815000000_allow_same_day_offset_ranges.sql
-- Project: Project 3 (Analytics - Server-Only Database)
-- Purpose: V20.2 — Relax per-pipeline date offset ordering constraints to 
--          allow same-day ranges (end offset may EQUAL start offset).
--          Inverted ranges (end > start) remain rejected.
-- ==============================================================================

ALTER TABLE public.analytics_connections
  DROP CONSTRAINT IF EXISTS chk_analytics_offsets_order,
  DROP CONSTRAINT IF EXISTS chk_top_pins_offsets_order,
  ADD CONSTRAINT chk_analytics_offsets_order 
    CHECK (analytics_end_offset_days <= analytics_start_offset_days),
  ADD CONSTRAINT chk_top_pins_offsets_order 
    CHECK (top_pins_end_offset_days <= top_pins_start_offset_days);
