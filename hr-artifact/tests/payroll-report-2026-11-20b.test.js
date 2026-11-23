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

function loadSheet() {
  const ctx = { console, TextEncoder, Intl };
  vm.runInNewContext(sheetSrc, ctx);
  return ctx.hrPaySheet;
}

const P = loadSheet();
const HEADS = ["Name", "Site", "Rate", "Days", "OT hours", "OT pay", "Other earnings", "Gross", "SSS", "PhilHealth", "Pag-IBIG", "Cash advance", "Uniform", "Late / undertime", "Net"];

function line(over) {
  return Object.assign({
    empId: "e1",
    empNo: "10",
    name: "Santos, Ben",
    position: "Laborer",
    site: "Tawason",
    daily: 500,
    days: 6,
    ot: 2,
    otPay: 125,
    allowance: 100,
    incentive: 50,
    holPay: 0,
    gross: 3275,
    sss: 162.5,
    phic: 65.62,
    hdmf: 50,
    ca: 200,
    uniform: 0,
    late: 10,
    net: 2786.88
  }, over || {});
}

function amount(html, attr, key) {
  const re = new RegExp("data-" + attr + '="' + key + '" data-amount="([^"]+)"');
  const m = html.match(re);
  assert.ok(m, attr + " " + key);
  return m[1];
}

describe("2026-11-23a payroll report layout", () => {
  it("is build 2026-11-23a and prints landscape from the same sheet", () => {
    assert.match(html, /const BUILD = "2026-11-23a"/);
    assert.match(extractFunction(html, "savePDF"), /pay-rpt-page/);
    assert.match(extractFunction(html, "savePDF"), /orientation:"landscape"/);
    assert.match(html, /pfWrap\(body,\{land:true\}\)/);
  });

  it("matches KPI totals to the TOTAL row, drops ₱0 net, and uses 15 columns", () => {
    const printed = P.printHTML({
      kind: "weekly",
      from: "2026-11-05",
      to: "2026-11-11",
      release: "2026-11-14",
      runId: "weekly|2026-11-05",
      status: "approved",
      approvedAt: "2026-11-19T22:15:30.000Z",
      printedAt: "2026-11-20T01:00:00.000Z",
      signatorySrc: "data:image/png;base64,JEFFREY",
      signatoryName: "Jeffrey James M. Corro",
      signatoryTitle: "CEO / President",
      logo: "data:image/jpeg;base64,LOGO",
      note: "Release on Saturday.",
      lines: [
        line({ caNote: "Held the November installment." }),
        line({
          empId: "e2",
          empNo: "11",
          name: "Cruz, Ana",
          position: "Mason",
          site: "Banawa",
          days: 5,
          ot: 0,
          otPay: 0,
          allowance: 0,
          incentive: 0,
          gross: 2500,
          sss: 100,
          phic: 50,
          hdmf: 50,
          ca: 0,
          uniform: 80,
          late: 0,
          net: 2220,
          uniformNote: "One shirt."
        }),
        line({
          empId: "e0",
          empNo: "99",
          name: "Nada, Zero",
          position: "Helper",
          net: 0,
          gross: 400,
          days: 1,
          caNote: "Should not appear."
        })
      ]
    });
    assert.match(printed, /@page\{size:A4 landscape;margin:10mm 12mm 12mm\}/);
    assert.match(printed, /Weekly Payroll Report, Nov 5–11, 2026/);
    assert.match(printed, /Corcondev · Corro Const\. Development and Trade Corporation · Period 5–11 November 2026 · Release 14 November 2026/);
    assert.match(printed, /Payrun weekly\|2026-11-05 · Status: APPROVED · Approved 20 Nov 2026, 6:15:30 AM Asia\/Manila · Printed 20 Nov 2026, 9:00 AM Asia\/Manila/);
    assert.match(printed, /data-pay-pill="approved"/);
    assert.match(printed, /APPROVED by Jeffrey James Corro, 20 Nov 2026/);
    assert.match(printed, /src="data:image\/jpeg;base64,LOGO"/);
    assert.match(printed, /class="pay-rpt-logo"/);
    assert.doesNotMatch(printed, /Nada, Zero/);
    assert.doesNotMatch(printed, /Should not appear/);
    assert.equal(amount(printed, "kpi", "people"), "2");
    ["days", "ot", "otPay", "other", "gross", "net"].forEach(function (key) {
      assert.equal(amount(printed, "kpi", key), amount(printed, "total", key), key);
    });
    const dedKeys = ["sss", "phic", "hdmf", "ca", "uniform", "late"];
    const ded = dedKeys.reduce(function (n, key) {
      return n + Math.round(Number(amount(printed, "total", key)) * 100);
    }, 0);
    assert.equal(amount(printed, "kpi", "deductions"), (ded / 100).toFixed(2));
    assert.match(printed, /₱2,786\.88/);
    assert.match(printed, /—/);
    const heads = printed.match(/<th>[^<]+<\/th>/g);
    assert.deepEqual(heads.map(function (h) { return h.replace(/<\/?th>/g, ""); }), HEADS);
    assert.match(printed, /#10 · Laborer/);
    assert.match(printed, /Ben Santos/);
    assert.match(printed, /Decisions on this approved run/);
    assert.match(printed, /Release on Saturday\./);
    assert.match(printed, /Ben Santos — Cash advance/);
    assert.match(printed, /Held the November installment\./);
    assert.match(printed, /Ana Cruz — Uniform/);
    assert.match(printed, /One shirt\./);
    assert.match(printed, /APPROVED BY JEFFREY JAMES CORRO/);
    assert.match(printed, /class="pay-approval-sig"/);
    assert.match(printed, /Jeffrey James M\. Corro, CEO \/ President/);
    assert.match(printed, /This weekly payroll has been approved by Jeffrey James Corro on 20 Nov 2026/);
    assert.match(printed, /Amounts were not changed at approval/);
    assert.match(printed, /Approved weekly payroll report · Confidential/);
    assert.match(printed, /Page 1 of 1/);
    assert.doesNotMatch(printed, /class="pay-rpt-watermark"/);
  });

  it("uses draft wording, a DRAFT pill and watermark, and no signature", () => {
    const printed = P.printHTML({
      kind: "semi",
      from: "2026-10-28",
      to: "2026-11-12",
      release: "2026-11-15",
      runId: "semi|2026-10-28",
      status: "draft",
      printedAt: "2026-11-20T01:00:00.000Z",
      signatorySrc: "data:image/png;base64,JEFFREY",
      lines: [line({ net: 100, gross: 100, days: 1, ot: 0, otPay: 0, allowance: 0, incentive: 0, sss: 0, phic: 0, hdmf: 0, ca: 0, late: 0 })]
    });
    assert.match(printed, /Semi-monthly Payroll Report, Oct 28–Nov 12, 2026/);
    assert.match(printed, /Period 28 October–12 November 2026 · Release 15 November 2026/);
    assert.match(printed, /data-pay-pill="draft"/);
    assert.match(printed, />DRAFT</);
    assert.match(printed, /pay-rpt-watermark/);
    assert.match(printed, /This is the draft semi-monthly payroll report/);
    assert.match(printed, /Draft semi-monthly payroll report · Confidential/);
    assert.doesNotMatch(printed, /class="pay-rpt-decisions"/);
    const noted = P.printHTML({
      kind: "weekly",
      from: "2026-11-05",
      to: "2026-11-11",
      status: "draft",
      printedAt: "2026-11-20T01:00:00.000Z",
      lines: [line({ lateNote: "Excused the gate delay." })]
    });
    assert.match(noted, /Notes on this draft run/);
    assert.match(noted, /Ben Santos — Late \/ undertime/);
    assert.match(noted, /Excused the gate delay\./);
    assert.doesNotMatch(printed, /APPROVED BY JEFFREY JAMES CORRO/);
    assert.doesNotMatch(printed, /pay-approval-sig/);
    assert.doesNotMatch(printed, /data:image\/png;base64,JEFFREY/);
    assert.doesNotMatch(printed, /may be paid/);
    assert.match(printed, /@page\{size:A4 landscape/);
  });

  it("repeats the header and footer on later pages without splitting a row marker", () => {
    const lines = [];
    for (let i = 0; i < 16; i += 1) {
      lines.push(line({
        empId: "e" + i,
        empNo: String(100 + i),
        name: "Worker, " + i,
        net: 100 + i,
        gross: 100 + i
      }));
    }
    const printed = P.printHTML({
      kind: "weekly",
      from: "2026-11-05",
      to: "2026-11-11",
      release: "2026-11-14",
      status: "draft",
      printedAt: "2026-11-20T01:00:00.000Z",
      lines: lines
    });
    const pages = printed.match(/class="pay-rpt-page"/g);
    assert.ok(pages && pages.length > 1);
    assert.equal(printed.split("Weekly Payroll Report").length - 1, pages.length);
    assert.match(printed, /Page 1 of /);
    assert.match(printed, new RegExp("Page " + pages.length + " of " + pages.length));
    assert.equal(printed.split("<tr class=\"pay-rpt-row\">").length - 1, 16);
    assert.equal(printed.split('<tr class="pay-rpt-total">').length - 1, 1);
  });

  it("copies stored line notes onto the print without changing the saved run", () => {
    const savedLine = { caNote: "From the saved run." };
    const saved = {
      status: "approved",
      approvedAt: "2026-11-19T22:15:30.000Z",
      note: "Pay on Saturday.",
      lines: { e1: savedLine }
    };
    const ctx = {
      S: { settings: { signatory: "Jeffrey James M. Corro", signatoryTitle: "CEO / President" } },
      LOGO: "data:image/jpeg;base64,LOGO",
      Date: Date,
      signatorySig: function () { return "data:image/png;base64,JEFFREY"; },
      payRunKey: function (kind, from) { return kind + "|" + from; }
    };
    vm.runInNewContext(extractFunction(html, "payPrintOptions"), ctx);
    const opts = ctx.payPrintOptions("weekly", { from: "2026-11-05", to: "2026-11-11" }, [line()], "2026-11-14", saved);
    assert.equal(savedLine.caNote, "From the saved run.");
    assert.equal(Object.keys(savedLine).join(","), "caNote");
    assert.equal(opts.lines[0].caNote, "From the saved run.");
    assert.equal(opts.note, "Pay on Saturday.");
    assert.equal(opts.logo, "data:image/jpeg;base64,LOGO");
    assert.equal(opts.signatorySrc, "data:image/png;base64,JEFFREY");
    const printed = P.printHTML(opts);
    assert.match(printed, /From the saved run\./);
    assert.match(printed, /Pay on Saturday\./);
    assert.match(printed, /Decisions on this approved run/);
  });
});
