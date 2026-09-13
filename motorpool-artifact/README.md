# CorConDev Motorpool Portal

This folder is a **separate Netlify site** for the Corcondev Motorpool yard and office app. It is **not** the public company portal (the Next.js app at the repo root).

**Proposed Netlify site name:** `corcondev-motorpool`  
**Default URL:** [https://corcondev-motorpool.netlify.app](https://corcondev-motorpool.netlify.app)

The company portal Motorpool tile deep-links here via `NEXT_PUBLIC_MOTORPOOL_PORTAL_URL` (same pattern as HR).

Do **not** point the company portal build at this folder.

## What it is

Replaces the Google Apps Script + “Motorpool. Report” Sheet (46 tabs). Every movement of money is a numbered **VRF** (Vehicle Request Form) that carries both the money and the reason.

Two zones, per the owner: *“all the analytics of numbers be in the authenticator page. Main page is for my motorpool staff.”*

- **Yard** (staff): Yard board, Ask the log, Reminders, Reserves, New VRF, Fuel reserve, Workshop, Tasks, Store, VRF log, History, Fleet. Operational screens. No peso analytics.
- **Office** (soft passcode gate): Approvals, Spend, Fuel economics, Consumption, Inventory, Maintenance plan, Data health. Money and figures.

The office pass is a **soft gate**, stored as a SHA-256 hash. It is not a security boundary. Real access control is who the app link is shared with (and optional Netlify visitor protection).

**Never write the office pass into code, docs, tests, comments, or chat.** Store only a hash.

## Operator steps

### 1. Create a SEPARATE Netlify site

1. New site from this GitHub repo.
2. **Base directory:** `motorpool-artifact` (not the repo root).
3. Publish directory: `public` (already in `netlify.toml`).
4. Node 20 (already in `netlify.toml`).
5. Suggested site name: `corcondev-motorpool`.
6. Do not attach this folder to the company portal site.

### 2. Apply the SQL migration

In the Supabase SQL editor for the project this site will use, run:

`supabase/migrations/20260913000001_motorpool_docs.sql`

That creates `motorpool_docs`, `motorpool_locks`, `motorpool_allowed_collections`, RLS (no anonymous reads), and `acquire_motorpool_doc_lock`. Tables are separate from the HR artifact so one Supabase project can host both.

Timestamps are `timestamptz` (UTC). Display in **Asia/Manila**.

Collections: `master`, `ledger`, `ops`, `reserves`, `fuel`, `photos`, `config`.

Document paths:

| Path | Role |
| --- | --- |
| `master/units` | Fleet 201 |
| `master/worktypes` | 39 types / 10 families |
| `master/projects` | Empty until the owner imports |
| `master/suppliers` | System row `MOTORPOOL INVENTORY` |
| `master/staff` | Empty |
| `master/checklists` | Workshop / Admin + safe-work ticks |
| `master/papers` | CR, OR, combined OR+CR, insurance, deed |
| `ledger/{vrfNo}` | Optional numbered copies |
| `ledger/counter` | Short-lease VRF number allocator |
| `reserves/{id}` | Reserve → VRF money cycle |
| `ops/jo-*` `ops/task-*` `ops/reminder-*` `ops/activity-*` `ops/store-*` | Workshop, tasks, log |
| `fuel/{id}` | Fill-to-fill rows |
| `photos/{id}` | `{ kind: "photo" \| "link", … }` |
| `config/app` | Full-field writes only |

Reads are **frozen**. Thaw before mutate. `config/app` never accepts a merge.

There is **no production ledger** in this repo. The first load seeds a **small demo fleet** and empty masters so every view has a shell. Do not invent fake production pesos.

### 3. Environment variables

Site settings → Environment variables. Copy `.env.example`.

| Variable | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Functions | Supabase project URL |
| `SUPABASE_ANON_KEY` | Functions | Anon key (Auth login only, if enabled) |
| `SUPABASE_SERVICE_ROLE` | Functions **only** | Data plane. Never put this in the shim or `index.html`. |
| `MOTORPOOL_GATE_SECRET` | Functions, optional | Shared staff password **and** HMAC key for the httpOnly session cookie. If unset, the yard is open to anyone who has the link. |
| `MOTORPOOL_GATE_PASSWORD` | Functions, optional | Login password if you want `MOTORPOOL_GATE_SECRET` to be a signing key only |
| `SUPABASE_AUTH_ENABLED` | Functions, optional | Set to `true` to also accept Supabase email/password |
| `MOTORPOOL_OFFICE_PASS_HASH` | Functions, optional | SHA-256 **hex** of the office pass (64 lowercase hex chars). Never put the plaintext here. Generate locally: `printf '%s' 'your-pass' \| openssl dgst -sha256` |

If `MOTORPOOL_OFFICE_PASS_HASH` is unset, the owner can set a hash once from the Office gate (one-time setup). The field is cleared after submit and is never written in plaintext. The hash is stored on `config/app`.

Without Supabase env vars the site still loads: a **local demo** document store (browser storage) so staff can review the 19 views.

### 4. Access control

**Link sharing** is the real control.

**Optional staff gate:** `/.netlify/functions/auth` issues an httpOnly cookie when `MOTORPOOL_GATE_SECRET` is set. Data functions refuse requests without that cookie (unless the gate is unset).

**Office soft gate:** hashed pass, client and/or `/.netlify/functions/office` (`action: "check"` with a hash only — plaintext is rejected).

**Netlify visitor password (additional):**

- Site configuration → Access & security → Visitor access → **Password protection**.

### 5. Turn off Deploy Previews

This site must **not** be a casual public crawl target.

`netlify.toml` skips deploy-preview and branch-deploy builds via `ignore = "exit 0"`. Also do this in the UI:

1. Project configuration → Build & deploy → Continuous Deployment → Branches and deploy contexts
2. **Disable Deploy Previews**
3. Do not publish branch deploys

Privacy headers (`X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`) are set for `/*`. `public/robots.txt` disallows all crawlers.

### 6. Company portal deeplink

On the **company portal** Netlify site (repo root):

```bash
NEXT_PUBLIC_MOTORPOOL_PORTAL_URL=https://corcondev-motorpool.netlify.app
```

If unset, the Motorpool department tile uses that same default.

## Drive folder convention

Scans and proofs live in Drive per unit. Suggested tree (share the Motorpool root with the service account when Drive is wired):

```
Motorpool/
  Fleet 201/
    {unit-code}/
      papers/          ← CR, OR, OR+CR, insurance, deed
      photos/
  VRF/
  Workshop/
  Fuel/
  Store/
```

The 201 `driveFolder` field on each unit defaults to `Motorpool/Fleet 201/{code}`. This MVP stores photos in `photos/*` (data URL or link). Drive upload can follow the HR artifact `mcp` pattern later.

## Money cycle

1. Staff raise a **reserve** (job or fuel).
2. Owner **approves once** in Office → Approvals → a VRF number is assigned immediately (`ledger/counter` short lease). No second approval.
3. Staff spend / liquidate on **New VRF**; they may add lines and suppliers.
4. Close. If spent is **more than 10% over** approved → **Flagged** notice in Approvals (notice, not a block).

States: Requested, Approved, Rejected, Flagged, Closed.  
Kinds: `job` (no photo to close), `fuel-issue` (gauge + photo before approve), `fuel-bulk` (same).

Fuel: litres field only (never qty). Road units km/L; BH / RR / TM / MBC / Equipment L/hr. Fill-to-fill; drop bad intervals. Gates: reverse / no-move / under floor; litres >60% over average; rate >40% outside band; override with reason.

## Open decisions (do not invent an owner choice)

Stored on `config/app` and shown in Data health. Defaults:

| Setting | Default |
| --- | --- |
| Meter reading hard stop on fuel | off |
| Yard fuel monitoring tab | hidden |
| JO “For verification” in VRF work-ref dropdown | include In progress + For verification, exclude Closed |
| Spelling judgement | as-on-source |

## Local checks

```bash
cd motorpool-artifact
node --test
```

Functions need Netlify (`npx netlify dev --dir .`) plus the env vars above. Without them the static app still opens on a local file server (`npx serve public`).

## Install on iPhone

Add from **Safari** only.

1. Open [https://corcondev-motorpool.netlify.app](https://corcondev-motorpool.netlify.app) in Safari.
2. Complete the staff gate if it is enabled.
3. Tap **Share** → **Add to Home Screen**.
4. Keep the name **Motorpool** and tap **Add**.

The optional service worker caches icons and `pwa.css` only. It does **not** cache `index.html`, `claude-shim.js`, `/js/*`, or `/.netlify/functions/*`.

## Files

```
motorpool-artifact/
  netlify.toml
  public/index.html
  public/claude-shim.js
  public/js/            ← rules, worktypes, seed, db, app
  public/css/app.css
  public/pwa.js
  public/pwa.css
  netlify/functions/    ← auth, db, office
  netlify/lib/
  supabase/migrations/
  tests/
```

## What the shim provides

`window.claude.use(name)` returns a Promise **synchronously**.

| Capability | Behavior |
| --- | --- |
| `db` | `doc(path).get/set/delete/acquire` and `collection(name).get` / `onSnapshot`. Path: `collection/id`. |
| `downloads` | `save({ filename, data })` for standalone VRF HTML (no `window.print`). |
| anything else | `null` |

If functions are unreachable, the app keeps a local document store so the yard still works.

## Owner data import (still needed)

This MVP does **not** import the 46-tab production sheet. Data health is the placeholder door for a future xlsx path. Still needed from the owner:

- Full ~89-unit 201 (plates, papers, Drive folders)
- Live reserves / VRF ledger (real pesos — not invented here)
- Workshop / task history
- Store stock on hand
- Fuel fill history
- Project and supplier masters
- Source-sheet repairs mapped to these paths
