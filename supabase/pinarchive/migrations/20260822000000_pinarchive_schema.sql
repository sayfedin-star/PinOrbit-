create table if not exists public.pa_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  username text not null,
  sheet_id text,
  interval_days int not null default 3 check (interval_days between 1 and 30),
  next_run_at timestamptz,
  status text not null default 'active' check (status in ('active','paused','cookie_expired','error')),
  backfill_status text not null default 'pending' check (backfill_status in ('pending','in_progress','done')),
  backfill_cursor text,
  last_run_at timestamptz, last_result text,
  pins_count int not null default 0, promoted_count int not null default 0,
  created_at timestamptz not null default now(),
  constraint ux_pa_accounts_ws_username unique (workspace_id, username));

create table if not exists public.pa_pins (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid not null references public.pa_accounts(id) on delete cascade,
  pin_id text not null, node_id text, title text, description text,
  link text, utm_link text, domain text, board_id text, board_name text,
  created_at_pinterest timestamptz, image_url text, image_signature text,
  dominant_color text, is_video boolean not null default false,
  is_product boolean not null default false, price numeric, currency text,
  site_name text, saves bigint not null default 0, repins bigint not null default 0,
  comments int not null default 0, reactions jsonb not null default '{}'::jsonb,
  velocity numeric not null default 0, promoted boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  constraint ux_pa_pins_ws_pin unique (workspace_id, pin_id));

create table if not exists public.pa_pin_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  pin_ref uuid not null references public.pa_pins(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  saves bigint not null default 0, repins bigint not null default 0,
  comments int not null default 0,
  constraint ux_pa_metrics_ref_recorded unique (pin_ref, recorded_at));

create table if not exists public.pa_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid references public.pa_accounts(id) on delete cascade,
  trigger text not null default 'cron' check (trigger in ('cron','manual','backfill')),
  started_at timestamptz not null default now(), finished_at timestamptz,
  pages_fetched int not null default 0, pins_added int not null default 0,
  pins_updated int not null default 0, pins_promoted int not null default 0,
  status text not null default 'running' check (status in ('running','completed','failed')),
  message text);

create index if not exists idx_pa_pins_ws_saves on public.pa_pins (workspace_id, saves desc);
create index if not exists idx_pa_pins_ws_velocity on public.pa_pins (workspace_id, velocity desc);
create index if not exists idx_pa_pins_account on public.pa_pins (account_id);
create index if not exists idx_pa_metrics_ref on public.pa_pin_metrics (pin_ref, recorded_at desc);
create index if not exists idx_pa_accounts_next on public.pa_accounts (workspace_id, next_run_at);
create index if not exists idx_pa_runs_ws on public.pa_runs (workspace_id, started_at desc);

alter table public.pa_accounts enable row level security;
alter table public.pa_pins enable row level security;
alter table public.pa_pin_metrics enable row level security;
alter table public.pa_runs enable row level security;
create policy pa_accounts_sr on public.pa_accounts for all to service_role using (true) with check (true);
create policy pa_pins_sr on public.pa_pins for all to service_role using (true) with check (true);
create policy pa_metrics_sr on public.pa_pin_metrics for all to service_role using (true) with check (true);
create policy pa_runs_sr on public.pa_runs for all to service_role using (true) with check (true);
