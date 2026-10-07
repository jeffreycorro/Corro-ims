-- CorConDev HR — allow OT requests and saved payroll runs
-- Run this in the Supabase SQL editor for the HR project (the same project
-- as SUPABASE_URL on the corcondev-hr Netlify site). It is additive: it only
-- inserts two collection names. It does not change or delete existing rows.
--
-- The portal writes one document per OT request (collection "otreqs") and one
-- per saved payroll run (collection "payruns"). docs.collection references
-- hr_allowed_collections, so those saves were rejected until these names exist.
-- After this runs, the next time HR opens the portal the OT requests still
-- stored in that browser are copied up. A form that was already stripped from
-- the browser copy cannot be rebuilt from here — there is no file byte in
-- this table until a request is saved again.

insert into public.hr_allowed_collections (name)
values
  ('payruns'),
  ('otreqs')
on conflict (name) do nothing;
