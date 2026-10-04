"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

describe("2026-10-01a 201 fields stay until HR changes them", () => {
  it("is build 2026-10-04a and still defers a focused Date hired redraw", () => {
    assert.match(html, /const BUILD = "2026-10-04a"/);
    assert.match(html, /function keepEmpEnteredFields\(/);
    assert.match(html, /function employeeFilledBeatsBlankSnap\(/);
    assert.match(html, /function employeeSnapNeedsRepair\(/);
    assert.match(html, /Cleared on the 201 file/);
    assert.match(html, /list\.indexOf\(val\)<0/);
    assert.match(html, /employeeSnapNeedsRepair\(local, incoming\)/);
    assert.match(html, /function renderEmpAfterDate\(/);
    assert.match(html, /input\[type='date'\]\[data-ef\]/);
    const start = html.indexOf("/* field bindings */");
    const end = html.indexOf('on("[data-ob]"', start);
    const block = html.slice(start, end);
    const changeAt = block.indexOf('on("[data-ef]","change"');
    const change = block.slice(changeAt, block.indexOf('on("[data-ef]","blur"'));
    const dateBranch = change.slice(
      change.indexOf('if(e.target.type==="date")'),
      change.indexOf("if(k && EMP_RENDER_FIELDS")
    );
    assert.match(dateBranch, /renderEmpAfterDate\(\)/);
    assert.doesNotMatch(dateBranch, /render\(\)/);
    assert.match(extractFunction(html, "mergeIncomingDoc"), /keepContribHold/);
    assert.match(extractFunction(html, "mergeIncomingDoc"), /keepEmpEnteredFields/);
  });

  it("keeps a filled employment status and other 201 values when the snapshot left them blank", () => {
    const ctx = loadMerge();
    const local = {
      id: "e1250",
      empNo: "1250",
      name: "Ababon, Jonathan",
      status: "Regular",
      statusBasis: "Set on the 201 file",
      position: "Heavy Machine Operator",
      dept: "Site",
      dateHired: "2024-03-01",
      sssNo: "09-1111111-1",
      address: "Cebu",
    };
    const incoming = {
      id: "e1250",
      empNo: "1250",
      name: "Ababon, Jonathan",
      status: "",
      position: "Heavy Machine Operator",
      dept: "Site",
      dateHired: "",
      sssNo: "",
      address: "",
    };
    const next = ctx.mergeIncomingDoc("employees", incoming, local);
    assert.equal(next.status, "Regular");
    assert.equal(next.statusBasis, "Set on the 201 file");
    assert.equal(next.dateHired, "2024-03-01");
    assert.equal(next.sssNo, "09-1111111-1");
    assert.equal(next.address, "Cebu");
    assert.equal(next.position, "Heavy Machine Operator");
    assert.equal(ctx.employeeFilledBeatsBlankSnap(local, incoming), true);
    assert.equal(ctx.employeeSnapNeedsRepair(local, incoming), true);
  });

  it("does not put a status back after HR cleared it on the 201 file", () => {
    const ctx = loadMerge();
    const local = {
      id: "e1250",
      status: "Regular",
      statusBasis: "Set on the 201 file",
      position: "Heavy Machine Operator",
    };
    ["Set on the 201 file", "Cleared on the 201 file"].forEach((basis) => {
      const incoming = { id: "e1250", status: "", statusBasis: basis, position: "Heavy Machine Operator" };
      const next = ctx.mergeIncomingDoc("employees", incoming, local);
      assert.equal(next.status, "", basis);
      assert.equal(ctx.blankStatusIsIntentional(incoming), true);
      assert.equal(ctx.employeeFilledBeatsBlankSnap(local, incoming), false);
    });
  });

  it("keeps an open 201 edit when a stale live snapshot arrives", () => {
    const ctx = loadMerge();
    ctx.EMP_DIRTY = { e1250: 1 };
    const next = ctx.mergeIncomingDoc(
      "employees",
      { id: "e1250", status: "Probationary", statusBasis: "Set on the 201 file", position: "Helper" },
      { id: "e1250", status: "Regular", statusBasis: "Set on the 201 file", position: "Heavy Machine Operator" }
    );
    assert.equal(next.status, "Regular");
    assert.equal(next.position, "Heavy Machine Operator");
  });

  it("still lets a live 201 status beat a stale Separated roster row", () => {
    const ctx = loadMerge();
    const next = ctx.mergeIncomingDoc(
      "employees",
      {
        id: "e1351",
        status: "Separated",
        separatedOn: "2026-09-02",
        statusBasis: "Applied from the 2026-09-16 separated roster",
      },
      { id: "e1351", status: "Project-based", statusBasis: "Set on the 201 file", project: "Balaga" }
    );
    assert.equal(next.status, "Project-based");
    assert.equal(next.statusBasis, "Set on the 201 file");
    assert.equal(next.project, "Balaga");

    const marked = ctx.mergeIncomingDoc(
      "employees",
      { id: "e1351", status: "Regular" },
      {
        id: "e1351",
        status: "Separated",
        separatedOn: "2026-08-31",
        statusBasis: "Marked separated on the Daily Manpower screen",
      }
    );
    assert.equal(marked.status, "Separated");
    assert.equal(marked.separatedOn, "2026-08-31");
  });

  it("keeps a stored status that is not in the employment list selected", () => {
    const fld = extractFunction(html, "fld");
    const ctx = {
      esc(s) {
        return String(s == null ? "" : s);
      },
    };
    vm.runInNewContext(fld, ctx);
    const htmlSelect = ctx.fld(
      "Employment status",
      "status",
      "Project-based with a definite period",
      "select",
      ["", "Probationary", "Regular", "Project-based", "Fixed-term", "Consultant", "Separated"]
    );
    assert.match(htmlSelect, /Project-based with a definite period/);
    assert.match(htmlSelect, /selected/);
    const selected = htmlSelect.slice(htmlSelect.indexOf("selected") - 80);
    assert.match(selected, /Project-based with a definite period/);
  });

  it("does not save a blank select when the stored status is missing from the options", () => {
    const src = ["dateInputValue", "applyEmpField"].map((n) => extractFunction(html, n)).join("\n");
    const emp = { id: "e1250", status: "Project-based with a definite period", statusBasis: "" };
    const ctx = {
      isoDate,
      S: { employees: { e1250: emp }, ui: { emp: "e1250" } },
      flipName(n) {
        return n;
      },
    };
    vm.runInNewContext(src, ctx);
    const wiped = ctx.applyEmpField({
      type: "select",
      tagName: "SELECT",
      dataset: { ef: "status" },
      value: "",
      options: [{ value: "", text: "" }],
    });
    assert.equal(wiped, null);
    assert.equal(emp.status, "Project-based with a definite period");

    const same = ctx.applyEmpField({
      type: "select",
      tagName: "SELECT",
      dataset: { ef: "status" },
      value: "Regular",
      options: [
        { value: "", text: "" },
        { value: "Regular", text: "Regular" },
      ],
    });
    assert.equal(same, "status");
    assert.equal(emp.status, "Regular");
    assert.equal(emp.statusBasis, "Set on the 201 file");

    const cleared = ctx.applyEmpField({
      type: "select",
      tagName: "SELECT",
      dataset: { ef: "status" },
      value: "",
      options: [
        { value: "", text: "" },
        { value: "Regular", text: "Regular" },
      ],
    });
    assert.equal(cleared, "status");
    assert.equal(emp.status, "");
    assert.equal(emp.statusBasis, "Cleared on the 201 file");
  });
});
