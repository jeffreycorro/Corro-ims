-- Written reminders WR2026-01 .. WR2026-05
-- HR project kfflyzprxcidmsdjhuej, table public.docs.
--
-- Read this whole file before running anything.
-- The SELECT block is a dry run. It does not write.
-- The UPDATE block is commented out. Do not run it until Jeffrey approves
-- the listing below. It does not delete rows and it does not change an
-- existing RM number.
--
-- Listing recorded 2026-11-13 from read-only queries. Re-run the SELECT
-- block first; if the rows differ from this listing, stop.
--
-- What is stored today
-- -------------------
-- reminders rm_r0fkgukiayi
--   register RM2026-001, paperNo blank, empId e1355 (Senining, James C.)
--   date 2026-10-01, status Closed, subject FIRST REMINDER
--   No WR number is stored. Do not guess WR2026-02 or WR2026-03.
-- docreg d_yaqnmbctubj
--   RM2026-001, series RM, seq 1, ref rm_r0fkgukiayi, empId e1355
-- reminders rm_0hoicrsa4mx
--   register RM2026-002, paperNo blank, empId e1298 (Reyes, Teofilo N. JR.)
--   date 2026-10-23, status Issued
--   subject: first reminder to Teofilo Reyes Bearing  WR2026-04
-- docreg d_zaayouin44r
--   RM2026-002, series RM, seq 2, ref rm_0hoicrsa4mx, empId e1298
--   title same as the subject above
-- employees e1323 (Bernadez, Brinneshiel M.)
--   docs.darmemo.links includes
--   title WRITTEN REMINDER MEMORANDUM, WR2026 - 01.pdf
--   url   https://drive.google.com/file/d/14hgvzAEAZUkew8ktvqYYfe6x2J8xtP1z/view
--   filed on 2026-09-21, on the disciplinary-memo slot, not as a reminder row
--
-- Not in the database at all (no reminder, no register row, no checklist title):
--   WR2026-02, WR2026-03 (James Senining, 1 Oct — only one portal reminder exists)
--   WR2026-05 (Rio Raquiza, 26 Oct)
-- Those three have to be entered in the portal. This script cannot invent them.
--
-- The two stored register numbers are already unique. Nothing here renumbers
-- RM2026-001 or RM2026-002.

-- ========== DRY RUN (safe) ==========

select collection, id,
       data->>'no' as register_no,
       coalesce(data->>'paperNo', '') as paper_no,
       data->>'empId' as emp_id,
       data->>'date' as date,
       data->>'status' as status,
       left(coalesce(data->>'subject', data->>'title', ''), 120) as label
  from public.docs
 where collection = 'reminders'
    or (collection = 'docreg' and data->>'seriesKey' = 'RM')
 order by collection, data->>'no';

-- Checklist / linked-file titles that already say WR2026 or "written reminder".
select id as emp_id,
       data->>'name' as name,
       link->>'title' as title,
       link->>'url' as url
  from public.docs
  cross join lateral (
        select link
          from jsonb_each(coalesce(data->'docs', '{}'::jsonb)) as slot(key, value)
          cross join lateral (
                select value as link
                 where value->>'title' ~* 'WR\s*20[0-9]{2}|written reminder'
                union all
                select item
                  from jsonb_array_elements(coalesce(value->'links', '[]'::jsonb)) as item
                 where item->>'title' ~* 'WR\s*20[0-9]{2}|written reminder'
          ) hits
        union all
        select item
          from jsonb_array_elements(coalesce(data->'linkedDocs', '[]'::jsonb)) as item
         where item->>'title' ~* 'WR\s*20[0-9]{2}|written reminder'
  ) found(link)
 where collection = 'employees';

-- ========== WHAT WOULD CHANGE, if the commented block is run ==========
--
-- 1. reminders rm_0hoicrsa4mx
--      paperNo: (blank) -> WR2026-04
--      no stays RM2026-002. empId stays e1298. subject stays as written.
-- 2. docreg d_zaayouin44r
--      paperNo: (blank) -> WR2026-04
--      no stays RM2026-002.
-- 3. employees e1282 Largo, Catherine A.
--      linkedDocs append one object (the WR2026-01 scan already on Bernadez).
--      No checklist slot is overwritten. darmemo is not touched.
-- 4. employees e1241 Abadiano, Glory Mae M. — same append.
-- 5. employees e1256 Batas, Sophie V. — same append.
-- 6. employees e1291 Osorio, Jade M. — same append.
-- 7. employees e1323 Bernadez — no write. The scan is already on docs.darmemo.links.
-- 8. reminders rm_r0fkgukiayi / docreg d_yaqnmbctubj — no write.
-- 9. No insert for WR2026-02, WR2026-03, or WR2026-05.
--
-- After (3)–(6), each of those four 201 files shows WR2026-01 because the
-- portal lists a linked file whose title is a written reminder. It does not
-- create a second register number.

-- ========== APPROVAL REQUIRED. Leave this commented out. ==========
/*
update public.docs
   set data = jsonb_set(data, '{paperNo}', to_jsonb('WR2026-04'::text), true)
 where collection = 'reminders'
   and id = 'rm_0hoicrsa4mx'
   and data->>'no' = 'RM2026-002'
   and coalesce(data->>'paperNo', '') = ''
   and data->>'subject' ~* 'WR\s*2026\s*[-–]\s*0*4';

update public.docs
   set data = jsonb_set(data, '{paperNo}', to_jsonb('WR2026-04'::text), true)
 where collection = 'docreg'
   and id = 'd_zaayouin44r'
   and data->>'no' = 'RM2026-002'
   and data->>'seriesKey' = 'RM'
   and coalesce(data->>'paperNo', '') = '';

update public.docs
   set data = jsonb_set(
         data,
         '{linkedDocs}',
         coalesce(data->'linkedDocs', '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object(
             'title', 'WRITTEN REMINDER MEMORANDUM, WR2026 - 01.pdf',
             'url', 'https://drive.google.com/file/d/14hgvzAEAZUkew8ktvqYYfe6x2J8xtP1z/view',
             'added', '2026-09-21',
             'note', 'Same scan already filed on Bernadez (e1323). Shows WR2026-01 on this 201.'
           )
         ),
         true
       )
 where collection = 'employees'
   and id in ('e1282', 'e1241', 'e1256', 'e1291')
   and data::text not like '%14hgvzAEAZUkew8ktvqYYfe6x2J8xtP1z%';
*/

-- Optional, also not run: unique register numbers on reminder rows.
-- Safe against today's data (RM2026-001 and RM2026-002 only). Fails if two
-- reminder rows later share one RM year+sequence. Does not rewrite rows.
/*
create unique index if not exists docs_reminders_rm_no_uidx
  on public.docs (
    (
      (regexp_match(
        upper(regexp_replace(coalesce(data->>'no', ''), '[^A-Za-z0-9]', '', 'g')),
        '^RM((?:19|20)[0-9]{2})0*([0-9]{1,6})$'
      ))[1]
      || '|' ||
      ((regexp_match(
        upper(regexp_replace(coalesce(data->>'no', ''), '[^A-Za-z0-9]', '', 'g')),
        '^RM((?:19|20)[0-9]{2})0*([0-9]{1,6})$'
      ))[2])::int::text
    )
  )
  where collection = 'reminders'
    and coalesce(data->>'no', '') <> ''
    and upper(regexp_replace(coalesce(data->>'no', ''), '[^A-Za-z0-9]', '', 'g'))
        ~ '^RM(?:19|20)[0-9]{2}[0-9]+$';
*/
