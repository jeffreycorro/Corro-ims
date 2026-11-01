-- Stale-save guard for motorpool_records (2026-11-01).
-- MANUAL STEP: apply in the Supabase SQL editor (project kfflyzprxcidmsdjhuej)
-- after review. This file was NOT run against production by the PR.
--
-- Background: on 2026-10-30 VRF 6264 was approved, then an old browser tab
-- saved its copy over it and reset it to Requested.
--
-- This trigger refuses, for kind 'reserve' and 'ledger' rows:
--   1. a status downgrade: Approved / Open / Closed / Cancelled / Not bought /
--      Duplicate  ->  Requested / Draft / Pending / For approval / Held / ''
--   2. a write that carries an older revision (data.rev lower than stored).
-- Writers that do not stamp data.rev get it bumped automatically.
--
-- Escape hatch for a deliberate admin fix, inside one transaction:
--   set local motorpool.allow_status_downgrade = 'on';
--
-- Additive and idempotent. Rollback:
--   drop trigger if exists motorpool_records_stale_guard on public.motorpool_records;
--   drop function if exists public.motorpool_records_stale_guard();

create or replace function public.motorpool_vrf_status_protected(p text)
returns boolean language sql immutable as $$
  select lower(trim(coalesce(p, ''))) in
    ('approved', 'open', 'closed', 'cancelled', 'canceled', 'not bought', 'duplicate');
$$;

create or replace function public.motorpool_vrf_status_draftish(p text)
returns boolean language sql immutable as $$
  select lower(trim(coalesce(p, ''))) in
    ('', 'requested', 'draft', 'pending', 'for approval', 'sent for approval', 'held');
$$;

create or replace function public.motorpool_records_stale_guard()
returns trigger
language plpgsql
as $$
declare
  old_rev bigint := coalesce(nullif(old.data->>'rev', '')::bigint, 0);
  new_rev bigint := coalesce(nullif(new.data->>'rev', '')::bigint, 0);
  bypass boolean := coalesce(current_setting('motorpool.allow_status_downgrade', true), '') = 'on';
  old_led text;
  hit boolean;
begin
  if new.kind not in ('reserve', 'ledger') then
    return new;
  end if;

  if not bypass then
    if new.kind = 'reserve' then
      if public.motorpool_vrf_status_protected(old.data->>'status')
         and public.motorpool_vrf_status_draftish(new.data->>'status') then
        raise exception 'vrf_changed_elsewhere: VRF % is % and cannot go back to %. Reload the page.',
          coalesce(new.vrf_no, ''), old.data->>'status', coalesce(new.data->>'status', '(blank)')
          using errcode = 'P0409';
      end if;
    else
      select r->>'vstatus' into old_led
        from jsonb_array_elements(coalesce(old.data->'rows', '[]'::jsonb)) r
       where public.motorpool_vrf_status_protected(r->>'vstatus')
       limit 1;
      if old_led is not null then
        select exists (
          select 1 from jsonb_array_elements(coalesce(new.data->'rows', '[]'::jsonb)) r
           where coalesce(r->>'vstatus', '') <> ''
             and public.motorpool_vrf_status_draftish(r->>'vstatus')
        ) into hit;
        if hit then
          raise exception 'vrf_changed_elsewhere: VRF % is % and cannot go back to Requested. Reload the page.',
            coalesce(new.vrf_no, ''), old_led
            using errcode = 'P0409';
        end if;
      end if;
    end if;
  end if;

  -- Revision compare-and-set.
  if new_rev = 0 or new_rev = old_rev then
    new.data := jsonb_set(new.data, '{rev}', to_jsonb(old_rev + 1), true);
  elsif new_rev < old_rev then
    raise exception 'vrf_changed_elsewhere: record % is at revision %, this save was based on %. Reload the page.',
      new.id, old_rev, new_rev
      using errcode = 'P0409';
  end if;
  return new;
end;
$$;

do $trg$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'motorpool_records_stale_guard'
  ) then
    create trigger motorpool_records_stale_guard
      before update on public.motorpool_records
      for each row execute function public.motorpool_records_stale_guard();
  end if;
end
$trg$;
