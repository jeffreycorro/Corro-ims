"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");
const fix = require("../public/hr-forms-fix");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const payrollSrc = fs.readFileSync(path.join(__dirname, "../public/hr-payroll.js"), "utf8");
const { mapDriveHttpError, driveQuotaReason } = require("../netlify/lib/google-drive");

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

function loadPayFns() {
  const ctx = {
    S: { employees: {}, daily: {}, settings: {} },
    TODAY: "2026-09-19",
    KNOWN_SEP: null,
    STATUS_PENDING: "Has not yet arrived",
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
    },
    empList() {
      return Object.values(ctx.S.employees);
    },
    payDates(from, to) {
      const out = [];
      let d = from;
      while (d <= to) {
        out.push(d);
        const t = new Date(d + "T00:00:00");
        t.setDate(t.getDate() + 1);
        const y = t.getFullYear();
        const m = String(t.getMonth() + 1).padStart(2, "0");
        const day = String(t.getDate()).padStart(2, "0");
        d = y + "-" + m + "-" + day;
      }
      return out;
    },
    dailyGet(d) {
      return ctx.S.daily["d" + String(d).replace(/-/g, "")] || null;
    },
  };
  const names = [
    "empStatusIsLive",
    "empStatusIsSeparated",
    "knownSepRec",
    "empSeparatedAsOf",
    "dayCredit",
    "payKindOf",
    "payRosterInclude",
    "payPeople",
    "leaveCaEvaluators",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function loadPayrollCompanion() {
  const root = { console };
  vm.runInNewContext(payrollSrc, {
    window: root,
    globalThis: root,
    console,
    Date,
    Math,
    JSON,
    Intl,
    Number,
    String,
    Object,
    Array,
    isNaN,
  });
  return root.hrPayroll;
}

describe("2026-09-19 concern sheet — payroll excludes leavers", () => {
  it("drops Separated / resigned / terminated / AWOL from the active weekly roster", () => {
    const ctx = loadPayFns();
    ctx.S.employees = {
      e1: { id: "e1", name: "Active, Ann", status: "Regular", rateType: "Daily" },
      e2: { id: "e2", name: "Adolfo, Jomarie", status: "Separated", separatedOn: "2026-04-01", rateType: "Daily" },
      e3: { id: "e3", name: "Resigned, Ray", status: "Resigned", separatedOn: "2026-08-01", rateType: "Daily" },
      e4: { id: "e4", name: "Fired, Fay", status: "Terminated", rateType: "Daily" },
      e5: { id: "e5", name: "Gone, Gus", status: "AWOL", rateType: "Daily" },
    };
    const per = { from: "2026-09-17", to: "2026-09-23" };
    const ids = ctx.payPeople("weekly", per).map((e) => e.id);
    assert.deepEqual(ids, ["e1"]);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.e2, per), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.e3, per), false);
    assert.equal(ctx.empStatusIsSeparated(ctx.S.employees.e4), true);
    assert.equal(ctx.empStatusIsSeparated(ctx.S.employees.e5), true);
  });

  it("keeps a leaver on a past period only when they have credited days", () => {
    const ctx = loadPayFns();
    ctx.S.employees = {
      eBen: {
        id: "eBen",
        name: "Pasion, Ben",
        status: "Separated",
        separatedOn: "2026-08-26",
        rateType: "Daily",
      },
      eIdle: {
        id: "eIdle",
        name: "Idle, Ivy",
        status: "Separated",
        separatedOn: "2026-09-20",
        rateType: "Daily",
      },
    };
    ctx.S.daily.d20260824 = {
      date: "2026-08-24",
      rows: { eBen: { s: "Present" } },
    };
    const august = { from: "2026-08-20", to: "2026-08-26" };
    const sept = { from: "2026-09-17", to: "2026-09-23" };
    assert.equal(ctx.payRosterInclude(ctx.S.employees.eBen, august), true);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.eBen, sept), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.eIdle, sept), false);
    assert.ok(ctx.payPeople("weekly", august).some((e) => e.id === "eBen"));
    assert.ok(!ctx.payPeople("weekly", sept).some((e) => e.id === "eBen"));
  });

  it("peopleForKind in the payroll companion uses the same leaver flags", () => {
    const P = loadPayrollCompanion();
    const S = {
      employees: {
        e1: { id: "e1", name: "Active, Ann", status: "Regular", rateType: "Daily", empNo: "1" },
        e2: { id: "e2", name: "Left, Lou", status: "Separated", rateType: "Daily", empNo: "2" },
        e3: { id: "e3", name: "Resigned, Ray", status: "resigned", rateType: "Daily", empNo: "3" },
      },
    };
    const list = P.peopleForKind("weekly", S);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "e1");
    assert.equal(P.empStatusIsSeparated({ status: "Terminated" }), true);
    assert.equal(P.empStatusIsSeparated({ status: "Regular" }), false);
  });
});

describe("2026-09-19 concern sheet — Leave/CA Catherine + upload quota", () => {
  it("lists Catherine Largo as Evaluated by on both Leave and Cash Advance", () => {
    const ctx = loadPayFns();
    ctx.S.settings = {
      payrollBy: "Catherine A. Largo",
      payrollTitle: "Safety Officer",
    };
    const list = ctx.leaveCaEvaluators();
    assert.equal(list.length, 1);
    assert.equal(list[0].who, "Evaluated by");
    assert.match(list[0].name, /Catherine A\. Largo/);
    assert.equal(list[0].role, "Safety Officer");

    const fromFix = fix.leaveCaEvaluators({
      settings: { payrollBy: "Catherine A. Largo", payrollTitle: "Safety Officer" },
    });
    assert.match(fromFix[0].name, /Catherine/);
    assert.match(html, /leaveCaEvaluators\(\)\[0\]/);
    assert.match(html, /function printLeave/);
    assert.match(html, /function printCA/);
    const leaveSign = html.slice(html.indexOf("function printLeave"), html.indexOf("function printLeave") + 2800);
    const caSign = html.slice(html.indexOf("function printCA"), html.indexOf("function printCA") + 2800);
    assert.match(leaveSign, /leaveCaEvaluators\(\)\[0\]/);
    assert.match(caSign, /leaveCaEvaluators\(\)\[0\]/);
  });

  it("raises the Leave/CA scan cap to 80 MB and maps Drive storage quota", () => {
    assert.match(html, /const MAX_UPLOAD_MB = 80/);
    assert.doesNotMatch(html, /const MAX_UPLOAD_MB = 15/);
    assert.match(html, /const BUILD = "2026-09-24d"/);

    const quota = mapDriveHttpError(403, {
      error: {
        message: "The user's Drive storage quota has been exceeded.",
        errors: [{ reason: "storageQuotaExceeded" }],
      },
    });
    assert.equal(quota.code, "quota_exceeded");
    assert.match(quota.message, /GOOGLE_DRIVE_DELEGATED_USER|Shared Drive/);
    assert.equal(
      driveQuotaReason({}, "The file upload quota has been reached"),
      true
    );
  });
});
