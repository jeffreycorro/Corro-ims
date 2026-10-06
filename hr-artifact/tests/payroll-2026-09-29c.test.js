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

function extractConstArray(src, name) {
  const needle = "const " + name;
  const start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  const i0 = src.indexOf("[", start);
  let i = i0;
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(i0, i + 1);
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
      ui: {},
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
    "paySiteName",
    "payFilterLines",
    "payLineSum",
    "paySiteGroups",
    "leaverStatusWithPastDate",
    "recentManpowerIds",
    "contribEngaged",
    "contribHay",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function putDay(ctx, date, rows, extra) {
  const id = "d" + date.replace(/-/g, "");
  ctx.S.daily[id] = Object.assign({ id, date, rows, fixed: true }, extra || {});
}

const WEEK = { from: "2026-08-20", to: "2026-08-26" };

/* The filter that was live on build 2026-09-29b: active today, and listed. */
function legacyContribInclude(ctx, e) {
  if (!ctx.payPersonListed(e)) return false;
  if (ctx.empStatusIsSeparated(e)) return false;
  if (ctx.empSeparatedAsOf(e, "2026-09-29")) return false;
  const on = ctx.empSeparationDate(e);
  if (on && on <= "2026-09-29") return false;
  const hired = ctx.empHireDate(e);
  if (hired && hired > "2026-09-29") return false;
  return true;
}

describe("2026-09-29c payroll roster, sites, and contributions", () => {
  it("is build 2026-10-05a and the run can filter or group by site", () => {
    assert.match(html, /const BUILD = "2026-10-06a"/);
    const view = extractFunction(html, "viewPayrollRun");
    assert.match(view, /id="pay-site"/);
    assert.match(view, /id="pay-group"/);
    assert.match(view, /Group by site/);
    assert.match(view, /no rate/);
    assert.match(view, /paySiteGroups/);
    const paper = extractFunction(html, "payPaper");
    assert.match(paper, /GRAND TOTAL/);
    assert.match(paper, /pfBand/);
    assert.match(paper, /no rate/);
    const csv = html.slice(html.indexOf('const payCsvBtn=$("#pay-csv"'));
    assert.match(csv.slice(0, 1600), /subtotal/);
    assert.doesNotMatch(html, /payGroupSite\s*:\s*true/);
    assert.match(extractFunction(html, "payDayRow"), /dailyRowForEmp/);
    assert.doesNotMatch(extractFunction(html, "payDayRow"), /dailyPeople/);
  });

  it("does not invent days for a blank hire with no saved manpower row, and flags a zero rate", () => {
    const ctx = loadPay();
    ctx.S.employees.e1365 = {
      id: "e1365",
      empNo: "1365",
      name: "Cabarrubias, John Mark",
      position: "Caretaker",
      project: "ADMINS",
      status: "",
      rateType: "Daily",
      dailyRate: 0,
      dateHired: "",
    };
    ctx.dailyPeople = () => [ctx.S.employees.e1365];
    putDay(ctx, "2026-08-20", {}, { fixed: false });
    putDay(ctx, "2026-08-21", {}, { fixed: false });
    const dates = ctx.payDates(WEEK.from, WEEK.to);
    const line = ctx.payLine(ctx.S.employees.e1365, "weekly", dates, null);
    assert.equal(line.days, 0);
    assert.equal(line.ot, 0);
    const worked = ctx.payRunLines("weekly", WEEK, dates, null).filter((L) => L.days > 0 || L.ot > 0);
    assert.equal(worked.some((L) => L.empId === "e1365"), false);

    ctx.S.employees.e1365.dateHired = "2026-09-12";
    assert.equal(ctx.payRosterInclude(ctx.S.employees.e1365, WEEK), false);

    ctx.S.employees.e1365.dateHired = "";
    putDay(ctx, "2026-08-20", { e1365: { s: "Present", site: "ADMINS" } });
    putDay(ctx, "2026-08-21", { e1365: { s: "Present", site: "ADMINS" } });
    const paid = ctx.payLine(ctx.S.employees.e1365, "weekly", dates, null);
    assert.equal(paid.days, 2);
    assert.equal(paid.daily, 0);
    assert.match(paid.payWarn, /No daily rate/);
  });

  it("still leaves off a hire dated after the period", () => {
    const ctx = loadPay();
    ctx.S.employees.bev = {
      id: "bev",
      empNo: "1409",
      name: "Bevencio, Sample",
      status: "Regular",
      rateType: "Daily",
      dailyRate: 550,
      dateHired: "2026-09-08",
    };
    putDay(ctx, "2026-08-24", { bev: { s: "Present", site: "Banawa" } });
    assert.equal(ctx.payRosterInclude(ctx.S.employees.bev, WEEK), false);
    assert.equal(ctx.payPeople("weekly", WEEK).some((e) => e.id === "bev"), false);
  });

  it("counts days worked through the last day of engagement and drops the days after", () => {
    const ctx = loadPay();
    ctx.S.employees.left = {
      id: "left",
      empNo: "1410",
      name: "Resigned, Rio",
      status: "Resigned",
      separatedOn: "2026-08-24",
      rateType: "Daily",
      dailyRate: 500,
    };
    putDay(ctx, "2026-08-20", { left: { s: "Present", ot: 2, site: "Banawa" } });
    putDay(ctx, "2026-08-21", { left: { s: "Present", ot: 1, site: "Banawa" } });
    putDay(ctx, "2026-08-24", { left: { s: "Present", ot: 4, site: "Banawa" } });
    putDay(ctx, "2026-08-25", { left: { s: "Present", ot: 3, site: "Banawa" } });
    assert.equal(ctx.payRosterInclude(ctx.S.employees.left, WEEK), true);
    const dates = ctx.payDates(WEEK.from, WEEK.to);
    const line = ctx.payLine(ctx.S.employees.left, "weekly", dates, null);
    assert.equal(line.days, 3);
    assert.equal(line.ot, 7);
    const later = { from: "2026-08-27", to: "2026-09-02" };
    assert.equal(ctx.payRosterInclude(ctx.S.employees.left, later), false);

    ctx.S.employees.none = {
      id: "none",
      empNo: "1411",
      name: "Quiet, Quin",
      status: "Separated",
      separatedOn: "2026-08-22",
      rateType: "Daily",
      dailyRate: 400,
    };
    assert.equal(ctx.payRosterInclude(ctx.S.employees.none, WEEK), true);
    const quiet = ctx.payLine(ctx.S.employees.none, "weekly", dates, null);
    assert.equal(quiet.days, 0);
    const shown = ctx.payRunLines("weekly", WEEK, dates, null).filter((L) => L.days > 0 || L.ot > 0);
    assert.equal(shown.some((L) => L.empId === "none"), false);
  });

  it("groups a run by site and sums people, days, overtime, gross, deductions, and net", () => {
    const ctx = loadPay();
    const lines = [
      { empId: "a", name: "One", site: "UP She Shelter", days: 6, ot: 2, gross: 3300, ded: 278.12, net: 3022 },
      { empId: "b", name: "Two", site: "UP She Shelter", days: 5, ot: 0, gross: 2750, ded: 100, net: 2650 },
      { empId: "c", name: "Three", site: "Banawa", days: 6, ot: 1, gross: 3360, ded: 50, net: 3310 },
    ];
    assert.equal(ctx.payFilterLines(lines, "").length, 3);
    assert.equal(
      JSON.parse(JSON.stringify(ctx.payFilterLines(lines, "Banawa"))).map((L) => L.empId).join(","),
      "c"
    );
    const groups = JSON.parse(JSON.stringify(ctx.paySiteGroups(lines)));
    assert.equal(groups.map((g) => g.site).join("|"), "Banawa|UP She Shelter");
    assert.equal(groups[1].T.n, 2);
    assert.equal(groups[1].T.days, 11);
    assert.equal(groups[1].T.ot, 2);
    assert.equal(groups[1].T.gross, 6050);
    assert.equal(groups[1].T.ded, 378.12);
    assert.equal(groups[1].T.net, 5672);
    const all = ctx.payLineSum(lines);
    assert.equal(all.n, 3);
    assert.equal(all.days, 17);
    assert.equal(all.ot, 3);
  });

  it("lists engaged people, including Ben and John Mark, and reports the seed count", () => {
    const ctx = loadPay();
    const roster = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../public/separated-roster.json"), "utf8")
    );
    const known = {};
    (roster.employees || []).forEach((x) => {
      const no = String(x.empNo == null ? "" : x.empNo).replace(/\D/g, "");
      if (no) known[no] = { separatedOn: x.separatedOn || "", separationReason: x.separationReason || "" };
    });
    ctx.KNOWN_SEP = known;
    const seedStart = html.indexOf("const SEED=[");
    const SEED = JSON.parse(extractConstArray(html.slice(seedStart), "SEED"));
    const added = vm.runInNewContext("(" + extractConstArray(html, "MANPOWER_NEW") + ")");
    const emps = SEED.map((r, i) => {
      const [no, name, , position, hired, , , , , , , , , stat] = r;
      return {
        id: no ? "e" + no : "cf" + i,
        empNo: no || "",
        name,
        position: position || "",
        status: stat || "",
        dateHired: hired || "",
        dailyRate: 0,
        separatedOn: "",
        notes: "",
      };
    });
    added.forEach((n) => {
      if (emps.some((e) => String(e.empNo) === String(n.empNo))) return;
      emps.push({
        id: "e" + n.empNo,
        empNo: n.empNo,
        name: n.name,
        position: n.position || "",
        project: n.project || "",
        status: n.empNo === "1351" ? "Project-based" : "",
        dateHired: "",
        dailyRate: n.empNo === "1351" ? 550 : 0,
        separatedOn: n.empNo === "1351" ? "2026-09-02" : "",
        notes: "",
      });
    });
    const recent = {};
    let before = 0;
    let after = 0;
    let afterStamped = 0;
    emps.forEach((e) => {
      if (legacyContribInclude(ctx, e)) before += 1;
      if (ctx.contribEngaged(e, recent)) after += 1;
      const no = String(e.empNo || "").replace(/\D/g, "");
      const rec = known[no];
      const stamped = Object.assign({}, e);
      if (rec && !ctx.empStatusIsLive(e) && !ctx.empStatusIsSeparated(e)) {
        stamped.status = "Separated";
        if (rec.separatedOn) stamped.separatedOn = rec.separatedOn;
      }
      if (ctx.contribEngaged(stamped, recent)) afterStamped += 1;
    });
    /* Seed 227 + Raffy, Ben, Jaica. The live page showed 58 because a few
       people were added after this seed; the same filter on this file is 52. */
    assert.equal(emps.length, 230);
    assert.equal(before, 52);
    assert.equal(after, 229);
    assert.equal(afterStamped, 182);

    const mark = emps.find((e) => e.empNo === "1247");
    mark.notes = "Reported as resigned on the 31 Aug 2026 manpower report, but not official — resignation letter unsigned. Still on payroll.";
    assert.equal(ctx.contribEngaged(mark, recent), true);
    assert.equal(legacyContribInclude(ctx, mark), true);
    const hay = ctx.contribHay(mark).toLowerCase();
    assert.equal(["john", "mark", "1247"].every((w) => hay.includes(w)), true);

    const ben = emps.find((e) => e.empNo === "1351");
    assert.equal(ctx.empStatusIsLive(ben), true);
    assert.equal(legacyContribInclude(ctx, ben), false);
    assert.equal(ctx.contribEngaged(ben, recent), true);
    const benHay = ctx.contribHay(ben).toLowerCase();
    assert.equal(benHay.includes("ben") && benHay.includes("1351"), true);

    const gone = {
      id: "gone",
      empNo: "1999",
      name: "Left, Lea",
      status: "Separated",
      separatedOn: "2026-08-01",
    };
    assert.equal(ctx.contribEngaged(gone, recent), false);
    ctx.S.employees.gone = gone;
    putDay(ctx, "2026-09-10", { gone: { s: "Present" } });
    const seen = ctx.recentManpowerIds(30);
    assert.equal(ctx.contribEngaged(gone, seen), true);

    assert.equal(ctx.empStatusIsLive({ status: "Contractual" }), true);
    assert.equal(ctx.empStatusIsLive({ status: "Seasonal" }), true);
    assert.equal(ctx.contribEngaged({ id: "x", name: "Season, Sue", status: "Seasonal" }, recent), true);
    assert.equal(
      ctx.contribEngaged({ id: "y", name: "Open, Ollie", status: "Separated", separatedOn: "" }, recent),
      true
    );
  });
});
