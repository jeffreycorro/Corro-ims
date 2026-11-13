"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const doc = fs.readFileSync(path.join(__dirname, "../docs/payroll-audit-checks.md"), "utf8");

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

const NAMES = [
  "addDays",
  "clockMinutes",
  "otHoursFromClock",
  "clockLabel",
  "scheduleEndFor",
  "clockOtBreakMinutes",
  "clockOtMinHours",
  "clockOtHours",
  "payrollOtParts",
  "payrollOtHours",
  "otSiteKey",
  "otEachDate",
  "otFormGateWaived",
  "otPendingApplies",
  "otRequestCovers",
  "otCovered",
  "otFormUrl",
  "otFormFiles",
  "otFileKey",
  "isEphemeralUrl",
  "durableDriveUrl",
  "otPaidHours",
  "payAuditItemKey",
  "payAuditInWindow",
  "payAuditDayOf",
  "payAuditDays",
  "payAuditEmpId",
  "payAuditSite",
  "payAuditPerson",
  "payAuditOtManualDiffers",
  "payAuditChecks",
  "payAuditRun",
  "payAuditSaveReview",
  "payRecomputeFields",
];

function load() {
  const ctx = {
    isoDate(t) {
      return (
        t.getFullYear() +
        "-" +
        String(t.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(t.getDate()).padStart(2, "0")
      );
    },
    S: {
      settings: { otPolicy: 1, otFormGateWaived: true },
      employees: {},
      daily: {},
      otreqs: {},
      payruns: {},
    },
  };
  vm.runInNewContext(NAMES.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function day(ctx, date, rows) {
  const id = "d" + date.replace(/-/g, "");
  ctx.S.daily[id] = { id, date, rows };
}

describe("2026-11-09a clock OT and payroll review", () => {
  it("is build 2026-11-09a and documents how to add a check", () => {
    assert.match(html, /const BUILD = "2026-11-13a"/);
    assert.match(html, /function payAuditChecks\(/);
    assert.match(html, /function clockOtHours\(/);
    assert.match(doc, /payAuditChecks/);
    assert.match(doc, /checkId\|empId\|date/);
    assert.match(doc, /Blank time in or time out on Present days/);
    assert.match(doc, /₱1 per minute from 8:00/);
    assert.match(doc, /under 3 months/);
    assert.match(doc, /KASABUTAN/);
    assert.match(doc, /no matching CAF/);
    assert.match(doc, /balance is already zero/);
    assert.doesNotMatch(extractFunction(html, "otEntryBox"), /disabled|readonly/);
    assert.match(extractFunction(html, "payAuditHtml"), /does not change pay/);
    assert.match(extractFunction(html, "payRecomputeFields"), /lateTouched/);
    assert.doesNotMatch(extractFunction(html, "payRecomputeFields"), /auditReviews/);
    assert.doesNotMatch(extractFunction(html, "payAuditRun"), /finalizedOn/);
  });

  it("derives clock OT with the meal, hundredths rounding, the half-hour minimum, and overnight on the start date", () => {
    const ctx = load();
    assert.equal(ctx.scheduleEndFor(null, "2026-11-05"), "17:00");
    assert.equal(ctx.scheduleEndFor(null, "2026-11-07"), "12:00");
    assert.equal(ctx.scheduleEndFor(null, "2026-11-08"), "");
    assert.equal(ctx.scheduleEndFor({ scheduleEnd: "6:00 PM" }, "2026-11-05"), "18:00");

    assert.equal(ctx.clockOtHours("8:00 AM", "5:00 PM", "17:00"), 0);
    assert.equal(ctx.clockOtHours("8:00 AM", "5:20 PM", "17:00"), 0);
    assert.equal(ctx.clockOtHours("8:00 AM", "5:30 PM", "17:00"), 0.5);
    assert.equal(ctx.clockOtHours("8:00 AM", "6:10 PM", "17:00"), 1.17);
    assert.equal(ctx.clockOtHours("8:00", "14:00", "11:00"), 2);
    assert.equal(ctx.clockOtHours("18:00", "03:00", "17:00"), 9);
    assert.equal(ctx.clockOtHours("8:00 AM", "3:00 AM", "17:00"), 10);
    assert.equal(ctx.clockOtHours("8:00 AM", "", "17:00"), 0);
    assert.equal(ctx.clockOtHours("18:00", "03:00", ""), 0);

    ctx.S.employees.e1 = { id: "e1", name: "De Asis", empNo: "1400", project: "Yard" };
    day(ctx, "2026-11-05", {
      e1: { s: "Present", in: "18:00", out: "03:00", ot: "", site: "Yard" },
    });
    const night = ctx.payrollOtParts(ctx.S.daily.d20261105, "e1", ctx.S.daily.d20261105.rows.e1);
    assert.equal(night.hours, 9);
    assert.equal(night.source, "clock");
    assert.equal(night.clock, 9);
    const beforeDaily = JSON.stringify(ctx.S.daily);
    const flagged = ctx.payAuditRun({ from: "2026-11-05", to: "2026-11-11", periodEnd: "2026-11-11" });
    assert.equal(JSON.stringify(ctx.S.daily), beforeDaily);
    assert.equal(flagged.some((c) => c.id === "ot_request_no_daily" || c.id === "ot_paid_no_request"), false);
    assert.equal(ctx.S.daily.d20261105.rows.e1.ot, "");
  });

  it("lets a typed OT number win and flags it when it differs from the clock", () => {
    const ctx = load();
    ctx.S.employees.e1 = { id: "e1", name: "Monilla", empNo: "1401", project: "Yard" };
    day(ctx, "2026-11-05", {
      e1: { s: "Present", in: "8:00 AM", out: "7:00 PM", ot: 4, site: "Yard" },
    });
    const parts = ctx.payrollOtParts(ctx.S.daily.d20261105, "e1", ctx.S.daily.d20261105.rows.e1);
    assert.equal(parts.source, "manual");
    assert.equal(parts.hours, 4);
    assert.equal(parts.clock, 2);
    assert.equal(ctx.payrollOtHours(ctx.S.daily.d20261105, "e1", ctx.S.daily.d20261105.rows.e1), 4);

    const before = JSON.stringify(ctx.S.daily);
    const report = ctx.payAuditRun({ from: "2026-11-05", to: "2026-11-05", periodEnd: "2026-11-05" });
    assert.equal(JSON.stringify(ctx.S.daily), before);
    const diff = report.find((c) => c.id === "ot_manual_differs_clock");
    assert.equal(diff.severity, "info");
    assert.equal(diff.rows.length, 1);
    assert.equal(diff.rows[0].empId, "e1");
    assert.equal(diff.rows[0].date, "2026-11-05");
    assert.match(diff.rows[0].details, /Daily OT 4 h, clock 2 h/);
    assert.equal(ctx.payrollOtHours(ctx.S.daily.d20261105, "e1", ctx.S.daily.d20261105.rows.e1), 4);

    ctx.S.daily.d20261105.rows.e1.ot = 2;
    const same = ctx.payAuditRun({ from: "2026-11-05", to: "2026-11-05", periodEnd: "2026-11-05" });
    assert.equal(same.find((c) => c.id === "ot_manual_differs_clock").rows.length, 0);
    assert.equal(ctx.payrollOtParts(ctx.S.daily.d20261105, "e1", ctx.S.daily.d20261105.rows.e1).hours, 2);
  });

  it("does not flag missing OT requests, and leaves request rows and daily OT unchanged", () => {
    const ctx = load();
    ctx.S.employees.e1 = { id: "e1", name: "Santos, Ben", empNo: "1500", project: "Danlag" };
    ctx.S.employees.e2 = { id: "e2", name: "Cruz, Ana", empNo: "1501", project: "Danlag" };
    day(ctx, "2026-11-05", {
      e1: { s: "Present", in: "8:00 AM", out: "7:00 PM", ot: "", site: "Danlag" },
      e2: { s: "Present", in: "", out: "", ot: 0, site: "Danlag" },
    });
    ctx.S.otreqs.filed = {
      id: "filed",
      from: "2026-11-05",
      to: "2026-11-05",
      site: "Danlag",
      wholeSite: false,
      empIds: ["e2"],
      hoursEach: 9,
      timeFrom: "18:00",
      timeTo: "03:00",
      status: "Filed",
    };
    ctx.S.otreqs.nope = {
      id: "nope",
      from: "2026-11-05",
      to: "2026-11-05",
      site: "Danlag",
      empIds: ["e1"],
      hoursEach: 2,
      timeFrom: "17:00",
      timeTo: "19:00",
      status: "Rejected",
    };
    ctx.S.otreqs.cancelled = {
      id: "cancelled",
      from: "2026-11-05",
      to: "2026-11-05",
      empIds: ["e2"],
      hoursEach: 9,
      status: "Cancelled",
    };
    const first = ctx.payAuditRun({ from: "2026-11-05", to: "2026-11-11", periodEnd: "2026-11-11" });
    const again = ctx.payAuditRun({ from: "2026-11-05", to: "2026-11-11", periodEnd: "2026-11-11" });
    assert.deepEqual(
      first.map((c) => [c.id, c.count]),
      again.map((c) => [c.id, c.count])
    );
    assert.equal(first.some((c) => c.id === "ot_paid_no_request" || c.id === "ot_request_no_daily"), false);
    assert.equal(ctx.S.otreqs.filed.status, "Filed");
    assert.equal(ctx.S.otreqs.nope.status, "Rejected");
    assert.equal(ctx.S.daily.d20261105.rows.e1.ot, "");
    assert.equal(ctx.payrollOtHours(ctx.S.daily.d20261105, "e1", ctx.S.daily.d20261105.rows.e1), 2);
  });

  it("keeps a Reviewed note across recompute and does not change pay fields that were touched", () => {
    const ctx = load();
    const key = ctx.payAuditItemKey("ot_manual_differs_clock", "e1", "2026-11-05");
    const run = {
      id: "weekly|2026-11-05",
      kind: "weekly",
      from: "2026-11-05",
      to: "2026-11-11",
      lines: {
        e1: { days: 4, ot: 9, late: 15, lateTouched: true, ca: 100, caTouched: true, sss: 10, statTouched: true },
      },
    };
    ctx.payAuditSaveReview(run, key, "times checked", "Cassie", "2026-11-09T05:00:00.000Z");
    const hoursBefore = 9;
    ctx.payRecomputeFields(run);
    assert.equal(run.lines.e1.ot, undefined);
    assert.equal(run.lines.e1.days, undefined);
    assert.equal(run.lines.e1.late, 15);
    assert.equal(run.lines.e1.lateTouched, true);
    assert.equal(run.lines.e1.ca, 100);
    assert.equal(run.lines.e1.caTouched, true);
    assert.equal(run.lines.e1.sss, 10);
    assert.equal(run.lines.e1.statTouched, true);
    assert.equal(run.auditReviews[key].reviewed, true);
    assert.equal(run.auditReviews[key].note, "times checked");
    assert.equal(run.auditReviews[key].by, "Cassie");
    assert.equal(run.auditReviews[key].at, "2026-11-09T05:00:00.000Z");
    assert.equal(run.finalizedOn, undefined);
    assert.equal(hoursBefore, 9);

    ctx.S.employees.e1 = { id: "e1", name: "Santos, Ben", empNo: "1500" };
    day(ctx, "2026-11-05", { e1: { s: "Present", in: "8:00 AM", out: "7:00 PM", ot: 4, site: "Danlag" } });
    const paidBefore = ctx.payrollOtHours(ctx.S.daily.d20261105, "e1", ctx.S.daily.d20261105.rows.e1);
    const reviewed = ctx.payAuditRun({
      from: "2026-11-05",
      to: "2026-11-05",
      periodEnd: "2026-11-05",
      reviews: run.auditReviews,
    });
    const row = reviewed.find((c) => c.id === "ot_manual_differs_clock").rows[0];
    assert.equal(row.review.note, "times checked");
    assert.equal(reviewed.some((c) => c.id === "ot_paid_no_request"), false);
    assert.equal(ctx.payrollOtHours(ctx.S.daily.d20261105, "e1", ctx.S.daily.d20261105.rows.e1), paidBefore);
    assert.equal(ctx.S.daily.d20261105.rows.e1.ot, 4);
  });
});
