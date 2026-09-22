"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAttendance(windowLike) {
  const src = fs.readFileSync(
    path.join(__dirname, "../public/hr-attendance.js"),
    "utf8"
  );
  vm.runInNewContext(src, windowLike);
  return windowLike.hrAttendance;
}

function emp(id, empNo, name) {
  return { id, empNo, name, project: "ADMINS" };
}

function stores() {
  return {
    employees: {
      e1250: emp("e1250", "1250", "Armenio, Toribio D."),
      e1348: emp("e1348", "1348", "Manolong, Raffy"),
      e1353: emp("e1353", "1353", "Pedrano, Jaica M."),
    },
    leaves: {},
    daily: {},
    today: "2026-08-31",
  };
}

function ctxFrom(s) {
  return {
    employees: s.employees,
    leaves: s.leaves,
    daily: s.daily,
    today: s.today,
  };
}

function sampleJson() {
  return [
    {
      date: "2026-08-29",
      preparedBy: "Timekeeper",
      approvedBy: "PIC",
      source: "08.29.2026.pdf",
      rows: [
        { empNo: "1250", status: "Present", reason: "", site: "CTU BARILI" },
        {
          empNo: "1348",
          status: "Absent",
          reason: "Approved Leave (LRF2026 - 0123)",
          site: "ADMINS",
        },
        { empNo: "1353", status: "Present/Late", reason: "traffic", site: "TAWASON" },
      ],
    },
  ];
}

describe("manpower attendance core", () => {
  let hr;
  let S;

  beforeEach(() => {
    const windowLike = { window: {}, document: undefined };
    windowLike.window = windowLike;
    hr = loadAttendance(windowLike);
    S = stores();
  });

  it("never uses toISOString for calendar day ids", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../public/hr-attendance.js"),
      "utf8"
    );
    assert.doesNotMatch(src, /toISOString\s*\(/);
    assert.equal(hr.isoDate("2026-08-29T16:40:00+08:00"), "2026-08-29");
    assert.equal(hr.dailyId("2026-08-29"), "d20260829");
    const manilaMorning = new Date("2026-08-29T17:00:00Z");
    assert.equal(hr.manilaToday(manilaMorning), "2026-08-30");
    assert.equal(manilaMorning.toISOString().slice(0, 10), "2026-08-29");
  });

  it("normalises statuses to the closed list and keeps Special Holiday", () => {
    assert.equal(hr.normStatus("Present / Late"), "Present/Late");
    assert.equal(hr.normStatus("special holiday"), "Special Holiday");
    assert.equal(hr.normStatus("Regular Holiday"), "Regular Holiday");
    assert.equal(hr.normStatus("Leave with Pay"), "Leave with Pay");
    assert.equal(hr.normStatus("Has not yet arrived"), "Has not yet arrived");
    assert.equal(hr.normStatus("not yet in"), "Has not yet arrived");
    assert.equal(hr.normStatus("not a status"), "");
    assert.ok(hr.CLOSED_STATUSES.includes("Special Holiday"));
    assert.ok(hr.CLOSED_STATUSES.includes("Leave with Pay"));
    assert.ok(hr.CLOSED_STATUSES.includes("Undertime"));
    assert.ok(hr.CLOSED_STATUSES.includes("Has not yet arrived"));
    assert.equal(hr.STATUS_PENDING, "Has not yet arrived");
    assert.equal(hr.dayCredit("Has not yet arrived"), 0);
    assert.equal(hr.dayCredit(hr.STATUS_PENDING), 0);
    assert.equal(hr.normStatus("Present (Late)"), "Present/Late");
    assert.equal(hr.normStatus("undertime"), "Undertime");
    assert.equal(hr.normStatus("left early"), "Undertime");
  });

  it("Present/Late requires Time In; Undertime requires Time Out", () => {
    const lateNeed = hr.validateDayRowTimes({ s: "Present/Late", in: "", out: "17:00" });
    assert.equal(lateNeed.length, 1);
    assert.match(lateNeed[0], /Time In is required for Present\/Late/);
    assert.equal(hr.validateDayRowTimes({ s: "Present/Late", in: "08:12" }).length, 0);
    const utNeed = hr.validateDayRowTimes({ s: "Undertime", in: "08:00", out: "" });
    assert.equal(utNeed.length, 1);
    assert.match(utNeed[0], /Time Out is required for Undertime/);
    assert.equal(hr.validateDayRowTimes({ s: "Undertime", out: "15:30" }).length, 0);
    assert.equal(hr.validateDayRowTimes({ s: "Present", in: "", out: "" }).length, 0);
    assert.equal(hr.validateDayRowTimes({ s: "Absent", in: "", out: "" }).length, 0);
    assert.equal(hr.validateDayRowTimes({ s: "Has not yet arrived", in: "", out: "" }).length, 0);
    assert.equal(hr.dayCredit("Undertime"), 1);
    assert.equal(hr.holidayGranted({ hol: 2 }), true);
    assert.equal(hr.holidayPremiumCode({ hol: 2 }), 2);
    assert.equal(hr.holidayPremiumCode({ hol: 1 }), 1);
    assert.equal(hr.holidayPremiumCode({}), 0);
  });

  it("reads the report date from dotted, dashed and underscored filenames", () => {
    assert.equal(hr.dateFromReport("08.29.2026.pdf", ""), "2026-08-29");
    assert.equal(hr.dateFromReport("08-29-2026.pdf", ""), "2026-08-29");
    assert.equal(hr.dateFromReport("08_29_2026.pdf", ""), "2026-08-29");
    assert.equal(hr.dateFromReport("scan.pdf", "DAILY MANPOWER 29-Aug-26"), "2026-08-29");
  });

  it("parses manpower rows on the four-digit employee number only", () => {
    const text =
      "1 1250 Armenio Toribio DRIVER Present CTU BARILI " +
      "2 1348 Manolong Raffy TIMEKEEPER Absent Approved Leave (LRF2026 - 0123) ADMINS " +
      "3 1353 Pedrano Jaica OFFICE ENGINEER Present / Late traffic TAWASON " +
      "Prepared by Cassandra Approved by Jeffrey";
    const rows = hr.parseManpower(text);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].empNo, "1250");
    assert.equal(rows[0].status, "Present");
    assert.equal(rows[1].empNo, "1348");
    assert.equal(rows[1].status, "Absent");
    assert.match(rows[1].reason, /LRF2026/);
    assert.doesNotMatch(rows[1].reason, /ADMINS/);
    assert.equal(rows[2].status, "Present/Late");
    assert.equal(rows[2].reason, "traffic");
  });

  it("matches people on the four-digit emp number, never the name", () => {
    const ctx = ctxFrom(S);
    const day = {
      date: "2026-08-29",
      rows: [
        { empNo: "1250", status: "Present", reason: "", site: "X" },
        { empNo: "9999", status: "Present", reason: "", site: "X" },
        { empNo: "Toribio", status: "Present", reason: "", site: "X" },
      ],
    };
    const result = hr.commitDailyFromParsed(day, ctx);
    assert.ok(result.rec.rows.e1250);
    assert.equal(result.used, 1);
    assert.equal(result.unknown["9999"], 1);
    assert.ok(result.unknown.Toribio || result.unknown["?"]);
    assert.equal(Object.keys(result.rec.rows).length, 1);
  });

  it("1. approved leave register beats a timekeeper Absent", () => {
    S.leaves.lv1 = {
      id: "lv1",
      empId: "e1348",
      no: "LRF2026-0100",
      status: "Approved",
      type: "SL",
      from: "2026-08-28",
      to: "2026-08-29",
      pay: 1,
    };
    const ctx = ctxFrom(S);
    const st = hr.effectiveStatus("e1348", "2026-08-29", "Absent", "AWOL", ctx);
    assert.equal(st, "Leave with Pay");
    const excuse = hr.absenceExcuse("e1348", "2026-08-29", "AWOL", ctx);
    assert.equal(excuse.kind, "register");
    assert.equal(hr.dayCredit(st, { s: "Absent", r: "AWOL" }, "e1348", "2026-08-29", ctx), 1);
    S.daily.d20260829 = {
      id: "d20260829",
      date: "2026-08-29",
      rows: { e1348: { s: "Absent", r: "AWOL" } },
    };
    const people = hr.personSummaries(["2026-08"], ctx);
    const raffy = people.find((p) => p.empId === "e1348");
    assert.equal(raffy.absent, 0);
    assert.equal(raffy.leave, 1);
    assert.equal(raffy.excused, 1);
  });

  it("2. LRF citation including a wrapped 0123) line is employee-scoped", () => {
    S.daily.d20260828 = {
      id: "d20260828",
      date: "2026-08-28",
      rows: {
        e1348: { s: "Absent", r: "Approved Leave (LRF2026 - 0123)" },
        e1250: { s: "Absent", r: "no show" },
      },
    };
    S.daily.d20260829 = {
      id: "d20260829",
      date: "2026-08-29",
      rows: {
        e1348: { s: "Absent", r: "0123)" },
        e1250: { s: "Absent", r: "0123)" },
      },
    };
    const ctx = ctxFrom(S);
    hr.invalidateLrf();
    assert.equal(
      hr.effectiveStatus("e1348", "2026-08-28", "Absent", "Approved Leave (LRF2026 - 0123)", ctx),
      "Leave"
    );
    assert.equal(hr.effectiveStatus("e1348", "2026-08-29", "Absent", "0123)", ctx), "Leave");
    const wrap = hr.absenceExcuse("e1348", "2026-08-29", "0123)", ctx);
    assert.ok(wrap);
    assert.equal(wrap.kind, "report");
    assert.equal(wrap.wrapped, true);
    assert.equal(wrap.no, "LRF2026-0123");
    assert.equal(
      hr.effectiveStatus("e1250", "2026-08-29", "Absent", "0123)", ctx),
      "Absent",
      "another employee's wrapped tail must not inherit the citation"
    );
    const people = hr.personSummaries(["2026-08"], ctx);
    const raffy = people.find((p) => p.empId === "e1348");
    const toribio = people.find((p) => p.empId === "e1250");
    assert.equal(raffy.absent, 0);
    assert.equal(raffy.leave, 2);
    assert.equal(toribio.absent, 2);
    assert.equal(toribio.leave, 0);
  });

  it("3. not-filed and a bare number stay unexcused (grey / red, not leave)", () => {
    const ctx = ctxFrom(S);
    assert.equal(
      hr.effectiveStatus("e1353", "2026-08-29", "Absent", "AWOL (not filed)", ctx),
      "Absent"
    );
    assert.equal(hr.absenceExcuse("e1353", "2026-08-29", "AWOL (not filed)", ctx), null);
    assert.equal(hr.effectiveStatus("e1353", "2026-08-29", "Absent", "4567)", ctx), "Absent");
    assert.equal(hr.absenceExcuse("e1353", "2026-08-29", "4567)", ctx), null);
    assert.ok(hr.reportSaysNotFiled("sick (not filed)"));
  });

  it("4–5. coverage excludes Sunday and flags a month under 80%", () => {
    S.daily.d20260803 = { id: "d20260803", date: "2026-08-03", rows: { e1250: { s: "Present" } } };
    S.daily.d20260804 = { id: "d20260804", date: "2026-08-04", rows: { e1250: { s: "Present" } } };
    const ctx = ctxFrom(S);
    const cov = hr.dailyCoverage(2026, ctx);
    const aug = cov.find((c) => c.month === "2026-08");
    assert.ok(aug);
    assert.ok(aug.workdays >= 26 && aug.workdays <= 27, "Aug 2026 has 26 Mon–Sat days through the 31st");
    assert.ok(!aug.missing.includes("2026-08-02"), "2 Aug 2026 is a Sunday");
    assert.ok(!aug.missing.includes("2026-08-30"), "30 Aug 2026 is a Sunday");
    assert.equal(aug.filed, 2);
    assert.ok(aug.pct < 80);
    assert.equal(aug.thin, true);
    const window = hr.coverageForMonths(["2026-08"], ctx);
    assert.equal(window.thin, true);
    assert.equal(window.filed, 2);
  });

  it("6. holiday premium eligible is not granted until HR ticks hol", () => {
    assert.equal(hr.holEligible("Regular Holiday"), true);
    assert.equal(hr.holEligible("Special Holiday"), true);
    assert.equal(hr.holEligible("Present"), false);
    assert.equal(hr.holidayGranted({ s: "Regular Holiday" }), false);
    assert.equal(hr.holidayGranted({ s: "Regular Holiday", hol: true }), true);
    S.daily.d20260821 = {
      id: "d20260821",
      date: "2026-08-21",
      rows: {
        e1250: { s: "Regular Holiday", r: "", hol: false },
        e1353: { s: "Regular Holiday", r: "", hol: true },
      },
    };
    const people = hr.personSummaries(["2026-08"], ctxFrom(S));
    const a = people.find((p) => p.empId === "e1250");
    const b = people.find((p) => p.empId === "e1353");
    assert.equal(a.holiday, 1);
    assert.equal(a.holEligible, 1);
    assert.equal(a.premiumDays, 0);
    assert.equal(b.premiumDays, 1);
  });

  it("7. late is a full day of credit; payroll cannot overwrite the day field", () => {
    assert.equal(hr.dayCredit("Present/Late"), 1);
    assert.equal(hr.dayCredit("Present"), 1);
    assert.equal(hr.dayCredit("Absent"), 0);
    assert.equal(hr.dayCredit("Leave"), 0);
    assert.equal(hr.dayCredit("Leave with Pay"), 1);
    assert.equal(hr.dayCredit("Half Day"), 0.5);
    const row = { s: "Present/Late", r: "traffic", day: 1 };
    assert.equal(hr.dayVal(row), 1);
    assert.equal(hr.payrollMustNotOverride(row, 0), true);
    assert.equal(hr.applyPayrollDaysToAttendance().blocked, true);
    const merged = hr.commitDailyFromParsed(
      {
        date: "2026-08-29",
        rows: [{ empNo: "1250", status: "Present/Late", reason: "traffic", day: 0, fromPayroll: true }],
      },
      ctxFrom(S)
    );
    assert.equal(merged.rec.rows.e1250.day, undefined);
  });

  it("JSON paste uses the sample shape, maps empNo, and merges into DailyReport", async () => {
    const ctx = ctxFrom(S);
    const stats = await hr.importAttendanceJson(sampleJson(), ctx);
    assert.equal(stats.days, 1);
    assert.equal(stats.rows, 3);
    const rec = ctx.daily.d20260829;
    assert.ok(rec);
    assert.equal(rec.id, "d20260829");
    assert.equal(rec.date, "2026-08-29");
    assert.equal(rec.source, "08.29.2026.pdf");
    assert.equal(rec.fixed, true);
    assert.equal(rec.rows.e1250.s, "Present");
    assert.equal(rec.rows.e1250.site, "CTU BARILI");
    assert.equal(rec.rows.e1348.s, "Absent");
    assert.match(rec.rows.e1348.r, /LRF2026/);
    assert.equal(rec.rows.e1353.s, "Present/Late");
    assert.equal(hr.effectiveStatus("e1348", rec.date, rec.rows.e1348.s, rec.rows.e1348.r, ctx), "Leave");

    rec.rows.e1250.hol = true;
    rec.rows.e1250.ot = 2;
    const again = await hr.importAttendanceJson(
      [
        {
          date: "2026-08-29",
          rows: [{ empNo: "1250", status: "Present", reason: "updated", site: "TAWASON" }],
        },
      ],
      ctx
    );
    assert.equal(again.merged, 1);
    assert.equal(ctx.daily.d20260829.rows.e1250.r, "updated");
    assert.equal(ctx.daily.d20260829.rows.e1250.site, "TAWASON");
    assert.equal(ctx.daily.d20260829.rows.e1250.hol, true);
    assert.equal(ctx.daily.d20260829.rows.e1250.ot, 2);
    assert.equal(ctx.daily.d20260829.rows.e1348.s, "Absent");
  });

  it("twin-notice keeps late and absence on separate strands; AWOL only on consecutive filed days", () => {
    S.daily.d20260824 = {
      id: "d20260824",
      date: "2026-08-24",
      rows: { e1353: { s: "Absent", r: "" } },
    };
    S.daily.d20260825 = {
      id: "d20260825",
      date: "2026-08-25",
      rows: { e1353: { s: "Absent", r: "" } },
    };
    S.daily.d20260826 = {
      id: "d20260826",
      date: "2026-08-26",
      rows: { e1353: { s: "Absent", r: "" } },
    };
    S.daily.d20260827 = {
      id: "d20260827",
      date: "2026-08-27",
      rows: { e1353: { s: "Present/Late", r: "traffic" } },
    };
    S.daily.d20260828 = {
      id: "d20260828",
      date: "2026-08-28",
      rows: { e1353: { s: "Present/Late", r: "traffic" } },
    };
    S.daily.d20260829 = {
      id: "d20260829",
      date: "2026-08-29",
      rows: { e1353: { s: "Present/Late", r: "traffic" } },
    };
    const n = hr.noticeStrands("e1353", ["2026-08"], ctxFrom(S), {
      awolRun: 3,
      absentNTE: 1,
      lateReminder: 3,
      lateNTE: 5,
    });
    assert.equal(n.run.len, 3);
    assert.ok(n.acts.some((a) => a.strand === "absence" && a.key === "awol"));
    assert.ok(n.acts.some((a) => a.strand === "lateness" && a.doc === "MEMO"));
    assert.equal(n.lates.length, 3);
    assert.equal(n.absents.length, 3);

    delete S.daily.d20260825;
    const broken = hr.noticeStrands("e1353", ["2026-08"], ctxFrom(S), { awolRun: 3, absentNTE: 1 });
    assert.ok(broken.run.len < 3, "a day with no report does not count toward the AWOL run");
    assert.ok(!broken.acts.some((a) => a.key === "awol"));
  });

  it("name search matches both Last, First and First Last", () => {
    const e = emp("e1", "1250", "Armenio, Toribio D.");
    assert.equal(hr.nameMatches(e, "toribio armenio"), true);
    assert.equal(hr.nameMatches(e, "Armenio"), true);
    assert.equal(hr.nameMatches(e, "1250"), true);
    assert.equal(hr.nameMatches(e, "Pedrano"), false);
  });

  it("matches employees through empList when S is not on window", async () => {
    const employees = {
      e1250: emp("e1250", "1250", "Armenio, Toribio D."),
      e1348: emp("e1348", "1348", "Manolong, Raffy"),
      e1353: emp("e1353", "1353", "Pedrano, Jaica M."),
    };
    const daily = {};
    const windowLike = {
      empList() {
        return Object.values(employees);
      },
      async put(coll, id, obj) {
        if (coll === "daily") daily[id] = obj;
      },
    };
    windowLike.window = windowLike;
    const live = loadAttendance(windowLike);
    const stats = await live.importAttendanceJson(sampleJson());
    assert.equal(stats.rows, 3);
    assert.equal(stats.days, 1);
    assert.equal(daily.d20260829.rows.e1348.s, "Absent");
    assert.equal(
      live.effectiveStatus("e1348", "2026-08-29", "Absent", "Approved Leave (LRF2026 - 0123)", {
        employees,
        leaves: {},
        daily,
        today: "2026-08-31",
      }),
      "Leave"
    );
  });

  it("rolls a newly added person onto later days until they are marked Separated", () => {
    S.employees.e1400 = emp("e1400", "1400", "Nuevo, Ana");
    S.daily.d20260824 = {
      id: "d20260824",
      date: "2026-08-24",
      extra: ["e1400"],
      rows: { e1400: { s: "Present", r: "", site: "ADMINS" } },
    };
    const standing = [S.employees.e1250];
    const mon = hr.rosterPeopleForDay(
      { date: "2026-08-24", extra: ["e1400"], rows: S.daily.d20260824.rows },
      Object.assign(ctxFrom(S), { standing })
    );
    const tue = hr.rosterPeopleForDay(
      { date: "2026-08-25", rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    const wed = hr.rosterPeopleForDay(
      { date: "2026-08-26", rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    const sun = hr.rosterPeopleForDay(
      { date: "2026-08-23", rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    assert.ok(mon.some((e) => e.id === "e1400"), "added person is on the day they were added");
    assert.ok(tue.some((e) => e.id === "e1400"), "added person carries to Tuesday");
    assert.ok(wed.some((e) => e.id === "e1400"), "added person carries to Wednesday");
    assert.ok(!sun.some((e) => e.id === "e1400"), "must not appear before the add date");
    assert.ok(tue.some((e) => e.id === "e1250"), "standing staff still appear");

    S.employees.e1400.status = "Separated";
    S.employees.e1400.separatedOn = "2026-08-26";
    const tueStill = hr.rosterPeopleForDay(
      { date: "2026-08-25", rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    const lastDay = hr.rosterPeopleForDay(
      { date: "2026-08-26", extra: [], rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    const thuGone = hr.rosterPeopleForDay(
      { date: "2026-08-27", rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    assert.ok(tueStill.some((e) => e.id === "e1400"), "still on the day before separatedOn");
    assert.ok(lastDay.some((e) => e.id === "e1400"), "separatedOn is the last day they still appear");
    assert.ok(!thuGone.some((e) => e.id === "e1400"));
  });

  it("does not resurrect someone who was already separated before the add date", () => {
    S.employees.e1401 = Object.assign(emp("e1401", "1401", "Luma, Ben"), {
      status: "Separated",
      separatedOn: "2026-08-01",
    });
    S.daily.d20260815 = {
      id: "d20260815",
      date: "2026-08-15",
      extra: ["e1401"],
      rows: { e1401: { s: "Present", r: "", site: "ADMINS" } },
    };
    const standing = [S.employees.e1250];
    const before = hr.rosterPeopleForDay(
      { date: "2026-08-10", rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    const callback = hr.rosterPeopleForDay(
      { date: "2026-08-15", extra: ["e1401"], rows: S.daily.d20260815.rows },
      Object.assign(ctxFrom(S), { standing })
    );
    const after = hr.rosterPeopleForDay(
      { date: "2026-08-16", rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    assert.ok(!before.some((e) => e.id === "e1401"));
    assert.ok(callback.some((e) => e.id === "e1401"), "separated callback stays on the extra day");
    assert.ok(!after.some((e) => e.id === "e1401"), "separated callback does not roll forward");
  });

  it("does not put resigned or separated people back on a later or open day", () => {
    S.employees.e1402 = Object.assign(emp("e1402", "1402", "Left, Lou"), {
      status: "Resigned",
      separatedOn: "2026-08-01",
    });
    S.employees.e1403 = Object.assign(emp("e1403", "1403", "Gone, Gus"), {
      status: "separated",
    });
    S.daily.d20260824 = {
      id: "d20260824",
      date: "2026-08-24",
      extra: ["e1402", "e1403"],
      rows: {
        e1402: { s: "Present", r: "" },
        e1403: { s: "Present", r: "" },
      },
    };
    const standing = [S.employees.e1250];
    const next = hr.rosterPeopleForDay(
      { date: "2026-08-25", extra: ["e1402", "e1403"], rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    assert.ok(next.some((e) => e.id === "e1250"));
    assert.ok(!next.some((e) => e.id === "e1402"), "Resigned does not roll forward from yesterday's extra");
    assert.ok(!next.some((e) => e.id === "e1403"), "lowercase separated does not roll forward");
    assert.equal(hr.empSeparatedAsOf(S.employees.e1402, "2026-08-25"), true);
    assert.equal(hr.empSeparatedAsOf({ status: "AWOL" }, "2026-08-25"), true);
    assert.equal(hr.empSeparatedAsOf({ status: "Terminated" }, "2026-08-25"), true);
    assert.equal(hr.empSeparatedAsOf({ status: "Regular" }, "2026-08-25"), false);

    const windowLike = { window: {}, document: undefined, TODAY: "2026-08-25" };
    windowLike.window = windowLike;
    const live = loadAttendance(windowLike);
    const open = live.rosterPeopleForDay(
      { date: "2026-08-25", extra: ["e1402"], rows: { e1402: { s: "Present" } } },
      {
        employees: S.employees,
        daily: S.daily,
        standing: standing,
      }
    );
    assert.ok(!open.some((e) => e.id === "e1402"), "open monitoring day drops a snapshotted leaver");
    const called = live.rosterPeopleForDay(
      {
        date: "2026-08-25",
        extra: ["e1402"],
        callback: ["e1402"],
        rows: { e1402: { s: "Present" } },
      },
      { employees: S.employees, daily: S.daily, standing: standing }
    );
    assert.ok(called.some((e) => e.id === "e1402"), "explicit callback still shows on the open day");
  });

  it("does not invent people on a filed (fixed) historical day", () => {
    S.employees.e1400 = emp("e1400", "1400", "Nuevo, Ana");
    S.daily.d20260810 = {
      id: "d20260810",
      date: "2026-08-10",
      fixed: true,
      rows: { e1250: { s: "Present", r: "" } },
    };
    S.daily.d20260824 = {
      id: "d20260824",
      date: "2026-08-24",
      extra: ["e1400"],
      rows: { e1400: { s: "Present", r: "" } },
    };
    const filed = hr.rosterPeopleForDay(S.daily.d20260810, Object.assign(ctxFrom(S), {
      standing: [S.employees.e1250, S.employees.e1400],
    }));
    assert.equal(filed.length, 1);
    assert.equal(filed[0].id, "e1250");
    assert.ok(!filed.some((e) => e.id === "e1400"));
  });

  it("omit hides a person that day only; they still roll forward afterwards", () => {
    S.employees.e1400 = emp("e1400", "1400", "Nuevo, Ana");
    S.daily.d20260824 = {
      id: "d20260824",
      date: "2026-08-24",
      extra: ["e1400"],
      rows: { e1400: { s: "Present", r: "" } },
    };
    const standing = [S.employees.e1250];
    const tue = hr.rosterPeopleForDay(
      { date: "2026-08-25", omit: ["e1400"], rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    const wed = hr.rosterPeopleForDay(
      { date: "2026-08-26", rows: {} },
      Object.assign(ctxFrom(S), { standing })
    );
    assert.ok(!tue.some((e) => e.id === "e1400"));
    assert.ok(wed.some((e) => e.id === "e1400"));
  });

  it("wraps artifact dailyPeople so a parked extra appears on the next blank day", () => {
    const employees = {
      e1250: emp("e1250", "1250", "Armenio, Toribio D."),
      e1400: emp("e1400", "1400", "Nuevo, Ana"),
    };
    const daily = {
      d20260824: {
        id: "d20260824",
        date: "2026-08-24",
        extra: ["e1400"],
        rows: { e1400: { s: "Present", r: "" } },
      },
    };
    const windowLike = {
      S: { employees, daily, leaves: {} },
      atWork() {
        return [employees.e1250];
      },
      dailyPeople(rec) {
        const omit = new Set(rec.omit || []);
        const list = this.atWork().filter((e) => !omit.has(e.id));
        (rec.extra || []).forEach((id) => {
          const e = employees[id];
          if (e && !list.some((x) => x.id === e.id)) list.push(e);
        });
        return list;
      },
    };
    windowLike.window = windowLike;
    const live = loadAttendance(windowLike);
    live.install();
    const tue = windowLike.dailyPeople({ date: "2026-08-25", rows: {} });
    assert.ok(tue.some((e) => e.id === "e1400"));
    assert.equal(typeof windowLike.dailyPeople.__hrAttRoster, "boolean");
  });

  it("rejects invalid JSON paste payloads", () => {
    assert.throws(() => hr.normalizeImportPayload("not json"), /not valid JSON/);
    assert.throws(() => hr.normalizeImportPayload({ foo: 1 }), /array of daily reports/);
    assert.throws(() => hr.normalizeImportPayload([{ rows: [] }]), /no date/);
  });
});

describe("attendance reason types", () => {
  let hr;
  let S;

  beforeEach(() => {
    const windowLike = { window: {}, document: undefined };
    windowLike.window = windowLike;
    hr = loadAttendance(windowLike);
    S = stores();
  });

  it("catalogues absence / late / undertime picks with an excused flag", () => {
    assert.ok(hr.REASON_CATALOG.length >= 10);
    assert.ok(hr.REASON_CATALOG.every((r) => typeof r.excused === "boolean"));
    assert.ok(hr.statusNeedsReason("Absent"));
    assert.ok(hr.statusNeedsReason("Present/Late"));
    assert.ok(hr.statusNeedsReason("Undertime"));
    assert.equal(hr.statusNeedsReason("Present"), false);
    const late = hr.reasonsForStatus("Present/Late");
    assert.ok(late.some((r) => r.k === "traffic" && r.excused === false));
    assert.ok(late.some((r) => r.k === "ob" && r.excused === true));
    assert.ok(late.some((r) => r.k === "other"));
    const absent = hr.reasonsForStatus("Absent");
    assert.ok(absent.some((r) => r.k === "sick" && r.excused === true));
    assert.ok(absent.some((r) => r.k === "awol" && r.excused === false));
  });

  it("matches imported free-text onto a pick", () => {
    assert.equal(hr.matchReasonKey("Present/Late", "traffic"), "traffic");
    assert.equal(hr.matchReasonKey("Absent", "AWOL"), "awol");
    assert.equal(hr.matchReasonKey("Absent", "Sick / medical"), "sick");
    assert.equal(hr.matchReasonKey("Absent", "Approved Leave (LRF2026 - 0123)"), "al");
    assert.equal(hr.matchReasonKey("Present/Late", ""), "");
  });

  it("excuses a catalog sick day and leaves AWOL unexcused", () => {
    const ctx = ctxFrom(S);
    S.daily.d20260829 = {
      id: "d20260829",
      date: "2026-08-29",
      rows: {
        e1353: { s: "Absent", r: "Sick / medical", rk: "sick", ex: 1 },
        e1250: { s: "Absent", r: "AWOL / no call, no show", rk: "awol", ex: 0 },
      },
    };
    assert.equal(hr.effectiveStatus("e1353", "2026-08-29", "Absent", "Sick / medical", ctx), "Leave");
    const sick = hr.absenceExcuse("e1353", "2026-08-29", "Sick / medical", ctx);
    assert.equal(sick.kind, "reason");
    assert.equal(sick.key, "sick");
    assert.equal(hr.effectiveStatus("e1250", "2026-08-29", "Absent", "AWOL / no call, no show", ctx), "Absent");
    assert.equal(hr.absenceExcuse("e1250", "2026-08-29", "AWOL / no call, no show", ctx), null);
  });

  it("Other can be flagged excused without a leave form", () => {
    const ctx = ctxFrom(S);
    S.daily.d20260829 = {
      id: "d20260829",
      date: "2026-08-29",
      rows: { e1353: { s: "Absent", r: "barangay meeting", rk: "other", ex: 1 } },
    };
    const excuse = hr.rowExcuse("e1353", "2026-08-29", S.daily.d20260829.rows.e1353, ctx);
    assert.ok(excuse);
    assert.equal(excuse.kind, "reason");
    assert.equal(hr.effectiveStatus("e1353", "2026-08-29", "Absent", "barangay meeting", ctx), "Leave");
  });

  it("does not count an excused late toward an NTE strand", () => {
    S.daily.d20260824 = {
      id: "d20260824",
      date: "2026-08-24",
      rows: { e1353: { s: "Present/Late", r: "Official business", rk: "ob", ex: 1 } },
    };
    S.daily.d20260825 = {
      id: "d20260825",
      date: "2026-08-25",
      rows: { e1353: { s: "Present/Late", r: "Traffic", rk: "traffic", ex: 0 } },
    };
    const ctx = ctxFrom(S);
    const strands = hr.noticeStrands("e1353", ["2026-08"], ctx, { lateReminder: 1, lateNTE: 99 });
    assert.equal(strands.lates.length, 1);
    assert.equal(strands.lates[0], "2026-08-25");
    assert.ok(strands.acts.some((a) => a.key === "late"));
  });

  it("keeps reason key and excused flag when merging a day row", () => {
    const next = hr.mergeDayRow
      ? hr.mergeDayRow({ s: "Absent", r: "old" }, { status: "Absent", reason: "Sick / medical", rk: "sick" })
      : null;
    if (!hr.mergeDayRow) {
      const row = hr.applyReasonFields({ s: "Absent", r: "Sick / medical", rk: "sick" });
      assert.equal(row.rk, "sick");
      assert.equal(row.ex, 1);
      return;
    }
    assert.equal(next.rk, "sick");
    assert.equal(next.ex, 1);
    assert.equal(next.r, "Sick / medical");
  });

  it("collects Other text plus the excused pick from the overlay", () => {
    const got = hr.collectReasonFromUi("e1", { s: "Absent", r: "typed later" });
    assert.equal(got.r, "typed later");
  });
});

describe("hr-attendance companion wiring", () => {
  it("is not loaded by the shim and not referenced from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.doesNotMatch(shim, /hr-attendance\.js/);
    assert.doesNotMatch(shim, /data-hr-attendance/);
    assert.doesNotMatch(html, /<script[^>]+hr-attendance\.js/);
  });

  it("installs paste-door chrome on the daily and analytics screens", () => {
    const created = [];
    const nodes = [];
    function el(tag, attrs) {
      const node = {
        tag: String(tag).toLowerCase(),
        tagName: String(tag).toUpperCase(),
        attrs: Object.assign({}, attrs),
        children: [],
        parentNode: null,
        className: "",
        id: (attrs && attrs.id) || "",
        textContent: "",
        innerHTML: "",
        style: {},
        options: [],
        onclick: null,
        listeners: {},
        querySelector(sel) {
          if (sel.startsWith("#") && this.id === sel.slice(1)) return this;
          if (sel === "[data-dms]" && this.attrs && this.attrs["data-dms"]) return this;
          for (const child of this.children) {
            const hit = child.querySelector(sel);
            if (hit) return hit;
          }
          return null;
        },
        querySelectorAll(sel) {
          const out = [];
          if (sel.startsWith("#") && this.id === sel.slice(1)) out.push(this);
          if (sel === "[data-dms]" && this.attrs && this.attrs["data-dms"]) out.push(this);
          if (sel === ".sect-h h2" && this.tagName === "H2" && this.parentNode && String(this.parentNode.className).includes("sect-h")) {
            out.push(this);
          }
          this.children.forEach((c) => {
            out.push.apply(out, c.querySelectorAll(sel));
          });
          return out;
        },
        closest(sel) {
          let cur = this;
          while (cur) {
            if (sel === ".row" && String(cur.className).split(/\s+/).includes("row")) return cur;
            if (sel === "table" && cur.tagName === "TABLE") return cur;
            if (sel === "tr" && cur.tagName === "TR") return cur;
            if (sel === "td" && cur.tagName === "TD") return cur;
            if (sel === ".sect-h" && String(cur.className).split(/\s+/).includes("sect-h")) return cur;
            cur = cur.parentNode;
          }
          return null;
        },
        appendChild(child) {
          child.parentNode = this;
          this.children.push(child);
          return child;
        },
        insertBefore(child, before) {
          child.parentNode = this;
          const idx = this.children.indexOf(before);
          if (idx < 0) this.children.push(child);
          else this.children.splice(idx, 0, child);
          return child;
        },
        insertAdjacentElement(where, child) {
          if (where === "afterend" && this.parentNode) {
            const idx = this.parentNode.children.indexOf(this);
            child.parentNode = this.parentNode;
            this.parentNode.children.splice(idx + 1, 0, child);
          }
          return child;
        },
        addEventListener(type, fn) {
          this.listeners[type] = this.listeners[type] || [];
          this.listeners[type].push(fn);
        },
        setAttribute(name, value) {
          this.attrs[name] = String(value);
          if (name === "id") this.id = String(value);
        },
        getAttribute(name) {
          return this.attrs[name] == null ? null : this.attrs[name];
        },
      };
      if (attrs && attrs.id) node.id = attrs.id;
      nodes.push(node);
      return node;
    }

    const view = el("div", { id: "view" });
    const row = el("div", { class: "row" });
    row.className = "row";
    const date = el("input", { id: "dm-date" });
    const ia = el("button", { id: "ia-start" });
    const monthH = el("div", {});
    monthH.className = "sect-h";
    const h2 = el("h2", {});
    h2.textContent = "Month by month";
    const monthCard = el("div", {});
    monthCard.className = "card";
    monthH.appendChild(h2);
    row.appendChild(date);
    row.appendChild(ia);
    view.appendChild(row);
    view.appendChild(monthH);
    view.appendChild(monthCard);
    date.closest = function (sel) {
      return sel === ".row" ? row : null;
    };

    const byId = {
      view,
      "dm-date": date,
      "ia-start": ia,
      "hr-attendance-styles": null,
    };

    const document = {
      readyState: "complete",
      head: el("head"),
      documentElement: el("html"),
      body: el("body"),
      getElementById(id) {
        if (id === "view") return view;
        if (id === "dm-date") return date;
        if (id === "ia-start") return ia;
        if (id === "hr-attendance-styles") return byId["hr-attendance-styles"];
        if (id === "hr-att-summary") return view.querySelector("#hr-att-summary");
        return null;
      },
      querySelector(sel) {
        if (sel === "#dm-date") return date;
        if (sel === "#ia-start") return ia;
        if (sel === "#view") return view;
        if (sel === "#hr-att-summary") return view.querySelector("#hr-att-summary");
        return view.querySelector(sel);
      },
      querySelectorAll(sel) {
        if (sel === "#view [data-dms]") return [];
        if (sel === "#view .tw table") return [];
        return view.querySelectorAll(sel);
      },
      createElement(tag) {
        const node = el(tag);
        created.push(node);
        return node;
      },
      addEventListener() {},
    };

    const windowLike = {
      document,
      S: {
        ui: { view: "insights", insightMonths: 6, insightMonth: "2026-08" },
        daily: {
          d20260829: {
            id: "d20260829",
            date: "2026-08-29",
            rows: { e1250: { s: "Present", r: "" } },
          },
        },
        employees: { e1250: emp("e1250", "1250", "Armenio, Toribio D.") },
        leaves: {},
      },
      TODAY: "2026-08-31",
      lastMonths() {
        return ["2026-08"];
      },
      render() {},
    };
    windowLike.window = windowLike;

    const hr = loadAttendance(windowLike);
    hr.install(windowLike);

    assert.ok(row.children.some((c) => c.id === "hr-att-paste-daily"));
    assert.ok(row.children.some((c) => c.id === "hr-att-paste-insights"));
    const summary = view.children.find((c) => c.id === "hr-att-summary");
    assert.ok(summary, "summary table is injected on analytics");
    assert.match(summary.innerHTML, /Manpower attendance summary/);
    assert.match(summary.innerHTML, /1250/);
    assert.equal(typeof hr.openPasteDoor, "function");
  });
});
