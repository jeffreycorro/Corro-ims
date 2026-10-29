-- Unique company-memorandum numbers on memos.
--
-- Apply in the Supabase SQL editor for the HR project
-- (kfflyzprxcidmsdjhuej — Site settings env SUPABASE_URL), AFTER this
-- build is deployed. The portal already refuses a second memo with the
-- same C.M. year and sequence. This index is what stops two saves that
-- arrive at the same moment.
--
-- "C.M. 2026 - 15", "C.M. 2026-15" and "CM 2026 - 015" are one number.
-- A blank number is not indexed. Existing memo rows are not rewritten.
--
-- Safe to run on 2026-10-29: every stored memo number is unique under
-- this key (highest is C.M. 2026 - 29). The document register is not
-- indexed here — two draft register rows already share C.M. 2026 - 22
-- for the same memo, and this file does not delete or renumber them.
-- CREATE UNIQUE INDEX fails if two memos later share a normalised number;
-- clear that duplicate in the portal first, then run this again.

create unique index if not exists docs_memos_cm_no_uidx
  on public.docs (
    (
      (regexp_match(
        upper(regexp_replace(coalesce(data->>'no', ''), '[^A-Za-z0-9]', '', 'g')),
        '^CM((?:19|20)[0-9]{2})0*([0-9]{1,6})$'
      ))[1]
      || '|' ||
      ((regexp_match(
        upper(regexp_replace(coalesce(data->>'no', ''), '[^A-Za-z0-9]', '', 'g')),
        '^CM((?:19|20)[0-9]{2})0*([0-9]{1,6})$'
      ))[2])::int::text
    )
  )
  where collection = 'memos'
    and coalesce(data->>'no', '') <> ''
    and upper(regexp_replace(coalesce(data->>'no', ''), '[^A-Za-z0-9]', '', 'g'))
        ~ '^CM(?:19|20)[0-9]{2}[0-9]+$';
