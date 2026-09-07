-- CorConDev HR artifact document store
-- Apply in the Supabase SQL editor of the project used by the HR Netlify site
-- (Site settings env: SUPABASE_URL). May be the same project as the company
-- portal or a dedicated HR project.
--
-- Timestamps are timestamptz (stored in UTC). Display in Asia/Manila (UTC+8).
-- RLS: no anonymous read. Authenticated role only. The Netlify functions use
-- SUPABASE_SERVICE_ROLE after checking the gate cookie / Auth session — the
-- browser never holds the service role key.

create extension if not exists "pgcrypto";

create table if not exists public.hr_allowed_collections (
  name text primary key
);

insert into public.hr_allowed_collections (name)
values
  ('employees'),
  ('nte'),
  ('writeups'),
  ('tasks'),
  ('templates'),
  ('reminders'),
  ('memos'),
  ('resources'),
  ('onboarding'),
  ('series'),
  ('docreg'),
  ('applicants'),
  ('exams'),
  ('roles'),
  ('advances'),
  ('leaves'),
  ('projects'),
  ('incidents'),
  ('genfiles'),
  ('decisions'),
  ('daily'),
  ('filed'),
  ('compliance'),
  ('forms'),
  ('periods'),
  ('meta')
on conflict (name) do nothing;

create table if not exists public.docs (
  collection text not null references public.hr_allowed_collections (name),
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (collection, id)
);

create index if not exists docs_collection_updated_at_idx
  on public.docs (collection, updated_at desc);

create table if not exists public.locks (
  collection text not null references public.hr_allowed_collections (name),
  id text not null,
  holder text not null,
  acquired_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  primary key (collection, id)
);

create or replace function public.hr_docs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists docs_set_updated_at on public.docs;
create trigger docs_set_updated_at
before update on public.docs
for each row
execute procedure public.hr_docs_set_updated_at();

-- Atomic lock: never returns acquired=true when another holder still holds
-- an unexpired row. Same holder may refresh. Expired rows may be taken.
create or replace function public.acquire_doc_lock(
  p_collection text,
  p_id text,
  p_holder text,
  p_ttl_seconds integer default 45
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
  taken public.locks%rowtype;
  current_row public.locks%rowtype;
begin
  if p_collection is null or p_id is null or p_holder is null
     or length(trim(p_holder)) = 0 then
    raise exception 'collection, id, and holder are required';
  end if;

  if not exists (
    select 1 from public.hr_allowed_collections where name = p_collection
  ) then
    raise exception 'collection not allowed: %', p_collection;
  end if;

  ttl := coalesce(p_ttl_seconds, 45);
  if ttl < 5 then
    ttl := 5;
  end if;
  if ttl > 300 then
    ttl := 300;
  end if;

  now_ts := timezone('utc', now());
  new_exp := now_ts + make_interval(secs => ttl);

  insert into public.locks as l (collection, id, holder, acquired_at, expires_at)
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
  from public.locks
  where collection = p_collection and id = p_id;

  return jsonb_build_object(
    'acquired', false,
    'holder', current_row.holder,
    'expires_at', current_row.expires_at
  );
end;
$$;

revoke all on function public.acquire_doc_lock(text, text, text, integer) from public;
revoke all on function public.acquire_doc_lock(text, text, text, integer) from anon;
grant execute on function public.acquire_doc_lock(text, text, text, integer) to authenticated;
grant execute on function public.acquire_doc_lock(text, text, text, integer) to service_role;

alter table public.hr_allowed_collections enable row level security;
alter table public.docs enable row level security;
alter table public.locks enable row level security;

revoke all on table public.hr_allowed_collections from public, anon;
revoke all on table public.docs from public, anon;
revoke all on table public.locks from public, anon;

grant select on table public.hr_allowed_collections to authenticated;
grant select, insert, update, delete on table public.docs to authenticated;
grant select, insert, update, delete on table public.locks to authenticated;

drop policy if exists "anon denied collections" on public.hr_allowed_collections;
drop policy if exists "authenticated read collections" on public.hr_allowed_collections;
create policy "authenticated read collections"
on public.hr_allowed_collections
for select
to authenticated
using (true);

drop policy if exists "authenticated select docs" on public.docs;
drop policy if exists "authenticated insert docs" on public.docs;
drop policy if exists "authenticated update docs" on public.docs;
drop policy if exists "authenticated delete docs" on public.docs;

create policy "authenticated select docs"
on public.docs for select to authenticated using (true);

create policy "authenticated insert docs"
on public.docs for insert to authenticated with check (true);

create policy "authenticated update docs"
on public.docs for update to authenticated using (true) with check (true);

create policy "authenticated delete docs"
on public.docs for delete to authenticated using (true);

drop policy if exists "authenticated select locks" on public.locks;
drop policy if exists "authenticated insert locks" on public.locks;
drop policy if exists "authenticated update locks" on public.locks;
drop policy if exists "authenticated delete locks" on public.locks;

create policy "authenticated select locks"
on public.locks for select to authenticated using (true);

create policy "authenticated insert locks"
on public.locks for insert to authenticated with check (true);

create policy "authenticated update locks"
on public.locks for update to authenticated using (true) with check (true);

create policy "authenticated delete locks"
on public.locks for delete to authenticated using (true);

-- No policies for `anon`. With RLS enabled, anonymous reads/writes fail.
