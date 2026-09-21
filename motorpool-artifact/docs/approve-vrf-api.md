# Gated approve-vrf API

Server-side approve of **one** pending Motorpool VRF. Same write as Office → Approvals → Approve: the Requested hold becomes posted/open on the ledger. For the `corcondev-motorpool` Netlify site only.

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
- Writes the reserve as **Approved** and appends ledger rows with `vstatus: "Open"`.
- Reuses the Office approve-from-hold path (including PR #54 remint if that hold’s number is already posted).
- Records `approvedVia: "api"` and optional `approverNote`.

It does **not** list VRFs, reject, edit amounts, invent a number, or bypass uniqueness remint.

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
  "approvedVia": "api",
  "approvedAt": "2026-09-21",
  "approvedBudget": 12500,
  "approverNote": "jeffrey-yes via Noah"
}
```

## Errors

| Status | `code` | When |
| --- | --- | --- |
| 401 | `unauthorized` | Secret missing or wrong |
| 400 | `bad_request` | No `vrf` / `vrfNumber`, or not JSON |
| 404 | `not_found` | That VRF is not waiting for approval |
| 409 | `already_posted` | Already on the ledger / already approved |
| 409 | `ambiguous` | More than one pending hold matches |
| 405 | `method_not_allowed` | Anything other than POST (no list-all) |
| 503 | `not_configured` | Env secret not set on Netlify |

## Builder / Noah call pattern

1. Jeffrey says **yes** on that specific VRF (the human gate stays).
2. Builder/Noah POST only that held number plus the secret. Do not open a remote browser and do not type the Office pass.
3. Treat `200` + `status: "Open"` as posted. Treat `409 already_posted` as already done. Do not retry a `404`.
4. Do not call this endpoint to discover pending VRFs — there is no list.

HR and Materials are out of scope. This function talks to the same Supabase `motorpool_docs` store as `/.netlify/functions/db` (`reserves/<year>` + `ledger/<YYYY-MM>`).
