# Applicants bulk ingest

Guarded batch API for posting job applicants into the CorConDev HR recruitment pipeline (`applicants` collection). Built for the GoDaddy Apps Extractor agent — and for HR staff signed into the site.

Live site: [https://corcondev-hr.netlify.app](https://corcondev-hr.netlify.app)

Do **not** put real secrets in this repo or in extractor prompts that get committed.

## URL

```
POST https://corcondev-hr.netlify.app/.netlify/functions/applicants-ingest
```

Same path locally: `/.netlify/functions/applicants-ingest`.

Max **100** applicants per request. Send another request for the next page.

## Auth

Use **one** of:

| Who | How |
| --- | --- |
| HR staff (browser) | Existing `hr_session` cookie after portal / HR login |
| Extractor bot | Header `X-HR-Ingest-Key: <key>` **or** `Authorization: Bearer <key>` |

The key is the Netlify env var `HR_APPLICANTS_INGEST_KEY` on site **corcondev-hr**. There is no default in code. Unauthenticated or wrong key → **401**.

## Operator steps (Jeffrey / Netlify)

1. Open Netlify → site **corcondev-hr** → Site configuration → Environment variables.
2. Add `HR_APPLICANTS_INGEST_KEY`. Generate a long random value, e.g. `openssl rand -hex 32`.
3. Scope it to **Functions** + **Production** (not Builds-only). Never commit the value. Keep it — this key is small (~80 B) and is required for the extractor after the Google SA JSON is moved off Functions. See `docs/netlify-functions-env.md`.
4. **Redeploy** the site so functions reload env.
5. Give the key to Jeffrey out of band (password manager / chat). Not git, not this file.
6. If the key leaks, rotate it on Netlify, redeploy, and update the extractor.

## Example curl

```bash
curl -sS -X POST 'https://corcondev-hr.netlify.app/.netlify/functions/applicants-ingest' \
  -H 'Content-Type: application/json' \
  -H "X-HR-Ingest-Key: ${HR_APPLICANTS_INGEST_KEY}" \
  -d '{
    "applicants": [
      {
        "name": "Dela Cruz, Juan",
        "email": "juan@example.com",
        "mobile": "0917 000 0000",
        "roleId": "ro02",
        "resumeLink": "https://drive.google.com/file/d/FILE_ID/view",
        "notes": "From GoDaddy Apps inbox",
        "source": "GoDaddy",
        "education": "BS Civil Engineering",
        "years": "5 years",
        "expected": "₱1,200/day"
      }
    ]
  }'
```

Bearer form (same key):

```bash
curl -sS -X POST 'https://corcondev-hr.netlify.app/.netlify/functions/applicants-ingest' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${HR_APPLICANTS_INGEST_KEY}" \
  -d '{"applicants":[{"name":"Santos, Maria","source":"GoDaddy"}]}'
```

## Body

```json
{
  "overwrite": false,
  "updateOnly": false,
  "forceNew": false,
  "applicants": [ { "name": "…", "…": "…" } ]
}
```

`overwrite` at the top level only applies to rows that also send an explicit `id`.

`updateOnly: true` (also accepted as `overwriteExistingOnly`) **never creates a Pipeline row**. It overwrites the matching `id` and skips any id that is not already on Pipeline. Use this for the GoDaddy extractor export.

The 18 Sep 2026 extractor file (`asOf`, `driveFolderId`, or `counts.totalApplicants`) is treated as `updateOnly` even if those flags are omitted, so pasting the raw export cannot mint new `a_…` ids.

CSV is accepted on the same URL when the first line is a header (`id,name,resumeLink,…`). Quoted names with commas are fine.

`forceNew: true` (batch or per row) skips the name/email soft-dedupe and always creates a new applicant. `updateOnly` wins over `forceNew`.

## Soft-dedupe

Without `forceNew`, a row that matches an existing applicant **updates that record** instead of creating another. This runs when the caller sends no `id`, **and when the `id` is not already on Pipeline** (a stale id from an older export is not reused):

1. Same email (case-insensitive, if both sides have one), else
2. Same phone (digits only; the last 10 digits, so `0917…` and `+63 917…` match), when emails do not conflict, else
3. Same normalized name (case, punctuation, diacritics, `Last, First` vs `First Last`, middle initials dropped — `Mulle, Frederick S.` matches `Frederick S. Mulle`) when emails and phones do not conflict

Only when nothing matches is a new row created, and then the portal assigns a **fresh** `a_…` id. The caller's id is not written onto that row.

The update keeps the **earliest** `appliedOn`, and for a normal re-application (no `overwrite`) the **furthest** stage. It prefers non-empty email / mobile / roleId, **refreshes `resumeLink` when the caller sends one**, and appends notes (see below) plus a `history` entry. Same-name rows with **different** emails, or different phones, are treated as different people (ingest has no confirm step).

`updateOnly` still never creates a row. A stale id is updated when email, phone, or name matches; otherwise that item is skipped.

## Notes and HR-owned fields

Notes are always **merged**, including on `overwrite: true`. Existing notes stay. Incoming lines are appended only when that line is not already there after whitespace is collapsed (`Called  19 Sep` and `Called 19 Sep` are the same line).

`overwrite` must not blank or downgrade a Pipeline row:

- An empty incoming value does not clear a field that already has a value.
- Stage does not move backwards.
- Stage, exams, interviews, HR evaluation, staff notes, and background stay as HR left them unless the caller sets `replaceHrFields: true`. With that flag, stage may move forward and non-empty evaluation text may be replaced; stage still cannot move backwards.
- `resumeLink` may be refreshed when the caller sends a non-empty link. The previous URL is kept on `docs.resume.links` when it differs.

This is why a second GoDaddy load of the same inbox should not multiply Pipeline rows.

## One-shot cleanup of rows already duplicated

The ingest guard only stops **new** copies. Rows already on live (the May/July/August Tristan / Cañete / Dela Cerna / Barrios copies) need one pass in the UI after this deploy:

1. Open [https://corcondev-hr.netlify.app](https://corcondev-hr.netlify.app) and sign in.
2. Go to **Recruitment → Pipeline**.
3. If copies remain, **Consolidate duplicates (N)** appears next to **Log an applicant** / **Bulk import JSON**.
4. Open it. Groups with the same normalized name and the same (or blank) role are ticked as **auto-safe**. Groups with different roles, different emails, or an extra middle name (e.g. Luisa vs Luisa Mae) stay unticked — only tick those if they are one person.
5. Click **Merge selected**. Each merge keeps the earliest applied date, furthest stage, non-empty contact/CV fields, and combined notes; extra applicant documents are deleted.
6. Refresh Pipeline: one row per person. Re-run the extractor if you want — it should update those rows, not add more.

Do this once after deploy. You do not need a curl cleanup; the button writes through the same `applicants` collection the site already uses.

On Pipeline, **Role** chips sit in the header row next to **Log an applicant** / **Bulk import JSON** (All roles, then each title — Procurement Officer, Project / Site Engineer, …). A search box in the same header filters as you type by applicant name, email, mobile, and position / role title. Search and the role chip apply together (AND). Stage groups stay; empty stages hide. Clear the search box (or its Clear button) to show every role-matching row again.

On the applicant editor, a dated **Background check and observations** log sits under Internal notes. Add a background-check comment or an observation; earlier entries stay (they are not overwritten). Entries store on the applicant as `staffNotes` (`kind`, `text`, `on`, `by`) through the usual `put("applicants")`. This is separate from Internal notes and from the RFFI `background` employer-call list.

## Field map

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `name` | **yes** | — | Non-empty. Use `"Last, First"` if that is how HR already files people. |
| `email` | no | `""` | |
| `mobile` | no | `""` | |
| `roleId` | no | `""` | Seed ids `ro01`–`ro10` below. Unknown id is **not** a batch failure: that row is still created, unlinked, with a `warning`. |
| `position` | no | role title if `roleId` is valid | |
| `dept` | no | role dept if `roleId` is valid | |
| `resumeLink` | no | `""` | Drive / CV URL. A non-empty value refreshes the link. An empty value does not clear one. If this is omitted, `docs.resume` is used. |
| `docs` | no | — | Recruitment file slots. `docs.resume` may be a URL or `{ "link": "…" }`. Other keys (`tor`, `certs`, …) are stored on the applicant `docs` object and merged with what is already there. |
| `notes` | no | `""` | Merged, not replaced. New lines are appended when not already present. |
| `expected` | no | `""` | Expected pay. |
| `education` | no | `""` | |
| `years` | no | `""` | Years of experience (free text). |
| `source` | no | `"Email"` | Override e.g. `"GoDaddy"`. |
| `appliedOn` | no | today (Asia/Manila) | `YYYY-MM-DD`. |
| `stage` | no | `"Applied"` | Unknown values default to Applied (warning). |
| `id` | no | new `a_…` id | Never overwrites an existing id unless `overwrite: true` on that row (or batch `overwrite` **and** an explicit `id`). An id that is **not** on Pipeline is not stored: the row is matched by email, phone, then name, or created under a fresh portal id. With `updateOnly`, no match means the item is skipped — never created. |
| `overwrite` | no | `false` | Requires an explicit `id`. Updates that id when it exists. When it does not, matches email / phone / name instead of minting a row under the stale id. Does not replace notes or move stage backwards. |
| `replaceHrFields` | no | `false` | With `overwrite`, allow stage to move forward and allow non-empty HR evaluation text to be replaced. Never moves stage backwards. Never required for notes or `resumeLink`. |
| `updateOnly` | no | `false` | Overwrite existing rows only. Do not create new Pipeline rows. A stale id can still update the email / phone / name match. Alias: `overwriteExistingOnly`. |
| `forceNew` | no | `false` | Create a new row even when the name, email, or phone already exists. The new row still gets a fresh portal id. Ignored when `updateOnly` is set. |

Each created record also gets empty `exams`, `interviews`, `history`, and `background` arrays so the pipeline editor can open it.

Persistence is the same as the artifact `put("applicants", id, data)` path (`docs` rows, collection `applicants`).

## Response

```json
{
  "ok": true,
  "created": [{ "id": "a_ab12cd34wxyz", "name": "Dela Cruz, Juan" }],
  "updated": [{ "id": "a_existing", "name": "Sibonga, Tristan", "matchedBy": "name" }],
  "errors": [{ "index": 1, "error": "name is required" }],
  "timezone": "Asia/Manila",
  "serverTime": "2026-09-14T08:00:00+08:00"
}
```

- HTTP **200** means the request was authenticated and parsed. `ok` is true only when every row succeeded.
- New people land in `created` with `matchedBy: "new"` and the portal id (not a stale caller id). Re-applications and overwrites land in `updated`. `matchedBy` is `email`, `phone`, `name`, or `id`. When the caller id was not the row that was written, `requestedId` is the id they sent and `id` is the Pipeline id.
- Per-row failures go in `errors` (`index` is the position in `applicants`). Other rows still create or update.
- A missing `roleId` match adds `warning` on that `created` / `updated` item; the applicant is still stored.
- HTTP **401** — no session and no valid ingest key.
- HTTP **400** — not JSON, missing `applicants`, empty batch, or more than 100 rows.
- HTTP **405** — not POST.

## Seed role ids

From the HR artifact `SEED_ROLES`. Use these when the listing maps to a defined role.

| id | title | dept |
| --- | --- | --- |
| `ro01` | Operations Manager | Technical |
| `ro02` | Project Manager | Technical |
| `ro03` | Office Engineer | Technical |
| `ro04` | Quantity Surveyor | Technical |
| `ro05` | Material Officer | Technical |
| `ro06` | Procurement Officer | Procurement |
| `ro07` | Safety Officer | Safety |
| `ro08` | Bookkeeper | Finance |
| `ro09` | HR / Admin Assistant | Admin |
| `ro10` | Driver / Equipment Operator | Motorpool |

If the vacancy is not one of these, omit `roleId` and send `position` / `dept` instead.

## Cassie: Import from email (`hrcorcondev@gmail.com`)

Pipeline was not picking up applications from that inbox because the visible import path was the Mac/GoDaddy JSON file (`Import from the mailbox`) plus **Bulk import JSON**. After this deploy:

1. Sign in at [https://corcondev-hr.netlify.app](https://corcondev-hr.netlify.app).
2. Open **Recruitment → Pipeline**.
3. Click **Import from email**.
4. Click **Pull from hrcorcondev@gmail.com**. If that button is grey, the line beside it says why. **Inbox not connected yet — ask Jeffrey** means the function cannot see the IMAP settings below. A sign-in or status error is written in that same spot and does not leave the button grey for a different reason.
5. New applicants appear at **Applied**. The same person (name or email) updates the existing row — it does not create a second copy.

Pull stays off until Jeffrey sets these on site **corcondev-hr** (**Functions**, Production) and **redeploys**. The browser never stores the password.

| Variable | Value |
| --- | --- |
| `HR_APPLICANTS_IMAP_USER` | `hrcorcondev@gmail.com` |
| `HR_APPLICANTS_IMAP_PASS` | Gmail **app password** (Google Account → Security → App passwords). Not the mailbox login password. |

Do not commit those values. They are small and stay under the Functions 4KB budget. The browser never sees the app password — only the signed-in `hr_session` cookie is sent.

### Extractor overwrite (18 Sep 2026 ready export)

The GoDaddy HR application extractor published a Pipeline patch — **67 applicants, all with `resumeLink`**. Overwrite by stable id only; do **not** create new Pipeline rows.

| | |
| --- | --- |
| Drive folder | [HR applications export](https://drive.google.com/drive/folders/1G1TJ5rmI_rGEQcXjKLfYfy2dx9gtZRgC) (`1G1TJ5rmI_rGEQcXjKLfYfy2dx9gtZRgC`) |
| JSON | [builder-latest-applicants-export.json](https://drive.google.com/file/d/1sfAgcO2aXeGsAsn1CsIDg7_36bVp_3AI/view) (`1sfAgcO2aXeGsAsn1CsIDg7_36bVp_3AI`) |
| CSV | [builder-latest-applicants-export.csv](https://drive.google.com/file/d/1Mpguswqx_anA5sxmJ1VvyzI0kCy3805L/view) (`1Mpguswqx_anA5sxmJ1VvyzI0kCy3805L`) |
| On the extractor box | `/workspace/hr-applications/builder-latest-applicants-export.json` and `.csv` |
| Shortlist | 14, all have `resumeLink` |
| Backfill | 43 rows were backfill-patched; some Drive PDFs may still be stub size |

Cassie / Jeffrey:

1. Sign in at [https://corcondev-hr.netlify.app](https://corcondev-hr.netlify.app).
2. Open **Recruitment → Pipeline** → **Import from email**.
3. Click **Overwrite from extractor (by id)**.
4. Choose or paste the JSON or CSV from the Drive folder (or from `/workspace/hr-applications/` on the extractor box).
5. Click **Overwrite existing by id**. Expect **67 updated · 0 new**. Unknown ids are skipped.

The extractor bot can POST the same JSON (or CSV) to `applicants-ingest` with `X-HR-Ingest-Key`. The `asOf` / `driveFolderId` wrapper forces `updateOnly`.

Until IMAP is on, Cassie can still:

- **Overwrite from extractor (by id)** — 18 Sep 2026 resumeLink patch, id-stable.
- **Import from the mailbox** — run the Mac `corro_applications.py` script and choose `applications.json` (existing GoDaddy / Titan path).
- **Bulk import JSON** — paste `{ "applicants": [ { "name": "…" } ] }` through `applicants-ingest`. An extractor-shaped file still overwrites by id only.

All of these write the same `applicants` collection as the email pull.

`GET` / `POST` `/.netlify/functions/applicants-email` requires the HR session cookie (not the ingest key).

## mergeInto (remove a bot stray)

Key-gated on the same URL (`X-HR-Ingest-Key` or `Authorization: Bearer`, or an HR session cookie). Folds the stray's notes into the keeper (new lines only), copies `resumeLink` onto the keeper when the keeper's link is empty, keeps a different stray CV on `docs.resume.links`, then deletes the stray.

Refused when the stray's stage is anything other than Applied, or when the stray has portal evaluation data (HR notes / verdict, exams, interviews, staff notes, background checks, `hiredEmpId`, or an `editedBy` / `updatedBy` / `portalEdited` marker). Applicants do not have a separate edit log; those fields are the signal. A refused stray is left in place.

Do **not** run this until the notes-merge deploy is live. One request for the two strays created on 27 Sep 2026:

```bash
curl -sS -X POST 'https://corcondev-hr.netlify.app/.netlify/functions/applicants-ingest' \
  -H 'Content-Type: application/json' \
  -H "X-HR-Ingest-Key: ${HR_APPLICANTS_INGEST_KEY}" \
  -d '{
    "op": "mergeInto",
    "merges": [
      {"strayId": "a_6249de79dv1x", "keepId": "a_057e4139cydo"},
      {"strayId": "a_7328aadddmxl", "keepId": "a_4b50d6c9cr7r"}
    ]
  }'
```

A single pair `{ "op": "mergeInto", "strayId": "a_…", "keepId": "a_…" }` is the same operation. `ok` is true only when every pair succeeded. `merged[].id` is the keeper. Failures stay in `errors` and do not delete that stray.

## Recovering notes overwritten around 2026-09-27 00:30 Manila

Pipeline rows live in Supabase `public.docs` (`collection = 'applicants'`), one current JSON `data` blob plus `updated_at`. The table trigger replaces `updated_at` on every write. There is no history table, no note changelog, and no one-click restore for applicant notes. The applicant `history` array is work history and ingest/merge events, not the previous notes text. Settings → Restore from a backup reads a JSON file, and the portal's own export does not include the `applicants` collection. The 18 Sep Drive export is the extractor's copy, not HR's later edits. Recovery of notes replaced in that run needs a Supabase project backup or point-in-time restore from before 2026-09-26 16:30 UTC, if the project has one — it is not in this app.

## Security

- Service-role Supabase keys stay on Netlify functions. The extractor must **not** embed `SUPABASE_SERVICE_ROLE` in a browser or agent prompt.
- `HR_APPLICANTS_INGEST_KEY` is a shared secret. Treat it like a password. Rotate if it appears in logs, a ticket, or a repo.
- Ingest-key callers are rate-limited (about 40 requests / 15 minutes / IP).
- This site is not a public crawl target. Do not publish the key in README screenshots.
