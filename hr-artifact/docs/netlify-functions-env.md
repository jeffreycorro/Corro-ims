# HR Netlify Functions env (4KB AWS limit)

AWS Lambda — which hosts Netlify Functions — rejects the deploy when **all Functions-scoped environment variables together** exceed **4KB**. Netlify injects its own platform vars into that budget as well. The Google service-account JSON alone is typically **2.3–4.3KB**, so putting it on Functions (or “All”) breaks every function (`auth`, `db`, `drive`, `sample`, `transcribe`, `tts`, `applicants-ingest`).

This site must **never** Functions-scope `GOOGLE_SERVICE_ACCOUNT_JSON`.

## After merge (Jeffrey)

Do these in order on site **corcondev-hr**, then trigger a production redeploy.

### 1. Unblock the deploy (required)

1. Site configuration → Environment variables.
2. Open `GOOGLE_SERVICE_ACCOUNT_JSON`.
   - **Either** change scopes to **Builds only** (uncheck Functions / All), **or** delete the variable after step 2 below.
   - Do **not** leave it scoped to Functions.
3. Delete `HR_GATE_SECRET` from this site (Functions and Builds). Staff login is Supabase Auth. Cookie HMAC uses `HR_SESSION_SECRET` or a hash of `SUPABASE_SERVICE_ROLE`.
4. Confirm you are **not** also setting `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` here. Those duplicate the JWTs and waste the 4KB budget. Use `SUPABASE_URL` and `SUPABASE_ANON_KEY` only.
5. Add `HR_SESSION_SECRET` if missing: `openssl rand -hex 32`. Scope **Functions**, Production.
6. Keep `HR_APPLICANTS_INGEST_KEY` on **Functions** (Production). Generate with `openssl rand -hex 32` if unset.
7. **Redeploy** production. Confirm the deploy publishes functions (no 4KB error).
8. Sign in once (session cookies are re-issued if the HMAC key changed).
9. `GET /.netlify/functions/auth` should show both `mcp: true` and `capabilities.mcp: true` after Drive credentials are available (step 2). Live `mcp: false` with sample/tts/transcribe true usually means the SA JSON is not in Blobs and was not Builds-bundled — upload the blob (preferred) or set `GOOGLE_SERVICE_ACCOUNT_JSON` to **Builds only** and redeploy. Do not Functions-scope that JSON.

Staff may need to sign in again after `HR_GATE_SECRET` is removed.

### 2. Preferred: store the service account in Netlify Blobs (set once, no 3KB env var)

From a machine with the [Netlify CLI](https://docs.netlify.com/cli/get-started/) logged in as an owner of `corcondev-hr`:

```bash
# Use the downloaded GCP JSON key. Never commit it.
npx netlify blobs:set hr-secrets google-service-account --input ./google-sa.json --filter corcondev-hr
```

Same store/key if you are already linked to the HR site:

```bash
npx netlify blobs:set hr-secrets google-service-account --input ./google-sa.json
```

Then **delete** `GOOGLE_SERVICE_ACCOUNT_JSON` entirely (Builds and Functions). Redeploy so cold functions read the blob.

`hr-artifact/netlify.toml` already sets `GOOGLE_SERVICE_ACCOUNT_BLOB=1` (one byte). That flag is enough to make functions try Blobs even when `NETLIFY=true` is missing at Lambda runtime. You can still set the same flag in the Netlify UI.

### 3. Also supported: Builds-only env → function bundle

If you keep `GOOGLE_SERVICE_ACCOUNT_JSON` as **Builds only**, `scripts/prepare-google-sa.js` copies it into `netlify/lib/google-sa.generated.js` during the Netlify build. That file is **not** a committed secret (the repo stub is empty). Lambda never sees the 3KB value.

Do **not** commit a filled-in `google-sa.generated.js`.

Local `netlify dev` can still use `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_FILE` in `.env` (gitignored).

## Functions-scoped vs Builds-only

| Variable | Scope | Why |
| --- | --- | --- |
| `SUPABASE_URL` | Functions | Auth + data |
| `SUPABASE_ANON_KEY` | Functions | Staff login / portal handoff JWT check |
| `SUPABASE_SERVICE_ROLE` | Functions | Docs, locks, profile lookup |
| `HR_SESSION_SECRET` | Functions | Cookie HMAC. Prefer this over any leftover gate secret. |
| `HR_APPLICANTS_INGEST_KEY` | Functions | GoDaddy extractor |
| `HR_APPLICANTS_IMAP_USER` | Functions, optional | `hrcorcondev@gmail.com` (~24 B) |
| `HR_APPLICANTS_IMAP_PASS` | Functions, optional | Gmail app password (~20 B). Never the account login password. |
| `ANTHROPIC_API_KEY` | Functions | `sample` |
| `OPENAI_API_KEY` | Functions | `transcribe` |
| `ELEVENLABS_API_KEY` | Functions | `tts` |
| `ELEVENLABS_VOICE_ID` / `ELEVENLABS_MODEL_ID` | Functions, optional | Small |
| `ANTHROPIC_MODEL*` / `OPENAI_TRANSCRIBE_*` | Functions, optional | Small; unset if unused |
| `GOOGLE_DRIVE_DELEGATED_USER` | Functions, optional | Email only (~40 B) |
| `GOOGLE_DRIVE_OCR` | Functions, optional | `true` / unset |
| `GOOGLE_SERVICE_ACCOUNT_BLOB` | Functions, optional | Tiny flag (`1`) if you want an explicit Blobs hint |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Builds only**, or **unset** after Blobs upload | Never Functions |
| `HR_GATE_SECRET` | **Do not set** | Obsolete after Supabase login |
| `HR_GATE_REQUIRED` / `HR_GATE_PASSWORD` | Unset unless you still want the old shared-password wall | |
| `NEXT_PUBLIC_*` | **Do not set** on this site | Duplicates Supabase JWTs |

## Approximate remaining Functions env size

Byte counts are UTF-8 **name + value**. Platform vars Netlify injects (site URL, deploy ids, Blobs context, …) often add **0.8–1.5KB** on top.

| Variable | Typical size |
| --- | --- |
| `SUPABASE_URL` | ~50 B |
| `SUPABASE_ANON_KEY` | 200–900 B (legacy JWTs are the large end) |
| `SUPABASE_SERVICE_ROLE` | 200–900 B |
| `HR_SESSION_SECRET` | ~80 B (`openssl rand -hex 32`) |
| `HR_APPLICANTS_INGEST_KEY` | ~80 B |
| `ANTHROPIC_API_KEY` | ~110–130 B |
| `OPENAI_API_KEY` | ~60–180 B |
| `ELEVENLABS_API_KEY` | ~50–70 B |
| Optional model / voice / Drive flags | ~20–80 B each |
| **Operator subtotal** | **~0.9–2.6 KB** |
| **+ Netlify platform vars** | **~1.7–4.0 KB total** |

That stays under 4KB if the service-account JSON and duplicate `NEXT_PUBLIC_*` keys are off Functions.

`GOOGLE_SERVICE_ACCOUNT_JSON` (the value we moved): typically **2.3–3.2KB** raw, **3.1–4.3KB** if base64 — enough to fail the deploy by itself.

## Compressing or splitting (do not)

Gzip + base64 of the SA JSON still lands around 2KB and remains fragile. Splitting across `GOOGLE_SA_1` / `GOOGLE_SA_2` still counts toward the same 4KB. Use Blobs or Builds-only bundling instead.

## Confirm after redeploy

1. Production deploy log: functions created (no “exceed the 4KB limit”).
2. Signed-in `GET /.netlify/functions/auth` → `capabilities.sample`, `mcp`, `transcribe`, `tts` match the keys you kept.
3. Drive search from the artifact works (folders still shared with the service-account email).
4. Applicants ingest still accepts `X-HR-Ingest-Key`.

## Leave / CA file-upload quota (2026-09-19)

Staff were blocked with “file upload quota has been reached” when attaching a signed Leave or Cash Advance scan.

What the code now does:

- Client cap is **80 MB** (`MAX_UPLOAD_MB` in `public/index.html`). It was 15 MB. Netlify Functions still oneshot at **3.5 MB**; `claude-shim.js` already chunks anything larger. Do not invent a second storage backend.
- Drive HTTP `storageQuotaExceeded` / `quotaExceeded` is mapped to `quota_exceeded` with an operator-facing sentence. The artifact toast tells staff the portal is no longer the 15 MB wall.

Code cannot create Drive space. If a scan still fails after this deploy, Jeffrey must do one of these on **corcondev-hr**:

1. **Preferred.** Set Functions env `GOOGLE_DRIVE_DELEGATED_USER` to a Workspace mailbox that owns (or has space in) the HR 201 / inbox folders. Service accounts have little or no My Drive quota of their own.
2. Move the HR 201 / inbox / memo folders onto a **Shared Drive** and share that drive with the service-account email as Content manager. Uploads then count against the Shared Drive, not the SA.
3. Free space on the Drive account that currently receives uploads, and confirm the 201 / `_INBOX` folders are still shared with the service-account email.

No new Netlify Blob store is required for Leave/CA attachments. Blobs stay for the Google service-account JSON only.
