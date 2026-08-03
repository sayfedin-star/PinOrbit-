-- Migration: 20260803_multi_webhooks.sql
-- PinOrbit Multi-Webhook Architecture per Pinterest Account Migration

-- 1. Create account_webhooks table
CREATE TABLE IF NOT EXISTS public.account_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  monthly_capacity INTEGER NOT NULL DEFAULT 500,
  monthly_usage INTEGER NOT NULL DEFAULT 0,
  remaining_capacity INTEGER GENERATED ALWAYS AS (monthly_capacity - monthly_usage) STORED,
  priority INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  last_used_at TIMESTAMPTZ NULL,
  last_failed_at TIMESTAMPTZ NULL,
  last_failure_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_monthly_capacity CHECK (monthly_capacity >= 1),
  CONSTRAINT chk_monthly_usage CHECK (monthly_usage >= 0),
  CONSTRAINT chk_priority CHECK (priority >= 1),
  CONSTRAINT unq_account_label UNIQUE (account_id, label),
  CONSTRAINT unq_account_webhook_url UNIQUE (account_id, webhook_url)
);

-- 2. Partial unique index enforcing only ONE primary webhook per account
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_webhooks_primary 
  ON public.account_webhooks (account_id) 
  WHERE is_primary = true;

-- 3. Add foreign key column to public.logs table
ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS webhook_id UUID REFERENCES public.account_webhooks(id) ON DELETE SET NULL;

-- 4. Enable RLS on account_webhooks
ALTER TABLE public.account_webhooks ENABLE ROW LEVEL SECURITY;

-- Clean up existing policies for clean idempotent execution
DROP POLICY IF EXISTS "Allow admin select on account_webhooks" ON public.account_webhooks;
DROP POLICY IF EXISTS "Allow admin insert on account_webhooks" ON public.account_webhooks;
DROP POLICY IF EXISTS "Allow admin update on account_webhooks" ON public.account_webhooks;

-- Create admin RLS policies tied to public.is_admin()
CREATE POLICY "Allow admin select on account_webhooks"
  ON public.account_webhooks
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Allow admin insert on account_webhooks"
  ON public.account_webhooks
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Allow admin update on account_webhooks"
  ON public.account_webhooks
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Ensure service_role full access policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Allow service_role full access on account_webhooks'
  ) THEN
    CREATE POLICY "Allow service_role full access on account_webhooks"
      ON public.account_webhooks
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 5. Data Migration: Populate account_webhooks from existing accounts.webhook_url
INSERT INTO public.account_webhooks (
  account_id,
  label,
  webhook_url,
  monthly_capacity,
  monthly_usage,
  priority,
  is_active,
  is_primary
)
SELECT 
  id AS account_id,
  'Primary' AS label,
  webhook_url,
  500 AS monthly_capacity,
  0 AS monthly_usage,
  1 AS priority,
  true AS is_active,
  true AS is_primary
FROM public.accounts
WHERE webhook_url IS NOT NULL AND webhook_url != ''
ON CONFLICT (account_id, label) DO NOTHING;

-- Deprecation note on accounts.webhook_url
COMMENT ON COLUMN public.accounts.webhook_url IS 'DEPRECATED: Webhooks are now managed via public.account_webhooks table.';

-- 6. Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_account_webhooks ON public.account_webhooks;
CREATE TRIGGER set_updated_at_account_webhooks
  BEFORE UPDATE ON public.account_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Trigger for audit logging
DROP TRIGGER IF EXISTS audit_account_webhooks_trigger ON public.account_webhooks;
CREATE TRIGGER audit_account_webhooks_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.account_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.log_admin_changes();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_account_webhooks_account_id ON public.account_webhooks (account_id);
CREATE INDEX IF NOT EXISTS idx_account_webhooks_active_priority ON public.account_webhooks (account_id, is_active, priority);
