-- Liquidation proof guard for motorpool_records (2026-11-02).
-- MANUAL STEP: apply in the Supabase SQL editor (project kfflyzprxcidmsdjhuej)
-- after review, after PR #146 is deployed. This file was NOT run against
-- production by the PR.
--
-- A VRF cannot be set Liquidated (a ledger line going to vstatus 'Closed'
-- with a bought outcome) unless the line carries liq.proof with:
--   actual (> 0, equals the closed lines), date (not in the future, Manila),
--   by; and evidence in motorpool_docs:
--     non-fuel VRF: >= 1 receipt / OR  (photos vrf-LIQ-<vrf>__*, or a VRF
--                   photo with role 'receipt' / caption 'receipt')
--     fuel reserve VRF (every line FUEL-RES / supplier FUEL RESERVE):
--                   >= 1 after-fueling gauge photo on vrf-<vrf>__* (role
--                   'fuel-gauge-after', or a caption with "gauge" and "after"),
--                   and liq.proof.fuel.withdrawal pointing at a fuel/withdrawals
--                   row whose liters equal the VRF liters (+/- 0.01).
--                   The withdrawal slip is optional.
--   actual < approved: proof.change {amount = approved - actual, how, date}
--   actual > approved: proof.overReason
-- A reserve row may move to Closed / Flagged only when every VRF on it is
-- already closed (or cancelled / not bought / duplicate) on the ledger.
--
-- Exempt: rows that were already Liquidated (the stored ledger record already
-- has a Closed line, or the stored reserve is already Closed / Flagged), and
-- cancelled / not-bought / duplicate closes. Existing data is not touched.
--
-- Escape hatch for a deliberate admin fix, inside one transaction:
--   set local motorpool.allow_liquidate_without_proof = 'on';
--
-- Additive and idempotent. Rollback:
--   drop trigger if exists motorpool_records_liquidation_proof on public.motorpool_records;
--   drop function if exists public.motorpool_records_liquidation_proof();
--   drop function if exists public.motorpool_liq_evidence(text, boolean);

create or replace function public.motorpool_liq_evidence(p_vrf text, p_fuel boolean)
returns integer
language sql
stable
as $$
  select count(*)::integer
    from public.motorpool_docs d
   where d.collection = 'photos'
     and (
       (not p_fuel
         and ((d.id >= 'vrf-LIQ-' || p_vrf || '__' and d.id < 'vrf-LIQ-' || p_vrf || '_~')
              or (d.id >= 'vrf-' || p_vrf || '__' and d.id < 'vrf-' || p_vrf || '_~'
                  and (lower(coalesce(d.data->>'role', '')) in ('receipt', 'or')
                       or coalesce(d.data->>'caption', '') ~* '(\mreceipt\M|official receipt)'))))
       or (p_fuel
         and d.id >= 'vrf-' || p_vrf || '__' and d.id < 'vrf-' || p_vrf || '_~'
         and (lower(coalesce(d.data->>'role', '')) in ('fuel-gauge-after', 'gauge-after')
              or (coalesce(d.data->>'caption', '') ~* 'gauge'
                  and coalesce(d.data->>'caption', '') ~* 'after')))
     );
$$;

create or replace function public.motorpool_records_liquidation_proof()
returns trigger
language plpgsql
as $$
declare
  bypass boolean := coalesce(current_setting('motorpool.allow_liquidate_without_proof', true), '') = 'on';
  prev jsonb;
  vrf text;
  proof jsonb;
  is_fuel boolean;
  actual numeric;
  lines_total numeric;
  approved numeric;
  litres numeric;
  w jsonb;
  w_idx integer;
  today date := (now() at time zone 'Asia/Manila')::date;
  open_vrf text;
begin
  if bypass or new.kind not in ('ledger', 'reserve') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    prev := old.data;
  else
    /* PostgREST upserts (on_conflict) fire BEFORE INSERT first. */
    select r.data into prev from public.motorpool_records r where r.id = new.id;
  end if;

  if new.kind = 'reserve' then
    if lower(coalesce(new.data->>'status', '')) not in ('closed', 'flagged')
       or coalesce(new.data->>'liquidatedAt', '') = ''
       or lower(coalesce(prev->>'status', '')) in ('closed', 'flagged') then
      return new;
    end if;
    select v into open_vrf
      from (
        select distinct x as v
          from jsonb_array_elements_text(coalesce(new.data->'vrfs', '[]'::jsonb)) x
        union
        select new.data->>'vrfNo' where coalesce(new.data->>'vrfNo', '') <> ''
      ) s
     where not exists (
       select 1 from public.motorpool_records l
        where l.id = 'ledger:' || s.v
          and jsonb_array_length(coalesce(l.data->'rows', '[]'::jsonb)) > 0
          and not exists (
            select 1 from jsonb_array_elements(l.data->'rows') rr
             where coalesce(rr->>'vstatus', '') = 'Open'))
     limit 1;
    if open_vrf is not null then
      raise exception 'liquidation_proof_required: liquidate VRF % with its receipts before closing RSV-%.',
        open_vrf, coalesce(new.data->>'no', new.reserve_no, '') using errcode = 'P0422';
    end if;
    return new;
  end if;

  /* ledger: only a transition into Liquidated is checked */
  if exists (select 1 from jsonb_array_elements(coalesce(prev->'rows', '[]'::jsonb)) r
              where r->>'vstatus' = 'Closed') then
    return new;
  end if;
  select r->'liq'->'proof' into proof
    from jsonb_array_elements(coalesce(new.data->'rows', '[]'::jsonb)) r
   where r->>'vstatus' = 'Closed'
     and coalesce((r->>'notBought')::boolean, false) = false
     and lower(coalesce(r->'liq'->>'outcome', 'bought')) not in ('cancelled', 'canceled', 'not-bought', 'duplicate')
   limit 1;
  if not found then
    return new;
  end if;

  vrf := coalesce(nullif(new.vrf_no, ''), new.data->>'vrf', regexp_replace(new.id, '^ledger:', ''));
  if proof is null or coalesce(proof->>'by', '') = '' or coalesce(proof->>'date', '') = ''
     or coalesce(nullif(proof->>'actual', '')::numeric, 0) <= 0 then
    raise exception 'liquidation_proof_required: VRF % needs the actual amount, date, receipt and who liquidated it.', vrf
      using errcode = 'P0422';
  end if;
  if (proof->>'date')::date > today then
    raise exception 'liquidation_proof_required: VRF % liquidation date is in the future.', vrf using errcode = 'P0422';
  end if;

  actual := (proof->>'actual')::numeric;
  select coalesce(sum(case when coalesce((r->>'notBought')::boolean, false) then 0
                           when coalesce(r->>'total', '') <> '' then (r->>'total')::numeric
                           else coalesce(nullif(r->>'qty', '')::numeric, 0) * coalesce(nullif(r->>'price', '')::numeric, 0) end), 0),
         bool_and(r->>'work' = 'FUEL-RES' or upper(coalesce(r->>'supplier', '')) = 'FUEL RESERVE'),
         coalesce(sum(case when coalesce((r->>'notBought')::boolean, false) then 0
                           when coalesce(r->>'liters', '') <> '' then (r->>'liters')::numeric
                           when lower(coalesce(r->>'unit', '')) ~ '^l(iters?|itres?)?$' then coalesce(nullif(r->>'qty', '')::numeric, 0)
                           else 0 end), 0)
    into lines_total, is_fuel, litres
    from jsonb_array_elements(coalesce(new.data->'rows', '[]'::jsonb)) r
   where coalesce(r->>'vrf', vrf) = vrf;
  is_fuel := coalesce(is_fuel, false);
  if abs(actual - lines_total) > 0.01 then
    raise exception 'liquidation_proof_required: VRF % actual % does not match the closed lines %.', vrf, actual, lines_total
      using errcode = 'P0422';
  end if;

  if public.motorpool_liq_evidence(vrf, is_fuel) < 1 then
    raise exception 'liquidation_proof_required: VRF % needs %.', vrf,
      case when is_fuel then 'the after-fueling gauge photo' else 'at least one receipt / OR' end
      using errcode = 'P0422';
  end if;

  if is_fuel then
    w_idx := nullif(split_part(coalesce(proof->'fuel'->'withdrawal'->>'ref', ''), '|', 5), '')::integer;
    select d.data->'rows'->w_idx into w
      from public.motorpool_docs d where d.collection = 'fuel' and d.id = 'withdrawals';
    if w_idx is null or w is null
       or abs(coalesce(nullif(w->>'liters', '')::numeric, 0) - litres) > 0.01 then
      raise exception 'liquidation_proof_required: VRF % needs the matching reserve withdrawal row (% L).', vrf, litres
        using errcode = 'P0422';
    end if;
  end if;

  /* Approved: the reserve budget when the reserve carries only this VRF. */
  select case when jsonb_array_length(coalesce(r.data->'vrfs', '[]'::jsonb)) <= 1
              then coalesce(nullif(r.data->>'approvedBudget', ''), nullif(r.data->>'budget', ''))::numeric end
    into approved
    from public.motorpool_records r
   where new.reserve_no is not null and r.id = 'reserve:' || new.reserve_no;
  approved := coalesce(approved, nullif(proof->>'approved', '')::numeric, 0);
  if approved > 0 and actual + 0.005 < approved then
    if abs(coalesce(nullif(proof->'change'->>'amount', '')::numeric, 0) - (approved - actual)) > 0.005
       or coalesce(proof->'change'->>'how', '') = ''
       or coalesce(proof->'change'->>'date', '') = '' then
      raise exception 'liquidation_proof_required: VRF % spent % of %; record the change returned (%), how and when.',
        vrf, actual, approved, approved - actual using errcode = 'P0422';
    end if;
  elsif approved > 0 and actual > approved + 0.005 then
    if length(trim(coalesce(proof->>'overReason', ''))) < 5 then
      raise exception 'liquidation_proof_required: VRF % spent % over the approved %; give the reason.', vrf, actual, approved
        using errcode = 'P0422';
    end if;
  end if;
  return new;
end;
$$;

do $trg$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'motorpool_records_liquidation_proof'
       and tgrelid = 'public.motorpool_records'::regclass
  ) then
    create trigger motorpool_records_liquidation_proof
      before insert or update on public.motorpool_records
      for each row execute function public.motorpool_records_liquidation_proof();
  end if;
end
$trg$;
