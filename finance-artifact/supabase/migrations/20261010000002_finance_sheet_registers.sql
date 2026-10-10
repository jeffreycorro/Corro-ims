-- Sheet registers that replace CCD-03 petty cash, CCD-04 checks, GCash monitoring,
-- and the Bill Paying Checklist. Additive. Run after 20261010000001_finance_schema.sql.
-- Does not drop the earlier petty-fund or bank-line stubs, and does not alter HR or Motorpool.

alter table public.finance_counters drop constraint if exists finance_counters_series_chk;
alter table public.finance_counters
  add constraint finance_counters_series_chk check (series in ('DV', 'CA', 'AP', 'PC', 'GC'));

alter table public.finance_projects add column if not exists client text not null default '';

alter table public.finance_suppliers add column if not exists branch text not null default '';
alter table public.finance_suppliers add column if not exists vat_status text not null default '';
alter table public.finance_suppliers drop constraint if exists finance_suppliers_name_key_key;
create unique index if not exists finance_suppliers_tin_branch_uidx
  on public.finance_suppliers (tin, branch)
  where tin <> '';
create unique index if not exists finance_suppliers_name_branch_uidx
  on public.finance_suppliers (name_key, branch)
  where tin = '';

alter table public.finance_bank_accounts add column if not exists nickname text not null default '';
alter table public.finance_bank_accounts add column if not exists account_type text not null default '';
alter table public.finance_bank_accounts add column if not exists bank_code text not null default '';

alter table public.finance_vouchers add column if not exists check_id text;
alter table public.finance_vouchers add column if not exists vrf_no text not null default '';
alter table public.finance_vouchers add column if not exists po_no text not null default '';

create table if not exists public.finance_employees (
  id text primary key,
  name text not null,
  name_key text not null unique,
  department text not null default '',
  hr_id text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_employee_aliases (
  id text primary key,
  alias text not null,
  alias_key text not null unique,
  employee_id text not null references public.finance_employees (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_project_aliases (
  id text primary key,
  alias text not null,
  alias_key text not null unique,
  project_id text not null references public.finance_projects (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_supplier_aliases (
  id text primary key,
  alias text not null,
  alias_key text not null unique,
  supplier_id text not null references public.finance_suppliers (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_funding_sources (
  id text primary key,
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_bank_secrets (
  id text primary key,
  account_id text not null default '',
  ciphertext text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_petty_cycles (
  id text primary key,
  year integer not null,
  cycle_no integer not null,
  label text not null,
  date_from text not null default '',
  date_to text not null default '',
  opening_balance numeric(14,2) not null default 0,
  closing_balance numeric(14,2),
  status text not null default 'open',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (year, cycle_no),
  constraint finance_petty_cycles_status_chk check (status in ('open', 'closed'))
);

create table if not exists public.finance_petty_cash_ins (
  id text primary key,
  cycle_id text not null references public.finance_petty_cycles (id),
  txn_date text not null default '',
  source_type text not null default '',
  reference_no text not null default '',
  check_id text,
  amount numeric(14,2) not null default 0,
  import_key text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create unique index if not exists finance_petty_cash_ins_import_key
  on public.finance_petty_cash_ins (import_key) where import_key <> '';

create table if not exists public.finance_petty_vouchers (
  id text primary key,
  pcv_no text not null unique,
  year integer not null,
  seq integer not null,
  cycle_id text not null references public.finance_petty_cycles (id),
  txn_date text not null default '',
  employee_id text,
  employee_name text not null default '',
  supplier_id text,
  supplier_name text not null default '',
  project_id text,
  project_name text not null default '',
  vrf_no text not null default '',
  po_no text not null default '',
  description text not null default '',
  amount numeric(14,2) not null default 0,
  qb_uploaded boolean not null default false,
  scanned boolean not null default false,
  remarks text not null default '',
  status text not null default 'posted',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_petty_vouchers_status_chk check (status in ('posted', 'void'))
);

create table if not exists public.finance_petty_receipts (
  id text primary key,
  voucher_id text not null references public.finance_petty_vouchers (id),
  si_no text not null default '',
  si_date text not null default '',
  classification text not null default '',
  invoice_amount numeric(14,2) not null default 0,
  tin_snapshot text not null default '',
  import_key text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create unique index if not exists finance_petty_receipts_import_key
  on public.finance_petty_receipts (import_key) where import_key <> '';

create table if not exists public.finance_petty_releases (
  id text primary key,
  cycle_id text not null references public.finance_petty_cycles (id),
  txn_date text not null default '',
  employee_id text,
  employee_name text not null default '',
  description text not null default '',
  project_id text,
  project_name text not null default '',
  vrf_no text not null default '',
  amount numeric(14,2) not null default 0,
  status_note text not null default '',
  status text not null default 'open',
  voucher_id text,
  import_key text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint finance_petty_releases_status_chk check (status in ('open', 'liquidated', 'returned'))
);
create unique index if not exists finance_petty_releases_import_key
  on public.finance_petty_releases (import_key) where import_key <> '';

create table if not exists public.finance_checks (
  id text primary key,
  bank_account_id text not null references public.finance_bank_accounts (id),
  bank_code text not null default '',
  booklet_year integer not null,
  serial text not null,
  check_no text not null unique,
  date_issued text not null default '',
  check_date text not null default '',
  payee text not null default '',
  payee_supplier_id text,
  amount numeric(14,2) not null default 0,
  po_ref text not null default '',
  status text not null default 'issued',
  release_date text not null default '',
  received_by text not null default '',
  cleared_date text not null default '',
  scanned boolean not null default false,
  document_location text not null default '',
  photo_url text not null default '',
  notes text not null default '',
  remarks text not null default '',
  is_transfer boolean not null default false,
  dv_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (bank_account_id, booklet_year, serial),
  constraint finance_checks_status_chk check (status in (
    'issued', 'for signature', 'ready for pickup', 'released', 'cleared', 'cancelled', 'void', 'stale'
  ))
);

create table if not exists public.finance_check_invoices (
  id text primary key,
  check_id text not null references public.finance_checks (id),
  si_no text not null default '',
  si_date text not null default '',
  amount numeric(14,2) not null default 0,
  po_no text not null default '',
  import_key text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create unique index if not exists finance_check_invoices_import_key
  on public.finance_check_invoices (import_key) where import_key <> '';

create table if not exists public.finance_wallets (
  id text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_wallet_batches (
  id text primary key,
  wallet_id text not null references public.finance_wallets (id),
  year integer not null,
  batch_no integer not null,
  opening_balance numeric(14,2) not null default 0,
  status text not null default 'open',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (wallet_id, year, batch_no)
);

create table if not exists public.finance_wallet_cash_ins (
  id text primary key,
  batch_id text not null references public.finance_wallet_batches (id),
  txn_date text not null default '',
  source_type text not null default '',
  reference_no text not null default '',
  amount numeric(14,2) not null default 0,
  import_key text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_wallet_expenses (
  id text primary key,
  ref_no text not null unique,
  year integer not null,
  seq integer not null,
  batch_id text not null references public.finance_wallet_batches (id),
  txn_date text not null default '',
  employee_id text,
  employee_name text not null default '',
  supplier_id text,
  supplier_name text not null default '',
  project_id text,
  project_name text not null default '',
  vrf_no text not null default '',
  description text not null default '',
  amount numeric(14,2) not null default 0,
  fee numeric(14,2) not null default 0,
  si_no text not null default '',
  si_date text not null default '',
  invoice_amount numeric(14,2) not null default 0,
  classification text not null default '',
  scanned boolean not null default false,
  remarks text not null default '',
  bill_instance_id text,
  status text not null default 'posted',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_wallet_receivables (
  id text primary key,
  batch_id text not null references public.finance_wallet_batches (id),
  person_name text not null default '',
  description text not null default '',
  amount numeric(14,2) not null default 0,
  status text not null default 'open',
  import_key text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_checklist_bills (
  id text primary key,
  category text not null default '',
  biller text not null default '',
  account_no text not null default '',
  account_name text not null default '',
  frequency text not null default 'monthly',
  payment_method text not null default 'check',
  active boolean not null default true,
  import_key text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_checklist_instances (
  id text primary key,
  bill_id text not null references public.finance_checklist_bills (id),
  month text not null,
  amount numeric(14,2) not null default 0,
  due_date text not null default '',
  paid_date text not null default '',
  status text not null default 'unpaid',
  payment_kind text not null default '',
  payment_id text,
  import_key text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (bill_id, month),
  constraint finance_checklist_instances_status_chk check (status in ('paid', 'unpaid', 'n-a'))
);

create table if not exists public.finance_rental_units (
  id text primary key,
  name text not null,
  site text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.finance_rental_receipts (
  id text primary key,
  unit_id text not null references public.finance_rental_units (id),
  month text not null,
  amount numeric(14,2) not null default 0,
  received_on text not null default '',
  reference text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (unit_id, month)
);

create table if not exists public.finance_property_taxes (
  id text primary key,
  site text not null,
  year integer not null,
  amount numeric(14,2) not null default 0,
  paid_date text not null default '',
  status text not null default 'unpaid',
  reference text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (site, year)
);

create table if not exists public.finance_import_issues (
  id text primary key,
  source text not null default '',
  sheet text not null default '',
  row_no integer not null default 0,
  field text not null default '',
  raw text not null default '',
  message text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.finance_reject_raw_account()
returns trigger
language plpgsql
as $$
begin
  if new.account_no ~ '\d{6,}' then
    raise exception 'raw account numbers are not stored';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_bank_accounts_mask on public.finance_bank_accounts;
create trigger finance_bank_accounts_mask
  before insert or update on public.finance_bank_accounts
  for each row execute function public.finance_reject_raw_account();

drop trigger if exists finance_checklist_bills_mask on public.finance_checklist_bills;
create trigger finance_checklist_bills_mask
  before insert or update on public.finance_checklist_bills
  for each row execute function public.finance_reject_raw_account();

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
  if p_series not in ('DV', 'CA', 'AP', 'PC', 'GC') then
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

  if p_series = 'GC' then
    label := p_year::text || 'Gcash-' || lpad(n::text, 4, '0');
  else
    label := p_series || p_year::text || '-' || lpad(n::text, 4, '0');
  end if;
  return jsonb_build_object('series', p_series, 'year', p_year, 'seq', n, 'number', label);
end;
$$;

create or replace function public.finance_reserve_number(p_series text, p_year integer, p_seq integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_series not in ('DV', 'CA', 'AP', 'PC', 'GC') then
    raise exception 'unknown series';
  end if;
  insert into public.finance_counters (series, year, last_no)
  values (p_series, p_year, 0)
  on conflict (series, year) do nothing;
  update public.finance_counters
     set last_no = greatest(last_no, p_seq)
   where series = p_series and year = p_year;
end;
$$;

create or replace function public.finance_create_pcv(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer;
  taken jsonb;
  rec public.finance_petty_vouchers;
begin
  y := coalesce(nullif(p->>'year', '')::integer, extract(year from timezone('Asia/Manila', now()))::integer);
  taken := public.finance_take_number('PC', y);
  insert into public.finance_petty_vouchers (
    id, pcv_no, year, seq, cycle_id, txn_date, employee_id, employee_name, supplier_id, supplier_name,
    project_id, project_name, vrf_no, po_no, description, amount, qb_uploaded, scanned, remarks, status
  ) values (
    coalesce(nullif(p->>'id', ''), gen_random_uuid()::text),
    taken->>'number',
    (taken->>'year')::integer,
    (taken->>'seq')::integer,
    p->>'cycle_id',
    coalesce(p->>'txn_date', ''),
    nullif(p->>'employee_id', ''),
    coalesce(p->>'employee_name', ''),
    nullif(p->>'supplier_id', ''),
    coalesce(p->>'supplier_name', ''),
    nullif(p->>'project_id', ''),
    coalesce(p->>'project_name', ''),
    coalesce(p->>'vrf_no', ''),
    coalesce(p->>'po_no', ''),
    coalesce(p->>'description', ''),
    coalesce(nullif(p->>'amount', '')::numeric, 0),
    coalesce((p->>'qb_uploaded')::boolean, false),
    coalesce((p->>'scanned')::boolean, false),
    coalesce(p->>'remarks', ''),
    coalesce(nullif(p->>'status', ''), 'posted')
  ) returning * into rec;
  return to_jsonb(rec);
end;
$$;

create or replace function public.finance_create_wallet_expense(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer;
  taken jsonb;
  rec public.finance_wallet_expenses;
begin
  y := coalesce(nullif(p->>'year', '')::integer, extract(year from timezone('Asia/Manila', now()))::integer);
  taken := public.finance_take_number('GC', y);
  insert into public.finance_wallet_expenses (
    id, ref_no, year, seq, batch_id, txn_date, employee_id, employee_name, supplier_id, supplier_name,
    project_id, project_name, vrf_no, description, amount, fee, si_no, si_date, invoice_amount,
    classification, scanned, remarks, bill_instance_id, status
  ) values (
    coalesce(nullif(p->>'id', ''), gen_random_uuid()::text),
    taken->>'number',
    (taken->>'year')::integer,
    (taken->>'seq')::integer,
    p->>'batch_id',
    coalesce(p->>'txn_date', ''),
    nullif(p->>'employee_id', ''),
    coalesce(p->>'employee_name', ''),
    nullif(p->>'supplier_id', ''),
    coalesce(p->>'supplier_name', ''),
    nullif(p->>'project_id', ''),
    coalesce(p->>'project_name', ''),
    coalesce(p->>'vrf_no', ''),
    coalesce(p->>'description', ''),
    coalesce(nullif(p->>'amount', '')::numeric, 0),
    coalesce(nullif(p->>'fee', '')::numeric, 0),
    coalesce(p->>'si_no', ''),
    coalesce(p->>'si_date', ''),
    coalesce(nullif(p->>'invoice_amount', '')::numeric, 0),
    coalesce(p->>'classification', ''),
    coalesce((p->>'scanned')::boolean, false),
    coalesce(p->>'remarks', ''),
    nullif(p->>'bill_instance_id', ''),
    coalesce(nullif(p->>'status', ''), 'posted')
  ) returning * into rec;
  return to_jsonb(rec);
end;
$$;

insert into public.finance_funding_sources (id, code, name)
values
  ('fund-j', 'J', 'Owner cash Jeffrey'),
  ('fund-m', 'M', 'Owner cash Marian'),
  ('fund-payroll', 'PAYROLL', 'Payroll excess'),
  ('fund-check', 'CHECK', 'Check'),
  ('fund-sales', 'SALES', 'Sales'),
  ('fund-refund', 'REFUND', 'Refund')
on conflict (id) do nothing;

insert into public.finance_bank_accounts (id, bank_name, nickname, account_type, bank_code, account_name, account_no)
values
  ('bank-aub', 'Asia United Bank', 'AUB', 'AUB', 'AUB', 'Corro Construction Development and Trade Corporation', ''),
  ('bank-bdo', 'BDO', 'BDO', 'BDO', 'BDO', 'Corro Construction Development and Trade Corporation', ''),
  ('bank-bpi-1842', 'BPI', 'BPI 1842', 'BPI 1842', 'BPI', 'Corro Construction Development and Trade Corporation', ''),
  ('bank-bpi-cl', 'BPI', 'BPI Credit Line', 'BPI Credit Line', 'BPI', 'Corro Construction Development and Trade Corporation', ''),
  ('bank-pbb', 'Philippine Business Bank', 'PBB', 'PBB', 'PBB', 'Corro Construction Development and Trade Corporation', ''),
  ('bank-rcbc', 'RCBC', 'RCBC', 'RCBC', 'RCBC', 'Corro Construction Development and Trade Corporation', ''),
  ('bank-dbp', 'DBP', 'DBP', 'DBP', 'DBP', 'Corro Construction Development and Trade Corporation', ''),
  ('bank-lbp', 'Land Bank', 'LBP', 'LBP', 'LBP', 'Corro Construction Development and Trade Corporation', '')
on conflict (id) do nothing;

insert into public.finance_wallets (id, name)
values ('wallet-gcash', 'GCash')
on conflict (id) do nothing;

insert into public.finance_projects (id, name, name_key, source)
values ('project-unassigned', 'Unassigned', 'unassigned', 'finance')
on conflict (id) do nothing;

insert into public.finance_employees (id, name, name_key)
values ('employee-unassigned', 'Unassigned', 'unassigned')
on conflict (id) do nothing;

insert into public.finance_suppliers (id, name, name_key)
values
  ('supplier-unassigned', 'Unassigned', 'unassigned'),
  ('supplier-cash', 'Cash', 'cash')
on conflict (id) do nothing;

do $trg$
declare
  tbl text;
begin
  foreach tbl in array array[
    'finance_employees', 'finance_employee_aliases', 'finance_project_aliases', 'finance_supplier_aliases',
    'finance_funding_sources', 'finance_bank_secrets', 'finance_petty_cycles', 'finance_petty_cash_ins',
    'finance_petty_vouchers', 'finance_petty_receipts', 'finance_petty_releases', 'finance_checks',
    'finance_check_invoices', 'finance_wallets', 'finance_wallet_batches', 'finance_wallet_cash_ins',
    'finance_wallet_expenses', 'finance_wallet_receivables', 'finance_checklist_bills',
    'finance_checklist_instances', 'finance_rental_units', 'finance_rental_receipts',
    'finance_property_taxes', 'finance_import_issues'
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

do $rls$
declare
  tbl text;
begin
  foreach tbl in array array[
    'finance_employees', 'finance_employee_aliases', 'finance_project_aliases', 'finance_supplier_aliases',
    'finance_funding_sources', 'finance_bank_secrets', 'finance_petty_cycles', 'finance_petty_cash_ins',
    'finance_petty_vouchers', 'finance_petty_receipts', 'finance_petty_releases', 'finance_checks',
    'finance_check_invoices', 'finance_wallets', 'finance_wallet_batches', 'finance_wallet_cash_ins',
    'finance_wallet_expenses', 'finance_wallet_receivables', 'finance_checklist_bills',
    'finance_checklist_instances', 'finance_rental_units', 'finance_rental_receipts',
    'finance_property_taxes', 'finance_import_issues'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from public, anon, authenticated', tbl);
    execute format('grant all on table public.%I to service_role', tbl);
  end loop;
end
$rls$;

revoke all on function public.finance_reserve_number(text, integer, integer) from public, anon, authenticated;
revoke all on function public.finance_create_pcv(jsonb) from public, anon, authenticated;
revoke all on function public.finance_create_wallet_expense(jsonb) from public, anon, authenticated;
grant execute on function public.finance_reserve_number(text, integer, integer) to service_role;
grant execute on function public.finance_create_pcv(jsonb) to service_role;
grant execute on function public.finance_create_wallet_expense(jsonb) to service_role;
