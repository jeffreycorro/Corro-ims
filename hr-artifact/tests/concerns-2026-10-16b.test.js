"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const attendanceSrc = fs.readFileSync(path.join(__dirname, "../public/hr-attendance.js"), "utf8");
const payrollSrc = fs.readFileSync(path.join(__dirname, "../public/hr-payroll.js"), "utf8");

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

function payDates(from, to) {
  const out = [];
  let d = String(from || "");
  const end = String(to || "");
  while (d && end && d <= end) {
    out.push(d);
    const t = new Date(d + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + 1);
    d = t.toISOString().slice(0, 10);
  }
  return out;
}

function domingo(extra) {
  return Object.assign(
    {
      id: "e1269",
      empNo: "1269",
      name: "Monte, Domingo C.",
      dept: "Admin",
      position: "HR",
      status: "Separated",
      dateHired: "2023-10-09",
      separatedOn: "2026-08-31",
      rehireDate: "2026-10-16",
      rateType: "Daily",
      dailyRate: 500,
      project: "ADMINS",
    },
    extra || {}
  );
}

function dayRec(date, rows, extra) {
  return Object.assign(
    {
      id: "d" + date.replace(/-/g, ""),
      date,
      rows: rows || {},
      extra: [],
      omit: [],
    },
    extra || {}
  );
}

function loadPortal() {
  const ctx = {
    S: { employees: {}, daily: {}, leaves: {}, ui: { dailyDate: "2026-10-16", emp: "e1269" }, settings: {} },
    TODAY: "2026-10-16",
    KNOWN_SEP: {},
    EMP_DIRTY: {},
    STATUS_PENDING: "Has not yet arrived",
    payDates,
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
    },
    sortByRosterOrder(list) {
      return (list || []).slice();
    },
    dailyOrderOf() {
      return [];
    },
    dayIsOpen(rec) {
      const day = String((rec && rec.date) || "").slice(0, 10);
      return !day || day >= ctx.TODAY;
    },
    openDayKeepsLeaver(rec, id) {
      return ((rec && rec.callback) || []).indexOf(id) >= 0;
    },
    firstAddedIndex() {
      const map = {};
      Object.values(ctx.S.daily || {}).forEach((rec) => {
        if (!rec || !rec.date || rec.fixed) return;
        const seen = {};
        Object.keys(rec.rows || {}).forEach((id) => {
          if (id) seen[id] = true;
        });
        (rec.extra || []).forEach((id) => {
          if (id) seen[id] = true;
        });
        Object.keys(seen).forEach((id) => {
          if (!map[id] || rec.date < map[id]) map[id] = rec.date;
        });
      });
      return map;
    },
    atWork() {
      const day = (ctx.S.ui && ctx.S.ui.dailyDate) || ctx.TODAY;
      return Object.values(ctx.S.employees).filter((e) => e && !ctx.empSeparatedAsOf(e, day));
    },
    monthKey(d) {
      return String(d || "").slice(0, 7);
    },
    effectiveStatus(id, date, raw) {
      return raw || "";
    },
    rowExcused() {
      return false;
    },
    absenceExcuse() {
      return null;
    },
    dailyGroups(rec) {
      const people = Object.keys((rec && rec.rows) || {})
        .map((id) => ctx.S.employees[id])
        .filter(Boolean);
      return [{ people }];
    },
    dailyRow(rec, e) {
      return ((rec && rec.rows) || {})[e.id] || { s: "Present" };
    },
    dailyRecordFor(date) {
      const day = String(date || "").slice(0, 10);
      return ctx.S.daily["d" + day.replace(/-/g, "")] || null;
    },
    payDayRow(empId, rec) {
      return rec && rec.rows ? rec.rows[empId] || null : null;
    },
    payDayAmount(r) {
      const st = String((r && r.s) || "");
      if (st === "Half Day") return 0.5;
      if (!st || st === "Present" || st === "Present/Late" || st === "Undertime" || st === "Regular Holiday") return 1;
      return 0;
    },
    payrollOtHours(rec, empId, row) {
      return Number(row && row.ot) || 0;
    },
    holCode() {
      return 0;
    },
    holRate() {
      return 0;
    },
    holEligible() {
      return false;
    },
    dayVal(r, k) {
      if (k === "ot") return Number(r && r.ot) || 0;
      return 0;
    },
    lateMinutesOf() {
      return 0;
    },
    dayCountsLate() {
      return false;
    },
    summaryPersonId(key) {
      return ctx.S.employees[key] ? key : "";
    },
    dailyRowForEmp(rec, empId) {
      return rec && rec.rows ? rec.rows[empId] || null : null;
    },
    esc(s) {
      return String(s == null ? "" : s);
    },
    flipName(n) {
      const p = String(n || "").split(",");
      return p.length > 1 ? p[1].trim() + " " + p[0].trim() : String(n || "");
    },
    num(n) {
      return String(n);
    },
    drillCell(n) {
      return String(n);
    },
    recentManpowerIds() {
      return {};
    },
  };
  const names = [
    "dateInputValue",
    "knownSepRec",
    "statusTextIsSeparated",
    "empStatusIsLive",
    "empStatusIsSeparated",
    "empSeparatedAsOf",
    "empHireDate",
    "empRehireDate",
    "beforeRehire",
    "priorSeparationSuperseded",
    "rehiredActiveAsOf",
    "empNotYetHired",
    "payDayBeforeHire",
    "rowHasEnteredData",
    "dailyRowShown",
    "ownLastDay",
    "liveStatusBeatsLastDay",
    "empPastLastDay",
    "shouldAutoSeparate",
    "sepRosterWouldApply",
    "empEnteredFieldNames",
    "keepEmpDateEdits",
    "nameLastFirst",
    "cmpEmpAlpha",
    "empAlpha",
    "lastDayHint",
    "offenders",
    "drillRows",
    "dailyPeople",
    "dailyTally",
    "askDayRows",
    "dayCredit",
    "payKindOf",
    "payPersonListed",
    "empSeparationDate",
    "payRosterInclude",
    "payDayAfterSeparation",
    "summaryDayOt",
    "payDaysFor",
    "leaverStatusWithPastDate",
    "contribEngaged",
    "dailyMonitorTotals",
    "manpowerPayTally",
    "attendanceRosterMode",
    "attendanceIsLeaver",
    "attendanceRosterMatches",
    "attendanceRosterSeg",
    "attendanceStatusNote",
    "attendanceSummaryCard",
    "applyEmpField",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function loadAttendance(today) {
  const root = { console, TODAY: today || "2026-10-16" };
  const windowLike = { window: root, document: undefined, console, TODAY: root.TODAY };
  windowLike.window = windowLike;
  vm.runInNewContext(attendanceSrc, windowLike);
  return windowLike.hrAttendance;
}

function loadPayroll(today) {
  const root = { console, TODAY: today || "2026-10-16" };
  vm.runInNewContext(payrollSrc, {
    window: root,
    globalThis: root,
    console,
    Date,
    Math,
    JSON,
    Intl,
    Number,
    String,
    Object,
    Array,
    isNaN,
  });
  return { api: root.hrPayroll, root };
}

describe("2026-10-16b rehire date on the 201 file", () => {
  it("is build 2026-10-16b and keeps the rehire date on the employee JSON", () => {
    assert.match(html, /const BUILD = "2026-10-29a"/);
    assert.match(extractFunction(html, "newEmp"), /rehireDate:""/);
    assert.match(extractFunction(html, "empEnteredFieldNames"), /"rehireDate"/);
    assert.match(extractFunction(html, "keepEmpDateEdits"), /"rehireDate"/);
    assert.match(html, /rehireDate:1/);
    assert.match(html, /id="f-rehireDate"/);
    assert.match(html, /data-ef="rehireDate"/);
    assert.match(html, /Start of the current engagement/);
    assert.match(html, /Rehired '\+esc\(longDate\(empRehireDate\(e\)\)\)/);
    assert.match(html, /back && empStatusIsSeparated\(x\) \? "Active"/);
    assert.match(html, /dateHired:e\.dateHired\|\|"", rehireDate:\(typeof empRehireDate==="function"\?empRehireDate\(e\):""\)/);
    assert.match(extractFunction(html, "drillRows"), /typeof r!=="object"/);
    assert.doesNotMatch(extractFunction(html, "drillRows"), /dailyGroups\(/);
    assert.match(extractFunction(html, "attendanceSummaryCard"), /summaryDayOt/);
    assert.match(html, /\["1269", "Monte, Domingo C\.", "Admin", "HR", "2023-10-09"/);
  });

  it("saves a rehire date from the 201 form and keeps a dirty edit", () => {
    const ctx = loadPortal();
    const emp = domingo({ rehireDate: "" });
    ctx.S.employees.e1269 = emp;
    const saved = ctx.applyEmpField({
      type: "date",
      dataset: { ef: "rehireDate" },
      value: "2026-10-16",
    });
    assert.equal(saved, "rehireDate");
    assert.equal(emp.rehireDate, "2026-10-16");
    assert.equal(
      ctx.applyEmpField({ type: "date", dataset: { ef: "rehireDate" }, value: "2026-10-16" }),
      null
    );
    ctx.EMP_DIRTY.e1269 = true;
    const kept = ctx.keepEmpDateEdits(
      { id: "e1269", rehireDate: "", dateHired: "2023-10-09" },
      { id: "e1269", rehireDate: "2026-10-16", dateHired: "2023-10-09" }
    );
    assert.equal(kept.rehireDate, "2026-10-16");
    assert.ok(ctx.empEnteredFieldNames().includes("rehireDate"));
  });

  it("treats Domingo as active from the rehire date and ignores the gap", () => {
    const ctx = loadPortal();
    const emp = domingo();
    ctx.S.employees.e1269 = emp;
    ctx.S.employees.e1 = {
      id: "e1",
      empNo: "1001",
      name: "Alpha, Ann",
      status: "Regular",
      dateHired: "2024-01-01",
      rateType: "Daily",
    };
    ctx.S.daily.d20260831 = dayRec("2026-08-31", { e1269: { s: "Present", r: "" } });
    ctx.S.daily.d20260915 = dayRec("2026-09-15", { e1269: { s: "Absent", r: "AWOL" }, e1: { s: "Present", r: "" } });
    ctx.S.daily.d20261015 = dayRec("2026-10-15", { e1269: { s: "Absent", r: "" }, e1: { s: "Present", r: "" } });
    ctx.S.daily.d20261016 = dayRec("2026-10-16", { e1269: { s: "Present", r: "" }, e1: { s: "Absent", r: "" } });

    assert.equal(ctx.empRehireDate(emp), "2026-10-16");
    assert.equal(ctx.beforeRehire(emp, "2026-09-15"), true);
    assert.equal(ctx.beforeRehire(emp, "2026-10-16"), false);
    assert.equal(ctx.empSeparatedAsOf(emp, "2026-08-31"), false);
    assert.equal(ctx.empSeparatedAsOf(emp, "2026-09-15"), true);
    assert.equal(ctx.empSeparatedAsOf(emp, "2026-10-16"), false);
    assert.equal(ctx.empPastLastDay(emp, "2026-09-15"), true);
    assert.equal(ctx.empPastLastDay(emp, "2026-10-16"), false);
    assert.equal(ctx.rehiredActiveAsOf(emp, "2026-10-16"), true);
    assert.equal(ctx.shouldAutoSeparate(emp, "2026-10-16"), false);

    ctx.S.ui.dailyDate = "2026-09-15";
    const gap = ctx.dailyPeople(ctx.S.daily.d20260915).map((e) => e.id);
    assert.equal(gap.join(","), "e1");
    ctx.S.ui.dailyDate = "2026-10-16";
    const back = ctx.dailyPeople(ctx.S.daily.d20261016).map((e) => e.id);
    assert.ok(back.includes("e1269"));
    assert.ok(back.includes("e1"));

    const fixed = ctx.dailyPeople(dayRec("2026-09-15", { e1269: { s: "Absent" } }, { fixed: true })).map((e) => e.id);
    assert.equal(fixed.join(","), "e1269");

    const offs = ctx.offenders(["2026-09", "2026-10"]);
    const dom = offs.find((x) => x.e && x.e.id === "e1269");
    assert.equal(dom, undefined);
    const ann = offs.find((x) => x.e && x.e.id === "e1");
    assert.equal(ann.absent, 1);

    const drilled = ctx.drillRows({ kind: "absent", empId: "e1269", months: ["2026-09", "2026-10"] });
    assert.equal(drilled.length, 0);
    const annDays = ctx.drillRows({ kind: "absent", empId: "e1", months: ["2026-10"] });
    assert.equal(annDays.length, 1);
    assert.equal(annDays[0].date, "2026-10-16");

    const gapTally = ctx.dailyTally(ctx.S.daily.d20260915);
    assert.equal(gapTally.absent, 0);
    const todayTally = ctx.dailyTally(ctx.S.daily.d20261016);
    assert.equal(todayTally.present, 1);
    assert.equal(todayTally.absent, 1);

    const asked = ctx.askDayRows("e1269", "2026-08-01", "2026-10-31").map((r) => r.date);
    assert.equal(asked.join(","), "2026-10-16");

    const card = ctx.attendanceSummaryCard(["2026-09", "2026-10"]);
    assert.match(card, /Monte, Domingo C\.|Domingo C\. Monte/);
    assert.doesNotMatch(card, /AWOL/);
    const monitor = ctx.dailyMonitorTotals("e1269", "2026-08-27", "2026-10-16");
    assert.equal(monitor.days, 1);

    const ordered = ctx.empAlpha(
      [
        { id: "e9", empNo: "9", name: "Aaron, Zed", status: "Separated", separatedOn: "2026-01-01" },
        emp,
        ctx.S.employees.e1,
      ],
      true
    );
    assert.equal(ordered.map((e) => e.id).join(","), "e1,e1269,e9");
    assert.match(ctx.lastDayHint(emp), /2026-10-16/);
  });

  it("counts payroll from the rehire date and leaves an earlier period alone", () => {
    const ctx = loadPortal();
    const emp = domingo();
    ctx.S.employees.e1269 = emp;
    ctx.S.daily.d20260831 = dayRec("2026-08-31", { e1269: { s: "Present", ot: 2 } });
    ctx.S.daily.d20260901 = dayRec("2026-09-01", { e1269: { s: "Present" } });
    ctx.S.daily.d20260915 = dayRec("2026-09-15", { e1269: { s: "Present" } });
    ctx.S.daily.d20261015 = dayRec("2026-10-15", { e1269: { s: "Absent" } });
    ctx.S.daily.d20261016 = dayRec("2026-10-16", { e1269: { s: "Present", ot: 3 } });
    ctx.S.daily.d20261017 = dayRec("2026-10-17", { e1269: { s: "Present" } });

    const oldPer = { from: "2026-08-27", to: "2026-09-02" };
    assert.equal(ctx.payRosterInclude(emp, oldPer), true);
    const oldDays = ctx.payDaysFor("e1269", payDates(oldPer.from, oldPer.to));
    const aug31 = oldDays.find((x) => x.date === "2026-08-31");
    const sep1 = oldDays.find((x) => x.date === "2026-09-01");
    assert.equal(aug31.day, 1);
    assert.equal(aug31.ot, 2);
    assert.equal(sep1.day, 0);

    const gapPer = { from: "2026-09-10", to: "2026-09-16" };
    assert.equal(ctx.payRosterInclude(emp, gapPer), false);
    const gapPay = ctx.payDaysFor("e1269", payDates(gapPer.from, gapPer.to));
    assert.equal(gapPay.find((x) => x.date === "2026-09-15").day, 0);

    const nowPer = { from: "2026-10-15", to: "2026-10-21" };
    assert.equal(ctx.payRosterInclude(emp, nowPer), true);
    const nowDays = ctx.payDaysFor("e1269", payDates(nowPer.from, nowPer.to));
    assert.equal(nowDays.some((x) => x.date === "2026-10-15"), false);
    assert.equal(nowDays.find((x) => x.date === "2026-10-16").day, 1);
    assert.equal(nowDays.find((x) => x.date === "2026-10-16").ot, 3);
    assert.equal(nowDays.find((x) => x.date === "2026-10-17").day, 1);
    const tally = ctx.manpowerPayTally("e1269", nowPer.from, nowPer.to);
    assert.equal(tally.days, 2);
    assert.equal(tally.ot, 3);

    assert.equal(ctx.leaverStatusWithPastDate(emp, "2026-10-16"), false);
    assert.equal(ctx.contribEngaged(emp, {}), true);
    assert.equal(ctx.summaryDayOt(ctx.S.daily.d20260915, "e1269", ctx.S.daily.d20260915.rows.e1269), null);
    assert.equal(ctx.summaryDayOt(ctx.S.daily.d20261016, "e1269", ctx.S.daily.d20261016.rows.e1269).day, 1);
  });

  it("keeps a person with no rehire date on the old separation rules", () => {
    const ctx = loadPortal();
    const emp = domingo({ rehireDate: "" });
    ctx.S.employees.e1269 = emp;
    ctx.S.daily.d20260915 = dayRec("2026-09-15", { e1269: { s: "Absent", r: "" } });
    ctx.S.daily.d20261016 = dayRec("2026-10-16", { e1269: { s: "Absent", r: "" } });
    assert.equal(ctx.empRehireDate(emp), "");
    assert.equal(ctx.rehiredActiveAsOf(emp, "2026-10-16"), false);
    assert.equal(ctx.empSeparatedAsOf(emp, "2026-10-16"), true);
    assert.equal(ctx.payRosterInclude(emp, { from: "2026-10-15", to: "2026-10-21" }), false);
    const offs = ctx.offenders(["2026-09", "2026-10"]);
    assert.equal(offs[0].absent, 2);
    assert.equal(ctx.drillRows({ kind: "absent", empId: "e1269", months: ["2026-09", "2026-10"] }).length, 2);
    ctx.KNOWN_SEP["1402"] = { separatedOn: "2026-08-01" };
    const unmarked = { id: "e1402", empNo: "1402", name: "Alquizalas, John Mark", status: "", rehireDate: "2026-10-16" };
    assert.equal(ctx.sepRosterWouldApply(unmarked), false);
    unmarked.rehireDate = "";
    assert.equal(ctx.sepRosterWouldApply(unmarked), true);
  });

  it("lets a last day on or after the rehire date end the new engagement", () => {
    const ctx = loadPortal();
    const emp = domingo({
      status: "Regular",
      separatedOn: "2026-08-31",
      separatedOnEditedOn: "2026-09-01T00:00:00.000Z",
      statusEditedOn: "2026-08-01T00:00:00.000Z",
    });
    ctx.S.employees.e1269 = emp;
    assert.equal(ctx.priorSeparationSuperseded(emp), true);
    assert.equal(ctx.shouldAutoSeparate(emp, "2026-10-16"), false);
    assert.equal(ctx.rehiredActiveAsOf(emp, "2026-10-16"), true);
    assert.equal(ctx.empPastLastDay(emp, "2026-10-16"), false);

    emp.separatedOn = "2026-10-20";
    emp.separatedOnEditedOn = "2026-10-20T00:00:00.000Z";
    emp.status = "Regular";
    assert.equal(ctx.priorSeparationSuperseded(emp), false);
    assert.equal(ctx.shouldAutoSeparate(emp, "2026-10-21"), true);
    assert.equal(ctx.empSeparatedAsOf(emp, "2026-10-20"), false);
    emp.status = "Separated";
    assert.equal(ctx.empSeparatedAsOf(emp, "2026-10-20"), false);
    assert.equal(ctx.empSeparatedAsOf(emp, "2026-10-21"), true);
    assert.equal(ctx.payRosterInclude(emp, { from: "2026-10-15", to: "2026-10-21" }), true);
    assert.equal(ctx.payRosterInclude(emp, { from: "2026-10-22", to: "2026-10-28" }), false);
    ctx.S.daily.d20261020 = dayRec("2026-10-20", { e1269: { s: "Present" } });
    ctx.S.daily.d20261021 = dayRec("2026-10-21", { e1269: { s: "Present" } });
    const days = ctx.payDaysFor("e1269", ["2026-10-20", "2026-10-21"]);
    assert.equal(days.find((x) => x.date === "2026-10-20").day, 1);
    assert.equal(days.find((x) => x.date === "2026-10-21").day, 0);
  });

  it("starts companion attendance and payroll at the same rehire date", () => {
    const hr = loadAttendance("2026-10-16");
    const emp = domingo();
    const ctx = {
      employees: { e1269: emp, e1: { id: "e1", empNo: "1001", name: "Alpha, Ann", status: "Regular" } },
      leaves: {},
      daily: {
        d20260831: dayRec("2026-08-31", { e1269: { s: "Present" } }),
        d20260915: dayRec("2026-09-15", { e1269: { s: "Absent", r: "" }, e1: { s: "Present" } }),
        d20261016: dayRec("2026-10-16", { e1269: { s: "Present" }, e1: { s: "Absent" } }),
      },
      today: "2026-10-16",
    };
    const gapIds = hr.rosterPeopleForDay(ctx.daily.d20260915, ctx).map((e) => e.id);
    assert.equal(gapIds.join(","), "e1");
    const backIds = hr.rosterPeopleForDay(ctx.daily.d20261016, ctx).map((e) => e.id);
    assert.ok(backIds.includes("e1269"));
    const sums = hr.personSummaries(["2026-09", "2026-10"], ctx);
    const dom = sums.find((x) => x.empId === "e1269");
    assert.equal(dom.absent, 0);
    assert.equal(dom.present, 1);
    const notes = hr.noticeStrands("e1269", ["2026-09", "2026-10"], ctx, {});
    assert.equal(notes.absents.length, 0);
    const tally = hr.dailyTallyFromEffective(ctx.daily.d20260915, ctx);
    assert.equal(tally.absent, 0);

    const early = loadPayroll("2026-09-15");
    const S = {
      employees: {
        e1269: emp,
        e1: { id: "e1", empNo: "1001", name: "Alpha, Ann", status: "Regular", rateType: "Daily" },
        e2: { id: "e2", empNo: "1002", name: "Left, Lou", status: "Separated", rateType: "Daily" },
      },
    };
    assert.equal(early.api.peopleForKind("weekly", S).map((e) => e.id).join(","), "e1");
    early.root.TODAY = "2026-10-16";
    assert.equal(early.api.peopleForKind("weekly", S).map((e) => e.id).sort().join(","), "e1,e1269");
    const oldTally = early.api.tallyPersonPeriod("e1269", "2026-08-27", "2026-09-02", {
      employees: S.employees,
      daily: {
        d20260831: dayRec("2026-08-31", { e1269: { s: "Present" } }),
        d20260901: dayRec("2026-09-01", { e1269: { s: "Present" } }),
      },
    });
    assert.equal(oldTally.days, 0);
    const nowTally = early.api.tallyPersonPeriod("e1269", "2026-10-15", "2026-10-21", {
      employees: S.employees,
      daily: {
        d20261015: dayRec("2026-10-15", { e1269: { s: "Present" } }),
        d20261016: dayRec("2026-10-16", { e1269: { s: "Present" } }),
        d20261017: dayRec("2026-10-17", { e1269: { s: "Present" } }),
      },
    });
    assert.equal(nowTally.days, 2);
    assert.equal(nowTally.dayDates.join(","), "2026-10-16,2026-10-17");
  });
});
