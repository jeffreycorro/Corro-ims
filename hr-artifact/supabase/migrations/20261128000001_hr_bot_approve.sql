-- CorConDev HR — bot approval secret and audit trail.
-- Run this in the Supabase SQL editor for the HR project
-- (kfflyzprxcidmsdjhuej, the same project as SUPABASE_URL on corcondev-hr).
-- Do not apply it from the app. This file is the migration; a deploy does
-- not run it.
--
-- The bearer secret itself is never stored. Insert only its SHA-256 hex
-- after you generate it locally. See docs/hr-bot-approve.md.
--
-- No anon or authenticated access. The Netlify function uses the service
-- role, which bypasses these policies. Existing payroll, leave, and
-- attendance rows are not changed.

create extension if not exists pgcrypto;

create table if not exists public.hr_bot_secrets (
  id text primary key,
  secret_sha256 text not null,
  label text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.hr_bot_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  approver text not null,
  via text not null,
  item_id text not null,
  kind text not null default '',
  action text not null default 'approve',
  dry_run boolean not null default false,
  ok boolean not null default false,
  new_status text not null default '',
  detail jsonb not null default '{}'::jsonb
);

create index if not exists hr_bot_audit_at_idx on public.hr_bot_audit (at desc);

alter table public.hr_bot_secrets enable row level security;
alter table public.hr_bot_audit enable row level security;

revoke all on table public.hr_bot_secrets from anon, authenticated;
revoke all on table public.hr_bot_audit from anon, authenticated;
