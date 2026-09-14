-- Allow the artifact's newer-version banner to read/write builds/{BUILD}.
-- Apply in the same Supabase project as 20260913000001_motorpool_docs.sql.

insert into public.motorpool_allowed_collections (name)
values ('builds')
on conflict (name) do nothing;
