"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

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

function loadRoster() {
  const ctx = {
    S: { employees: {}, settings: { hrStaff: "Maria Trina Cassandra A. Moran" }, ui: {}, daily: {} },
    TODAY: "2026-10-03",
    KNOWN_SEP: null,
    ENGAGEMENT_CHECKED: "",
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
    },
    clone(o) {
      return JSON.parse(JSON.stringify(o));
    },
    async putMany() {
      ctx.saved = true;
    },
  };
  const names = [
    "statusTextIsSeparated",
    "empStatusIsLive",
    "empStatusIsSeparated",
    "knownSepRec",
    "empSeparatedAsOf",
    "empHireDate",
    "empSeparationDate",
    "nameLastFirst",
    "cmpEmpAlpha",
    "empRosterName",
    "empAlpha",
    "ownLastDay",
    "liveStatusBeatsLastDay",
    "empPastLastDay",
    "manilaToday",
    "shouldAutoSeparate",
    "leavingBadge",
    "lastDayHint",
    "applyEngagementStatus",
    "payPersonListed",
    "payKindOf",
    "payRosterInclude",
    "payDayAfterSeparation",
    "leaverStatusWithPastDate",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

describe("2026-10-03b alphabetical roster and last day of engagement", () => {
  it("is build 2026-10-05a and shows Last day of engagement on the 201 file", () => {
    assert.match(html, /const BUILD = "2026-10-07c"/);
    assert.match(html, /Last day of engagement/);
    assert.match(html, /id="roster-sep-bottom"/);
    assert.match(html, /Leaving on /);
    assert.match(html, /function cmpEmpAlpha/);
    assert.match(html, /function shouldAutoSeparate/);
    assert.match(extractFunction(html, "viewEmployees"), /empRosterName/);
    assert.match(extractFunction(html, "empInfo"), /f-separatedOn/);
    assert.doesNotMatch(extractFunction(html, "empInfo"), /Separated on/);
    assert.match(extractFunction(html, "dailyGroups"), /cmpEmpAlpha/);
    assert.match(extractFunction(html, "payPeople"), /cmpEmpAlpha/);
    assert.match(extractFunction(html, "viewContrib"), /cmpEmpAlpha/);
    assert.match(extractFunction(html, "viewSalaries"), /cmpEmpAlpha/);
  });

  it("sorts surname then first name, ignoring case and accents, and keeps ties stable", () => {
    const ctx = loadRoster();
    const rows = [
      { id: "b", empNo: "2", name: "Cabarrubias, John Mark" },
      { id: "a2", empNo: "9", name: "adiong, christine joy a." },
      { id: "a1", empNo: "1", name: "Adiong, Christine Joy A." },
      { id: "n", empNo: "3", name: "Ñuñez, Ana" },
      { id: "u", empNo: "4", name: "Nunez, Ana" },
      { id: "z", empNo: "8", name: "Olandag, Rema" },
      { id: "y", empNo: "7", name: "Moran, Maria" },
    ];
    const sorted = rows.slice().sort(ctx.cmpEmpAlpha);
    assert.equal(sorted.map((e) => e.id).join(","), "a1,a2,b,y,n,u,z");
    assert.equal(ctx.empRosterName({ name: "John Mark Cabarrubias" }), "Cabarrubias, John Mark");
    assert.equal(ctx.empRosterName({ name: "Adiong, Christine Joy A." }), "Adiong, Christine Joy A.");
    const mixed = ctx.empAlpha(
      [
        { id: "s", name: "Zeta, Sue", status: "Separated" },
        { id: "l", name: "Alpha, Ann", status: "Regular" },
        { id: "g", name: "Beta, Bea", status: "Separated" },
      ],
      true
    );
    assert.equal(mixed.map((e) => e.id).join(","), "l,g,s");
  });

  it("keeps the last day on attendance and payroll, and the next day off", () => {
    const ctx = loadRoster();
    const left = { id: "left", empNo: "10", name: "Resigned, Rio", status: "Resigned", separatedOn: "2026-08-24" };
    assert.equal(ctx.empSeparatedAsOf(left, "2026-08-24"), false);
    assert.equal(ctx.empSeparatedAsOf(left, "2026-08-25"), true);
    assert.equal(ctx.payDayAfterSeparation(left, "2026-08-24"), false);
    assert.equal(ctx.payDayAfterSeparation(left, "2026-08-25"), true);
    assert.equal(ctx.payRosterInclude(left, { from: "2026-08-20", to: "2026-08-26" }), true);
    assert.equal(ctx.payRosterInclude(left, { from: "2026-08-25", to: "2026-08-31" }), false);
    assert.equal(ctx.leaverStatusWithPastDate(left, "2026-08-24"), false);
    assert.equal(ctx.leaverStatusWithPastDate(left, "2026-08-25"), true);
    assert.equal(ctx.empPastLastDay(left, "2026-08-24"), false);
    assert.equal(ctx.empPastLastDay(left, "2026-08-25"), true);
  });

  it("does not re-separate a live status that is newer than a leftover date", () => {
    const ctx = loadRoster();
    const ben = {
      id: "ben",
      empNo: "1351",
      name: "Pasion, Ben",
      status: "Project-based",
      separatedOn: "2026-09-02",
    };
    assert.equal(ctx.liveStatusBeatsLastDay(ben), true);
    assert.equal(ctx.empPastLastDay(ben, "2026-10-03"), false);
    assert.equal(ctx.shouldAutoSeparate(ben, "2026-10-03"), false);
    assert.equal(ctx.leavingBadge(ben), "");
    assert.equal(ctx.payDayAfterSeparation(ben, "2026-09-03"), false);
    assert.equal(ctx.payRosterInclude(ben, { from: "2026-09-10", to: "2026-09-16" }), true);

    const stampedThenStatus = {
      id: "later",
      name: "Later, Lea",
      status: "Regular",
      separatedOn: "2026-09-01",
      separatedOnEditedOn: "2026-09-01T00:00:00.000Z",
      statusEditedOn: "2026-09-15T00:00:00.000Z",
    };
    assert.equal(ctx.liveStatusBeatsLastDay(stampedThenStatus), true);
    assert.equal(ctx.shouldAutoSeparate(stampedThenStatus, "2026-10-03"), false);
    assert.equal(ctx.empPastLastDay(stampedThenStatus, "2026-10-03"), false);

    const statusThenDate = {
      id: "soon",
      name: "Soon, Sam",
      status: "Regular",
      separatedOn: "2026-10-03",
      statusEditedOn: "2026-09-01T00:00:00.000Z",
      separatedOnEditedOn: "2026-10-02T00:00:00.000Z",
      separatedOnBy: "Maria Trina Cassandra A. Moran",
    };
    assert.equal(ctx.liveStatusBeatsLastDay(statusThenDate), false);
    assert.equal(ctx.shouldAutoSeparate(statusThenDate, "2026-10-03"), false);
    /* The badge is only for a last day that is still today or ahead. Pin Manila
       so this does not flip the day the calendar passes 2026-10-03. */
    ctx.manilaToday = () => "2026-10-03";
    assert.equal(ctx.leavingBadge(statusThenDate), "Leaving on 2026-10-03");
    assert.equal(ctx.empPastLastDay(statusThenDate, "2026-10-03"), false);
    assert.equal(ctx.empPastLastDay(statusThenDate, "2026-10-04"), true);
    assert.equal(ctx.payDayAfterSeparation(statusThenDate, "2026-10-03"), false);
    assert.equal(ctx.payDayAfterSeparation(statusThenDate, "2026-10-04"), true);
    assert.equal(ctx.shouldAutoSeparate(statusThenDate, "2026-10-04"), true);
  });

  it("marks Separated the day after a stamped last day and names who entered it", async () => {
    const ctx = loadRoster();
    const e = {
      id: "e1",
      name: "Jamago, Rica D.",
      status: "Probationary",
      separatedOn: "2026-10-02",
      separatedOnEditedOn: "2026-10-02T01:00:00.000Z",
      separatedOnBy: "Maria Trina Cassandra A. Moran",
      notes: "",
    };
    ctx.S.employees.e1 = e;
    const n = await ctx.applyEngagementStatus([e]);
    assert.equal(n, 1);
    assert.equal(ctx.S.employees.e1.status, "Separated");
    assert.match(ctx.S.employees.e1.statusBasis, /Marked separated/i);
    assert.match(ctx.S.employees.e1.separationAudit, /Maria Trina Cassandra A. Moran/);
    assert.match(ctx.S.employees.e1.notes, /Maria Trina Cassandra A. Moran/);
    assert.equal(ctx.shouldAutoSeparate(ctx.S.employees.e1, "2026-10-04"), false);

    const future = {
      id: "e2",
      name: "Monte, Domingo C.",
      status: "Regular",
      separatedOn: "2026-10-10",
      separatedOnEditedOn: "2026-10-01T00:00:00.000Z",
    };
    assert.equal(await ctx.applyEngagementStatus([future]), 0);
    assert.equal(future.status, "Regular");
    assert.match(ctx.lastDayHint({ lastDayCleared: true, status: "Separated", separatedOn: "" }), /stays Separated/);
  });
});
