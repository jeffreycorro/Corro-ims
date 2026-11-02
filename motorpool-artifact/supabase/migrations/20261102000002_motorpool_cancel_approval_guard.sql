-- Motorpool: no Cancelled VRF or line without an approved cancellation request.
-- (PR #145, Jeffrey 2026-11-02: "add a cancel request button for staff to
--  request and we approve any cancellation".)
--
-- Rules enforced on public.motorpool_records (BEFORE INSERT OR UPDATE):
--   1. kind 'ledger': a row in data.rows that newly gets vstatus 'Cancelled'
--      needs an Approved request (decidedBy + decidedAt set) for this VRF in
--      the stored reserve record ('reserve:' || reserve_no), with scope 'vrf'
--      or lines[] containing the 0-based row index.
--   2. kind 'reserve': data.status newly 'Cancelled' with cancelOutcome other
--      than 'not-bought' / 'duplicate' needs an Approved request in the
--      reserve's own data.cancelRequests.
--   3. kind 'reserve': a decided request (Approved / Rejected) cannot be
--      removed, nor its status / decidedBy / decidedAt changed.
-- The Netlify functions apply the same rules in netlify/lib/cancel-guard.js,
-- and also check WHO decides (approver). This trigger cannot know the person.
--
-- Admin repair bypass (one transaction only):
--   begin;
--   set local motorpool.allow_cancel_without_approval = 'on';
--   update public.motorpool_records ... ;
--   commit;
--
-- Deploy order: after 20261101000001 (PR #144 stale-save guard). Independent
-- of 20261102000001 (PR #146/#147 liquidation proof). Trigger names fire in
-- alphabetical order; this one runs first and only reads/raises.
--
-- Rollback:
--   drop trigger if exists motorpool_records_cancel_approval on public.motorpool_records;
--   drop function if exists public.motorpool_records_cancel_approval();
--   drop function if exists public.motorpool_cancel_approved(jsonb, text, int);

create or replace function public.motorpool_cancel_approved(reqs jsonb, vrf text, line_idx int)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(reqs) = 'array' then reqs else '[]'::jsonb end) q
    where q->>'status' = 'Approved'
      and coalesce(q->>'decidedBy', '') <> ''
      and coalesce(q->>'decidedAt', '') <> ''
      and (vrf is null or q->>'vrf' = vrf)
      and (
        q->>'scope' = 'vrf'
        or (vrf is null and line_idx is null)
        or jsonb_typeof(q->'lines') is distinct from 'array'
        or (line_idx is not null and q->'lines' @> to_jsonb(line_idx))
      )
  );
$$;

create or replace function public.motorpool_records_cancel_approval()
returns trigger
language plpgsql
as $$
declare
  rsv_reqs jsonb;
  i int;
  n int;
  old_rows jsonb;
  new_rows jsonb;
  q jsonb;
  nq jsonb;
  vrfs jsonb;
begin
  if coalesce(current_setting('motorpool.allow_cancel_without_approval', true), '') = 'on' then
    return new;
  end if;

  if new.kind = 'ledger' then
    new_rows := coalesce(new.data->'rows', '[]'::jsonb);
    if jsonb_typeof(new_rows) <> 'array' then return new; end if;
    old_rows := case when tg_op = 'UPDATE' then coalesce(old.data->'rows', '[]'::jsonb) else '[]'::jsonb end;
    if jsonb_typeof(old_rows) <> 'array' then old_rows := '[]'::jsonb; end if;
    n := jsonb_array_length(new_rows);
    for i in 0 .. n - 1 loop
      if new_rows->i->>'vstatus' = 'Cancelled'
         and coalesce(old_rows->i->>'vstatus', '') <> 'Cancelled' then
        if rsv_reqs is null then
          select r.data->'cancelRequests' into rsv_reqs
            from public.motorpool_records r
           where r.id = 'reserve:' || coalesce(new.reserve_no, new_rows->i->>'reserve', '');
          rsv_reqs := coalesce(rsv_reqs, '[]'::jsonb);
        end if;
        if not public.motorpool_cancel_approved(rsv_reqs, coalesce(new.vrf_no, new.data->>'vrf'), i) then
          raise exception 'VRF % line % cannot be set Cancelled without an approved cancellation request',
            coalesce(new.vrf_no, new.data->>'vrf'), i + 1
            using errcode = 'P0001', hint = 'cancel_approval_required';
        end if;
      end if;
    end loop;
    return new;
  end if;

  if new.kind = 'reserve' then
    -- Rule 3: decided requests are final.
    if tg_op = 'UPDATE' and jsonb_typeof(old.data->'cancelRequests') = 'array' then
      for q in select * from jsonb_array_elements(old.data->'cancelRequests') loop
        if coalesce(q->>'status', 'Requested') <> 'Requested' then
          select x into nq
            from jsonb_array_elements(case when jsonb_typeof(new.data->'cancelRequests') = 'array'
                                           then new.data->'cancelRequests' else '[]'::jsonb end) x
           where x->>'id' = q->>'id'
           limit 1;
          if nq is null
             or nq->>'status' is distinct from q->>'status'
             or nq->>'decidedBy' is distinct from q->>'decidedBy'
             or nq->>'decidedAt' is distinct from q->>'decidedAt' then
            raise exception 'Cancellation request % was already decided and cannot be changed', q->>'id'
              using errcode = 'P0001', hint = 'cancel_approval_required';
          end if;
        end if;
      end loop;
    end if;
    -- Rule 2.
    if new.data->>'status' = 'Cancelled'
       and coalesce(new.data->>'cancelOutcome', '') not in ('not-bought', 'duplicate')
       and (tg_op = 'INSERT' or coalesce(old.data->>'status', '') <> 'Cancelled') then
      if not public.motorpool_cancel_approved(new.data->'cancelRequests', null, null) then
        raise exception 'RSV-% cannot be set Cancelled without an approved cancellation request', new.reserve_no
          using errcode = 'P0001', hint = 'cancel_approval_required';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists motorpool_records_cancel_approval on public.motorpool_records;
create trigger motorpool_records_cancel_approval
  before insert or update on public.motorpool_records
  for each row execute function public.motorpool_records_cancel_approval();
