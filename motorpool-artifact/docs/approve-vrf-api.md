# Gated approve-vrf API

Server-side approve of **one** pending Motorpool VRF. Same result as Office → Approvals → Approve: the Requested hold becomes posted/open on the ledger. For the `corcondev-motorpool` Netlify site only.

This is the Noah → Builder handoff after Jeffrey’s per-VRF **yes**. It does not replace that yes. It replaces remote browser login / Office passcode for this one action.

## Jeffrey: set the secret, redeploy

1. Open the **corcondev-motorpool** Netlify site (base directory `motorpool-artifact`).
2. Site configuration → Environment variables.
3. Add **`APPROVE_VRF_SECRET`** (alternate name: `MOTORPOOL_APPROVE_SECRET`).
4. Scope it to Functions / Production. Use a long random value. **Never commit it.**
5. Trigger a **redeploy** so `approve-vrf` reloads the env.

Either env name works. If both are set, `APPROVE_VRF_SECRET` wins.

## What the endpoint does

`POST /.netlify/functions/approve-vrf`

- Approves a single named hold that is currently **Requested** (waiting for approval).
- Writes **only** that reserve (`status: Approved`, `approvedBy`, `approvedAt`, audit) and the new ledger line(s) for that VRF (`vstatus: "Open"`). Other reserves and other ledger VRFs are not read or patched, so `updated_at` on those rows stays put.
- The two writes go through Postgres function `motorpool_approve_vrf` when it is installed, so they commit in one transaction. Ledger lines are stored before the reserve is marked Approved.
- Reuses the Office approve-from-hold rules (it does not mint a second number when that VRF is already posted).
- Records `approvedVia: "api"` and optional `approverNote`.
- Returns in well under 10 seconds. A call is a few row lookups plus one or two row writes, not a rewrite of the month or the year.

It does **not** list VRFs, reject, edit amounts, invent a number, or bypass uniqueness.

### Idempotent and self-healing

Calling approve again is safe.

| Reserve | Ledger lines for that VRF | What approve does |
| --- | --- | --- |
| Requested | none | Insert the lines, then mark the reserve Approved |
| Requested | already stored | Mark the reserve Approved. Do not add another copy of the lines |
| Approved | none | Insert the missing lines (`healed: true`). Do not refuse as already posted |
| Approved | already stored | `200` with `already: true`. No row is rewritten |

VRF 5893 was left Approved with no September ledger line after a timeout. Approving `5893` again creates that ledger line.

`409 already_posted` remains only when **another** reserve already owns that posted number. A repeat call on the same VRF is `200`, not `409`.

## SQL function (apply by hand)

`supabase/migrations/20261007000001_motorpool_approve_vrf.sql` is additive (one index, one function). It does not rewrite or remove existing rows. Apply it in the Supabase SQL editor after `20261006000001_motorpool_vrf_records.sql`, the same way that migration was applied. Redeploying Netlify does not run it.

If the function is **not installed yet**, approve still works. The function detects the missing RPC and does two targeted REST writes: the ledger row first, then the reserve. A timeout can no longer leave the reserve Approved with no ledger line. Those two writes are not one database transaction; once the SQL function is applied, they commit together. Either way, unchanged records are not written.

## Auth (secret replaces Office pass)

Send the env secret on every call. No Motorpool session cookie. No Office passcode.

```
Authorization: Bearer <APPROVE_VRF_SECRET>
```

or

```
X-Approve-Secret: <APPROVE_VRF_SECRET>
```

Missing or wrong secret → `401`. If the env var is unset, the function returns `503` (`not_configured`) rather than opening the door. The secret is never written to logs or response bodies.

CORS allows Builder/Noah callers (`POST` + `OPTIONS`; `Authorization`, `Content-Type`, `X-Approve-Secret`).

## Body

```json
{ "vrf": "5812" }
```

or

```json
{ "vrfNumber": 5812, "approverNote": "jeffrey-yes via Noah" }
```

`RSV-12` / `VRF-5812` spellings are normalized. Optional `approvedBy` is stored on the reserve; default is `api`.

## Example curl

```bash
curl -sS -X POST 'https://corcondev-motorpool.netlify.app/.netlify/functions/approve-vrf' \
  -H 'Authorization: Bearer '"$APPROVE_VRF_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"vrf":"5812","approverNote":"jeffrey-yes via Noah"}'
```

Success (`200`):

```json
{
  "ok": true,
  "vrf": "5812",
  "reserve": "12",
  "status": "Open",
  "ledgerLines": 1,
  "approvedVia": "api",
  "approvedAt": "2026-09-21",
  "approvedBudget": 12500,
  "approverNote": "jeffrey-yes via Noah"
}
```

`ledgerLines` is how many ledger lines that VRF has after the call. `status` is the ledger line status (`Open` on a new post). `healed: true` means the reserve was already Approved and the missing lines were created. `already: true` means the lines were already there.

## Errors

| Status | `code` | When |
| --- | --- | --- |
| 401 | `unauthorized` | Secret missing or wrong |
| 400 | `bad_request` | No `vrf` / `vrfNumber`, or not JSON |
| 404 | `not_found` | That VRF is not a live reserve |
| 409 | `already_posted` | Another reserve already owns that posted number |
| 409 | `ambiguous` | More than one pending hold matches |
| 409 | `no_draft_lines` | Nothing to post, and no ledger line exists yet |
| 405 | `method_not_allowed` | Anything other than POST (no list-all) |
| 503 | `not_configured` | Env secret not set on Netlify |

## Builder / Noah call pattern

1. Jeffrey says **yes** on that specific VRF (the human gate stays).
2. Builder/Noah POST only that held number plus the secret. Do not open a remote browser and do not type the Office pass.
3. Treat `200` + `status: "Open"` as posted, including `already: true` and `healed: true`. A second `200` is a no-op, not a duplicate. Do not retry a `404`.
4. Do not call this endpoint to discover pending VRFs — there is no list.

Office → Approvals → Approve uses the same per-record store. When `motorpool_issue_record` is installed it already updates that one reserve and that one ledger row. If a save still arrives as a whole month or year document, only the records whose contents changed are patched.

HR and Materials are out of scope. This function talks to `public.motorpool_records` (`reserve:<no>` and `ledger:<vrf>`). The older `motorpool_docs` blobs (`reserves/<year>`, `ledger/<YYYY-MM>`) are not rewritten by an approve.
