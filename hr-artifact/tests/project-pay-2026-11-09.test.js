"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "../public");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const src = fs.readFileSync(path.join(root, "hr-project-pay.js"), "utf8");
const sheetSrc = fs.readFileSync(path.join(root, "hr-payroll-sheet.js"), "utf8");

function load() {
  const ctx = { console: console, TextEncoder: TextEncoder, Uint8Array: Uint8Array, Uint32Array: Uint32Array };
  vm.runInNewContext(src, ctx);
  return ctx;
}

const ADMIN = { role: "admin", email: "jeffreycorro@corroconstruction.com", department: "admin" };
const HR = { role: "hr", email: "hr@corroconstruction.com", department: "hr" };
const STAFF = { role: "staff", email: "staff@corroconstruction.com", department: "site" };

function lineTwoSites() {
  return {
    empId: "e1",
    empNo: "1278",
    name: "Kiamco, Jophil",
    site: "Tawason",
    daily: 500,
    hourly: 62.5,
    days: 4,
    ot: 2,
    otPay: 125,
    holPay: 0,
    allowance: 0,
    incentive: 0,
    basic: 2000,
    gross: 2125,
    late: 10,
    ca: 40,
    uniform: 20,
    sss: 100,
    phic: 0,
    hdmf: 0,
    sssLoan: 0,
    hdmfLoan: 0,
    ded: 170,
    net: 1955,
    rows: [
      { date: "2026-11-02", site: "Tagba-o", day: 1, ot: 2, lateMin: 10, in: "8:10 AM", out: "5:00 PM" },
      { date: "2026-11-03", site: "Tagba-o", day: 1, ot: 0, lateMin: 0, in: "8:00 AM", out: "5:00 PM" },
      { date: "2026-11-04", site: "Tawason", day: 1, ot: 0, lateMin: 0, in: "8:00 AM", out: "5:00 PM" },
      { date: "2026-11-05", site: "Tawason", day: 1, ot: 0, lateMin: 0, in: "8:00 AM", out: "5:00 PM" }
    ]
  };
}

describe("2026-11-09a project assignment and payroll summary", () => {
  it("is build 2026-11-09a and keeps the project summary on the payroll run", () => {
    assert.match(html, /const BUILD = "2026-11-14a"/);
    const flowAt = html.indexOf("payRunFlowHtml(saved");
    const auditAt = html.indexOf("h+=payAuditHtml");
    const projAt = html.indexOf("payProjectSummaryCard");
    assert.ok(flowAt > 0 && auditAt > flowAt && projAt > auditAt, "approval flags, then the review list, then the project summary");
    assert.match(html, /<script src="\/hr-project-pay\.js"><\/script>/);
    assert.match(html, /id="dm-assign"/);
    assert.match(html, /dailyProjectSelectHtml/);
    assert.match(html, /payProjectSummaryCard/);
    assert.match(src, /id="pay-by-project"/);
    assert.match(html, /id="pay-submit"/);
    assert.match(html, /id="pay-finalize"/);
    assert.match(html, /id="pay-return"/);
    assert.match(src, /weekly\|2026-10-29/);
  });

  it("charges basic, OT, and late to the day’s site and splits period deductions by man-days", () => {
    const ctx = load();
    const line = lineTwoSites();
    const before = JSON.stringify(line);
    const summary = ctx.payProjectSummary([line], { otPolicy: 1 });
    assert.equal(JSON.stringify(line), before, "summary does not rewrite the line");
    const tag = summary.sites.find((s) => s.site === "Tagba-o");
    const taw = summary.sites.find((s) => s.site === "Tawason");
    assert.ok(tag && taw);
    assert.equal(tag.days, 2);
    assert.equal(taw.days, 2);
    assert.equal(tag.basic, 1000);
    assert.equal(taw.basic, 1000);
    assert.equal(tag.ot, 2);
    assert.equal(taw.ot, 0);
    assert.equal(tag.otPay, 125);
    assert.equal(taw.otPay, 0);
    assert.equal(tag.late, 10);
    assert.equal(taw.late, 0);
    assert.equal(tag.other, 80);
    assert.equal(taw.other, 80);
    assert.equal(summary.totals.days, line.days);
    assert.equal(summary.totals.basic, line.basic);
    assert.equal(summary.totals.ot, line.ot);
    assert.equal(summary.totals.otPay, line.otPay);
    assert.equal(summary.totals.gross, line.gross);
    assert.equal(summary.totals.late, line.late);
    assert.equal(summary.totals.other, line.ded - line.late);
    assert.equal(summary.totals.ded, line.ded);
    assert.equal(summary.totals.net, line.net);
    assert.equal(summary.totals.headcount, 1);
    assert.equal(tag.headcount, 1);
    assert.equal(taw.headcount, 1);
  });

  it("reconciles two people to the payroll totals, including a 3-to-1 government split", () => {
    const ctx = load();
    const a = lineTwoSites();
    const b = {
      empId: "e2", empNo: "1250", name: "Santos, Ben", site: "Danlag",
      daily: 400, hourly: 50, days: 4, ot: 0, otPay: 0, holPay: 0,
      allowance: 0, incentive: 0, basic: 1600, gross: 1600,
      late: 0, ca: 0, uniform: 0, sss: 100, phic: 0, hdmf: 0, sssLoan: 0, hdmfLoan: 0,
      ded: 100, net: 1500,
      rows: [
        { date: "2026-11-02", site: "Danlag", day: 1, ot: 0, lateMin: 0 },
        { date: "2026-11-03", site: "Danlag", day: 1, ot: 0, lateMin: 0 },
        { date: "2026-11-04", site: "Danlag", day: 1, ot: 0, lateMin: 0 },
        { date: "2026-11-05", site: "Balaga", day: 1, ot: 0, lateMin: 0 }
      ]
    };
    const summary = ctx.payProjectSummary([a, b], { otPolicy: 1 });
    const dan = summary.sites.find((s) => s.site === "Danlag");
    const bal = summary.sites.find((s) => s.site === "Balaga");
    assert.equal(dan.days, 3);
    assert.equal(bal.days, 1);
    assert.equal(dan.basic, 1200);
    assert.equal(bal.basic, 400);
    assert.equal(dan.other, 75);
    assert.equal(bal.other, 25);
    assert.equal(summary.totals.headcount, 2);
    assert.equal(summary.totals.days, 8);
    assert.equal(summary.totals.basic, 3600);
    assert.equal(summary.totals.gross, 3725);
    assert.equal(summary.totals.late, 10);
    assert.equal(summary.totals.other, 260);
    assert.equal(summary.totals.net, 3455);
    const csv = ctx.payProjectSummaryCsv(summary);
    assert.equal(csv[0][0], "Site");
    assert.ok(csv.some((r) => r[0] === "Danlag" && r[2] === 3));
    assert.match(csv[csv.length - 1][1], /man-days/);
  });

  it("keeps an unticked alias as its own site, and a confirmed alias without rewriting the row", () => {
    const ctx = load();
    const line = {
      empId: "e9", days: 3, ot: 0, otPay: 0, basic: 1500, holPay: 0, gross: 1500,
      late: 0, ca: 0, uniform: 0, sss: 0, phic: 0, hdmf: 0, sssLoan: 0, hdmfLoan: 0,
      ded: 0, net: 1500, daily: 500, hourly: 62.5,
      rows: [
        { date: "2026-11-02", site: "ADMINS", day: 1, ot: 0 },
        { date: "2026-11-03", site: "Admins 2", day: 1, ot: 0 },
        { date: "2026-11-04", site: "", day: 1, ot: 0 }
      ]
    };
    const before = JSON.stringify(line);
    const open = ctx.payProjectSummary([line], {});
    assert.equal(open.sites.map((s) => s.site).join("|"), "ADMINS|Admins 2|Unassigned");
    assert.equal(open.sites.find((s) => s.site === "ADMINS").days, 1);
    assert.equal(open.sites.find((s) => s.site === "Admins 2").days, 1);
    assert.equal(open.sites.find((s) => s.site === "Unassigned").days, 1);
    assert.equal(JSON.stringify(line), before);
    const confirmed = ctx.payProjectSummary([line], { confirmed: { "admins 2": true } });
    assert.equal(confirmed.sites.find((s) => s.site === "ADMINS").days, 2);
    assert.equal(confirmed.sites.find((s) => s.site === "Admins 2"), undefined);
    assert.equal(confirmed.sites.find((s) => s.site === "Unassigned").days, 1);
    assert.equal(line.rows[1].site, "Admins 2");
  });

  it("sets a day’s site without changing the employee master project", () => {
    const ctx = load();
    const emp = { id: "e1", project: "ADMINS", name: "Santos, Ben" };
    const rec = { id: "d20261102", date: "2026-11-02", rows: { e1: { s: "Present", site: "Tagba-o", ot: 2 } } };
    const next = ctx.assignDaySite(rec, "e1", "Tawason", { by: "Cassie", at: "2026-11-09 09:00" });
    assert.equal(emp.project, "ADMINS");
    assert.equal(rec.rows.e1.site, "Tagba-o");
    assert.equal(next.rows.e1.site, "Tawason");
    assert.equal(next.rows.e1.ot, 2);
    assert.equal(next.rows.e1.siteBy, "Cassie");
    assert.equal(next.rows.e1.siteAt, "2026-11-09 09:00");
    const htmlOpts = ctx.dailyProjectSelectHtml("Tagba-o", {
      dailySites: ["Admins 2", "Tawason Yard 2"],
      employeeSites: ["Admins 2"]
    });
    assert.match(htmlOpts, /<option selected>Tagba-o<\/option>/);
    assert.match(htmlOpts, /<option>Admins 2<\/option>/);
    assert.match(htmlOpts, /<option>Tawason Yard 2<\/option>/);
    assert.match(htmlOpts, /<option value="__new">\+ new area…<\/option>/);
    assert.equal(ctx.payResolveSite("Admins 2", {}), "Admins 2");
    assert.equal(ctx.payResolveSite("Tawason Yard 2", {}), "Tawason Yard 2");
    assert.equal(ctx.payResolveSite("", {}), "Unassigned");
  });

  it("bulk-assigns a date range onto existing rows only", () => {
    const ctx = load();
    const emp = { id: "e1", project: "Danlag" };
    const days = [
      { id: "d20261102", date: "2026-11-02", rows: { e1: { s: "Present", site: "Danlag" }, e2: { s: "Present", site: "Danlag" } } },
      { id: "d20261103", date: "2026-11-03", rows: { e2: { s: "Late", site: "Danlag" } } },
      { id: "d20261104", date: "2026-11-04", rows: { e1: { s: "Present", site: "Balaga", ot: 1 } } }
    ];
    const result = ctx.bulkAssignSites(days, ["e1", "e2"], "Tawason", { by: "HR", at: "2026-11-09 10:00" });
    assert.equal(emp.project, "Danlag");
    assert.equal(days[0].rows.e1.site, "Danlag");
    assert.equal(result.days[0].rows.e1.site, "Tawason");
    assert.equal(result.days[0].rows.e2.site, "Tawason");
    assert.equal(result.days[0].rows.e1.siteBy, "HR");
    assert.equal(result.days[2].rows.e1.site, "Tawason");
    assert.equal(result.days[2].rows.e1.ot, 1);
    assert.equal(result.changed, 4);
    assert.ok(result.skipped.some((s) => s.date === "2026-11-03" && s.empId === "e1" && s.why === "not on this day"));
    assert.equal(result.days[1].rows.e2.s, "Late");
  });

  it("leaves weekly|2026-10-29 a draft and does not write a status onto it", () => {
    const ctx = load();
    const run = {
      id: "weekly|2026-10-29",
      kind: "weekly",
      from: "2026-10-29",
      to: "2026-11-04",
      lines: { e1: { late: 12, ca: 0 } },
      savedOn: "2026-10-30"
    };
    const before = JSON.stringify(run);
    assert.equal(ctx.payRunStatusOf(run), "draft");
    assert.equal(ctx.payRunLocked(run), false);
    assert.equal(ctx.payRunAllowsEdit(run), true);
    assert.equal(JSON.stringify(run), before);
    const oldFinal = { id: "weekly|2026-10-22", finalizedOn: "2026-10-28", lines: {} };
    const oldBefore = JSON.stringify(oldFinal);
    assert.equal(ctx.payRunStatusOf(oldFinal), "draft");
    assert.equal(JSON.stringify(oldFinal), oldBefore);
  });

  it("walks draft, submitted, approved, and returned with the admin gate", () => {
    const ctx = load();
    const draft = { id: "weekly|2026-11-05", kind: "weekly", from: "2026-11-05", to: "2026-11-11", lines: { e1: { late: 1 } } };
    const denied = ctx.payTransition(draft, "approve", { actor: ADMIN, now: "2026-11-09 11:00", who: "Jeffrey" });
    assert.equal(denied.ok, false);
    assert.equal(ctx.payRunStatusOf(draft), "draft");

    const submitted = ctx.payTransition(draft, "submit", { actor: HR, now: "2026-11-09 11:00", who: "hr@corroconstruction.com" });
    assert.equal(submitted.ok, true);
    assert.equal(submitted.run.status, "submitted");
    assert.equal(submitted.run.submittedBy, "hr@corroconstruction.com");
    assert.equal(submitted.run.submittedAt, "2026-11-09 11:00");
    assert.equal(ctx.payRunAllowsEdit(submitted.run), false);
    assert.equal(JSON.stringify(draft.lines), JSON.stringify(submitted.run.lines));

    const hrApprove = ctx.payTransition(submitted.run, "approve", { actor: HR, now: "2026-11-09 12:00", who: "HR" });
    assert.equal(hrApprove.ok, false);
    const staff = ctx.payTransition(submitted.run, "approve", { actor: STAFF, now: "2026-11-09 12:00", who: "Staff" });
    assert.equal(staff.ok, false);
    const noNote = ctx.payTransition(submitted.run, "return", { actor: ADMIN, now: "2026-11-09 12:00", who: "Jeffrey", note: "  " });
    assert.equal(noNote.ok, false);

    const returned = ctx.payTransition(submitted.run, "return", {
      actor: ADMIN, now: "2026-11-09 12:05", who: "jeffreycorro@corroconstruction.com", note: "Move Tuesday to Tawason"
    });
    assert.equal(returned.ok, true);
    assert.equal(returned.run.status, "draft");
    assert.equal(returned.run.returnedBy, "jeffreycorro@corroconstruction.com");
    assert.equal(returned.run.returnNote, "Move Tuesday to Tawason");
    assert.equal(ctx.payRunAllowsEdit(returned.run), true);
    assert.equal(returned.run.history.length, 2);
    assert.equal(returned.run.history[0].action, "submit");
    assert.equal(returned.run.history[1].action, "return");

    const again = ctx.payTransition(returned.run, "submit", { actor: HR, now: "2026-11-09 13:00", who: "HR" });
    const viaUnlock = ctx.payTransition(again.run, "approve", {
      actor: HR, approverUnlocked: true, now: "2026-11-09 14:00", who: "Jeffrey", snapshot: { net: 1 }
    });
    assert.equal(viaUnlock.ok, true);
    assert.equal(viaUnlock.run.status, "approved");
    assert.equal(viaUnlock.run.approvedBy, "Jeffrey");
    assert.equal(viaUnlock.run.approvedAt, "2026-11-09 14:00");
    assert.equal(ctx.payRunLocked(viaUnlock.run), true);
    assert.equal(ctx.payRunAllowsEdit(viaUnlock.run), false);
    assert.equal(viaUnlock.run.history.length, 4);
    assert.equal(viaUnlock.run.approvedSnapshot.net, 1);
    const edit = ctx.payTransition(viaUnlock.run, "submit", { actor: ADMIN, now: "2026-11-09 15:00", who: "Jeffrey" });
    assert.equal(edit.ok, false);
    assert.equal(ctx.payDateLockedByPayroll("2026-11-06", { [viaUnlock.run.id]: viaUnlock.run }), true);
    assert.equal(ctx.payDateLockedByPayroll("2026-11-12", { [viaUnlock.run.id]: viaUnlock.run }), false);
  });

  it("counts a payroll review row as open until it is marked Reviewed", () => {
    const ctx = load();
    const hidden = ctx.payOpenAuditFlags({ id: "weekly|2026-11-05" }, []);
    assert.equal(hidden, null);
    const card = ctx.payRunFlowHtml({ status: "draft", history: [] }, null);
    assert.doesNotMatch(card, /pay-audit-flags/);
    const report = [
      {
        id: "ot_paid_no_request",
        description: "Overtime is paid and no OT request covers this person.",
        severity: "review",
        count: 2,
        rows: [
          { empId: "e1", name: "Ana Santos", date: "2026-11-02", details: "Paid 2 h. No OT request.", key: "ot_paid_no_request|e1|2026-11-02" },
          { empId: "e2", name: "Ben Reyes", date: "2026-11-03", details: "Paid 1 h.", review: { reviewed: true, by: "HR" }, key: "ot_paid_no_request|e2|2026-11-03" }
        ]
      },
      {
        id: "ot_request_no_daily",
        description: "Request filed, OT not shown in time records",
        severity: "review",
        count: 1,
        rows: [
          { empId: "e3", name: "Cara Diaz", date: "2026-11-04", details: "no time out", key: "ot_request_no_daily|e3|2026-11-04" }
        ]
      }
    ];
    const flags = ctx.payOpenAuditFlags({ auditReviews: {} }, [], { report: report });
    assert.equal(flags.source, "payAuditRun");
    assert.equal(flags.count, 2);
    assert.equal(flags.checks[0].count, 1);
    assert.equal(flags.checks[1].count, 1);
    assert.equal(flags.items.length, 2);
    const shown = ctx.payRunFlowHtml({ status: "submitted", submittedBy: "HR", history: [] }, flags);
    assert.match(shown, /id="pay-audit-flags"/);
    assert.match(shown, /2 open/);
    assert.match(shown, /data-payaudit-check="ot_paid_no_request"/);
    assert.match(shown, /data-payaudit-check="ot_request_no_daily"/);
    assert.match(shown, /Ana Santos/);
    assert.match(shown, /Cara Diaz/);
    assert.doesNotMatch(shown, /Ben Reyes/);
  });

  it("writes a project workbook the payroll sheet can save", () => {
    const ctx = load();
    vm.runInNewContext(sheetSrc, ctx);
    const summary = ctx.payProjectSummary([lineTwoSites()], { otPolicy: 1 });
    const book = ctx.payProjectSummaryBook(summary);
    assert.equal(book.sheets[0].name, "By project");
    const bytes = ctx.hrPaySheet.toXlsx(book);
    assert.ok(bytes.length > 200);
    const raw = Buffer.from(bytes).toString("latin1");
    assert.match(raw, /Tagba-o/);
    assert.match(raw, /Tawason/);
    assert.match(raw, /man-days/);
  });
});
