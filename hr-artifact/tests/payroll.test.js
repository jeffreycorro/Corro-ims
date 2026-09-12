"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadPayroll() {
  const src = fs.readFileSync(
    path.join(__dirname, "../public/hr-payroll.js"),
    "utf8"
  );
  const root = { console };
  vm.runInNewContext(src, { window: root, globalThis: root, console, Date, Math, JSON, Intl, Number, String, Object, Array, isNaN });
  return root.hrPayroll;
}

const P = loadPayroll();

function line(partial) {
  return P.computeLine(Object.assign({ otMultiplier: 1 }, partial));
}

describe("pay kinds, periods, release, run keys", () => {
  it("monthly rateType is semi; anything else is weekly", () => {
    assert.equal(P.payKindOf({ rateType: "Monthly" }), "semi");
    assert.equal(P.payKindOf({ rateType: "monthly" }), "semi");
    assert.equal(P.payKindOf({ rateType: "Daily" }), "weekly");
    assert.equal(P.payKindOf({ rateType: "" }), "weekly");
    assert.equal(P.payKindOf({ dept: "Admin", rateType: "Daily" }), "weekly");
  });

  function sameRange(got, from, to) {
    assert.equal(got.from, from);
    assert.equal(got.to, to);
  }

  it("weekly period is Thursday to Wednesday", () => {
    sameRange(P.payPeriod("weekly", "2026-08-20"), "2026-08-20", "2026-08-26");
    sameRange(P.payPeriod("weekly", "2026-08-26"), "2026-08-20", "2026-08-26");
    sameRange(P.payPeriod("weekly", "2026-08-23"), "2026-08-20", "2026-08-26");
    sameRange(P.payPeriod("weekly", "2026-08-19"), "2026-08-13", "2026-08-19");
  });

  it("semi periods are 13–27 and 28–12", () => {
    sameRange(P.payPeriod("semi", "2026-08-20"), "2026-08-13", "2026-08-27");
    sameRange(P.payPeriod("semi", "2026-08-13"), "2026-08-13", "2026-08-27");
    sameRange(P.payPeriod("semi", "2026-08-27"), "2026-08-13", "2026-08-27");
    sameRange(P.payPeriod("semi", "2026-08-28"), "2026-08-28", "2026-09-12");
    sameRange(P.payPeriod("semi", "2026-09-12"), "2026-08-28", "2026-09-12");
    sameRange(P.payPeriod("semi", "2026-09-01"), "2026-08-28", "2026-09-12");
  });

  it("standard release: Saturday after weekly Wednesday; 30th / 15th for semi", () => {
    assert.equal(P.payRelease("weekly", { from: "2026-08-20", to: "2026-08-26" }), "2026-08-29");
    assert.equal(P.payRelease("semi", { from: "2026-08-13", to: "2026-08-27" }), "2026-08-30");
    assert.equal(P.payRelease("semi", { from: "2026-08-28", to: "2026-09-12" }), "2026-09-15");
  });

  it("February semi 13–27 releases on the last day of the month", () => {
    assert.equal(P.payRelease("semi", { from: "2026-02-13", to: "2026-02-27" }), "2026-02-28");
    assert.equal(P.payRelease("semi", { from: "2028-02-13", to: "2028-02-27" }), "2028-02-29");
  });

  it("a hand-chosen range has a blank release date", () => {
    assert.equal(P.payRelease("semi", { from: "2026-08-13", to: "2026-08-20" }), "");
    assert.equal(P.payRelease("weekly", { from: "2026-08-20", to: "2026-08-22" }), "");
  });

  it("custom range uses its own payRunKey and does not collide with the standard run", () => {
    const std = P.payRunKey("semi", "2026-08-13", "2026-08-27");
    const custom = P.payRunKey("semi", "2026-08-13", "2026-08-20");
    assert.equal(std, "semi|2026-08-13");
    assert.equal(custom, "semi|2026-08-13|2026-08-20");
    assert.notEqual(std, custom);
    assert.equal(P.payRunKey("weekly", "2026-08-20", "2026-08-26"), "weekly|2026-08-20");
    assert.equal(P.payRunKey("weekly", "2026-08-20", "2026-08-22"), "weekly|2026-08-20|2026-08-22");
  });

  it("custom ranges step by their own length", () => {
    const n = P.stepRange("2026-08-13", "2026-08-20", 1);
    assert.equal(n.from, "2026-08-21");
    assert.equal(n.to, "2026-08-28");
  });
});

describe("rates", () => {
  it("monthly dailyRate is monthly salary / 26; allowance on the run is per half-month", () => {
    const r = P.payRate({ dailyRate: 19000, rateType: "Monthly", allowance: 1000 }, "semi");
    assert.equal(r.monthly, true);
    assert.equal(r.daily, 19000 / 26);
    assert.equal(r.hourly, 19000 / 26 / 8);
    assert.equal(P.defaultAllowance({ dailyRate: 19000, rateType: "Monthly", allowance: 1000 }), 500);
    assert.equal(P.defaultAllowance({ dailyRate: 570, rateType: "Daily", allowance: 0 }), 0);
  });
});

describe("weekly statutory half drops the leftover centavo", () => {
  it("halves company defaults the way the paper does", () => {
    assert.equal(P.weeklyHalf(325), 162.5);
    assert.equal(P.weeklyHalf(131.25), 65.62);
    assert.equal(P.weeklyHalf(100), 50);
    const half = P.statutoryOf({}, "weekly", { ded: { sss: 325, phic: 131.25, hdmf: 100 } });
    assert.equal(half.sss, 162.5);
    assert.equal(half.phic, 65.62);
    assert.equal(half.hdmf, 50);
  });

  it("uses the employee record when it is filled, company defaults otherwise", () => {
    const e = { ded: { sss: 400, phic: "", hdmf: 80 } };
    const semi = P.statutoryOf(e, "semi", { ded: { sss: 325, phic: 131.25, hdmf: 100 } });
    assert.equal(semi.sss, 400);
    assert.equal(semi.phic, 131.25);
    assert.equal(semi.hdmf, 80);
  });
});

describe("verified paper regressions (to the centavo)", () => {
  it("Arsua weekly G 3348.75 N 2582", () => {
    const L = line({
      days: 5, ot: 7, hol: 0, daily: 570,
      sss: 162.5, phic: 65.62, hdmf: 50, late: 488.63,
    });
    assert.equal(Number(L.gross.toFixed(2)), 3348.75);
    assert.equal(L.net, 2582);
  });

  it("De Asis weekly 5023.13 / 4746", () => {
    const L = line({
      days: 6, ot: 22.5, hol: 0, daily: 570,
      sss: 162.5, phic: 65.62, hdmf: 50,
    });
    assert.equal(Number(L.gross.toFixed(2)), 5023.13);
    assert.equal(L.net, 4746);
  });

  it("Kiamco weekly 4712.50 / 4713 (peso ceiling, no deductions)", () => {
    const L = line({ days: 6, ot: 17, hol: 0, daily: 580 });
    assert.equal(Number(L.gross.toFixed(2)), 4712.5);
    assert.equal(L.net, 4713);
  });

  it("Celestial weekly 1500.00 / 1463", () => {
    const L = line({ days: 5, ot: 0, hol: 0, daily: 300, late: 37 });
    assert.equal(Number(L.gross.toFixed(2)), 1500);
    assert.equal(L.net, 1463);
  });

  it("Abadiano semi 10219.23 / 8591", () => {
    const daily = 19000 / 26;
    const L = line({
      days: 13, ot: 0, hol: 1, daily, allowance: 500, late: 1628.230769230769,
    });
    assert.equal(Number(L.gross.toFixed(2)), 10219.23);
    assert.equal(L.net, 8591);
  });

  it("Batas semi 9141.83 / 7453", () => {
    const daily = 15000 / 26;
    const L = line({
      days: 13, ot: 6.5, hol: 1, daily, allowance: 1000, late: 1688.83,
    });
    assert.equal(Number(L.gross.toFixed(2)), 9141.83);
    assert.equal(L.net, 7453);
  });

  it("Solis semi 14879.81 / 14324", () => {
    const daily = 25000 / 26;
    const L = line({
      days: 13, ot: 15, hol: 2, daily,
      sss: 325, phic: 131.25, hdmf: 100,
    });
    assert.equal(Number(L.gross.toFixed(2)), 14879.81);
    assert.equal(L.net, 14324);
  });

  it("Visere semi 19373.08 / 19374", () => {
    const daily = 23000 / 26;
    const L = line({ days: 21, ot: 4.8, hol: 1, daily });
    assert.equal(Number(L.gross.toFixed(2)), 19373.08);
    assert.equal(L.net, 19374);
  });

  it("Largo semi 9317.31 / 7624", () => {
    const daily = 15000 / 26;
    const L = line({
      days: 13, ot: 2, hol: 1, daily, allowance: 1500,
      sss: 325, phic: 131.25, hdmf: 100, late: 1137.06,
    });
    assert.equal(Number(L.gross.toFixed(2)), 9317.31);
    assert.equal(L.net, 7624);
  });
});

describe("attendance is the only source of days / OT / premium", () => {
  it("ignores a stored DayRow.day override when tallying pay", () => {
    const ctx = {
      daily: {
        d20260820: {
          id: "d20260820",
          date: "2026-08-20",
          rows: { e1: { s: "Present", day: 0, ot: 2, hol: 1 } },
        },
      },
      holidays: [],
    };
    const t = P.tallyPersonPeriod("e1", "2026-08-20", "2026-08-20", ctx);
    assert.equal(t.days, 1);
    assert.equal(t.ot, 2);
    assert.equal(t.hol, 1);
  });

  it("late is still a full day of credit", () => {
    assert.equal(P.dayCredit("Present/Late"), 1);
    assert.equal(P.payDayCredit({ s: "Present/Late" }, "e", "2026-08-20", {}), 1);
  });
});

describe("holiday premium: eligible is not granted", () => {
  const holidays = P.FIXED_REGULAR_HOLIDAYS;

  it("ships seven fixed regular holidays and no movable specials", () => {
    assert.equal(holidays.length, 7);
    assert.ok(holidays.every(function (h) { return h.t === "Regular"; }));
    const names = holidays.map(function (h) { return h.n; }).join(" ");
    assert.doesNotMatch(names, /Maundy|Good Friday|Eid|EDSA|Ninoy|All Saints|Chinese New/i);
    assert.ok(P.holidayOn("2026-12-25", holidays));
    assert.equal(P.holidayOn("2026-04-17", holidays), null);
  });

  it("a worked holiday or Sunday is eligible; Hol must be ticked to grant", () => {
    const ctx = { holidays: holidays };
    const workedXmas = { s: "Present" };
    assert.equal(P.holEligible(workedXmas, "2026-12-25", "e1", ctx), true);
    assert.equal(P.holidayGranted(workedXmas), false);
    const granted = { s: "Present", hol: 1 };
    assert.equal(P.holidayGranted(granted), true);
    const sunday = { s: "Present" };
    assert.equal(P.holEligible(sunday, "2026-08-23", "e1", { holidays: [] }), true);
    const weekday = { s: "Present" };
    assert.equal(P.holEligible(weekday, "2026-08-20", "e1", { holidays: [] }), false);
    const absentHoliday = { s: "Absent" };
    assert.equal(P.holEligible(absentHoliday, "2026-12-25", "e1", ctx), false);
  });
});

describe("cash advance plan rate", () => {
  it("adds min(perPeriod, balance) and skips closed statuses", () => {
    const advances = {
      a: { empId: "e1", status: "Released", amount: 2000, deducted: 500, deductPerPeriod: 400, liquidations: [] },
      b: { empId: "e1", status: "Cancelled", amount: 900, deducted: 0, deductPerPeriod: 300, liquidations: [] },
      c: { empId: "e1", status: "Disapproved", amount: 900, deducted: 0, deductPerPeriod: 300, liquidations: [] },
      d: { empId: "e1", status: "Liquidated", amount: 900, deducted: 0, deductPerPeriod: 300, liquidations: [] },
      e: { empId: "e1", status: "Recovered from pay", amount: 900, deducted: 0, deductPerPeriod: 300, liquidations: [] },
      f: { empId: "e1", status: "Released", amount: 1000, deducted: 0, deductPerPeriod: 0, liquidations: [] },
    };
    assert.equal(P.caDueForPeriod(advances, "e1"), 400);
    advances.a.deducted = 1750;
    assert.equal(P.caDueForPeriod(advances, "e1"), 250);
  });
});

describe("attendance edit log", () => {
  it("diffs before write, flags first import, and caps name / entries", () => {
    const next = {
      id: "d20260820",
      date: "2026-08-20",
      source: "08.20.2026.pdf",
      rows: { e1: { s: "Present", r: "", site: "Tawason" } },
    };
    P.attachDailyLog(null, next, {
      by: "x".repeat(80),
      import: true,
      nameOf: function () { return "Arsua"; },
    });
    assert.equal(next.log.length, 1);
    assert.equal(next.log[0].firstImport, true);
    assert.equal(next.log[0].by.length, 40);
    const edited = {
      id: "d20260820",
      date: "2026-08-20",
      source: "08.20.2026.pdf",
      driveLink: "https://drive.example/x",
      rows: { e1: { s: "Absent", r: "AWOL", site: "Tawason", hol: 1, ot: 2 } },
      log: next.log.slice(),
    };
    P.attachDailyLog(next, edited, { by: "Catherine Largo", nameOf: function () { return "Arsua"; } });
    assert.ok(edited.log.length >= 2);
    const last = edited.log[edited.log.length - 1];
    assert.equal(last.firstImport, false);
    assert.ok(last.changes.some(function (c) { return c.field === "s"; }));
    assert.ok(last.changes.some(function (c) { return /holiday premium granted/.test(c.text); }));
    assert.equal(P.editedAfterFiling(edited), true);
    assert.equal(P.editedAfterFiling(next), false);
  });

  it("keeps at most 60 log entries", () => {
    let rec = { id: "d1", rows: { e1: { s: "Present" } }, log: [] };
    for (let i = 0; i < 65; i++) {
      const next = {
        id: "d1",
        rows: { e1: { s: i % 2 ? "Absent" : "Present" } },
        log: rec.log.slice(),
      };
      P.attachDailyLog(rec, next, { by: "HR" });
      rec = next;
    }
    assert.equal(rec.log.length, 60);
  });
});

describe("printed register and payslips", () => {
  it("uses a fixed colgroup and lifts figures from the run only", () => {
    const run = {
      kind: "weekly",
      from: "2026-08-20",
      to: "2026-08-26",
      release: "2026-08-29",
      lines: [
        line({
          name: "Arsua, Jonard A.", empNo: "1251", project: "Motorpool",
          days: 5, ot: 7, daily: 570, sss: 162.5, phic: 65.62, hdmf: 50, late: 488.63,
        }),
      ],
    };
    const html = P.registerHTML(run);
    assert.match(html, /<colgroup>/);
    assert.match(html, /PERIOD 2026-08-20/);
    assert.match(html, /RELEASE DATE 2026-08-29/);
    assert.match(html, /2,582/);
    assert.match(html, /width:2\.6%/);
    const slip = P.payslipHTML(run.lines[0], run);
    assert.match(slip, /NET PAY/);
    assert.match(slip, /5 days/);
    assert.doesNotMatch(slip, /data-pay-emp/);
    const pair = P.payslipsSheetHTML(run.lines.concat(run.lines), run);
    assert.match(pair, /hr-pay-cut/);
  });

  it("prints a blank release on a custom range", () => {
    const html = P.registerHTML({
      kind: "semi",
      from: "2026-08-13",
      to: "2026-08-20",
      release: "",
      lines: [line({ name: "X", days: 1, daily: 100 })],
    });
    assert.match(html, /RELEASE DATE\s+</);
  });
});

describe("acceptance helpers", () => {
  it("folds empty optional deduction columns and always keeps late/CA/SSS/PHIC/HDMF", () => {
    const show = P.foldDeductionKeys([
      line({ days: 1, daily: 100, late: 1, ca: 0, sss: 1, phic: 1, hdmf: 1 }),
    ]);
    assert.equal(show.late, 1);
    assert.equal(show.ca, 1);
    assert.equal(show.sss, 1);
    assert.equal(show.phic, 1);
    assert.equal(show.hdmf, 1);
    assert.equal(show.uniform, undefined);
    assert.equal(show.sssLoan, undefined);
  });

  it("keeps Hol/OT when Daily Manpower collect drops them and the UI is not mounted", () => {
    const rec = {
      date: "2026-08-20",
      rows: { e1: { s: "Present", r: "", site: "Tawason" } },
    };
    const prev = {
      rows: { e1: { s: "Present", r: "", site: "Tawason", hol: 1, ot: 2.5 } },
    };
    const out = P.applyHolOtFromUi(rec, prev, function () { return null; });
    assert.equal(out.rows.e1.hol, 1);
    assert.equal(out.rows.e1.ot, 2.5);
  });

  it("reads Hol/OT from the Daily Manpower inputs when they are on the page", () => {
    const rec = { rows: { e1: { s: "Present" } } };
    const q = function (sel) {
      if (sel.indexOf("data-dmhol") >= 0) return { checked: true };
      if (sel.indexOf("data-dmot") >= 0) return { value: "3.5" };
      return null;
    };
    const out = P.applyHolOtFromUi(rec, { rows: { e1: { hol: 0, ot: 1 } } }, q);
    assert.equal(out.rows.e1.hol, 1);
    assert.equal(out.rows.e1.ot, 3.5);
  });

  it("Payroll Maker HTML locks days/OT and names a missing weekday", () => {
    const html = P.viewPayMaker();
    assert.doesNotMatch(html, /data-pay-k="days"/);
    assert.doesNotMatch(html, /data-pay-k="ot"/);
    assert.match(html, /Open Daily Manpower/);
    assert.match(html, /No report filed/);
    assert.match(html, /cannot be typed here/);
  });

  it("names missing weekday reports in a period", () => {
    const miss = P.missingReportDays("2026-08-20", "2026-08-26", {
      d20260820: { date: "2026-08-20" },
      d20260821: { date: "2026-08-21" },
    });
    assert.ok(miss.indexOf("2026-08-22") >= 0);
    assert.ok(miss.indexOf("2026-08-23") < 0);
  });
});

describe("hr-payroll companion wiring", () => {
  it("is loaded by the shim after attendance and not referenced from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-payroll\.js/);
    assert.match(shim, /data-hr-payroll/);
    assert.ok(
      shim.indexOf("hr-attendance.js") < shim.indexOf("hr-payroll.js"),
      "attendance leave rules must bind before payroll reads them"
    );
    assert.doesNotMatch(html, /hr-payroll\.js/);
  });
});
