-- Unique LRF / LV series numbers.
-- Apply in the Supabase SQL editor AFTER Jeffrey renumbers the live
-- LRF2026-0169 duplicate (Jaranilla → next free, Cartuciano keeps 0169).
-- CREATE UNIQUE INDEX fails while two leaves or two LV register rows
-- still share a normalised number.

create unique index if not exists docs_leaves_lrf_no_uidx
  on public.docs (
    (upper(regexp_replace(coalesce(data->>'no', ''), '[^a-zA-Z0-9]', '', 'g')))
  )
  where collection = 'leaves'
    and coalesce(data->>'no', '') <> '';

create unique index if not exists docs_docreg_lv_no_uidx
  on public.docs (
    (upper(regexp_replace(coalesce(data->>'no', ''), '[^a-zA-Z0-9]', '', 'g')))
  )
  where collection = 'docreg'
    and coalesce(data->>'seriesKey', '') = 'LV'
    and coalesce(data->>'no', '') <> '';
