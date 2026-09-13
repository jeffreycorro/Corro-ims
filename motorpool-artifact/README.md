# CorConDev Motorpool artifact host

This folder is a **separate Netlify site** that hosts the existing Claude Motorpool single-file app behind a shim. It is **not** the public company portal (the Next.js app at the repo root).

**Proposed Netlify site name:** `corcondev-motorpool`  
**Default URL:** [https://corcondev-motorpool.netlify.app](https://corcondev-motorpool.netlify.app)

The company portal Motorpool tile deep-links here via `NEXT_PUBLIC_MOTORPOOL_PORTAL_URL` (same pattern as HR).

Do **not** rewrite, minify, or modernize the HTML artifact. Paste the Claude export as-is, then keep the shim tags.

## Operator steps

### 1. The Claude export lives here

`public/index.html` **is** the Claude Motorpool artifact HTML (title **Corcondev Motorpool**, Yard / Office / VRF). That file is the app. There is no parallel from-scratch Motorpool UI.

Claude source: `https://claude.ai/code/artifact/3a323463-eec0-433e-a6e4-d18dbfe5b0f1`

**If Jeffrey or Builder supplies a newer export**, put it in **one** of these places, then keep only `public/index.html`:

```
motorpool-artifact/public/index.html     ← publish directory (this is what Netlify serves)
motorpool-artifact/index.html            ← if it lands here, move it to public/index.html
```

`netlify.toml` publish directory is `public`. Do not change that unless the HTML is the only file you want at the folder root — even then, prefer moving the file into `public/` so shim / PWA / companion scripts stay next to it.

Do not drop a second app beside it. Do not commit a parallel Motorpool UI.

### Redeploy when the artifact HTML is updated

1. Replace `motorpool-artifact/public/index.html` with the new Claude export (or move `motorpool-artifact/index.html` there).
2. Keep the shim + PWA tags **first** in `<head>` (see step 2). Do not rewrite, minify, or restyle the rest of the file.
3. Commit and push to the branch that the `corcondev-motorpool` Netlify site tracks (usually `main` after merge).
4. Netlify rebuilds the **separate** site (base directory `motorpool-artifact`, publish `public`). Replacing the HTML and pushing **is** the app redeploy — there is no SPA build step.
5. Confirm the live title is still **Corcondev Motorpool** and that Yard / Office / VRF still render. If you added a new companion script, add its `<script>` tag only in the host wrapper, not by editing artifact logic.

### 2. Keep the shim tags (one-step wrap)

Inside `<head>` of that real `index.html`, **before any other scripts**, keep:

```html
<script src="/claude-shim.js"></script>
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/favicon.svg">
<link rel="stylesheet" href="/pwa.css">
<script src="/pwa.js"></script>
```

`window.claude.use(name)` is implemented by `public/claude-shim.js` and must load first. Do not rewrite the rest of the artifact. The shim then loads `motorpool-host.js`, which silently no-ops `prompt` / `confirm` / `alert` / `print` (the host cannot rely on those). `pwa.js` / `pwa.css` only add iOS Home Screen tags and a scoped mobile overlay.

### 3. Apply the SQL migration

In the Supabase SQL editor for the project this site will use, run:

`supabase/migrations/20260913000001_motorpool_docs.sql`

That creates `motorpool_docs`, `motorpool_locks`, `motorpool_allowed_collections`, RLS (no anonymous reads), and `acquire_motorpool_doc_lock`. Tables are separate from the HR artifact so one Supabase project can host both.

Timestamps are `timestamptz` (UTC). Display in **Asia/Manila**.

Collections the artifact writes: `master`, `ledger`, `ops`, `reserves`, `fuel`, `photos`, `config`.

Document paths (from the build brief — do not invent others):

| Path | Holds |
| --- | --- |
| `master/vehicles` | `{rows:[unit]}` |
| `master/parts` `master/items` `master/worktypes` | Catalogs |
| `master/suppliers` `master/projects` `master/drivers` | Lookups |
| `fuel/purchases` `fuel/withdrawals` | Bulk / drum |
| `ledger/<YYYY-MM>` `ledger/index` | VRF lines |
| `ops/mechanic` `ops/tasks` `ops/breakdowns` `ops/papers` `ops/photoindex` | Workshop, tasks, papers |
| `reserves/<YYYY>` `reserves/index` | Reserves |
| `photos/<key>` | `{kind:"photo"| "link", …}` |
| `config/app` | Full-field writes: `nextVrf`, `pass` (hash only), `fuel`, `varianceTol`, `nextReserve`, `driveFolder` |
| `config/counter` `config/rsvcounter` | Short-lease number allocation |

Reads come back **frozen**. Thaw before mutate (`JSON.parse(JSON.stringify(v))`). A partial write to `config/app` erases the other fields.

There is **no production ledger** in this repo. Restore live data **inside the artifact** (or a future Settings restore). Never commit a dump or invent pesos.

### 4. Create a SEPARATE Netlify site

1. New site from this GitHub repo.
2. **Base directory:** `motorpool-artifact` (not the repo root).
3. Publish directory: `public` (already in `netlify.toml`).
4. Node 20 (already in `netlify.toml`).
5. Suggested site name: `corcondev-motorpool`.
6. Do not attach this folder to the company portal site.

### 5. Environment variables

Site settings → Environment variables. Copy `.env.example`.

| Variable | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Functions | Supabase project URL |
| `SUPABASE_ANON_KEY` | Functions | Anon key (Auth login only, if enabled) |
| `SUPABASE_SERVICE_ROLE` | Functions **only** | Data plane. Never put this in the shim or `index.html`. |
| `MOTORPOOL_GATE_SECRET` | Functions, optional | Shared staff password **and** HMAC key for the httpOnly session cookie. If unset, the yard is open to anyone who has the link. |
| `MOTORPOOL_GATE_PASSWORD` | Functions, optional | Login password if `MOTORPOOL_GATE_SECRET` is a signing key only |
| `SUPABASE_AUTH_ENABLED` | Functions, optional | Set `true` to also accept Supabase email/password |
| `MOTORPOOL_OFFICE_PASS_HASH` | Functions, optional | SHA-256 **hex** of the office pass (64 lowercase hex chars). Never put the plaintext here. Generate locally: `printf '%s' 'your-pass' \| openssl dgst -sha256` |

The artifact also stores an office hash on `config/app.pass` after the owner sets it in-app. That field is a hash. **Never write the office pass into code, docs, tests, comments, or chat.**

Without Supabase env vars the artifact still opens and uses its **local** document store (`#dbBadge` shows `local`).

### 6. Access control

**Link sharing** is the real control.

**Optional staff gate:** `/.netlify/functions/auth` issues an httpOnly cookie when `MOTORPOOL_GATE_SECRET` is set.

**Office soft gate:** hashed pass in the artifact (`config/app.pass`) and/or `MOTORPOOL_OFFICE_PASS_HASH` on the host (`/.netlify/functions/office` accepts a hash only — plaintext is rejected).

**Netlify visitor password (additional):** Site configuration → Access & security → Visitor access → **Password protection**.

### 7. Turn off Deploy Previews

This site must **not** be a casual public crawl target.

`netlify.toml` skips deploy-preview and branch-deploy builds via `ignore = "exit 0"`. Also do this in the UI:

1. Project configuration → Build & deploy → Continuous Deployment → Branches and deploy contexts
2. **Disable Deploy Previews**
3. Do not publish branch deploys

Privacy headers (`X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`) are set for `/*`. `public/robots.txt` disallows all crawlers.

### 8. Company portal deeplink

On the **company portal** Netlify site (repo root):

```bash
NEXT_PUBLIC_MOTORPOOL_PORTAL_URL=https://corcondev-motorpool.netlify.app
```

If unset, the Motorpool department tile uses that same default.

## Drive folder convention

Scans live in Drive, one subfolder per unit, named `CODE<tab>DESCRIPTION<tab>PLATE`. Backhoes sit one level deeper under `BACKHOE`. Filenames loosely follow `CODE-PLATE-DOCTYPE YEAR.pdf`. The unit folders are the source of truth.

Suggested root (share with the service account when Drive is wired):

```
Motorpool/
  Fleet 201/
    {CODE}<tab>{DESCRIPTION}<tab>{PLATE}/
  VRF/
  Workshop/
  Fuel/
  Store/
```

Each unit record stores its Drive folder link. This host stores photos in `photos/*` (photo data or link) the same way the artifact already does.

## What the shim provides

`window.claude.use(name)` returns a Promise **synchronously**.

| Capability | Behavior |
| --- | --- |
| `db` | `doc(path).get/set/delete/acquire` and `collection(name).get` / `onSnapshot`. Path: `collection/id`. |
| `downloads` | `save({ filename, data })` for standalone VRF HTML (the artifact does not rely on `window.print` in the host). |
| `sample` | `null` until an Anthropic key is added later |
| anything else | `null` |

If functions are unreachable, the artifact keeps its local store.

## Rule tests (not a rewrite)

`tests/lib/rules.js` copies a few **artifact** rules so we can test them without opening the 400KB HTML. Those files are not served.

- frozen reads → thaw before mutate
- `isFuel` requires `^\s*fuel\s*[—–-]`
- plant papers: code `BH-` / `RR-` or blank / `NA` plate → deed only; exclude sold / AV / Equipment n
- variance >10% → Flagged notice, not a block

Do not treat those files as a second Motorpool UI.

## Open decisions (do not invent an owner choice)

The artifact already exposes these as settings. Defaults stay until the owner decides:

- Meter reading hard stop on fuel
- Yard fuel monitoring tab
- JO “For verification” in the VRF work-ref dropdown
- Three spelling judgement calls (DELO 18L vs 1L, Emission Testing Center vs JVP, 315 Auto Parts Branch vs Branch 2)

## Local checks

```bash
cd motorpool-artifact
node --test
```

Functions need Netlify (`npx netlify dev --dir .`) plus the env vars above. Without them, `npx serve public` still opens the artifact (local store).

## Install on iPhone

Add from **Safari** only.

1. Open [https://corcondev-motorpool.netlify.app](https://corcondev-motorpool.netlify.app) in Safari.
2. Complete the staff gate if it is enabled.
3. Tap **Share** → **Add to Home Screen**.
4. Keep the name **Motorpool** and tap **Add**.

The optional service worker caches icons and `pwa.css` only. It does **not** cache `index.html`, `claude-shim.js`, `motorpool-host.js`, or `/.netlify/functions/*`.

## Files

```
motorpool-artifact/
  netlify.toml               ← publish = public
  public/index.html          ← Claude export + shim tags (the app)
  public/claude-shim.js
  public/motorpool-host.js   ← blocks prompt/confirm/alert/print
  public/pwa.js
  public/pwa.css
  netlify/functions/         ← auth, db, office
  netlify/lib/
  supabase/migrations/
  tests/                     ← thaw, isFuel, papers, variance, host
  tests/lib/                 ← rule copies only — not a second UI
```

## Owner data import (still needed)

The artifact can run on a local store. Production still needs the owner to restore:

- Full ~89-unit 201 (plates, papers, Drive folders)
- Live VRF ledger (real pesos — not invented here)
- Workshop / task history
- Store stock
- Fuel fill history
- Project / supplier / driver masters
- Source-sheet repairs already described in the brief (day/month swap, isFuel dash)
