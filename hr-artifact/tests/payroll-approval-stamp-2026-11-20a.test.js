"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const sheetSrc = fs.readFileSync(path.join(root, "public/hr-payroll-sheet.js"), "utf8");
const SIG = "data:image/png;base64,JEFFREY";

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

function person() {
  return {
    empId: "e1",
    name: "Santos, Ben",
    empNo: "10",
    position: "Laborer",
    site: "TAWASON",
    days: 6,
    ot: 0,
    daily: 500,
    hourly: 62.5,
    gross: 3000,
    ded: 0,
    net: 3000,
    rows: [{ date: "2026-11-05", day: 1, ot: 0, site: "TAWASON", in: "08:00", out: "17:00", s: "Present" }]
  };
}

function run(kind, extra) {
  const from = kind === "semi" ? "2026-10-28" : "2026-11-05";
  const to = kind === "semi" ? "2026-11-12" : "2026-11-11";
  return Object.assign({
    kind: kind,
    from: from,
    to: to,
    release: "2026-11-14",
    lines: [person()]
  }, extra || {});
}

const APPROVED_AT = "2026-11-19T22:15:30.000Z";
const MANILA_TEXT = "20 Nov 2026, 6:15:30 AM Asia/Manila";
const MANILA_ISO = "2026-11-20T06:15:30+08:00";

function approved(kind, extra) {
  return run(kind, Object.assign({
    status: "approved",
    approvedAt: APPROVED_AT,
    signatorySrc: SIG,
    signatoryName: "Jeffrey James M. Corro",
    signatoryTitle: "CEO / President"
  }, extra || {}));
}

describe("2026-11-23a approved payroll print stamp", () => {
  it("is build 2026-11-23a", () => {
    assert.match(html, /const BUILD = "2026-11-28b"/);
    assert.match(html, /function payPrintOptions\(/);
    assert.match(html, /signatorySig\(\)/);
    assert.match(html, /hrPaySheet\.printHTML\(payPrintOptions\(/);
    assert.match(html, /printDoc\(no, body\)/);
    assert.match(html, /savePDF\(no, body\)/);
  });

  it("stamps an approved weekly print with the signature, title, and Manila time", () => {
    const printed = P.printHTML(approved("weekly"));
    assert.match(printed, /APPROVED BY JEFFREY JAMES CORRO/);
    assert.match(printed, /class="pay-approval-stamp"/);
    assert.match(printed, /data-pay-approval="approved"/);
    assert.match(printed, /data-approved-pht="2026-11-20T06:15:30\+08:00"/);
    assert.match(printed, /class="pay-approval-sig"/);
    assert.match(printed, new RegExp('src="' + SIG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"'));
    assert.match(printed, /Jeffrey James M\. Corro, CEO \/ President/);
    assert.match(printed, /20 Nov 2026, 6:15:30 AM Asia\/Manila/);
    assert.equal(printed.split("APPROVED BY JEFFREY JAMES CORRO").length - 1, 1);
    assert.doesNotMatch(printed, /Approved by:/);
  });

  it("stamps an approved semi-monthly print and drops the plain Approved by line", () => {
    const printed = P.printHTML(approved("semi"));
    assert.match(printed, /APPROVED BY JEFFREY JAMES CORRO/);
    assert.match(printed, /class="pay-approval-sig"/);
    assert.match(printed, new RegExp('src="' + SIG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"'));
    assert.match(printed, /Jeffrey James M\. Corro, CEO \/ President/);
    assert.ok(printed.includes(MANILA_TEXT), printed.slice(printed.indexOf("pay-approval")));
    assert.match(printed, /data-approved-pht="2026-11-20T06:15:30\+08:00"/);
    assert.match(printed, /Semi-monthly Payroll Report/);
    assert.match(printed, /class="pay-approval-sig"/);
    assert.doesNotMatch(printed, /<b>Approved by:<\/b> Jeffrey James M\. Corro, CEO</);
    assert.equal(printed.split("APPROVED BY JEFFREY JAMES CORRO").length - 1, 1);
  });

  it("uses the configured signatory label and still stamps when the image is missing", () => {
    const printed = P.printHTML(approved("weekly", {
      signatorySrc: "",
      signatoryName: "Jeffrey James M. Corro",
      signatoryTitle: "President"
    }));
    assert.match(printed, /APPROVED BY JEFFREY JAMES CORRO/);
    assert.match(printed, /Jeffrey James M\. Corro, President/);
    assert.ok(printed.includes(MANILA_ISO));
    assert.doesNotMatch(printed, /<img /);
    assert.doesNotMatch(printed, /pay-approval-sig/);
  });

  it("reads a zone-less approvedAt as Asia/Manila wall time", () => {
    const when = P.manilaApprovalWhen("2026-11-20 14:05");
    assert.equal(when.iso, "2026-11-20T14:05:00+08:00");
    assert.equal(when.text, "20 Nov 2026, 2:05:00 PM Asia/Manila");
    assert.equal(when.day, "20 Nov 2026");
    const zoned = P.manilaApprovalWhen(APPROVED_AT);
    assert.equal(zoned.iso, MANILA_ISO);
    assert.equal(zoned.text, MANILA_TEXT);
  });

  it("leaves a draft weekly print without the stamp or the e-signature", () => {
    const printed = P.printHTML(run("weekly", { status: "draft", approvedAt: APPROVED_AT, signatorySrc: SIG }));
    assert.doesNotMatch(printed, /APPROVED BY JEFFREY JAMES CORRO/);
    assert.doesNotMatch(printed, /pay-approval-stamp/);
    assert.doesNotMatch(printed, /pay-approval-sig/);
    assert.doesNotMatch(printed, /JEFFREY/);
    assert.doesNotMatch(printed, /PHT/);
  });

  it("keeps the signature and stamp off a draft or submitted semi-monthly print", () => {
    ["draft", "submitted", ""].forEach(function (status) {
      const printed = P.printHTML(run("semi", { status: status, approvedAt: APPROVED_AT, signatorySrc: SIG, printedAt: "2026-11-20T01:00:00.000Z" }));
      assert.match(printed, /Approved by/);
      assert.match(printed, /Name and date/);
      assert.doesNotMatch(printed, /APPROVED BY JEFFREY JAMES CORRO/);
      assert.doesNotMatch(printed, /pay-approval-sig/);
      assert.doesNotMatch(printed, /data:image\/png;base64,JEFFREY/);
      assert.doesNotMatch(printed, /Jeffrey James M\. Corro, CEO/);
      if (!status || status === "draft") {
        assert.match(printed, /pay-rpt-watermark/);
        assert.match(printed, /data-pay-pill="draft"/);
      } else {
        assert.doesNotMatch(printed, /class="pay-rpt-watermark"/);
        assert.match(printed, /data-pay-pill="submitted"/);
      }
    });
  });

  it("loads the stored signatory image only when the pay run is approved", () => {
    const ctx = {
      S: {
        settings: {
          signatory: "Jeffrey James M. Corro",
          signatoryTitle: "CEO / President",
          hrSigs: {
            signatory: { data: SIG, title: "jeffrey.png", slot: "signatory" }
          }
        }
      },
      calls: 0
    };
    ctx.signatorySig = function () {
      ctx.calls += 1;
      return ctx.S.settings.hrSigs.signatory.data;
    };
    ctx.payRunKey = function (kind, from, to) { return kind + "|" + from; };
    vm.runInNewContext(extractFunction(html, "payPrintOptions"), ctx);
    const per = { from: "2026-11-05", to: "2026-11-11" };
    const lines = [person()];
    const draft = ctx.payPrintOptions("weekly", per, lines, "2026-11-14", { status: "draft", approvedAt: APPROVED_AT });
    assert.equal(draft.status, "draft");
    assert.equal(draft.signatorySrc, "");
    assert.equal(draft.signatoryName, "Jeffrey James M. Corro");
    assert.equal(draft.signatoryTitle, "CEO / President");
    assert.equal(ctx.calls, 0);
    const ok = ctx.payPrintOptions("semi", { from: "2026-10-28", to: "2026-11-12" }, lines, "", {
      status: "approved",
      approvedAt: APPROVED_AT
    });
    assert.equal(ok.status, "approved");
    assert.equal(ok.signatorySrc, SIG);
    assert.equal(ok.approvedAt, APPROVED_AT);
    assert.equal(ok.signatoryTitle, "CEO / President");
    assert.equal(ok.runId, "semi|2026-10-28");
    assert.equal(ctx.calls, 1);
    const stamped = P.printHTML(ok);
    assert.match(stamped, /APPROVED BY JEFFREY JAMES CORRO/);
    assert.match(stamped, /src="data:image\/png;base64,JEFFREY"/);
    assert.match(stamped, /Jeffrey James M\. Corro, CEO \/ President/);
    assert.match(stamped, /6:15:30 AM Asia\/Manila/);
  });
});
