-- Admin import jobs for the Google Sheet cutover. Additive.
-- Run after 20261010000003_finance_bill_dashboard.sql.
-- Does not remove existing tables and does not change HR or Motorpool data.

create table if not exists public.finance_import_jobs (
  id text primary key,
  status text not null default 'staging',
  created_by text not null default '',
  files jsonb not null default '{}'::jsonb,
  phase text not null default 'upload',
  cursor integer not null default 0,
  total integer not null default 0,
  plan_path text not null default '',
  sheet_year integer not null default 2026,
  report jsonb not null default '{}'::jsonb,
  error text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_import_jobs_status_chk check (status in ('staging', 'ready', 'running', 'done', 'failed'))
);

drop trigger if exists finance_import_jobs_touch on public.finance_import_jobs;
create trigger finance_import_jobs_touch
  before update on public.finance_import_jobs
  for each row execute function public.finance_touch_updated_at();

alter table public.finance_import_jobs enable row level security;
revoke all on table public.finance_import_jobs from public, anon, authenticated;
grant all on table public.finance_import_jobs to service_role;
