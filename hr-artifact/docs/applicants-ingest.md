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
  "forceNew": false,
  "applicants": [ { "name": "…", "…": "…" } ]
}
```

`overwrite` at the top level only applies to rows that also send an explicit `id`.

`forceNew: true` (batch or per row) skips the name/email soft-dedupe and always creates a new applicant.

## Soft-dedupe

Without `forceNew`, a row that matches an existing applicant **updates that record** instead of creating another:

1. Same email (if both sides have one), else
2. Same normalized name (case, punctuation, diacritics, `Last, First` vs `First Last`, middle initials dropped) when emails do not conflict

The update keeps the **earliest** `appliedOn`, the **furthest** stage, prefers non-empty email / mobile / resumeLink / roleId, and appends a re-application note plus a `history` entry. Same-name rows with **different** emails are treated as different people (ingest has no confirm step).

This is why a second GoDaddy load of the same inbox should not multiply Pipeline rows.

## One-shot cleanup of rows already duplicated

The ingest guard only stops **new** copies. Rows already on live (the May/July/August Tristan / Cañete / Dela Cerna / Barrios copies) need one pass in the UI after this deploy:

1. Open [https://corcondev-hr.netlify.app](https://corcondev-hr.netlify.app) and sign in.
2. Go to **Recruitment → Pipeline**.
3. If copies remain, **Consolidate duplicates (N)** appears next to **Log an applicant** / **Bulk import JSON**.
4. Open it. Groups with the same normalized name and the same (or blank) role are ticked as **auto-safe**. Groups with different roles or emails stay unticked — only tick those if they are one person.
5. Click **Merge selected**. Each merge keeps the earliest applied date, furthest stage, non-empty contact/CV fields, and combined notes; extra applicant documents are deleted.
6. Refresh Pipeline: one row per person. Re-run the extractor if you want — it should update those rows, not add more.

Do this once after deploy. You do not need a curl cleanup; the button writes through the same `applicants` collection the site already uses.

## Field map

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `name` | **yes** | — | Non-empty. Use `"Last, First"` if that is how HR already files people. |
| `email` | no | `""` | |
| `mobile` | no | `""` | |
| `roleId` | no | `""` | Seed ids `ro01`–`ro10` below. Unknown id is **not** a batch failure: that row is still created, unlinked, with a `warning`. |
| `position` | no | role title if `roleId` is valid | |
| `dept` | no | role dept if `roleId` is valid | |
| `resumeLink` | no | `""` | Drive / CV URL. |
| `notes` | no | `""` | Extractor remarks, mailbox subject, etc. |
| `expected` | no | `""` | Expected pay. |
| `education` | no | `""` | |
| `years` | no | `""` | Years of experience (free text). |
| `source` | no | `"Email"` | Override e.g. `"GoDaddy"`. |
| `appliedOn` | no | today (Asia/Manila) | `YYYY-MM-DD`. |
| `stage` | no | `"Applied"` | Unknown values default to Applied (warning). |
| `id` | no | new `a_…` id | Never overwrites an existing id unless `overwrite: true` on that row (or batch `overwrite` **and** an explicit `id`). |
| `overwrite` | no | `false` | Requires an explicit `id`. |
| `forceNew` | no | `false` | Create a new row even when the name/email already exists. |

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
- New people land in `created`. Re-applications of someone already on file land in `updated` (`matchedBy` is `name` or `email`).
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

## Security

- Service-role Supabase keys stay on Netlify functions. The extractor must **not** embed `SUPABASE_SERVICE_ROLE` in a browser or agent prompt.
- `HR_APPLICANTS_INGEST_KEY` is a shared secret. Treat it like a password. Rotate if it appears in logs, a ticket, or a repo.
- Ingest-key callers are rate-limited (about 40 requests / 15 minutes / IP).
- This site is not a public crawl target. Do not publish the key in README screenshots.
