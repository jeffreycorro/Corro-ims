-- Personal bank accounts stay out of company check totals. Additive.
-- Run after 20261010000004_finance_sheet_import.sql.
-- Does not remove tables and does not change HR or Motorpool data.

alter table public.finance_bank_accounts
  add column if not exists is_personal boolean not null default false;

insert into public.finance_bank_accounts (
  id, bank_name, nickname, account_type, bank_code, account_name, account_no, is_personal
)
values (
  'bank-bdo-personal',
  'BDO',
  'BDO Personal',
  'BDO Personal',
  'BDOJOINT',
  'Jeffrey',
  '',
  true
)
on conflict (id) do update
  set is_personal = true,
      nickname = excluded.nickname,
      account_type = excluded.account_type,
      bank_code = excluded.bank_code
  where public.finance_bank_accounts.is_personal is distinct from true
     or public.finance_bank_accounts.bank_code is distinct from excluded.bank_code;
