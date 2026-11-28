# HR bot approval

A trusted bot can approve a payrun or a leave on behalf of Jeffrey James M. Corro without a browser sign-in. The endpoint calls the same steps the screens use.

Live site: [https://corcondev-hr.netlify.app](https://corcondev-hr.netlify.app)

Do **not** put the bearer secret in this repo, in a prompt, or in a Netlify environment variable. No new Netlify env var is required.

## URL

```
POST https://corcondev-hr.netlify.app/.netlify/functions/hr-approve
```

## One-time setup

1. In the Supabase SQL editor for project `kfflyzprxcidmsdjhuej`, run `supabase/migrations/20261128000001_hr_bot_approve.sql`. A deploy does not run it, and it does not change payroll or leave rows.
2. Generate a long secret on your machine. Do not paste it into git.

```bash
openssl rand -hex 32
```

3. Hash it and insert only the hash.

```bash
node -e 'const c=require("crypto"); process.stdout.write(c.createHash("sha256").update(process.argv[1],"utf8").digest("hex"))' 'PASTE-THE-SECRET-HERE'
```

```sql
insert into public.hr_bot_secrets (id, secret_sha256, label)
values ('hr-bot', 'THE-64-CHAR-HEX-HASH', 'HR Bot');
```

4. Give the secret to the bot out of band. To rotate, insert a new hash (or replace the row) and update the bot. Old hashes still work until that row is deleted.

Until the table exists and holds a hash, every call is rejected.

## Auth

```
Authorization: Bearer <secret>
```

Anything without that header, or with the wrong secret, is **401**. A portal session cookie is not accepted. The function compares `SHA-256(secret)` to `hr_bot_secrets.secret_sha256`. The secret is not written to the audit table.

## Body

```json
{ "kind": "payrun", "id": "weekly|2026-11-19", "dryRun": false }
```

```json
{ "kind": "leave", "id": "LRF2026-0207", "dryRun": true }
```

`kind` is `payrun` or `leave`. A payrun id is `weekly|YYYY-MM-DD` or `semi|YYYY-MM-DD` (the saved run id). A leave id is the LRF number or the document id.

`dryRun: true` does not write the payrun, the leave, or the PDF. For a leave it still fetches the signed scan and Jeffrey's e-signature and stamps them in memory, so a missing file fails the dry run. The call is still audited. `approvedPdfUrl` is null on a dry run. A real leave approve returns the stored PDF URL.

## What a payrun call does

The same three Payroll Maker actions, in order, for the whole run (not a site filter on one screen):

1. **Submit**, when the run is still a draft (`payTransition`).
2. **Acknowledge exceptions** (`hrPaySheet.openExceptions`), the same ids the Acknowledge button writes.
3. **Finalize / Approve** (`payTransition` approve). This stays blocked while an exception is still open.

`approvedBy` and `submittedBy` are `Jeffrey James M. Corro`. The actor is an admin, so the Approver password is not involved and is not changed. Print gates on the screen are not changed. The PDF is `hrPaySheet.printHTML` of the same options Preview & print uses, including the approval stamp and Jeffrey's stored e-signature. It is stored in the private `hr-uploads` bucket. The response URL is a signed link that lasts 7 days. Calling again after approval does not approve a second time; it returns a fresh link.

A run with nobody on the clock is refused, same as Submit.

## What a leave call does

`hrApprover.approveItem`, the Approver tab's Approve:

- status becomes `Approved`
- `approvedBy` is Jeffrey James M. Corro
- Jeffrey's e-signature from Settings → HR e-signatures is stamped onto the employee-signed scan
- a scan stored as `/.netlify/functions/files?path=...` is read from the private Supabase bucket with the service role. The browser opens that path with a session cookie; the bot does not
- the stamped PDF is stored (Google Drive when that upload works, otherwise the same private bucket) and `Open the approved form` uses that link. The response `approvedPdfUrl` is that link

A leave that is not `For approval` is refused. One that is already approved is returned as it is.

## Response

```json
{
  "item": "weekly|2026-11-19",
  "newStatus": "approved",
  "approvedAt": "2026-11-28 09:15",
  "approvedPdfUrl": "https://…",
  "kind": "payrun",
  "dryRun": false,
  "steps": ["submit", "acknowledge", "approve"],
  "already": false
}
```

Leave status is `Approved`. `approvedAt` is Asia/Manila wall time. A dry run has `approvedPdfUrl: null`.

## Audit

Each call inserts `hr_bot_audit`: approver `Jeffrey James M. Corro`, via `HR Bot`, the item id, and the time. Failed calls are logged too. The secret is not.

## curl

```bash
curl -sS -X POST 'https://corcondev-hr.netlify.app/.netlify/functions/hr-approve' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${HR_BOT_SECRET}" \
  -d '{"kind":"payrun","id":"weekly|2026-11-19","dryRun":true}'
```

```bash
curl -sS -X POST 'https://corcondev-hr.netlify.app/.netlify/functions/hr-approve' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${HR_BOT_SECRET}" \
  -d '{"kind":"payrun","id":"weekly|2026-11-19"}'
```

```bash
curl -sS -X POST 'https://corcondev-hr.netlify.app/.netlify/functions/hr-approve' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${HR_BOT_SECRET}" \
  -d '{"kind":"leave","id":"LRF2026-0207","dryRun":true}'
```

```bash
curl -sS -X POST 'https://corcondev-hr.netlify.app/.netlify/functions/hr-approve' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${HR_BOT_SECRET}" \
  -d '{"kind":"leave","id":"LRF2026-0204"}'
```
