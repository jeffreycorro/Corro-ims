"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");
const checklist = require("../public/hr-201-checklist");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const forms = fs.readFileSync(path.join(__dirname, "../public/hr-forms-fix.js"), "utf8");

const REHIRED = "Project-Based (Rehired)";
const PROJECT = "Project-based";

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

function estatFromHtml() {
  const m = html.match(/const ESTAT = (\[[^\]]+\]);/);
  if (!m) throw new Error("missing ESTAT");
  return vm.runInNewContext(m[1]);
}

function isoDate(t) {
  return (
    t.getFullYear() +
    "-" +
    String(t.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(t.getDate()).padStart(2, "0")
  );
}

function loadMerge() {
  const names = [
    "dateInputValue",
    "statusTextIsSeparated",
    "empStatusIsLive",
    "empStatusIsSeparated",
    "separatedSnapIsStale",
    "employeeLiveBeatsSeparatedSnap",
    "blankStatusIsIntentional",
    "empEnteredFieldNames",
    "employeeFilledBeatsBlankSnap",
    "employeeSnapNeedsRepair",
    "keepEmpDateEdits",
    "keepEmpEnteredFields",
    "contribHoldMatches",
    "keepContribHold",
    "mergeIncomingDoc",
  ];
  const ctx = { isoDate, EMP_DIRTY: {} };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function loadRoster() {
  const ctx = {
    S: { employees: {}, daily: {}, ui: { dailyDate: "2026-10-05" }, settings: {} },
    TODAY: "2026-10-05",
    KNOWN_SEP: {
      1402: { separatedOn: "2026-08-01", separationReason: "End of project" },
    },
    FIRST_ADDED: null,
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
    },
    sortByRosterOrder(list) {
      return list;
    },
    dailyOrderOf() {
      return [];
    },
    dailyRowShown() {
      return true;
    },
    dayIsOpen() {
      return true;
    },
    openDayKeepsLeaver() {
      return false;
    },
    firstAddedIndex() {
      return {};
    },
    atWork() {
      return Object.values(ctx.S.employees);
    },
  };
  const names = [
    "knownSepRec",
    "statusTextIsSeparated",
    "empStatusIsLive",
    "empStatusIsSeparated",
    "empSeparatedAsOf",
    "ownLastDay",
    "liveStatusBeatsLastDay",
    "empPastLastDay",
    "sepRosterWouldApply",
    "dailyPeople",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function loadPay() {
  const ctx = {
    S: { employees: {}, daily: {}, settings: {} },
    TODAY: "2026-10-05",
    KNOWN_SEP: {
      1402: { separatedOn: "2026-08-01", separationReason: "End of project" },
    },
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
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
    "ownLastDay",
    "liveStatusBeatsLastDay",
    "empPastLastDay",
    "shouldAutoSeparate",
    "payPersonListed",
    "payKindOf",
    "payRosterInclude",
    "leaverStatusWithPastDate",
    "contribEngaged",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function loadContract() {
  const ctx = {
    S: { settings: { contractWarnDays: 30, probationWarnDays: 30 } },
    daysFromToday(d) {
      if (d === "2026-12-01") return 40;
      if (d === "2026-01-01") return -5;
      return 0;
    },
    probationEnd() {
      return "2026-12-01";
    },
    fmtSpan(d) {
      return String(d) + " days";
    },
  };
  vm.runInNewContext(
    ["statusIsProjectBased", "contractState"].map((n) => extractFunction(html, n)).join("\n"),
    ctx
  );
  return ctx;
}

const SEP_DOCS = [
  { k: "contract", n: "Employment Contract", g: "Employment" },
  { k: "resign", n: "Resignation Letter", g: "Separation", opt: 1 },
  { k: "clearance", n: "Employee Clearance Form", g: "Separation", opt: 1 },
];

describe("2026-10-05a Project-Based (Rehired)", () => {
  it("is build 2026-10-05a and offers the rehired status beside Project-based", () => {
    assert.match(html, /const BUILD = "2026-10-05a"/);
    const estat = Array.from(estatFromHtml());
    assert.deepEqual(estat, [
      "Probationary",
      "Regular",
      PROJECT,
      REHIRED,
      "Fixed-term",
      "Consultant",
      "Separated",
    ]);
    assert.match(html, /function statusIsProjectBased\(/);
    assert.match(html, /fld\("Employment status","status",e\.status,"select",\[""\]\.concat\(ESTAT\)\)/);
    assert.match(html, /Set employment status to[\s\S]{0,240}ESTAT\.filter\(x=>x!=="Separated"\)/);
    assert.match(html, /id="hr-status"[\s\S]{0,160}ESTAT\.filter\(x=>x!=="Separated"\)/);
    assert.match(html, /id="rr-status"[\s\S]{0,200}ESTAT\.filter\(x=>x!=="Separated"\)/);
    assert.match(html, /if\(t==="STATUS"\) return ESTAT;/);
    assert.match(extractFunction(html, "contractState"), /statusIsProjectBased\(e\.status\)/);
    assert.match(html, /e\.contractEnd && \(statusIsProjectBased\(e\.status\)/);
    assert.match(forms, /\/project\/i\.test\(emp\.status/);
    assert.match(REHIRED, /project/i);
    assert.match(PROJECT, /project/i);
  });

  it("shows the new option on the 201 status picker and keeps a stored Project-based value selected", () => {
    const fld = extractFunction(html, "fld");
    const ctx = {
      esc(s) {
        return String(s == null ? "" : s);
      },
    };
    vm.runInNewContext(fld, ctx);
    const opts = [""].concat(estatFromHtml());
    const rehired = ctx.fld("Employment status", "status", REHIRED, "select", opts);
    assert.match(rehired, new RegExp("selected>" + REHIRED.replace(/[()]/g, "\\$&")));
    const kept = ctx.fld("Employment status", "status", PROJECT, "select", opts);
    assert.match(kept, /selected>Project-based</);
    assert.doesNotMatch(kept, /selected>Project-Based \(Rehired\)</);
    assert.match(kept, /Project-Based \(Rehired\)/);
  });

  it("saves Project-Based (Rehired) on the 201 file and keeps it across a stale Separated snapshot", () => {
    const emp = { id: "e1402", empNo: "1402", name: "Alquizalas, John Mark", status: PROJECT, statusBasis: "" };
    const ctx = {
      isoDate,
      S: { employees: { e1402: emp }, ui: { emp: "e1402" }, settings: {} },
      flipName(n) {
        return n;
      },
    };
    vm.runInNewContext(
      ["dateInputValue", "applyEmpField"].map((n) => extractFunction(html, n)).join("\n"),
      ctx
    );
    const saved = ctx.applyEmpField({
      type: "select",
      tagName: "SELECT",
      dataset: { ef: "status" },
      value: REHIRED,
      options: [{ value: "" }, { value: PROJECT }, { value: REHIRED }],
    });
    assert.equal(saved, "status");
    assert.equal(emp.status, REHIRED);
    assert.equal(emp.statusBasis, "Set on the 201 file");
    assert.ok(emp.statusEditedOn);

    const merge = loadMerge();
    const next = merge.mergeIncomingDoc(
      "employees",
      {
        id: "e1402",
        empNo: "1402",
        name: "Alquizalas, John Mark",
        status: "Separated",
        separatedOn: "2026-08-01",
        statusBasis: "Applied from the 2026-09-16 separated roster",
      },
      {
        id: "e1402",
        empNo: "1402",
        name: "Alquizalas, John Mark",
        status: REHIRED,
        statusBasis: "Set on the 201 file",
        project: "Balaga",
      }
    );
    assert.equal(next.status, REHIRED);
    assert.equal(next.statusBasis, "Set on the 201 file");
    assert.equal(next.project, "Balaga");
    assert.equal(merge.empStatusIsLive({ status: REHIRED }), true);
    assert.equal(merge.empStatusIsSeparated({ status: REHIRED }), false);

    const still = { id: "e1351", status: PROJECT, statusBasis: "Set on the 201 file" };
    const untouched = merge.mergeIncomingDoc(
      "employees",
      { id: "e1351", status: "Separated", statusBasis: "Applied from the 2026-09-16 separated roster" },
      still
    );
    assert.equal(untouched.status, PROJECT);
  });

  it("keeps a rehired project employee on attendance, payroll, and contributions, and off Separated", () => {
    const roster = loadRoster();
    const john = {
      id: "e1402",
      empNo: "1402",
      name: "Alquizalas, John Mark",
      status: REHIRED,
      project: "Balaga",
      separatedOn: "2026-08-01",
      dailyRate: 550,
      rateType: "Daily",
    };
    const ben = {
      id: "e1351",
      empNo: "1351",
      name: "Pasion, Ben",
      status: PROJECT,
      project: "Balaga",
      separatedOn: "2026-08-01",
      dailyRate: 550,
      rateType: "Daily",
    };
    const gone = { id: "e9", empNo: "1009", name: "Left, Earlier", status: "Separated", separatedOn: "2026-08-01" };
    roster.S.employees = { e1402: john, e1351: ben, e9: gone };
    assert.equal(roster.empStatusIsLive(john), true);
    assert.equal(roster.empSeparatedAsOf(john, "2026-10-05"), false);
    assert.equal(roster.empPastLastDay(john, "2026-10-05"), false);
    assert.equal(roster.sepRosterWouldApply(john), false);
    assert.equal(roster.sepRosterWouldApply({ id: "e1402", empNo: "1402", status: "" }), true);
    assert.equal(roster.empSeparatedAsOf(ben, "2026-10-05"), roster.empSeparatedAsOf(john, "2026-10-05"));
    const day = roster.dailyPeople({ date: "2026-10-05", rows: {}, extra: [], omit: [] });
    assert.ok(day.some((e) => e.id === "e1402"));
    assert.ok(day.some((e) => e.id === "e1351"));
    assert.ok(!day.some((e) => e.id === "e9"));

    const pay = loadPay();
    pay.KNOWN_SEP = roster.KNOWN_SEP;
    const week = { from: "2026-10-01", to: "2026-10-07" };
    assert.equal(pay.payRosterInclude(john, week), true);
    assert.equal(pay.payRosterInclude(ben, week), true);
    assert.equal(pay.contribEngaged(john, {}), true);
    assert.equal(pay.contribEngaged(ben, {}), true);
    assert.equal(pay.shouldAutoSeparate(john, "2026-10-05"), false);
    assert.equal(pay.shouldAutoSeparate(ben, "2026-10-05"), false);
    assert.equal(pay.leaverStatusWithPastDate(john, "2026-10-05"), false);

    const laterLastDay = Object.assign({}, john, {
      statusEditedOn: "2026-09-01T00:00:00.000Z",
      separatedOnEditedOn: "2026-10-01T00:00:00.000Z",
      separatedOn: "2026-10-03",
    });
    const laterProject = Object.assign({}, ben, {
      statusEditedOn: "2026-09-01T00:00:00.000Z",
      separatedOnEditedOn: "2026-10-01T00:00:00.000Z",
      separatedOn: "2026-10-03",
    });
    assert.equal(pay.shouldAutoSeparate(laterLastDay, "2026-10-05"), true);
    assert.equal(
      pay.shouldAutoSeparate(laterLastDay, "2026-10-05"),
      pay.shouldAutoSeparate(laterProject, "2026-10-05")
    );
    const statusAfter = Object.assign({}, john, {
      statusEditedOn: "2026-10-04T00:00:00.000Z",
      separatedOnEditedOn: "2026-09-01T00:00:00.000Z",
      separatedOn: "2026-08-01",
    });
    assert.equal(pay.shouldAutoSeparate(statusAfter, "2026-10-05"), false);
    assert.equal(pay.payRosterInclude(statusAfter, week), true);
  });

  it("tracks the rehired engagement as a project term and leaves separation papers N/A", () => {
    const ctx = loadContract();
    assert.equal(ctx.statusIsProjectBased(REHIRED), true);
    assert.equal(ctx.statusIsProjectBased(PROJECT), true);
    assert.equal(ctx.statusIsProjectBased("Project-based with a definite period"), false);
    assert.equal(ctx.statusIsProjectBased("Regular"), false);
    const filed = { docs: { contract: { s: "on" } } };
    assert.equal(ctx.contractState(Object.assign({ status: REHIRED }, filed)).k, "noend");
    assert.equal(ctx.contractState(Object.assign({ status: PROJECT }, filed)).k, "noend");
    assert.equal(
      ctx.contractState(Object.assign({ status: REHIRED, contractEnd: "2026-12-01" }, filed)).k,
      "active"
    );
    assert.equal(ctx.contractState(Object.assign({ status: "Regular" }, filed)).k, "regular");

    assert.equal(checklist.isSeparated({ status: REHIRED }), false);
    assert.equal(checklist.isSeparated({ status: PROJECT }), false);
    const rehired = checklist.complianceOf(
      { id: "e1402", status: REHIRED, docs: { contract: { s: "on" } } },
      SEP_DOCS
    );
    const project = checklist.complianceOf(
      { id: "e1351", status: PROJECT, docs: { contract: { s: "on" } } },
      SEP_DOCS
    );
    assert.equal(rehired.na, project.na);
    assert.ok(rehired.na >= 2);
    assert.equal(rehired.missing.length, project.missing.length);
  });
});
