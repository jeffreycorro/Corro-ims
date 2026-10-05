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
    TODAY: "2026-09-29",
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
    "payDayBeforeHire",
    "rowHasEnteredData",
    "dailyRowShown",
    "dayCredit",
    "dailyId",
    "mergeDailyRowKeep",
    "normPersonName",
    "personMatchKey",
    "summaryPersonId",
    "dailyRecordFor",
    "dailyRowForEmp",
    "logStampKey",
    "otAmountFromHistory",
    "dailyOtEvents",
    "recoverableDailyOt",
    "payrollOtHours",
    "clockMinutes",
    "sessionIsHalf",
    "payDayAmount",
    "payDayAfterSeparation",
    "summaryDayOt",
    "payPersonListed",
    "payKindOf",
    "payRosterInclude",
    "payPeople",
    "payDayRow",
    "payDaysFor",
    "manpowerPayTally",
    "payRate",
    "docSlotRefused",
    "govDeductionRefused",
    "empStatSet",
    "empStat",
    "contribSaveValue",
    "payRunStatValue",
    "payStatKept",
    "payStat",
    "payStatForLine",
    "payTotals",
    "payLine",
    "payLooseKey",
    "payUnmatchedWhy",
    "payUnmatchedLines",
    "payFutureHireNotes",
    "payRunLines",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function putDay(ctx, date, rows) {
  const id = "d" + date.replace(/-/g, "");
  ctx.S.daily[id] = { id, date, rows, fixed: true };
}

const WEEK = { from: "2026-08-20", to: "2026-08-26" };

describe("2026-09-29b payroll — hire date, name match, half day", () => {
  it("is build 2026-10-05a and recompute still rereads attendance", () => {
    assert.match(html, /const BUILD = "2026-10-05a"/);
    assert.match(html, /id="pay-recompute"/);
    const handler = html.slice(html.indexOf('const payRec=$("#pay-recompute"'));
    assert.match(handler.slice(0, 800), /delete line\.days/);
    assert.match(handler.slice(0, 800), /delete line\.ot/);
    assert.match(extractFunction(html, "viewPayrollRun"), /payFutureHireNotes/);
    assert.match(extractFunction(html, "viewPayrollRun"), /check 201/);
    const built = html.slice(html.indexOf("const payBuild=()=>{"));
    assert.match(built.slice(0, 500), /payRunLines/);
  });

  it("keeps Thursday–Wednesday and does not pay before the hire date", () => {
    const ctx = loadPay();
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.payPeriod("weekly", "2026-08-24"))), WEEK);
    ctx.S.employees = {
      late: {
        id: "late",
        empNo: "9001",
        name: "Bevencio, Sample",
        status: "Project-based",
        rateType: "Daily",
        dailyRate: 500,
        dateHired: "2026-09-08",
      },
      mid: {
        id: "mid",
        empNo: "9002",
        name: "Mid, Hired",
        status: "Regular",
        rateType: "Daily",
        dailyRate: 400,
        dateHired: "2026-08-24",
      },
      blank: {
        id: "blank",
        empNo: "9003",
        name: "Blank, Hire",
        status: "",
        rateType: "Daily",
        dailyRate: 400,
      },
      sep: {
        id: "sep",
        empNo: "9004",
        name: "Left, Lea",
        status: "Separated",
        rateType: "Daily",
        dailyRate: 400,
        dateHired: "2024-01-01",
      },
      proj: {
        id: "proj",
        empNo: "9005",
        name: "Proj, Pia",
        status: "Project-based",
        rateType: "Daily",
        dailyRate: 400,
        dateHired: "2026-08-20",
      },
    };
    ["2026-08-20", "2026-08-21", "2026-08-24", "2026-08-25"].forEach((d) => {
      putDay(ctx, d, {
        late: { s: "Present", ot: d === "2026-08-20" ? 3 : "" },
        mid: { s: "Present", ot: d === "2026-08-20" ? 4 : d === "2026-08-24" ? 2 : "" },
        blank: { s: "Present" },
        sep: { s: "Present" },
        proj: { s: "Present" },
      });
    });
    assert.equal(ctx.payRosterInclude(ctx.S.employees.late, WEEK), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.sep, WEEK), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.blank, WEEK), true);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.proj, WEEK), true);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.mid, WEEK), true);
    const ids = ctx.payPeople("weekly", WEEK).map((e) => e.id);
    assert.deepEqual(ids, ["blank", "mid", "proj"]);
    const mid = ctx.payLine(ctx.S.employees.mid, "weekly", ctx.payDates(WEEK.from, WEEK.to), { days: 9, ot: 9 });
    assert.equal(mid.days, 2);
    assert.equal(mid.ot, 2);
    const blank = ctx.payLine(ctx.S.employees.blank, "weekly", ctx.payDates(WEEK.from, WEEK.to), null);
    assert.equal(blank.days, 4);
    const notes = ctx.payFutureHireNotes("weekly", WEEK, ctx.payDates(WEEK.from, WEEK.to));
    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, "late");
    assert.equal(notes[0].hired, "2026-09-08");
  });

  it("matches a printed name that drops the middle initial and keeps the two Alquizalas apart", () => {
    const ctx = loadPay();
    assert.equal(
      ctx.personMatchKey("Alquizalas, John Mark B."),
      ctx.personMatchKey("Alquizalas, John Mark")
    );
    assert.equal(ctx.personMatchKey("Alquizalas, John Mark B."), ctx.personMatchKey("John Mark Alquizalas"));
    assert.notEqual(ctx.personMatchKey("Alquizalas, John Mark B."), ctx.personMatchKey("Alquizalas, John Louie B."));
    assert.equal(
      ctx.personMatchKey("Alegada, Azman Kenneth M."),
      ctx.personMatchKey("Alegada, Azman Kenneth")
    );
    ctx.S.employees = {
      jm: {
        id: "jm",
        empNo: "1247",
        name: "Alquizalas, John Mark B.",
        status: "",
        rateType: "Daily",
        dailyRate: 480,
        dateHired: "2024-11-25",
      },
      jl: {
        id: "jl",
        empNo: "1352",
        name: "Alquizalas, John Louie B.",
        status: "",
        rateType: "Daily",
        dailyRate: 450,
      },
      az: {
        id: "az",
        empNo: "1350",
        name: "Alegada, Azman Kenneth M.",
        status: "Project-based",
        rateType: "Daily",
        dailyRate: 540,
      },
      a: { id: "a", empNo: "1", name: "Santos, Juan A.", status: "Regular", rateType: "Daily", dailyRate: 400 },
      b: { id: "b", empNo: "2", name: "Santos, Juan B.", status: "Regular", rateType: "Daily", dailyRate: 400 },
    };
    assert.equal(ctx.summaryPersonId("Alquizalas, John Mark", { name: "Alquizalas, John Mark" }), "jm");
    assert.equal(ctx.summaryPersonId("Alquizalas, John Louie", {}), "jl");
    assert.equal(ctx.summaryPersonId("Alegada, Azman Kenneth", {}), "az");
    assert.equal(ctx.summaryPersonId("Santos, Juan", {}), "");
    const weekDays = ctx.payDates(WEEK.from, WEEK.to);
    const louie = new Set(["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-25", "2026-08-26"]);
    const aleg = new Set(["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-26"]);
    weekDays.forEach((d) => {
      const rows = {};
      rows["Alquizalas, John Mark"] = {
        s: "Present",
        name: "Alquizalas, John Mark",
        in: d === "2026-08-24" ? "1:00 PM" : "8:00 AM",
        out: "5:00 PM",
      };
      if (louie.has(d)) rows["Alquizalas, John Louie"] = { s: "Present", name: "Alquizalas, John Louie" };
      if (aleg.has(d)) rows["Alegada, Azman Kenneth"] = { s: "Present", name: "Alegada, Azman Kenneth" };
      putDay(ctx, d, rows);
    });
    const lines = ctx
      .payRunLines("weekly", WEEK, ctx.payDates(WEEK.from, WEEK.to), null)
      .filter((L) => L.days > 0);
    const byId = Object.fromEntries(lines.map((L) => [L.empId, L]));
    assert.ok(byId.jm);
    assert.ok(byId.jl);
    assert.ok(byId.az);
    assert.equal(byId.jl.days, 5);
    assert.equal(Math.round(byId.jl.gross * 100) / 100, 2250);
    assert.equal(byId.az.days, 4);
    assert.equal(Math.round(byId.az.gross * 100) / 100, 2160);
    assert.equal(byId.jm.days, 6.5);
    assert.equal(Math.round(byId.jm.gross * 100) / 100, 3120);
    assert.equal(byId.jm.daily, 480);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.jm, WEEK), true);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.jl, WEEK), true);
  });

  it("shows attendance that matches no single 201 record, with the reason", () => {
    const ctx = loadPay();
    ctx.S.employees = {
      a: { id: "a", empNo: "1", name: "Santos, Juan A.", status: "Regular", rateType: "Daily", dailyRate: 400 },
      b: { id: "b", empNo: "2", name: "Santos, Juan B.", status: "Regular", rateType: "Daily", dailyRate: 400 },
      norate: {
        id: "norate",
        empNo: "3",
        name: "No, Rate",
        status: "Active",
        rateType: "Daily",
        dailyRate: 0,
      },
    };
    putDay(ctx, "2026-08-20", {
      "Ghost, Gary": { s: "Present", name: "Ghost, Gary", ot: 2 },
      "Santos, Juan": { s: "Present", name: "Santos, Juan" },
      norate: { s: "Present" },
      "8811": { s: "Present", empNo: "8811", name: "Unknown, Uno" },
    });
    const extra = ctx.payUnmatchedLines("weekly", ["2026-08-20"]);
    const ghost = extra.find((L) => /Ghost/.test(L.name));
    const juan = extra.find((L) => /Santos/.test(L.name));
    const uno = extra.find((L) => /8811/.test(L.empNo) || /Unknown/.test(L.name));
    assert.ok(ghost);
    assert.match(ghost.payWarn, /No 201 record matches/);
    assert.equal(ghost.days, 1);
    assert.equal(ghost.ot, 2);
    assert.equal(ghost.daily, 0);
    assert.ok(juan);
    assert.match(juan.payWarn, /matches 2 employee records/);
    assert.ok(uno);
    assert.match(uno.payWarn, /8811/);
    const line = ctx.payLine(ctx.S.employees.norate, "weekly", ["2026-08-20"], null);
    assert.match(line.payWarn, /No daily rate/);
    assert.equal(ctx.payUnmatchedLines("semi", ["2026-08-20"]).length, 0);
  });

  it("counts an afternoon-only or morning-only session as half a day", () => {
    const ctx = loadPay();
    assert.equal(ctx.clockMinutes("1:00 PM"), 13 * 60);
    assert.equal(ctx.clockMinutes("1 PM"), 13 * 60);
    assert.equal(ctx.clockMinutes("13:00"), 13 * 60);
    assert.equal(ctx.payDayAmount({ s: "Present", in: "1:00 PM", out: "5:00 PM" }, "x", "2026-08-24"), 0.5);
    assert.equal(ctx.payDayAmount({ s: "Present", in: "1 PM" }, "x", "2026-08-24"), 0.5);
    assert.equal(ctx.payDayAmount({ s: "Present", in: "8:00 AM", out: "12:00" }, "x", "2026-08-24"), 0.5);
    assert.equal(ctx.payDayAmount({ s: "Present", in: "8:00 AM", out: "5:00 PM" }, "x", "2026-08-24"), 1);
    assert.equal(ctx.payDayAmount({ s: "Present", day: "1", in: "1:00 PM" }, "x", "2026-08-24"), 1);
    assert.equal(ctx.payDayAmount({ s: "Half Day", in: "8:00 AM", out: "5:00 PM" }, "x", "2026-08-24"), 0.5);
    assert.equal(ctx.payDayAmount({ s: "Present" }, "x", "2026-08-24"), 1);
    assert.equal(ctx.payDayAmount({ s: "Absent", in: "1:00 PM" }, "x", "2026-08-24"), 0);

    ctx.S.employees = {
      da: {
        id: "da",
        empNo: "1266",
        name: "De Asis, Antonio A. JR.",
        status: "Regular",
        rateType: "Daily",
        dailyRate: 570,
        dateHired: "2024-06-04",
      },
    };
    const full = ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-25", "2026-08-26"];
    full.forEach((d) => putDay(ctx, d, { da: { s: "Present", in: "8:00 AM", out: "5:00 PM", ot: d === "2026-08-20" ? 22.5 : "" } }));
    putDay(ctx, "2026-08-24", { da: { s: "Present", in: "1:00 PM", out: "5:00 PM" } });
    const savedDays = { days: 6, ot: 0 };
    const L = ctx.payLine(ctx.S.employees.da, "weekly", ctx.payDates(WEEK.from, WEEK.to), savedDays);
    assert.equal(L.days, 5.5);
    assert.equal(L.ot, 22.5);
    assert.equal(Math.round(L.gross * 100) / 100, 4738.13);
    assert.equal(L.sss, 162.5);
    assert.equal(L.phic, 65.62);
    assert.equal(L.hdmf, 50);
    assert.equal(L.net, ctx.pesoCeil(L.gross - L.ded));
    assert.notEqual(L.net, 4746);
    assert.ok(L.gross < 5023);
  });

  it("still zeros a Kasabutan and keeps an explicit 0", () => {
    const ctx = loadPay();
    const refused = {
      id: "ref",
      empNo: "1",
      name: "Ref, Used",
      status: "Regular",
      rateType: "Daily",
      dailyRate: 500,
      docs: { kasabutan: { s: "on" } },
    };
    const zero = {
      id: "zero",
      empNo: "2",
      name: "Zero, Zed",
      status: "Regular",
      rateType: "Daily",
      dailyRate: 500,
      ded: { sss: 0, phic: 0, hdmf: 0 },
    };
    assert.equal(ctx.govDeductionRefused(refused), true);
    assert.equal(ctx.payStatForLine("weekly", "sss", refused, {}), 0);
    assert.equal(ctx.empStat(zero, "sss"), 0);
    assert.equal(ctx.payStat("weekly", "sss", zero), 0);
    assert.equal(ctx.contribSaveValue("0", false), 0);
  });
});
