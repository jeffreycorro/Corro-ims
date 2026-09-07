# CorConDev HR artifact host

This folder is a **separate Netlify site** that hosts the existing Claude single-file HR app behind a shim. It is **not** the public company portal (the Next.js app at the repo root).

Do **not** rewrite, minify, or modernize the HTML artifact. Paste the Claude export as-is, then add one script tag.

## Operator steps

### 1. Paste the real artifact

Replace `public/index.html` with the Claude artifact HTML export (~1.2MB). The file in this repo is a placeholder only.

### 2. Inject the shim (one-line change)

Inside `<head>` of that real `index.html`, **before any other scripts**, add:

```html
<script src="/claude-shim.js"></script>
```

That is the only edit to the artifact. `window.claude.use(name)` is implemented by `public/claude-shim.js` and must load first.

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

Copy `.env.example`. Data functions **refuse** requests without a valid gate cookie. Do not rely on a front-end-only password check.

### 6. Access control (two layers)

**App-level gate (required):** `/.netlify/functions/auth` issues an httpOnly cookie after the shared password or Supabase Auth succeeds. `/.netlify/functions/db` returns 401 without that cookie. The service role key never leaves Netlify Functions.

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
| `sample` | `null` (AI features stay hidden). |
| `mcp` | `null` (Drive stays off; the artifact should hide or show its own unavailable state). |
| anything else | `null` |

`acquire({ holder })` calls the `acquire_doc_lock` RPC. A second holder with an unexpired lock gets `acquired: false`.

## Local checks

```bash
cd hr-artifact
node --test
```

Functions need Netlify (`npx netlify dev --dir .`) plus the env vars above. Without `index.html` replaced, you only see the placeholder operator note.

## Files

```
hr-artifact/
  netlify.toml
  public/index.html          ← replace with Claude export
  public/claude-shim.js
  public/robots.txt
  netlify/functions/auth.js
  netlify/functions/db.js
  netlify/lib/               ← session, supabase, locks, collections
  supabase/migrations/       ← docs + locks + RLS
```
