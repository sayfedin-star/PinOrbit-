CREATE OR REPLACE FUNCTION public.is_workspace_admin(p_workspace_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_workspace_id IS NULL THEN RETURN FALSE; END IF;
  RETURN ((SELECT public.is_admin()) OR EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND user_id = (SELECT auth.uid()) AND role IN ('owner','admin')));
END; $$;
REVOKE EXECUTE ON FUNCTION public.is_workspace_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "Owners or Admins can insert workspace memberships" ON public.workspace_memberships;
CREATE POLICY "Owners or Admins can insert workspace memberships"
  ON public.workspace_memberships FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_owner(workspace_id)
    OR (user_id = (SELECT auth.uid())
        AND NOT EXISTS (SELECT 1 FROM public.workspace_memberships wm
                        WHERE wm.workspace_id = workspace_memberships.workspace_id)));

DROP POLICY IF EXISTS "Workspace access on accounts" ON public.accounts;
CREATE POLICY "Workspace members read accounts" ON public.accounts FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Workspace admins insert accounts" ON public.accounts FOR INSERT TO authenticated WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY "Workspace admins update accounts" ON public.accounts FOR UPDATE TO authenticated USING (public.is_workspace_admin(workspace_id)) WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY "Workspace admins delete accounts" ON public.accounts FOR DELETE TO authenticated USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Workspace members can access account webhooks" ON public.account_webhooks;
CREATE POLICY "Workspace members read account webhooks" ON public.account_webhooks FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_webhooks.account_id AND public.is_workspace_member(a.workspace_id)));
CREATE POLICY "Workspace admins insert account webhooks" ON public.account_webhooks FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_webhooks.account_id AND public.is_workspace_admin(a.workspace_id)));
CREATE POLICY "Workspace admins update account webhooks" ON public.account_webhooks FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_webhooks.account_id AND public.is_workspace_admin(a.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_webhooks.account_id AND public.is_workspace_admin(a.workspace_id)));
CREATE POLICY "Workspace admins delete account webhooks" ON public.account_webhooks FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_webhooks.account_id AND public.is_workspace_admin(a.workspace_id)));

DROP POLICY IF EXISTS "Workspace members can access account posting windows" ON public.account_posting_windows;
CREATE POLICY "Workspace members read account posting windows" ON public.account_posting_windows FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_posting_windows.account_id AND public.is_workspace_member(a.workspace_id)));
CREATE POLICY "Workspace admins insert account posting windows" ON public.account_posting_windows FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_posting_windows.account_id AND public.is_workspace_admin(a.workspace_id)));
CREATE POLICY "Workspace admins update account posting windows" ON public.account_posting_windows FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_posting_windows.account_id AND public.is_workspace_admin(a.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_posting_windows.account_id AND public.is_workspace_admin(a.workspace_id)));
CREATE POLICY "Workspace admins delete account posting windows" ON public.account_posting_windows FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = account_posting_windows.account_id AND public.is_workspace_admin(a.workspace_id)));

DROP POLICY IF EXISTS "Workspace access on boards" ON public.boards;
CREATE POLICY "Workspace members read boards" ON public.boards FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Workspace admins insert boards" ON public.boards FOR INSERT TO authenticated WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY "Workspace admins update boards" ON public.boards FOR UPDATE TO authenticated USING (public.is_workspace_admin(workspace_id)) WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY "Workspace admins delete boards" ON public.boards FOR DELETE TO authenticated USING (public.is_workspace_admin(workspace_id));
