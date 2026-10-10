-- Bill dashboard fields. Additive. Does not change HR or Motorpool data.

alter table public.finance_checklist_bills
  add column if not exists bill_type text not null default '',
  add column if not exists card_name text not null default '',
  add column if not exists recurring boolean not null default false,
  add column if not exists recurring_amount numeric(14,2) not null default 0,
  add column if not exists due_day integer;

alter table public.finance_checklist_instances
  add column if not exists payment_method text not null default '',
  add column if not exists receipt_path text not null default '';

alter table public.finance_rental_units
  add column if not exists unit_no text not null default '',
  add column if not exists monthly_rent numeric(14,2) not null default 0;

insert into public.finance_rental_units (id, name, site, unit_no, monthly_rent, active)
values
  ('rent-edades-720', 'Residencia Edades 720', 'Residencia Edades', '720', 8500, true),
  ('rent-soho-1123', 'City Soho 1123', 'City Soho Condo', '1123', 10000, true),
  ('rent-sanremo-3314', 'San Remo 3314', 'San Remo Oasis', '3314', 12500, true)
on conflict (id) do nothing;
