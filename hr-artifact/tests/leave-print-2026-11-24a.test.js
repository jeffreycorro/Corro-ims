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

describe("2026-11-24a leave request prints on one A4 page", () => {
  it("is build 2026-11-24a and the print CSS keeps the leave sheet on one A4 portrait page", () => {
    assert.match(html, /const BUILD = "2026-11-25a"/);
    assert.match(html, /@page leave-request\{size:A4 portrait;margin:10mm 12mm 10mm\}/);
    assert.match(html, /@page\{size:A4 portrait;margin:10mm 12mm 10mm\}/);
    assert.match(html, /\.pf-leave-sheet\{font-size:9pt;line-height:1\.18\}/);
    assert.match(html, /\.pf-leave-sheet,\.pf\.pf-leave\{page:leave-request;font-size:9pt;break-inside:avoid;page-break-inside:avoid\}/);
    assert.match(html, /\.pf-leave-sheet \.pf-details\{break-inside:avoid;page-break-inside:avoid\}/);
    assert.match(html, /\.pf-leave-sheet \.pf-sign \.ink\{height:30px\}/);
    assert.match(html, /\.pf-leave-sheet \.pf-t td\{padding:1px 5px/);
    assert.match(html, /\.pf-details\{display:block;white-space:normal;overflow-wrap:anywhere/);
    assert.match(html, /\.pf-details-md\{font-size:8\.5pt/);
    assert.match(html, /\.pf-details-sm\{font-size:8pt/);
    assert.match(html, /\.pf-details-xs\{font-size:7pt/);
    assert.doesNotMatch(html, /height:62px/);
  });

  it("keeps every leave field and shrinks only a long reason", () => {
    const ctx = {};
    vm.runInNewContext(extractFunction(html, "pfLeaveDetailClass"), ctx);
    assert.equal(ctx.pfLeaveDetailClass("Family matter"), "pf-details");
    assert.equal(ctx.pfLeaveDetailClass("x".repeat(181)), "pf-details pf-details-md");
    assert.equal(ctx.pfLeaveDetailClass("x".repeat(401)), "pf-details pf-details-sm");
    assert.equal(ctx.pfLeaveDetailClass("x".repeat(901)), "pf-details pf-details-xs");

    const start = html.indexOf("function printLeave");
    const leave = html.slice(start, start + 4500);
    assert.match(leave, /class="pf-leave-sheet"/);
    assert.match(leave, /pfLeaveDetailClass\(reason\)/);
    assert.match(leave, /LEAVE REQUEST FORM/);
    assert.match(leave, /Name of Employee/);
    assert.match(leave, /Project Site \/ Location/);
    assert.match(leave, /LEAVE DETAILS/);
    assert.match(leave, /Type of Leave/);
    assert.match(leave, /Inclusive Dates/);
    assert.match(leave, /No\. of Working Days/);
    assert.match(leave, /Reason for Leave/);
    assert.match(leave, /Contact Information while on Leave/);
    assert.match(leave, /Employee Name &amp; Signature/);
    assert.match(leave, /Immediate Supervisor/);
    assert.match(leave, /leaveCaEvaluators\(\)\[0\]/);
    assert.match(leave, /leaveCaSig\("evaluated"\)/);
    assert.match(leave, /HR Department/);
    assert.match(leave, /leaveCaSig\("dept"\)/);
    assert.match(leave, /Final Approval \(Management\)/);
    assert.match(leave, /decisionPanel\("leave", l, "print"\)/);
    assert.match(leave, /Leave Request Form No\./);
    assert.match(leave, /pfISO\("leave"\)/);
    assert.match(leave, /pfHead\(\)/);
    assert.doesNotMatch(leave, /height:62px/);
  });
});
