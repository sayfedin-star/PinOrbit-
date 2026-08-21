ALTER TABLE public.workspace_retention_settings
  ADD COLUMN IF NOT EXISTS last_cleanup_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_cleanup_result JSONB;
