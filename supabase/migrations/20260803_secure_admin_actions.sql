-- Migration: 20260803_secure_admin_actions.sql
-- PinOrbit Secure Interactive Admin Actions & Authorization Migration

-- 1. Create admin_users authorization layer table
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on admin_users
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to check their own admin status
DROP POLICY IF EXISTS "Allow user to check own admin status" ON public.admin_users;
CREATE POLICY "Allow user to check own admin status"
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Helper function to check if current authenticated user is an authorized admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = auth.uid()
  );
END;
$$;

-- Revoke execute from unauthenticated/public roles and grant strictly to authenticated
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 2. Ensure RLS is enabled on all application tables
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- 3. Remove all legacy temporary policies that allowed anonymous reads
DROP POLICY IF EXISTS "Allow anon select on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow anon read accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow anon select on boards" ON public.boards;
DROP POLICY IF EXISTS "Allow anon select on pins" ON public.pins;
DROP POLICY IF EXISTS "Allow anon select on logs" ON public.logs;

-- Clean up existing admin policies for clean idempotent execution
DROP POLICY IF EXISTS "Allow admin select on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow admin insert on accounts" ON public.accounts;
DROP POLICY IF EXISTS "Allow admin update on accounts" ON public.accounts;

DROP POLICY IF EXISTS "Allow admin select on boards" ON public.boards;
DROP POLICY IF EXISTS "Allow admin insert on boards" ON public.boards;
DROP POLICY IF EXISTS "Allow admin update on boards" ON public.boards;

DROP POLICY IF EXISTS "Allow admin select on pins" ON public.pins;
DROP POLICY IF EXISTS "Allow admin select on logs" ON public.logs;

-- 4. Create secure RLS policies tied to public.is_admin()

-- ACCOUNTS: Select, Insert, Update (No Delete)
CREATE POLICY "Allow admin select on accounts"
  ON public.accounts
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Allow admin insert on accounts"
  ON public.accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Allow admin update on accounts"
  ON public.accounts
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- BOARDS: Select, Insert, Update (No Delete)
CREATE POLICY "Allow admin select on boards"
  ON public.boards
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Allow admin insert on boards"
  ON public.boards
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Allow admin update on boards"
  ON public.boards
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- PINS: Read-Only (Select)
CREATE POLICY "Allow admin select on pins"
  ON public.pins
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- LOGS: Read-Only (Select)
CREATE POLICY "Allow admin select on logs"
  ON public.logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 5. Ensure service_role retains full access for backend and Edge Functions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Allow service_role full access on accounts'
  ) THEN
    CREATE POLICY "Allow service_role full access on accounts"
      ON public.accounts
      FOR ALL
      TO service_role
      USING (true)
      with CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Allow service_role full access on boards'
  ) THEN
    CREATE POLICY "Allow service_role full access on boards"
      ON public.boards
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Allow service_role full access on pins'
  ) THEN
    CREATE POLICY "Allow service_role full access on pins"
      ON public.pins
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Allow service_role full access on logs'
  ) THEN
    CREATE POLICY "Allow service_role full access on logs"
      ON public.logs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
