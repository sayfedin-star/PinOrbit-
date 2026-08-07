-- ==============================================================================
-- Migration: 20260808000000_init_scheduling_tenants_and_auth.sql
-- Project: Project 1 (Scheduling / Auth Authority) - Ref: eygdoetdwqllvsxpvoex
-- Domain: Core Auth, Workspaces, Memberships, Admin Roles, and Tenant Security
-- ==============================================================================

-- 1. Workspaces Table
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Workspace Memberships (Tenant Isolation & RBAC)
CREATE TABLE IF NOT EXISTS public.workspace_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_workspace_membership UNIQUE (workspace_id, user_id)
);

-- 3. Admin Users (Platform Level Superusers)
CREATE TABLE IF NOT EXISTS public.admin_users (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Covering Indexes for Tenant Authorization
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_id 
    ON public.workspace_memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace_user 
    ON public.workspace_memberships (workspace_id, user_id);

-- 5. Helper Functions for RLS (SECURITY DEFINER with restricted access)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM public.admin_users 
        WHERE user_id = (SELECT auth.uid())
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_workspace_id IS NULL THEN
        RETURN FALSE;
    END IF;
    RETURN (
        (SELECT public.is_admin()) 
        OR EXISTS (
            SELECT 1 
            FROM public.workspace_memberships 
            WHERE workspace_id = p_workspace_id 
              AND user_id = (SELECT auth.uid())
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_workspace_id IS NULL THEN
        RETURN FALSE;
    END IF;
    RETURN (
        (SELECT public.is_admin()) 
        OR EXISTS (
            SELECT 1 
            FROM public.workspace_memberships 
            WHERE workspace_id = p_workspace_id 
              AND user_id = (SELECT auth.uid()) 
              AND role = 'owner'
        )
    );
END;
$$;

-- Security Hardening: Revoke execute from public and anon on security definer functions
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_workspace_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_workspace_owner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(UUID) TO authenticated, service_role;

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies: Workspaces
CREATE POLICY "Users can read member workspaces"
    ON public.workspaces
    FOR SELECT
    TO authenticated
    USING (public.is_workspace_member(id));

CREATE POLICY "Users can create workspaces"
    ON public.workspaces
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Owners or Admins can update workspaces"
    ON public.workspaces
    FOR UPDATE
    TO authenticated
    USING (public.is_workspace_owner(id))
    WITH CHECK (public.is_workspace_owner(id));

CREATE POLICY "Owners or Admins can delete workspaces"
    ON public.workspaces
    FOR DELETE
    TO authenticated
    USING (public.is_workspace_owner(id));

CREATE POLICY "Allow service_role full access on workspaces"
    ON public.workspaces
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 8. RLS Policies: Workspace Memberships
CREATE POLICY "Users can read own workspace memberships"
    ON public.workspace_memberships
    FOR SELECT
    TO authenticated
    USING ((user_id = (SELECT auth.uid())) OR public.is_workspace_member(workspace_id));

CREATE POLICY "Owners or Admins can insert workspace memberships"
    ON public.workspace_memberships
    FOR INSERT
    TO authenticated
    WITH CHECK ((user_id = (SELECT auth.uid())) OR public.is_workspace_owner(workspace_id));

CREATE POLICY "Owners or Admins can update workspace memberships"
    ON public.workspace_memberships
    FOR UPDATE
    TO authenticated
    USING (public.is_workspace_owner(workspace_id))
    WITH CHECK (public.is_workspace_owner(workspace_id));

CREATE POLICY "Owners or Admins or self can delete workspace memberships"
    ON public.workspace_memberships
    FOR DELETE
    TO authenticated
    USING ((user_id = (SELECT auth.uid())) OR public.is_workspace_owner(workspace_id));

CREATE POLICY "Allow service_role full access on workspace_memberships"
    ON public.workspace_memberships
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 9. RLS Policies: Admin Users
CREATE POLICY "Allow user to check own admin status"
    ON public.admin_users
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Allow service_role full access on admin_users"
    ON public.admin_users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
