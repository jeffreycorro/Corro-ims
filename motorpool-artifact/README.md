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

`supabase/migrations/20260913000001_motorpool_docs.sql` (and `20260914000001_motorpool_builds.sql` if that first file was already applied).

That creates `motorpool_docs`, `motorpool_locks`, `motorpool_allowed_collections`, RLS (no anonymous reads), and `acquire_motorpool_doc_lock`. Tables are separate from the HR artifact so one Supabase project can host both.

Timestamps are `timestamptz` (UTC). Display in **Asia/Manila**.

Collections the artifact writes: `master`, `ledger`, `ops`, `reserves`, `fuel`, `photos`, `config`, and `builds` (the host registers `{build, seq}` for the page `BUILD` so the newer-version banner never shows blank labels).

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
| `builds/<BUILD>` | `{build, seq}` — host writes once per BUILD so the newer-version banner can compare real labels |

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
| `SUPABASE_URL` | Functions | Same Supabase project as the company portal |
| `SUPABASE_ANON_KEY` | Functions | Anon key for staff email/password (and portal handoff JWT). Never the service role. |
| `SUPABASE_SERVICE_ROLE` | Functions **only** | Data plane + server-side profile lookup. Never put this in the shim or `index.html`. |
| `MOTORPOOL_SESSION_SECRET` | Functions, optional | HMAC key for the httpOnly session cookie. If unset, `MOTORPOOL_GATE_SECRET` or a hash of `SUPABASE_SERVICE_ROLE` is used. |
| `MOTORPOOL_GATE_SECRET` | Functions, **deprecated** | No longer a login password. Kept only as a fallback cookie HMAC key. Ignored as a door unless `MOTORPOOL_GATE_REQUIRED=true`. |
| `MOTORPOOL_GATE_REQUIRED` | Functions, optional | Default **off**. Set `true` only if you still want the old shared-password wall as an extra method. |
| `MOTORPOOL_GATE_PASSWORD` | Functions, optional | Shared password used only when `MOTORPOOL_GATE_REQUIRED=true`. |
| `SUPABASE_AUTH_ENABLED` | Functions, optional | Default **on** when URL + anon key are set. Set `false` only to disable Auth. |
| `MOTORPOOL_OPEN_YARD` | Functions, optional | Local / demo only. When `true`, the yard stays open even if Auth is configured. Leave unset on production. |
| `MOTORPOOL_OFFICE_PASS_HASH` | Functions, optional | SHA-256 **hex** of the office pass (64 lowercase hex chars). Never put the plaintext here. Generate locally: `printf '%s' 'your-pass' \| openssl dgst -sha256` |
| `APPROVE_VRF_SECRET` (or `MOTORPOOL_APPROVE_SECRET`) | Functions **only** | Shared secret for `/.netlify/functions/approve-vrf`. Noah/Builder send it instead of the Office passcode. Never commit the value. See **Gated approve-vrf API** below. |
| `ANTHROPIC_API_KEY` | Functions **only** | Enables Ask the log (`claude.use("sample")`). Never put this in the shim or `index.html`. |
| `ANTHROPIC_MODEL` | Functions, optional | Override the default model (`claude-sonnet-4-5`). |
| `OPENAI_API_KEY` | Functions **only** | Enables Ask the log hold-to-talk (`claude.use("transcribe")`). Never commit the key. Without it, the mic falls back to the browser Web Speech API. |
| `OPENAI_TRANSCRIBE_MODEL` | Functions, optional | Override the first transcription model (default chain `gpt-transcribe` → `gpt-4o-transcribe` → `whisper-1`). |
| `ELEVENLABS_API_KEY` | Functions **only** | Enables Ask the log readback (`claude.use("tts")`). Never commit the key. |
| `ELEVENLABS_VOICE_ID` | Functions, optional | Override the default ElevenLabs voice. Code default is **Sarah** (`EXAVITQu4vr4xnSDxMaL`) — warmer conversational readback. Previous default was Rachel `21m00Tcm4TlvDq8ikWAM`. |
| `ELEVENLABS_MODEL_ID` | Functions, optional | Override the TTS model (default `eleven_multilingual_v2` for English / Filipino / Cebuano). For snappier English-only replies: `eleven_turbo_v2_5`. |
| `ELEVENLABS_STABILITY` / `ELEVENLABS_SIMILARITY` | Functions, optional | 0–1 conversational tuning (defaults `0.42` / `0.82`). |

The artifact also stores an office hash on `config/app.pass` after the owner sets it in-app. That field is a hash. **Never write the office pass into code, docs, tests, comments, or chat.**

Without `SUPABASE_URL` / `SUPABASE_ANON_KEY` the artifact still opens (open yard / local store — `#dbBadge` shows `local`). When those Auth keys **are** set, the yard is closed unless `MOTORPOOL_OPEN_YARD=true`.

**How to set env on Netlify (Motorpool site `corcondev-motorpool`):**

1. Site configuration → Environment variables.
2. Add `ANTHROPIC_API_KEY` (Ask the log), `ELEVENLABS_API_KEY` (read-aloud), and `OPENAI_API_KEY` (hold-to-talk). Optional: `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`.
3. Scope them to **Production** (and Local if you use `netlify dev`). Same values as in `.env.example` — never commit real keys.
4. Trigger a **redeploy** after changing keys so functions reload the env.
5. Confirm `GET /.netlify/functions/auth` shows `capabilities.sample: true`, `capabilities.tts: true`, and `capabilities.transcribe: true` (and `open: false` once Auth keys are set). `/.netlify/functions/sample`, `/tts`, and `/transcribe` must exist (not 404).

Without `ANTHROPIC_API_KEY` the shim still resolves `sample` to `null` and Ask the log shows “The assistant is not available in this view.” Without `ELEVENLABS_API_KEY`, `tts` is `null` and the page falls back to the device’s Web Speech voices. Without `OPENAI_API_KEY`, hold-to-talk still works via the browser speech recognizer.

### Gated approve-vrf API (Noah / Builder after Jeffrey yes)

`POST /.netlify/functions/approve-vrf` does **one** thing: approve a single named pending VRF (hold status **Requested** — waiting for approval) so it posts to the ledger with `vstatus: Open`, the same write as Office → Approvals → Approve. It does not list, reject, edit amounts, or mint a new number. Uniqueness remint from PR #54 still runs if that hold collides with an already-posted VRF.

This endpoint does **not** use the Office passcode or a browser session cookie. The env secret replaces the Office pass for this one action only.

**Jeffrey — set the secret on Netlify `corcondev-motorpool`, then redeploy:**

1. Site configuration → Environment variables.
2. Add `APPROVE_VRF_SECRET` (or `MOTORPOOL_APPROVE_SECRET`). Scope **Functions** / Production. Generate a long random string locally — do not paste it into git, chat, or the artifact.
3. Trigger a **redeploy** so the function reloads the env.
4. After Jeffrey’s per-VRF **yes**, Builder/Noah call the endpoint with that secret + the VRF number only.

**Example curl**

```bash
curl -sS -X POST 'https://corcondev-motorpool.netlify.app/.netlify/functions/approve-vrf' \
  -H 'Authorization: Bearer '"$APPROVE_VRF_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"vrf":"5812","approverNote":"jeffrey-yes via Noah"}'
```

`X-Approve-Secret: …` is accepted instead of `Authorization`. Body may use `"vrfNumber": 5812` or `"vrf":"RSV-12"` (reserve-number form). Wrong or missing secret → `401`. Missing VRF → `404`. Already posted or ambiguous duplicate → `409`. The function never logs the secret.

**Builder / Noah call pattern (after Jeffrey yes):** do not open a remote browser and do not type the Office pass. POST `{ "vrf": "<held number>" }` with the secret. Optional `approverNote` is stored on the reserve (`approvedVia: "api"`). Full notes: [`docs/approve-vrf-api.md`](docs/approve-vrf-api.md).

### 6. Access control

**App-level login (required when Auth is configured):** `/.netlify/functions/auth` accepts the company-portal Supabase email/password, or a short-lived `access_token` from the portal Motorpool deeplink (URL hash only). It then checks `profiles` and issues an httpOnly cookie. `/.netlify/functions/db`, `sample`, `transcribe`, `tts`, and `office` return 401 without that cookie. The service role key, Anthropic key, OpenAI key, and ElevenLabs key never leave Netlify Functions.

**One staff password.** Motorpool uses the same Supabase email + password as [https://corcondev-portal.netlify.app](https://corcondev-portal.netlify.app). There is no separate Motorpool site password in the default flow. After login, an httpOnly cookie keeps the PWA signed in (7 days, or until Sign out).

**Who can enter.** After Auth succeeds, the function reads `public.profiles` (same table as the portal). Only `role = admin` or `department = motorpool` receive a session. Other department logins get 403 — they can use the company portal, not this Motorpool site. Portal departments are `admin`, `technical`, `finance`, `procurement`, `motorpool`, `safety`, `site`, `hr`. Roles are `staff`, `dept_lead`, `hr`, `admin`. There is no operations department.

**Portal handoff (`/app/motorpool`):** The company portal is a different Netlify host, so the Supabase cookie is not shared. If the staff member is already signed in on the portal, the Motorpool CTA reads the browser session and navigates to `https://corcondev-motorpool.netlify.app/#access_token=…`. The hash is not sent to Netlify request logs. The shim posts that JWT to `auth`, then `history.replaceState` strips the hash. If handoff fails, the same email + password form works — there is no second gate password.

**Open yard (local / demo only):** If `SUPABASE_URL` and `SUPABASE_ANON_KEY` are unset, or `MOTORPOOL_OPEN_YARD=true`, the yard stays open. Do not set `MOTORPOOL_OPEN_YARD` on production (`corcondev-motorpool`).

**Office soft gate (separate):** hashed pass in the artifact (`config/app.pass`) and/or `MOTORPOOL_OFFICE_PASS_HASH` on the host (`/.netlify/functions/office` accepts a hash only — plaintext is rejected). This is the figures-zone pass, not staff login.

**Approve-vrf API (separate, secret only):** `/.netlify/functions/approve-vrf` does **not** use the staff cookie or the Office passcode. After Jeffrey’s per-VRF yes, Builder/Noah POST the VRF number plus `APPROVE_VRF_SECRET`. See the section below.

**Deprecated shared gate:** `MOTORPOOL_GATE_SECRET` is not a staff password anymore. Leave `MOTORPOOL_GATE_REQUIRED` unset. Only set `MOTORPOOL_GATE_REQUIRED=true` if you deliberately want the old shared-password method as an extra wall.

**Netlify visitor password / Identity (optional extra, not the staff login):** Site configuration → Access & security → Visitor access → **Password protection**.

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

If unset, the Motorpool department tile uses that same default. When staff are already signed in on the portal, that tile hands off `#access_token=…` the same way the HR tile does.

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
| `sample` | Anthropic-backed `sample(prompt, { modelTier, onText, tools, signal })` → `{ text, truncated? }`, plus `sample.json` and `sample.limits`. `null` until `ANTHROPIC_API_KEY` is set. Yard Ask the log has no Office peso figures — the artifact already scopes that. |
| `transcribe` | OpenAI-backed `transcribe({ audio, mimeType })` → `{ text }`. Hold-to-talk on Ask the log uses this when granted (`motorpool-ask-voice.js`). `null` until `OPENAI_API_KEY` is set. |
| `tts` | ElevenLabs-backed `tts(text)` → `{ audioBase64, mimeType }`. The artifact’s existing `speak` / `utter` / `voiceOut` hooks use this when granted (`motorpool-tts.js`). `null` until `ELEVENLABS_API_KEY` is set. |
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

## Verify after deploy (corcondev-motorpool)

After this folder merges to the branch the **separate** Motorpool Netlify site tracks (usually `main`):

1. Confirm the live Ask / footer BUILD is **2026-09-23 b** (hard refresh if a service worker or tab still shows `2026-09-23 a`).
2. **Job order and Tasks proof:** open a job order and a task. Each proof section has **Attach from this device** (photo or video from the phone gallery or computer) and the existing link field. A chosen photo shows in the proof strip. A short video plays there. **Attach proof** / **Attach the link** still saves a pasted https URL. A video over 3 MB asks for a link instead of failing silently.
3. **New VRF:** the only primary action is **Send for approval**. There is no **Post VRF** button. Staff cannot skip Jeffrey’s office approval.
4. After deploy, open Office → Approvals. If a pending VRF still shows **58528** beside an already-posted 58528, refresh once — boot remints the pending hold to the next free number and leaves the posted ledger row untouched.
5. **New VRF → Vehicle code:** type a unit that has an assigned site. Project fills as a default. Change the project to another code — it must stay editable and keep the override. Clearing the project to type a different one must not snap back to the unit site.
6. **New VRF fuel line:** pick `Fuel — Diesel` and a station/supplier (not FUEL RESERVE). Send for approval — the reserve log chip should read **Fuel Purchase**, not **Fuel Reserve**. FUEL RESERVE is labelled *drum dispense (not a purchase)* and sits after the real suppliers.
7. **Fuel tab:** two cards — **Fuel Reserve — dispense from the drums** and **Fuel Purchase — record a bulk delivery**.
8. **VRF log:** newest form at the top (date, then VRF number). Subtitle is **Newest first**. A VRF sent for approval appears immediately as **Requested — FOR APPROVAL**. Opening it shows the attached photos. **Print / save as PDF** (and the log-row Print button) works with that VRF number before Jeffrey approves. The printed form has a diagonal **FOR APPROVAL** watermark on every page until it is approved; after office approval / Open / posted the watermark is **APPROVED**.
9. **approve-vrf API:** after `APPROVE_VRF_SECRET` is set and the site is redeployed, a wrong secret must `401` and a missing VRF must `404`. Do not put the real secret in the repo.
10. **Odometer:** on New VRF, type a meter reading and send for approval. Open, print, and the VRF log for that number show the same reading. A second VRF keeps its own reading.
11. **Liquidate:** an approved VRF that is still open (including an approved hold such as 5795 that never landed in the ledger) shows **Liquidate** on the log row and in the VRF sheet. A Requested / FOR APPROVAL VRF does not. A closed VRF does not gain a new liquidate path.
12. **Prepared/Purchased By:** on New VRF, attach an e-signature JPEG (filename sophie, batas, prepared, or purchased) and leave **Apply on this VRF** checked. The printed form shows that signature in the Prepared/Purchased By slot only.

HR and Materials are out of scope.

## Install on iPhone

Add from **Safari** only.

1. Open [https://corcondev-motorpool.netlify.app](https://corcondev-motorpool.netlify.app) in Safari.
2. Sign in with the company portal email and password (or accept the portal handoff).
3. Tap **Share** → **Add to Home Screen**.
4. Keep the name **Motorpool** and tap **Add**.

The optional service worker caches icons and `pwa.css` only. It does **not** cache `index.html`, `claude-shim.js`, `motorpool-host.js`, `motorpool-tts.js`, `motorpool-ask-voice.js`, `motorpool-ask-attach.js`, `motorpool-ask-leave.js`, or `/.netlify/functions/*`.

## Files

```
motorpool-artifact/
  netlify.toml               ← publish = public
  public/index.html          ← Claude export + shim tags (the app)
  public/claude-shim.js
  public/motorpool-host.js   ← blocks prompt/confirm/alert/print; registers builds/
  public/pwa.js
  public/pwa.css
  public/motorpool-tts.js    ← ElevenLabs readback; Stop talking cuts playback (loaded by the shim)
  public/motorpool-ask-voice.js ← hold-to-talk STT (loaded by the shim)
  public/motorpool-ask-attach.js ← Ask photo/file attach (loaded by the shim)
  public/motorpool-ask-leave.js ← HR leave lookup client for admin/HR (loaded by the shim)
  netlify/functions/         ← auth, db, office, approve-vrf, sample, transcribe, tts, hr-leave
  netlify/lib/               ← session, mp-access, capabilities, approve-from-hold, Anthropic, ElevenLabs
  docs/approve-vrf-api.md    ← Jeffrey env + curl + Noah/Builder call pattern
  supabase/migrations/
  tests/                     ← auth, approve-vrf, thaw, isFuel, papers, variance, host
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
