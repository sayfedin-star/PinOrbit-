ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS retention_posted_days INTEGER NOT NULL DEFAULT 90;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS retention_terminal_days INTEGER NOT NULL DEFAULT 90;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS retention_logs_days INTEGER NOT NULL DEFAULT 14;
