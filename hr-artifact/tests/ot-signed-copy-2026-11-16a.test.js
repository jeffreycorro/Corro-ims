"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "../public");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const forms = fs.readFileSync(path.join(root, "hr-ot-forms.js"), "utf8");
const sheet = fs.readFileSync(path.join(root, "hr-payroll-sheet.js"), "utf8");

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

function load(extra) {
  const ctx = Object.assign(
    {
      S: {
        employees: {},
        daily: {},
        otplans: {},
        otreps: {},
        otreqs: {},
        settings: { otFormGateWaived: true, otSignedCopyRequired: false, company: "CORRO CONSTRUCTION DEVELOPMENT AND TRADE CORPORATION", hrStaff: "Maria Trina Cassandra A. Moran" },
        payruns: {},
      },
      pfHead() {
        return '<div class="pf-head">CORRO CONST LETTERHEAD</div>';
      },
      hrStaffName() {
        return "Maria Trina Cassandra A. Moran";
      },
      namesClose(a, b) {
        return String(a || "").toLowerCase() === String(b || "").toLowerCase();
      },
      companySigForChain(label, name, role) {
        if (String(label).indexOf("Prepared by") === 0 && role === "HR Staff" && /moran/i.test(name)) {
          return "data:image/jpeg;base64,abc";
        }
        if (/Approved by/i.test(label)) return "data:image/jpeg;base64,SHOULD-NOT-STAMP";
        return "";
      },
    },
    extra || {}
  );
  vm.runInNewContext(forms, ctx);
  vm.runInNewContext(
    ["otFormGateWaived", "otPendingApplies", "otSignedCopyRequired", "otSignedCopyApplies", "otPaidHours"]
      .map((n) => extractFunction(html, n))
      .join("\n"),
    ctx
  );
  return ctx;
}

function person(id, name, empNo) {
  return { id: id, name: name, empNo: empNo || "" };
}

const CREW = {
  id: "r1",
  planId: "p1",
  otDate: "2026-11-16",
  reportDate: "2026-11-17",
  site: "Banawa",
  filedBy: "Maria Trina Cassandra A. Moran",
  rows: [
    { empId: "e1", empNo: "10", name: "Santos, Ben", timeFrom: "17:00", timeTo: "20:00", hours: 3, description: "Roof after the pour" },
    { empId: "e2", empNo: "11", name: "Cruz, Ana", timeFrom: "17:30", timeTo: "19:30", hours: 2, reason: "Hauled the leftover steel" },
  ],
};

describe("2026-11-16a printable OT form, signed copy, and the payroll flag", () => {
  it("is build 2026-11-16a and keeps the waiver as the default", () => {
    assert.match(html, /const BUILD = "2026-11-28c"/);
    assert.match(html, /otFormGateWaived:true/);
    assert.match(html, /otSignedCopyRequired:false/);
    assert.match(html, /data-set-flag="otSignedCopyRequired"/);
    assert.match(html, /function otSignedCopyApplies\(/);
    assert.match(extractFunction(html, "otSignedCopyApplies"), /2026-11-16/);
    assert.match(html, /Upload signed copy/);
    assert.match(html, /Signed copy received \/ Confirmed/);
    assert.match(html, /data-otpprint=/);
    assert.match(html, /data-otppdf=/);
    assert.match(html, /data-otpupload=/);
    assert.match(html, /data-otrprint=/);
    assert.match(html, /data-otrpdf=/);
    assert.match(html, /data-otrupload=/);
    assert.match(html, /function openOtPrint\(/);
    assert.match(html, /function storeOtSignedFile\(/);
    assert.match(extractFunction(html, "storeOtSignedFile"), /uploadSigned/);
    assert.match(extractFunction(html, "storeOtSignedFile"), /storeOtFile/);
    assert.match(extractFunction(html, "handleOtSignedPick"), /hrOtWithSignedCopy/);
    assert.match(html, /hrOtAppendEmployees/);
    assert.match(sheet, /ot-signed-copy/);
    assert.doesNotMatch(extractFunction(html, "otFormGateWaived"), /otSignedCopyRequired/);
  });

  it("prints a morning report and an afternoon plan with every employee on one sheet", () => {
    const ctx = load();
    ctx.S.employees.e1 = person("e1", "Santos, Ben", "10");
    ctx.S.employees.e2 = person("e2", "Cruz, Ana", "11");
    const before = JSON.stringify(CREW);
    const morning = ctx.hrOtFormHtml(CREW, "report");
    assert.equal(JSON.stringify(CREW), before);
    assert.match(morning, /class="pf-head"/);
    assert.match(morning, /CORRO CONST LETTERHEAD/);
    assert.match(morning, /MORNING OVERTIME REPORT/);
    assert.match(morning, /2026-11-16/);
    assert.match(morning, /2026-11-17/);
    assert.match(morning, /Banawa/);
    assert.match(morning, /Santos, Ben/);
    assert.match(morning, /Cruz, Ana/);
    assert.match(morning, /17:00/);
    assert.match(morning, /20:00/);
    assert.match(morning, /17:30/);
    assert.match(morning, /19:30/);
    assert.match(morning, /Roof after the pour/);
    assert.match(morning, /Hauled the leftover steel/);
    assert.match(morning, />3</);
    assert.match(morning, />2</);
    assert.match(morning, /Maria Trina Cassandra A\. Moran/);
    assert.match(morning, /data-ot-prepared-sig="1"/);
    assert.match(morning, /src="data:image\/jpeg;base64,abc"/);
    const approved = morning.split('data-ot-approved="blank"')[1];
    assert.ok(approved);
    assert.match(approved, /Approved by/);
    assert.match(approved, /Signature over printed name/);
    assert.match(approved, /Date: ______________/);
    assert.doesNotMatch(approved, /<img/);
    assert.doesNotMatch(approved, /SHOULD-NOT-STAMP/);
    assert.equal((morning.match(/<tr><td>1[01] {2}/g) || []).length, 2);

    const plan = {
      id: "p1",
      otDate: "2026-11-16",
      site: "Tagba-o",
      deptHead: "Luzano",
      filedBy: "Luzano",
      rows: [
        { empId: "e1", name: "Santos, Ben", task: "Roof", reason: "Deadline", timeFrom: "18:00", timeTo: "21:00", expectedHours: 3 },
        { empId: "e2", name: "Cruz, Ana", task: "Haul", reason: "Materials", timeFrom: "18:00", timeTo: "20:00", expectedHours: 2 },
      ],
    };
    const planBefore = JSON.stringify(plan);
    const afternoon = ctx.hrOtFormHtml(plan, "plan");
    assert.equal(JSON.stringify(plan), planBefore);
    assert.match(afternoon, /AFTERNOON OVERTIME PLAN/);
    assert.match(afternoon, /Tagba-o/);
    assert.match(afternoon, /Santos, Ben/);
    assert.match(afternoon, /Cruz, Ana/);
    assert.match(afternoon, /Deadline/);
    assert.match(afternoon, /Materials/);
    assert.match(afternoon, /Luzano/);
    const planApproved = afternoon.split('data-ot-approved="blank"')[1];
    assert.doesNotMatch(planApproved, /<img/);
    const added = ctx.hrOtAppendEmployees(plan.rows, ["e2", "e3"], { task: "", reason: "", expectedHours: "" });
    assert.equal(added.map((r) => r.empId).join(","), "e1,e2,e3");
    assert.equal(plan.rows.length, 2);
  });

  it("records a signed copy without changing hours, and confirms pay only when the flag says so", () => {
    const ctx = load();
    ctx.S.employees.e1 = person("e1", "Santos, Ben", "10");
    ctx.S.employees.e2 = person("e2", "Cruz, Ana", "11");
    const report = JSON.parse(JSON.stringify(CREW));
    const daily = { id: "d20261116", date: "2026-11-16", rows: { e1: { ot: 3, otTouched: true, site: "Banawa" }, e2: { ot: 2, site: "Banawa" } } };
    const payrun = { lines: { e1: { ot: 3, otTouched: true, lateTouched: true, ca: 40, caTouched: true } } };
    const dailyBefore = JSON.stringify(daily);
    const payBefore = JSON.stringify(payrun);
    const reportBefore = JSON.stringify(report);

    assert.equal(ctx.hrOtSignedCopyReceived(report), false);
    assert.equal(ctx.hrOtSignedCopyConfirms("e1", "2026-11-16", "Banawa"), false);
    const stamped = ctx.hrOtWithSignedCopy(report, { url: "https://drive.google.com/file/d/SCAN/view", title: "OT signed.pdf" }, "Cassie Moran", "2026-11-17T08:15:00.000Z");
    assert.equal(JSON.stringify(report), reportBefore);
    assert.equal(stamped.rows[0].hours, 3);
    assert.equal(stamped.rows[1].hours, 2);
    assert.equal(stamped.signedStatus, "Signed copy received / Confirmed");
    assert.equal(stamped.signedCopy.status, "Signed copy received / Confirmed");
    assert.equal(stamped.signedCopy.by, "Cassie Moran");
    assert.equal(stamped.signedCopy.at, "2026-11-17T08:15:00.000Z");
    assert.equal(stamped.signedLink, "https://drive.google.com/file/d/SCAN/view");
    assert.equal(ctx.hrOtSignedCopyOf(stamped).by, "Cassie Moran");
    const untouched = ctx.hrOtWithSignedCopy(report, { url: "" }, "Cassie Moran", "2026-11-17T08:15:00.000Z");
    assert.equal(untouched.signedLink, undefined);

    ctx.S.otreps.r1 = report;
    ctx.S.daily.d1 = daily;
    assert.equal(ctx.otSignedCopyRequired(), false);
    assert.equal(ctx.otSignedCopyApplies("2026-11-18"), false);
    assert.equal(ctx.otPaidHours("e1", "2026-11-16", "Banawa", 3, "2026-11-18"), 3);
    assert.equal(ctx.otPaidHours("e2", "2026-11-16", "Banawa", 2, "2026-11-18"), 2);

    ctx.S.settings.otSignedCopyRequired = true;
    assert.equal(ctx.otSignedCopyApplies("2026-11-15"), false);
    assert.equal(ctx.otPaidHours("e1", "2026-11-16", "Banawa", 3, "2026-11-15"), 3);
    assert.equal(ctx.otSignedCopyApplies("2026-11-16"), true);
    assert.equal(ctx.otPaidHours("e1", "2026-11-16", "Banawa", 3, "2026-11-16"), 0);
    assert.equal(ctx.otPaidHours("e2", "2026-11-16", "Banawa", 2, "2026-11-18"), 0);
    assert.equal(ctx.otPaidHours("e1", "2026-11-16", "Banawa", 0, "2026-11-18"), 0);

    ctx.S.otreps.r1 = stamped;
    assert.equal(ctx.hrOtSignedCopyConfirms("e1", "2026-11-16", "Banawa"), true);
    assert.equal(ctx.hrOtSignedCopyConfirms("e2", "2026-11-16", "Banawa"), true);
    assert.equal(ctx.otPaidHours("e1", "2026-11-16", "Banawa", 3, "2026-11-18"), 3);
    assert.equal(ctx.otPaidHours("e2", "2026-11-16", "Banawa", 2, "2026-11-18"), 2);
    assert.equal(ctx.S.otreps.r1.rows[0].hours, 3);
    assert.equal(daily.rows.e1.ot, 3);
    assert.equal(daily.rows.e1.otTouched, true);
    assert.equal(payrun.lines.e1.otTouched, true);
    assert.equal(payrun.lines.e1.lateTouched, true);
    assert.equal(payrun.lines.e1.caTouched, true);
    assert.equal(payrun.lines.e1.ca, 40);
    assert.equal(JSON.stringify(daily), dailyBefore);
    assert.equal(JSON.stringify(payrun), payBefore);

    ctx.S.settings.otFormGateWaived = false;
    ctx.S.settings.otSignedCopyRequired = true;
    ctx.S.otreps.r1 = report;
    assert.equal(ctx.otPaidHours("e1", "2026-11-16", "Banawa", 3, "2026-11-11"), 3);
    assert.equal(ctx.otPaidHours("e1", "2026-11-16", "Banawa", 3, "2026-11-18"), 0);
    ctx.S.otreps.r1 = stamped;
    assert.equal(ctx.otPaidHours("e1", "2026-11-16", "Banawa", 3, "2026-11-18"), 3);

    delete ctx.S.settings.otSignedCopyRequired;
    assert.equal(ctx.otSignedCopyRequired(), false);
    assert.equal(ctx.hrOtSignedCopyRequired(), false);
    assert.equal(ctx.otPaidHours("e1", "2026-11-16", "Banawa", 3, "2026-11-18"), 3);
    ctx.S.settings.otFormGateWaived = true;
    assert.equal(ctx.otPaidHours("e1", "2026-11-16", "Banawa", 3, "2026-11-18"), 3);
    assert.equal(JSON.stringify(daily), dailyBefore);
    assert.equal(JSON.stringify(payrun), payBefore);
  });
});
