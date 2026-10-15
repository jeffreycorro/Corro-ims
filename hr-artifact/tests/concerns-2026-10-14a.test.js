"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  let start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  if (src.slice(start - 6, start) === "async ") start -= 6;
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

function loadPay() {
  const names = [
    "paySiteName",
    "payLineSum",
    "paySiteGroups",
    "payDedParts",
    "payBySiteHtml",
    "payDeductionHtml",
    "payDeductionPaper",
    "payCsvRows",
  ];
  const ctx = {
    esc(s) {
      return String(s == null ? "" : s);
    },
    num(n, d) {
      return (Number(n) || 0).toFixed(d == null ? 2 : d);
    },
    peso(n) {
      return "₱" + (Number(n) || 0).toFixed(2);
    },
    pfBand(t) {
      return '<div class="pf-band">' + ctx.esc(t) + "</div>";
    },
    flipName(n) {
      return String(n || "");
    },
    otPendingText(h) {
      return "OT pending: " + h;
    },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function loadOt() {
  const names = [
    "isEphemeralUrl",
    "durableDriveUrl",
    "otFileKey",
    "otFormFiles",
    "otFormUrl",
    "otApplyForms",
    "otSiteKey",
    "clockMinutes",
    "otHoursFromClock",
    "otPersonSite",
    "otSiteRoster",
    "otDurationText",
    "mergeOtRequest",
    "otReqNeedsRepair",
    "otRequestCovers",
    "otCovered",
    "otApprovedHours",
    "otHoursAllowed",
    "otPendingApplies",
    "otPaidHours",
  ];
  const ctx = {
    TODAY: "2026-10-14",
    S: { employees: {}, daily: {}, otreqs: {}, settings: { otPolicy: 1 } },
    num(n, d) {
      return (Number(n) || 0).toFixed(d == null ? 2 : d);
    },
    atWork() {
      return Object.values(ctx.S.employees).filter((e) => e && e.status !== "Separated");
    },
    dailyGet(d) {
      return ctx.S.daily[d] || null;
    },
    dailySiteOf(rec, e) {
      const row = rec && rec.rows && rec.rows[e.id];
      return (row && row.site) || e.project || "";
    },
    lastSiteBefore(id, date) {
      const rows = ctx.S._sites && ctx.S._sites[id];
      if (!rows) return "";
      let site = "";
      rows.forEach((pair) => {
        if (pair[0] < date) site = pair[1];
      });
      return site;
    },
    addDays(d, n) {
      const t = new Date(d + "T00:00:00");
      t.setDate(t.getDate() + n);
      const m = String(t.getMonth() + 1).padStart(2, "0");
      const day = String(t.getDate()).padStart(2, "0");
      return t.getFullYear() + "-" + m + "-" + day;
    },
    cmpEmpAlpha(a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

const LINES = [
  {
    empId: "a", empNo: "1", name: "One", position: "Labor", site: "Banawa",
    daily: 500, hourly: 62.5, days: 6, ot: 2, hol30: 0, hol100: 0, holPay: 0,
    gross: 3300, late: 40, ca: 100, uniform: 0, sssLoan: 50, hdmfLoan: 0,
    sss: 162.5, phic: 65.62, hdmf: 50, ded: 468.12, net: 2832,
  },
  {
    empId: "b", empNo: "2", name: "Two", position: "Labor", site: "Banawa",
    daily: 500, hourly: 62.5, days: 5, ot: 0, hol30: 0, hol100: 0, holPay: 0,
    gross: 2500, late: 0, ca: 0, uniform: 20, sssLoan: 0, hdmfLoan: 10,
    sss: 162.5, phic: 65.62, hdmf: 50, ded: 308.12, net: 2192,
  },
  {
    empId: "c", empNo: "3", name: "Three", position: "Labor", site: "Danlag",
    daily: 520, hourly: 65, days: 6, ot: 3, hol30: 0, hol100: 0, holPay: 0,
    gross: 3315, late: 15, ca: 200, uniform: 0, sssLoan: 0, hdmfLoan: 0,
    sss: 162.5, phic: 65.62, hdmf: 50, ded: 493.12, net: 2822,
  },
];

describe("2026-10-14a payroll by site, deduction total, and OT duration", () => {
  it("is build 2026-10-14a and keeps the site filter, group control, and pipeline stages", () => {
    assert.match(html, /const BUILD = "2026-10-15a"/);
    const view = extractFunction(html, "viewPayrollRun");
    assert.match(view, /id="pay-site"/);
    assert.match(view, /id="pay-group"/);
    assert.match(view, /Group by site/);
    assert.match(view, /payBySiteHtml/);
    assert.match(view, /payDeductionHtml/);
    assert.match(view, /Total deducted/);
    assert.match(view, /one list, every site/);
    const dedAt = view.indexOf("payDeductionHtml");
    const btnAt = view.indexOf('id="pay-print"');
    const groupAt = view.indexOf('id="pay-group"');
    const siteAt = view.indexOf("payBySiteHtml");
    const namesAt = view.indexOf("data-payrow");
    assert.ok(dedAt > 0 && dedAt < btnAt, "deduction breakdown sits with the summary cards");
    assert.ok(groupAt < siteAt && siteAt < namesAt, "site totals sit under Group by site, above the employee rows");
    assert.match(view, /data-paysub/);
    assert.match(view, /data-paysiteband/);
    const paper = extractFunction(html, "payPaper");
    assert.match(paper, /Total deductions/);
    assert.match(paper, /payDeductionPaper/);
    assert.match(paper, /GRAND TOTAL/);
    const dedPaper = extractFunction(html, "payDeductionPaper");
    assert.match(dedPaper, /DEDUCTION TOTAL/);
    assert.match(dedPaper, /TOTAL DEDUCTED/);
    assert.match(
      html,
      /const STAGES=\["Applied","Screening","Shortlisted","On Hold","Written Exam","Interview","Background Check","Final Interview","Offer","Hired","Rejected"\]/
    );
  });

  it("sums each deduction and shows per-site money totals plus a grand total", () => {
    const ctx = loadPay();
    const groups = ctx.paySiteGroups(LINES);
    assert.equal(groups.map((g) => g.site).join("|"), "Banawa|Danlag");
    assert.equal(groups[0].T.n, 2);
    assert.equal(groups[0].T.days, 11);
    assert.equal(groups[0].T.ot, 2);
    assert.equal(groups[0].T.gross, 5800);
    assert.equal(groups[0].T.late, 40);
    assert.equal(groups[0].T.ca, 100);
    assert.equal(groups[0].T.uniform, 20);
    assert.equal(groups[0].T.sssLoan, 50);
    assert.equal(groups[0].T.hdmfLoan, 10);
    assert.equal(groups[0].T.ded, 776.24);
    const all = ctx.payLineSum(LINES);
    assert.equal(all.n, 3);
    assert.equal(all.ot, 5);
    assert.equal(all.late, 55);
    assert.equal(all.ca, 300);
    const parts = ctx.payDedParts(all, "weekly");
    assert.equal(parts.find((p) => p[2] === "late")[1], 55);
    assert.equal(parts.find((p) => p[2] === "hdmf")[0], "Pag-IBIG");
    assert.equal(ctx.payDedParts(all, "semi").find((p) => p[2] === "hdmf")[0], "HMIC");

    const siteHtml = ctx.payBySiteHtml(groups, all, "weekly");
    assert.match(siteHtml, /id="pay-by-site"/);
    assert.match(siteHtml, /data-paysite="Banawa"/);
    assert.match(siteHtml, /data-paysite="Danlag"/);
    assert.match(siteHtml, /data-paygrand="1"/);
    assert.match(siteHtml, /Grand total/);
    assert.match(siteHtml, /Total deductions/);

    const dedHtml = ctx.payDeductionHtml(all, "weekly", "");
    assert.match(dedHtml, /id="pay-ded-total"/);
    assert.match(dedHtml, /data-payded="late"/);
    assert.match(dedHtml, /data-payded="ca"/);
    assert.match(dedHtml, /data-payded="sss"/);
    assert.match(dedHtml, /data-payded="phic"/);
    assert.match(dedHtml, /data-payded="hdmf"/);
    assert.match(dedHtml, /data-payded="total"/);
    assert.match(dedHtml, /Total deducted/);

    const paper = ctx.payDeductionPaper(groups[0].T, "weekly");
    assert.match(paper, /DEDUCTION TOTAL/);
    assert.match(paper, /TOTAL DEDUCTED/);
    assert.match(paper, /Cash advance/);
  });

  it("puts site subtotals, the grand total, and the deduction breakdown in the CSV", () => {
    const ctx = loadPay();
    const groups = ctx.paySiteGroups(LINES);
    const all = ctx.payLineSum(LINES);
    const rows = ctx.payCsvRows("weekly", LINES, all, groups);
    const head = rows[0];
    const lateCol = head.indexOf("Late/Undertime");
    const dedCol = head.indexOf("Total deductions");
    const netCol = head.indexOf("NET PAY");
    assert.ok(lateCol > 0 && dedCol > lateCol && netCol > dedCol);
    const banawa = rows.find((r) => r[1] === "Banawa subtotal");
    assert.ok(banawa, "site subtotal row");
    assert.equal(banawa[head.indexOf("Days")], 11);
    assert.equal(banawa[head.indexOf("OT hrs")], 2);
    assert.equal(banawa[lateCol], "40.00");
    assert.equal(banawa[head.indexOf("Cash advance")], "100.00");
    assert.equal(banawa[head.indexOf("Uniform/Others")], "20.00");
    assert.equal(banawa[head.indexOf("SSS loan")], "50.00");
    assert.equal(banawa[dedCol], "776.24");
    const grand = rows.find((r) => r[1] === "GRAND TOTAL");
    assert.equal(grand[head.indexOf("Days")], 17);
    assert.equal(grand[lateCol], "55.00");
    assert.equal(grand[head.indexOf("Cash advance")], "300.00");
    assert.equal(rows[rows.length - 1][0], "TOTAL DEDUCTED");
    assert.equal(rows[rows.length - 1][1], all.ded.toFixed(2));
    assert.ok(rows.some((r) => r[0] === "Late" && r[1] === "55.00"));
  });

  it("lists active people at the site and stores hours or a from–to duration", () => {
    const editor = extractFunction(html, "openOtEditor");
    assert.match(editor, /id="ot-esite"/);
    assert.match(editor, /id="ot-whole"/);
    assert.match(editor, /Whole site on those dates/);
    assert.match(editor, /Employees on OT/);
    assert.match(editor, /id="ot-hours"/);
    assert.match(editor, /id="ot-t1"/);
    assert.match(editor, /id="ot-t2"/);
    assert.match(editor, /OT duration/);
    assert.match(editor, /otSiteRoster/);
    assert.match(editor, /hoursEach: hoursNum/);
    assert.match(editor, /timeFrom: timeFrom/);
    assert.match(editor, /timeTo: timeTo/);
    assert.match(editor, /empIds: Array\.from\(picked\)/);
    assert.match(editor, /wholeSite: !\(pre&&pre\.empId\)/);
    assert.ok(editor.indexOf("Employees on OT") < editor.indexOf('id="ot-hours"'));
    assert.doesNotMatch(editor, /wrap\.style\.display/);
    assert.match(html, /Not paid until an approved form is on file/);

    const ctx = loadOt();
    assert.equal(ctx.otHoursFromClock("17:00", "19:30"), 2.5);
    assert.equal(ctx.otHoursFromClock("22:00", "01:00"), 3);
    assert.equal(ctx.otHoursFromClock("17:00", "17:00"), null);
    assert.equal(ctx.otHoursFromClock("", "19:00"), null);
    assert.equal(ctx.otDurationText({ hoursEach: 2, timeFrom: "17:00", timeTo: "19:00" }), "17:00–19:00 · 2.0 h");
    assert.equal(ctx.otDurationText({ hoursEach: "", timeFrom: "", timeTo: "" }), "—");

    ctx.S.employees = {
      e1: { id: "e1", empNo: "10", name: "Abrea, Ana", status: "Project-based", project: "Danlag" },
      e2: { id: "e2", empNo: "11", name: "Baja, Ben", status: "", project: "Danlag" },
      e3: { id: "e3", empNo: "12", name: "Cruz, Cara", status: "Regular", project: "Banawa" },
      e4: { id: "e4", empNo: "13", name: "Diaz, Dan", status: "Separated", project: "Danlag" },
      e5: { id: "e5", empNo: "14", name: "Eva, Site", status: "Active", project: "ADMINS" },
    };
    ctx.S.daily["2026-10-14"] = {
      date: "2026-10-14",
      rows: { e5: { site: "Danlag" } },
    };
    assert.equal(ctx.otSiteRoster("", "2026-10-14").length, 0);
    const ids = ctx.otSiteRoster("Danlag", "2026-10-14").map((e) => e.id);
    assert.deepEqual(ids, ["e1", "e2", "e5"]);
    assert.equal(ctx.otSiteRoster("DANAO  SPLPA", "2026-10-14").length, 0);
    ctx.S.employees.e2.project = "Danao-SPLPA";
    assert.deepEqual(ctx.otSiteRoster("DANAO  SPLPA", "2026-10-14").map((e) => e.id), ["e2"]);
  });

  it("keeps approved-form gating and does not drop a saved duration", () => {
    const ctx = loadOt();
    const FORM = "https://drive.google.com/file/d/OTFORM1/view";
    ctx.S.otreqs = {
      ot1: {
        id: "ot1", from: "2026-10-14", to: "2026-10-14", site: "Danlag",
        wholeSite: true, empIds: ["e1"], status: "Approved", formUrl: FORM,
        hoursEach: 2, timeFrom: "17:00", timeTo: "19:00",
      },
    };
    assert.equal(ctx.otCovered("e9", "2026-10-14", "Danlag"), true);
    assert.equal(ctx.otCovered("e9", "2026-10-14", "Banawa"), false);
    assert.equal(ctx.otPaidHours("e9", "2026-10-14", "Danlag", 3, "2026-10-14"), 3);
    assert.equal(ctx.otApprovedHours("e9", "2026-10-14", "Danlag"), 2);
    ctx.S.otreqs.ot1 = Object.assign({}, ctx.S.otreqs.ot1, { wholeSite: false, empIds: ["e1"] });
    assert.equal(ctx.otCovered("e1", "2026-10-14", "Danlag"), true);
    assert.equal(ctx.otCovered("e2", "2026-10-14", "Danlag"), false);
    ctx.S.otreqs.ot1 = Object.assign({}, ctx.S.otreqs.ot1, { status: "Filed" });
    assert.equal(ctx.otCovered("e1", "2026-10-14", "Danlag"), false);
    assert.equal(ctx.otPaidHours("e1", "2026-10-14", "Danlag", 3, "2026-10-14"), 0);
    assert.equal(ctx.otHoursAllowed("e1", "2026-10-14", "Danlag", null, 4), 4);
    assert.equal(ctx.otPaidHours("e1", "2026-09-30", "Danlag", 3, "2026-09-30"), 3);

    const local = {
      id: "ot1", from: "2026-10-14", to: "2026-10-14", site: "Danlag",
      wholeSite: false, empIds: ["e1", "e5"], status: "Filed", formUrl: FORM,
      hoursEach: 2.5, timeFrom: "17:00", timeTo: "19:30", reason: "pour",
    };
    const incoming = {
      id: "ot1", from: "", to: "", site: "", status: "", formUrl: "",
      empIds: [], hoursEach: "", timeFrom: "", timeTo: "", reason: "",
    };
    const next = ctx.mergeOtRequest(local, incoming);
    assert.equal(next.hoursEach, 2.5);
    assert.equal(next.timeFrom, "17:00");
    assert.equal(next.timeTo, "19:30");
    assert.deepEqual(Array.from(next.empIds), ["e1", "e5"]);
    assert.equal(ctx.otReqNeedsRepair(local, incoming), true);
    const kept = ctx.mergeOtRequest(local, Object.assign({}, local));
    assert.equal(kept.timeFrom, "17:00");
    assert.equal(ctx.otReqNeedsRepair(local, local), false);
  });
});
