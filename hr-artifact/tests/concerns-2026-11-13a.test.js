"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "../public");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const forms = fs.readFileSync(path.join(root, "hr-ot-forms.js"), "utf8");
const sheet = fs.readFileSync(path.join(root, "hr-payroll-sheet.js"), "utf8");

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

function loadForms(extra) {
  const ctx = Object.assign(
    {
      S: { employees: {}, daily: {}, otplans: {}, otreps: {}, otreqs: {}, settings: {}, payruns: {} },
    },
    extra || {}
  );
  vm.runInNewContext(forms, ctx);
  return ctx;
}

function person(id, name, empNo) {
  return { id: id, name: name, empNo: empNo || "" };
}

const WIN = { from: "2026-11-05", to: "2026-11-11" };

describe("2026-11-13a several employees on one OT form, and the late count", () => {
  it("offers search, multi-select, and remove on both forms in build 2026-11-13b", () => {
    assert.match(html, /const BUILD = "2026-11-14a"/);
    const plan = extractFunction(html, "openOtPlanEditor");
    const report = extractFunction(html, "openOtReportEditor");
    assert.match(plan, /otCrewSearchHtml\("otp"\)/);
    assert.match(plan, /wireOtCrew\("otp"/);
    assert.match(plan, /Add employee/);
    assert.match(plan, /data-otp-rm/);
    assert.match(plan, /hrOtAppendEmployees/);
    assert.match(report, /otCrewSearchHtml\("otr"\)/);
    assert.match(report, /wireOtCrew\("otr"/);
    assert.match(report, /data-otr-rm/);
    assert.match(report, /Not on the plan/);
    const crew = extractFunction(html, "otCrewSearchHtml") + extractFunction(html, "wireOtCrew");
    assert.match(crew, /id="'\+prefix\+'-find"/);
    assert.match(crew, /Add selected/);
    assert.match(crew, /data-otpick/);
    assert.match(crew, /Add employee/);
    assert.match(extractFunction(html, "viewDaily"), /time in after 8:15 or 1:15/);
    assert.match(extractFunction(html, "viewDaily"), /lateBySite/);
    const printed = extractFunction(html, "printDaily");
    assert.match(printed, /Late employees/);
    assert.match(printed, /dailyLateHeadcount/);
    assert.match(printed, /blockCompanyPrint\(\["cassie"\]\)/);
  });

  it("opens a saved one-employee record as one row and does not rewrite it", () => {
    const ctx = loadForms();
    const legacy = {
      id: "p1", otDate: "2026-11-05", site: "Banawa", deptHead: "Luzano",
      empId: "e1", empNo: "10", name: "Santos, Ben", task: "Roof", reason: "Deadline", expectedHours: 4,
    };
    const before = JSON.stringify(legacy);
    const rows = ctx.hrOtRowsOf(legacy);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].empId, "e1");
    assert.equal(rows[0].task, "Roof");
    assert.equal(rows[0].expectedHours, 4);
    assert.equal(JSON.stringify(legacy), before);
    assert.equal(legacy.rows, undefined);

    const single = { rows: [{ empId: "e1", task: "Roof", reason: "Deadline", expectedHours: 3 }] };
    const singleBefore = JSON.stringify(single);
    assert.equal(ctx.hrOtRowsOf(single)[0].expectedHours, 3);
    assert.equal(JSON.stringify(single), singleBefore);

    const added = ctx.hrOtAppendEmployees(rows, ["e2", "e1", "", "e3"], {
      task: "", reason: "", expectedHours: "", timeFrom: "", timeTo: "", noOt: false, proof: [],
    });
    assert.equal(added.map((r) => r.empId).join(","), "e1,e2,e3");
    assert.equal(rows.length, 1);
    assert.notEqual(added[1].proof, added[2].proof);
    assert.equal(JSON.stringify(legacy), before);
  });

  it("checks each person on one plan and one report, and does not change pay", () => {
    const ctx = loadForms();
    ctx.S.employees.e1 = person("e1", "Santos, Ben", "10");
    ctx.S.employees.e2 = person("e2", "Cruz, Ana", "11");
    ctx.S.employees.e9 = person("e9", "Reyes, Joy", "19");
    ctx.S.otplans.p1 = {
      id: "p1", otDate: "2026-11-10", site: "Banawa", deptHead: "Luzano",
      rows: [
        { empId: "e1", name: "Santos, Ben", task: "Roof", reason: "Deadline", expectedHours: 4 },
        { empId: "e2", name: "Cruz, Ana", task: "Haul", reason: "Deadline", expectedHours: 2 },
      ],
    };
    const planOk = ctx.hrOtValidatePlan(ctx.S.otplans.p1, ctx);
    assert.equal(planOk.ok, true);
    assert.equal(ctx.S.otplans.p1.rows.length, 2);

    const missing = ctx.hrOtValidateReport({
      planId: "p1", otDate: "2026-11-10", reportDate: "2026-11-11",
      rows: [
        { empId: "e1", hours: 3, description: "Roof done" },
        { empId: "e2", hours: 2, description: "Hauled" },
        { empId: "e9", hours: 1, description: "Called in" },
      ],
    }, ctx);
    assert.equal(missing.ok, false);
    assert.match(missing.errors.join(" "), /Row 3 is not on the Afternoon Plan/);

    const saved = ctx.hrOtValidateReport({
      planId: "p1", otDate: "2026-11-10", reportDate: "2026-11-11",
      rows: [
        { empId: "e1", hours: 3, description: "Roof done" },
        { empId: "e2", hours: 2, description: "Hauled" },
        { empId: "e9", hours: 1, description: "Called in", notInPlanReason: "Sent after the plan was signed" },
      ],
    }, ctx);
    assert.equal(saved.ok, true);
    assert.equal(saved.report.rows[2].notInPlan, true);
    ctx.S.otreps.r1 = saved.report;
    ctx.S.otreps.r1.id = "r1";
    ctx.S.daily.d20261110 = {
      date: "2026-11-10",
      rows: {
        e1: { ot: 0, site: "Banawa" },
        e2: { ot: 2, site: "Banawa" },
        e9: { ot: 0, site: "Banawa" },
      },
    };
    const payrun = { status: "draft", lines: { e1: { ot: 0, late: 15, lateTouched: true, ca: 40, caTouched: true } } };
    const beforeDaily = JSON.stringify(ctx.S.daily);
    const beforeRun = JSON.stringify(payrun);
    const beforePlan = JSON.stringify(ctx.S.otplans.p1);
    const report = ctx.hrOtAuditRun(Object.assign({ S: ctx.S }, WIN));
    assert.equal(JSON.stringify(ctx.S.daily), beforeDaily);
    assert.equal(JSON.stringify(payrun), beforeRun);
    assert.equal(JSON.stringify(ctx.S.otplans.p1), beforePlan);
    assert.equal(ctx.S.daily.d20261110.rows.e1.ot, 0);
    assert.equal(ctx.S.daily.d20261110.rows.e2.ot, 2);
    assert.equal(payrun.status, "draft");
    assert.equal(payrun.lines.e1.lateTouched, true);
    assert.equal(payrun.lines.e1.caTouched, true);

    const extra = report.find((c) => c.id === "ot_not_in_plan");
    assert.equal(extra.rows.length, 1);
    assert.equal(extra.rows[0].empId, "e9");
    assert.match(extra.rows[0].details, /does not block pay/);
    const diff = report.find((c) => c.id === "ot_dm_differs_report");
    assert.equal(diff.rows.map((r) => r.empId).sort().join(","), "e1,e9");
    assert.equal(diff.rows.some((r) => r.empId === "e2"), false);

    const days = ctx.hrOtZeroDmDays("2026-11-05", "2026-11-11", ctx);
    assert.equal(days.length, 1);
    assert.equal(days[0].date, "2026-11-10");
    assert.equal(days[0].people.map((p) => p.empId).sort().join(","), "e1,e9");
    assert.equal(days[0].people.find((p) => p.empId === "e2"), undefined);
    const warn = ctx.hrOtZeroDmWarningHtml("2026-11-05", "2026-11-11", ctx);
    assert.match(warn, /Santos, Ben/);
    assert.match(warn, /Reyes, Joy/);
    assert.doesNotMatch(warn, /Cruz, Ana/);
    assert.match(warn, /not blocked/i);
    assert.match(warn, /Payroll pays the Daily Manpower OT number/);
    assert.equal(JSON.stringify(ctx.S.daily), beforeDaily);

    const names = ["otFormGateWaived", "otPendingApplies", "otPaidHours", "otCovered"];
    vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
    ctx.S.settings.otFormGateWaived = true;
    assert.equal(ctx.otPaidHours("e1", "2026-11-10", "Banawa", 0, "2026-11-11"), 0);
    assert.equal(ctx.otPaidHours("e2", "2026-11-10", "Banawa", 2, "2026-11-11"), 2);
    assert.equal(ctx.S.daily.d20261110.rows.e1.ot, 0);
    assert.equal(payrun.lines.e1.ca, 40);
  });

  it("still reads a one-employee plan that has no rows array", () => {
    const ctx = loadForms();
    ctx.S.employees.e1 = person("e1", "Dugaduga, Ronnie", "20");
    const stored = {
      id: "old", otDate: "2026-11-06", site: "Banawa", deptHead: "Luzano",
      empId: "e1", name: "Dugaduga, Ronnie", task: "Roof", reason: "Subcon", expectedHours: 5,
    };
    const snap = JSON.stringify(stored);
    ctx.S.otplans.old = stored;
    const checked = ctx.hrOtValidatePlan(stored, ctx);
    assert.equal(checked.ok, true);
    assert.equal(stored.rows, undefined);
    assert.equal(JSON.stringify(stored), snap);
    const report = ctx.hrOtAuditRun(Object.assign({ S: ctx.S }, WIN));
    const missing = report.find((c) => c.id === "ot_plan_no_report");
    assert.equal(missing.rows.length, 1);
    assert.equal(missing.rows[0].empId, "e1");
    assert.equal(JSON.stringify(stored), snap);
    const days = ctx.hrOtZeroDmDays("2026-11-05", "2026-11-11", ctx);
    assert.equal(days[0].people[0].empId, "e1");
    assert.equal(days[0].people[0].formHours, 5);
  });
});

describe("2026-11-13a Daily Manpower late headcount", () => {
  function loadLate() {
    const ctx = {
      S: { employees: {} },
      rowExcused(r) {
        if (!r || r.ex == null || r.ex === "") return null;
        return Number(r.ex) === 1;
      },
      beforeRehire() { return false; },
      dailyGroups(rec) {
        const by = {};
        Object.keys((rec && rec.rows) || {}).forEach((id) => {
          const e = ctx.S.employees[id];
          if (!e) return;
          const site = (rec.rows[id] && rec.rows[id].site) || "";
          if (!by[site]) by[site] = [];
          by[site].push(e);
        });
        return Object.keys(by).sort().map((site) => ({ site: site, people: by[site] }));
      },
      dailyRow(rec, e) {
        return (rec.rows || {})[e.id] || {};
      },
    };
    vm.runInNewContext(sheet, ctx);
    vm.runInNewContext(
      ["dayCountsLate", "dailyPersonIsLate", "dailyLateHeadcount"].map((n) => extractFunction(html, n)).join("\n"),
      ctx
    );
    return ctx;
  }

  it("counts time-in lates per site and in total, and does not write the day", () => {
    const ctx = loadLate();
    ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"].forEach((id, i) => {
      ctx.S.employees[id] = { id: id, name: "Person " + id, empNo: String(i + 1) };
    });
    const rec = {
      id: "d20261112",
      date: "2026-11-12",
      rows: {
        e1: { s: "Present", in: "8:16 AM", out: "5:00 PM", site: "Banawa", ot: 2, day: 1 },
        e2: { s: "Present", in: "8:15 AM", out: "5:00 PM", site: "Banawa", ot: 0, day: 1 },
        e3: { s: "Absent", in: "9:00 AM", site: "Banawa", ot: 0, day: 0 },
        e4: { s: "Present", in: "1:16 PM", out: "5:00 PM", site: "Tawason", ot: 1, day: 1 },
        e5: { s: "Present", in: "1:15 PM", out: "5:00 PM", site: "Tawason", day: 1 },
        e6: { s: "Present/Late", in: "8:40 AM", out: "5:00 PM", site: "Tawason", ex: 1, day: 1 },
        e7: { s: "Undertime", in: "8:00 AM", out: "4:00 PM", site: "Tawason", day: 1 },
        e8: { s: "Present/Late", in: "8:00 AM", out: "5:00 PM", site: "Banawa", day: 1, ot: 0 },
      },
    };
    const snap = JSON.stringify(rec);
    assert.equal(ctx.dailyPersonIsLate(rec.rows.e1), true);
    assert.equal(ctx.dailyPersonIsLate(rec.rows.e2), false);
    assert.equal(ctx.dailyPersonIsLate(rec.rows.e3), false);
    assert.equal(ctx.dailyPersonIsLate(rec.rows.e4), true);
    assert.equal(ctx.dailyPersonIsLate(rec.rows.e5), false);
    assert.equal(ctx.dailyPersonIsLate(rec.rows.e6), false);
    assert.equal(ctx.dailyPersonIsLate(rec.rows.e7), false);
    assert.equal(ctx.dailyPersonIsLate(rec.rows.e8), false);
    const got = ctx.dailyLateHeadcount(rec);
    assert.equal(got.total, 2);
    const banawa = got.sites.find((s) => s.site === "Banawa");
    const tawason = got.sites.find((s) => s.site === "Tawason");
    assert.equal(banawa.late, 1);
    assert.equal(tawason.late, 1);
    assert.equal(JSON.stringify(rec), snap);
    assert.equal(rec.rows.e1.ot, 2);
    assert.equal(rec.rows.e8.s, "Present/Late");
  });
});
