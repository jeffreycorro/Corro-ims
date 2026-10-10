"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseMessyDate } = require("../scripts/import/dates");
const { parseBillGrid } = require("../scripts/import/bills");
const { parseCheckSheet } = require("../scripts/import/checks");
const { parseGcashSheet } = require("../scripts/import/gcash");
const { applyImport } = require("../scripts/import/load");
const { parsePettySheet } = require("../scripts/import/petty-cash");
const { reconciliation } = require("../scripts/import/reconcile");
const { saveProject, seedReference } = require("../netlify/lib/domain");
const { decryptAccount } = require("../netlify/lib/mask");
const { createMemoryStore } = require("../netlify/lib/memory-store");
const { formatNumber } = require("../netlify/lib/numbering");
const { saveAlias, saveBankAccount } = require("../netlify/lib/masters");
const {
  closeCycle,
  openBatch,
  openCycle,
  saveCashIn,
  saveCheck,
  saveCheckInvoice,
  saveGcashExpense,
  savePcv,
  saveRelease,
} = require("../netlify/lib/registers");
const { dueStatus, monthTotals } = require("../netlify/lib/sheet-math");

const TODAY = { name: "Ana Cruz", today: "2026-10-10", now: "2026-10-10T09:00:00+08:00" };

async function ready() {
  const store = createMemoryStore();
  await seedReference(store);
  await saveProject(store, { name: "Tower A", code: "TA", client: "Owner", site: "Cebu" });
  const employee = (await store.list("employees")).find((row) => row.name === "Unassigned");
  const project = (await store.list("projects")).find((row) => row.name === "Tower A");
  const supplier = (await store.list("suppliers")).find((row) => row.name === "Cash");
  return { store, employee, project, supplier };
}

describe("sheet dates and layouts", () => {
  it("reads the messy dates from the sheets", () => {
    assert.equal(parseMessyDate("01/272026").iso, "2026-01-27");
    assert.equal(parseMessyDate("1 /7/2026").iso, "2026-01-07");
    assert.equal(parseMessyDate("Septemebr 14,2026").iso, "2026-09-14");
    assert.equal(parseMessyDate("13/01/2026").iso, "2026-01-13");
    assert.equal(parseMessyDate("not a date").ok, false);
  });

  it("reads both petty-cash header layouts and keeps a bad date as an issue", () => {
    const header2026 = ["QB Upload", "Status Scanned", "REFERENCE NO", "DATE", "C/O", "SUPPLIER", "DESCRIPTION", "Project", "VRF", "Cash", "Release Amount", "Actual Amount", "REF No", "Supplier Name", "TIN", "SI No", "SI Date", "CLASSIFICATION", "AMOUNT", "REMARKS"];
    const header2025 = ["REFERENCE NO", "DATE", "C/O", "SUPPLIER", "DESCRIPTION", "Project", "VRF", "Cash", "Release Amount", "Actual Amount", "REF No", "Supplier Name", "TIN", "SI No", "SI Date", "CLASSIFICATION", "AMOUNT"];
    const body = ["", "", "PC2026-0007", "yesterday", "Ana Cruz", "Cash", "Fuel", "Tower A", "", "", "", 500, "", "", "", "", "", "", "", ""];
    const parsed2026 = parsePettySheet([["PCB 2026-35"], header2026, body], { defaultYear: 2026 });
    assert.equal(parsed2026.cycles[0].cycleNo, 35);
    assert.equal(parsed2026.cycles[0].vouchers[0].pcvNo, "PC2026-0007");
    assert.equal(parsed2026.issues[0].field, "date");
    const row2025 = ["PC2026-0008", "01/272026", "Ana Cruz", "Cash", "Fuel", "Tower A", "VRF-9", "", "", 400, "", "", "", "", "", "", ""];
    const parsed2025 = parsePettySheet([["PCB 35"], header2025, row2025], { defaultYear: 2026 });
    assert.equal(parsed2025.cycles[0].year, 2026);
    assert.equal(parsed2025.cycles[0].vouchers[0].date, "2026-01-27");
    assert.equal(parsed2025.cycles[0].vouchers[0].vrf, "VRF-9");
  });

  it("fills check invoices down from the previous check number", () => {
    const parsed = parseCheckSheet([
      ["Check No", "Check Date", "Payee", "Amount", "SI No", "SI Amount"],
      ["BPI2026-1000274146", "2026-09-02", "ABC Trading", 1000, "SI-1", 600],
      ["", "", "", "", "SI-2", -50],
    ], { bankNickname: "BPI 1842" });
    assert.equal(parsed.checks.length, 1);
    assert.equal(parsed.checks[0].invoices.length, 2);
    assert.equal(parsed.checks[0].invoices[1].amount, -50);
    assert.equal(parsed.checks[0].bookletYear, 2026);
  });

  it("splits GCash batches and shifts a 2026 row by one column", () => {
    const header = ["REF", "DATE", "C/O", "SUPPLIER", "DESCRIPTION", "PROJECT", "AMOUNT", "FEE"];
    const parsed = parseGcashSheet([
      ["BATCH 3"],
      header,
      ["", "2026Gcash-0004", "2026-09-01", "Ana Cruz", "Shell", "Load", "Tower A", 100, 5],
      ["BATCH 4"],
      header,
      ["2026Gcash-0005", "2026-09-02", "Ana Cruz", "Shell", "Oil", "Tower A", 40, 0],
    ], { defaultYear: 2026 });
    assert.equal(parsed.batches.length, 2);
    assert.equal(parsed.batches[0].expenses[0].ref, "2026Gcash-0004");
    assert.equal(parsed.batches[0].expenses[0].date, "2026-09-01");
    assert.equal(parsed.batches[0].expenses[0].amount, 100);
    assert.equal(parsed.batches[1].expenses[0].ref, "2026Gcash-0005");
  });

  it("unpivots a bill grid when the month labels sit one column left of the amounts", () => {
    const parsed = parseBillGrid([
      ["Site", "Biller", "Jan", "Feb", "Mar"],
      ["Office", "Meralco", "note", 100, 200, 300],
    ], { defaultYear: 2026 });
    assert.equal(parsed.shift, 1);
    assert.deepEqual(parsed.bills.map((row) => row.amount), [100, 200, 300]);
    assert.equal(parsed.bills[0].month, "2026-01");
    assert.equal(parsed.bills[0].biller, "Meralco");
  });
});

describe("petty cash, checks, GCash, and bills", () => {
  it("computes PCB 35 cash on hand and carries it to the next cycle", async () => {
    const { store, employee, project, supplier } = await ready();
    const opened = await openCycle(store, { year: 2026, cycleNo: 35, openingBalance: 10000, dateFrom: "2026-09-01" });
    await saveCashIn(store, { cycleId: opened.cycle.id, date: "2026-09-01", sourceType: "J", referenceNo: "J2026-0101", amount: 80000 });
    const voucher = await savePcv(store, {
      cycleId: opened.cycle.id,
      date: "2026-09-02",
      employeeId: employee.id,
      supplierId: supplier.id,
      projectId: project.id,
      description: "Fuel",
      amount: 37443,
      vrfNo: "VRF-35",
    }, TODAY);
    assert.equal(voucher.pcv_no, "PC2026-0001");
    await saveRelease(store, {
      cycleId: opened.cycle.id,
      date: "2026-09-03",
      employeeId: employee.id,
      projectId: project.id,
      description: "Site errand",
      statusNote: "lacking attachments",
      amount: 24315,
    });
    const detail = await openCycle(store, { year: 2026, cycleNo: 35 });
    assert.equal(detail.footer.cashOnHand, 28242);
    assert.equal(detail.footer.cashReleased, 24315);
    const closed = await closeCycle(store, opened.cycle.id);
    assert.equal(closed.cycle.status, "closed");
    const next = (await store.list("petty_cycles")).find((row) => row.cycle_no === 36);
    assert.equal(next.opening_balance, 28242);
    await assert.rejects(() => savePcv(store, { cycleId: opened.cycle.id, employeeId: employee.id, supplierId: supplier.id, projectId: project.id, amount: 1 }, TODAY), /closed/);
  });

  it("assigns the next PCV after an imported number and rejects a free-text employee", async () => {
    const { store, employee, project, supplier } = await ready();
    const opened = await openCycle(store, { year: 2026, cycleNo: 1, openingBalance: 0 });
    await applyImport(store, {
      defaultYear: 2026,
      petty: [
        ["PCB 2026-1"],
        ["REFERENCE NO", "DATE", "C/O", "SUPPLIER", "DESCRIPTION", "Project", "VRF", "Cash", "Release Amount", "Actual Amount", "SI No", "SI Date", "CLASSIFICATION", "AMOUNT"],
        ["PC2026-0005", "2026-09-02", "Nobody Special", "Cash", "Fuel", "Tower A", "VRF-1", "", "", 10, "", "", "", ""],
      ],
    });
    const imported = (await store.list("petty_vouchers")).find((row) => row.pcv_no === "PC2026-0005");
    assert.equal(imported.employee_name, "Nobody Special");
    const again = await savePcv(store, {
      cycleId: opened.cycle.id,
      date: "2026-09-04",
      employeeId: employee.id,
      supplierId: supplier.id,
      projectId: project.id,
      amount: 12,
    }, TODAY);
    assert.equal(again.pcv_no, "PC2026-0006");
    assert.equal(formatNumber("GC", 2026, 4), "2026Gcash-0004");
    await assert.rejects(
      () => savePcv(store, { cycleId: opened.cycle.id, employeeName: "Typed Name", supplierId: supplier.id, projectId: project.id, amount: 5 }, TODAY),
      /employee/
    );
  });

  it("keeps September 2026 check totals and leaves transfers out of expenses", async () => {
    const { store, supplier } = await ready();
    const bpi = (await store.list("bank_accounts")).find((row) => row.nickname === "BPI 1842");
    const bdo = (await store.list("bank_accounts")).find((row) => row.nickname === "BDO");
    const check = await saveCheck(store, {
      bankAccountId: bpi.id,
      checkNo: "BPI2026-1000274146",
      checkDate: "2026-09-15",
      dateIssued: "2026-09-01",
      payee: "ABC Trading",
      supplierId: supplier.id,
      amount: 11553814.54,
      status: "issued",
    });
    await saveCheckInvoice(store, { checkId: check.id, siNo: "SI-1", siDate: "2026-09-01", amount: 100 });
    await saveCheckInvoice(store, { checkId: check.id, siNo: "SI-2", siDate: "2026-09-02", amount: -50 });
    await saveCheck(store, {
      bankAccountId: bdo.id,
      checkNo: "BDO2025-88",
      checkDate: "2026-09-20",
      payee: "BPI 1842",
      amount: 500,
      isTransfer: true,
      status: "cleared",
      clearedDate: "2026-09-21",
    });
    const checks = await store.list("checks");
    const month = monthTotals(checks, "2026-09");
    assert.equal(month.total, 11554314.54);
    assert.equal(month.expense, 11553814.54);
    assert.equal(dueStatus(check, "2026-10-10"), "Overdue");
    assert.equal(dueStatus({ ...check, check_date: "2026-10-10", status: "issued" }, "2026-10-10"), "Due Today");
    assert.equal(dueStatus({ ...check, check_date: "2026-10-13", status: "released" }, "2026-10-10"), "Due Soon");
    assert.equal(dueStatus({ ...check, status: "cleared", cleared_date: "2026-09-30" }, "2026-10-10"), "Cleared");
    await assert.rejects(() => saveCheck(store, { bankAccountId: bpi.id, checkNo: "BPI2026-1000274146", checkDate: "2026-09-16", payee: "Again", amount: 1 }), /already/);
    const top = await saveCheck(store, {
      bankAccountId: bpi.id,
      checkNo: "BPI2026-1000274147",
      checkDate: "2026-09-18",
      payee: "Petty Cash PCB No. 35",
      amount: 1000,
    });
    await openCycle(store, { year: 2026, cycleNo: 35, openingBalance: 0 });
    const late = (await store.list("petty_cash_ins")).find((row) => row.check_id === top.id);
    assert.equal(late, undefined);
    await saveCheck(store, {
      bankAccountId: bdo.id,
      checkNo: "BDO2026-90",
      checkDate: "2026-10-01",
      payee: "Petty Cash PCB No. 35",
      amount: 2500,
    });
    const linked = (await store.list("petty_cash_ins")).find((row) => row.reference_no === "BDO2026-90");
    assert.equal(linked.amount, 2500);
    assert.equal(linked.source_type, "CHECK");
  });

  it("computes the GCash balance and never asks for a typed balance", async () => {
    const { store, employee, project, supplier } = await ready();
    const opened = await openBatch(store, { year: 2026, batchNo: 8, openingBalance: 30000 });
    await saveGcashExpense(store, {
      batchId: opened.batch.id,
      date: "2026-09-04",
      employeeId: employee.id,
      supplierId: supplier.id,
      projectId: project.id,
      amount: 28605.89,
      fee: 0,
      description: "Loads",
    }, TODAY);
    const detail = await openBatch(store, { year: 2026, batchNo: 8 });
    assert.equal(detail.balance, 1394.11);
    assert.equal(detail.expenses[0].ref_no, "2026Gcash-0001");
    assert.equal(detail.batch.opening_balance, 30000);
  });

  it("stores only a masked account number", async () => {
    process.env.FINANCE_BANK_SECRET = "unit-test-secret";
    const { store } = await ready();
    const saved = await saveBankAccount(store, { nickname: "BDO", accountNo: "001234567890" });
    assert.equal(saved.account_no, "••••7890");
    assert.equal(JSON.stringify(saved).includes("001234567890"), false);
    const secret = await store.get("bank_secrets", saved.id);
    assert.equal(decryptAccount(secret.ciphertext), "001234567890");
    assert.doesNotMatch(secret.ciphertext, /1234567890/);
  });

  it("imports twice without duplicating rows and maps an alias", async () => {
    const { store, employee } = await ready();
    await saveAlias(store, { kind: "employee", alias: "Ana  Cruz", targetId: employee.id });
    const doc = {
      defaultYear: 2026,
      petty: [
        ["PCB 2026-2"],
        ["REFERENCE NO", "DATE", "C/O", "SUPPLIER", "DESCRIPTION", "Project", "Actual Amount", "SI No", "SI Date", "CLASSIFICATION", "AMOUNT", "REMARKS"],
        ["PC2026-0003", "Septemebr 14,2026", "Ana  Cruz", "Mystery Store", "Cement", "No Such Job", 80, "", "", "", "", ""],
        ["", "", "", "", "", "", "", "SI-9", "01/272026", "Vat", 80, ""],
      ],
    };
    await applyImport(store, doc);
    await applyImport(store, doc);
    const vouchers = await store.list("petty_vouchers");
    assert.equal(vouchers.length, 1);
    assert.equal(vouchers[0].employee_id, employee.id);
    assert.equal(vouchers[0].txn_date, "2026-09-14");
    assert.equal(vouchers[0].supplier_name, "Mystery Store");
    assert.equal(vouchers[0].project_name, "No Such Job");
    const receipts = await store.list("petty_receipts");
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].si_date, "2026-01-27");
    const issues = await store.list("import_issues");
    assert.equal(issues.filter((row) => /Mystery Store/.test(row.message)).length, 0);
  });

  it("matches the reconciliation targets from the sheet footers", async () => {
    const { store, employee, project, supplier } = await ready();
    const petty = await openCycle(store, { year: 2026, cycleNo: 35, openingBalance: 10000 });
    await saveCashIn(store, { cycleId: petty.cycle.id, date: "2026-09-01", sourceType: "J", referenceNo: "J2026-0101", amount: 80000 });
    await savePcv(store, { cycleId: petty.cycle.id, date: "2026-09-02", employeeId: employee.id, supplierId: supplier.id, projectId: project.id, amount: 37443 }, TODAY);
    await saveRelease(store, { cycleId: petty.cycle.id, date: "2026-09-03", employeeId: employee.id, projectId: project.id, description: "Open", amount: 24315 });
    const batch = await openBatch(store, { year: 2026, batchNo: 1, openingBalance: 30000 });
    await saveGcashExpense(store, { batchId: batch.batch.id, date: "2026-09-04", employeeId: employee.id, supplierId: supplier.id, projectId: project.id, amount: 28605.89 }, TODAY);
    const bpi = (await store.list("bank_accounts")).find((row) => row.bank_code === "BPI" && row.nickname === "BPI 1842");
    await saveCheck(store, { bankAccountId: bpi.id, checkNo: "BPI2026-100", checkDate: "2026-09-30", payee: "Suppliers", amount: 11553814.54 });
    const report = await reconciliation(store);
    assert.equal(report.pcb35.cashOnHand, 28242);
    assert.equal(report.pcb35.openReleases, 24315);
    assert.equal(report.pcb35.matches, true);
    assert.equal(report.gcash.balance, 1394.11);
    assert.equal(report.gcash.matches, true);
    assert.equal(report.sept2026.total, 11553814.54);
    assert.equal(report.sept2026.matches, true);
  });

  it("keeps the second migration additive and service-role only", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261010000002_finance_sheet_registers.sql"), "utf8");
    assert.match(sql, /finance_petty_cycles/);
    assert.match(sql, /finance_checks/);
    assert.match(sql, /finance_wallet_expenses/);
    assert.match(sql, /finance_checklist_instances/);
    assert.match(sql, /finance_import_issues/);
    assert.match(sql, /Gcash-/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /raw account numbers are not stored/);
    assert.doesNotMatch(sql, /drop table/i);
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /finance-sheets\.js/);
    const sheets = fs.readFileSync(path.join(__dirname, "../public/finance-sheets.js"), "utf8");
    assert.match(sheets, /employeeId/);
    assert.match(sheets, /Cash on hand/);
  });
});
