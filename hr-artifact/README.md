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

`window.claude.use(name)` is implemented by `public/claude-shim.js` and must load first. Do not rewrite the rest of the artifact. `pwa.js` / `pwa.css` only add iOS Home Screen tags and a scoped mobile overlay. The shim then loads `hr-dictation.js` (hold-to-talk when `OPENAI_API_KEY` is set), `hr-memo.js` (issued / on-paper memoranda open as saved records, not blank drafts), and `hr-payroll.js` (Payroll Maker, contributions, holiday calendar, Daily Manpower Hol/OT + change history). Do not rewrite the artifact to add mic buttons, memo chrome, or a parallel payroll app.

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
| `SUPABASE_URL` | Functions | Supabase project URL |
| `SUPABASE_ANON_KEY` | Functions | Anon key (Auth login only, if enabled) |
| `SUPABASE_SERVICE_ROLE` | Functions **only** | Data plane. Never put this in the shim, `index.html`, or any public env. |
| `HR_GATE_SECRET` | Functions | Shared staff password **and** HMAC key for the httpOnly session cookie |
| `HR_GATE_PASSWORD` | Functions, optional | Login password if you want `HR_GATE_SECRET` to be a signing key only |
| `SUPABASE_AUTH_ENABLED` | Functions, optional | Set to `true` to also accept Supabase email/password (or `access_token`) |
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

Copy `.env.example`. Data, AI, and Drive functions **refuse** requests without a valid gate cookie. Do not rely on a front-end-only password check.

**Drive operator notes**

1. Create a Google Cloud service account and download its JSON key.
2. Paste the JSON (one line is fine) into `GOOGLE_SERVICE_ACCOUNT_JSON` on this Netlify site. Alternatively paste base64 of the file so newlines in `private_key` survive the env editor.
3. Share every HR folder the artifact uses (201 ACTIVE / SEPARATED, inbox, memos, attendance, training manuals) with the service account email (`client_email` in the JSON). Viewer is enough to search and read; Content Manager (or Editor) is required to upload or create folders.
4. If those folders are in a Shared Drive, add the service account as a member of that Shared Drive. If they are in a user's My Drive, enable domain-wide delegation for the service account and set `GOOGLE_DRIVE_DELEGATED_USER` to that user's email.
5. After env vars change, redeploy (or restart) so functions pick them up.

Without `ANTHROPIC_API_KEY` the shim still resolves `sample` to `null` and the memo editor shows “AI drafting is not available in this view”. Without `GOOGLE_SERVICE_ACCOUNT_JSON`, `mcp` is `null` and Drive actions show the artifact’s own unavailable / `not_granted` copy. Without `OPENAI_API_KEY`, `transcribe` is `null` and the hold-to-talk controls are not shown.

### 6. Access control (two layers)

**App-level gate (required):** `/.netlify/functions/auth` issues an httpOnly cookie after the shared password or Supabase Auth succeeds. `/.netlify/functions/db`, `sample`, `drive`, and `transcribe` return 401 without that cookie. The service role key, Anthropic key, OpenAI key, and service-account JSON never leave Netlify Functions.

**Netlify visitor password / Identity (additional):**

- Site configuration → Access & security → Visitor access → **Password protection** (or Identity).
- This stops casual URL guessing before the app gate runs.

### 7. Turn off Deploy Previews

This site must **not** be a casual public crawl target. Preview URLs leak private HR UI.

`netlify.toml` skips deploy-preview and branch-deploy builds via `ignore = "exit 0"`. Also do this in the UI (Netlify does not always honor ignore alone):

1. Project configuration → Build & deploy → Continuous Deployment → Branches and deploy contexts
2. **Disable Deploy Previews**
3. Do not publish branch deploys

Privacy headers (`X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`) are set for `/*`. `public/robots.txt` disallows all crawlers.

### 8. Restore data

After deploy, open the site, pass the gate, and restore the backup JSON from **Settings in the artifact**. Never commit backup JSON.

---

## What the shim provides

`window.claude.use(name)` returns a Promise **synchronously**.

| Capability | Behavior |
| --- | --- |
| `db` | `doc(path).get/set/delete/acquire` and `collection(name).get` / `onSnapshot` (one-shot + unsubscribe). Path: `collection/id`. |
| `downloads` | `save({ filename, data })` via object URL + `<a download>`. |
| `sample` | Anthropic-backed `sample(prompt, { modelTier, onText, tools, signal })` → `{ text, truncated? }`, plus `sample.json` and `sample.limits`. `null` until `ANTHROPIC_API_KEY` is set. Client-side tools (Ask the records) run in the browser; only schemas go to the function. |
| `mcp` | `callTool("Google Drive", tool, args)` for `search_files`, `read_file_content`, `create_file`. Responses use `{ payload: { files, text/content/fileContent, id, title, viewUrl, nextPageToken } }`. `null` until the service account env is set. Uploads larger than ~3MB are chunked through a resumable Drive session. |
| `transcribe` | OpenAI-backed `transcribe({ audio, mimeType, language, signal })` → `{ text }`. Hold-to-talk on memo draft / reminder / Ask fields is attached by `hr-dictation.js` (loaded by the shim). `null` until `OPENAI_API_KEY` is set. Issued / Drive-imported memos are treated as saved records by `hr-memo.js` (also loaded by the shim). Payroll Maker, contributions, the holiday calendar, and the attendance edit log are attached by `hr-payroll.js` (also loaded by the shim). |
| anything else | `null` |

`acquire({ holder })` calls the `acquire_doc_lock` RPC. A second holder with an unexpired lock gets `acquired: false`.

## Local checks

```bash
cd hr-artifact
node --test
```

Functions need Netlify (`npx netlify dev --dir .`) plus the env vars above. AI, Drive, and dictation stay off until their keys are set; the rest of the artifact still loads.

## Install on iPhone (HR staff)

This HR site is a Progressive Web App. Add it from **Safari** only.

1. Open [https://corcondev-hr.netlify.app](https://corcondev-hr.netlify.app) in Safari.
2. Complete the staff gate (shared password or Supabase login). The Home Screen icon opens `/` and will show the gate again if the session cookie is gone.
3. Tap **Share** → **Add to Home Screen**.
4. Keep the name **HR Portal** and tap **Add**.
5. Open the icon. It should launch full-screen with the navy “C” icon.

If a Netlify visitor password is also enabled, Safari may prompt for that before the in-app gate. That is expected.

The optional service worker caches icons and `pwa.css` only. It does **not** cache `index.html`, `claude-shim.js`, `hr-dictation.js`, `hr-memo.js`, `hr-payroll.js`, or `/.netlify/functions/*`, so auth, db, sample, Drive, dictation, memo chrome, and payroll stay on the network.

## Files

```
hr-artifact/
  netlify.toml
  public/index.html          ← replace with Claude export
  public/claude-shim.js
  public/hr-dictation.js     ← hold-to-talk UI (loaded by the shim)
  public/hr-memo.js          ← issued / on-paper memo editor (loaded by the shim)
  public/hr-payroll.js       ← Payroll Maker, contributions, holiday calendar, attendance edit log
  public/pwa.js              ← apple / manifest tags + viewport-fit
  public/pwa.css             ← mobile / safe-area overlay
  public/manifest.json
  public/sw.js               ← icon/CSS shell only
  public/apple-touch-icon.png
  public/robots.txt
  netlify/functions/auth.js
  netlify/functions/db.js
  netlify/functions/sample.js
  netlify/functions/drive.js
  netlify/functions/transcribe.js
  netlify/lib/               ← session, supabase, locks, collections, Anthropic, Drive, OpenAI
  supabase/migrations/       ← docs + locks + RLS
```
