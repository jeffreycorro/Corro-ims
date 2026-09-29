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

function loadPay() {
  const ctx = {
    S: {
      employees: {},
      daily: {},
      settings: { ded: { sss: 325, phic: 131.25, hdmf: 100 }, otPolicy: 1 },
      advances: {},
    },
    TODAY: "2026-09-28",
    KNOWN_SEP: null,
    STATUS_PENDING: "Has not yet arrived",
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
    },
    empList() {
      return Object.values(ctx.S.employees);
    },
    isoDate(t) {
      return (
        t.getFullYear() +
        "-" +
        String(t.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(t.getDate()).padStart(2, "0")
      );
    },
    payDates(from, to) {
      const out = [];
      let d = from;
      while (d && d <= to) {
        out.push(d);
        d = ctx.addDays(d, 1);
      }
      return out;
    },
    dailyGet(d) {
      return ctx.S.daily["d" + String(d).replace(/-/g, "")] || null;
    },
    dayVal(r, k, fallback) {
      return r && r[k] != null && r[k] !== "" ? Number(r[k]) : fallback;
    },
    holCode() {
      return 0;
    },
    holRate() {
      return 0;
    },
    holEligible() {
      return false;
    },
    effectiveStatus(empId, date, raw) {
      return raw || "Present";
    },
    dailyPeople() {
      return [];
    },
    payCaDue() {
      return 0;
    },
    pesoCeil(n) {
      return Math.ceil(Number(n || 0) - 1e-9);
    },
    flipName(n) {
      const s = String(n || "");
      if (s.indexOf(",") < 0) return s;
      const p = s.split(",");
      return (p.slice(1).join(",") + " " + p[0]).replace(/\s+/g, " ").trim();
    },
  };
  const names = [
    "addDays",
    "weekStart",
    "semiPeriod",
    "payPeriod",
    "statusTextIsSeparated",
    "empStatusIsLive",
    "empStatusIsSeparated",
    "knownSepRec",
    "empSeparatedAsOf",
    "empHireDate",
    "empSeparationDate",
    "empNotYetHired",
    "rowHasEnteredData",
    "dailyRowShown",
    "dayCredit",
    "dailyId",
    "mergeDailyRowKeep",
    "normPersonName",
    "summaryPersonId",
    "dailyRecordFor",
    "dailyRowForEmp",
    "logStampKey",
    "otAmountFromHistory",
    "dailyOtEvents",
    "recoverableDailyOt",
    "payrollOtHours",
    "payDayAmount",
    "payDayAfterSeparation",
    "summaryDayOt",
    "payDayRow",
    "dailyMonitorTotals",
    "payDaysFor",
    "manpowerPayTally",
    "payRate",
    "docSlotRefused",
    "govDeductionRefused",
    "empStatSet",
    "empStat",
    "payRunStatValue",
    "payStatKept",
    "payStat",
    "payStatForLine",
    "payTotals",
    "payLine",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

describe("2026-09-28b payroll — monitoring week equals payroll", () => {
  it("is build 2026-09-29a and offers recompute", () => {
    assert.match(html, /const BUILD = "2026-09-29a"/);
    assert.match(html, /id="pay-recompute"/);
    assert.match(html, /Recompute from attendance/);
    assert.match(extractFunction(html, "viewPayrollRun"), /data-payf/);
    assert.doesNotMatch(extractFunction(html, "viewPayrollRun"), /data-payf="[^"]*" disabled/);
    const payEditAt = html.indexOf("const payEdit=async");
    assert.ok(payEditAt > 0);
    assert.match(html.slice(payEditAt, payEditAt + 900), /statTouched=true/);
    assert.match(extractFunction(html, "payslipBody"), /L\.refusedContrib && \/SSS contribution/);
    assert.match(extractFunction(html, "attendanceSummaryCard"), /summaryDayOt/);
    assert.match(extractFunction(html, "attendanceSummaryCard"), /dailyRecordFor/);
  });

  it("keeps Saturday inside the Thursday–Wednesday week and does not shift Manila dates", () => {
    const ctx = loadPay();
    assert.equal(ctx.addDays("2026-09-26", 1), "2026-09-27");
    assert.equal(ctx.weekStart("2026-09-21"), "2026-09-17");
    assert.equal(ctx.weekStart("2026-09-26"), "2026-09-24");
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.payPeriod("weekly", "2026-09-21"))), {
      from: "2026-09-17",
      to: "2026-09-23",
    });
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.payPeriod("weekly", "2026-09-26"))), {
      from: "2026-09-24",
      to: "2026-09-30",
    });
    const satWeek = ctx.payDates("2026-09-24", "2026-09-30");
    assert.ok(satWeek.includes("2026-09-26"));
    assert.equal(satWeek.length, 7);
  });

  it("matches Daily Manpower monitoring days and OT for a Mon–Sat week", () => {
    const ctx = loadPay();
    const emp = {
      id: "e1358",
      empNo: "1358",
      name: "Celestial, Clifford Jan P.",
      status: "Regular",
      rateType: "Daily",
      dailyRate: 400,
      dateHired: "2024-01-06",
      project: "CTU BARILI",
      docs: { govrefuse: { s: "on", link: "https://drive.example/kasabutan.pdf" } },
    };
    ctx.S.employees.e1358 = emp;
    const from = "2026-09-21";
    const to = "2026-09-26";

    ctx.S.daily.d20260921 = {
      id: "d20260921",
      date: "2026-09-21",
      fixed: true,
      rows: { e1358: { s: "Present", ot: 2, site: "CTU BARILI" } },
    };
    ctx.S.daily.d20260922 = {
      id: "d20260922",
      date: "2026-09-22",
      fixed: true,
      rows: { e1358: { s: "Half Day", ot: 1, site: "CTU BARILI" } },
    };
    ctx.S.daily["scan-sep-23"] = {
      id: "scan-sep-23",
      date: "2026-09-23",
      fixed: true,
      rows: { e1358: { s: "Present", ot: null, site: "CTU BARILI" } },
      log: [
        {
          at: "2026-09-23 16:40",
          by: "Cassie",
          ch: [{ id: "e1358", f: "ot", from: "", to: "4" }],
        },
      ],
    };
    ctx.S.daily.d20260924 = {
      id: "d20260924",
      date: "2026-09-24",
      fixed: true,
      rows: { "1358": { s: "Leave", ot: 0, site: "CTU BARILI" } },
    };
    ctx.S.daily.d20260925 = {
      id: "d20260925",
      date: "2026-09-25",
      fixed: true,
      rows: { "Celestial, Clifford Jan P.": { s: "Leave with Pay", ot: 1.5, site: "CTU BARILI" } },
    };
    ctx.S.daily.d20260926 = {
      id: "d20260926",
      date: "2026-09-26",
      fixed: true,
      rows: { e1358: { s: "Rest Day", day: 0, ot: 2, site: "CTU BARILI" } },
    };

    const monitor = ctx.dailyMonitorTotals("e1358", from, to);
    const pay = ctx.manpowerPayTally("e1358", from, to);
    assert.equal(monitor.days, 3.5);
    assert.equal(monitor.ot, 10.5);
    assert.equal(pay.days, monitor.days);
    assert.equal(pay.ot, monitor.ot);

    const stale = {
      days: 1,
      ot: 0,
      sss: 162.5,
      phic: 65.62,
      hdmf: 50,
    };
    const line = ctx.payLine(emp, "weekly", ctx.payDates(from, to), stale);
    assert.equal(line.days, 3.5);
    assert.equal(line.ot, 10.5);
    assert.equal(line.sss, 0);
    assert.equal(line.phic, 0);
    assert.equal(line.hdmf, 0);
    assert.equal(line.refusedContrib, true);
    assert.ok(line.ded < 1);

    const edited = ctx.payLine(emp, "weekly", ctx.payDates(from, to), {
      statTouched: true,
      sss: 40,
      phic: 0,
      hdmf: 12.5,
      days: 99,
      ot: 0,
    });
    assert.equal(edited.days, 3.5);
    assert.equal(edited.ot, 10.5);
    assert.equal(edited.sss, 40);
    assert.equal(edited.phic, 0);
    assert.equal(edited.hdmf, 12.5);
    assert.ok(Math.abs(edited.ded - 52.5) < 0.001);
  });
});
