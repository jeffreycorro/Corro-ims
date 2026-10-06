-- OT requests and saved payroll runs.
-- The portal writes otreqs/<id> and payruns/<id>. Those names were not in
-- hr_allowed_collections, and docs.collection references that table, so every
-- save was rejected. The rows never landed. Copies stayed in the browser that
-- filed them, and a later refresh could drop the attached file.
--
-- This insert only adds the two names. It does not update or delete any
-- document. Apply in the Supabase SQL editor for the HR project, then deploy
-- the portal build that writes these collections.

insert into public.hr_allowed_collections (name)
values
  ('otreqs'),
  ('payruns')
on conflict (name) do nothing;
