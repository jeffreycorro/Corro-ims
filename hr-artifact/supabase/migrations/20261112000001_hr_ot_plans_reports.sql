-- CorConDev HR — allow Afternoon OT Plans and Morning OT Reports
-- Run this in the Supabase SQL editor for the HR project (the same project
-- as SUPABASE_URL on the corcondev-hr Netlify site). It is additive: it only
-- inserts two collection names. It does not change or delete existing rows,
-- payroll, attendance, or old OT requests.
--
-- The portal writes one document per Afternoon OT Plan (collection "otplans")
-- and one per Morning OT Report (collection "otreps"). docs.collection
-- references hr_allowed_collections, so those saves are rejected until these
-- names exist. Old OT requests stay in "otreqs" and are not rewritten.

insert into public.hr_allowed_collections (name)
values
  ('otplans'),
  ('otreps')
on conflict (name) do nothing;
