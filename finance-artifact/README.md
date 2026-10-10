# CorConDev Finance

Separate Netlify site for **Corro Construction Development and Trade Corporation** (Cebu). It is not the company portal. Staff sign in with the same Supabase email and password as [the portal](https://corcondev-portal.netlify.app). Finance is limited to `admin` and department `finance`.

Suggested site name: `corcondev-finance`.

Build stamp: **2026-10-10 c**.

## What this site does

Phase 1 replaces the four Google Sheets, plus disbursement vouchers, cash advances, and supplier bills.

- Disbursement vouchers, one row each, with a server-assigned `DV2026-0001` number. The counter update and the insert commit together. A cancelled number is not reused. A released check whose number is `BPI2026-1000274146` is also written on the check register and linked back to the voucher.
- Status path: Draft → For Review → For Approval → Approved → Released (Check or Cash) → Cleared, or Cancelled before release.
- The Approver tab is the Jeffrey step. The evaluator marks the voucher checked first. The tab asks for the approver password and forgets it on reload. Approve is rejected without that password.
- Printable A4 PDF with Prepared, Checked, Approved, and Received e-signatures.
- Receipt and invoice files go to the private Storage bucket `finance-uploads`. Opening one uses a short-lived signed URL.
- Cash advances by department, released on a disbursement voucher, then liquidated. The employee is chosen from the employee list. Refund and reimbursement are computed from the receipts.
- HR cash advances and Motorpool reserves/suppliers are read through the service role and shown as links. This site does not write those tables.
- Supplier bills (accounts payable) with VAT and expanded withholding, partial payments through a voucher, aging buckets, and a due-this-week list. Supplier identity is TIN plus branch when a TIN is present.
- **Petty cash** (sheet CCD-03). Cycles are `PCB {year}-{n}`. Opening balance is the previous closing balance. Cash on hand is total cash minus expenses minus cash still released. Closing a cycle opens the next one with that balance. Voucher numbers are `PC2026-0001`, assigned on the server. One voucher can have many receipt lines. Supplier `Cash` means there is no receipt.
- **Checks** (sheet CCD-04). The Checks screen is the monitoring dashboard: outstanding from this month onward, due through the end of the month, issued history by year, month, and bank, the next 30 days, and outstanding month by month. Check numbers are `{BANK}{booklet year}-{serial}`. The year is the booklet year, not the check date. A new check is issued, then moves for signature, optionally ready for pickup, then released with the receiver and date, then cleared from the bank statement. Cancel and void are on the check. A check still open 180 days after its check date is marked stale and can still be cleared or voided. Each check can have a photo. Run audit lists missing booklet serials. Canceled checks and inter-bank transfers stay out of the dashboard totals. A transfer between our own accounts is still kept in the bank month total used for reconciliation, and out of expenses. A check payable to `Petty Cash PCB No. N` becomes a cash-in on that cycle.
- **GCash.** Batches carry the opening balance forward. The running balance is computed from top-ups, expenses, fees, and open receivables. Expense refs are `2026Gcash-0001`.
- **Bill paying checklist.** Sites, billers, and masked account numbers, one row per bill per month, plus rent received and yearly property tax. A month can be paid by a check, a GCash expense, or a disbursement voucher.
- Master lists for projects, employees, suppliers, bank nicknames (AUB, BDO, BPI 1842, BPI Credit Line, PBB, RCBC, DBP, LBP), and funding sources (J Jeffrey, M Marian, payroll excess, check, sales, refund). Sheet spellings are alias rows. Vouchers, petty cash, GCash, and advances use those lists.
- Dashboard: cash out this month, pending approvals, unliquidated advances, AP due this week, petty cash on hand, GCash balance, and checks due soon.

Progress billings and bank-statement reconciliation stay marked **Coming soon**. Their tables are already in the first migration.

Amounts use `₱` and two decimals. Dates and the session clock use Asia/Manila. A full bank account number is masked to the last four digits in the normal tables. When `FINANCE_BANK_SECRET` is set, the full number is encrypted in `finance_bank_secrets` and is not returned by the app.

## SQL to run by hand

In the Supabase SQL editor for `https://kfflyzprxcidmsdjhuej.supabase.co`, run these in order:

1. `supabase/migrations/20261010000001_finance_schema.sql`
2. `supabase/migrations/20261010000002_finance_sheet_registers.sql`

Both files are additive. They create `finance_` tables, turn on row level security, and grant them to `service_role` only. The first file also creates the private `finance-uploads` bucket. Neither file changes HR or Motorpool data.

## Import the four sheets

Place the `.xlsx` exports on the machine that will run the import, then from `finance-artifact`:

```bash
npm install
node scripts/import/run.js --petty CCD-03.xlsx --checks CCD-04.xlsx --gcash gcash.xlsx --bills bills.xlsx --year 2026
```

The script finds header rows by labels such as `REFERENCE NO`, fills merged check cells down, splits GCash on `BATCH n`, and unpivots the bill grid by month column. A date it cannot read, or a name that is not on the list or an alias, is stored in `finance_import_issues` and the row still loads. Unknown names land on `Unassigned`. Running the same files again updates the same rows.

This command loads a memory copy and prints the reconciliation report. The targets after a full import are PCB 35 cash on hand ₱28,242 with ₱24,315 still released, GCash balance ₱1,394.11, and September 2026 checks totaling ₱11,553,814.54. The test suite checks those formulas without the workbooks. A missing export does not fail `npm test`.

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
| `FINANCE_BANK_SECRET` | Functions, optional |
| `FINANCE_GATE_REQUIRED` | Functions, optional |
| `FINANCE_GATE_PASSWORD` | Functions, optional |
| `SUPABASE_AUTH_ENABLED` | Functions, optional |

`SUPABASE_URL` is `https://kfflyzprxcidmsdjhuej.supabase.co`. Use the anon key for staff login and the service role for data. If `FINANCE_SESSION_SECRET` is unset, the cookie is signed from the service role. If `FINANCE_APPROVER_PASSWORD` is unset, the Approver tab uses the same page password as the HR Approver tab. `FINANCE_BANK_SECRET` encrypts full account numbers; leave it unset and the app still stores only the masked number. Leave the gate variables unset; staff do not get a second site password.

The portal can set `NEXT_PUBLIC_FINANCE_PORTAL_URL` when this site is not `https://corcondev-finance.netlify.app`.

## Local tests

```bash
cd finance-artifact
npm install
npm test
```

## Install on iPhone

Open the Finance site in Safari, sign in, then Share → Add to Home Screen. The service worker caches the icon shell only. It does not cache vouchers or the page.
