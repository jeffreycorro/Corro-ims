"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const sheetSrc = fs.readFileSync(path.join(root, "public/hr-payroll-sheet.js"), "utf8");

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

function slipShowSource() {
  const start = html.indexOf("const slipShow=");
  const end = html.indexOf('on("[data-payslip]"', start);
  if (start < 0 || end < 0) throw new Error("missing slipShow");
  return html.slice(start, end);
}

function loadSheet() {
  const ctx = { console, TextEncoder };
  vm.runInNewContext(sheetSrc, ctx);
  return ctx.hrPaySheet;
}

const P = loadSheet();

function person() {
  return {
    empId: "e1316",
    name: "Moran, Maria Trina Cassandra A.",
    empNo: "1316",
    position: "HR",
    days: 6,
    ot: 0,
    daily: 500,
    hourly: 62.5,
    gross: 7923.08,
    ded: 556.25,
    net: 7367,
    late: 0,
    ca: 0,
    uniform: 0,
    sssLoan: 0,
    hdmfLoan: 0,
    sss: 200,
    phic: 100,
    hdmf: 50,
    incentive: 0,
    rows: [{ date: "2026-11-05", day: 1, ot: 0, site: "Yard", in: "08:00", out: "17:00", s: "Present" }]
  };
}

describe("2026-11-14a payslip restored, breakdown on the payroll row", () => {
  it("is build 2026-11-14a", () => {
    assert.match(html, /const BUILD = "2026-11-14a"/);
  });

  it("keeps the payslip preview, print, and PDF free of the breakdown table", () => {
    const slip = slipShowSource();
    const body = extractFunction(html, "payslipBody");
    const sheet = extractFunction(html, "payslipSheet");
    assert.match(slip, /body:pfWrap\(body\)/);
    assert.match(slip, /printDoc\(file, body\)/);
    assert.match(slip, /savePDF\(file, body\)/);
    assert.match(slip, /id="pys-back"/);
    assert.match(slip, /Save as PDF/);
    assert.match(slip, /id="pys-print"/);
    [slip, body, sheet].forEach((src) => {
      assert.doesNotMatch(src, /payBreak/);
      assert.doesNotMatch(src, /pay-break/);
      assert.doesNotMatch(src, /Does not add up/);
      assert.doesNotMatch(src, /Lines that count/);
      assert.doesNotMatch(src, />Item</);
      assert.doesNotMatch(src, />Marker</);
    });
    assert.match(body, /PAYSLIP/);
    assert.match(body, /GROSS PAY/);
    assert.match(body, /TOTAL DEDUCTIONS/);
    assert.match(body, /NET PAY/);
    assert.match(body, /pfISO\("payslip"\)/);
    assert.match(html, /@media print\{#pay-break-dialog,\.pay-break-live,\.pay-break-table/);
    const printed = P.printHTML({
      kind: "weekly",
      from: "2026-11-05",
      to: "2026-11-11",
      lines: [person()]
    });
    assert.doesNotMatch(printed, /pay-break/);
    assert.doesNotMatch(printed, /Does not add up/);
    assert.doesNotMatch(printed, />Item</);
  });

  it("opens the breakdown from a deduction or earnings amount, not inside the payslip", () => {
    const run = {
      kind: "weekly",
      from: "2026-11-05",
      to: "2026-11-11",
      release: "2026-11-14",
      lines: [person()]
    };
    const screen = P.screenHTML(run);
    const ded = screen.match(/<button type="button" class="pay-break-btn" data-paybreak="ded" data-payemp="e1316" aria-label="Show the deduction breakdown for Moran, Maria Trina Cassandra A\.">556\.25<\/button>/);
    const earn = screen.match(/<button type="button" class="pay-break-btn" data-paybreak="earn" data-payemp="e1316" aria-label="Show the earnings breakdown for Moran, Maria Trina Cassandra A\.">7923\.08<\/button>/);
    assert.ok(ded, "deduction amount is a button");
    assert.ok(earn, "earnings amount is a button");

    const handlerAt = html.indexOf('on("[data-paybreak]","click",e=>{');
    const handlerEnd = html.indexOf("});", handlerAt);
    const handler = html.slice(handlerAt, handlerEnd + 3);
    const calls = [];
    const clickCtx = {
      on(sel, type, fn) { clickCtx.fn = fn; clickCtx.sel = sel; clickCtx.type = type; },
      openPayBreakdown(id, side) { calls.push([id, side]); }
    };
    vm.runInNewContext(handler, clickCtx);
    assert.equal(clickCtx.sel, "[data-paybreak]");
    assert.equal(clickCtx.type, "click");
    function fire(side) {
      clickCtx.fn({
        preventDefault() {},
        currentTarget: {
          getAttribute(name) {
            if (name === "data-payemp") return "e1316";
            if (name === "data-paybreak") return side;
            return "";
          }
        }
      });
    }
    fire("ded");
    fire("earn");
    assert.deepEqual(calls, [["e1316", "ded"], ["e1316", "earn"]]);

    const seen = [];
    const box = {
      className: "",
      style: {},
      attrs: {},
      classList: { add(c) { box.className += " " + c; } },
      setAttribute(k, v) { box.attrs[k] = v; }
    };
    const modalCtx = {
      panels: [],
      opened: null,
      payBreakPanels(empId, opts) {
        modalCtx.panels.push({ empId, opts });
        return '<table class="pay-break-table"><thead><tr><th>Item</th><th>Detail</th><th>Source</th><th>Marker</th><th>Amount</th></tr></thead>'
          + "<tbody><tr><td>SSS loan</td><td>CAF2026-0004</td><td>Touched</td><td>Touched</td><td>80.00</td></tr></tbody></table>"
          + '<div class="pay-break-warn" role="alert">Does not add up</div>';
      },
      toast() {},
      PAY_BREAK_INDEX: { e1316: { empId: "e1316", name: "Moran, Maria Trina Cassandra A." } },
      flipName(n) { return "Maria Trina Cassandra A. Moran"; },
      openModal(o) { modalCtx.opened = o; },
      document: {
        querySelector(sel) {
          if (sel === "#ov .modal") return box;
          return null;
        }
      },
      $(sel) {
        assert.equal(sel, "#pay-break-close");
        return { onclick: null, focus() { modalCtx.focused = true; } };
      },
      closeModal() {}
    };
    vm.runInNewContext(extractFunction(html, "openPayBreakdown"), modalCtx);
    modalCtx.openPayBreakdown("e1316", "ded");
    assert.equal(modalCtx.panels[0].empId, "e1316");
    assert.equal(modalCtx.panels[0].opts.dedOpen, true);
    assert.equal(modalCtx.panels[0].opts.earnOpen, false);
    const opened = modalCtx.opened;
    assert.equal(opened.wide, undefined);
    assert.match(opened.title, /Maria Trina Cassandra A\. Moran — breakdown/);
    assert.doesNotMatch(opened.title, /Payslip/);
    assert.match(opened.body, /id="pay-break-dialog"/);
    assert.match(opened.body, /pay-break-table/);
    assert.match(opened.body, /Does not add up/);
    assert.match(opened.body, /CAF2026-0004/);
    assert.match(opened.body, /SSS loan/);
    assert.doesNotMatch(opened.body, /PAYSLIP/);
    assert.doesNotMatch(opened.body, /pf-sheet/);
    assert.doesNotMatch(opened.body, /pfWrap/);
    assert.match(opened.foot, /id="pay-break-close"/);
    assert.doesNotMatch(opened.foot, /Save as PDF/);
    assert.doesNotMatch(opened.foot, /Print/);
    assert.match(box.className, /pay-break-modal/);
    assert.equal(box.attrs.role, "dialog");
    assert.equal(modalCtx.focused, true);
    assert.match(html, /\.modal\.pay-break-modal\{width:min\(680px,100%\)\}/);

    modalCtx.openPayBreakdown("e1316", "earn");
    assert.equal(modalCtx.panels[1].opts.dedOpen, false);
    assert.equal(modalCtx.panels[1].opts.earnOpen, true);
  });
});
