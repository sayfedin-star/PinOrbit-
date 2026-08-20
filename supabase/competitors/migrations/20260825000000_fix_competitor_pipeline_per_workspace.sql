-- Migration: 20260825000000_fix_competitor_pipeline_per_workspace.sql
-- Project: P2 Competitors DB

-- 1. Create new table with workspace_id as primary key
CREATE TABLE IF NOT EXISTS public.competitor_pipeline_settings_new (
    workspace_id UUID PRIMARY KEY,
    is_enabled BOOLEAN DEFAULT true,
    dry_run BOOLEAN DEFAULT false,
    max_retries INTEGER DEFAULT 3,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Copy existing singleton row data to all workspaces
INSERT INTO public.competitor_pipeline_settings_new 
    (workspace_id, is_enabled, dry_run, max_retries, updated_at)
SELECT 
    w.id AS workspace_id,
    COALESCE(cps.is_enabled, true),
    COALESCE(cps.dry_run, false),
    COALESCE(cps.max_retries, 3),
    COALESCE(cps.updated_at, now())
FROM public.workspaces w
LEFT JOIN public.competitor_pipeline_settings cps ON true
ON CONFLICT (workspace_id) DO NOTHING;

-- 3. Drop old singleton table
DROP TABLE IF EXISTS public.competitor_pipeline_settings;

-- 4. Rename new table
ALTER TABLE public.competitor_pipeline_settings_new 
    RENAME TO competitor_pipeline_settings;

-- 5. Re-apply RLS
ALTER TABLE public.competitor_pipeline_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sr_pipeline_settings" ON public.competitor_pipeline_settings;
CREATE POLICY "sr_pipeline_settings" ON public.competitor_pipeline_settings 
    FOR ALL TO service_role USING (true) WITH CHECK (true);
