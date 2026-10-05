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
    payDates(from, to) {
      const out = [];
      let d = from;
      while (d && d <= to) {
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
      if (raw === "Absent" && date === "2026-09-16") return "Leave";
      return raw || "Present";
    },
    dailyPeople(rec) {
      return ctx._dailyPeople ? ctx._dailyPeople(rec) : [];
    },
    payCaDue() {
      return 0;
    },
    pesoCeil(n) {
      return Math.ceil(Number(n || 0) - 1e-9);
    },
    peso(n) {
      return String(n);
    },
  };
  const names = [
    "statusTextIsSeparated",
    "empStatusIsLive",
    "empStatusIsSeparated",
    "knownSepRec",
    "empSeparatedAsOf",
    "empHireDate",
    "empNotYetHired",
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
    "summaryDayOt",
    "payPersonListed",
    "empSeparationDate",
    "payKindOf",
    "payRosterInclude",
    "payPeople",
    "payDayRow",
    "clockMinutes",
    "sessionIsHalf",
    "payDayBeforeHire",
    "payDayAmount",
    "payDayAfterSeparation",
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
    "payStatForLine",
    "contribSource",
    "payStat",
    "payTotals",
    "payLine",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function putDay(ctx, date, rows, extra) {
  const id = "d" + date.replace(/-/g, "");
  ctx.S.daily[id] = Object.assign({ id, date, rows, fixed: true }, extra || {});
}

describe("2026-09-28 payroll — active roster only", () => {
  it("is build 2026-10-05a", () => {
    assert.match(html, /const BUILD = "2026-10-05a"/);
  });

  it("drops non-active statuses and a separation date on or before the period start", () => {
    const ctx = loadPay();
    ctx.KNOWN_SEP = {
      1267: { separatedOn: "2026-08-31", separationReason: "confirmed by HR" },
    };
    ctx.S.employees = {
      nem: {
        id: "nem",
        empNo: "1267",
        name: "Deliña, Nemuel B.",
        status: "",
        rateType: "Daily",
        position: "TIMEKEEPER/MATERIAL CONTROL",
      },
      live: {
        id: "live",
        empNo: "1351",
        name: "Pasion, Ben",
        status: "Project-based",
        rateType: "Daily",
      },
      reg: { id: "reg", empNo: "1358", name: "Celestial, Clifford Jan P.", status: "Regular", rateType: "Daily" },
      act: { id: "act", empNo: "2001", name: "Active, Ann", status: "Active", rateType: "Monthly" },
      blank: { id: "blank", empNo: "2002", name: "Blank, Bea", status: "", rateType: "Daily" },
      prob: { id: "prob", empNo: "2003", name: "Prob, Pia", status: "Probationary", rateType: "Daily" },
      eoc: { id: "eoc", empNo: "2004", name: "End, Eve", status: "End of contract", rateType: "Daily" },
      eocShort: { id: "eocShort", empNo: "2005", name: "Eoc, Eli", status: "EOC", rateType: "Daily" },
      ina: { id: "ina", empNo: "2006", name: "In, Ian", status: "Inactive", rateType: "Daily" },
      ret: { id: "ret", empNo: "2007", name: "Ret, Rio", status: "retired", rateType: "Daily" },
      dec: { id: "dec", empNo: "2008", name: "Dec, Dee", status: "Deceased", rateType: "Daily" },
      nameless: { id: "nameless", empNo: "2009", name: "  ", status: "Regular", rateType: "Daily" },
      ytang: { id: "ytang", empNo: "", name: "Ytang, Abundio", status: "", rateType: "Daily", dailyRate: 0 },
      mid: {
        id: "mid",
        empNo: "2010",
        name: "Mid, Mia",
        status: "Regular",
        separatedOn: "2026-09-14",
        rateType: "Daily",
      },
      dated: {
        id: "dated",
        empNo: "2011",
        name: "Dated, Dan",
        status: "Regular",
        separatedOn: "2026-09-01",
        rateType: "Daily",
      },
    };
    putDay(ctx, "2026-09-11", { nem: { s: "Present" }, reg: { s: "Present" } });
    const week = { from: "2026-09-10", to: "2026-09-16" };
    const semiDuring = { from: "2026-08-28", to: "2026-09-12" };
    const semiAfter = { from: "2026-09-13", to: "2026-09-27" };
    const custom = { from: "2026-09-01", to: "2026-09-05" };
    assert.equal(ctx.payRosterInclude(ctx.S.employees.nem, week), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.nem, semiDuring), true);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.nem, semiAfter), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.nem, custom), false);
    const nemDays = ctx.payDaysFor("nem", ctx.payDates("2026-09-11", "2026-09-11"));
    assert.equal(nemDays.reduce((n, x) => n + x.day, 0), 0);
    assert.equal(ctx.dayCredit({ s: "Separated" }), 0);
    assert.equal(ctx.dayCredit({ s: "Resigned" }), 0);
    assert.equal(ctx.dayCredit({ s: "Foo" }), 0);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.eoc, week), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.eocShort, week), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.ina, week), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.ret, week), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.dec, week), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.nameless, week), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.ytang, week), false);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.dated, custom), true);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.live, week), true);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.reg, week), true);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.blank, week), true);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.prob, week), true);
    assert.equal(ctx.payRosterInclude(ctx.S.employees.mid, week), true);
    const weeklyIds = ctx.payPeople("weekly", week).map((e) => e.id);
    assert.ok(weeklyIds.includes("reg"));
    assert.ok(weeklyIds.includes("blank"));
    assert.ok(weeklyIds.includes("prob"));
    assert.ok(weeklyIds.includes("mid"));
    assert.ok(!weeklyIds.includes("nem"));
    assert.ok(!weeklyIds.includes("eoc"));
    assert.ok(!weeklyIds.includes("ytang"));
    assert.deepEqual(
      ctx.payPeople("semi", week).map((e) => e.id),
      ["act"]
    );
  });
});

describe("2026-09-28 payroll — contributions", () => {
  it("defaults a signed refusal to 0 and keeps an explicit 0 distinct from not set", () => {
    const ctx = loadPay();
    const company = { ded: {} };
    assert.equal(ctx.empStat(company, "sss"), 325);
    assert.equal(ctx.empStatSet(company, "sss"), false);
    assert.equal(ctx.contribSource(company), "company");

    const refused = { docs: { govrefuse: { s: "on", link: "https://drive.example/kasabutan.pdf" } } };
    assert.equal(ctx.govDeductionRefused(refused), true);
    assert.equal(ctx.empStat(refused, "sss"), 0);
    assert.equal(ctx.empStat(refused, "phic"), 0);
    assert.equal(ctx.empStat(refused, "hdmf"), 0);
    assert.equal(ctx.contribSource(refused), "refused");
    assert.equal(ctx.payStat("weekly", "phic", refused), 0);

    const legacy = { docs: { kasabutan: { s: "on", link: "", links: [] } } };
    assert.equal(ctx.empStat(legacy, "sss"), 0);
    assert.equal(ctx.contribSource(legacy), "refused");

    const decline = { docs: { benefack: { s: "miss", links: [{ url: "https://drive.example/decline.pdf" }] } } };
    assert.equal(ctx.govDeductionRefused(decline), true);
    assert.equal(ctx.empStat(decline, "hdmf"), 0);

    const explicit = { ded: { sss: 0, phic: "", hdmf: 80 } };
    assert.equal(ctx.empStatSet(explicit, "sss"), true);
    assert.equal(ctx.empStat(explicit, "sss"), 0);
    assert.equal(ctx.empStat(explicit, "phic"), 131.25);
    assert.equal(ctx.empStat(explicit, "hdmf"), 80);
    assert.equal(ctx.payStat("weekly", "sss", explicit), 0);
    assert.equal(ctx.payStat("weekly", "phic", explicit), 65.62);

    assert.equal(ctx.contribSaveValue("", false), null);
    assert.equal(ctx.contribSaveValue("", true), 0);
    assert.equal(ctx.contribSaveValue("0", false), 0);
    assert.equal(ctx.contribSaveValue("0.00", true), 0);
    assert.equal(ctx.payRunStatValue(""), 0);
    assert.equal(ctx.payRunStatValue("0"), 0);
    assert.equal(ctx.payStatKept({ sss: 0 }, "sss", 162.5), 0);
    assert.equal(ctx.payStatKept({}, "sss", 162.5), 162.5);
    assert.equal(ctx.payStatKept({ sss: null }, "sss", 162.5), 0);

    const savedRun = { sss: 0, phic: 0, hdmf: 0 };
    const line = ctx.payLine(
      { id: "e1", empNo: "1", name: "Own, Olga", status: "Regular", rateType: "Daily", dailyRate: 570, ded: { sss: 400, phic: 131.25, hdmf: 100 } },
      "weekly",
      [],
      savedRun
    );
    assert.equal(line.sss, 0);
    assert.equal(line.phic, 0);
    assert.equal(line.hdmf, 0);
    assert.match(html, /refused \(Kasabutan\)/);
  });
});

describe("2026-09-28 payroll — attendance days match payroll", () => {
  it("uses one Daily Manpower tally for Attendance and Payroll Maker", () => {
    const ctx = loadPay();
    const from = "2026-09-10";
    const to = "2026-09-16";
    ctx.S.employees.e1358 = {
      id: "e1358",
      empNo: "1358",
      name: "Celestial, Clifford Jan P.",
      status: "Regular",
      rateType: "Daily",
      dailyRate: 300,
      dateHired: "2026-01-01",
      project: "ADMINS",
    };
    putDay(ctx, "2026-09-10", { e1358: { s: "Present", day: 0.25, ot: 1.5, site: "ADMINS" } });
    putDay(ctx, "2026-09-11", { e1358: { s: "Half Day", ot: null, site: "ADMINS" } });
    putDay(ctx, "2026-09-12", { e1358: { s: "Leave", site: "ADMINS" } });
    putDay(ctx, "2026-09-13", { e1358: { s: "Leave with Pay", ot: 2, site: "ADMINS" } });
    putDay(ctx, "2026-09-14", { e1358: { s: "Rest Day", site: "ADMINS" } });
    putDay(ctx, "2026-09-15", { e1358: { s: "Has not yet arrived", ot: 3, site: "ADMINS" } });
    putDay(ctx, "2026-09-16", { e1358: { s: "Absent", r: "AWOL", ot: 1, site: "ADMINS" } });

    const att = ctx.manpowerPayTally("e1358", from, to);
    const payRows = ctx.payDaysFor("e1358", ctx.payDates(from, to));
    const payDays = payRows.reduce((n, x) => n + (Number(x.day) || 0), 0);
    const payOt = payRows.reduce((n, x) => n + (Number(x.ot) || 0), 0);
    assert.equal(att.days, payDays);
    assert.equal(att.ot, payOt);
    assert.equal(att.days, 1.75);
    assert.equal(att.ot, 7.5);

    const line = ctx.payLine(ctx.S.employees.e1358, "weekly", ctx.payDates(from, to), null);
    assert.equal(line.days, att.days);
    assert.equal(line.ot, att.ot);
    assert.equal(line.daily, 300);
    assert.equal(line.basic, 525);

    assert.match(html, /manpowerPayTally\(r\.empId, p\.start, p\.end\)/);
    assert.match(html, /const days=payDaysFor\(e\.id,dates\)/);
    assert.match(extractFunction(html, "viewAttendance"), /manpowerPayTally/);
    assert.match(extractFunction(html, "payLine"), /payDaysFor/);
    assert.match(extractFunction(html, "manpowerPayTally"), /payDaysFor/);
  });

  it("four Present days and no OT are the same on Attendance and Payroll Maker", () => {
    const ctx = loadPay();
    ctx.S.employees.e1358 = {
      id: "e1358",
      empNo: "1358",
      name: "Celestial, Clifford Jan P.",
      status: "Regular",
      rateType: "Daily",
      dailyRate: 300,
      project: "ADMINS",
    };
    ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].forEach((d) => {
      putDay(ctx, d, { e1358: { s: "Present", ot: null, site: "ADMINS" } });
    });
    putDay(ctx, "2026-09-25", { e1358: { s: "Separated", site: "ADMINS" } });
    const from = "2026-09-21";
    const to = "2026-09-25";
    const att = ctx.manpowerPayTally("e1358", from, to);
    const line = ctx.payLine(ctx.S.employees.e1358, "weekly", ctx.payDates(from, to), null);
    assert.equal(att.days, 4);
    assert.equal(att.ot, 0);
    assert.equal(line.days, att.days);
    assert.equal(line.ot, att.ot);
    assert.equal(line.gross, 1200);
  });

  it("does not credit a day before hire, pays a Regular record through the window, and does not invent a Present", () => {
    const ctx = loadPay();
    ctx.S.employees.e1 = {
      id: "e1",
      empNo: "3001",
      name: "Nuevo, Bea",
      status: "Regular",
      rateType: "Daily",
      dailyRate: 500,
      dateHired: "2026-09-15",
      separatedOn: "2026-09-18",
    };
    putDay(ctx, "2026-09-14", { e1: { s: "Present", ot: null } });
    putDay(ctx, "2026-09-15", { e1: { s: "Present", ot: 2 } });
    putDay(ctx, "2026-09-17", { e1: { s: "Half Day", ot: 1 } });
    putDay(ctx, "2026-09-18", { e1: { s: "Present", ot: 4 } });
    const att = ctx.manpowerPayTally("e1", "2026-09-14", "2026-09-18");
    const line = ctx.payLine(ctx.S.employees.e1, "weekly", ctx.payDates("2026-09-14", "2026-09-18"), null);
    assert.equal(att.days, 2.5);
    assert.equal(att.ot, 7);
    assert.equal(line.days, att.days);
    assert.equal(line.ot, att.ot);

    ctx.S.employees.e2 = {
      id: "e2",
      empNo: "3002",
      name: "Open, Omar",
      status: "Regular",
      rateType: "Daily",
      dailyRate: 400,
    };
    ctx.S.daily.d20260920 = { id: "d20260920", date: "2026-09-20", rows: {}, fixed: false };
    ctx._dailyPeople = (rec) => (rec.date === "2026-09-20" ? [ctx.S.employees.e2] : []);
    const open = ctx.manpowerPayTally("e2", "2026-09-20", "2026-09-20");
    const openLine = ctx.payLine(ctx.S.employees.e2, "weekly", ["2026-09-20"], null);
    assert.equal(open.days, 0);
    assert.equal(open.ot, 0);
    assert.equal(openLine.days, open.days);
    assert.equal(openLine.ot, open.ot);
  });
});
