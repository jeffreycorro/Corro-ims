"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { billMonitor } = require("../netlify/lib/bill-monitor");
const { seedReference } = require("../netlify/lib/domain");
const { createMemoryStore } = require("../netlify/lib/memory-store");
const { actChecklist, handleSheet, saveCheck, saveChecklistBill, saveChecklistInstance } = require("../netlify/lib/registers");

const TODAY = "2026-10-10";

function inst(partial) {
  return { status: "unpaid", due_date: "", amount: 0, ...partial };
}

function sample() {
  const bills = [
    { id: "bill-veco", category: "Office", biller: "VECO", bill_type: "Electricity" },
    { id: "bill-water", category: "Office", biller: "MCWD", bill_type: "Water" },
    { id: "bill-net", category: "Office", biller: "PLDT", bill_type: "Internet/Telecom" },
    { id: "bill-rent", category: "Office", biller: "Landlord", bill_type: "Rent" },
    { id: "bill-rcbc", category: "CREDIT CARDS", biller: "RCBC", bill_type: "Credit Cards", card_name: "RCBC" },
  ];
  const instances = [
    inst({ id: "a1", bill_id: "bill-veco", month: "2025-01", amount: 1000, status: "paid" }),
    inst({ id: "a2", bill_id: "bill-veco", month: "2025-06", amount: 1000, status: "paid" }),
    inst({ id: "a3", bill_id: "bill-veco", month: "2025-12", amount: 1000, status: "paid" }),
    inst({ id: "a4", bill_id: "bill-rcbc", month: "2025-03", amount: 400, status: "paid" }),
    inst({ id: "b1", bill_id: "bill-veco", month: "2026-01", amount: 1500, status: "paid" }),
    inst({ id: "b2", bill_id: "bill-water", month: "2026-02", amount: 100, status: "paid" }),
    inst({ id: "b3", bill_id: "bill-rcbc", month: "2026-03", amount: 600, status: "paid" }),
    inst({ id: "b4", bill_id: "bill-veco", month: "2026-09", amount: 2000, status: "paid" }),
    inst({ id: "b5", bill_id: "bill-veco", month: "2026-10", amount: 9000, status: "paid" }),
    inst({ id: "b6", bill_id: "bill-veco", month: "2026-11", amount: 800, status: "unpaid" }),
    inst({ id: "b7", bill_id: "bill-rcbc", month: "2026-09", amount: 700, status: "unpaid" }),
    inst({ id: "b8", bill_id: "bill-net", month: "2026-10", amount: 250, status: "unpaid", due_date: "2026-10-01" }),
    inst({ id: "b9", bill_id: "bill-rent", month: "2026-10", amount: 100, status: "unpaid", due_date: "2026-10-10" }),
    inst({ id: "b10", bill_id: "bill-water", month: "2026-10", amount: 300, status: "unpaid", due_date: "2026-10-12" }),
    inst({ id: "b11", bill_id: "bill-veco", month: "2026-12", amount: 99999, status: "n-a" }),
  ];
  return { bills, instances };
}

describe("bill payments dashboard", () => {
  it("totals paid months, flags attention, and groups the spend", () => {
    const { bills, instances } = sample();
    const mon = billMonitor(bills, instances, { today: TODAY });
    assert.equal(mon.kpis.lastYearPaid, 3400);
    assert.equal(mon.kpis.thisYearPaid, 4200);
    assert.equal(mon.throughLabel, "September");
    assert.equal(mon.kpis.pctVsLastYear, 75);
    assert.equal(mon.kpis.pctExcludingCards, 80);
    assert.equal(mon.kpis.attentionTotal, 1050);
    assert.equal(mon.kpis.attentionCount, 3);
    const rcbc = mon.attention.find((row) => row.id === "b7");
    assert.equal(rcbc.pill, "OVERDUE");
    assert.equal(rcbc.statement, "Sep statement, due ~Oct");
    assert.equal(mon.attention.find((row) => row.id === "b9").pill, "DUE NOW");
    assert.equal(mon.upcomingTotal, 800);
    assert.equal(mon.upcoming[0].pill, "UPCOMING");
    assert.equal(mon.reminderTotal, 400);
    assert.deepEqual(mon.reminders.map((row) => row.id), ["b9", "b10"]);
    const october = mon.trend.monthly.find((row) => row.month === "2026-10");
    assert.equal(october.inProgress, true);
    assert.equal(october.thisYear, 9000);
    assert.equal(mon.trend.readout.thisYtd, 4200);
    assert.equal(mon.trend.readout.progressAmount, 9000);
    assert.equal(mon.trend.readout.lastFull, 3400);
    assert.equal(mon.trend.cumulative[8].thisYear, 4200);
    assert.equal(mon.trend.cumulative[9].thisYear, 13200);
    assert.deepEqual(mon.spend.ytd.location.map((row) => [row.label, row.amount, row.pct]), [
      ["Office", 3600, 85.7],
      ["CREDIT CARDS", 600, 14.3],
    ]);
    assert.equal(mon.spend.ytd.cards[0].label, "RCBC");
    assert.equal(mon.spend.ytd.cards[0].pct, 100);
    const office = billMonitor(bills, instances, { today: TODAY, category: "Office", billId: "bill-veco" });
    assert.equal(office.kpis.thisYearPaid, 4200);
    assert.equal(office.trend.readout.thisYtd, 3500);
    assert.equal(office.trend.readout.pct, 75);
    assert.ok(office.items.every((row) => row.category === "Office"));
    const excl = billMonitor(bills, instances, { today: TODAY, category: "excl" });
    assert.equal(excl.trend.readout.thisYtd, 3600);
    assert.equal(excl.trend.readout.pct, 80);
  });

  it("marks a month paid or n/a, recurs a fixed bill, and seeds the rental units", async () => {
    const store = createMemoryStore();
    await seedReference(store);
    const ctx = { name: "Ana Cruz", today: TODAY, now: "2026-10-10T09:00:00+08:00" };
    await assert.rejects(() => saveChecklistBill(store, { category: "Office", biller: "X" }), /bill type/);
    await assert.rejects(() => saveChecklistBill(store, { category: "CREDIT CARDS", biller: "RCBC", billType: "Credit Cards" }), /credit card/);
    const rent = await saveChecklistBill(store, {
      category: "Office",
      biller: "Shop rent",
      billType: "Rent",
      recurring: "true",
      recurringAmount: 1000,
      dueDay: 5,
      paymentMethod: "check",
    });
    await saveChecklistInstance(store, { billId: rent.id, month: "2026-10", amount: 50, status: "unpaid", dueDate: TODAY });
    const open = await saveChecklistInstance(store, { billId: rent.id, month: "2026-08", amount: 80, status: "unpaid", dueDate: "2026-08-01" });
    await assert.rejects(() => actChecklist(store, open.id, "paid", {}), /Date paid/);
    await assert.rejects(() => actChecklist(store, open.id, "paid", { paidDate: TODAY, paymentKind: "check", paymentId: "missing" }), /not found/);
    const check = await saveCheck(store, { bankAccountId: "bank-bpi-1842", checkNo: "BPI2026-77", checkDate: TODAY, payee: "Shop rent", amount: 80 });
    const paid = await actChecklist(store, open.id, "paid", { paidDate: TODAY, paymentMethod: "check", paymentKind: "check", paymentId: check.id });
    assert.equal(paid.status, "paid");
    assert.equal(paid.payment_id, check.id);
    const skipped = await saveChecklistInstance(store, { billId: rent.id, month: "2026-07", amount: 70, status: "unpaid", dueDate: "2026-07-01" });
    await actChecklist(store, skipped.id, "na");
    const first = await handleSheet("sheetState", store, { view: "checklist" }, ctx);
    const rows = first.body.state.instances.filter((row) => row.bill_id === rent.id);
    assert.deepEqual(rows.map((row) => row.month).sort(), ["2026-07", "2026-08", "2026-10", "2026-11", "2026-12", "2027-01"]);
    assert.equal(rows.find((row) => row.month === "2026-10").amount, 50);
    assert.equal(rows.find((row) => row.month === "2026-11").amount, 1000);
    assert.equal(rows.find((row) => row.month === "2026-11").due_date, "2026-11-05");
    const again = await handleSheet("sheetState", store, { view: "checklist" }, ctx);
    assert.equal(again.body.state.instances.filter((row) => row.bill_id === rent.id).length, rows.length);
    assert.equal(first.body.state.monitor.attention.some((row) => row.id === skipped.id), false);
    const units = first.body.state.rentals;
    assert.equal(units.find((row) => row.id === "rent-edades-720").monthly_rent, 8500);
    assert.equal(units.find((row) => row.id === "rent-soho-1123").monthly_rent, 10000);
    assert.equal(units.find((row) => row.id === "rent-sanremo-3314").monthly_rent, 12500);
    const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261010000003_finance_bill_dashboard.sql"), "utf8");
    assert.match(sql, /bill_type/);
    assert.match(sql, /receipt_path/);
    assert.match(sql, /monthly_rent/);
    assert.match(sql, /8500/);
    assert.doesNotMatch(sql, /drop table/i);
  });

  it("renders the bills dashboard from the monitor", () => {
    const { bills, instances } = sample();
    const mon = billMonitor(bills, instances, { today: TODAY });
    const code = fs.readFileSync(path.join(__dirname, "../public/finance-bills.js"), "utf8");
    const sandbox = { window: {}, document: { addEventListener() {} }, console };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const html = sandbox.window.FinanceBills.render({
      sheet: {
        monitor: mon,
        bills,
        instances,
        rentals: [
          { id: "rent-edades-720", name: "Residencia Edades 720", monthly_rent: 8500 },
          { id: "rent-soho-1123", name: "City Soho 1123", monthly_rent: 10000 },
          { id: "rent-sanremo-3314", name: "San Remo 3314", monthly_rent: 12500 },
        ],
        rentalReceipts: [],
        taxes: [],
        billTypes: ["Electricity", "Credit Cards"],
        cards: ["RCBC"],
        links: { checks: [], expenses: [], vouchers: [] },
      },
    });
    assert.match(html, /Last year total paid/);
    assert.match(html, /This year paid through September/);
    assert.match(html, /YTD vs last year/);
    assert.match(html, /Excl\. credit cards/);
    assert.match(html, /Needs attention/);
    assert.match(html, /not marked paid/);
    assert.match(html, /in progress/);
    assert.match(html, /OVERDUE/);
    assert.match(html, /DUE NOW/);
    assert.match(html, /Sep statement, due ~Oct/);
    assert.match(html, /UPCOMING/);
    assert.match(html, /WITHIN 3 DAYS/);
    assert.match(html, /Dark mode/);
    assert.match(html, /Residencia Edades 720/);
    assert.match(html, /₱8,500\.00/);
    assert.match(html, /Where the money goes/);
    assert.match(html, /By bill type/);
    const dark = sandbox.window.FinanceBills.render({
      billDark: true,
      sheet: { monitor: mon, bills, instances, rentals: [], rentalReceipts: [], taxes: [], links: {} },
    });
    assert.match(dark, /class="bills dark"/);
    const page = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.ok(page.indexOf("finance-bills.js") < page.indexOf("finance-sheets.js"));
  });
});
