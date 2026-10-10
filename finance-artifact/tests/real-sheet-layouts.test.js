"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { parseMessyDate } = require("../scripts/import/dates");
const { parseBillGrid, parseRentalSheet, parseYearlySheet } = require("../scripts/import/bills");
const { parseCheckSheet } = require("../scripts/import/checks");
const { sheetsToDoc } = require("../scripts/import/doc");
const { parseGcashSheet } = require("../scripts/import/gcash");
const { applyImport } = require("../scripts/import/load");
const { parsePettySheet } = require("../scripts/import/petty-cash");
const { reconciliation } = require("../scripts/import/reconcile");
const { readWorkbook } = require("../scripts/import/xlsx");
const { createMemoryStore } = require("../netlify/lib/memory-store");
const { gcashBalance, cycleFooter } = require("../netlify/lib/sheet-math");

const UPLOADS = {
  petty: process.env.FINANCE_PETTY_XLSX || "/home/ubuntu/.cursor/projects/workspace/uploads/petty_cash_e8b1.xlsx",
  checks: process.env.FINANCE_CHECKS_XLSX || "/home/ubuntu/.cursor/projects/workspace/uploads/check_monitoring_619d.xlsx",
  gcash: process.env.FINANCE_GCASH_XLSX || "/home/ubuntu/.cursor/projects/workspace/uploads/gcash_b62d.xlsx",
  bills: process.env.FINANCE_BILLS_XLSX || "/home/ubuntu/.cursor/projects/workspace/uploads/bill_paying_4614.xlsx",
};

describe("dates from the real exports", () => {
  it("reads Excel serials and Manila calendar dates without a UTC shift", () => {
    assert.equal(parseMessyDate(46302).iso, "2026-10-07");
    assert.equal(parseMessyDate(46296).iso, "2026-10-01");
    assert.equal(parseMessyDate(new Date("2026-10-07T00:00:00.000Z")).iso, "2026-10-07");
    assert.equal(parseMessyDate(new Date("2026-10-06T16:00:00.000Z")).iso, "2026-10-07");
    assert.equal(parseMessyDate("2//2/2025").iso, "2025-02-02");
    assert.equal(parseMessyDate("109/2026").iso, "2026-10-09");
    assert.equal(parseMessyDate("8/14/.2026").iso, "2026-08-14");
    assert.equal(parseMessyDate("NA").ok, true);
    assert.equal(parseMessyDate("NA").iso, "");
  });
});

describe("trimmed layouts from the real workbooks", () => {
  it("reads PETTY CASH No. 35, a colon header, balance forwarded, and ignores the footer", () => {
    const parsed = parsePettySheet([
      ["PETTY CASH No. 35"],
      ["QB Upload", "Status: Scanned", "REFERENCE NO:", "DATE", "C/O", "SUPPLIER", "DESCRIPTION", "Project", "VRF", "Cash", "Release Amount", "Actual Amount", "SI No", "SI Date", "CLASSIFICATION", "AMOUNT"],
      ["", "", "", 46302, "", "", "Balance fowarded", "", "", 4243, "", "", "", "", "", ""],
      ["", "", "J2026-0101", 46302, "", "", "PCB No. 35", "", "", 100000, "", "", "", "", "", ""],
      ["", "", "PC2026-2349", 46302, "Ana Cruz", "Hardware", "Cement", "Tower", "", "", "", 300, "SI 1", 46302, "Vat", 250],
      ["", "", "Sir Lino", 46298, "Glory Mae", "Cash", "Kulag", "Yard", "", "", 100, "", "", "", "", ""],
      ["", "", "", "", "", "", "CASH FOR SUMMARY"],
      ["", "", "", "", "", "", "RUNNING CASH ON HAND", "", "", "", 24315, 76001],
      ["", "", "", "", "", "", "", "", "", "", 24315],
    ], { sheetName: "PCB35", defaultYear: 2026 });
    assert.equal(parsed.cycles.length, 1);
    const cycle = parsed.cycles[0];
    assert.equal(cycle.year, 2026);
    assert.equal(cycle.cycleNo, 35);
    assert.equal(cycle.opening, 4243);
    assert.equal(cycle.cashIns[0].amount, 100000);
    assert.equal(cycle.vouchers.length, 1);
    assert.equal(cycle.vouchers[0].amount, 300);
    assert.equal(cycle.vouchers[0].receipts[0].invoiceAmount, 250);
    assert.equal(cycle.vouchers[0].receipts[0].siDate, "2026-10-07");
    assert.equal(cycle.releases.length, 1);
    assert.equal(cycle.releases[0].amount, 100);
    const footer = cycleFooter({
      opening: cycle.opening,
      cashIns: cycle.cashIns,
      vouchers: cycle.vouchers.map((row) => ({ ...row, status: "posted" })),
      releases: cycle.releases,
    });
    assert.equal(footer.cashOnHand, 103843);
  });

  it("skips hidden, template, and copy tabs and keeps the cycle on the tab name", () => {
    const doc = sheetsToDoc({
      petty: [
        { name: "Template", hidden: 0, rows: [["PETTY CASH No. 29"]] },
        { name: "Copy of PCB13", hidden: 0, rows: [["PCB 13"]] },
        { name: "PCB2025-35 start", hidden: 1, rows: [["PCB 2025-35"]] },
        { name: "Masterlist of Data", hidden: 0, rows: [["", "Supplier", "", "", "", "", "Employee / c/o", "Project Code"], ["Acme Supply", "123", "", "", "", "", "Ana Cruz", "Tower A"]] },
        { name: "PCB35", hidden: 0, rows: [["PETTY CASH No. 35"]] },
      ],
      defaultYear: 2026,
    });
    assert.deepEqual(doc.petty.map((sheet) => sheet.name), ["PCB35"]);
    assert.deepEqual(doc.masters.suppliers, ["Acme Supply"]);
    assert.deepEqual(doc.masters.employees, ["Ana Cruz"]);
  });

  it("keeps GCash 2025 and 2026 apart and reads the CASH column", () => {
    const parsed = parseGcashSheet([
      ["", "BATCH 36"],
      ["", "REFERENCE NO.", "DATE", "C/O", "SUPPLIER", "DESCRIPTION", "PROJECT", "VRF", "CASH", "AMOUNT", "SI No", "SI Date", "AMOUNT", "", "REMARKS"],
      ["", "", "", "", "", "Balance forwarded from batch 35", "", "", 174.08],
      ["", "2026Gcash-0364", 46300, "", "", "Refund from a supplier", "", "", 2400],
      ["", "M2026-042", 46300, "", "", "M2026 to Gcash Account", "", "", 30000],
      ["", "2026Gcash-0358", 46300, "Arene", "Lumber", "CHB", "Dorm", "", "", 6500, "No classification"],
      ["", "", "", "", "", "", "", "Expenses:", "", 6500],
    ], { sheetName: "Gcash 2026", defaultYear: 2025 });
    assert.equal(parsed.batches.length, 1);
    assert.equal(parsed.batches[0].year, 2026);
    assert.equal(parsed.batches[0].opening, 174.08);
    assert.equal(parsed.batches[0].cashIns.length, 2);
    assert.equal(parsed.batches[0].expenses.length, 1);
    assert.equal(parsed.batches[0].expenses[0].amount, 6500);
    assert.equal(parsed.batches[0].expenses[0].siNo, "");
    const balance = gcashBalance({
      opening: parsed.batches[0].opening,
      cashIns: parsed.batches[0].cashIns,
      expenses: parsed.batches[0].expenses.map((row) => ({ ...row, status: "posted" })),
      receivables: [],
    });
    assert.equal(balance, 26074.08);
  });

  it("imports DBP numbers, BPI credit line, cancelled payees, and a dotted date", () => {
    const dbp = parseCheckSheet([
      ["Check Number", "Date", "PAYEE", "AMOUNT", "REMARKS"],
      ["DBP-89732001", 45603, "Mario Aircon", 20850, ""],
      ["DBP-89732003", 45630, "Alicia Lambon", 63000, "VOID"],
    ], { bankNickname: "DBP", sheetName: "DBP" });
    assert.equal(dbp.checks[0].checkNo, "DBP2024-89732001");
    assert.equal(dbp.checks[1].status, "void");
    const line = parseCheckSheet([
      ["CHECK NO.", "Date of Check", "PAYEE", "AMOUNT", "REMARKS"],
      ["BPICL2025-6000271902", "2//2/2025", "Fund transfer fro BPI", 5000000, ""],
      ["BPICL2025-6000271903", 45682, "Cancelled", 0, "Cancelled check"],
    ], { bankNickname: "BPI Credit Line", sheetName: "BPI Credit Line" });
    assert.equal(line.checks[0].checkDate, "2025-02-02");
    assert.equal(line.checks[0].isTransfer, true);
    assert.equal(line.checks[1].status, "cancelled");
    assert.equal(line.checks[1].supplier, "");
    const lbp = parseCheckSheet([
      ["DATE ISSUED", "Check Number", "Dated Check", "Payee", "Amount"],
      [46023, "LBP2026-0000724296", 46295, "Fund transfer from Landbank to PBB", 13500000],
    ], { bankNickname: "LBP", sheetName: "LBP 2026" });
    assert.equal(lbp.checks[0].checkDate, "2026-09-30");
    assert.equal(lbp.checks[0].isTransfer, true);
  });

  it("keeps the check amount when a later invoice row repeats the check number", () => {
    const parsed = parseCheckSheet([
      ["Reference Number / P.O.", "DATE ISSUED", "Check Number", "Date of Check", "Payee", "Amount", "SI No.", "SI Date", "Total"],
      ["PO2026-1128", 46210, "AUB2026-0004114779", 46272, "Trusales Corporation", 36860, "SI 056399", 46211, 28800],
      ["", 46210, "AUB2026-0004114779", 46272, "Trusales Corporation", "", "SI 056400", 46211, 8060],
      ["PO2026-1131", 46267, "AUB2026-0004114852", 46267, "Cebu Adgem Auto Parts", 16070, "SI 23309", 46211, 2350],
      ["PO2026-1147", "", "AUB2026-0004114852", "", "Cebu Adgem Auto Parts", "", "SI 23322", 46214, 7090],
    ], { bankNickname: "AUB", sheetName: "AUB 2026" });
    assert.equal(parsed.checks.length, 2);
    assert.equal(parsed.checks[0].amount, 36860);
    assert.equal(parsed.checks[0].checkDate, "2026-09-07");
    assert.equal(parsed.checks[0].invoices.length, 2);
    assert.equal(parsed.checks[0].invoices[1].amount, 8060);
    assert.equal(parsed.checks[1].amount, 16070);
    assert.equal(parsed.checks[1].invoices.length, 2);
  });

  it("pairs bill amounts in calendar order when a month label has shifted", () => {
    const header = ["", "Bill payment 2026"];
    const months = [];
    const sub = ["BP", "Category", "Bill", "Account Number", "Account Name"];
    for (let i = 0; i < 12; i += 1) {
      months[5 + i * 4] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][i];
      sub[5 + i * 4] = "Amount";
    }
    months[38] = "September";
    const row = ["1", "Office", "VECO", "5369", "Jeffrey"];
    row[5] = 100;
    row[37] = 900;
    const parsed = parseBillGrid([header, months, sub, row], { sheetName: "Bill paying checklist 2026", defaultYear: 2026 });
    const sept = parsed.bills.find((item) => item.month === "2026-09");
    const jan = parsed.bills.find((item) => item.month === "2026-01");
    assert.equal(jan.amount, 100);
    assert.equal(sept.amount, 900);
    assert.equal(parsed.bills.length, 2);
  });

  it("loads rental receipts and yearly property taxes", () => {
    const rent = parseRentalSheet([
      ["", "Rental Income 2026"],
      ["", "", "", "", "", "January", "", "", "", "February", "", "", "", "March", "", "", "", "April"],
      ["FOLDER No.", "", "", "Unit Details", "Account Name", "Amount", "Due date", "Date paid", "Done", "Amount", "", "", "", "Amount", "", "", "", "Amount"],
      ["50", "Residencia Edades Condo", "", "Unit 720", "Janice", "", "", "", "", "", "", "", "", "", "", "", "", 8500],
    ], { sheetName: "Rental Income ", defaultYear: 2026 });
    assert.equal(rent.receipts.length, 1);
    assert.equal(rent.receipts[0].month, "2026-04");
    assert.equal(rent.receipts[0].amount, 8500);
    const taxes = parseYearlySheet([
      ["Yearly Payments", "", "Tax Declaration Number"],
      ["Property taxes", "PITOS HOUSE", ""],
    ], { sheetName: "Yearly", defaultYear: 2026 });
    assert.equal(taxes.taxes[0].site, "PITOS HOUSE");
    assert.equal(taxes.taxes[0].year, 2026);
  });
});

describe("real workbook reconciliation", () => {
  const ready = Object.values(UPLOADS).every((file) => fs.existsSync(file));
  const run = ready ? it : it.skip;
  run("dry-runs the four exports to the sheet totals", async () => {
    const doc = sheetsToDoc({
      petty: readWorkbook(UPLOADS.petty),
      checks: readWorkbook(UPLOADS.checks),
      gcash: readWorkbook(UPLOADS.gcash),
      bills: readWorkbook(UPLOADS.bills),
      defaultYear: 2026,
    });
    const store = createMemoryStore();
    const loaded = await applyImport(store, doc);
    const report = await reconciliation(store);
    assert.equal(report.pcb35.cashOnHand, 28242);
    assert.equal(report.pcb35.openReleases, 24315);
    assert.equal(report.pcb35.matches, true);
    assert.equal(report.gcash.balance, 1394.11);
    assert.equal(report.gcash.matches, true);
    assert.equal(report.sept2026.total, 11553814.54);
    assert.equal(report.sept2026.matches, true);
    const cancelled = (await store.list("suppliers")).find((row) => row.name_key === "cancelled" || row.name_key === "cancelled check");
    assert.equal(cancelled, undefined);
    const checks = await store.list("checks");
    assert.ok(checks.some((row) => row.status === "cancelled" && /cancelled/i.test(row.payee)));
    assert.ok(checks.some((row) => row.bank_code === "DBP"));
    assert.ok(checks.some((row) => String(row.check_no).startsWith("BPICL")));
    const loan = checks.filter((row) => String(row.check_no).startsWith("BPILOAN"));
    const joint = checks.filter((row) => String(row.check_no).startsWith("BDOJOINT"));
    assert.equal(loan.length, 10);
    assert.ok(loan.every((row) => row.bank_account_id === "bank-bpi-cl"));
    assert.equal(joint.length, 31);
    assert.ok(joint.every((row) => row.bank_account_id === "bank-bdo-personal"));
    const personal = (await store.list("bank_accounts")).find((row) => row.id === "bank-bdo-personal");
    assert.equal(personal.is_personal, true);
    assert.equal((loaded.issues || []).some((row) => row.message === "No bank account matches this check."), false);
    assert.equal((await store.list("property_taxes")).length, 12);
    assert.ok((await store.list("rental_receipts")).length >= 27);
    const bills2026 = new Set((await store.list("checklist_bills")).map((row) => row.import_key));
    assert.ok(bills2026.size >= 56);
    assert.ok((loaded.issues || []).length < 200);
  });
});
