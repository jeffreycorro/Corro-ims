"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const sheetSrc = fs.readFileSync(path.join(root, "public/hr-payroll-sheet.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");

function loadSheet() {
  const ctx = { console, TextEncoder };
  vm.runInNewContext(sheetSrc, ctx);
  return ctx.hrPaySheet;
}

function parseCsv(text) {
  const lines = text.trim().split(/\n/);
  const head = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        cols.push(cur);
        cur = "";
      } else cur += ch;
    }
    cols.push(cur);
    const o = {};
    head.forEach((h, i) => {
      o[h] = (cols[i] || "").trim();
    });
    return o;
  });
}

function tokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function matchName(name, rows) {
  const nt = new Set(tokens(name));
  let best = null;
  let score = 0;
  rows.forEach((r) => {
    const rt = new Set(tokens(r.name));
    let n = 0;
    nt.forEach((t) => {
      if (rt.has(t)) n += 1;
    });
    if (n > score) {
      score = n;
      best = r;
    }
  });
  return score >= 2 ? best : null;
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function near(got, exp) {
  return Math.abs(Number(got) - Number(exp)) <= 0.011;
}

const P = loadSheet();

/* Workbook Late is blank. Time in 08:50 on Oct 14 is 50 minutes from 8:00. */
const WEEKLY_EXPLAINED = {
  "Asildo, Jorge": { late: 50, net: 3262 },
};
/* Workbook typed 306.24. Time in 10:37 is 157 minutes at ₱1. */
const SEMI_EXPLAINED = {
  "Roy Solis": { late: 157, net: 13287 },
};

function pricePerson(p) {
  const daily = p.monthlyAmount ? p.monthlyAmount / 26 : Number(p.daily) || 0;
  const days = (p.days || []).reduce((n, d) => n + (Number(d.day) || 0), 0);
  const ot = (p.days || []).reduce((n, d) => n + (Number(d.ot) || 0), 0);
  const hol = (p.days || []).reduce((n, d) => n + (Number(d.hol) || 0), 0);
  const late = P.lateForRows(p.days, daily);
  const line = P.priceLine({
    days,
    ot,
    hol,
    daily,
    allowance: p.allowance,
    addl: p.addl,
    late: late.amount,
    ca: p.ca,
    uniform: p.uniform,
    sssLoan: p.sssLoan,
    hdmfLoan: p.hdmfLoan,
    sss: p.sss,
    phic: p.phic,
    hdmf: p.hdmf,
  });
  return { daily, days, ot, hol, late, line };
}

describe("company payroll format", () => {
  it("prices the Oct 8–14 weekly run against the workbook", () => {
    const people = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/weekly_oct8-14.json"), "utf8"));
    const csv = parseCsv(fs.readFileSync(path.join(__dirname, "fixtures/test_expected_weekly_oct8-14.csv"), "utf8"));
    assert.equal(people.length, 46);
    assert.equal(csv.length, 46);
    people.forEach((p) => {
      const exp = matchName(p.name, csv);
      assert.ok(exp, "csv row for " + p.name);
      const got = pricePerson(p);
      const explained = WEEKLY_EXPLAINED[p.name];
      const cols = [
        ["days", got.days, exp.days],
        ["ot", got.ot, exp.ot_hrs],
        ["rate", got.line.daily, exp.rate],
        ["gross", got.line.gross, exp.gross],
        ["ca", got.line.ca, exp.ca],
        ["uniform", got.line.uniform, exp.uniform],
        ["pagloan", got.line.hdmfLoan, exp.pagloan],
        ["sssloan", got.line.sssLoan, exp.sssloan],
        ["sss", got.line.sss, exp.sss],
        ["pagibig", got.line.hdmf, exp.pagibig],
        ["philhealth", got.line.phic, exp.philhealth],
      ];
      cols.forEach(([k, a, b]) => {
        assert.ok(near(a, b), p.name + " " + k + " got " + a + " expected " + b);
      });
      if (explained) {
        assert.equal(got.late.amount, explained.late);
        assert.equal(got.line.net, explained.net);
        assert.ok(!near(got.late.amount, exp.late));
        assert.ok(!near(got.line.net, exp.net));
      } else {
        assert.ok(near(got.late.amount, exp.late), p.name + " late " + got.late.amount + " vs " + exp.late);
        assert.ok(near(got.line.ded, exp.totded), p.name + " totded");
        assert.equal(got.line.net, money(exp.net));
      }
    });
  });

  it("prices the Sep 28–Oct 12 semi-monthly run against the workbook", () => {
    const people = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/semi_sep28-oct12.json"), "utf8"));
    const csv = parseCsv(fs.readFileSync(path.join(__dirname, "fixtures/test_expected_semi_sep28-oct12.csv"), "utf8"));
    assert.equal(people.length, 23);
    assert.equal(csv.length, 23);
    people.forEach((p) => {
      const exp = matchName(p.name, csv);
      assert.ok(exp, "csv row for " + p.name);
      const got = pricePerson(p);
      const explained = SEMI_EXPLAINED[p.name];
      const cols = [
        ["days", got.days, exp.days],
        ["ot", got.ot, exp.ot_hrs],
        ["daily", got.line.daily, exp.daily_rate],
        ["otpay", got.line.otPay, exp.ot_pay],
        ["allowance", got.line.allowance, exp.allowance],
        ["addl", got.line.addl, exp.addl],
        ["gross", got.line.gross, exp.gross],
        ["ca", got.line.ca, exp.ca],
        ["uniform", got.line.uniform, exp.uniform],
        ["sssloan", got.line.sssLoan, exp.sssloan],
        ["pagloan", got.line.hdmfLoan, exp.pagloan],
        ["sss", got.line.sss, exp.sss],
        ["phic", got.line.phic, exp.philhealth],
        ["hdmf", got.line.hdmf, exp.hdmf],
      ];
      cols.forEach(([k, a, b]) => {
        assert.ok(near(a, b), p.name + " " + k + " got " + a + " expected " + b);
      });
      if (explained) {
        assert.equal(got.late.amount, explained.late);
        assert.equal(got.line.net, explained.net);
        assert.ok(!near(got.late.amount, exp.late));
      } else {
        assert.ok(near(got.late.amount, exp.late), p.name + " late " + got.late.amount + " vs " + exp.late);
        assert.ok(near(got.line.ded, exp.totded), p.name + " totded " + got.line.ded + " vs " + exp.totded);
        assert.equal(got.line.net, money(exp.net));
      }
    });
  });

  it("halves government deductions, skips the week of the 27th, and ceilings the net", () => {
    const half = P.statutoryOf({ ded: { sss: 325, phic: 131.25, hdmf: 100 } }, "weekly", { from: "2026-10-08", to: "2026-10-14" }, {});
    assert.equal(half.sss, 162.5);
    assert.equal(half.phic, 65.62);
    assert.equal(half.hdmf, 50);
    const skip = P.statutoryOf({}, "weekly", { from: "2026-09-24", to: "2026-09-30" }, { ded: { sss: 325, phic: 131.25, hdmf: 100 } });
    assert.equal(skip.sss, 0);
    assert.equal(skip.phic, 0);
    assert.equal(skip.hdmf, 0);
    assert.equal(skip.rule, "skip-week-27");
    const refused = P.statutoryOf({ govDeductionRefused: true }, "semi", { from: "2026-09-28", to: "2026-10-12" }, { ded: { sss: 325, phic: 131.25, hdmf: 100 } });
    assert.equal(refused.sss, 0);
    assert.equal(P.periodAllowance({ rateType: "Monthly", allowance: 1000 }), 500);
    const net = P.priceLine({ days: 1, daily: 100.2, late: 0.3 });
    assert.equal(net.net, 100);
    assert.equal(P.lateForRow({ in: "8:15", day: 1 }, 520).amount, 0);
    assert.equal(P.lateForRow({ in: "8:16", day: 1 }, 520).amount, 16);
    assert.equal(P.lateForRow({ in: "8:50", day: 1, r: "errand" }, 520).amount, 0);
    assert.equal(P.lateForRow({ in: "8:50", day: 1, r: "traffic (not excused)" }, 520).amount, 50);
    assert.equal(P.ccdId({ empNo: "1253" }), "CCD1253");
    assert.equal(P.ccdId({ employeeId: "CCD9", empNo: "1253" }), "CCD9");
    assert.equal(P.payKindOf({ payType: "Weekly", rateType: "Monthly" }), "weekly");
    assert.equal(P.payKindOf({ payType: "Semi-monthly" }), "semi");
    assert.equal(P.payKindOf({ rateType: "Monthly" }), "semi");
    assert.equal(P.leaveDayCredit("e1", "2026-10-08"), 1);
  });

  it("writes the company workbook, audit columns, and signatories", () => {
    const weekly = P.workbook({
      kind: "weekly",
      from: "2026-10-08",
      to: "2026-10-14",
      release: "2026-10-17",
      lines: [{
        empId: "e1",
        empNo: "1253",
        employeeId: "CCD1253",
        name: "Arsua, Jonard",
        position: "Driver",
        site: "CTU BARILI (VET MED)",
        daily: 570,
        hourly: 71.25,
        days: 1,
        ot: 1.5,
        gross: 677.0,
        ded: 228.12,
        net: 449,
        late: 0,
        ca: 0,
        sss: 162.5,
        phic: 65.62,
        hdmf: 0,
        rows: [{ date: "2026-10-08", in: "7:29", out: "18:28", day: 1, ot: 1.5, site: "CTU BARILI (VET MED)" }],
        src: [{ run: "weekly|2026-10-08", empId: "e1", name: "Arsua, Jonard", date: "2026-10-08", item: "day", qty: 1, amount: 570, source_collection: "daily", source_id: "d20261008", form_url: "", balance_after: "", exception: "" }],
      }],
    });
    assert.equal(weekly.sheets.map((s) => s.name).join("|"), "All|Total Summary|Audit");
    assert.equal(weekly.sheets[0].rows[0][47].v, "PERIOD DATE:");
    assert.equal(weekly.sheets[0].rows[0][52].v, "October 8-14, 2026");
    assert.equal(weekly.sheets[0].rows[6][53].v, "NET PAY");
    assert.match(String(weekly.sheets[0].rows[9][53].f), /ROUNDUP/);
    assert.equal(weekly.sheets[0].rows[9][53].v, 449);
    const auditHead = weekly.sheets[2].rows[0].map((c) => c.v);
    assert.equal(auditHead.join("|"), "run|empId|name|date|item|qty|amount|source_collection|source_id|form_url|balance_after|exception");

    const semi = P.workbook({
      kind: "semi",
      from: "2026-09-28",
      to: "2026-10-12",
      release: "2026-10-15",
      lines: [{
        empId: "e2",
        empNo: "1241",
        name: "Abadiano, Glory Mae M.",
        position: "Admin",
        site: "ADMINS",
        daily: 20500 / 26,
        hourly: (20500 / 26) / 8,
        monthlyAmount: 20500,
        days: 1,
        ot: 0,
        allowance: 500,
        gross: 20500 / 26 + 500,
        ded: 556.25,
        net: 730,
        sss: 325,
        phic: 131.25,
        hdmf: 100,
        rows: [{ date: "2026-09-28", day: 1, ot: 0, site: "ADMINS" }],
        src: [],
      }],
    });
    assert.equal(semi.sheets.map((s) => s.name).join("|"), "Admins|Total Summary|Project Site Manpower|Audit");
    const text = semi.sheets[0].rows.map((row) => row.map((c) => (c && c.v) || "").join(" ")).join("\n");
    assert.match(text, /Sept\. 28-Oct\. 12, 2026/);
    assert.match(text, /Payout Date: Oct\. 15, 2026/);
    assert.match(text, /ID No\. 1241/);
    assert.match(text, /Catherine A\. Largo/);
    assert.match(text, /Jeffrey James M\. Corro/);
    const bytes = P.toXlsx(semi);
    const raw = Buffer.from(bytes).toString("latin1");
    assert.match(raw, /Catherine A\. Largo/);
    assert.match(raw, /ROUNDUP/);
    assert.match(raw, /Audit/);
    assert.match(raw, /ID No\. 1241/);
  });

  it("is wired into the portal without replacing the in-page engine", () => {
    assert.match(html, /<script src="\/hr-payroll-sheet\.js"><\/script>/);
    assert.match(html, /const BUILD = "2026-10-29b"/);
    assert.match(html, /24HH0142 Labangon Chapel \(Package B\)/);
    assert.match(html, /data-ef="employeeId"/);
    assert.match(html, /fld\("Pay type","payType"/);
    assert.match(html, /hrPaySheet\.decorateLine/);
    assert.match(html, /function payCaDetail\(/);
    assert.match(html, /id="pay-xlsx"/);
    assert.match(html, /id="pay-finalize"/);
    assert.doesNotMatch(html, /script src="\/hr-payroll\.js"/);
  });
});
