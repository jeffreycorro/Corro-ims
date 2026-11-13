"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "../public");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const forms = fs.readFileSync(path.join(root, "hr-ot-forms.js"), "utf8");
const collections = fs.readFileSync(path.join(__dirname, "../netlify/lib/collections.js"), "utf8");
const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20261112000001_hr_ot_plans_reports.sql"),
  "utf8"
);

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

function load(extra) {
  const ctx = Object.assign(
    {
      S: { employees: {}, daily: {}, otplans: {}, otreps: {}, otreqs: {}, settings: {}, payruns: {} },
    },
    extra || {}
  );
  vm.runInNewContext(forms, ctx);
  return ctx;
}

const WIN = { from: "2026-11-05", to: "2026-11-11" };

function person(id, name, empNo) {
  return { id: id, name: name, empNo: empNo || "" };
}

describe("2026-11-12a afternoon plan and morning report", () => {
  it("is build 2026-11-12a and retires new OT requests", () => {
    assert.match(html, /const BUILD = "2026-11-13a"/);
    assert.match(html, /script src="\/hr-ot-forms\.js"/);
    assert.match(html, /\{k:"otplan",\s*n:"Afternoon OT Plan"/);
    assert.match(html, /\{k:"otrep",\s*n:"Morning OT Report"/);
    assert.match(html, /\{k:"otreq",\s*n:"Old OT requests \(history\)"/);
    assert.match(html, /function viewOtPlans\(/);
    assert.match(html, /function viewOtReports\(/);
    assert.match(html, /Weather/);
    assert.match(html, /Materials\/Equipment/);
    assert.match(html, /not on the plan/i);
    assert.doesNotMatch(html, /id="ot-new"/);
    assert.doesNotMatch(html, /id:"ot_paid_no_request"/);
    assert.doesNotMatch(html, /id:"ot_request_no_daily"/);
    assert.doesNotMatch(html, /function payAuditOtPaidNoRequest/);
    assert.match(collections, /"otplans"/);
    assert.match(collections, /"otreps"/);
    assert.match(migration, /'otplans'/);
    assert.match(migration, /'otreps'/);
    assert.match(migration, /does not change or delete existing rows/i);
    assert.match(html, /hrOtZeroDmWarningHtml/);
    assert.match(html, /data-set-flag="otFormGateWaived"/);
  });

  it("adds Banawa when the live site list does not already have it", () => {
    const ctx = load();
    const added = ctx.hrOtSiteList(["ADMINS", "Tawason", "Danao SPLPA"]);
    assert.ok(added.includes("Banawa"));
    assert.equal(added.filter((n) => n === "Banawa").length, 1);
    const once = ctx.hrOtSiteList(["Banawa", "ADMINS", "Banawa"]);
    assert.equal(once.filter((n) => n === "Banawa").length, 1);
    assert.deepEqual(once, once.slice().sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "variant" })));
  });

  it("does not count plan hours, and counts only confirmed Morning Report hours", () => {
    const ctx = load();
    ctx.S.employees.e1 = person("e1", "Santos, Ben", "10");
    ctx.S.otplans.p1 = {
      id: "p1", otDate: "2026-11-05", site: "Banawa", deptHead: "Luzano",
      rows: [{ empId: "e1", name: "Santos, Ben", task: "Roof", reason: "Deadline", expectedHours: 5, timeFrom: "18:00", timeTo: "23:00" }],
    };
    assert.equal(ctx.hrOtReportedHours("e1", "2026-11-05"), 0);
    assert.equal(ctx.hrOtReportConfirms("e1", "2026-11-05", "Banawa"), false);
    ctx.S.otreps.r1 = {
      id: "r1", planId: "p1", otDate: "2026-11-05", reportDate: "2026-11-06",
      rows: [{ empId: "e1", hours: 4, description: "Roof done" }],
    };
    assert.equal(ctx.hrOtReportedHours("e1", "2026-11-05"), 4);
    ctx.S.otreps.r1.rows[0].noOt = true;
    ctx.S.otreps.r1.rows[0].noOtReason = "Weather";
    assert.equal(ctx.hrOtReportedHours("e1", "2026-11-05"), 0);
    ctx.S.otreps.r1.noOt = true;
    ctx.S.otreps.r1.rows[0].noOt = false;
    ctx.S.otreps.r1.rows[0].hours = 4;
    assert.equal(ctx.hrOtReportedHours("e1", "2026-11-05"), 0);
  });

  it("requires a No OT reason, stores it on the rows, and keeps Other from saving without a note", () => {
    const ctx = load();
    ctx.S.employees.e1 = person("e1", "Santos, Ben", "10");
    ctx.S.employees.e2 = person("e2", "Cruz, Ana", "11");
    ctx.S.otplans.p1 = {
      id: "p1", otDate: "2026-11-05", site: "Banawa", deptHead: "Luzano",
      rows: [
        { empId: "e1", task: "Roof", reason: "Deadline" },
        { empId: "e2", task: "Haul", reason: "Deadline" },
      ],
    };
    const base = {
      planId: "p1", otDate: "2026-11-05", reportDate: "2026-11-06", noOt: true, noOtReason: "Weather",
      rows: [
        { empId: "e1", description: "" },
        { empId: "e2", description: "" },
      ],
    };
    const ok = ctx.hrOtValidateReport(base, ctx);
    assert.equal(ok.ok, true);
    assert.equal(ok.report.rows[0].noOt, true);
    assert.equal(ok.report.rows[0].noOtReason, "Weather");
    assert.equal(ok.report.rows[1].noOtReason, "Weather");
    assert.equal(ctx.S.otplans.p1.rows[0].expectedHours, undefined);

    const other = ctx.hrOtValidateReport(Object.assign({}, base, { noOtReason: "Other", noOtNote: "" }), ctx);
    assert.equal(other.ok, false);
    assert.match(other.errors.join(" "), /Other/);
    const noted = ctx.hrOtValidateReport(Object.assign({}, base, { noOtReason: "Other", noOtNote: "Power cut" }), ctx);
    assert.equal(noted.ok, true);
    assert.equal(noted.report.rows[0].noOtNote, "Power cut");

    const one = ctx.hrOtValidateReport({
      planId: "p1", otDate: "2026-11-05", reportDate: "2026-11-06",
      rows: [
        { empId: "e1", noOt: true },
        { empId: "e2", hours: 3, description: "Hauled" },
      ],
    }, ctx);
    assert.equal(one.ok, false);
    assert.match(one.errors.join(" "), /Weather|Materials\/Equipment|Other/);
  });

  it("refuses a report row that is not on the plan until a reason is entered", () => {
    const ctx = load();
    ctx.S.employees.e1 = person("e1", "Santos, Ben", "10");
    ctx.S.employees.e9 = person("e9", "Reyes, Joy", "19");
    ctx.S.otplans.p1 = {
      id: "p1", otDate: "2026-11-05", site: "Banawa", deptHead: "Luzano",
      rows: [{ empId: "e1", task: "Roof", reason: "Deadline", expectedHours: 4 }],
    };
    const missing = ctx.hrOtValidateReport({
      planId: "p1", otDate: "2026-11-05", reportDate: "2026-11-06",
      rows: [
        { empId: "e1", hours: 4, description: "Roof" },
        { empId: "e9", hours: 2, description: "Called in" },
      ],
    }, ctx);
    assert.equal(missing.ok, false);
    assert.match(missing.errors.join(" "), /not on the Afternoon Plan/i);

    const saved = ctx.hrOtValidateReport({
      planId: "p1", otDate: "2026-11-05", reportDate: "2026-11-06",
      rows: [
        { empId: "e1", hours: 4, description: "Roof" },
        { empId: "e9", hours: 2, description: "Called in", notInPlanReason: "Driver sent after the plan was signed" },
      ],
    }, ctx);
    assert.equal(saved.ok, true);
    assert.equal(saved.report.rows[1].notInPlan, true);
    ctx.S.otreps.r1 = saved.report;
    ctx.S.otreps.r1.id = "r1";
    const before = JSON.stringify(ctx.S);
    const report = ctx.hrOtAuditRun(Object.assign({ S: ctx.S }, WIN));
    assert.equal(JSON.stringify(ctx.S), before);
    const extra = report.find((c) => c.id === "ot_not_in_plan");
    assert.equal(extra.severity, "review");
    assert.equal(extra.rows.length, 1);
    assert.equal(extra.rows[0].empId, "e9");
    assert.match(extra.rows[0].details, /Driver sent after the plan was signed/);
    assert.match(extra.rows[0].details, /does not block pay/);
    assert.equal(report.find((c) => c.id === "ot_report_no_plan").rows.length, 0);
  });

  it("treats a cancelled report as resolved and a plan with no report as missing", () => {
    const ctx = load();
    ctx.S.employees.e1 = person("e1", "Dugaduga, Ronnie", "20");
    ctx.S.otplans.p1 = {
      id: "p1", otDate: "2026-11-05", site: "Banawa", deptHead: "Luzano",
      rows: [{ empId: "e1", name: "Dugaduga, Ronnie", task: "Roof", reason: "Subcon", expectedHours: 5 }],
    };
    let report = ctx.hrOtAuditRun(Object.assign({ S: ctx.S }, WIN));
    const missing = report.find((c) => c.id === "ot_plan_no_report");
    assert.equal(missing.rows.length, 1);
    assert.match(missing.rows[0].details, /Report missing/);
    assert.equal(report.find((c) => c.id === "ot_plan_cancelled").rows.length, 0);

    ctx.S.otreps.r1 = {
      id: "r1", planId: "p1", otDate: "2026-11-05", reportDate: "2026-11-06", noOt: true, noOtReason: "Weather", noOtNote: "",
      rows: [{ empId: "e1", noOt: true, noOtReason: "Weather" }],
    };
    ctx.S.daily.d20261105 = { id: "d20261105", date: "2026-11-05", rows: { e1: { ot: 5, site: "Banawa" } } };
    const snap = JSON.stringify(ctx.S.daily);
    report = ctx.hrOtAuditRun(Object.assign({ S: ctx.S }, WIN));
    assert.equal(JSON.stringify(ctx.S.daily), snap);
    assert.equal(report.find((c) => c.id === "ot_plan_no_report").rows.length, 0);
    const cancelled = report.find((c) => c.id === "ot_plan_cancelled");
    assert.equal(cancelled.severity, "info");
    assert.match(cancelled.rows[0].details, /Plan cancelled \(Weather\)/);
    const after = report.find((c) => c.id === "ot_hours_after_no_ot");
    assert.equal(after.rows.length, 1);
    assert.match(after.rows[0].details, /Weather/);
    assert.match(after.rows[0].details, /5 h/);
    assert.equal(ctx.S.daily.d20261105.rows.e1.ot, 5);

    ctx.S.daily.d20261105.rows.e1.ot = 0;
    report = ctx.hrOtAuditRun(Object.assign({ S: ctx.S }, WIN));
    assert.equal(report.find((c) => c.id === "ot_hours_after_no_ot").rows.length, 0);
    assert.equal(report.find((c) => c.id === "ot_plan_cancelled").rows.length, 1);
  });

  it("flags DM differences, a report with no plan, DM with neither form, a missing roster name, and Sunday premium", () => {
    const ctx = load();
    ctx.S.employees.e1 = person("e1", "Kiamco, Jophil", "30");
    ctx.S.employees.e2 = person("e2", "Ramas, Danilo", "31");
    ctx.S.otplans.p1 = {
      id: "p1", otDate: "2026-11-06", site: "Tagba-o", deptHead: "Luzano",
      rows: [{ empId: "e1", task: "Haul", reason: "Canal", expectedHours: 4 }],
    };
    ctx.S.otreps.r1 = {
      id: "r1", planId: "p1", otDate: "2026-11-06", reportDate: "2026-11-07",
      rows: [{ empId: "e1", hours: 3, description: "Hauled until 9" }],
    };
    ctx.S.otreps.r2 = {
      id: "r2", noPlan: true, planId: "", otDate: "2026-11-07", reportDate: "2026-11-08",
      rows: [{ empId: "e2", hours: 2, description: "Delivery", notInPlanReason: "No afternoon plan was filed" }],
    };
    ctx.S.otplans.ghost = {
      id: "ghost", otDate: "2026-11-09", site: "Danao SPLPA", deptHead: "Luzano",
      rows: [{ empId: "missing", name: "Nobody", task: "Level", reason: "Backfill", expectedHours: 4 }],
    };
    ctx.S.daily.d20261106 = { date: "2026-11-06", rows: { e1: { ot: 4, site: "Tagba-o", hol: 0 } } };
    ctx.S.daily.d20261107 = { date: "2026-11-07", rows: { e2: { ot: 2, site: "Tawason", hol: 0 } } };
    ctx.S.daily.d20261108 = { date: "2026-11-08", rows: { e1: { ot: 8, site: "Balaga", hol: 0 } } };
    ctx.S.daily.d20261110 = { date: "2026-11-10", rows: { e2: { ot: 4, site: "Banawa", hol: 0 } } };
    const payrun = { lines: { e1: { ot: 9, late: 15, lateTouched: true, ca: 3, caTouched: true } } };
    const beforeRun = JSON.stringify(payrun);
    const beforeDaily = JSON.stringify(ctx.S.daily);
    const report = ctx.hrOtAuditRun(Object.assign({ S: ctx.S, holidayOn: function (d) { return d === "2026-11-10" ? { n: "Local holiday", t: "Special" } : null; } }, WIN));
    assert.equal(JSON.stringify(payrun), beforeRun);
    assert.equal(payrun.lines.e1.lateTouched, true);
    assert.equal(JSON.stringify(ctx.S.daily), beforeDaily);

    const diff = report.find((c) => c.id === "ot_dm_differs_report");
    assert.equal(diff.rows.length, 1);
    assert.match(diff.rows[0].details, /Daily Manpower 4 h, Morning Report 3 h/);
    assert.equal(report.find((c) => c.id === "ot_report_no_plan").rows.map((r) => r.empId).join(","), "e2");
    assert.equal(report.find((c) => c.id === "ot_not_in_plan").rows.length, 0);
    const bare = report.find((c) => c.id === "ot_dm_no_plan_or_report");
    assert.ok(bare.rows.some((r) => r.empId === "e2" && r.date === "2026-11-10"));
    assert.equal(bare.rows.some((r) => r.date === "2026-11-06"), false);
    const roster = report.find((c) => c.id === "ot_employee_not_roster");
    assert.equal(roster.rows[0].empId, "missing");
    const rest = report.find((c) => c.id === "ot_rest_day_premium");
    assert.ok(rest.rows.some((r) => r.date === "2026-11-08" && /Sunday/.test(r.details)));
    assert.ok(rest.rows.some((r) => r.date === "2026-11-10" && /Local holiday/.test(r.details)));
    ctx.S.daily.d20261108.rows.e1.hol = 1;
    const granted = ctx.hrOtAuditRun(Object.assign({ S: ctx.S }, WIN));
    assert.equal(granted.find((c) => c.id === "ot_rest_day_premium").rows.some((r) => r.date === "2026-11-08"), false);
    assert.equal(ctx.S.daily.d20261108.rows.e1.ot, 8);
  });

  it("warns on the approval screen when forms have OT and Daily Manpower OT is zero, and stays quiet when the report cancelled it", () => {
    const ctx = load();
    ctx.S.employees.e1 = person("e1", "Omega, Justine", "40");
    ctx.S.otplans.p1 = {
      id: "p1", otDate: "2026-11-10", site: "Office", deptHead: "Omega",
      rows: [{ empId: "e1", task: "MRF", reason: "Reconcile", expectedHours: 3 }],
    };
    ctx.S.daily.d20261110 = { date: "2026-11-10", rows: { e1: { ot: 0, site: "Office" } } };
    const days = ctx.hrOtZeroDmDays("2026-11-05", "2026-11-11", ctx);
    assert.equal(days.map((d) => String(d.date)).join(","), "2026-11-10");
    const htmlWarn = ctx.hrOtZeroDmWarningHtml("2026-11-05", "2026-11-11", ctx);
    assert.match(htmlWarn, /id="pay-ot-zero-dm"/);
    assert.match(htmlWarn, /2026-11-10/);
    assert.match(htmlWarn, /not blocked/i);
    ctx.S.otreps.r1 = {
      id: "r1", planId: "p1", otDate: "2026-11-10", reportDate: "2026-11-11", noOt: true, noOtReason: "Materials/Equipment",
      rows: [{ empId: "e1", noOt: true, noOtReason: "Materials/Equipment" }],
    };
    assert.equal(ctx.hrOtZeroDmDays("2026-11-05", "2026-11-11", ctx).length, 0);
    assert.equal(ctx.hrOtZeroDmWarningHtml("2026-11-05", "2026-11-11", ctx), "");
    ctx.S.otreps.r1.noOt = false;
    ctx.S.otreps.r1.rows[0].noOt = false;
    ctx.S.otreps.r1.rows[0].hours = 3;
    assert.equal(ctx.hrOtZeroDmDays("2026-11-05", "2026-11-11", ctx).length, 1);
  });

  it("records who changed a plan and when, and does not record an empty amendment", () => {
    const ctx = load();
    const before = {
      id: "p1", otDate: "2026-11-05", site: "Banawa", deptHead: "Luzano",
      rows: [{ empId: "e1", name: "Santos", task: "Roof", reason: "Deadline", expectedHours: 4 }],
      amendments: [],
    };
    const same = ctx.hrOtWithAmendment(before, before, "Cassie", "2026-11-05T10:00:00.000Z");
    assert.equal(same.amendments.length, 0);
    const after = ctx.hrOtClone(before);
    after.rows[0].expectedHours = 3;
    const next = ctx.hrOtWithAmendment(after, before, "Catherine Largo", "2026-11-05T18:00:00.000Z");
    assert.equal(next.amendments.length, 1);
    assert.equal(next.amendments[0].by, "Catherine Largo");
    assert.equal(next.amendments[0].at, "2026-11-05T18:00:00.000Z");
    assert.match(next.amendments[0].what, /Expected hours for Santos: 4 → 3/);
    assert.equal(before.rows[0].expectedHours, 4);
  });

  it("keeps a Reviewed note on a not-in-plan row and registers the new checks beside the clock check", () => {
    const ctx = load();
    const names = ["payAuditChecks", "payAuditRun", "payAuditItemKey", "payAuditOtManualDiffers", "payAuditDays", "payAuditEmpId", "payAuditPerson", "otFormGateWaived", "otPendingApplies", "otPaidHours", "otCovered"];
    vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
    ctx.S.employees.e1 = person("e1", "Santos, Ben", "10");
    ctx.S.employees.e9 = person("e9", "Reyes, Joy", "19");
    ctx.S.settings.otFormGateWaived = false;
    ctx.S.otreqs.old = {
      id: "old", from: "2026-11-05", to: "2026-11-05", site: "Banawa", status: "Approved",
      formUrl: "https://drive.google.com/file/d/OLD/view", empIds: ["e1"], wholeSite: false,
    };
    assert.equal(ctx.otPaidHours("e1", "2026-11-05", "Banawa", 4, "2026-11-11"), 0);
    assert.equal(ctx.S.otreqs.old.status, "Approved");
    ctx.S.otreps.r1 = {
      id: "r1", planId: "p1", otDate: "2026-11-05", reportDate: "2026-11-06",
      rows: [{ empId: "e1", hours: 4, description: "Done" }],
    };
    assert.equal(ctx.otPaidHours("e1", "2026-11-05", "Banawa", 4, "2026-11-11"), 4);
    ctx.S.settings.otFormGateWaived = true;
    delete ctx.S.otreps.r1;
    assert.equal(ctx.otPaidHours("e1", "2026-11-05", "Banawa", 4, "2026-11-11"), 4);
    assert.equal(ctx.S.otreqs.old.status, "Approved");

    ctx.S.otplans.p1 = {
      id: "p1", otDate: "2026-11-05", site: "Banawa", deptHead: "Luzano",
      rows: [{ empId: "e1", task: "Roof", reason: "Deadline", expectedHours: 4 }],
    };
    ctx.S.otreps.r1 = {
      id: "r1", planId: "p1", otDate: "2026-11-05", reportDate: "2026-11-06",
      rows: [
        { empId: "e1", hours: 4, description: "Roof" },
        { empId: "e9", hours: 1, description: "Extra", notInPlanReason: "Sent by the yard" },
      ],
    };
    const ids = ctx.payAuditChecks().map((c) => c.id);
    assert.equal(ids.includes("ot_manual_differs_clock"), true);
    assert.equal(ids.includes("ot_paid_no_request"), false);
    assert.equal(ids.includes("ot_request_no_daily"), false);
    ["ot_dm_differs_report", "ot_plan_no_report", "ot_report_no_plan", "ot_hours_after_no_ot", "ot_dm_no_plan_or_report", "ot_employee_not_roster", "ot_rest_day_premium", "ot_plan_cancelled", "ot_not_in_plan"].forEach((id) => {
      assert.ok(ids.includes(id), id);
    });
    const key = ctx.payAuditItemKey("ot_not_in_plan", "e9", "2026-11-05");
    const reviewed = ctx.payAuditRun({
      from: "2026-11-05", to: "2026-11-11",
      reviews: { [key]: { reviewed: true, note: "Called in after the plan", by: "HR", at: "2026-11-06T01:00:00.000Z" } },
    });
    const row = reviewed.find((c) => c.id === "ot_not_in_plan").rows[0];
    assert.equal(row.review.note, "Called in after the plan");
    assert.equal(ctx.S.otreqs.old.formUrl, "https://drive.google.com/file/d/OLD/view");
  });
});
