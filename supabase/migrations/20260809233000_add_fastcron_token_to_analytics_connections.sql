-- Migration: Add per-connection fastcron_token to analytics_connections (Project 3)
ALTER TABLE public.analytics_connections
ADD COLUMN IF NOT EXISTS fastcron_token TEXT;
