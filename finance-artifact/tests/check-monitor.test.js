"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { bankColor, auditBooklets, checkMonitor, compactAmount, shouldStale } = require("../netlify/lib/check-monitor");
const { addDays } = require("../netlify/lib/manila");
const { createMemoryStore } = require("../netlify/lib/memory-store");
const { seedReference } = require("../netlify/lib/domain");
const { actCheck, checkPack, saveCheck } = require("../netlify/lib/registers");

const TODAY = "2026-10-10";
const BPI = "bank-bpi-1842";
const AUB = "bank-aub";
const BANKS = [
  { id: BPI, nickname: "BPI 1842", bank_code: "BPI" },
  { id: AUB, nickname: "AUB", bank_code: "AUB" },
  { id: "bank-pbb", nickname: "PBB", bank_code: "PBB" },
  { id: "bank-bdo", nickname: "BDO", bank_code: "BDO" },
];

function row(partial) {
  return {
    id: partial.check_no,
    status: "issued",
    is_transfer: false,
    bank_account_id: BPI,
    payee: "Payee",
    amount: 0,
    ...partial,
  };
}

function sample() {
  return [
    row({ check_no: "BPI2026-101", check_date: "2026-01-15", amount: 1000000, payee: "Alpha" }),
    row({ check_no: "BPI2026-102", check_date: "2026-02-15", amount: 100000, payee: "Beta" }),
    row({ check_no: "BPI2026-103", check_date: "2026-03-01", amount: 400000, payee: "Gamma" }),
    row({ check_no: "BPI2026-104", check_date: "2026-04-15", amount: 200000, payee: "Delta" }),
    row({ check_no: "BPI2026-105", check_date: "2026-07-15", amount: 300000, payee: "Epsilon" }),
    row({ check_no: "BPI2026-106", check_date: "2026-08-15", amount: 500000, payee: "Theta", status: "cleared", cleared_date: "2026-08-20" }),
    row({ check_no: "BPI2026-107", check_date: "2026-09-02", amount: 1000000, payee: "Zeta" }),
    row({ check_no: "BPI2026-108", check_date: "2026-09-20", amount: 9000000, payee: "Eta", status: "cancelled" }),
    row({ check_no: "AUB2026-201", check_date: "2026-10-05", amount: 200000, payee: "Moving cash", bank_account_id: AUB, is_transfer: true }),
    row({ check_no: "BPI2026-109", check_date: "2026-10-20", amount: 16100000, payee: "Iota" }),
    row({ check_no: "BPI2026-110", check_date: "2026-11-02", amount: 300000, payee: "Kappa" }),
    row({ check_no: "BPI2026-111", check_date: "2026-11-20", amount: 2000000, payee: "Lambda" }),
    row({ check_no: "AUB2026-202", check_date: "2026-06-15", amount: 50000, payee: "Mu", bank_account_id: AUB }),
    row({ check_no: "BPI2025-11", check_date: "2025-01-10", amount: 1000000, payee: "Nu" }),
    row({ check_no: "BPI2025-12", check_date: "2025-10-10", amount: 10000000, payee: "Xi" }),
    row({ check_no: "BPI2026-112", check_date: "2026-05-01", amount: 800000, payee: "Voided", status: "void" }),
  ];
}

describe("check monitoring dashboard", () => {
  it("colors the company banks and compacts chart labels", () => {
    assert.equal(bankColor("AUB"), "#6d28d9");
    assert.equal(bankColor("BPI"), "#c0392b");
    assert.equal(bankColor("BPI 1842"), "#c0392b");
    assert.equal(bankColor("PBB"), "#e07a2f");
    assert.equal(bankColor("PSB"), "#e07a2f");
    assert.equal(bankColor("BDO"), "#1d4ed8");
    assert.equal(compactAmount(16100000), "16.1M");
    assert.equal(compactAmount(16000000), "16.0M");
    assert.equal(compactAmount(1500), "1.5k");
  });

  it("builds the company banner, issued chart, due window, and outstanding months", () => {
    const mon = checkMonitor(sample(), BANKS, { today: TODAY, year: 2026 });
    assert.equal(mon.company, "Corro Construction Development and Trade Corporation");
    assert.equal(mon.outstandingOnward, 18400000);
    assert.equal(mon.dueThroughMonthEnd, 16100000);
    assert.equal(mon.monthName, "October");
    const october = mon.yearMonths.find((row) => row.month === "2026-10");
    assert.equal(october.current, true);
    assert.equal(october.total, 16100000);
    assert.equal(october.lastYear, 10000000);
    assert.equal(mon.totalShown, 21950000);
    assert.equal(mon.average, 1829166.67);
    assert.equal(mon.chips.ytd, 3550000);
    assert.equal(mon.chips.pctVsLastYear, -67.7);
    assert.equal(mon.chips.lastYearTotal, 11000000);
    assert.deepEqual(mon.chips.quarters, [1500000, 250000, 1800000, 18400000]);
    assert.equal(mon.chips.momPct, 1510);
    assert.equal(mon.chips.momLabel, "Oct vs Sep");
    assert.equal(mon.cumulative[9].thisYear, 19650000);
    assert.equal(mon.cumulative[9].lastYear, 11000000);
    assert.deepEqual(mon.due30.map((day) => day.date), ["2026-10-10", "2026-10-20", "2026-11-02"]);
    assert.equal(mon.due30[0].isToday, true);
    assert.equal(mon.due30[0].total, 0);
    assert.equal(mon.due30[1].checks[0].color, "#c0392b");
    assert.equal(mon.due30[1].checks[0].payee, "Iota");
    const outstanding = mon.outstandingMonths.map((row) => row.month);
    assert.deepEqual(outstanding, ["2025-01", "2025-10", "2026-01", "2026-02", "2026-03", "2026-04", "2026-06", "2026-07", "2026-09", "2026-10", "2026-11"]);
    assert.equal(mon.outstandingMonths.find((row) => row.month === "2026-10").bar, 100);
    assert.equal(mon.outstandingMonths.find((row) => row.month === "2026-10").banks[0].checks[0].payee, "Iota");
    assert.equal(mon.outstandingMonths.find((row) => row.month === "2026-11").bar, 14.3);

    const filtered = checkMonitor(sample(), BANKS, { today: TODAY, year: 2026, bankId: AUB });
    assert.equal(filtered.outstandingOnward, mon.outstandingOnward);
    assert.equal(filtered.dueThroughMonthEnd, mon.dueThroughMonthEnd);
    assert.equal(filtered.due30.length, mon.due30.length);
    assert.equal(filtered.totalShown, 50000);
    assert.equal(filtered.chips.ytd, 50000);
    assert.equal(filtered.shown.length, 12);

    const march = checkMonitor(sample(), BANKS, { today: TODAY, year: 2026, month: "03" });
    assert.equal(march.chips.ytd, 1500000);
    assert.equal(march.chips.pctVsLastYear, 50);
    assert.equal(march.chips.momPct, 300);
    assert.equal(march.cumulative.length, 12);
  });

  it("reports booklet gaps, including a cancelled serial, and collapses a long gap", () => {
    const banks = [{ id: "bank-lbp", nickname: "LBP", bank_code: "LBP" }];
    const short = auditBooklets([
      { bank_account_id: "bank-lbp", booklet_year: 2026, serial: "10", status: "cancelled" },
      { bank_account_id: "bank-lbp", booklet_year: 2026, serial: "12", status: "issued" },
    ], banks);
    assert.equal(short.length, 1);
    assert.deepEqual(short[0].gaps[0], { from: 11, to: 11, count: 1, numbers: [11] });
    const long = auditBooklets([
      { bank_account_id: "bank-lbp", booklet_year: 2026, serial: "1" },
      { bank_account_id: "bank-lbp", booklet_year: 2026, serial: "15" },
    ], banks);
    assert.deepEqual(long[0].gaps[0], { from: 2, to: 14, count: 13 });
    assert.equal(long[0].gaps[0].numbers, undefined);
  });

  it("marks a check stale after 180 days and keeps the lifecycle in order", async () => {
    assert.equal(shouldStale({ status: "released", check_date: addDays(TODAY, -180) }, TODAY), true);
    assert.equal(shouldStale({ status: "released", check_date: addDays(TODAY, -179) }, TODAY), false);
    assert.equal(shouldStale({ status: "cleared", check_date: addDays(TODAY, -400), cleared_date: TODAY }, TODAY), false);

    const store = createMemoryStore();
    await seedReference(store);
    const ctx = { name: "Ana Cruz", today: TODAY, now: "2026-10-10T09:00:00+08:00" };
    const stale = await saveCheck(store, {
      bankAccountId: BPI,
      checkNo: "BPI2026-1",
      checkDate: addDays(TODAY, -180),
      payee: "Old Supplier",
      amount: 1000,
    });
    const fresh = await saveCheck(store, {
      bankAccountId: BPI,
      checkNo: "BPI2026-2",
      checkDate: addDays(TODAY, -179),
      payee: "Recent Supplier",
      amount: 2000,
    });
    const pack = await checkPack(store, ctx);
    assert.equal((await store.get("checks", stale.id)).status, "stale");
    assert.equal((await store.get("checks", fresh.id)).status, "issued");
    assert.equal(pack.monitor.outstandingOnward, 0);
    assert.ok(pack.monitor.outstandingMonths.every((row) => row.banks.every((bank) => bank.checks.every((item) => item.id !== stale.id))));
    const april = pack.monitor.yearMonths.find((row) => row.month === addDays(TODAY, -180).slice(0, 7));
    assert.equal(april.total, 3000);

    await assert.rejects(() => actCheck(store, fresh.id, "release", { receivedBy: "Ana", releaseDate: TODAY }), /for signature/);
    await actCheck(store, fresh.id, "for signature");
    await assert.rejects(() => actCheck(store, fresh.id, "release", {}), /received/);
    const released = await actCheck(store, fresh.id, "release", { receivedBy: "Ana Cruz", releaseDate: TODAY });
    assert.equal(released.status, "released");
    assert.equal(released.received_by, "Ana Cruz");
    await assert.rejects(() => actCheck(store, fresh.id, "clear", {}), /Cleared date/);
    const cleared = await actCheck(store, fresh.id, "clear", { clearedDate: "2026-10-11" });
    assert.equal(cleared.status, "cleared");
    await assert.rejects(() => actCheck(store, fresh.id, "cancel", {}), /no longer/);

    const open = await saveCheck(store, {
      bankAccountId: BPI,
      checkNo: "BPI2026-3",
      checkDate: "2026-10-20",
      payee: "To Cancel",
      amount: 99999,
    });
    await actCheck(store, open.id, "cancel");
    const after = await checkPack(store, ctx, { year: 2026, month: "10", bankId: BPI });
    assert.equal(after.monitor.outstandingOnward, 0);
    assert.equal(after.monitor.totalShown, 0);
    const photo = await actCheck(store, stale.id, "photo", { photoUrl: "check/stale/photo.jpg" });
    assert.equal(photo.photo_url, "check/stale/photo.jpg");
    assert.equal(photo.scanned, true);
    const clearedStale = await actCheck(store, stale.id, "clear", { clearedDate: TODAY });
    assert.equal(clearedStale.status, "cleared");
  });

  it("renders the scrolling checks dashboard from the monitor", () => {
    const mon = checkMonitor(sample(), BANKS, { today: TODAY, year: 2026 });
    mon.photos = [{ id: "pic", check_no: "BPI2026-109", payee: "Iota", amount: 16100000, bank: "BPI 1842", color: "#c0392b", photo_href: "https://example.test/check.jpg" }];
    const code = fs.readFileSync(path.join(__dirname, "../public/finance-checks.js"), "utf8");
    const sandbox = {
      window: {},
      document: { addEventListener() {}, getElementById() { return null; } },
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const html = sandbox.window.FinanceChecks.render({
      sheet: { monitor: mon, checks: [], banks: BANKS, suppliers: [], invoices: [] },
      checkUpdated: "2026-10-10T09:00:00+08:00",
    });
    assert.match(html, /Corro Construction Development and Trade Corporation/);
    assert.match(html, /Outstanding from this month onward/);
    assert.match(html, /Due today — end of October/);
    assert.match(html, /₱18,400,000\.00/);
    assert.match(html, /₱16,100,000\.00/);
    assert.match(html, /16\.1M/);
    assert.match(html, /data-check-bar="10"/);
    assert.match(html, /chk-day today/);
    assert.match(html, /#c0392b/);
    assert.match(html, /CHECKS ISSUED/);
    assert.match(html, /DUE NEXT 30 DAYS/);
    assert.match(html, /Run audit — find missing checks/);
    assert.match(html, /Excludes canceled checks & inter-bank transfers/);
    assert.match(html, /Issue a check/);
    assert.match(html, /Check photos/);
    assert.match(html, /stroke-dasharray/);
    const hidden = sandbox.window.FinanceChecks.render({
      sheet: { monitor: mon, checks: [], banks: BANKS, suppliers: [], invoices: [] },
      checkGuides: false,
      checkChart: "bars",
    });
    assert.doesNotMatch(hidden, /stroke-dasharray/);
    const stacked = sandbox.window.FinanceChecks.render({
      sheet: { monitor: mon, checks: [], banks: BANKS, suppliers: [], invoices: [] },
      checkChart: "stack",
      checkGuides: false,
    });
    assert.match(stacked, /#c0392b/);
    const page = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.ok(page.indexOf("finance-checks.js") < page.indexOf("finance-sheets.js"));
  });
});
