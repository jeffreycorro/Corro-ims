"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const sheetSrc = fs.readFileSync(path.join(root, "public/hr-payroll-sheet.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const flowSrc = fs.readFileSync(path.join(root, "public/hr-project-pay.js"), "utf8");

function loadSheet() {
  const ctx = { console, TextEncoder };
  vm.runInNewContext(sheetSrc, ctx);
  return ctx.hrPaySheet;
}

const P = loadSheet();

function cents(n) {
  return Math.round((Number(n) || 0) * 100);
}

function counted(section) {
  return (section.rows || [])
    .filter((r) => r.counts !== false)
    .reduce((sum, r) => sum + cents(r.amount), 0);
}

function lineFixture(over) {
  const line = {
    empId: "e9",
    name: "Dela Cruz, Ana",
    days: 5,
    daily: 500,
    hourly: 62.5,
    ot: 2,
    basic: 2500,
    otPay: 125,
    holPay: 0,
    hol30: 0,
    hol100: 0,
    allowance: 100,
    incentive: 0,
    gross: 2725,
    late: 15,
    lateMin: 15,
    lateParts: [
      { kind: "late", date: "2026-11-06", minutes: 10, amount: 10 },
      { kind: "undertime", date: "2026-11-07", minutes: 5, amount: 5 }
    ],
    ca: 300,
    caDetail: {
      amount: 300,
      items: [
        { id: "adv1", no: "CAF2026-0004", amount: 200, balanceBefore: 1000, balanceAfter: 800, installment: 1 },
        { id: "adv2", no: "CAF2026-0009", amount: 100, balanceBefore: 250, balanceAfter: 150, installment: 2 }
      ]
    },
    uniform: 50,
    uniformRecur: { amount: 50, balanceBefore: 200, balanceAfter: 150 },
    sssLoan: 80,
    sssLoanRecur: { amount: 80, balanceBefore: 400, balanceAfter: 320 },
    hdmfLoan: 40,
    hdmfLoanRecur: { amount: 40, balanceBefore: 90, balanceAfter: 50 },
    sss: 162.5,
    phic: 65.62,
    hdmf: 50,
    tax: 0,
    ded: 763.12,
    rows: [
      { date: "2026-11-05", day: 1, ot: 2, site: "Yard", s: "Present" },
      { date: "2026-11-06", day: 1, ot: 0, site: "Yard", s: "Present/Late" },
      { date: "2026-11-08", day: 0, ot: 0, site: "Yard", s: "Absent", reason: "no call" }
    ]
  };
  return Object.assign(line, over || {});
}

describe("payroll breakdown", () => {
  it("sums deduction and earnings lines to the totals on the payroll", () => {
    const before = JSON.stringify(lineFixture());
    const line = lineFixture();
    const pack = P.payBreakdown(line, { kind: "weekly", saved: {} });
    assert.equal(JSON.stringify(line), before);
    assert.equal(pack.deductions.ok, true);
    assert.equal(pack.earnings.ok, true);
    assert.equal(cents(pack.deductions.sum), cents(pack.deductions.total));
    assert.equal(cents(pack.deductions.total), cents(line.ded));
    assert.equal(counted(pack.deductions), cents(line.ded));
    assert.equal(cents(pack.earnings.sum), cents(line.gross));
    assert.equal(counted(pack.earnings), cents(line.gross));
    assert.equal(pack.deductions.diff, 0);
    assert.equal(pack.earnings.diff, 0);
  });

  it("lists each cash advance with its CAF number and keeps loans on their own rows", () => {
    const pack = P.payBreakdown(lineFixture(), { kind: "weekly", saved: {} });
    const ca = pack.deductions.rows.filter((r) => r.counts !== false && r.key.indexOf("ca:") === 0);
    assert.equal(ca.length, 2);
    assert.deepEqual(Array.from(ca, (r) => String(r.caf)), ["CAF2026-0004", "CAF2026-0009"]);
    assert.equal(cents(ca[0].amount), 20000);
    assert.equal(cents(ca[1].amount), 10000);
    assert.equal(ca[0].balance, 800);
    assert.equal(ca[0].source, "CA record");
    assert.match(ca[1].detail, /2 installments/);
    const sssLoan = pack.deductions.rows.find((r) => r.key === "sssLoan");
    const hdmfLoan = pack.deductions.rows.find((r) => r.key === "hdmfLoan");
    assert.ok(sssLoan);
    assert.ok(hdmfLoan);
    assert.equal(sssLoan.label, "SSS loan");
    assert.equal(hdmfLoan.label, "Pag-IBIG loan");
    assert.equal(sssLoan.counts, true);
    assert.equal(hdmfLoan.counts, true);
    assert.equal(cents(sssLoan.amount), 8000);
    assert.equal(cents(hdmfLoan.amount), 4000);
    assert.equal(sssLoan.source, "recurring deduction record");
    assert.notEqual(sssLoan.label, "Cash advance");
    const absent = pack.deductions.aside.find((r) => r.label === "Absence");
    assert.ok(absent);
    assert.equal(absent.counts, false);
    assert.equal(absent.source, "attendance");
    const names = pack.deductions.rows.filter((r) => r.counts !== false).map((r) => r.label);
    ["SSS", "PhilHealth", "Pag-IBIG", "Withholding tax", "Uniform", "Late / undertime"].forEach((label) => {
      assert.ok(names.indexOf(label) >= 0, label);
    });
  });

  it("marks Touched overrides and still sums to the displayed deduction", () => {
    const line = lineFixture({ ca: 50, ded: 513.12 });
    const pack = P.payBreakdown(line, {
      kind: "weekly",
      saved: { caTouched: true, lateTouched: true, statTouched: true, uniformTouched: true }
    });
    assert.equal(pack.deductions.ok, true);
    assert.equal(cents(pack.deductions.sum), cents(513.12));
    const ca = pack.deductions.rows.find((r) => r.key === "ca" && r.counts !== false);
    assert.ok(ca);
    assert.equal(ca.override, true);
    assert.equal(ca.marker, "Touched");
    assert.equal(cents(ca.amount), 5000);
    assert.equal(cents(ca.computed), 30000);
    const schedules = pack.deductions.rows.filter((r) => r.counts === false && r.source === "CA record");
    assert.deepEqual(Array.from(schedules, (r) => String(r.caf)), ["CAF2026-0004", "CAF2026-0009"]);
    const late = pack.deductions.rows.find((r) => r.key === "late");
    const sss = pack.deductions.rows.find((r) => r.key === "sss");
    const uni = pack.deductions.rows.find((r) => r.key === "uniform");
    const loan = pack.deductions.rows.find((r) => r.key === "sssLoan");
    assert.equal(late.marker, "Touched");
    assert.equal(late.source, "attendance");
    assert.equal(late.minutes, 15);
    assert.equal(sss.marker, "Touched");
    assert.equal(sss.source, "contribution table");
    assert.equal(uni.marker, "Touched");
    assert.equal(uni.source, "recurring deduction record");
    assert.equal(loan.marker, "computed");
    const view = P.payBreakdownHtml(pack, { dedOpen: true });
    assert.match(view, /CAF2026-0004/);
    assert.match(view, /CAF2026-0009/);
    assert.match(view, /SSS loan/);
    assert.match(view, /Pag-IBIG loan/);
    assert.match(view, /Touched/);
    assert.match(view, />check</);
    assert.doesNotMatch(view, /do not add up/);
  });

  it("warns when the lines do not add up to the total on the payroll", () => {
    const line = lineFixture({ ded: 900, tax: 100 });
    const pack = P.payBreakdown(line, { kind: "weekly", saved: {} });
    assert.equal(pack.deductions.ok, false);
    assert.notEqual(cents(pack.deductions.sum), cents(pack.deductions.total));
    assert.equal(cents(pack.deductions.diff), cents(900) - counted(pack.deductions));
    const view = P.payBreakdownHtml(pack, { dedOpen: true });
    assert.match(view, /role="alert"/);
    assert.match(view, /do not add up/);
    assert.match(view, /Does not add up/);
    const earn = P.payBreakdown(lineFixture({ gross: 2700 }), { kind: "weekly" });
    assert.equal(earn.earnings.ok, false);
    assert.match(P.payBreakdownHtml(earn, { dedOpen: false, earnOpen: true }), /id="pay-break-earn" open/);
  });

  it("names Daily Manpower on basic days and overtime without adding those days twice", () => {
    const pack = P.payBreakdown(lineFixture(), { kind: "weekly", otMultiplier: 1 });
    const basic = pack.earnings.rows.find((r) => r.key === "basic");
    const day = pack.earnings.rows.find((r) => r.key === "day:2026-11-05");
    const ot = pack.earnings.rows.find((r) => r.key === "ot");
    assert.equal(basic.source, "Daily Manpower");
    assert.match(basic.detail, /5 days/);
    assert.equal(day.counts, false);
    assert.equal(day.source, "Daily Manpower");
    assert.equal(ot.source, "Daily Manpower");
    assert.match(ot.detail, /2 hr/);
    assert.equal(counted(pack.earnings), cents(2725));
  });

  it("makes the register totals a button on the weekly and semi sheets", () => {
    const person = {
      empId: "e1",
      name: "Cruz, Ana",
      empNo: "1401",
      position: "Labor",
      days: 1,
      ot: 0,
      daily: 500,
      hourly: 62.5,
      gross: 500,
      ded: 100,
      net: 400,
      late: 0,
      ca: 0,
      uniform: 0,
      sssLoan: 0,
      hdmfLoan: 0,
      sss: 100,
      phic: 0,
      hdmf: 0,
      incentive: 0,
      rows: [{ date: "2026-11-05", day: 1, ot: 0, site: "Yard", in: "08:00", out: "17:00", s: "Present" }]
    };
    ["weekly", "semi"].forEach((kind) => {
      const screen = P.screenHTML({
        kind: kind,
        from: "2026-11-05",
        to: "2026-11-11",
        release: "2026-11-14",
        lines: [person]
      });
      assert.match(screen, /data-paybreak="ded"/);
      assert.match(screen, /data-paybreak="earn"/);
      assert.match(screen, /data-payemp="e1"/);
      assert.match(screen, /type="button"/);
      assert.match(screen, /aria-label="Show the deduction breakdown for Cruz, Ana"/);
    });
  });

  it("is on the draft review, the approval screen, the payslip, and build 2026-11-12b", () => {
    assert.match(html, /const BUILD = "2026-11-12b"/);
    assert.match(html, /function openPayBreakdown/);
    assert.match(html, /payBreakRemember\(lines\)/);
    assert.match(html, /payBreakPanels\(empId,\{dedOpen:true,earnOpen:false\}\)/);
    assert.match(html, /data-paybreak="ded"/);
    assert.match(html, /aria-label="Show the deduction breakdown/);
    assert.match(flowSrc, /id="pay-approval"/);
    assert.match(flowSrc, /opens the breakdown/);
    assert.match(flowSrc, /It does not change the figures/);
  });
});
