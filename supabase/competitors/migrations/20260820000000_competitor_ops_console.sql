CREATE TABLE IF NOT EXISTS public.competitor_top_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
    pin_id VARCHAR(255) NOT NULL,
    title TEXT,
    description TEXT,
    image_url TEXT,
    save_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    link TEXT,
    captured_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_competitor_pin UNIQUE (competitor_id, pin_id)
);

CREATE TABLE IF NOT EXISTS public.pinterest_cookies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    cookie_value TEXT NOT NULL,              -- stored as "v1:<iv>:<ct>" via token-crypto
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.competitor_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id UUID NOT NULL REFERENCES public.competitors(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    update_frequency_hours INTEGER DEFAULT 24,
    last_manual_update TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_competitor_setting UNIQUE (competitor_id)
);

CREATE TABLE IF NOT EXISTS public.competitor_pipeline_settings (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),   -- singleton
    workspace_id UUID NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    dry_run BOOLEAN DEFAULT false,
    max_retries INTEGER DEFAULT 3,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.competitors ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_competitor_top_pins_competitor_id ON public.competitor_top_pins (competitor_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_pinterest_cookies_workspace_active ON public.pinterest_cookies (workspace_id, is_active);
CREATE INDEX IF NOT EXISTS idx_competitor_settings_active ON public.competitor_settings (is_active);
CREATE INDEX IF NOT EXISTS idx_competitors_workspace_active ON public.competitors (workspace_id, is_active);

ALTER TABLE public.competitor_top_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pinterest_cookies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_pipeline_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'competitor_top_pins' AND policyname = 'sr_top_pins') THEN
    CREATE POLICY "sr_top_pins" ON public.competitor_top_pins FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pinterest_cookies' AND policyname = 'sr_cookies') THEN
    CREATE POLICY "sr_cookies" ON public.pinterest_cookies FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'competitor_settings' AND policyname = 'sr_comp_settings') THEN
    CREATE POLICY "sr_comp_settings" ON public.competitor_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'competitor_pipeline_settings' AND policyname = 'sr_pipeline') THEN
    CREATE POLICY "sr_pipeline" ON public.competitor_pipeline_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
