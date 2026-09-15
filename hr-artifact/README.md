# CorConDev HR artifact host

This folder is a **separate Netlify site** that hosts the existing Claude single-file HR app behind a shim. It is **not** the public company portal (the Next.js app at the repo root).

Do **not** rewrite, minify, or modernize the HTML artifact. Paste the Claude export as-is, then add one script tag.

## Operator steps

### 1. Paste the real artifact

`public/index.html` should be the Claude artifact HTML export. If you replace it, keep the shim script tag in `<head>`.

### 2. Inject the shim (one-line change)

Inside `<head>` of that real `index.html`, **before any other scripts**, add:

```html
<script src="/claude-shim.js"></script>
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/pwa.css">
<script src="/pwa.js"></script>
```

`window.claude.use(name)` is implemented by `public/claude-shim.js` and must load first. Do not rewrite the rest of the artifact. `pwa.js` / `pwa.css` only add iOS Home Screen tags and a scoped mobile overlay. The shim then loads `hr-dictation.js` (hold-to-talk when `OPENAI_API_KEY` is set), `hr-memo.js` (issued / on-paper memoranda open as saved records, not blank drafts), `hr-attendance.js` (manpower tally leave rule, JSON paste/import door, per-person summary, Present/Late Time In and Undertime Time Out), `hr-payroll.js` (Payroll Maker period attendance, +30% / +100% / as-is holiday premium, contributions, holiday calendar, Daily Manpower Hol/OT + change history), `hr-tts.js` (ElevenLabs readback for Ask the records and memo text when `ELEVENLABS_API_KEY` is set), `hr-recruit.js` (Recruitment → Pipeline “Bulk import JSON”), and `hr-201-file.js` (201 profile “On file for this person” — NTEs, memos, incidents, leave, cash advances, and other empId-tagged records). Do not rewrite the artifact to add mic buttons, memo chrome, a second attendance system, a parallel payroll app, a second voice UI, a second recruitment editor, or a second 201 register.

### 3. Apply the SQL migration

In the Supabase SQL editor for the project this site will use, run:

`supabase/migrations/20260907000002_hr_artifact_docs.sql`

That creates `docs`, `locks`, `hr_allowed_collections`, RLS (no anonymous reads), and `acquire_doc_lock`. Locks are real: `acquire({ holder })` does **not** always return `acquired: true`.

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
| `HR_SESSION_SECRET` | Functions, optional | HMAC key for the httpOnly session cookie. If unset, `HR_GATE_SECRET` or a hash of `SUPABASE_SERVICE_ROLE` is used. |
| `HR_GATE_SECRET` | Functions, **deprecated** | No longer a login password. Kept only as a fallback cookie HMAC key. Ignored as a door unless `HR_GATE_REQUIRED=true`. |
| `HR_GATE_REQUIRED` | Functions, optional | Default **off**. Set `true` only if you still want the old shared-password wall as an extra method. |
| `HR_GATE_PASSWORD` | Functions, optional | Shared password used only when `HR_GATE_REQUIRED=true`. |
| `SUPABASE_AUTH_ENABLED` | Functions, optional | Default **on** when URL + anon key are set. Set `false` only to disable Auth. |
| `ANTHROPIC_API_KEY` | Functions **only** | Enables memo drafting, Ask the records, and other `sample` calls. Never put this in the shim or `index.html`. |
| `ANTHROPIC_MODEL` | Functions, optional | Override the default model (`claude-sonnet-4-5`). |
| `ANTHROPIC_MODEL_COMPLEX` | Functions, optional | Model for `modelTier: "complex"` (role defs, long drafts). Defaults to `ANTHROPIC_MODEL`. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Functions **only** | Raw JSON (or base64 of that JSON) for a Google service account. Enables Drive search / read / upload. |
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

Copy `.env.example`. Data, AI, Drive, and voice functions **refuse** requests without a valid session cookie (issued after Supabase Auth). The applicants ingest function also accepts `X-HR-Ingest-Key` / `Authorization: Bearer` when `HR_APPLICANTS_INGEST_KEY` is set. Do not rely on a front-end-only password check. Do not invent a default ingest key in code.

**How to set env on Netlify (HR site `corcondev-hr`):**

1. Site configuration → Environment variables.
2. Add `ANTHROPIC_API_KEY` (Ask the records / memo draft) and `ELEVENLABS_API_KEY` (read-aloud). Optional: `ELEVENLABS_VOICE_ID`.
3. For the GoDaddy extractor, add `HR_APPLICANTS_INGEST_KEY` (long random string). Give that value to Jeffrey out of band — not git.
4. Scope them to **Production**. Never commit real keys.
5. Trigger a **redeploy** after changing keys so functions reload the env.
6. Confirm `GET /.netlify/functions/auth` (while signed in) shows `capabilities.sample: true` and `capabilities.tts: true`.

Extractor contract (URL, headers, field map, seed roles `ro01`–`ro10`): `docs/applicants-ingest.md`.

**One staff password.** HR uses the same Supabase email + password as [https://corcondev-portal.netlify.app](https://corcondev-portal.netlify.app). There is no separate HR site password in the default flow. After login, an httpOnly cookie keeps the PWA signed in (7 days, or until Sign out).

**Who can enter.** After Auth succeeds, the function reads `public.profiles` (same table as the portal). Only `role = admin`, `role = hr`, or `department = hr` receive a session. Other department logins get 403 — they can use the company portal, not this HR site.

**Drive operator notes**

1. Create a Google Cloud service account and download its JSON key.
2. Paste the JSON (one line is fine) into `GOOGLE_SERVICE_ACCOUNT_JSON` on this Netlify site. Alternatively paste base64 of the file so newlines in `private_key` survive the env editor.
3. Share every HR folder the artifact uses (201 ACTIVE / SEPARATED, inbox, memos, attendance, training manuals) with the service account email (`client_email` in the JSON). Viewer is enough to search and read; Content Manager (or Editor) is required to upload or create folders.
4. If those folders are in a Shared Drive, add the service account as a member of that Shared Drive. If they are in a user's My Drive, enable domain-wide delegation for the service account and set `GOOGLE_DRIVE_DELEGATED_USER` to that user's email.
5. After env vars change, redeploy (or restart) so functions pick them up.

Without `ANTHROPIC_API_KEY` the shim still resolves `sample` to `null` and the memo editor shows “AI drafting is not available in this view”. Without `GOOGLE_SERVICE_ACCOUNT_JSON`, `mcp` is `null` and Drive actions show the artifact’s own unavailable / `not_granted` copy. Without `OPENAI_API_KEY`, `transcribe` is `null` and the hold-to-talk controls are not shown. Without `ELEVENLABS_API_KEY`, `tts` is `null` and the read-aloud controls are not shown.

### 6. Access control

**App-level login (required):** `/.netlify/functions/auth` accepts the company-portal Supabase email/password, or a short-lived `access_token` from the portal HR deeplink (URL hash only). It then checks `profiles` and issues an httpOnly cookie. `/.netlify/functions/db`, `sample`, `drive`, `transcribe`, and `tts` return 401 without that cookie. `/.netlify/functions/applicants-ingest` accepts that cookie **or** `HR_APPLICANTS_INGEST_KEY`. The service role key, Anthropic key, OpenAI key, ElevenLabs key, ingest key, and service-account JSON never leave Netlify Functions.

**Portal handoff (`/app/hr`):** The company portal is a different Netlify host, so the Supabase cookie is not shared. If the staff member is already signed in on the portal, the HR CTA reads the browser session and navigates to `https://corcondev-hr.netlify.app/#access_token=…`. The hash is not sent to Netlify request logs. The shim posts that JWT to `auth`, then `history.replaceState` strips the hash. If handoff fails, the same email + password form works — there is no second gate password.

**Deprecated shared gate:** `HR_GATE_SECRET` is not a staff password anymore. Leave `HR_GATE_REQUIRED` unset. Only set `HR_GATE_REQUIRED=true` if you deliberately want the old shared-password method as an extra wall.

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

---

## What the shim provides

`window.claude.use(name)` returns a Promise **synchronously**.

| Capability | Behavior |
| --- | --- |
| `db` | `doc(path).get/set/delete/acquire` and `collection(name).get` / `onSnapshot` (one-shot + unsubscribe). Path: `collection/id`. |
| `downloads` | `save({ filename, data })` via object URL + `<a download>`. |
| `sample` | Anthropic-backed `sample(prompt, { modelTier, onText, tools, signal })` → `{ text, truncated? }`, plus `sample.json` and `sample.limits`. `null` until `ANTHROPIC_API_KEY` is set. Client-side tools (Ask the records) run in the browser; only schemas go to the function. |
| `mcp` | `callTool("Google Drive", tool, args)` for `search_files`, `read_file_content`, `create_file`. Responses use `{ payload: { files, text/content/fileContent, id, title, viewUrl, nextPageToken } }`. `null` until the service account env is set. Uploads larger than ~3MB are chunked through a resumable Drive session. |
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

The optional service worker caches icons and `pwa.css` only. It does **not** cache `index.html`, `claude-shim.js`, `hr-dictation.js`, `hr-memo.js`, `hr-attendance.js`, `hr-payroll.js`, `hr-tts.js`, `hr-recruit.js`, or `/.netlify/functions/*`, so auth, db, sample, Drive, dictation, memo chrome, attendance import, payroll, voice, and applicant ingest stay on the network.

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
  public/hr-recruit.js       ← Pipeline bulk import JSON (loaded by the shim)
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
  supabase/migrations/       ← docs + locks + RLS
```
