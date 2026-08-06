-- ============================================================================
-- migration: 20260806194000_add_workspaces_mvp
-- purpose:
--   - Introduce public.workspaces and public.workspace_memberships
--   - Add workspace_id to accounts, competitors, boards, pins, competitor_boards
--     with ON DELETE RESTRICT (conservative deletion model)
--   - Create Default Workspace and backfill all legacy operational data
--   - Enforce NOT NULL on workspace_id columns post-backfill
--   - Add workspace performance indexes and consistency triggers
--   - Audit and drop legacy/broad policies
--   - Apply strict workspace-scoped RLS policies & public.is_admin() management policies
-- ============================================================================

-- 1. Create public.workspaces table
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create public.workspace_memberships table
CREATE TABLE IF NOT EXISTS public.workspace_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT ux_workspace_membership UNIQUE (workspace_id, user_id)
);

-- 3. Add workspace_id column to operational tables (nullable initially, ON DELETE RESTRICT for safety)
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.competitors ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.pins ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT;
ALTER TABLE public.competitor_boards ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT;

-- 4. Create Default Workspace
INSERT INTO public.workspaces (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Workspace', 'default')
ON CONFLICT (id) DO NOTHING;

-- Backfill memberships for existing auth.users in Default Workspace
INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
SELECT '00000000-0000-0000-0000-000000000001', id, 'owner'
FROM auth.users
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- 5. Backfill all legacy operational rows into Default Workspace
UPDATE public.accounts
SET workspace_id = '00000000-0000-0000-0000-000000000001'
WHERE workspace_id IS NULL;

UPDATE public.competitors
SET workspace_id = '00000000-0000-0000-0000-000000000001'
WHERE workspace_id IS NULL;

UPDATE public.boards
SET workspace_id = COALESCE(
    (SELECT workspace_id FROM public.accounts WHERE accounts.id = boards.account_id),
    '00000000-0000-0000-0000-000000000001'
)
WHERE workspace_id IS NULL;

UPDATE public.pins
SET workspace_id = COALESCE(
    (SELECT workspace_id FROM public.accounts WHERE accounts.id = pins.account_id),
    '00000000-0000-0000-0000-000000000001'
)
WHERE workspace_id IS NULL;

UPDATE public.competitor_boards
SET workspace_id = COALESCE(
    (SELECT workspace_id FROM public.competitors WHERE competitors.id = competitor_boards.competitor_id),
    '00000000-0000-0000-0000-000000000001'
)
WHERE workspace_id IS NULL;

-- 6. Enforce NOT NULL on workspace_id columns
ALTER TABLE public.accounts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.competitors ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.boards ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.pins ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.competitor_boards ALTER COLUMN workspace_id SET NOT NULL;

-- 7. Add performance indexes
CREATE INDEX IF NOT EXISTS idx_accounts_workspace_id ON public.accounts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_competitors_workspace_id ON public.competitors(workspace_id);
CREATE INDEX IF NOT EXISTS idx_boards_workspace_id ON public.boards(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pins_workspace_id ON public.pins(workspace_id);
CREATE INDEX IF NOT EXISTS idx_competitor_boards_workspace_id ON public.competitor_boards(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace_user ON public.workspace_memberships(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_id ON public.workspace_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_pins_workspace_status ON public.pins(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_accounts_workspace_active ON public.accounts(workspace_id, is_active);

-- 8. Create security helper function is_workspace_member
CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id
      AND user_id = auth.uid()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_workspace_member(UUID) FROM public;
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID) TO authenticated;

-- 9. Create consistency triggers to prevent workspace drift
CREATE OR REPLACE FUNCTION public.sync_board_workspace_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.accounts
  WHERE id = NEW.account_id;

  IF v_workspace_id IS NOT NULL THEN
    NEW.workspace_id := v_workspace_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_board_workspace_id ON public.boards;
CREATE TRIGGER trg_sync_board_workspace_id
  BEFORE INSERT OR UPDATE OF account_id ON public.boards
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_board_workspace_id();

CREATE OR REPLACE FUNCTION public.sync_pin_workspace_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.accounts
  WHERE id = NEW.account_id;

  IF v_workspace_id IS NOT NULL THEN
    NEW.workspace_id := v_workspace_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pin_workspace_id ON public.pins;
CREATE TRIGGER trg_sync_pin_workspace_id
  BEFORE INSERT OR UPDATE OF account_id ON public.pins
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_pin_workspace_id();

CREATE OR REPLACE FUNCTION public.sync_competitor_board_workspace_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.competitors
  WHERE id = NEW.competitor_id;

  IF v_workspace_id IS NOT NULL THEN
    NEW.workspace_id := v_workspace_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_competitor_board_workspace_id ON public.competitor_boards;
CREATE TRIGGER trg_sync_competitor_board_workspace_id
  BEFORE INSERT OR UPDATE OF competitor_id ON public.competitor_boards
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_competitor_board_workspace_id();

-- 10. Audit, drop legacy/broad policies, and apply workspace-scoped RLS & admin management policies
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_boards ENABLE ROW LEVEL SECURITY;

-- Drop all legacy and broad policies across all operational tables
DROP POLICY IF EXISTS "Allow anon select on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow anon read accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow anon update on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow authenticated update on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow admin select on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow admin insert on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow admin update on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Admins can manage accounts" ON public.accounts;

DROP POLICY IF EXISTS "Allow anon select on boards" ON public.boards;
DROP POLICY IF EXISTS "Allow anon read boards" ON public.boards;
DROP POLICY IF EXISTS "Allow admin select on boards" ON public.boards;
DROP POLICY IF EXISTS "Allow admin insert on boards" ON public.boards;
DROP POLICY IF EXISTS "Allow admin update on boards" ON public.boards;
DROP POLICY IF EXISTS "Admins can manage boards" ON public.boards;

DROP POLICY IF EXISTS "Allow anon select on pins" ON public.pins;
DROP POLICY IF EXISTS "Allow anon read pins" ON public.pins;
DROP POLICY IF EXISTS "Allow admin select on pins" ON public.pins;
DROP POLICY IF EXISTS "Allow admin insert on pins" ON public.pins;
DROP POLICY IF EXISTS "Allow admin update on pins" ON public.pins;
DROP POLICY IF EXISTS "Admins can manage pins" ON public.pins;

DROP POLICY IF EXISTS "Users can manage their own competitors" ON public.competitors;
DROP POLICY IF EXISTS "Admins can manage competitors" ON public.competitors;

DROP POLICY IF EXISTS "Users can manage snapshots for their competitors" ON public.competitor_snapshots;
DROP POLICY IF EXISTS "Admins can manage competitor snapshots" ON public.competitor_snapshots;

DROP POLICY IF EXISTS "Users can manage board strategy for their competitors" ON public.competitor_boards;
DROP POLICY IF EXISTS "Admins can manage competitor boards" ON public.competitor_boards;

DROP POLICY IF EXISTS "Admins can manage daily snapshots" ON public.competitor_daily_snapshots;

DROP POLICY IF EXISTS "Admins can manage workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can read member workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Admins can manage workspace memberships" ON public.workspace_memberships;
DROP POLICY IF EXISTS "Users can read own workspace memberships" ON public.workspace_memberships;

DROP POLICY IF EXISTS "Workspace access on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Workspace access on competitors" ON public.competitors;
DROP POLICY IF EXISTS "Workspace access on boards" ON public.boards;
DROP POLICY IF EXISTS "Workspace access on pins" ON public.pins;
DROP POLICY IF EXISTS "Workspace access on competitor_boards" ON public.competitor_boards;

-- Workspaces Policies (Read for Members, Management for Admins)
CREATE POLICY "Users can read member workspaces"
  ON public.workspaces
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(id));

CREATE POLICY "Admins can manage workspaces"
  ON public.workspaces
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Workspace Memberships Policies (Read for Self/Members, Management for Admins)
CREATE POLICY "Users can read own workspace memberships"
  ON public.workspace_memberships
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_workspace_member(workspace_id));

CREATE POLICY "Admins can manage workspace memberships"
  ON public.workspace_memberships
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Operational Tables Workspace Policies
CREATE POLICY "Workspace access on accounts"
  ON public.accounts
  FOR ALL
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace access on competitors"
  ON public.competitors
  FOR ALL
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace access on boards"
  ON public.boards
  FOR ALL
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace access on pins"
  ON public.pins
  FOR ALL
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Workspace access on competitor_boards"
  ON public.competitor_boards
  FOR ALL
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
