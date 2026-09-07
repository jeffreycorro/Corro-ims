-- HR 201 File foundation: settings, projects, employees, document series/register.
-- Apply in the Supabase SQL editor or via the Supabase CLI after 20260907000001.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'employee_department') then
    create type public.employee_department as enum (
      'admin',
      'technical',
      'finance',
      'procurement',
      'motorpool',
      'safety',
      'site',
      'hr',
      'unassigned'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'employment_status') then
    create type public.employment_status as enum (
      'Probationary',
      'Regular',
      'Project-based',
      'Fixed-term',
      'Consultant',
      'Separated'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'project_status') then
    create type public.project_status as enum ('Active', 'Closed');
  end if;

  if not exists (select 1 from pg_type where typname = 'document_status') then
    create type public.document_status as enum ('draft', 'issued', 'void');
  end if;

  if not exists (select 1 from pg_type where typname = 'sex') then
    create type public.sex as enum ('Male', 'Female');
  end if;

  if not exists (select 1 from pg_type where typname = 'civil_status') then
    create type public.civil_status as enum (
      'Single',
      'Married',
      'Widowed',
      'Separated',
      'Annulled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'rate_type') then
    create type public.rate_type as enum ('Daily', 'Monthly', 'Hourly');
  end if;
end
$$;

-- Single-row company constants. TIN and signatory names are entered in Settings.
create table if not exists public.settings (
  id smallint primary key default 1 check (id = 1),
  company_name text not null,
  address text not null,
  tin text,
  document_prefix text not null default 'CCDTC',
  hr_officer_name text,
  hr_officer_title text,
  admin_head_name text,
  admin_head_title text,
  finance_officer_name text,
  finance_officer_title text,
  ceo_name text,
  ceo_title text,
  probation_warning_days integer not null default 30,
  contract_end_warning_days integer not null default 30,
  document_expiry_warning_days integer not null default 60,
  nte_answer_days integer not null default 5,
  discipline_lookback_months integer not null default 12,
  cash_advance_liquidate_days integer not null default 15,
  workdays_per_period integer not null default 13,
  overtime_multiplier numeric(6, 2) not null default 1.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
before update on public.settings
for each row
execute procedure public.set_updated_at();

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location text,
  status public.project_status not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row
execute procedure public.set_updated_at();

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  emp_no text not null unique,
  name text not null,
  nickname text,
  birthdate date,
  sex public.sex,
  civil_status public.civil_status,
  address text,
  mobile text,
  email text,
  emergency_name text,
  emergency_relation text,
  emergency_number text,
  sss_no text,
  tin_no text,
  philhealth_no text,
  pagibig_no text,
  bank_account text,
  department public.employee_department,
  position text,
  project text,
  project_id uuid references public.projects (id) on delete set null,
  project_location text,
  supervisor text,
  supervisor_id uuid references public.employees (id) on delete set null,
  -- Blank is meaningful: unclassified. Never default this column.
  employment_status public.employment_status,
  date_hired date,
  contract_start date,
  contract_end date,
  prior_contract_no text,
  regularized_on date,
  daily_rate numeric(12, 2),
  rate_type public.rate_type,
  allowance numeric(12, 2),
  separated_on date,
  separation_reason text,
  status_basis text,
  roster_confirmed date,
  photo_link text,
  drive_folder_id text,
  drive_folder_link text,
  notes text,
  checklist jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employees_name_idx on public.employees (name);
create index if not exists employees_project_id_idx on public.employees (project_id);
create index if not exists employees_supervisor_id_idx on public.employees (supervisor_id);
create index if not exists employees_department_idx on public.employees (department);
create index if not exists employees_employment_status_idx on public.employees (employment_status);

drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at
before update on public.employees
for each row
execute procedure public.set_updated_at();

create table if not exists public.document_series (
  key text primary key,
  label text not null,
  prefix text not null default '',
  padding integer not null default 4,
  reset_yearly boolean not null default true,
  pattern text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists document_series_set_updated_at on public.document_series;
create trigger document_series_set_updated_at
before update on public.document_series
for each row
execute procedure public.set_updated_at();

create table if not exists public.document_register (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  series_key text not null references public.document_series (key),
  year integer not null,
  seq integer not null,
  title text,
  employee_id uuid references public.employees (id) on delete set null,
  tags text[] not null default '{}',
  module text,
  ref_id text,
  date date,
  status public.document_status not null default 'draft',
  link text,
  notes text,
  issued_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_key, year, seq)
);

create index if not exists document_register_employee_idx on public.document_register (employee_id);
create index if not exists document_register_series_year_idx on public.document_register (series_key, year);

drop trigger if exists document_register_set_updated_at on public.document_register;
create trigger document_register_set_updated_at
before update on public.document_register
for each row
execute procedure public.set_updated_at();

-- HR staff: role hr/admin, or assigned to the HR department.
create or replace function public.is_hr_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (role in ('hr', 'admin') or department = 'hr')
  );
$$;

revoke all on function public.is_hr_staff() from public;
grant execute on function public.is_hr_staff() to authenticated;

alter table public.settings enable row level security;
alter table public.projects enable row level security;
alter table public.employees enable row level security;
alter table public.document_series enable row level security;
alter table public.document_register enable row level security;

drop policy if exists "Authenticated can read settings" on public.settings;
create policy "Authenticated can read settings"
on public.settings
for select
to authenticated
using (true);

drop policy if exists "HR can update settings" on public.settings;
create policy "HR can update settings"
on public.settings
for update
to authenticated
using (public.is_hr_staff())
with check (public.is_hr_staff());

drop policy if exists "HR can insert settings" on public.settings;
create policy "HR can insert settings"
on public.settings
for insert
to authenticated
with check (public.is_hr_staff());

drop policy if exists "Authenticated can read projects" on public.projects;
create policy "Authenticated can read projects"
on public.projects
for select
to authenticated
using (true);

drop policy if exists "HR can insert projects" on public.projects;
create policy "HR can insert projects"
on public.projects
for insert
to authenticated
with check (public.is_hr_staff());

drop policy if exists "HR can update projects" on public.projects;
create policy "HR can update projects"
on public.projects
for update
to authenticated
using (public.is_hr_staff())
with check (public.is_hr_staff());

drop policy if exists "HR can delete projects" on public.projects;
create policy "HR can delete projects"
on public.projects
for delete
to authenticated
using (public.is_hr_staff());

drop policy if exists "HR can read employees" on public.employees;
create policy "HR can read employees"
on public.employees
for select
to authenticated
using (public.is_hr_staff());

drop policy if exists "HR can insert employees" on public.employees;
create policy "HR can insert employees"
on public.employees
for insert
to authenticated
with check (public.is_hr_staff());

drop policy if exists "HR can update employees" on public.employees;
create policy "HR can update employees"
on public.employees
for update
to authenticated
using (public.is_hr_staff())
with check (public.is_hr_staff());

drop policy if exists "HR can delete employees" on public.employees;
create policy "HR can delete employees"
on public.employees
for delete
to authenticated
using (public.is_hr_staff());

drop policy if exists "Authenticated can read document series" on public.document_series;
create policy "Authenticated can read document series"
on public.document_series
for select
to authenticated
using (true);

drop policy if exists "HR can insert document series" on public.document_series;
create policy "HR can insert document series"
on public.document_series
for insert
to authenticated
with check (public.is_hr_staff());

drop policy if exists "HR can update document series" on public.document_series;
create policy "HR can update document series"
on public.document_series
for update
to authenticated
using (public.is_hr_staff())
with check (public.is_hr_staff());

drop policy if exists "HR can delete document series" on public.document_series;
create policy "HR can delete document series"
on public.document_series
for delete
to authenticated
using (public.is_hr_staff());

drop policy if exists "HR can read document register" on public.document_register;
create policy "HR can read document register"
on public.document_register
for select
to authenticated
using (public.is_hr_staff());

drop policy if exists "HR can insert document register" on public.document_register;
create policy "HR can insert document register"
on public.document_register
for insert
to authenticated
with check (public.is_hr_staff());

drop policy if exists "HR can update document register" on public.document_register;
create policy "HR can update document register"
on public.document_register
for update
to authenticated
using (public.is_hr_staff())
with check (public.is_hr_staff());

drop policy if exists "HR can delete document register" on public.document_register;
create policy "HR can delete document register"
on public.document_register
for delete
to authenticated
using (public.is_hr_staff());

grant select, insert, update, delete on table public.settings to authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.employees to authenticated;
grant select, insert, update, delete on table public.document_series to authenticated;
grant select, insert, update, delete on table public.document_register to authenticated;

-- Default company constants. TIN and live signatory names are typed in Settings.
insert into public.settings (
  id,
  company_name,
  address,
  tin,
  document_prefix,
  hr_officer_name,
  hr_officer_title,
  admin_head_name,
  admin_head_title,
  finance_officer_name,
  finance_officer_title,
  ceo_name,
  ceo_title,
  probation_warning_days,
  contract_end_warning_days,
  document_expiry_warning_days,
  nte_answer_days,
  discipline_lookback_months,
  cash_advance_liquidate_days,
  workdays_per_period,
  overtime_multiplier
)
values (
  1,
  'CORRO CONSTRUCTION DEVELOPMENT AND TRADE CORPORATION',
  '15 First Street, La Guardia, Lahug, Cebu City, Cebu 6000',
  null,
  'CCDTC',
  null,
  'HR Head',
  null,
  'Chief Administrative Officer',
  null,
  'Finance Head',
  null,
  'Corporate President',
  30,
  30,
  60,
  5,
  12,
  15,
  13,
  1.0
)
on conflict (id) do nothing;

-- Printed formats match paper already in the cabinet. Spacing and padding are deliberate.
insert into public.document_series (key, label, prefix, padding, reset_yearly, pattern)
values
  ('CON', 'Employment Contract', '', 2, true, '{YYYY} - {NN}'),
  ('NTE', 'Notice to Explain', 'NTE', 2, true, '{PREFIX}{YYYY} - {NN}'),
  ('NOD', 'Notice of Decision', 'NOD', 4, true, '{PREFIX}{YYYY}-{NNNN}'),
  ('WW', 'Written Warning', 'WW', 4, true, '{PREFIX}{YYYY}-{NNNN}'),
  ('CA', 'Cash Advance Request Form', 'CAF', 4, true, '{PREFIX}{YYYY}-{NNNN}'),
  ('LV', 'Leave Request Form', 'LRF', 4, true, '{PREFIX}{YYYY}-{NNNN}'),
  ('COE', 'Certificate of Employment', 'COE', 2, true, '{PREFIX}{YYYY} - {NN}'),
  ('CLR', 'Clearance / Quitclaim', 'CLR', 4, true, '{PREFIX}{YYYY}-{NNNN}'),
  ('CM', 'Company Memorandum', 'C.M. ', 2, true, '{PREFIX}{YYYY} - {NN}'),
  ('DM', 'Disciplinary Memorandum', 'DM', 2, true, '{PREFIX}{YYYY} - {NN}'),
  ('NCR', 'Non-Conformance Report', 'NCR', 3, true, '{PREFIX} {YYYY} - {NNN}'),
  ('ALR', 'Acceptance of Resignation', 'ALR', 2, true, '{PREFIX}{YYYY}-{NN}'),
  ('RM', 'Written Reminder', 'RM', 3, true, '{PREFIX}{YYYY}-{NNN}'),
  ('RFFI', 'Recommendation for Final Interview', 'RFFI', 2, true, '{PREFIX}{YYYY} - {NN}'),
  ('IR', 'Incident Report', 'IR', 2, true, '{PREFIX}{YYYY} - {NN}'),
  ('PE', 'Performance Evaluation', 'PE', 4, true, '{PREFIX}{YYYY}-{NNNN}'),
  ('OFR', 'Job Offer', 'OFR', 4, true, '{PREFIX}{YYYY}-{NNNN}'),
  ('PAF', 'Personnel Action Form', 'PAF', 4, true, '{PREFIX}{YYYY}-{NNNN}'),
  ('MEMO', 'Memorandum', 'MEMO', 4, true, '{PREFIX}{YYYY}-{NNNN}')
on conflict (key) do nothing;

insert into public.projects (id, name, location, status)
values
  ('20000000-0000-4000-8000-000000000001', 'Cebu South Coastal Road Concreting', 'Talisay, Cebu', 'Active'),
  ('20000000-0000-4000-8000-000000000002', 'Lahug Public School Building', 'Lahug, Cebu City', 'Active'),
  ('20000000-0000-4000-8000-000000000003', 'Mandaue Warehouse', 'Mandaue City', 'Active'),
  ('20000000-0000-4000-8000-000000000004', 'Naga Multipurpose Building', 'Naga, Cebu', 'Active')
on conflict (id) do nothing;

-- Sample roster. Names are invented. One row is left unclassified (employment_status null).
insert into public.employees (
  id, emp_no, name, nickname, birthdate, sex, civil_status, address, mobile, email,
  emergency_name, emergency_relation, emergency_number,
  sss_no, tin_no, philhealth_no, pagibig_no, bank_account,
  department, position, project, project_id, project_location,
  supervisor, supervisor_id, employment_status,
  date_hired, contract_start, contract_end, prior_contract_no, regularized_on,
  daily_rate, rate_type, allowance, separated_on, separation_reason,
  status_basis, roster_confirmed, photo_link, drive_folder_id, drive_folder_link, notes, checklist
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '1353',
    'Dela Cruz, Maria S.',
    'Maring',
    '1988-04-12',
    'Female',
    'Married',
    'Lahug, Cebu City',
    '0917-555-1353',
    'maria.delacruz@corcondev.local',
    'Ramon Dela Cruz',
    'Spouse',
    '0917-555-2001',
    '33-1234567-8',
    '123-456-789-000',
    '12-345678901-2',
    '1211-1234-5678',
    'BDO 001234567890',
    'hr',
    'HR Officer',
    null,
    null,
    'Main Office / Motorpool',
    null,
    null,
    'Regular',
    '2019-03-11',
    '2019-03-11',
    null,
    null,
    '2019-09-11',
    1200.00,
    'Monthly',
    0,
    null,
    null,
    'Office staff on monthly payroll; no project assignment.',
    '2026-08-15',
    null,
    null,
    null,
    'Sample office regular. Not a live employee record.',
    '[]'::jsonb
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '1108',
    'Santos, Juan P.',
    'Johnny',
    '1994-11-03',
    'Male',
    'Single',
    'Talisay City, Cebu',
    '0918-555-1108',
    'juan.santos@corcondev.local',
    'Lorna Santos',
    'Mother',
    '0918-555-2108',
    '34-7654321-0',
    '321-654-987-000',
    '13-987654321-0',
    '1211-8765-4321',
    'BPI 009988776655',
    'site',
    'Mason',
    'Cebu South Coastal Road Concreting',
    '20000000-0000-4000-8000-000000000001',
    'Talisay, Cebu',
    'Garcia, Jose M.',
    null,
    'Project-based',
    '2024-06-01',
    '2026-06-01',
    '2026-11-30',
    '2025 - 88',
    null,
    620.00,
    'Daily',
    50.00,
    null,
    null,
    'Assigned to an active project; successive project contracts.',
    '2026-08-15',
    null,
    null,
    null,
    'Sample project-based mason.',
    '[]'::jsonb
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '1422',
    'Reyes, Ana L.',
    'Annette',
    '1999-07-21',
    'Female',
    'Single',
    'Mandaue City',
    '0927-555-1422',
    'ana.reyes@corcondev.local',
    'Elena Reyes',
    'Mother',
    '0927-555-2422',
    '35-1122334-5',
    '111-222-333-000',
    '14-112233445-5',
    '1211-1122-3344',
    'Metrobank 1122334455',
    'finance',
    'Accounting Clerk',
    null,
    null,
    'Main Office / Motorpool',
    'Dela Cruz, Maria S.',
    null,
    'Probationary',
    '2026-07-01',
    '2026-07-01',
    '2026-12-31',
    null,
    null,
    850.00,
    'Monthly',
    0,
    null,
    null,
    'Probationary office hire; regularization review before contract end.',
    '2026-08-15',
    null,
    null,
    null,
    'Sample probationary clerk.',
    '[]'::jsonb
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '1280',
    'Garcia, Jose M.',
    'Jojo',
    '1985-01-30',
    'Male',
    'Married',
    'Cebu City',
    '0916-555-1280',
    'jose.garcia@corcondev.local',
    'Teresa Garcia',
    'Spouse',
    '0916-555-2280',
    '33-9988776-1',
    '998-877-661-000',
    '12-998877661-1',
    '1211-9988-7766',
    'BDO 009988776611',
    'technical',
    'Project Engineer',
    'Cebu South Coastal Road Concreting',
    '20000000-0000-4000-8000-000000000001',
    'Talisay, Cebu',
    'Dela Cruz, Maria S.',
    null,
    'Project-based',
    '2021-02-15',
    '2026-03-01',
    '2026-12-15',
    '2025 - 12',
    null,
    1400.00,
    'Daily',
    200.00,
    null,
    null,
    'Site assignment; project-based regardless of length of service.',
    '2026-08-15',
    null,
    null,
    null,
    'Sample project engineer / site supervisor.',
    '[]'::jsonb
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '1510',
    'Mendoza, Rosa C.',
    'Osang',
    '1991-09-18',
    'Female',
    'Married',
    'Naga, Cebu',
    '0933-555-1510',
    'rosa.mendoza@corcondev.local',
    'Carlo Mendoza',
    'Spouse',
    '0933-555-2510',
    '34-5566778-9',
    '556-677-889-000',
    '13-556677889-0',
    '1211-5566-7788',
    'Landbank 5566778899',
    'safety',
    'Safety Officer',
    'Naga Multipurpose Building',
    '20000000-0000-4000-8000-000000000004',
    'Naga, Cebu',
    'Garcia, Jose M.',
    null,
    'Project-based',
    '2023-05-08',
    '2026-05-08',
    '2026-11-08',
    '2025 - 44',
    null,
    780.00,
    'Daily',
    80.00,
    null,
    null,
    'Assigned to Naga site.',
    '2026-08-15',
    null,
    null,
    null,
    'Sample safety officer.',
    '[]'::jsonb
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    '1604',
    'Villanueva, Carlo T.',
    'Caloy',
    '1997-12-05',
    'Male',
    'Single',
    'Consolacion, Cebu',
    '0947-555-1604',
    'carlo.villanueva@corcondev.local',
    'Nita Villanueva',
    'Sister',
    '0947-555-2604',
    '36-4455667-8',
    '445-566-778-000',
    '15-445566778-8',
    '1211-4455-6677',
    null,
    'unassigned',
    'Laborer',
    null,
    null,
    null,
    null,
    null,
    null,
    '2026-08-20',
    null,
    null,
    null,
    null,
    520.00,
    'Daily',
    0,
    null,
    null,
    'Roster imported; classification not yet set.',
    null,
    null,
    null,
    null,
    'Sample unclassified record — employment_status left blank on purpose.',
    '[]'::jsonb
  ),
  (
    '30000000-0000-4000-8000-000000000007',
    '1377',
    'Ramos, Ligaya F.',
    'Gaya',
    '1982-06-14',
    'Female',
    'Widowed',
    'Cebu City',
    '0915-555-1377',
    'ligaya.ramos@corcondev.local',
    'Paolo Ramos',
    'Son',
    '0915-555-2377',
    '33-2233445-6',
    '223-344-556-000',
    '12-223344556-6',
    '1211-2233-4455',
    'BDO 223344556677',
    'procurement',
    'Purchasing Assistant',
    null,
    null,
    'Main Office / Motorpool',
    'Dela Cruz, Maria S.',
    null,
    'Fixed-term',
    '2025-01-06',
    '2026-01-06',
    '2026-12-31',
    '2025 - 02',
    null,
    900.00,
    'Monthly',
    0,
    null,
    null,
    'Fixed-term office engagement.',
    '2026-08-15',
    null,
    null,
    null,
    'Sample fixed-term procurement staff.',
    '[]'::jsonb
  ),
  (
    '30000000-0000-4000-8000-000000000008',
    '0901',
    'Bautista, Pedro A.',
    'Pete',
    '1978-02-09',
    'Male',
    'Married',
    'Minglanilla, Cebu',
    '0922-555-0901',
    'pedro.bautista@corcondev.local',
    'Alicia Bautista',
    'Spouse',
    '0922-555-2901',
    '33-6677889-0',
    '667-788-990-000',
    '12-667788990-0',
    '1211-6677-8899',
    'BPI 667788990011',
    'motorpool',
    'Mechanic (Consultant)',
    null,
    null,
    'Main Office / Motorpool',
    null,
    null,
    'Consultant',
    '2024-10-01',
    '2026-01-01',
    '2026-12-31',
    null,
    null,
    1500.00,
    'Daily',
    0,
    null,
    null,
    'Yard assignment — Main Office / Motorpool is not a project.',
    '2026-08-15',
    null,
    null,
    null,
    'Sample motorpool consultant.',
    '[]'::jsonb
  )
on conflict (emp_no) do nothing;

-- Wire supervisor FKs after all employee rows exist.
update public.employees
set supervisor_id = '30000000-0000-4000-8000-000000000001'
where emp_no in ('1280', '1422', '1377')
  and supervisor_id is null;

update public.employees
set supervisor_id = '30000000-0000-4000-8000-000000000004'
where emp_no in ('1108', '1510')
  and supervisor_id is null;
