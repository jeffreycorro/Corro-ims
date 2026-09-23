# CorConDev HR artifact host

This folder is a **separate Netlify site** that hosts the existing Claude single-file HR app behind a shim. It is **not** the public company portal (the Next.js app at the repo root).

Do **not** rewrite, minify, or modernize the HTML artifact. Paste the Claude export as-is, then add one script tag.

## Operator steps

### 1. Paste the real artifact

`public/index.html` should be the Claude artifact HTML export. Current deploy is **build 2026-09-23b** (Leave and Cash Advance print and send-for-approval stamp the Department Head and Evaluated by e-signatures from Settings → HR e-signatures, and stop with a message naming the missing JPEG instead of printing a blank box; Approver Approve still stamps the CEO e-signature on Approved by / Final Approval — on top of 2026-09-23a Approver tab asks for a password before the queue or its actions are shown; a wrong password is rejected and the unlock lasts only for this page, the same way Motorpool's office passcode does — on top of 2026-09-22b Approver queue: after the evaluator signs, Leave, employment contracts, and cash advances wait as Evaluated — for approval until Jeffrey approves and his e-signature is stamped on the form — on top of 2026-09-22a Daily Report Monitoring / Daily Manpower lists active employees only: Separated, Resigned, Terminated, and AWOL stay off today's open sheet even when a saved roster snapshot still names them; past filed days keep their rows — on top of 2026-09-19a Payroll drops Separated / resigned / terminated / AWOL the same way Daily Manpower does; Leave and Cash Advance print Catherine A. Largo as Evaluated by; Leave/CA signed-copy uploads accept scans up to 80 MB — on top of 2026-09-18g 201 checklist: COE CCD / COE from employee / employee requirement checklist / KASABUTAN / NBI Clearance; N/A counts toward the percentage; Separations is N/A while the person is not Separated; a government-mandated-deduction refusal attachment completes SSS / Pag-IBIG / PhilHealth / TIN — on top of 2026-09-18f Attendance / Daily Manpower: a 201 Project-based or Regular status sticks instead of the stale separated-roster re-apply, master Position titles show when present, blank day status defaults to Present, and Mark all Rest day confirms before changing the visible list — on top of 2026-09-18e Leave / Cash Advance Import from Drive, 2026-09-18d Ask Stop talking, 2026-09-18c photo/file attach, chat states, and leave answers that include the Reason for Leave field, on top of 2026-09-18b / multiple exam-score rows on an applicant, on top of 2026-09-18a / Claude's three surgical patches on 2026-09-17a: one pending status that pays 0, bulk rest/pending buttons that only change selects until Save, and hosted-site Drive-off copy). If you replace it, keep the shim script tag in `<head>`.

### 2. Inject the shim (one-line change)

Inside `<head>` of that real `index.html`, **before any other scripts**, add:

```html
<script src="/claude-shim.js"></script>
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/pwa.css">
<script src="/pwa.js"></script>
```

`window.claude.use(name)` is implemented by `public/claude-shim.js` and must load first. Do not rewrite the rest of the artifact. `pwa.js` / `pwa.css` only add iOS Home Screen tags and a scoped mobile overlay. The shim then loads `hr-dictation.js` (hold-to-talk when `OPENAI_API_KEY` is set), `hr-memo.js` (issued / on-paper memoranda open as saved records, not blank drafts), `hr-tts.js` (ElevenLabs readback for Ask the records and memo text when `ELEVENLABS_API_KEY` is set), `hr-applicants-export.js` (GoDaddy extractor JSON/CSV parse — overwrite Pipeline by stable id only), `hr-recruit.js` (Recruitment → Pipeline “Bulk import JSON”, “Overwrite from extractor (by id)”, “Consolidate duplicates”, role filter, search, applicant staff notes, multiple exam scores per applicant, and the applicant “View 201 / application file”), `hr-201-file.js` (201 profile “On file for this person” — NTEs, memos, incidents, leave, cash advances, and other empId-tagged records; also keeps Settings `hr201Active` / `hr201Separated` / `hr201Inbox` as Drive folder ids), `hr-201-checklist.js` (201 category list + completion % — N/A counts, Separations N/A when not Separated, refusal attachment completes statutory rows), `hr-leave-numbers.js` (unique LRF / LV series numbers on New leave, Import from Drive / paste, and allocate; next number is always max(existing LRF for the year)+1 so a crash cannot restart at `LRF2026-0001`; Leave → **Renumber leave**; the leave editor number field is writable so an admin can persist a free LRF), `hr-forms-fix.js` (Cash Advance requester identity lock, live project pickers for Leave/CA, project-based definite-period contract template + ISO letterhead mark), `hr-email-applicants.js` (Pipeline **Import from email** for `hrcorcondev@gmail.com`, reusing applicants-ingest), `hr-form-drive-import.js` (Leave / Cash Advance **Import from Drive** — filename + folder search, paper LRF/CAF kept, duplicates skipped), `hr-onboarding-links.js` (New Employee Orientation company video Drive file remap), `hr-ask-leave.js` (Ask leave payload — type, dates, status, and Reason for Leave), and `hr-ask-attach.js` (Ask photo/file attach). Build 2026-09-16b owns attendance and payroll UI, so the shim no longer loads `hr-attendance.js` or `hr-payroll.js` (those files stay in `public/` for tests). Do not rewrite the artifact to add mic buttons, memo chrome, a second attendance system, a parallel payroll app, a second voice UI, a second recruitment editor, a second 201 register, or a second leave-numbering counter.

### 3. Apply the SQL migration

In the Supabase SQL editor for the project this site will use, run:

`supabase/migrations/20260907000002_hr_artifact_docs.sql`

and, after the live LRF2026-0169 duplicate has been renumbered:

`supabase/migrations/20260915000001_lv_unique_leave_numbers.sql`

The first file creates `docs`, `locks`, `hr_allowed_collections`, RLS (no anonymous reads), and `acquire_doc_lock`. Locks are real: `acquire({ holder })` does **not** always return `acquired: true`. The second file unique-indexes normalised leave numbers on `leaves` and LV `docreg` rows — it will fail if two records still share an LRF.

Timestamps are `timestamptz` (UTC). Display in **Asia/Manila**.

Collections: `employees`, `nte`, `writeups`, `tasks`, `templates`, `reminders`, `memos`, `resources`, `onboarding`, `series`, `docreg`, `applicants`, `exams`, `roles`, `advances`, `leaves`, `projects`, `incidents`, `genfiles`, `decisions`, `daily`, `filed`, `compliance`, `forms`, `periods`, plus `meta` (path `meta/settings`).

There is **no employee seed data** in this repo. Restore production data from a backup JSON **inside the app** (Settings), never by committing a dump.

### 4. Create a SEPARATE Netlify site

1. New site from this GitHub repo.
2. **Base directory:** `hr-artifact` (not the repo root).
3. Publish directory: `public` (already in `netlify.toml`).
4. Node 20 (already in `netlify.toml`).
5. Do not attach this folder to the company portal site.

### 5. Environment variables

Site settings → Environment variables:

| Variable | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Functions | Same Supabase project as the company portal |
| `SUPABASE_ANON_KEY` | Functions | Anon key for staff email/password (and portal handoff JWT). Never the service role. |
| `SUPABASE_SERVICE_ROLE` | Functions **only** | Data plane + server-side profile lookup. Never put this in the shim, `index.html`, or any public env. |
| `HR_SESSION_SECRET` | Functions | HMAC key for the httpOnly session cookie. Generate with `openssl rand -hex 32`. If unset, a hash of `SUPABASE_SERVICE_ROLE` is used. |
| `HR_GATE_SECRET` | **Do not set** | Deprecated. Not a login password. Delete it from Functions so it does not count toward the 4KB Lambda env limit. |
| `HR_GATE_REQUIRED` | Functions, optional | Default **off**. Set `true` only if you still want the old shared-password wall as an extra method. |
| `HR_GATE_PASSWORD` | Functions, optional | Shared password used only when `HR_GATE_REQUIRED=true`. |
| `SUPABASE_AUTH_ENABLED` | Functions, optional | Default **on** when URL + anon key are set. Set `false` only to disable Auth. |
| `ANTHROPIC_API_KEY` | Functions **only** | Enables memo drafting, Ask the records, and other `sample` calls. Never put this in the shim or `index.html`. |
| `ANTHROPIC_MODEL` | Functions, optional | Override the default model (`claude-sonnet-4-5`). |
| `ANTHROPIC_MODEL_COMPLEX` | Functions, optional | Model for `modelTier: "complex"` (role defs, long drafts). Defaults to `ANTHROPIC_MODEL`. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Builds only**, or **unset** | Must **not** be Functions-scoped. A full GCP JSON is ~3KB and blows the AWS 4KB Functions env limit. Prefer Netlify Blobs (below). |
| `GOOGLE_DRIVE_DELEGATED_USER` | Functions, optional | Workspace user email if the service account uses domain-wide delegation to reach user folders. |
| `GOOGLE_DRIVE_OCR` | Functions, optional | Set `true` to OCR image/PDF files that have no text layer (uses the Anthropic key; slow on bulk reads). |
| `OPENAI_API_KEY` | Functions **only** | Enables hold-to-talk dictation (`transcribe`) for memo drafting and Ask the records. Never put this in the shim or `index.html`. |
| `OPENAI_TRANSCRIBE_MODEL` | Functions, optional | Override the transcription model. Default tries `gpt-transcribe`, then `gpt-4o-transcribe`, then `whisper-1`. |
| `OPENAI_TRANSCRIBE_LANGUAGES` | Functions, optional | Comma-separated language hints (e.g. `en,tl`). Leave unset so Taglish / mixed speech is auto-detected. |
| `OPENAI_TRANSCRIBE_PROMPT` | Functions, optional | Override the workplace / Taglish prompt sent with each clip. |
| `OPENAI_TRANSCRIBE_KEYWORDS` | Functions, optional | Comma-separated name and term hints. |
| `ELEVENLABS_API_KEY` | Functions **only** | Enables Ask the records / memo readback (`claude.use("tts")`). Never put this in the shim or `index.html`. |
| `ELEVENLABS_VOICE_ID` | Functions, optional | Override the default ElevenLabs voice. |
| `ELEVENLABS_MODEL_ID` | Functions, optional | Override the TTS model (default `eleven_multilingual_v2`). |
| `HR_APPLICANTS_INGEST_KEY` | Functions **only** | Shared secret for `POST /.netlify/functions/applicants-ingest` (GoDaddy extractor). Staff already signed in can use the session cookie instead. Generate with `openssl rand -hex 32`. Never commit the value. |
| `HR_APPLICANTS_IMAP_USER` | Functions, optional | Applications inbox, usually `hrcorcondev@gmail.com`. Small. |
| `HR_APPLICANTS_IMAP_PASS` | Functions, optional | Gmail **app password** (not the login password). Never commit. |
| `HR_APPLICANTS_IMAP_HOST` / `_MAILBOX` | Functions, optional | Defaults `imap.gmail.com` / `INBOX`. |

Copy `.env.example`. Data, AI, Drive, and voice functions **refuse** requests without a valid session cookie (issued after Supabase Auth). The applicants ingest function also accepts `X-HR-Ingest-Key` / `Authorization: Bearer` when `HR_APPLICANTS_INGEST_KEY` is set. Do not rely on a front-end-only password check. Do not invent a default ingest key in code.

**AWS 4KB Functions limit.** Every Functions-scoped variable is copied into every Lambda. Keep secrets that functions need (Supabase, Anthropic, OpenAI, ElevenLabs, session, ingest) on Functions. Keep the Google service-account JSON **off** Functions. Full operator table, remaining-size estimates (~0.9–2.6KB of our keys plus Netlify platform vars), and “do not gzip/split” notes: [`docs/netlify-functions-env.md`](docs/netlify-functions-env.md).

**How to set env on Netlify (HR site `corcondev-hr`):**

1. Site configuration → Environment variables.
2. Add `ANTHROPIC_API_KEY` (Ask the records / memo draft) and `ELEVENLABS_API_KEY` (read-aloud). Optional: `ELEVENLABS_VOICE_ID`.
3. For the GoDaddy extractor, add `HR_APPLICANTS_INGEST_KEY` (long random string). Give that value to Jeffrey out of band — not git.
4. Add `HR_SESSION_SECRET` (`openssl rand -hex 32`). Scope **Functions**, Production. Delete `HR_GATE_SECRET` if it is still set.
5. Scope API keys to **Functions** + **Production**. Never commit real keys. Do **not** also set `NEXT_PUBLIC_SUPABASE_*` on this site (duplicates the JWTs).
6. Move Drive credentials off Functions (see Drive notes below), then **redeploy**.
7. Confirm the deploy creates functions (no “exceed the 4KB limit”). Then `GET /.netlify/functions/auth` shows `mcp: true` and `capabilities.mcp: true` when Drive credentials are available (Blobs or Builds-only JSON). `netlify.toml` sets `GOOGLE_SERVICE_ACCOUNT_BLOB=1` so Lambda always tries Blobs.

Extractor contract (URL, headers, field map, seed roles `ro01`–`ro10`, soft-dedupe, **overwrite-by-id / `updateOnly`**, JSON or CSV, one-shot Pipeline cleanup) and **Cassie’s Import from email + extractor overwrite steps**: `docs/applicants-ingest.md`.

**One staff password.** HR uses the same Supabase email + password as [https://corcondev-portal.netlify.app](https://corcondev-portal.netlify.app). There is no separate HR site password in the default flow. After login, an httpOnly cookie keeps the PWA signed in (7 days, or until Sign out).

**Who can enter.** After Auth succeeds, the function reads `public.profiles` (same table as the portal). Only `role = admin`, `role = hr`, or `department = hr` receive a session. Other department logins get 403 — they can use the company portal, not this HR site.

**Drive operator notes**

1. Create a Google Cloud service account and download its JSON key. **Do not paste that JSON into a Functions-scoped env var** — AWS rejects the deploy over 4KB.
2. **Preferred (set once, no 3KB env var):** from a machine with Netlify CLI access to `corcondev-hr`:
   ```bash
   npx netlify blobs:set hr-secrets google-service-account --input ./google-sa.json
   ```
   Then delete `GOOGLE_SERVICE_ACCOUNT_JSON` from the site (Builds and Functions) and redeploy.
3. **Also supported:** keep `GOOGLE_SERVICE_ACCOUNT_JSON` as **Builds only** (uncheck Functions). The build copies it into the functions bundle via `scripts/prepare-google-sa.js`. The committed `google-sa.generated.js` stub stays empty — never commit a real key.
4. Local / `netlify dev`: `.env` may set `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_FILE`. That file is gitignored.
5. Share every HR folder the artifact uses (201 ACTIVE / SEPARATED, inbox, memos, attendance, training manuals) with the service account email (`client_email` in the JSON). Viewer is enough to search and read; Content Manager (or Editor) is required to upload or create folders.
6. If those folders are in a Shared Drive, add the service account as a member of that Shared Drive. If they are in a user's My Drive, enable domain-wide delegation for the service account and set `GOOGLE_DRIVE_DELEGATED_USER` to that user's email.
7. After Blobs or env scopes change, redeploy so functions pick them up.

Without `ANTHROPIC_API_KEY` the shim still resolves `sample` to `null` and the memo editor shows “AI drafting is not available in this view”. Without a Drive service account (Blobs, Builds bundle, or local env), `mcp` is `null` and Drive actions show the artifact’s own unavailable / `not_granted` copy. Without `OPENAI_API_KEY`, `transcribe` is `null` and the hold-to-talk controls are not shown. Without `ELEVENLABS_API_KEY`, `tts` is `null` and the read-aloud controls are not shown.

### 6. Access control

**App-level login (required):** `/.netlify/functions/auth` accepts the company-portal Supabase email/password, or a short-lived `access_token` from the portal HR deeplink (URL hash only). It then checks `profiles` and issues an httpOnly cookie. `/.netlify/functions/db`, `sample`, `drive`, `transcribe`, `tts`, and `applicants-email` return 401 without that cookie. `/.netlify/functions/applicants-ingest` accepts that cookie **or** `HR_APPLICANTS_INGEST_KEY`. The service role key, Anthropic key, OpenAI key, ElevenLabs key, ingest key, IMAP app password, and service-account JSON never leave Netlify Functions (the service-account JSON is read from Blobs or the build bundle, not from Functions env).

**Portal handoff (`/app/hr`):** The company portal is a different Netlify host, so the Supabase cookie is not shared. If the staff member is already signed in on the portal, the HR CTA reads the browser session and navigates to `https://corcondev-hr.netlify.app/#access_token=…`. The hash is not sent to Netlify request logs. The shim posts that JWT to `auth`, then `history.replaceState` strips the hash. If handoff fails, the same email + password form works — there is no second gate password.

**Deprecated shared gate:** `HR_GATE_SECRET` is not a staff password anymore. **Remove it from Functions** on production. Leave `HR_GATE_REQUIRED` unset. Only set `HR_GATE_REQUIRED=true` (and `HR_GATE_PASSWORD`) if you deliberately want the old shared-password method as an extra wall.

**Netlify visitor password / Identity (optional extra, not the staff login):**

- Site configuration → Access & security → Visitor access → **Password protection** (or Identity).
- This is an operator-only layer for casual URL guessing. Do not give staff a second password here if you can avoid it.

### 7. Turn off Deploy Previews

This site must **not** be a casual public crawl target. Preview URLs leak private HR UI.

`netlify.toml` skips deploy-preview and branch-deploy builds via `ignore = "exit 0"`. Also do this in the UI (Netlify does not always honor ignore alone):

1. Project configuration → Build & deploy → Continuous Deployment → Branches and deploy contexts
2. **Disable Deploy Previews**
3. Do not publish branch deploys

Privacy headers (`X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`) are set for `/*`. `public/robots.txt` disallows all crawlers.

### 8. Restore data

After deploy, open the site, sign in with a portal HR/admin account, and restore the backup JSON from **Settings in the artifact**. Never commit backup JSON.

**Separated roster + contributions (2026-09-16).** Do not delete anyone. Apply status `Separated` and per-head `ded` (including zeros) with `scripts/apply-employee-updates.js` or the SQL next to it. Steps: [`scripts/README-employee-updates.md`](scripts/README-employee-updates.md).

**Duplicate LRF2026-0169 (Jaranilla / Cartuciano).** The leave number field is not editable. After this host ships, sign in, open **Leave**, and either click **Renumber leave** (Jaranilla is preselected; new number defaults to the next free LRF, likely `LRF2026-0171`) or, in the browser console:

```js
await hrLeaveNumbers.fixLiveDuplicate169()
```

That keeps Cartuciano on `LRF2026-0169`, moves Jaranilla to the next free number, updates her LV register row / signed-copy titles, and leaves the next new application at max(seq)+1. Then run `20260915000001_lv_unique_leave_numbers.sql` in Supabase.

---

## What the shim provides

`window.claude.use(name)` returns a Promise **synchronously**.

| Capability | Behavior |
| --- | --- |
| `db` | `doc(path).get/set/delete/acquire` and `collection(name).get` / `onSnapshot` (one-shot + unsubscribe). Path: `collection/id`. |
| `downloads` | `save({ filename, data })` via object URL + `<a download>`. |
| `sample` | Anthropic-backed `sample(prompt, { modelTier, onText, tools, signal })` → `{ text, truncated? }`, plus `sample.json` and `sample.limits`. `null` until `ANTHROPIC_API_KEY` is set. Client-side tools (Ask the records) run in the browser; only schemas go to the function. |
| `mcp` | `callTool("Google Drive", tool, args)` for `search_files`, `read_file_content`, `create_file`. Responses use `{ payload: { files, text/content/fileContent, id, title, viewUrl, nextPageToken } }`. `null` until Drive credentials load (Netlify Blobs `hr-secrets` / `google-service-account`, Builds-only bundle, or local file). `GET /.netlify/functions/auth` advertises both `capabilities.mcp` and top-level `mcp`. Uploads larger than ~3MB are chunked through a resumable Drive session. |
| `transcribe` | OpenAI-backed `transcribe({ audio, mimeType, language, signal })` → `{ text }`. Hold-to-talk on memo draft / reminder / Ask fields is attached by `hr-dictation.js` (loaded by the shim). `null` until `OPENAI_API_KEY` is set. Issued / Drive-imported memos are treated as saved records by `hr-memo.js` (also loaded by the shim). The manpower leave rule, Claude JSON paste door, per-person summary, and Present/Late / Undertime time fields are attached by `hr-attendance.js`. Payroll Maker (period attendance, +30% / +100% / as-is holiday premium), contributions, the holiday calendar, and the attendance edit log are attached by `hr-payroll.js`. |
| `tts` | ElevenLabs-backed `tts(text)` → `{ audioBase64, mimeType }`. Ask the records / memo readback is attached by `hr-tts.js` (loaded by the shim). `null` until `ELEVENLABS_API_KEY` is set. |
| anything else | `null` |

`acquire({ holder })` calls the `acquire_doc_lock` RPC. A second holder with an unexpired lock gets `acquired: false`.

## Manpower attendance (Claude JSON paste)

Daily manpower PDFs live in Drive. OCR is weaker than Claude.ai, so the intended path is: Claude extracts the rows, HR pastes or uploads the JSON array on **Daily Manpower** or **HR Analytics** (`Paste Claude JSON`).

```json
[
  { "date": "2026-08-29",
    "preparedBy": "Timekeeper", "approvedBy": "PIC", "source": "08.29.2026.pdf",
    "rows": [
      { "empNo": "1250", "status": "Present", "reason": "", "site": "CTU BARILI" },
      { "empNo": "1348", "status": "Absent", "reason": "Approved Leave (LRF2026 - 0123)", "site": "ADMINS" },
      { "empNo": "1353", "status": "Present/Late", "reason": "traffic", "site": "TAWASON" }
    ] }
]
```

Matching is on the four-digit employee number only. Status is normalised to the closed list. The same leave rule (`effectiveStatus` / `absenceExcuse`) feeds the per-person summary, charts, and Notice to Explain suggestions: an approved leave on file beats a timekeeper Absent; an LRF citation on the report (including a wrapped `0123)` line, employee-scoped) is next; otherwise the absence is unexcused.

## Local checks

```bash
cd hr-artifact
node --test
```

Functions need Netlify (`npx netlify dev --dir .`) plus the env vars above. AI, Drive, and dictation stay off until their keys are set; the rest of the artifact still loads.

## Install on iPhone (HR staff)

This HR site is a Progressive Web App. Add it from **Safari** only.

1. Open [https://corcondev-hr.netlify.app](https://corcondev-hr.netlify.app) in Safari.
2. Sign in with your company portal email and password. The Home Screen icon opens `/` and stays signed in while the session cookie is valid (Sign out clears it).
3. Tap **Share** → **Add to Home Screen**.
4. Keep the name **HR Portal** and tap **Add**.
5. Open the icon. It should launch full-screen with the navy “C” icon.

If a Netlify visitor password is also enabled, Safari may prompt for that before the in-app login. Avoid that extra prompt for staff; the in-app form is the real door.

The optional service worker caches icons and `pwa.css` only. It does **not** cache `index.html`, `claude-shim.js`, `hr-dictation.js`, `hr-memo.js`, `hr-attendance.js`, `hr-payroll.js`, `hr-tts.js`, `hr-applicant-dedupe.js`, `hr-recruit.js`, `hr-201-file.js`, `hr-201-checklist.js`, `hr-leave-numbers.js`, `hr-form-drive-import.js`, `hr-onboarding-links.js`, `hr-ask-leave.js`, `hr-ask-attach.js`, or `/.netlify/functions/*`, so auth, db, sample, Drive, dictation, memo chrome, attendance import, payroll, voice, applicant ingest, leave numbering, 201 completion, and Drive form import stay on the network.

## Files

```
hr-artifact/
  netlify.toml
  public/index.html          ← replace with Claude export
  public/claude-shim.js
  public/hr-dictation.js     ← hold-to-talk UI (loaded by the shim)
  public/hr-memo.js          ← issued / on-paper memo editor (loaded by the shim)
  public/hr-attendance.js    ← manpower summary + Claude JSON paste door (loaded by the shim)
  public/hr-payroll.js       ← Payroll Maker, contributions, holiday calendar, attendance edit log
  public/hr-tts.js           ← ElevenLabs readback (loaded by the shim)
  public/hr-applicant-dedupe.js ← name keys + merge rules (shim + ingest)
  public/hr-recruit.js       ← Pipeline bulk import, consolidate, role filter, search, staff notes, application file (loaded by the shim)
  public/hr-201-file.js      ← 201 profile “On file for this person”
  public/hr-201-checklist.js ← 201 categories + completion % (N/A, Separations, refusal)
  public/hr-leave-numbers.js ← unique LRF / LV numbers + Renumber leave (shim + db)
  public/hr-form-drive-import.js ← Leave / CA Import from Drive (loaded by the shim)
  public/hr-onboarding-links.js ← company onboarding video Drive file remap (loaded by the shim)
  public/hr-ask-leave.js     ← Ask leave payload includes Reason for Leave (loaded by the shim)
  public/hr-ask-attach.js    ← Ask photo/file attach (loaded by the shim)
  public/pwa.js              ← apple / manifest tags + viewport-fit
  public/pwa.css             ← mobile / safe-area overlay
  public/manifest.json
  public/sw.js               ← icon/CSS shell only
  public/apple-touch-icon.png
  public/robots.txt
  netlify/functions/auth.js
  netlify/functions/db.js
  netlify/functions/applicants-ingest.js
  netlify/functions/sample.js
  netlify/functions/drive.js
  netlify/functions/transcribe.js
  netlify/functions/tts.js
  netlify/lib/               ← session, supabase, locks, collections, Anthropic, Drive, OpenAI, ElevenLabs, applicants ingest
  docs/applicants-ingest.md  ← extractor URL, headers, field map, seed roles
  docs/netlify-functions-env.md ← 4KB limit, Functions vs Builds, Blobs setup
  scripts/prepare-google-sa.js  ← Builds-only SA JSON → functions bundle
  supabase/migrations/       ← docs + locks + RLS
```
