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

function loadDay() {
  const ctx = {
    S: {
      daily: {},
      employees: {},
      settings: {},
      ui: { dailyDate: "2026-10-02", view: "daily" },
      roles: {},
    },
    TODAY: "2026-10-04",
    KNOWN_SEP: null,
    FIRST_ADDED: null,
    LAST_SITE_IX: null,
    STATUS_PENDING: "Has not yet arrived",
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
    },
    clone(o) {
      return JSON.parse(JSON.stringify(o));
    },
    empList() {
      return Object.values(ctx.S.employees);
    },
    dailyGet(d) {
      return ctx.S.daily["d" + String(d).replace(/-/g, "")] || null;
    },
    atWork() {
      return Object.values(ctx.S.employees);
    },
    flipName(n) {
      const p = String(n || "").split(",");
      return p.length > 1 ? p[1].trim() + " " + p[0].trim() : String(n || "");
    },
    document: {
      querySelector(sel) {
        if (String(sel).indexOf("data-dmdate") >= 0) {
          return { getAttribute: () => "2026-10-02" };
        }
        return null;
      },
    },
  };
  const names = [
    "knownSepRec",
    "statusTextIsSeparated",
    "empStatusIsLive",
    "empStatusIsSeparated",
    "separatedSnapIsStale",
    "employeeLiveBeatsSeparatedSnap",
    "sepRosterWouldApply",
    "dayIsOpen",
    "openDayKeepsLeaver",
    "stripOpenDayLeavers",
    "empSeparatedAsOf",
    "empHireDate",
    "empNotYetHired",
    "rowHasEnteredData",
    "dailyRowShown",
    "empPosition",
    "dayStatusOf",
    "contribHoldMatches",
    "keepContribHold",
    "dateInputValue",
    "keepEmpDateEdits",
    "blankStatusIsIntentional",
    "empEnteredFieldNames",
    "keepEmpEnteredFields",
    "mergeIncomingDoc",
    "hrSigSrc",
    "lastSiteBefore",
    "firstAddedIndex",
    "dailySiteOf",
    "dailyPeople",
    "dailyGroups",
    "persistRosterOnDay",
    "applyHrSigsToRec",
    "mergeIdList",
    "mergeDailyRowKeep",
    "dailyEditStamp",
    "dailyIncomingNewer",
    "lastRosterLayout",
    "dailyOrderOf",
    "dailySiteOrderOf",
    "sortByRosterOrder",
    "nameLastFirst",
    "normStatus",
    "dayCredit",
    "canonDayStatus",
    "attendanceRowBlank",
    "normPersonName",
    "personMatchKey",
    "summaryPersonId",
    "savedAttendanceRow",
    "dailyRow",
    "dailyOtHoursOf",
    "fmtOtHrs",
    "dailyOtTotal",
    "dailySheetDate",
    "parseOtHours",
    "cmpEmpAlpha",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function people() {
  return {
    e1: { id: "e1", empNo: "1250", name: "Santos, Ben", status: "Regular", project: "Danlag" },
    e2: { id: "e2", empNo: "1348", name: "Manolong, Raffy", status: "Regular", project: "ADMINS" },
    e3: { id: "e3", empNo: "1353", name: "Pedrano, Jaica M.", status: "Regular", project: "TAWASON" },
  };
}

describe("2026-10-04a reopen a saved day and show its OT total", () => {
  it("is build 2026-10-04a and shows OT total hrs on the day, the reports list, and the print", () => {
    assert.match(html, /const BUILD = "2026-10-04a"/);
    assert.match(html, /OT total hrs","pending hours included"/);
    assert.match(html, />OT total hrs<\/th>/);
    assert.match(extractFunction(html, "printDaily"), /OT total hrs/);
    assert.match(extractFunction(html, "dailyOtTotal"), /dailyOtHoursOf/);
    assert.doesNotMatch(extractFunction(html, "dailyOtTotal"), /otPaidHours|otCovered/);
    assert.match(html, /Pending OT form/);
    assert.match(extractFunction(html, "payLine"), /otPaidHours/);
    const open = extractFunction(html, "openDailyDate");
    assert.ok(open.indexOf("captureDailyForm()") < open.indexOf("S.ui.dailyDate=next"));
    assert.match(extractFunction(html, "dailyCollect"), /dailySheetDate\(\)/);
    assert.match(extractFunction(html, "dailyCollect"), /parseOtHours\(g\("data-dmot"\)\)/);
  });

  it("reads a saved late and OT by id, employee number, or printed name, and does not stamp Present", () => {
    const ctx = loadDay();
    ctx.S.employees = people();
    assert.equal(ctx.normStatus("Late"), "Present/Late");
    assert.equal(ctx.normStatus("Present (Late)"), "Present/Late");
    assert.equal(ctx.normStatus("tardy"), "Present/Late");
    assert.equal(ctx.dayStatusOf({ s: "Late" }), "Present/Late");
    assert.equal(ctx.dayStatusOf({ status: "Present (Late)" }), "Present/Late");
    assert.equal(ctx.dayStatusOf({ s: "" }), "Present");

    const byId = {
      date: "2026-10-02",
      rows: { e1: { s: "Late", ot: 2, in: "8:15 AM" } },
      extra: [],
      omit: [],
    };
    const shownId = ctx.dailyRow(byId, ctx.S.employees.e1);
    assert.equal(byId.rows.e1.s, "Late");
    assert.notEqual(shownId, byId.rows.e1);
    assert.equal(shownId.s, "Present/Late");
    assert.equal(shownId.ot, 2);

    const blankStored = { s: "", r: "", ot: null };
    const blankDay = { date: "2026-10-02", rows: { e1: blankStored }, extra: [], omit: [] };
    const shownBlank = ctx.dailyRow(blankDay, ctx.S.employees.e1);
    assert.equal(blankStored.s, "");
    assert.equal(shownBlank.s, "Present");

    const byNo = {
      date: "2026-10-02",
      rows: {
        e2: { s: "Present", r: "", in: "", out: "", ot: null },
        1348: { s: "Late", ot: 3, in: "8:22 AM", empNo: "1348" },
      },
      extra: [],
      omit: [],
    };
    const shownNo = ctx.dailyRow(byNo, ctx.S.employees.e2);
    assert.equal(shownNo.s, "Present/Late");
    assert.equal(shownNo.ot, 3);
    assert.equal(byNo.rows.e2.s, "Present");
    assert.equal(byNo.rows.e2.ot, null);

    const byName = {
      date: "2026-10-02",
      rows: {
        e3: { s: "Present" },
        "Pedrano, Jaica": { s: "Present (Late)", ot: 1.5, name: "Pedrano, Jaica", otHours: "" },
      },
      extra: [],
      omit: [],
    };
    const shownName = ctx.dailyRow(byName, ctx.S.employees.e3);
    assert.equal(shownName.s, "Present/Late");
    assert.equal(shownName.ot, 1.5);
    assert.equal(byName.rows.e3.s, "Present");

    const adopted = {
      date: "2026-10-02",
      rows: {
        e2: { s: "Present" },
        1348: { s: "Late", ot: 3, in: "8:22 AM" },
      },
      extra: ["e2"],
      omit: [],
    };
    ctx.persistRosterOnDay(adopted);
    assert.equal(adopted.rows.e2.s, "Present/Late");
    assert.equal(adopted.rows.e2.ot, 3);
    assert.notEqual(adopted.rows.e2.s, "Present");
  });

  it("keeps a saved late when a blank or same-age snapshot arrives, and lets a newer copy win", () => {
    const ctx = loadDay();
    ctx.S.employees = people();
    const local = {
      date: "2026-10-02",
      editedOn: "2026-10-02 09:00",
      rows: { e1: { s: "Present (Late)", ot: 2, in: "8:20 AM" } },
      extra: [],
      omit: [],
    };
    const blank = {
      date: "2026-10-02",
      rows: { e1: { s: "Present" } },
      extra: [],
      omit: [],
    };
    const keptBlank = ctx.mergeIncomingDoc("daily", blank, local);
    assert.equal(keptBlank.rows.e1.s, "Present/Late");
    assert.equal(keptBlank.rows.e1.ot, 2);

    const sameAge = {
      date: "2026-10-02",
      editedOn: "2026-10-02 09:00",
      rows: { e1: { s: "Present", ot: "" } },
      extra: [],
      omit: [],
    };
    const keptSame = ctx.mergeIncomingDoc("daily", sameAge, local);
    assert.equal(keptSame.rows.e1.s, "Present/Late");
    assert.equal(keptSame.rows.e1.ot, 2);

    const newer = {
      date: "2026-10-02",
      editedOn: "2026-10-02 11:30",
      rows: { e1: { s: "Absent", r: "AWOL" } },
      extra: [],
      omit: [],
    };
    assert.equal(ctx.mergeIncomingDoc("daily", newer, local).rows.e1.s, "Absent");

    const newerPresent = {
      date: "2026-10-02",
      editedOn: "2026-10-02 12:00",
      rows: { e1: { s: "Present" } },
      extra: [],
      omit: [],
    };
    assert.equal(ctx.mergeIncomingDoc("daily", newerPresent, local).rows.e1.s, "Present");
  });

  it("totals every OT hour for the selected day, including hours still pending a form", () => {
    const ctx = loadDay();
    ctx.S.employees = people();
    const rec = {
      date: "2026-10-02",
      rows: {
        e1: { s: "Present", ot: 2, site: "Danlag" },
        e2: { s: "Present", site: "ADMINS" },
        1348: { s: "Late", ot: 3, site: "ADMINS" },
        "Pedrano, Jaica": { s: "Present (Late)", ot: 1.5, site: "TAWASON" },
        e3: { s: "Present", site: "TAWASON" },
      },
      extra: [],
      omit: [],
    };
    assert.equal(ctx.dailyOtHoursOf({ ot: "" }), 0);
    assert.equal(ctx.dailyOtHoursOf({ ot: 0 }), 0);
    assert.equal(ctx.dailyOtHoursOf({ otHours: 4 }), 4);
    assert.equal(ctx.dailyOtTotal(rec), 6.5);
    assert.equal(ctx.fmtOtHrs(ctx.dailyOtTotal(rec)), "6.5");
    assert.equal(ctx.dailySheetDate(), "2026-10-02");
    ctx.S.ui.dailyDate = "2026-10-03";
    assert.equal(ctx.dailySheetDate(), "2026-10-02");
    assert.equal(ctx.parseOtHours(""), null);
    assert.equal(ctx.parseOtHours("   "), null);
    assert.equal(ctx.parseOtHours("0"), 0);
    assert.equal(ctx.parseOtHours("2.5"), 2.5);
  });
});
