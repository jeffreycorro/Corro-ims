-- Per-record VRF storage, atomic numbering, and a one-time restore.
-- Apply in the Supabase SQL editor after 20260913000001_motorpool_docs.sql.
--
-- Additive: new table, new functions, new indexes, and inserts.
-- This file does not remove any stored document.
-- reserves/YYYY, ledger/YYYY-MM, and config/issued are left as they are,
-- so the old blobs stay as a backup.
-- The only change to an existing document is raising config/app.nextVrf
-- when the restore hands out a higher number. A lower value is never written.
--
-- 'builds' is inserted into motorpool_allowed_collections so the
-- new-version banner can record builds/<BUILD>. That insert was in
-- 20260914000001_motorpool_builds.sql, which was never applied on the live DB.

insert into public.motorpool_allowed_collections (name)
values ('builds')
on conflict (name) do nothing;

create table if not exists public.motorpool_records (
  id text primary key,
  kind text not null,
  reserve_no text,
  vrf_no text,
  live boolean not null default true,
  year text,
  month text,
  data jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists motorpool_records_kind_year_idx
  on public.motorpool_records (kind, year, reserve_no);

create or replace function public.motorpool_records_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

do $trg$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'motorpool_records_touch_updated_at'
  ) then
    create trigger motorpool_records_touch_updated_at
      before update on public.motorpool_records
      for each row execute function public.motorpool_records_set_updated_at();
  end if;
end
$trg$;

create or replace function public.motorpool_next_free(p_used integer[])
returns integer
language plpgsql
immutable
as $$
declare
  cand integer;
  max_n integer;
  guard integer := 0;
begin
  select coalesce(max(x), 0) into max_n
  from unnest(coalesce(p_used, array[]::integer[])) as x
  where x is not null and x <> 6033;
  cand := case when max_n < 1 then 1 else max_n + 1 end;
  while cand = any(coalesce(p_used, array[]::integer[])) and guard < 100000 loop
    cand := cand + 1;
    guard := guard + 1;
  end loop;
  return cand;
end;
$$;

-- Numbers already claimed by a live record, by a legacy blob row that has
-- not been copied yet, by the ledger, or by a sealed issued snapshot.
-- 6033 is always claimed so it cannot be given to a new form.
create or replace function public.motorpool_live_vrf_numbers()
returns integer[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct n), array[]::integer[])
  from (
    select vrf_no::integer as n
    from public.motorpool_records
    where vrf_no ~ '^\d+$'
      and (live or kind = 'ledger')
    union
    select (row_elem->>'vrf')::integer
    from public.motorpool_docs d
    cross join lateral jsonb_array_elements(coalesce(d.data->'rows', '[]'::jsonb)) row_elem
    where d.collection = 'ledger'
      and d.id ~ '^\d{4}-\d{2}$'
      and (row_elem->>'vrf') ~ '^\d+$'
      and not exists (
        select 1 from public.motorpool_records mr
        where mr.kind = 'ledger' and mr.vrf_no = row_elem->>'vrf'
      )
    union
    select (elem->>'vrfNo')::integer
    from public.motorpool_docs d
    cross join lateral jsonb_array_elements(coalesce(d.data->'rows', '[]'::jsonb)) elem
    where d.collection = 'reserves'
      and d.id ~ '^\d{4}$'
      and (elem->>'vrfNo') ~ '^\d+$'
      and coalesce(elem->>'status', '') not in ('Rejected', 'Archived')
      and coalesce(elem->>'archived', '') not in ('true', 't')
      and not exists (
        select 1 from public.motorpool_records mr
        where mr.id = 'reserve:' || (elem->>'no')
      )
    union
    select key::integer
    from public.motorpool_docs d
    cross join lateral jsonb_object_keys(coalesce(d.data->'numbers', '{}'::jsonb)) as key
    where d.collection = 'config'
      and d.id = 'issued'
      and key ~ '^\d+$'
    union
    select 6033
  ) claimed;
$$;

create or replace function public.motorpool_seed_vrf_records()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doc record;
  elem jsonb;
  bag jsonb := '[]'::jsonb;
  next_bag jsonb;
  one jsonb;
  vno text;
  keeper text;
  fresh integer;
  used integer[] := array[]::integer[];
  n integer;
  note text;
  day_txt text;
  printed_at text;
  row_data jsonb;
  draft jsonb;
  snap jsonb;
  rv jsonb;
  live_flag boolean;
  age_key text;
  rno text;
  inserted integer := 0;
begin
  insert into public.motorpool_docs (collection, id, data)
  values ('config', 'app', jsonb_build_object('nextVrf', 1, 'nextReserve', 1))
  on conflict (collection, id) do nothing;

  for n in
    select distinct (row_elem->>'vrf')::integer as n
    from public.motorpool_docs d
    cross join lateral jsonb_array_elements(coalesce(d.data->'rows', '[]'::jsonb)) row_elem
    where d.collection = 'ledger'
      and d.id ~ '^\d{4}-\d{2}$'
      and (row_elem->>'vrf') ~ '^\d+$'
  loop
    used := used || n;
  end loop;

  for n in
    select distinct key::integer as n
    from public.motorpool_docs d
    cross join lateral jsonb_object_keys(coalesce(d.data->'numbers', '{}'::jsonb)) as key
    where d.collection = 'config'
      and d.id = 'issued'
      and key ~ '^\d+$'
  loop
    used := used || n;
  end loop;

  if not (6033 = any(used)) then
    used := used || 6033;
  end if;

  for doc in
    select id as year_id, data
    from public.motorpool_docs
    where collection = 'reserves' and id ~ '^\d{4}$'
  loop
    for elem in
      select value
      from jsonb_array_elements(coalesce(doc.data->'rows', '[]'::jsonb))
    loop
      rno := btrim(coalesce(elem->>'no', ''));
      if rno = '' then
        continue;
      end if;
      if exists (
        select 1
        from jsonb_array_elements(bag) already
        where already->>'reserve_no' = rno
      ) then
        continue;
      end if;
      live_flag := coalesce(elem->>'status', '') not in ('Rejected', 'Archived')
        and coalesce(elem->>'archived', '') not in ('true', 't');
      -- Older calendar day keeps the number. Same day: the lower reserve
      -- number is the one that was raised first (RSV-101 before RSV-103,
      -- RSV-102 before RSV-104).
      age_key := coalesce(elem->>'createdAt', elem->>'submittedAt', left(elem->>'date', 10), '9999-99-99')
        || '|' || lpad(case when rno ~ '^\d+$' then rno else '99999999' end, 8, '0');
      row_data := elem - 'preparedSig' - 'checkedSig' - 'approvedSig';
      bag := bag || jsonb_build_array(jsonb_build_object(
        'reserve_no', rno,
        'vrf_no', btrim(coalesce(elem->>'vrfNo', '')),
        'live', live_flag,
        'year', doc.year_id,
        'age_key', age_key,
        'data', row_data
      ));
      if live_flag and btrim(coalesce(elem->>'vrfNo', '')) ~ '^\d+$' then
        n := btrim(elem->>'vrfNo')::integer;
        if not (n = any(used)) then
          used := used || n;
        end if;
      end if;
    end loop;
  end loop;

  -- Higher duplicate numbers first, so the second 6113 receives the next
  -- free number (6117 when 6116 is the highest claim) before the second 6112.
  declare
    dupes text[];
  begin
  select coalesce(array_agg(vrf_no order by vrf_no::integer desc), array[]::text[])
    into dupes
  from (
    select value->>'vrf_no' as vrf_no
    from jsonb_array_elements(bag) value
    where (value->>'live') = 'true'
      and (value->>'vrf_no') ~ '^\d+$'
    group by value->>'vrf_no'
    having count(*) > 1
  ) d;
  foreach vno in array dupes loop
    select value->>'reserve_no' into keeper
    from jsonb_array_elements(bag) value
    where (value->>'live') = 'true'
      and value->>'vrf_no' = vno
    order by value->>'age_key'
    limit 1;

    next_bag := '[]'::jsonb;
    for one in
      select value from jsonb_array_elements(bag)
    loop
      if (one->>'live') = 'true'
         and one->>'vrf_no' = vno
         and one->>'reserve_no' is distinct from keeper then
        fresh := public.motorpool_next_free(used);
        used := used || fresh;
        printed_at := left(coalesce(one->'data'->>'printedAt', one->'data'->>'date', ''), 10);
        if printed_at ~ '^\d{4}-\d{2}-\d{2}$' then
          day_txt := ltrim(substring(printed_at from 6 for 2), '0')
            || '/' || ltrim(substring(printed_at from 9 for 2), '0');
          note := 'Printed as VRF ' || vno || ' on ' || day_txt
            || '. Now VRF ' || fresh::text || '. Please re-mark the paper copy.';
        else
          note := 'Printed as VRF ' || vno || '. Now VRF ' || fresh::text
            || '. Please re-mark the paper copy.';
        end if;
        row_data := one->'data';
        row_data := jsonb_set(row_data, '{vrfNo}', to_jsonb(fresh::text));
        row_data := jsonb_set(row_data, '{printedAs}', to_jsonb(vno));
        row_data := jsonb_set(row_data, '{renumberNote}', to_jsonb(note));
        row_data := jsonb_set(
          row_data,
          '{audit}',
          coalesce(row_data->'audit', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'at', coalesce(one->'data'->>'printedAt', ''),
            'by', 'Motorpool',
            'field', 'vrfNo',
            'from', vno,
            'to', fresh::text,
            'note', note
          ))
        );
        if jsonb_typeof(row_data->'vrfs') = 'array' then
          row_data := jsonb_set(
            row_data,
            '{vrfs}',
            (
              select coalesce(jsonb_agg(case when value = to_jsonb(vno) then to_jsonb(fresh::text) else value end), '[]'::jsonb)
              from jsonb_array_elements(row_data->'vrfs')
            )
          );
        end if;
        one := jsonb_set(one, '{vrf_no}', to_jsonb(fresh::text));
        one := jsonb_set(one, '{data}', row_data);
      end if;
      next_bag := next_bag || jsonb_build_array(one);
    end loop;
    bag := next_bag;
  end loop;
  end;

  if not exists (
    select 1 from jsonb_array_elements(bag) value where value->>'vrf_no' = '6033'
  ) and not exists (
    select 1
    from public.motorpool_docs d
    cross join lateral jsonb_array_elements(coalesce(d.data->'rows', '[]'::jsonb)) row_elem
    where d.collection = 'ledger' and row_elem->>'vrf' = '6033'
  ) then
    bag := bag || jsonb_build_array(jsonb_build_object(
      'reserve_no', 'paper-6033',
      'vrf_no', '6033',
      'live', true,
      'year', '2026',
      'age_key', '2026-10-03|paper-vrf-6033|00000000',
      'data', jsonb_build_object(
        'no', 'paper-6033',
        'vrfNo', '6033',
        'vrfs', jsonb_build_array('6033'),
        'date', '2026-10-03',
        'kind', 'job',
        'veh', 'Equipment 1',
        'name', 'ONE BAGGER MIXER',
        'plate', 'EQUIPMENT',
        'work', 'FUEL-STN',
        'project', 'Danao Guinacot',
        'budget', 1000,
        'approvedBudget', 1000,
        'status', 'Approved',
        'requestedBy', 'Engr. Kimberly Galapin',
        'approvedBy', 'Jeffrey James M. Corro',
        'approvedAt', '2026-10-03T14:05:00+08:00',
        'printedAt', '2026-10-03T14:05:00+08:00',
        'preparedSigName', 'Sophie V. Batas',
        'draftPurpose', 'Fuel — Gasoline ×11.53',
        'draftLines', jsonb_build_array(jsonb_build_object(
          'cat', 'Fuel — Gasoline',
          'item', 'Fuel',
          'supplier', 'Iced Petron',
          'qty', 11.53,
          'unit', 'L',
          'price', 86.73,
          'work', 'FUEL-STN'
        )),
        'submissionId', 'paper-vrf-6033'
      )
    ));
  end if;

  select d.data #> array['numbers', '— not yet posted —']
    into draft
  from public.motorpool_docs d
  where d.collection = 'config' and d.id = 'issued';

  if draft is not null and not exists (
    select 1 from jsonb_array_elements(bag) value
    where value->>'reserve_no' = 'draft-unnumbered'
       or (value->'data'->>'unnumbered') = 'true'
  ) then
    snap := coalesce(draft->'snapshot', '{}'::jsonb);
    rv := coalesce(snap->'reserve', '{}'::jsonb);
    bag := bag || jsonb_build_array(jsonb_build_object(
      'reserve_no', 'draft-unnumbered',
      'vrf_no', '',
      'live', true,
      'year', left(coalesce(rv->>'date', snap #>> '{rows,0,date}', '2026-10-06'), 4),
      'age_key', '2026-10-06|draft-unnumbered-bt02|99999999',
      'data', jsonb_build_object(
        'no', 'draft-unnumbered',
        'vrfNo', '',
        'unnumbered', true,
        'draftUnnumbered', true,
        'status', 'Requested',
        'date', coalesce(rv->>'date', snap #>> '{rows,0,date}', '2026-10-06'),
        'veh', coalesce(rv->>'veh', snap #>> '{rows,0,veh}', ''),
        'work', coalesce(rv->>'work', snap #>> '{rows,0,work}', ''),
        'project', coalesce(rv->>'project', snap #>> '{rows,0,project}', ''),
        'requestedBy', coalesce(rv->>'requestedBy', snap #>> '{rows,0,requestedBy}', ''),
        'draftPurpose', coalesce(rv->>'draftPurpose', rv->>'scope', snap #>> '{rows,0,notes}', ''),
        'draftOdo', coalesce(rv->>'draftOdo', snap #>> '{rows,0,odo}', ''),
        'draftLines', case
          when jsonb_typeof(rv->'draftLines') = 'array' and jsonb_array_length(rv->'draftLines') > 0
            then rv->'draftLines'
          else (
            select coalesce(jsonb_agg(jsonb_build_object(
              'cat', line->>'cat',
              'item', line->>'item',
              'supplier', line->>'supplier',
              'qty', line->'qty',
              'unit', coalesce(line->>'unit', ''),
              'price', line->'price',
              'work', coalesce(line->>'work', '')
            )), '[]'::jsonb)
            from jsonb_array_elements(coalesce(snap->'rows', '[]'::jsonb)) line
          )
        end,
        'submissionId', 'draft-unnumbered-bt02',
        'renumberNote', 'Printed without a number. Send this draft so it receives the next VRF number.',
        'printedAt', coalesce(rv->>'printedAt', draft->>'at', '')
      )
    ));
  end if;

  insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
  select
    'reserve:' || (value->>'reserve_no'),
    'reserve',
    value->>'reserve_no',
    nullif(value->>'vrf_no', ''),
    (value->>'live') = 'true',
    value->>'year',
    null,
    jsonb_set(
      jsonb_set(value->'data', '{no}', to_jsonb(value->>'reserve_no')),
      '{vrfNo}',
      to_jsonb(coalesce(value->>'vrf_no', ''))
    )
  from jsonb_array_elements(bag) value
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;

  insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
  select
    'ledger:' || grouped.vrf,
    'ledger',
    null,
    grouped.vrf,
    false,
    left(grouped.month, 4),
    grouped.month,
    jsonb_build_object(
      'month', grouped.month,
      'vrf', grouped.vrf,
      'rows', grouped.rows
    )
  from (
    select
      row_elem->>'vrf' as vrf,
      min(d.id) as month,
      jsonb_agg(row_elem) as rows
    from public.motorpool_docs d
    cross join lateral jsonb_array_elements(coalesce(d.data->'rows', '[]'::jsonb)) row_elem
    where d.collection = 'ledger'
      and d.id ~ '^\d{4}-\d{2}$'
      and btrim(coalesce(row_elem->>'vrf', '')) <> ''
    group by row_elem->>'vrf'
  ) grouped
  on conflict (id) do nothing;

  insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
  select
    'ledger:6033',
    'ledger',
    'paper-6033',
    '6033',
    false,
    '2026',
    '2026-10',
    jsonb_build_object(
      'month', '2026-10',
      'vrf', '6033',
      'rows', jsonb_build_array(jsonb_build_object(
        'month', '2026-10',
        'date', '2026-10-03',
        'vrf', '6033',
        'veh', 'Equipment 1',
        'name', 'ONE BAGGER MIXER',
        'plate', 'EQUIPMENT',
        'cat', 'Fuel — Gasoline',
        'item', 'Fuel',
        'qty', 11.53,
        'price', 86.73,
        'total', 1000,
        'supplier', 'Iced Petron',
        'unit', 'L',
        'project', 'Danao Guinacot',
        'work', 'FUEL-STN',
        'reserve', 'paper-6033',
        'vstatus', 'Open',
        'requestedBy', 'Engr. Kimberly Galapin',
        'notes', 'Fuel — Gasoline ×11.53'
      ))
    )
  where exists (select 1 from public.motorpool_records where id = 'reserve:paper-6033')
    and not exists (select 1 from public.motorpool_records where id = 'ledger:6033')
  on conflict (id) do nothing;

  insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
  select
    'issued:' || (data->>'printedAs') || '@' || reserve_no,
    'issued',
    reserve_no,
    vrf_no,
    false,
    year,
    null,
    jsonb_build_object(
      'no', data->>'printedAs',
      'reserveNo', reserve_no,
      'now', vrf_no,
      'printedAs', data->>'printedAs',
      'sealed', true,
      'reason', 'printed',
      'snapshot', jsonb_build_object('reserve', data)
    )
  from public.motorpool_records
  where kind = 'reserve'
    and coalesce(data->>'printedAs', '') <> ''
  on conflict (id) do nothing;

  insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
  select
    'issued:' || vrf_no || '@' || reserve_no,
    'issued',
    reserve_no,
    vrf_no,
    false,
    year,
    null,
    jsonb_build_object(
      'no', vrf_no,
      'reserveNo', reserve_no,
      'printedAs', coalesce(data->>'printedAs', ''),
      'sealed', true,
      'reason', 'printed',
      'snapshot', jsonb_build_object('reserve', data)
    )
  from public.motorpool_records
  where kind = 'reserve'
    and coalesce(data->>'printedAs', '') <> ''
    and coalesce(vrf_no, '') <> ''
  on conflict (id) do nothing;

  insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
  select
    'issued:' || keeper_row.vrf_no || '@' || keeper_row.reserve_no,
    'issued',
    keeper_row.reserve_no,
    keeper_row.vrf_no,
    false,
    keeper_row.year,
    null,
    jsonb_build_object(
      'no', keeper_row.vrf_no,
      'reserveNo', keeper_row.reserve_no,
      'sealed', true,
      'reason', 'printed',
      'snapshot', jsonb_build_object('reserve', keeper_row.data)
    )
  from public.motorpool_records keeper_row
  where keeper_row.kind = 'reserve'
    and keeper_row.live
    and keeper_row.vrf_no in (
      select moved.data->>'printedAs'
      from public.motorpool_records moved
      where moved.kind = 'reserve'
        and coalesce(moved.data->>'printedAs', '') <> ''
    )
  on conflict (id) do nothing;

  update public.motorpool_docs
  set data = jsonb_set(
    data,
    '{nextVrf}',
    to_jsonb(greatest(
      coalesce((data->>'nextVrf')::integer, 0),
      public.motorpool_next_free(used)
    ))
  )
  where collection = 'config' and id = 'app';

  return jsonb_build_object('ok', true, 'inserted', inserted);
end;
$$;

create or replace function public.motorpool_issue_record(p_spec jsonb, p_build text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  op_kind text;
  used integer[];
  fresh integer;
  new_no integer;
  reserve jsonb;
  existing public.motorpool_records%rowtype;
  allowed text[] := array[
    'status', 'veh', 'work', 'project', 'budget', 'approvedBudget', 'draftLines',
    'draftPurpose', 'scope', 'requestedBy', 'approvedBy', 'approvedAt', 'printedAt',
    'decisionNote', 'draftOdo', 'odoAtRequest', 'submissionId', 'vrfs',
    'cancelledAt', 'cancelledBy', 'cancelOutcome', 'liquidatedAt', 'actual',
    'preparedSigName', 'paperAttachments', 'notes', 'date', 'bypass', 'fuel',
    'name', 'plate', 'jobs'
  ];
  key text;
  patch jsonb;
  app jsonb;
  trust boolean;
  vrf_month text;
  rows jsonb;
  saved jsonb;
  ledger_id text;
begin
  if coalesce(p_build, '') < '2026-10-06 a' then
    raise exception 'Reload the page';
  end if;

  insert into public.motorpool_docs (collection, id, data)
  values ('config', 'app', jsonb_build_object('nextVrf', 1, 'nextReserve', 1))
  on conflict (collection, id) do nothing;

  perform 1
  from public.motorpool_docs
  where collection = 'config' and id = 'app'
  for update;

  if (select count(*) from public.motorpool_records where kind = 'reserve') = 0 then
    perform public.motorpool_seed_vrf_records();
  end if;

  op_kind := coalesce(p_spec->>'kind', '');
  select data into app
  from public.motorpool_docs
  where collection = 'config' and id = 'app';

  if op_kind = 'repair' then
    return jsonb_build_object(
      'ok', true,
      'kind', 'repair',
      'nextVrf', coalesce((app->>'nextVrf')::integer, 1),
      'nextReserve', coalesce((app->>'nextReserve')::integer, 1),
      'changes', '[]'::jsonb,
      'attempts', 1
    );
  end if;

  if op_kind = 'issued' then
    reserve := coalesce(p_spec->'entry', '{}'::jsonb);
    if btrim(coalesce(reserve->>'no', reserve->>'vrf', '')) = '' then
      raise exception 'A sealed VRF needs a number.';
    end if;
    insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
    values (
      'issued:' || btrim(coalesce(reserve->>'no', reserve->>'vrf')) || '@' ||
        coalesce(nullif(reserve->>'reserveNo', ''), nullif(reserve #>> '{snapshot,reserve,no}', ''), 'number'),
      'issued',
      nullif(coalesce(reserve->>'reserveNo', reserve #>> '{snapshot,reserve,no}', ''), ''),
      btrim(coalesce(reserve->>'no', reserve->>'vrf')),
      false,
      null,
      null,
      reserve || jsonb_build_object('sealed', true, 'no', btrim(coalesce(reserve->>'no', reserve->>'vrf')))
    )
    on conflict (id) do nothing;
    return jsonb_build_object(
      'ok', true,
      'kind', 'issued',
      'no', btrim(coalesce(reserve->>'no', reserve->>'vrf')),
      'attempts', 1
    );
  end if;

  used := public.motorpool_live_vrf_numbers();
  reserve := coalesce(p_spec->'reserve', '{}'::jsonb) - 'preparedSig' - 'checkedSig' - 'approvedSig';

  if op_kind in ('reserve', 'bundle') and btrim(coalesce(reserve->>'no', '')) <> '' then
    select * into existing
    from public.motorpool_records
    where id = 'reserve:' || btrim(reserve->>'no')
    for update;
    if found then
      patch := '{}'::jsonb;
      foreach key in array allowed loop
        if reserve ? key then
          patch := patch || jsonb_build_object(key, reserve->key);
        end if;
      end loop;
      update public.motorpool_records
      set data = (data || patch) - 'preparedSig' - 'checkedSig' - 'approvedSig',
          live = case
            when coalesce(patch->>'status', data->>'status', '') in ('Rejected', 'Archived') then false
            else live
          end
      where id = existing.id
      returning data into saved;
      saved := saved || jsonb_build_object('no', existing.reserve_no, 'vrfNo', coalesce(existing.vrf_no, saved->>'vrfNo', ''));
      if op_kind = 'bundle' then
        vrf_month := btrim(coalesce(p_spec->>'month', ''));
        rows := coalesce(p_spec->'rows', '[]'::jsonb);
        if vrf_month <> '' and existing.vrf_no is not null then
          select coalesce(jsonb_agg(line || jsonb_build_object('vrf', existing.vrf_no)), '[]'::jsonb)
            into rows
          from jsonb_array_elements(rows) line;
          insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
          values (
            'ledger:' || existing.vrf_no,
            'ledger',
            existing.reserve_no,
            existing.vrf_no,
            false,
            left(vrf_month, 4),
            vrf_month,
            jsonb_build_object('month', vrf_month, 'vrf', existing.vrf_no, 'rows', rows)
          )
          on conflict (id) do update
          set month = excluded.month,
              year = excluded.year,
              data = excluded.data,
              reserve_no = excluded.reserve_no;
        end if;
      end if;
      return jsonb_build_object(
        'ok', true,
        'kind', op_kind,
        'store', 'records',
        'nextVrf', coalesce((app->>'nextVrf')::integer, 1),
        'nextReserve', coalesce((app->>'nextReserve')::integer, 1),
        'reserve', saved,
        'reserveNo', existing.reserve_no,
        'vrf', coalesce(existing.vrf_no, ''),
        'vrfNo', coalesce(existing.vrf_no, ''),
        'attempts', 1,
        'changes', '[]'::jsonb
      );
    end if;
  end if;

  if op_kind = 'issue-ledger' then
    fresh := public.motorpool_next_free(used);
    vrf_month := btrim(coalesce(p_spec->>'month', ''));
    if vrf_month !~ '^\d{4}-\d{2}$' then
      raise exception 'VRF number and month are required';
    end if;
    rows := coalesce(p_spec->'rows', '[]'::jsonb);
    select coalesce(jsonb_agg(line || jsonb_build_object('vrf', fresh::text)), '[]'::jsonb)
      into rows
    from jsonb_array_elements(rows) line;
    insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
    values (
      'ledger:' || fresh::text,
      'ledger',
      null,
      fresh::text,
      false,
      left(vrf_month, 4),
      vrf_month,
      jsonb_build_object('month', vrf_month, 'vrf', fresh::text, 'rows', rows)
    );
    update public.motorpool_docs
    set data = jsonb_set(
      data,
      '{nextVrf}',
      to_jsonb(greatest(coalesce((data->>'nextVrf')::integer, 0), fresh + 1))
    )
    where collection = 'config' and id = 'app';
    return jsonb_build_object(
      'ok', true,
      'kind', 'issue-ledger',
      'store', 'records',
      'vrf', fresh::text,
      'vrfNo', fresh::text,
      'nextVrf', fresh + 1,
      'attempts', 1
    );
  end if;

  trust := coalesce(p_spec->>'restore', '') = 'true'
    or btrim(coalesce(p_spec->>'vrf', '')) = '6033'
    or btrim(coalesce(reserve->>'vrfNo', '')) = '6033';
  if trust then
    if btrim(coalesce(reserve->>'vrfNo', p_spec->>'vrf', '')) !~ '^\d+$' then
      trust := false;
    else
      fresh := btrim(coalesce(reserve->>'vrfNo', p_spec->>'vrf'))::integer;
      if fresh = any(used) then
        trust := false;
      end if;
    end if;
  end if;

  if not trust then
    fresh := public.motorpool_next_free(used);
  end if;

  select * into existing
  from public.motorpool_records
  where kind = 'reserve'
    and coalesce(reserve->>'submissionId', '') <> ''
    and data->>'submissionId' = reserve->>'submissionId'
    and (vrf_no is null or vrf_no !~ '^\d+$')
  for update;

  if found then
    saved := (existing.data || (reserve - 'no' - 'vrfNo'))
      - 'preparedSig' - 'checkedSig' - 'approvedSig';
    saved := saved || jsonb_build_object(
      'no', existing.reserve_no,
      'vrfNo', fresh::text,
      'unnumbered', false
    );
    update public.motorpool_records
    set vrf_no = fresh::text,
        live = true,
        data = saved
    where id = existing.id;
    new_no := case when existing.reserve_no ~ '^\d+$' then existing.reserve_no::integer else null end;
  else
    select coalesce(max(reserve_no::integer), 0) + 1 into new_no
    from public.motorpool_records
    where kind = 'reserve' and reserve_no ~ '^\d+$';
    if coalesce((app->>'nextReserve')::integer, 0) > new_no then
      new_no := (app->>'nextReserve')::integer;
    end if;
    if trust and btrim(coalesce(reserve->>'no', '')) <> '' then
      saved := reserve || jsonb_build_object('no', btrim(reserve->>'no'), 'vrfNo', fresh::text);
      insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
      values (
        'reserve:' || btrim(reserve->>'no'),
        'reserve',
        btrim(reserve->>'no'),
        fresh::text,
        true,
        left(coalesce(reserve->>'date', to_char(timezone('utc', now()), 'YYYY')), 4),
        null,
        saved - 'preparedSig' - 'checkedSig' - 'approvedSig'
      );
      saved := saved || jsonb_build_object('no', btrim(reserve->>'no'), 'vrfNo', fresh::text);
    else
      saved := (reserve - 'no' - 'vrfNo') || jsonb_build_object(
        'no', new_no::text,
        'vrfNo', fresh::text,
        'vrfs', '[]'::jsonb
      );
      insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
      values (
        'reserve:' || new_no::text,
        'reserve',
        new_no::text,
        fresh::text,
        coalesce(saved->>'status', 'Requested') not in ('Rejected', 'Archived'),
        left(coalesce(saved->>'date', to_char(timezone('utc', now()), 'YYYY')), 4),
        null,
        saved - 'preparedSig' - 'checkedSig' - 'approvedSig'
      );
    end if;
  end if;

  update public.motorpool_docs
  set data = jsonb_set(
    jsonb_set(
      data,
      '{nextVrf}',
      to_jsonb(greatest(coalesce((data->>'nextVrf')::integer, 0), fresh + 1))
    ),
    '{nextReserve}',
    to_jsonb(greatest(coalesce((data->>'nextReserve')::integer, 0), coalesce(new_no, 0) + 1))
  )
  where collection = 'config' and id = 'app'
  returning data into app;

  if op_kind = 'bundle' then
    vrf_month := btrim(coalesce(p_spec->>'month', ''));
    rows := coalesce(p_spec->'rows', '[]'::jsonb);
    if vrf_month ~ '^\d{4}-\d{2}$' then
      select coalesce(jsonb_agg(line || jsonb_build_object('vrf', fresh::text)), '[]'::jsonb)
        into rows
      from jsonb_array_elements(rows) line;
      ledger_id := 'ledger:' || fresh::text;
      insert into public.motorpool_records (id, kind, reserve_no, vrf_no, live, year, month, data)
      values (
        ledger_id,
        'ledger',
        saved->>'no',
        fresh::text,
        false,
        left(vrf_month, 4),
        vrf_month,
        jsonb_build_object('month', vrf_month, 'vrf', fresh::text, 'rows', rows)
      )
      on conflict (id) do update
      set data = excluded.data,
          month = excluded.month,
          vrf_no = excluded.vrf_no,
          reserve_no = excluded.reserve_no;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'kind', op_kind,
    'store', 'records',
    'nextVrf', coalesce((app->>'nextVrf')::integer, fresh + 1),
    'nextReserve', coalesce((app->>'nextReserve')::integer, 1),
    'reserve', saved,
    'reserveNo', saved->>'no',
    'vrf', fresh::text,
    'vrfNo', fresh::text,
    'attempts', 1,
    'changes', '[]'::jsonb
  );
end;
$$;

select public.motorpool_seed_vrf_records();

create unique index if not exists motorpool_records_live_vrf_idx
  on public.motorpool_records (vrf_no)
  where live
    and kind = 'reserve'
    and vrf_no is not null
    and btrim(vrf_no) <> ''
    and vrf_no ~ '^\d+$';

revoke all on function public.motorpool_seed_vrf_records() from public;
revoke all on function public.motorpool_issue_record(jsonb, text) from public;
revoke all on function public.motorpool_live_vrf_numbers() from public;
revoke all on function public.motorpool_next_free(integer[]) from public;

alter table public.motorpool_records enable row level security;
revoke all on table public.motorpool_records from public;

do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.motorpool_records from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.motorpool_seed_vrf_records() to service_role';
    execute 'grant execute on function public.motorpool_issue_record(jsonb, text) to service_role';
    execute 'grant execute on function public.motorpool_live_vrf_numbers() to service_role';
    execute 'grant execute on function public.motorpool_next_free(integer[]) to service_role';
    execute 'grant select, insert, update on table public.motorpool_records to service_role';
  end if;
end
$grants$;
