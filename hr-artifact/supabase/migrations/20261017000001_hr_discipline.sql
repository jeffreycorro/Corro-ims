-- CorConDev HR — allow saved disciplinary actions
-- Run this in the Supabase SQL editor for the HR project (the same project
-- as SUPABASE_URL on the corcondev-hr Netlify site). It is additive: it only
-- inserts one collection name. It does not change or delete existing rows.
--
-- The portal writes one document per implemented disciplinary action
-- (collection "discipline"): written reprimand, suspension, or termination.
-- docs.collection references hr_allowed_collections, so those saves are
-- rejected until this name exists. Notices to explain, write-ups, and memos
-- stay in their own collections.
-- After this runs, the next time HR opens the portal an action still stored
-- only in that browser is copied up.

insert into public.hr_allowed_collections (name)
values
  ('discipline')
on conflict (name) do nothing;
