-- Finance registers for Corro Construction Development and Trade Corporation.
-- Apply by hand in the Supabase SQL editor for project kfflyzprxcidmsdjhuej.
-- Additive only: new finance_ tables, functions, indexes, and a private storage bucket.
-- This file does not alter HR documents or Motorpool documents.
--
-- Each voucher, cash advance, bill, receipt, and payment is its own row.
-- Numbers are assigned inside finance_take_number(), which locks one counter
-- row, then the insert commits in the same transaction. A year or month is
-- never stored as one document.

create extension if not exists pgcrypto;

create or replace function public.finance_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.finance_counters (
  series text not null,
  year integer not null,
  last_no integer not null default 0,
  primary key (series, year),
  constraint finance_counters_series_chk check (series in ('DV', 'CA', 'AP'))
);

create table if not exists public.finance_projects (
  id text primary key,
  name text not null,
  name_key text not null unique,
  site text not null default '',
  code text not null default '',
  source text not null default 'finance',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_accounts (
  id text primary key,
  code text not null unique,
  name text not null,
  kind text not null default 'expense',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_suppliers (
  id text primary key,
  name text not null,
  name_key text not null unique,
  tin text not null default '',
  address text not null default '',
  terms_days integer,
  motorpool_key text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_signatories (
  id text primary key,
  slot text not null unique,
  person_name text not null,
  title text not null default '',
  image_data text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_signatories_slot_chk check (slot in ('prepared', 'checked', 'approved'))
);

create table if not exists public.finance_vouchers (
  id text primary key,
  dv_no text not null unique,
  year integer not null,
  seq integer not null,
  status text not null default 'Draft',
  payee text not null,
  project_id text,
  project_name text not null default '',
  particulars text not null default '',
  account_code text not null default '',
  account_name text not null default '',
  amount numeric(14,2) not null default 0,
  vat_mode text not null default 'inclusive',
  vat_rate numeric(8,4) not null default 0.12,
  vat_amount numeric(14,2) not null default 0,
  ewt_rate numeric(8,4) not null default 0,
  ewt_amount numeric(14,2) not null default 0,
  vatable_base numeric(14,2) not null default 0,
  gross_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  source_kind text not null default 'manual',
  source_id text,
  check_bank text not null default '',
  check_no text not null default '',
  check_date text not null default '',
  release_method text not null default '',
  receiver_name text not null default '',
  receiver_signature text not null default '',
  receiver_signed_at timestamptz,
  prepared_by text not null default '',
  prepared_at timestamptz,
  checked_by text not null default '',
  checked_at timestamptz,
  approved_by text not null default '',
  approved_at timestamptz,
  released_at timestamptz,
  released_on text not null default '',
  cleared_at timestamptz,
  cancelled_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  events jsonb not null default '[]'::jsonb,
  constraint finance_vouchers_year_seq_key unique (year, seq),
  constraint finance_vouchers_status_chk check (status in (
    'Draft', 'For Review', 'For Approval', 'Approved', 'Released', 'Cleared', 'Cancelled'
  )),
  constraint finance_vouchers_amount_chk check (amount >= 0 and net_amount >= 0)
);

create index if not exists finance_vouchers_status_idx on public.finance_vouchers (status);
create index if not exists finance_vouchers_source_idx on public.finance_vouchers (source_kind, source_id);

create table if not exists public.finance_cash_advances (
  id text primary key,
  ca_no text not null unique,
  year integer not null,
  seq integer not null,
  status text not null default 'Draft',
  employee_name text not null,
  employee_id text not null default '',
  department text not null,
  purpose text not null,
  project_id text,
  project_name text not null default '',
  amount numeric(14,2) not null,
  date_needed text not null,
  voucher_id text,
  hr_source_id text,
  motorpool_source_id text,
  source_number text not null default '',
  liquidated_amount numeric(14,2) not null default 0,
  refund_amount numeric(14,2) not null default 0,
  reimbursement_amount numeric(14,2) not null default 0,
  refund_received boolean not null default false,
  reimbursement_paid boolean not null default false,
  reimbursement_voucher_id text,
  prepared_by text not null default '',
  prepared_at timestamptz,
  checked_by text not null default '',
  checked_at timestamptz,
  approved_by text not null default '',
  approved_at timestamptz,
  released_at timestamptz,
  released_on text not null default '',
  liquidated_at timestamptz,
  liquidated_on text not null default '',
  cancelled_at timestamptz,
  refund_received_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  events jsonb not null default '[]'::jsonb,
  constraint finance_cash_advances_year_seq_key unique (year, seq),
  constraint finance_cash_advances_status_chk check (status in (
    'Draft', 'For Review', 'For Approval', 'Approved', 'Released', 'Liquidated', 'Cancelled'
  )),
  constraint finance_cash_advances_amount_chk check (amount > 0)
);

create index if not exists finance_cash_advances_status_idx on public.finance_cash_advances (status);
create index if not exists finance_cash_advances_employee_idx on public.finance_cash_advances (employee_name);

create table if not exists public.finance_liquidation_receipts (
  id text primary key,
  advance_id text not null references public.finance_cash_advances (id),
  receipt_date text not null default '',
  particulars text not null default '',
  amount numeric(14,2) not null default 0,
  attachment_id text,
  created_by text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_liquidation_receipts_amount_chk check (amount >= 0)
);

create index if not exists finance_liquidation_receipts_advance_idx
  on public.finance_liquidation_receipts (advance_id);

create table if not exists public.finance_bills (
  id text primary key,
  ap_no text not null unique,
  year integer not null,
  seq integer not null,
  status text not null default 'Open',
  supplier_id text,
  supplier_name text not null,
  invoice_no text not null,
  invoice_date text not null,
  terms_days integer not null default 0,
  due_date text not null,
  project_id text,
  project_name text not null default '',
  particulars text not null default '',
  amount numeric(14,2) not null default 0,
  vat_mode text not null default 'inclusive',
  vat_rate numeric(8,4) not null default 0.12,
  vat_amount numeric(14,2) not null default 0,
  ewt_rate numeric(8,4) not null default 0,
  ewt_amount numeric(14,2) not null default 0,
  vatable_base numeric(14,2) not null default 0,
  gross_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  created_by text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  events jsonb not null default '[]'::jsonb,
  constraint finance_bills_year_seq_key unique (year, seq),
  constraint finance_bills_status_chk check (status in ('Open', 'Partial', 'Paid', 'Cancelled')),
  constraint finance_bills_amount_chk check (amount >= 0 and net_amount >= 0)
);

create unique index if not exists finance_bills_supplier_invoice_key
  on public.finance_bills (supplier_id, invoice_no)
  where status <> 'Cancelled';

create index if not exists finance_bills_due_idx on public.finance_bills (due_date);

create table if not exists public.finance_bill_payments (
  id text primary key,
  bill_id text not null references public.finance_bills (id),
  voucher_id text not null unique references public.finance_vouchers (id),
  amount numeric(14,2) not null,
  paid_on text not null default '',
  created_by text not null default '',
  voided boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_bill_payments_amount_chk check (amount > 0)
);

create index if not exists finance_bill_payments_bill_idx on public.finance_bill_payments (bill_id);

create table if not exists public.finance_attachments (
  id text primary key,
  owner_kind text not null,
  owner_id text not null,
  filename text not null,
  storage_path text not null unique,
  content_type text not null default '',
  byte_size integer not null default 0,
  uploaded_by text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_attachments_owner_chk check (owner_kind in ('voucher', 'advance', 'bill', 'receipt'))
);

create index if not exists finance_attachments_owner_idx on public.finance_attachments (owner_kind, owner_id);

create table if not exists public.finance_builds (
  id text primary key,
  build text not null,
  seq bigint not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Phase 2 registers. Screens stay closed until those workflows are turned on.
create table if not exists public.finance_contracts (
  id text primary key,
  project_id text,
  project_name text not null default '',
  client_name text not null default '',
  contract_no text not null default '',
  contract_amount numeric(14,2) not null default 0,
  retention_rate numeric(8,4) not null default 0.10,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_billings (
  id text primary key,
  contract_id text references public.finance_contracts (id),
  billing_no text not null default '',
  billing_date text not null default '',
  percent numeric(8,4) not null default 0,
  gross_amount numeric(14,2) not null default 0,
  retention_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  status text not null default 'draft',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_collections (
  id text primary key,
  billing_id text references public.finance_billings (id),
  contract_id text references public.finance_contracts (id),
  collected_on text not null default '',
  amount numeric(14,2) not null default 0,
  reference text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_petty_funds (
  id text primary key,
  name text not null,
  custodian text not null default '',
  project_name text not null default '',
  fund_amount numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_petty_txns (
  id text primary key,
  fund_id text references public.finance_petty_funds (id),
  kind text not null,
  amount numeric(14,2) not null default 0,
  particulars text not null default '',
  txn_date text not null default '',
  voucher_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_petty_txns_kind_chk check (kind in ('spend', 'replenish', 'return'))
);

create table if not exists public.finance_bank_accounts (
  id text primary key,
  bank_name text not null,
  account_name text not null default '',
  account_no text not null default '',
  currency text not null default 'PHP',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_bank_lines (
  id text primary key,
  account_id text references public.finance_bank_accounts (id),
  stmt_date text not null default '',
  description text not null default '',
  amount numeric(14,2) not null default 0,
  external_id text not null default '',
  matched_kind text not null default '',
  matched_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists finance_bank_lines_external_key
  on public.finance_bank_lines (account_id, external_id)
  where external_id <> '';

do $trg$
declare
  tbl text;
begin
  foreach tbl in array array[
    'finance_projects', 'finance_accounts', 'finance_suppliers', 'finance_signatories',
    'finance_vouchers', 'finance_cash_advances', 'finance_liquidation_receipts',
    'finance_bills', 'finance_bill_payments', 'finance_attachments', 'finance_builds',
    'finance_contracts', 'finance_billings', 'finance_collections',
    'finance_petty_funds', 'finance_petty_txns', 'finance_bank_accounts', 'finance_bank_lines'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', tbl || '_touch', tbl);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.finance_touch_updated_at()',
      tbl || '_touch',
      tbl
    );
  end loop;
end
$trg$;

create or replace function public.finance_take_number(p_series text, p_year integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  label text;
begin
  if p_series not in ('DV', 'CA', 'AP') then
    raise exception 'unknown series';
  end if;
  if p_year < 2000 or p_year > 2100 then
    raise exception 'bad year';
  end if;

  insert into public.finance_counters (series, year, last_no)
  values (p_series, p_year, 0)
  on conflict (series, year) do nothing;

  update public.finance_counters
     set last_no = last_no + 1
   where series = p_series and year = p_year
  returning last_no into n;

  label := p_series || p_year::text || '-' || lpad(n::text, 4, '0');
  return jsonb_build_object('series', p_series, 'year', p_year, 'seq', n, 'number', label);
end;
$$;

create or replace function public.finance_create_voucher(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer;
  taken jsonb;
  rec public.finance_vouchers;
begin
  y := coalesce(nullif(p->>'year', '')::integer, extract(year from timezone('Asia/Manila', now()))::integer);
  taken := public.finance_take_number('DV', y);
  insert into public.finance_vouchers (
    id, dv_no, year, seq, status, payee, project_id, project_name, particulars,
    account_code, account_name, amount, vat_mode, vat_rate, vat_amount, ewt_rate,
    ewt_amount, vatable_base, gross_amount, net_amount, source_kind, source_id,
    created_by, events
  ) values (
    coalesce(nullif(p->>'id', ''), gen_random_uuid()::text),
    taken->>'number',
    (taken->>'year')::integer,
    (taken->>'seq')::integer,
    'Draft',
    coalesce(p->>'payee', ''),
    nullif(p->>'project_id', ''),
    coalesce(p->>'project_name', ''),
    coalesce(p->>'particulars', ''),
    coalesce(p->>'account_code', ''),
    coalesce(p->>'account_name', ''),
    coalesce(nullif(p->>'amount', '')::numeric, 0),
    coalesce(nullif(p->>'vat_mode', ''), 'inclusive'),
    coalesce(nullif(p->>'vat_rate', '')::numeric, 0),
    coalesce(nullif(p->>'vat_amount', '')::numeric, 0),
    coalesce(nullif(p->>'ewt_rate', '')::numeric, 0),
    coalesce(nullif(p->>'ewt_amount', '')::numeric, 0),
    coalesce(nullif(p->>'vatable_base', '')::numeric, 0),
    coalesce(nullif(p->>'gross_amount', '')::numeric, 0),
    coalesce(nullif(p->>'net_amount', '')::numeric, 0),
    coalesce(nullif(p->>'source_kind', ''), 'manual'),
    nullif(p->>'source_id', ''),
    coalesce(p->>'created_by', ''),
    coalesce(p->'events', '[]'::jsonb)
  ) returning * into rec;
  return to_jsonb(rec);
end;
$$;

create or replace function public.finance_create_advance(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer;
  taken jsonb;
  rec public.finance_cash_advances;
begin
  y := coalesce(nullif(p->>'year', '')::integer, extract(year from timezone('Asia/Manila', now()))::integer);
  taken := public.finance_take_number('CA', y);
  insert into public.finance_cash_advances (
    id, ca_no, year, seq, status, employee_name, employee_id, department, purpose,
    project_id, project_name, amount, date_needed, hr_source_id, motorpool_source_id,
    source_number, created_by, events
  ) values (
    coalesce(nullif(p->>'id', ''), gen_random_uuid()::text),
    taken->>'number',
    (taken->>'year')::integer,
    (taken->>'seq')::integer,
    'Draft',
    coalesce(p->>'employee_name', ''),
    coalesce(p->>'employee_id', ''),
    coalesce(p->>'department', ''),
    coalesce(p->>'purpose', ''),
    nullif(p->>'project_id', ''),
    coalesce(p->>'project_name', ''),
    coalesce(nullif(p->>'amount', '')::numeric, 0),
    coalesce(p->>'date_needed', ''),
    nullif(p->>'hr_source_id', ''),
    nullif(p->>'motorpool_source_id', ''),
    coalesce(p->>'source_number', ''),
    coalesce(p->>'created_by', ''),
    coalesce(p->'events', '[]'::jsonb)
  ) returning * into rec;
  return to_jsonb(rec);
end;
$$;

create or replace function public.finance_create_bill(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer;
  taken jsonb;
  rec public.finance_bills;
begin
  y := coalesce(nullif(p->>'year', '')::integer, extract(year from timezone('Asia/Manila', now()))::integer);
  taken := public.finance_take_number('AP', y);
  insert into public.finance_bills (
    id, ap_no, year, seq, status, supplier_id, supplier_name, invoice_no, invoice_date,
    terms_days, due_date, project_id, project_name, particulars, amount, vat_mode,
    vat_rate, vat_amount, ewt_rate, ewt_amount, vatable_base, gross_amount, net_amount,
    created_by, events
  ) values (
    coalesce(nullif(p->>'id', ''), gen_random_uuid()::text),
    taken->>'number',
    (taken->>'year')::integer,
    (taken->>'seq')::integer,
    'Open',
    nullif(p->>'supplier_id', ''),
    coalesce(p->>'supplier_name', ''),
    coalesce(p->>'invoice_no', ''),
    coalesce(p->>'invoice_date', ''),
    coalesce(nullif(p->>'terms_days', '')::integer, 0),
    coalesce(p->>'due_date', ''),
    nullif(p->>'project_id', ''),
    coalesce(p->>'project_name', ''),
    coalesce(p->>'particulars', ''),
    coalesce(nullif(p->>'amount', '')::numeric, 0),
    coalesce(nullif(p->>'vat_mode', ''), 'inclusive'),
    coalesce(nullif(p->>'vat_rate', '')::numeric, 0),
    coalesce(nullif(p->>'vat_amount', '')::numeric, 0),
    coalesce(nullif(p->>'ewt_rate', '')::numeric, 0),
    coalesce(nullif(p->>'ewt_amount', '')::numeric, 0),
    coalesce(nullif(p->>'vatable_base', '')::numeric, 0),
    coalesce(nullif(p->>'gross_amount', '')::numeric, 0),
    coalesce(nullif(p->>'net_amount', '')::numeric, 0),
    coalesce(p->>'created_by', ''),
    coalesce(p->'events', '[]'::jsonb)
  ) returning * into rec;
  return to_jsonb(rec);
end;
$$;

create or replace function public.finance_register_build(p_id text, p_build text, p_seq bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.finance_builds (id, build, seq)
  values (p_id, p_build, p_seq)
  on conflict (id) do nothing;
end;
$$;

insert into public.finance_accounts (id, code, name, kind)
values
  ('acct-5100', '5100', 'Materials', 'expense'),
  ('acct-5200', '5200', 'Labor', 'expense'),
  ('acct-5300', '5300', 'Equipment rental', 'expense'),
  ('acct-5400', '5400', 'Fuel and toll', 'expense'),
  ('acct-5500', '5500', 'Subcontract', 'expense'),
  ('acct-5600', '5600', 'Permits and fees', 'expense'),
  ('acct-5700', '5700', 'Utilities', 'expense'),
  ('acct-5800', '5800', 'Office and admin', 'expense'),
  ('acct-5900', '5900', 'Cash advance', 'asset'),
  ('acct-1100', '1100', 'Petty cash', 'asset'),
  ('acct-2000', '2000', 'Accounts payable', 'liability')
on conflict (code) do nothing;

insert into public.finance_signatories (id, slot, person_name, title)
values
  ('prepared', 'prepared', 'Finance Officer', 'Prepared by'),
  ('checked', 'checked', 'Evaluator', 'Checked by'),
  ('approved', 'approved', 'Jeffrey Corro', 'Approved by')
on conflict (id) do nothing;

do $rls$
declare
  tbl text;
begin
  foreach tbl in array array[
    'finance_counters', 'finance_projects', 'finance_accounts', 'finance_suppliers',
    'finance_signatories', 'finance_vouchers', 'finance_cash_advances',
    'finance_liquidation_receipts', 'finance_bills', 'finance_bill_payments',
    'finance_attachments', 'finance_builds', 'finance_contracts', 'finance_billings',
    'finance_collections', 'finance_petty_funds', 'finance_petty_txns',
    'finance_bank_accounts', 'finance_bank_lines'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from public, anon, authenticated', tbl);
    execute format('grant all on table public.%I to service_role', tbl);
  end loop;
end
$rls$;

revoke all on function public.finance_take_number(text, integer) from public, anon, authenticated;
revoke all on function public.finance_create_voucher(jsonb) from public, anon, authenticated;
revoke all on function public.finance_create_advance(jsonb) from public, anon, authenticated;
revoke all on function public.finance_create_bill(jsonb) from public, anon, authenticated;
revoke all on function public.finance_register_build(text, text, bigint) from public, anon, authenticated;
grant execute on function public.finance_take_number(text, integer) to service_role;
grant execute on function public.finance_create_voucher(jsonb) to service_role;
grant execute on function public.finance_create_advance(jsonb) to service_role;
grant execute on function public.finance_create_bill(jsonb) to service_role;
grant execute on function public.finance_register_build(text, text, bigint) to service_role;

insert into storage.buckets (id, name, public)
values ('finance-uploads', 'finance-uploads', false)
on conflict (id) do update set public = false;
