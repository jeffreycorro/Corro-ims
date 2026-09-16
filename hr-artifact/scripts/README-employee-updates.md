# Employee status + contribution apply (2026-09-16)

The Claude artifact’s local database is **not** the Netlify / Supabase store. These files mark people Separated and write per-head statutory deductions onto the live `docs` rows (`collection = 'employees'`).

**This never deletes a row.** Past reports and payroll periods keep the people.

## Payloads

| File | Rows | What it writes |
| --- | --- | --- |
| `data/separated-roster-2026-09-16.json` | 67 listings / 66 unique `empNo` | `status` exactly `Separated`, plus `separatedOn` / `separationReason` when present |
| `data/contributions-2026-09-16.json` | 33 | whole `ded` object `{sss, phic, hdmf}` **including zeros** |

Match on `data.empNo` (string). `1351` Pasion, Ben is listed twice because **two** employee rows share that number — both must be updated.

A missing `ded` falls back to the company default (`settings.ded`) and over-deducts. Zeros are intentional.

## Run against production (Jeffrey)

From a machine that can reach the HR Supabase project (same as site **corcondev-hr**):

```bash
cd hr-artifact
export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
export SUPABASE_SERVICE_ROLE="YOUR-SERVICE-ROLE"   # Functions secret; never commit
node scripts/apply-employee-updates.js              # dry-run: print matches
node scripts/apply-employee-updates.js --apply      # write; no deletes
```

Expect:

- Roster unique empNo **66**, including **two** rows for `1351`
- Contribution matches **33** (or fewer if a number is missing — the script lists misses)
- Exit `2` if those env vars are unset (cloud agents usually cannot apply)

## SQL alternative

`sql/apply-employee-updates-2026-09-16.sql` is the same patches as `UPDATE … SET data = data || …`. Paste it in the Supabase SQL editor if you prefer not to use Node. It still never `DELETE`s.

## After apply

1. Hard-refresh HR (or Sign out / Sign in).
2. Daily Manpower standing list should drop the 66 unique Separated numbers.
3. Payroll Maker should use the written `ded` (including `0`) instead of company defaults for those 33 people.
