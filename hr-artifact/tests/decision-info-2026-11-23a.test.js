"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const decisionSrc = fs.readFileSync(path.join(root, "public/hr-decision-info.js"), "utf8");
const sheetSrc = fs.readFileSync(path.join(root, "public/hr-payroll-sheet.js"), "utf8");
const approverSrc = fs.readFileSync(path.join(root, "public/hr-approver.js"), "utf8");

function loadDecision() {
  const ctx = { console, Intl, Date };
  vm.runInNewContext(sheetSrc, ctx);
  vm.runInNewContext(decisionSrc, ctx);
  return ctx.hrDecision;
}

function loadApprover(extra) {
  const ctx = Object.assign({ console, Intl, Date }, extra || {});
  vm.runInNewContext(approverSrc, ctx);
  vm.runInNewContext(decisionSrc, ctx);
  return ctx;
}

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

const D = loadDecision();
const NOW = new Date("2026-11-23T04:00:00Z");

function baseStore() {
  return {
    employees: {
      e1: { id: "e1", name: "Santos, Ben", dateHired: "2024-06-15", dailyRate: 500 }
    },
    leaves: {},
    advances: {},
    daily: {},
    payruns: {}
  };
}

describe("2026-11-23a decision info", () => {
  it("is build 2026-11-23a and the panel is on the filing, evaluation, approver, and print views", () => {
    assert.match(html, /const BUILD = "2026-11-23a"/);
    assert.match(html, /function decisionPanel\(/);
    assert.match(html, /decisionPanel\("leave", l\)/);
    assert.match(html, /decisionPanel\("ca", a\)/);
    assert.match(html, /decisionPanel\("leave", l, "print"\)/);
    assert.match(html, /decisionPanel\("ca", a, "print"\)/);
    assert.match(html, /hr-decision-info\.js/);
    assert.match(approverSrc, /decisionEmbed\(/);
    assert.match(approverSrc, /di-appr-row/);
    assert.match(approverSrc, /next\.decisionInfo = opts\.decisionInfo/);
    assert.match(approverSrc, /var APPROVER_PASSWORD = "032589"/);
    assert.match(approverSrc, /pdfIncludesSignature = true/);
    assert.match(approverSrc, /signatureStamp = sig/);
  });

  it("splits leave by type and status, drops rejected and cancelled, and labels this request", () => {
    const store = baseStore();
    store.leaves = {
      sl: { id: "sl", empId: "e1", type: "SL", status: "Approved", from: "2026-02-02", to: "2026-02-03", days: 2 },
      half: { id: "half", empId: "e1", type: "SL", status: "For signature", from: "2026-01-10", to: "2026-01-10", days: 0.5, half: true },
      lwop: { id: "lwop", empId: "e1", type: "LWOP", status: "Filed", from: "2026-03-01", to: "2026-03-01", days: 1 },
      no: { id: "no", empId: "e1", type: "VL", status: "Disapproved", from: "2026-04-01", to: "2026-04-05", days: 5 },
      cancel: { id: "cancel", empId: "e1", type: "SIL", status: "Cancelled", from: "2026-05-01", to: "2026-05-04", days: 4 },
      old: { id: "old", empId: "e1", type: "VL", status: "Approved", from: "2025-12-01", to: "2025-12-03", days: 3 },
      other: { id: "other", empId: "e2", type: "SL", status: "Approved", from: "2026-02-02", to: "2026-02-02", days: 1 },
      cur: { id: "cur", empId: "e1", type: "EL", status: "Filed", from: "2026-06-01", to: "2026-06-02", days: 2 }
    };
    const before = JSON.stringify(store);
    const info = D.compute(store, { kind: "leave", record: store.leaves.cur, now: NOW });
    assert.equal(JSON.stringify(store), before);
    assert.equal(info.asOf, "2026-11-23");
    assert.match(info.asOfLabel, /23 Nov 2026, Asia\/Manila/);
    assert.equal(info.window.last30From, "2026-10-25");
    assert.equal(info.leaves.count, 3);
    assert.equal(info.leaves.days, 3.5);
    const sick = info.leaves.byType.find(function (t) { return t.type === "SL"; });
    const lwop = info.leaves.byType.find(function (t) { return t.type === "LWOP"; });
    assert.equal(sick.name, "Sick Leave");
    assert.equal(sick.pay, true);
    assert.equal(sick.approved.count, 1);
    assert.equal(sick.approved.days, 2);
    assert.equal(sick.pending.count, 1);
    assert.equal(sick.pending.days, 0.5);
    assert.equal(lwop.pay, false);
    assert.equal(lwop.pending.count, 1);
    assert.equal(lwop.pending.days, 1);
    assert.equal(lwop.approved.count, 0);
    assert.ok(!info.leaves.byType.some(function (t) { return t.type === "VL" || t.type === "SIL" || t.type === "EL"; }));
    assert.equal(info.leaves.thisRequest.label, "this request");
    assert.equal(info.leaves.thisRequest.name, "Emergency Leave");
    assert.equal(info.leaves.thisRequest.days, 2);
    assert.equal(info.leaves.thisRequest.status, "Filed");
    const screen = D.renderScreen(Object.assign({ source: "live" }, info));
    assert.match(screen, /data-decision-info="1"/);
    assert.match(screen, /data-decision-readonly="1"/);
    assert.match(screen, /Sick Leave \(with pay\)/);
    assert.match(screen, /Leave Without Pay \(without pay\)/);
    assert.match(screen, /this request/);
    assert.doesNotMatch(screen, /Vacation Leave/);
    assert.doesNotMatch(screen, /Service Incentive Leave/);
    assert.match(screen, /does not change leave, cash advance, attendance, or pay/);
  });

  it("counts absent days only, skipping rest days and approved leave, in the year and the last 30 days", () => {
    const store = baseStore();
    store.leaves = {
      sl: { id: "sl", empId: "e1", type: "SL", status: "Approved", from: "2026-02-02", to: "2026-02-03", days: 2 },
      filed: { id: "filed", empId: "e1", type: "VL", status: "Filed", from: "2026-11-12", to: "2026-11-12", days: 1 }
    };
    function day(date, row) {
      store.daily["d" + date.replace(/-/g, "")] = { date: date, rows: { e1: row } };
    }
    day("2026-02-02", { s: "Absent", r: "" });
    day("2026-07-01", { s: "Absent" });
    day("2026-10-24", { s: "Absent" });
    day("2026-10-25", { s: "Absent" });
    day("2026-11-01", { s: "Rest Day" });
    day("2026-11-02", { s: "Absent", r: "Rest day" });
    day("2026-11-10", { s: "Absent" });
    day("2026-11-12", { s: "Absent", r: "no form yet" });
    day("2026-11-11", { s: "Present", in: "08:30", out: "17:00", day: 1 });
    day("2026-08-01", { s: "Present", in: "08:00", out: "16:00", day: 1 });
    day("2026-11-03", { s: "Present/Late", in: "08:20", out: "17:00", day: 1, r: "traffic (excused)" });
    store.daily.other = { date: "2026-11-10", rows: { e2: { s: "Absent" } } };
    const info = D.compute(store, { kind: "leave", record: { id: "new", empId: "e1", type: "VL", status: "Filed", from: "2026-11-20", to: "2026-11-20", days: 1 }, now: NOW });
    assert.equal(info.absences.year, 5);
    assert.equal(info.absences.last30, 3);
    assert.equal(info.lates.source, "attendance");
    assert.equal(info.lates.year.count, 2);
    assert.equal(info.lates.year.minutes, 90);
    assert.equal(info.lates.year.lateMinutes, 30);
    assert.equal(info.lates.year.undertimeMinutes, 60);
    assert.equal(info.lates.last30.count, 1);
    assert.equal(info.lates.last30.minutes, 30);
    const printed = D.renderPrint(Object.assign({ source: "live" }, info));
    assert.match(printed, /data-decision-info="1"/);
    assert.match(printed, /DECISION INFO/);
    assert.match(printed, /This year 5 days/);
    assert.match(printed, /Last 30 days 3 days/);
    assert.match(printed, /90 min/);
    assert.match(printed, /Hired 15 Jun 2024/);
    assert.match(printed, /2 years, 5 months/);
  });

  it("falls back to payroll late deductions when Daily Manpower has no attendance, and does not invent minutes", () => {
    const store = baseStore();
    store.payruns = {
      "weekly|2026-11-05": {
        kind: "weekly", from: "2026-11-05", to: "2026-11-11",
        lines: { e1: { ca: 0, late: 40 } }
      },
      "weekly|2026-08-06": {
        kind: "weekly", from: "2026-08-06", to: "2026-08-12",
        lines: { e1: { late: 15 } }
      },
      "weekly|2026-10-01": {
        kind: "weekly", from: "2026-10-01", to: "2026-10-07",
        lines: { e1: { late: 100 } }
      }
    };
    const info = D.compute(store, { kind: "ca", record: { id: "none", empId: "e1" }, now: NOW });
    assert.equal(info.lates.source, "payroll");
    assert.equal(info.lates.year.count, 3);
    assert.equal(info.lates.year.minutes, null);
    assert.equal(info.lates.year.amount, 155);
    assert.equal(info.lates.last30.count, 1);
    assert.equal(info.lates.last30.amount, 40);
    assert.equal(info.lates.last30.minutes, null);
    const screen = D.renderScreen(Object.assign({ source: "live" }, info));
    assert.match(screen, /minutes not on the pay run/);
    assert.match(screen, /₱155\.00/);
    assert.doesNotMatch(screen, /155 min/);
  });

  it("builds each open cash advance from pay-run lines, including catch-up stubs and pending forms", () => {
    const store = baseStore();
    store.advances = {
      a1: {
        id: "a1", empId: "e1", no: "CAF2026-010", status: "Approved", amount: 10000,
        deductPerPeriod: 2500, planEvery: "Semi-monthly", planFrom: "2026-10-15",
        liquidations: [{ amount: 0 }]
      },
      a2: {
        id: "a2", empId: "e1", no: "CAF2026-011", status: "Released", amount: 5000,
        deductPerPeriod: 500, planEvery: "Weekly", planFrom: "2026-11-01"
      },
      pending: {
        id: "pending", empId: "e1", no: "CAF2026-020", status: "Requested", amount: 1500,
        deductPerPeriod: 500, planEvery: "Monthly", planFrom: "2026-12-01"
      },
      closed: { id: "closed", empId: "e1", no: "CAF2026-001", status: "Liquidated", amount: 800 },
      denied: { id: "denied", empId: "e1", no: "CAF2026-002", status: "Disapproved", amount: 9000 },
      catchup: { id: "ca_catchup_old", empId: "e1", no: "", status: "Approved", amount: 2000, deductPerPeriod: 0 }
    };
    store.payruns = {
      w1: {
        from: "2026-10-15", to: "2026-10-21",
        lines: {
          e1: {
            ca: 4500,
            caItems: [
              { id: "a1", amount: 2500 },
              { id: "a2", amount: 1000 },
              { id: "ca_catchup_old", amount: 1000 }
            ]
          }
        }
      },
      w2: {
        from: "2026-11-05", to: "2026-11-11",
        lines: [{ empId: "e1", ca: 1500, cas: { a1: 1000, a2: 500 } }]
      }
    };
    const info = D.compute(store, {
      kind: "ca",
      record: store.advances.pending,
      now: NOW
    });
    const rows = info.cashAdvances.rows;
    function row(id) {
      return rows.find(function (r) { return r.id === id; });
    }
    assert.equal(row("a1").deducted, 3500);
    assert.equal(row("a1").balance, 6500);
    assert.match(row("a1").plan, /₱2,500\.00 every payroll/);
    assert.equal(row("a2").deducted, 1500);
    assert.equal(row("a2").balance, 3500);
    assert.equal(row("ca_catchup_old").catchup, true);
    assert.equal(row("ca_catchup_old").deducted, 1000);
    assert.equal(row("ca_catchup_old").balance, 1000);
    assert.equal(row("pending").pending, true);
    assert.equal(row("pending").thisRequest, true);
    assert.equal(row("pending").deducted, 0);
    assert.equal(row("pending").balance, 1500);
    assert.ok(!row("closed"));
    assert.ok(!row("denied"));
    assert.equal(info.cashAdvances.totalKnown, true);
    assert.equal(info.cashAdvances.total, 12500);
    const screen = D.renderScreen(Object.assign({ source: "live" }, info));
    assert.match(screen, /CAF2026-020 \(this request, pending\)/);
    assert.match(screen, /ca_catchup_old \(catch-up\)/);
    assert.match(screen, /Total outstanding ₱12,500\.00/);
    assert.doesNotMatch(screen, /CAF2026-001/);
    assert.doesNotMatch(screen, /CAF2026-002/);
  });

  it("attributes a single advance to the pay-run total and leaves a mixed balance unknown", () => {
    const one = baseStore();
    one.advances = {
      only: { id: "only", empId: "e1", no: "CAF2026-030", status: "Approved", amount: 10000, deductPerPeriod: 500, planEvery: "Weekly" }
    };
    one.payruns = {
      r1: { from: "2026-10-01", to: "2026-10-07", lines: { e1: { ca: 2500 } } },
      r2: { from: "2026-10-08", to: "2026-10-14", lines: { e1: { ca: 2500 } } }
    };
    const single = D.compute(one, { kind: "ca", record: { id: "other", empId: "e1", status: "Requested", amount: 100 }, now: NOW });
    const only = single.cashAdvances.rows.find(function (r) { return r.id === "only"; });
    assert.equal(only.deducted, 5000);
    assert.equal(only.balance, 5000);

    const mixed = baseStore();
    mixed.advances = {
      a: { id: "a", empId: "e1", no: "CAF2026-040", status: "Approved", amount: 8000 },
      b: { id: "b", empId: "e1", no: "CAF2026-041", status: "Approved", amount: 3000 }
    };
    mixed.payruns = {
      r: { from: "2026-11-05", to: "2026-11-11", lines: { e1: { ca: 1200 } } }
    };
    const unknown = D.compute(mixed, { kind: "leave", record: { id: "lv", empId: "e1", status: "Filed" }, now: NOW });
    unknown.cashAdvances.rows.forEach(function (r) {
      assert.equal(r.balanceKnown, false);
      assert.equal(r.balance, null);
      assert.equal(r.deducted, null);
    });
    assert.equal(unknown.cashAdvances.totalKnown, false);
    assert.equal(unknown.cashAdvances.total, null);
    const screen = D.renderScreen(Object.assign({ source: "live" }, unknown));
    assert.match(screen, /balance to confirm/);
    assert.match(screen, /₱0\.00 known \+ 2 to confirm/);
    assert.doesNotMatch(screen, /₱6,800\.00 balance/);
    assert.doesNotMatch(screen, /₱1,800\.00 balance/);
    assert.doesNotMatch(screen, /0 pay runs/);

    const missing = baseStore();
    missing.payruns = null;
    missing.advances = {
      a: { id: "a", empId: "e1", no: "CAF2026-050", status: "Approved", amount: 4000, deductPerPeriod: 500, planEvery: "Weekly" }
    };
    const none = D.compute(missing, { kind: "ca", record: missing.advances.a, now: NOW });
    assert.equal(none.cashAdvances.rows[0].balanceKnown, false);
    assert.match(D.renderScreen(Object.assign({ source: "live" }, none)), /balance to confirm/);
    assert.match(D.renderScreen(Object.assign({ source: "live" }, none)), /₱0\.00 known \+ 1 to confirm/);
  });

  it("says when attendance has no clock times, and does not treat a missing pay-run override as zero", () => {
    const clocks = baseStore();
    function day(date, row) {
      clocks.daily["d" + date.replace(/-/g, "")] = { date: date, rows: { e1: row } };
    }
    day("2026-03-02", { s: "Present" });
    day("2026-03-03", { s: "Present", in: "", out: "" });
    day("2026-11-04", { s: "Present/Late" });
    day("2026-11-05", { s: "Absent" });
    const info = D.compute(clocks, { kind: "leave", record: { id: "lv", empId: "e1", status: "Filed", from: "2026-11-20", to: "2026-11-20", days: 1 }, now: NOW });
    assert.equal(info.lates.source, "attendance");
    assert.equal(info.lates.year.noClocks, true);
    assert.equal(info.lates.year.presentWithoutTimes, 3);
    assert.equal(info.lates.last30.noClocks, true);
    assert.equal(info.lates.last30.presentWithoutTimes, 1);
    assert.equal(info.absences.coverageFrom, "2026-03-02");
    const screen = D.renderScreen(Object.assign({ source: "live" }, info));
    assert.match(screen, /No clock-in\/out times recorded \(3 Present days with no times\)/);
    assert.match(screen, /No clock-in\/out times recorded \(1 Present day with no times\)/);
    assert.match(screen, /Attendance on file from 2 Mar 2026/);
    assert.doesNotMatch(screen, /0 times late/);
    assert.doesNotMatch(screen, /0 days · 0 min/);

    const timed = baseStore();
    timed.daily.d1 = { date: "2026-11-11", rows: { e1: { s: "Present", in: "08:30", out: "17:00", day: 1 } } };
    const timedInfo = D.compute(timed, { kind: "leave", record: { id: "lv", empId: "e1", status: "Filed" }, now: NOW });
    const timedScreen = D.renderScreen(Object.assign({ source: "live" }, timedInfo));
    assert.match(timedScreen, /late count 1/);
    assert.match(timedScreen, /1 times late/);
    assert.match(timedScreen, /30 min/);
    assert.doesNotMatch(timedScreen, /1 day · 30 min/);

    const bare = baseStore();
    bare.payruns = {
      w: { from: "2026-11-05", to: "2026-11-11", lines: { e1: { ca: 100 } } }
    };
    const none = D.compute(bare, { kind: "leave", record: { id: "lv", empId: "e1", status: "Filed" }, now: NOW });
    assert.equal(none.lates.source, "none");
    const noneScreen = D.renderScreen(Object.assign({ source: "live" }, none));
    assert.match(noneScreen, /No attendance or payroll late data yet/);
    assert.match(noneScreen, /Attendance on file from 17 Feb 2026/);
    assert.doesNotMatch(noneScreen, /0 pay runs/);
    assert.doesNotMatch(noneScreen, /₱0\.00 late\/undertime/);
    assert.doesNotMatch(noneScreen, /minutes not on the pay run/);
    assert.doesNotMatch(noneScreen, /They have no attendance yet/);

    const hired = baseStore();
    hired.employees.e1.dateHired = "2026-09-01";
    hired.payruns = { w: { from: "2026-11-05", to: "2026-11-11", lines: { e1: {} } } };
    const newbie = D.compute(hired, { kind: "leave", record: { id: "lv", empId: "e1", status: "Filed" }, now: NOW });
    assert.equal(newbie.lates.newHire, true);
    const newbieScreen = D.renderScreen(Object.assign({ source: "live" }, newbie));
    assert.match(newbieScreen, /No attendance or payroll late data yet/);
    assert.match(newbieScreen, /They have no attendance yet/);
  });

  it("counts a leave with no dates, drops closed catch-up stubs, and does not invent an unknown balance", () => {
    const store = baseStore();
    store.leaves = {
      sl: { id: "sl", empId: "e1", type: "SL", status: "Approved", from: "", to: "", days: 0 },
      blank: { id: "blank", empId: "e1", type: "", status: "Filed", days: 0 },
      dated: { id: "dated", empId: "e1", type: "VL", status: "Approved", from: "2026-03-02", to: "2026-03-02", days: 1 },
      old: { id: "old", empId: "e1", type: "SL", status: "Approved", filedOn: "2025-06-01", days: 0 }
    };
    const info = D.compute(store, { kind: "leave", record: { id: "cur", empId: "e1", type: "EL", status: "Filed", from: "2026-11-20", to: "2026-11-20", days: 1 }, now: NOW });
    assert.equal(info.leaves.count, 3);
    assert.equal(info.leaves.days, 1);
    assert.equal(info.leaves.unset, 2);
    const sick = info.leaves.byType.find(function (t) { return t.type === "SL"; });
    const unsetType = info.leaves.byType.find(function (t) { return t.name === "Type not set"; });
    assert.equal(sick.approved.count, 1);
    assert.equal(sick.approved.unset, 1);
    assert.equal(sick.approved.days, 0);
    assert.equal(unsetType.pending.count, 1);
    assert.equal(unsetType.pending.unset, 1);
    const screen = D.renderScreen(Object.assign({ source: "live" }, info));
    assert.match(screen, /Sick Leave \(with pay\) — approved 1 · days not set/);
    assert.match(screen, /Type not set — pending 1 · days not set/);
    assert.match(screen, /2 with days not set/);
    assert.doesNotMatch(screen, /2025/);

    store.advances = {
      open: { id: "open", empId: "e1", no: "CAF2026-060", status: "Approved", amount: 4000, deductPerPeriod: 500, planEvery: "Weekly" },
      paid: { id: "ca_catchup_paid", empId: "e1", no: "CAF-OLD", status: "Fully deducted", amount: 9000 },
      lower: { id: "ca_catchup_lower", empId: "e1", status: "paid", amount: 1000 },
      settled: { id: "ca_catchup_settled", empId: "e1", status: "Settled", amount: 500 },
      closed: { id: "caf-closed", empId: "e1", no: "CAF2026-061", status: "Closed", amount: 700 },
      mystery: {
        id: "ca_catchup_mystery",
        empId: "e1",
        status: "Approved",
        amount: 2500,
        notes: "The real amount is not known. It is not on the payroll files."
      },
      nodata: { id: "ca_catchup_nodata", empId: "e1", status: "Approved", amount: 1800, notes: "Brought forward." }
    };
    store.payruns = {
      w: {
        from: "2026-11-05",
        to: "2026-11-11",
        lines: { e1: { ca: 1000, caItems: [{ id: "open", amount: 1000 }] } }
      }
    };
    const ca = D.compute(store, { kind: "leave", record: { id: "cur", empId: "e1", status: "Filed", from: "2026-11-20", to: "2026-11-20", days: 1 }, now: NOW });
    const ids = ca.cashAdvances.rows.map(function (r) { return r.id; });
    assert.ok(ids.indexOf("open") >= 0);
    assert.ok(ids.indexOf("ca_catchup_paid") < 0);
    assert.ok(ids.indexOf("ca_catchup_lower") < 0);
    assert.ok(ids.indexOf("ca_catchup_settled") < 0);
    assert.ok(ids.indexOf("caf-closed") < 0);
    const mystery = ca.cashAdvances.rows.find(function (r) { return r.id === "ca_catchup_mystery"; });
    const nodata = ca.cashAdvances.rows.find(function (r) { return r.id === "ca_catchup_nodata"; });
    const open = ca.cashAdvances.rows.find(function (r) { return r.id === "open"; });
    assert.equal(open.balance, 3000);
    assert.equal(open.balanceKnown, true);
    assert.equal(mystery.balanceKnown, false);
    assert.equal(mystery.balance, null);
    assert.equal(mystery.amount, null);
    assert.equal(nodata.balanceKnown, false);
    assert.equal(nodata.balance, null);
    assert.equal(ca.cashAdvances.knownTotal, 3000);
    assert.equal(ca.cashAdvances.confirmCount, 2);
    assert.equal(ca.cashAdvances.total, null);
    const shown = D.renderScreen(Object.assign({ source: "live" }, ca));
    assert.match(shown, /balance to confirm/);
    assert.match(shown, /₱3,000\.00 known \+ 2 to confirm/);
    assert.doesNotMatch(shown, /₱2,500\.00 balance/);
    assert.doesNotMatch(shown, /₱1,800\.00 balance/);
    assert.doesNotMatch(shown, /CAF-OLD/);
    assert.doesNotMatch(shown, /CAF2026-061/);
    assert.equal(store.advances.mystery.amount, 2500);
    assert.equal(store.advances.mystery.notes, "The real amount is not known. It is not on the payroll files.");
  });

  it("snapshots decision info on approve and approved forms keep that snapshot", async () => {
    const store = baseStore();
    store.leaves = {
      cur: { id: "cur", empId: "e1", no: "LRF2026-090", type: "VL", status: "For approval", from: "2026-11-20", to: "2026-11-20", days: 1 }
    };
    const info = D.compute(store, { kind: "leave", record: store.leaves.cur, now: NOW });
    const ctx = loadApprover();
    const saved = ctx.hrApprover.approveRecord(store.leaves.cur, {
      kind: "leave",
      signature: "data:image/png;base64,JEFFREY",
      by: "Jeffrey James M. Corro",
      at: "2026-11-23T02:00:00Z",
      on: "2026-11-23",
      decisionInfo: info
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.record.status, "Approved");
    assert.equal(saved.record.pdfIncludesSignature, true);
    assert.equal(saved.record.decisionInfo.asOf, "2026-11-23");
    assert.equal(saved.record.signatureStamp, "data:image/png;base64,JEFFREY");
    assert.equal(store.leaves.cur.status, "For approval");
    assert.equal(store.leaves.cur.decisionInfo, undefined);

    store.leaves.cur = saved.record;
    store.leaves.extra = { id: "extra", empId: "e1", type: "SL", status: "Approved", from: "2026-01-05", to: "2026-01-06", days: 2 };
    const view = D.forForm(store, { kind: "leave", record: store.leaves.cur, now: NOW });
    assert.equal(view.source, "snapshot");
    assert.equal(view.leaves.count, info.leaves.count);
    assert.equal(view.leaves.days, info.leaves.days);
    const printed = D.renderPrint(view);
    assert.match(printed, /data-decision-source="snapshot"/);
    assert.match(printed, /saved at approval/);
    assert.doesNotMatch(printed, /Sick Leave/);

    const legacy = D.forForm(store, {
      kind: "leave",
      record: { id: "old", empId: "e1", status: "Approved", from: "2026-01-01", to: "2026-01-01", days: 1 },
      now: NOW
    });
    assert.equal(legacy.source, "missing");
    assert.match(D.renderPrint(legacy), /Decision info was not saved on this approval/);

    const host = {
      S: {
        settings: { signatory: "Jeffrey James M. Corro", hrSigs: { signatory: { data: "data:image/png;base64,JEFFREY" } } },
        employees: store.employees,
        leaves: {
          cur: { id: "cur", empId: "e1", no: "LRF2026-091", type: "SL", status: "For approval", from: "2026-11-18", to: "2026-11-18", days: 1 }
        },
        advances: {},
        daily: {},
        payruns: {}
      },
      TODAY: "2026-11-23",
      put: async function (coll, id, rec) { host.S[coll][id] = rec; },
      render: function () {},
      toast: function () {},
      printLeave: function () {}
    };
    await ctx.hrApprover.approveItem(host, "leave", "cur");
    assert.equal(host.S.leaves.cur.status, "Approved");
    assert.equal(host.S.leaves.cur.pdfIncludesSignature, true);
    assert.equal(host.S.leaves.cur.decisionInfo.asOf, D.manilaDay(new Date()).iso);
    assert.equal(host.S.leaves.cur.decisionInfo.leaves.thisRequest.status, "For approval");
    assert.equal(host.S.employees.e1.dateHired, "2024-06-15");
  });

  it("puts the payroll stamp inside the sign-off slot and leaves drafts without the box", () => {
    const ctx = { console, TextEncoder, Intl };
    vm.runInNewContext(sheetSrc, ctx);
    const P = ctx.hrPaySheet;
    const line = {
      empId: "e1", name: "Santos, Ben", empNo: "10", position: "Laborer", site: "Tawason",
      daily: 500, days: 6, ot: 0, otPay: 0, gross: 3000, net: 3000, sss: 0, phic: 0, hdmf: 0, ca: 0, uniform: 0, late: 0
    };
    const approved = P.printHTML({
      kind: "weekly",
      from: "2026-11-05",
      to: "2026-11-11",
      release: "2026-11-14",
      status: "approved",
      approvedAt: "2026-11-19T22:15:30.000Z",
      signatorySrc: "data:image/png;base64,JEFFREY",
      signatoryName: "Jeffrey James M. Corro",
      signatoryTitle: "CEO / President",
      lines: [line]
    });
    const slotAt = approved.indexOf('data-pay-stamp-slot="approved"');
    const stampAt = approved.indexOf("APPROVED BY JEFFREY JAMES CORRO");
    const slotEnd = approved.indexOf("</section>", slotAt);
    assert.ok(slotAt > 0 && stampAt > slotAt && stampAt < slotEnd);
    assert.match(approved.slice(slotAt, slotEnd), /class="pay-approval-stamp"/);
    assert.equal(approved.split('data-pay-stamp-slot="approved"').length - 1, 1);
    const draft = P.printHTML({
      kind: "semi",
      from: "2026-10-28",
      to: "2026-11-12",
      status: "draft",
      signatorySrc: "data:image/png;base64,JEFFREY",
      lines: [line]
    });
    const draftBody = draft.slice(draft.indexOf("</style>"));
    assert.doesNotMatch(draftBody, /pay-rpt-stamp-slot/);
    assert.doesNotMatch(draftBody, /data-pay-stamp-slot/);
    assert.doesNotMatch(draftBody, /APPROVED BY JEFFREY JAMES CORRO/);
    assert.doesNotMatch(draftBody, /class="pay-approval-stamp"/);
    const many = [];
    for (let i = 0; i < 16; i += 1) {
      many.push(Object.assign({}, line, { empId: "e" + i, empNo: String(100 + i), name: "Worker, " + i, net: 100 + i, gross: 100 + i }));
    }
    const pages = P.printHTML({
      kind: "weekly", from: "2026-11-05", to: "2026-11-11", status: "approved",
      approvedAt: "2026-11-19T22:15:30.000Z", lines: many
    });
    assert.ok((pages.match(/class="pay-rpt-page"/g) || []).length > 1);
    assert.equal(pages.split('data-pay-stamp-slot="approved"').length - 1, 1);
    const draftPages = P.printHTML({
      kind: "weekly", from: "2026-11-05", to: "2026-11-11", status: "draft", lines: many
    });
    assert.doesNotMatch(draftPages.slice(draftPages.indexOf("</style>")), /pay-rpt-stamp-slot/);
  });
});
