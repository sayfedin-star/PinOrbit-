-- V20.1: Add per-pipeline date offset controls to analytics_connections
ALTER TABLE public.analytics_connections
  ADD COLUMN IF NOT EXISTS analytics_start_offset_days INTEGER NOT NULL DEFAULT 7 CHECK (analytics_start_offset_days BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS analytics_end_offset_days INTEGER NOT NULL DEFAULT 1 CHECK (analytics_end_offset_days BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS top_pins_start_offset_days INTEGER NOT NULL DEFAULT 7 CHECK (top_pins_start_offset_days BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS top_pins_end_offset_days INTEGER NOT NULL DEFAULT 2 CHECK (top_pins_end_offset_days BETWEEN 0 AND 60),
  ADD CONSTRAINT chk_analytics_offsets_order CHECK (analytics_end_offset_days < analytics_start_offset_days),
  ADD CONSTRAINT chk_top_pins_offsets_order CHECK (top_pins_end_offset_days < top_pins_start_offset_days);
