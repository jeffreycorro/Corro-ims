-- Atomic approve of one VRF on public.motorpool_records.
-- Apply in the Supabase SQL editor after 20261006000001_motorpool_vrf_records.sql.
--
-- Additive: one index and one function. This file does not rewrite existing
-- rows and does not remove any stored document.
--
-- The Netlify approve function calls this so the reserve status and the new
-- ledger lines commit together. If this function is not installed yet, the
-- function falls back to two targeted REST writes (ledger row first, then
-- the reserve) and still does not touch the other records.

create index if not exists motorpool_records_kind_vrf_idx
  on public.motorpool_records (kind, vrf_no);

create or replace function public.motorpool_approve_vrf(p_spec jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  vrf text;
  rno text;
  vrf_month text;
  write_ledger boolean;
  write_reserve boolean;
  reserve jsonb;
  rows jsonb;
  existing_reserve public.motorpool_records%rowtype;
  existing_ledger public.motorpool_records%rowtype;
  have_lines boolean := false;
  next_data jsonb;
  prev_data jsonb;
  wrote_reserve boolean := false;
  wrote_ledger boolean := false;
  line_count integer := 0;
  touched integer := 0;
  reserve_live boolean;
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'Approve spec is required';
  end if;

  vrf := btrim(coalesce(p_spec->>'vrf', ''));
  rno := btrim(coalesce(p_spec->>'reserveNo', ''));
  vrf_month := btrim(coalesce(p_spec->>'month', ''));
  write_ledger := coalesce(p_spec->'writeLedger', 'false'::jsonb) = 'true'::jsonb;
  write_reserve := coalesce(p_spec->'writeReserve', 'false'::jsonb) = 'true'::jsonb;
  reserve := p_spec->'reserve';
  rows := coalesce(p_spec->'rows', '[]'::jsonb);

  if vrf = '' or vrf !~ '^\d+$' then
    raise exception 'VRF number is required';
  end if;
  if rno = '' then
    raise exception 'Reserve number is required';
  end if;
  if jsonb_typeof(rows) <> 'array' then
    raise exception 'Ledger rows must be an array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(rows) line
    where btrim(coalesce(line->>'vrf', '')) is distinct from vrf
  ) then
    raise exception 'Refusing to write a different VRF while saving VRF %', vrf;
  end if;

  -- One approve of this number at a time, including the insert of a new ledger row.
  perform pg_advisory_xact_lock(hashtext('motorpool-approve'), hashtext(vrf));

  select * into existing_reserve
  from public.motorpool_records
  where id = 'reserve:' || rno
  for update;

  if not found then
    raise exception 'Reserve % was not found', rno;
  end if;

  if existing_reserve.vrf_no is not null
     and btrim(existing_reserve.vrf_no) <> ''
     and existing_reserve.vrf_no is distinct from vrf then
    raise exception 'Reserve % is VRF %, not %', rno, existing_reserve.vrf_no, vrf;
  end if;

  select * into existing_ledger
  from public.motorpool_records
  where id = 'ledger:' || vrf
  for update;

  have_lines := existing_ledger.id is not null
    and jsonb_typeof(existing_ledger.data->'rows') = 'array'
    and jsonb_array_length(existing_ledger.data->'rows') > 0;

  -- Ledger first. A reserve is never marked Approved in this transaction
  -- unless the ledger line is already stored or is inserted above it.
  if write_ledger and not have_lines and jsonb_array_length(rows) > 0 then
    if vrf_month !~ '^\d{4}-\d{2}$' then
      raise exception 'Ledger month is required';
    end if;
    if existing_ledger.id is null then
      insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
      values (
        'ledger:' || vrf,
        'ledger',
        rno,
        vrf,
        false,
        left(vrf_month, 4),
        vrf_month,
        jsonb_build_object('month', vrf_month, 'vrf', vrf, 'rows', rows)
      );
      wrote_ledger := true;
    else
      update public.motorpool_records
      set reserve_no = rno,
          vrf_no = vrf,
          live = false,
          year = left(vrf_month, 4),
          month = vrf_month,
          data = jsonb_build_object('month', vrf_month, 'vrf', vrf, 'rows', rows)
      where id = existing_ledger.id
        and data is distinct from jsonb_build_object('month', vrf_month, 'vrf', vrf, 'rows', rows);
      get diagnostics touched = row_count;
      wrote_ledger := touched > 0;
    end if;
    have_lines := true;
    line_count := jsonb_array_length(rows);
  elsif have_lines then
    line_count := jsonb_array_length(existing_ledger.data->'rows');
  end if;

  if write_reserve and reserve is not null and jsonb_typeof(reserve) = 'object' then
    next_data := reserve - 'preparedSig' - 'checkedSig' - 'approvedSig';
    next_data := jsonb_set(next_data, '{no}', to_jsonb(rno));
    next_data := jsonb_set(next_data, '{vrfNo}', to_jsonb(vrf));
    prev_data := coalesce(existing_reserve.data, '{}'::jsonb) - 'preparedSig' - 'checkedSig' - 'approvedSig';
    reserve_live := coalesce(next_data->>'status', '') not in ('Rejected', 'Archived')
      and coalesce(next_data->>'archived', '') not in ('true', 't');
    if prev_data is distinct from next_data
       or existing_reserve.live is distinct from reserve_live
       or coalesce(existing_reserve.vrf_no, '') is distinct from vrf then
      update public.motorpool_records
      set data = next_data,
          live = reserve_live,
          vrf_no = vrf,
          year = coalesce(nullif(left(next_data->>'date', 4), ''), existing_reserve.year)
      where id = existing_reserve.id
        and (
          (data - 'preparedSig' - 'checkedSig' - 'approvedSig') is distinct from next_data
          or live is distinct from reserve_live
          or coalesce(vrf_no, '') is distinct from vrf
        );
      get diagnostics touched = row_count;
      wrote_reserve := touched > 0;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'vrf', vrf,
    'reserve', rno,
    'status', 'Open',
    'ledgerLines', line_count,
    'wroteReserve', wrote_reserve,
    'wroteLedger', wrote_ledger
  );
end;
$$;

revoke all on function public.motorpool_approve_vrf(jsonb) from public;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.motorpool_approve_vrf(jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.motorpool_approve_vrf(jsonb) to service_role';
  end if;
end
$grants$;
