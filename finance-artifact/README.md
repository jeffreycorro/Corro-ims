# CorConDev Finance

Separate Netlify site for **Corro Construction Development and Trade Corporation** (Cebu). It is not the company portal. Staff sign in with the same Supabase email and password as [the portal](https://corcondev-portal.netlify.app). Finance is limited to `admin` and department `finance`.

Suggested site name: `corcondev-finance`.

Build stamp: **2026-10-10 a**.

## What this site does

Phase 1 is the working register:

- Disbursement vouchers, one row each, with a server-assigned `DV2026-0001` number. The counter update and the insert commit together. A cancelled number is not reused.
- Status path: Draft → For Review → For Approval → Approved → Released (Check or Cash) → Cleared, or Cancelled before release.
- The Approver tab is the Jeffrey step. The evaluator marks the voucher checked first. The tab asks for the approver password and forgets it on reload. Approve is rejected without that password.
- Printable A4 PDF with Prepared, Checked, Approved, and Received e-signatures.
- Receipt and invoice files go to the private Storage bucket `finance-uploads`. Opening one uses a short-lived signed URL.
- Cash advances by department, released on a disbursement voucher, then liquidated. Refund and reimbursement are computed from the receipts. Aging and per-employee balances are on the cash advance screen.
- HR cash advances and Motorpool reserves/suppliers are read through the service role and shown as links. This site does not write those tables.
- Supplier bills with VAT and expanded withholding, partial payments through a voucher, aging buckets, and a due-this-week list.
- Dashboard: cash out this month, pending approvals, unliquidated advances, AP due this week.

Phase 2 tables are in the migration. Progress billings, petty cash, and bank reconciliation show **Coming soon**. The Reports screen already prints the cash disbursement book, AP aging, unliquidated cash advances, and project cost from Phase 1 rows.

Amounts use `₱` and two decimals. Dates and the session clock use Asia/Manila.

## SQL to run by hand

In the Supabase SQL editor for `https://kfflyzprxcidmsdjhuej.supabase.co`, run:

`supabase/migrations/20261010000001_finance_schema.sql`

That file is additive. It creates `finance_` tables, turns on row level security, grants them to `service_role` only, and creates the private `finance-uploads` bucket. It does not change HR or Motorpool data.

## Netlify

1. New site from this GitHub repo. Suggested name: `corcondev-finance`.
2. Base directory: `finance-artifact`.
3. Publish directory: `public` (already in `netlify.toml`).
4. Functions directory: `netlify/functions` (already in `netlify.toml`).
5. Node 20 (already in `netlify.toml`).
6. Turn off Deploy Previews. `netlify.toml` also skips preview and branch builds.
7. Set the environment variables below, then redeploy.

Do not point the company portal site at this folder. The portal Finance tile links out to this site.

### Environment variables

Set these on the Finance site. Names only — do not commit values.

| Variable | Scope |
| --- | --- |
| `SUPABASE_URL` | Functions |
| `SUPABASE_ANON_KEY` | Functions |
| `SUPABASE_SERVICE_ROLE` | Functions only |
| `FINANCE_SESSION_SECRET` | Functions, optional |
| `FINANCE_APPROVER_PASSWORD` | Functions, optional |
| `FINANCE_GATE_REQUIRED` | Functions, optional |
| `FINANCE_GATE_PASSWORD` | Functions, optional |
| `SUPABASE_AUTH_ENABLED` | Functions, optional |

`SUPABASE_URL` is `https://kfflyzprxcidmsdjhuej.supabase.co`. Use the anon key for staff login and the service role for data. If `FINANCE_SESSION_SECRET` is unset, the cookie is signed from the service role. If `FINANCE_APPROVER_PASSWORD` is unset, the Approver tab uses the same page password as the HR Approver tab. Leave the gate variables unset; staff do not get a second site password.

The portal can set `NEXT_PUBLIC_FINANCE_PORTAL_URL` when this site is not `https://corcondev-finance.netlify.app`.

## Local tests

```bash
cd finance-artifact
npm install
npm test
```

## Install on iPhone

Open the Finance site in Safari, sign in, then Share → Add to Home Screen. The service worker caches the icon shell only. It does not cache vouchers or the page.
