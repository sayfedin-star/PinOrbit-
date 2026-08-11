-- 1) Grants so PostgREST exposes the tables to the authenticated role
grant select, insert, update, delete on public.competitors                to authenticated;
grant select, insert, update, delete on public.competitor_boards          to authenticated;
grant select, insert                 on public.competitor_snapshots       to authenticated;
grant select                         on public.competitor_daily_snapshots to authenticated;
grant select, insert, update         on public.competitor_ingestion_jobs  to authenticated;

-- 2) Tenant-scoped RLS policies (member of the workspace via workspace_memberships)
drop policy if exists "members_select_competitors" on public.competitors;
drop policy if exists "members_insert_competitors" on public.competitors;
drop policy if exists "members_update_competitors" on public.competitors;
drop policy if exists "members_delete_competitors" on public.competitors;
create policy "members_select_competitors" on public.competitors for select to authenticated using (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitors.workspace_id and wm.user_id = auth.uid()));
create policy "members_insert_competitors" on public.competitors for insert to authenticated with check (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitors.workspace_id and wm.user_id = auth.uid()));
create policy "members_update_competitors" on public.competitors for update to authenticated using (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitors.workspace_id and wm.user_id = auth.uid()));
create policy "members_delete_competitors" on public.competitors for delete to authenticated using (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitors.workspace_id and wm.user_id = auth.uid()));

drop policy if exists "members_select_boards" on public.competitor_boards;
drop policy if exists "members_insert_boards" on public.competitor_boards;
drop policy if exists "members_update_boards" on public.competitor_boards;
drop policy if exists "members_delete_boards" on public.competitor_boards;
create policy "members_select_boards" on public.competitor_boards for select to authenticated using (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitor_boards.workspace_id and wm.user_id = auth.uid()));
create policy "members_insert_boards" on public.competitor_boards for insert to authenticated with check (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitor_boards.workspace_id and wm.user_id = auth.uid()));
create policy "members_update_boards" on public.competitor_boards for update to authenticated using (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitor_boards.workspace_id and wm.user_id = auth.uid()));
create policy "members_delete_boards" on public.competitor_boards for delete to authenticated using (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitor_boards.workspace_id and wm.user_id = auth.uid()));

drop policy if exists "members_select_snapshots" on public.competitor_snapshots;
drop policy if exists "members_insert_snapshots" on public.competitor_snapshots;
create policy "members_select_snapshots" on public.competitor_snapshots for select to authenticated using (exists (select 1 from public.competitors c join public.workspace_memberships wm on wm.workspace_id = c.workspace_id where c.id = public.competitor_snapshots.competitor_id and wm.user_id = auth.uid()));
create policy "members_insert_snapshots" on public.competitor_snapshots for insert to authenticated with check (exists (select 1 from public.competitors c join public.workspace_memberships wm on wm.workspace_id = c.workspace_id where c.id = public.competitor_snapshots.competitor_id and wm.user_id = auth.uid()));

drop policy if exists "members_select_daily" on public.competitor_daily_snapshots;
create policy "members_select_daily" on public.competitor_daily_snapshots for select to authenticated using (exists (select 1 from public.competitors c join public.workspace_memberships wm on wm.workspace_id = c.workspace_id where c.id = public.competitor_daily_snapshots.competitor_id and wm.user_id = auth.uid()));

drop policy if exists "members_select_jobs" on public.competitor_ingestion_jobs;
drop policy if exists "members_insert_jobs" on public.competitor_ingestion_jobs;
drop policy if exists "members_update_jobs" on public.competitor_ingestion_jobs;
create policy "members_select_jobs" on public.competitor_ingestion_jobs for select to authenticated using (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitor_ingestion_jobs.workspace_id and wm.user_id = auth.uid()));
create policy "members_insert_jobs" on public.competitor_ingestion_jobs for insert to authenticated with check (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitor_ingestion_jobs.workspace_id and wm.user_id = auth.uid()));
create policy "members_update_jobs" on public.competitor_ingestion_jobs for update to authenticated using (exists (select 1 from public.workspace_memberships wm where wm.workspace_id = public.competitor_ingestion_jobs.workspace_id and wm.user_id = auth.uid()));

-- 3) Force PostgREST to reload its schema cache immediately
select pg_notify('pgrst', 'reload schema');
