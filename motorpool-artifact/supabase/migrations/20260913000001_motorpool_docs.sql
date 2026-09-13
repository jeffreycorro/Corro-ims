-- CorConDev Motorpool artifact document store
-- Apply in the Supabase SQL editor of the project used by the Motorpool Netlify site.
-- Separate tables from HR so the same Supabase project can host both sites.
--
-- Timestamps are timestamptz (stored in UTC). Display in Asia/Manila (UTC+8).
-- RLS: no anonymous read. The Netlify functions use SUPABASE_SERVICE_ROLE
-- after checking the optional gate cookie — the browser never holds the key.

create extension if not exists "pgcrypto";

create table if not exists public.motorpool_allowed_collections (
  name text primary key
);

insert into public.motorpool_allowed_collections (name)
values
  ('master'),
  ('ledger'),
  ('ops'),
  ('reserves'),
  ('fuel'),
  ('photos'),
  ('config')
on conflict (name) do nothing;

create table if not exists public.motorpool_docs (
  collection text not null references public.motorpool_allowed_collections (name),
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (collection, id)
);

create index if not exists motorpool_docs_collection_updated_at_idx
  on public.motorpool_docs (collection, updated_at desc);

create table if not exists public.motorpool_locks (
  collection text not null references public.motorpool_allowed_collections (name),
  id text not null,
  holder text not null,
  acquired_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  primary key (collection, id)
);

create or replace function public.motorpool_docs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists motorpool_docs_set_updated_at on public.motorpool_docs;
create trigger motorpool_docs_set_updated_at
before update on public.motorpool_docs
for each row
execute procedure public.motorpool_docs_set_updated_at();

create or replace function public.acquire_motorpool_doc_lock(
  p_collection text,
  p_id text,
  p_holder text,
  p_ttl_seconds integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ttl integer;
  now_ts timestamptz;
  new_exp timestamptz;
  taken public.motorpool_locks%rowtype;
  current_row public.motorpool_locks%rowtype;
begin
  if p_collection is null or p_id is null or p_holder is null
     or length(trim(p_holder)) = 0 then
    raise exception 'collection, id, and holder are required';
  end if;

  if not exists (
    select 1 from public.motorpool_allowed_collections where name = p_collection
  ) then
    raise exception 'collection not allowed: %', p_collection;
  end if;

  ttl := coalesce(p_ttl_seconds, 20);
  if ttl < 5 then
    ttl := 5;
  end if;
  if ttl > 300 then
    ttl := 300;
  end if;

  now_ts := timezone('utc', now());
  new_exp := now_ts + make_interval(secs => ttl);

  insert into public.motorpool_locks as l (collection, id, holder, acquired_at, expires_at)
  values (p_collection, p_id, trim(p_holder), now_ts, new_exp)
  on conflict (collection, id) do update
    set holder = excluded.holder,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where l.expires_at <= timezone('utc', now())
       or l.holder = excluded.holder
  returning * into taken;

  if found then
    return jsonb_build_object(
      'acquired', true,
      'holder', taken.holder,
      'expires_at', taken.expires_at
    );
  end if;

  select * into current_row
  from public.motorpool_locks
  where collection = p_collection and id = p_id;

  return jsonb_build_object(
    'acquired', false,
    'holder', current_row.holder,
    'expires_at', current_row.expires_at
  );
end;
$$;

revoke all on function public.acquire_motorpool_doc_lock(text, text, text, integer) from public;
revoke all on function public.acquire_motorpool_doc_lock(text, text, text, integer) from anon;
grant execute on function public.acquire_motorpool_doc_lock(text, text, text, integer) to authenticated;
grant execute on function public.acquire_motorpool_doc_lock(text, text, text, integer) to service_role;

alter table public.motorpool_allowed_collections enable row level security;
alter table public.motorpool_docs enable row level security;
alter table public.motorpool_locks enable row level security;

revoke all on table public.motorpool_allowed_collections from public, anon;
revoke all on table public.motorpool_docs from public, anon;
revoke all on table public.motorpool_locks from public, anon;

grant select on table public.motorpool_allowed_collections to authenticated;
grant select, insert, update, delete on table public.motorpool_docs to authenticated;
grant select, insert, update, delete on table public.motorpool_locks to authenticated;

drop policy if exists "authenticated read mp collections" on public.motorpool_allowed_collections;
create policy "authenticated read mp collections"
on public.motorpool_allowed_collections
for select
to authenticated
using (true);

drop policy if exists "authenticated select mp docs" on public.motorpool_docs;
drop policy if exists "authenticated insert mp docs" on public.motorpool_docs;
drop policy if exists "authenticated update mp docs" on public.motorpool_docs;
drop policy if exists "authenticated delete mp docs" on public.motorpool_docs;

create policy "authenticated select mp docs"
on public.motorpool_docs for select to authenticated using (true);

create policy "authenticated insert mp docs"
on public.motorpool_docs for insert to authenticated with check (true);

create policy "authenticated update mp docs"
on public.motorpool_docs for update to authenticated using (true) with check (true);

create policy "authenticated delete mp docs"
on public.motorpool_docs for delete to authenticated using (true);

drop policy if exists "authenticated select mp locks" on public.motorpool_locks;
drop policy if exists "authenticated insert mp locks" on public.motorpool_locks;
drop policy if exists "authenticated update mp locks" on public.motorpool_locks;
drop policy if exists "authenticated delete mp locks" on public.motorpool_locks;

create policy "authenticated select mp locks"
on public.motorpool_locks for select to authenticated using (true);

create policy "authenticated insert mp locks"
on public.motorpool_locks for insert to authenticated with check (true);

create policy "authenticated update mp locks"
on public.motorpool_locks for update to authenticated using (true) with check (true);

create policy "authenticated delete mp locks"
on public.motorpool_locks for delete to authenticated using (true);
