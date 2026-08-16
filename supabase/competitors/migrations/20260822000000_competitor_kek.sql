-- KEK lives in the Competitors DB (same trust boundary as the data it protects).
-- Self-generated on first use by Worker or by the ingestion script. Never exposed to browser.
CREATE TABLE IF NOT EXISTS public.competitor_kek (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    kek TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.competitor_kek ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'competitor_kek' AND policyname = 'sr_kek') THEN
    CREATE POLICY "sr_kek" ON public.competitor_kek FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
