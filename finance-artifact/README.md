# CorConDev Finance

Separate Netlify site for **Corro Construction Development and Trade Corporation** (Cebu). It is not the company portal. Staff sign in with the same Supabase email and password as [the portal](https://corcondev-portal.netlify.app). Finance is limited to `admin` and department `finance`.

Suggested site name: `corcondev-finance`.

Build stamp: **2026-10-10 g**.

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
- **Checks** (sheet CCD-04). The Checks screen is the monitoring dashboard: outstanding from this month onward, due through the end of the month, issued history by year, month, and bank, the next 30 days, and outstanding month by month. Check numbers are `{BANK}{booklet year}-{serial}`. The year is the booklet year, not the check date. A new check is issued, then moves for signature, optionally ready for pickup, then released with the receiver and date, then cleared from the bank statement. Cancel and void are on the check. A check still open 180 days after its check date is marked stale and can still be cleared or voided. Each check can have a photo. Run audit lists missing booklet serials. Canceled checks and inter-bank transfers stay out of the dashboard totals. Personal accounts, including Jeffrey's BDO (`BDO Personal`), stay out of the company dashboard, month totals, audit, and reconciliation unless that bank is chosen in the bank filter. A transfer between our own accounts stays in `monthTotals().total` and out of expenses. The September 2026 reconciliation figure is the Google Sheet monthly summary Total, which leaves those transfers out. A check payable to `Petty Cash PCB No. N` becomes a cash-in on that cycle.
- **GCash.** Batches carry the opening balance forward. The running balance is computed from top-ups, expenses, fees, and open receivables. Expense refs are `2026Gcash-0001`.
- **Bills** (the bill-paying checklist). The Bills screen is one scrolling page with a dark-mode toggle. Tiles show last year's paid total, this year paid through the last complete month, the change versus last year (and the same change with credit cards left out), and the needs-attention total. The spend chart compares this year with last year for all bills, all bills except credit cards, one location, or one bill, monthly or cumulative, and marks the current month in progress. Where the money goes can be this year-to-date or last full year, grouped by location, bill type, or credit card. Needs attention lists overdue and due-now items. Upcoming lists amounts already entered for later months. A bill has a bill type. Mark it paid with the date, method, and a link to a check, GCash expense, or disbursement voucher, and attach a receipt. A fixed bill can recur into the next months. A month can be N/A. Rent received is tracked for Residencia Edades 720 (₱8,500), City Soho 1123 (₱10,000), and San Remo 3314 (₱12,500). Yearly property tax is on the same page. Bills due within 3 days are called out.
- **Import from Google Sheets**, administrators only. Upload CCD-03 Petty Cash, CCD-04 Check Monitoring, GCash monitoring, and the Bill Paying Checklist, or any subset. The files are stored in the private `finance-uploads` bucket in parts, then read back from there. Dry run counts each table, checks PCB 35 cash on hand ₱28,242 with ₱24,315 still released, the GCash balance ₱1,394.11, and the September 2026 check total ₱11,553,814.54, and lists import issues. A CSV of those issues can be downloaded. Import writes in chunks and a later run updates the same rows instead of copying them.
- Master lists for projects, employees, suppliers, bank nicknames (AUB, BDO, BPI 1842, BPI Credit Line, PBB, RCBC, DBP, LBP, and personal BDO), and funding sources (J Jeffrey, M Marian, payroll excess, check, sales, refund). Sheet spellings are alias rows. Vouchers, petty cash, GCash, and advances use those lists.
- Dashboard: cash out this month, pending approvals, unliquidated advances, AP due this week, petty cash on hand, GCash balance, and checks due soon.

Progress billings and bank-statement reconciliation stay marked **Coming soon**. Their tables are already in the first migration.

Amounts use `₱` and two decimals. Dates and the session clock use Asia/Manila. A full bank account number is masked to the last four digits in the normal tables. When `FINANCE_BANK_SECRET` is set, the full number is encrypted in `finance_bank_secrets` and is not returned by the app.

## SQL to run by hand

In the Supabase SQL editor for `https://kfflyzprxcidmsdjhuej.supabase.co`, run these in order:

1. `supabase/migrations/20261010000001_finance_schema.sql`
2. `supabase/migrations/20261010000002_finance_sheet_registers.sql`
3. `supabase/migrations/20261010000003_finance_bill_dashboard.sql`
4. `supabase/migrations/20261010000004_finance_sheet_import.sql`
5. `supabase/migrations/20261010000005_finance_personal_bank.sql`

The files are additive. The first two create `finance_` tables, turn on row level security, and grant them to `service_role` only. The first file also creates the private `finance-uploads` bucket. The third adds bill type, recurring amount, receipt path, and the three rental units. The fourth adds the import-job table used by the Google Sheets screen. The fifth adds `is_personal` on bank accounts and seeds `BDO Personal`. None of them change HR or Motorpool data.

## Import the four sheets

Place the `.xlsx` exports on the machine that will run the import, then from `finance-artifact`:

```bash
npm install
node scripts/import/run.js --petty CCD-03.xlsx --checks CCD-04.xlsx --gcash gcash.xlsx --bills bills.xlsx --year 2026
```

The script reads each visible tab. Hidden tabs, templates, and `Copy of` tabs are skipped. Petty cash cycle and year come from the tab name (`PCB35`, `PCB2026-01`). Headers match with or without a trailing colon. GCash keeps the year on the tab, reads the `CASH` column as a top-up, and uses `Balance forwarded` as the opening. Check booklets map to AUB, BDO, BPI 1842, BPI Credit Line, PBB, RCBC, DBP, and LBP. `BPILOAN` is the BPI Credit Line account. `BDOJOINT` is the personal BDO account and stays out of company totals. A payee of `Cancelled` is a cancelled check, not a supplier. `Sheet3` adds check numbers that are missing from the bank tabs and does not overwrite a booklet row. An invoice line that repeats the check number and leaves the amount blank stays on that check. Bill grids, rental income, and the yearly property-tax list are all loaded. Names found on the sheets are added to the supplier, employee, and project lists (near-duplicates that share a long prefix are merged). The external master spreadsheet `1tUuWIvYZ4s0HeVeUc-f_vcBwswYAwGcgtYInKDRuV7U` is not required and is not called. A date it cannot read is stored in `finance_import_issues` and the row still loads. Running the same files again updates the same rows.

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
