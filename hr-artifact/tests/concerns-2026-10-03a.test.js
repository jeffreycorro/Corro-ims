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

const FORM = "https://drive.google.com/file/d/OTFORM1/view?usp=sharing";

function loadPay() {
  const names = [
    "isEphemeralUrl",
    "durableDriveUrl",
    "otSiteKey",
    "otFormUrl",
    "otRequestCovers",
    "otCovered",
    "otPendingApplies",
    "otPaidHours",
    "otHoursAllowed",
    "clockMinutes",
    "lateStartMinutes",
    "lateStartLabel",
    "lateMinutesOf",
    "dayCountsLate",
    "payLateAmount",
    "payLateForDays",
    "payLine",
  ];
  const ctx = {
    S: { settings: { otPolicy: 1 }, otreqs: {}, employees: {} },
    DAYS: [],
    payRate(e) {
      const daily = Number(e.dailyRate) || 0;
      return { daily, hourly: daily / 8, monthly: false, basis: "daily rate" };
    },
    payDaysFor() {
      return ctx.DAYS;
    },
    govDeductionRefused() {
      return false;
    },
    payStatForLine() {
      return 0;
    },
    payCaDue() {
      return 0;
    },
    payTotals(L) {
      L.basic = L.days * L.daily;
      L.otPay = L.ot * L.hourly * 1;
      L.holPay = 0;
      L.gross = L.basic + L.otPay + (Number(L.allowance) || 0) + (Number(L.incentive) || 0);
      L.ded = (Number(L.late) || 0) + (Number(L.ca) || 0) + (Number(L.sss) || 0);
      L.net = L.gross - L.ded;
      return L;
    },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

describe("2026-10-03a pending OT and late", () => {
  it("is build 2026-10-03b and keeps the OT box editable", () => {
    assert.match(html, /const BUILD = "2026-10-03b"/);
    assert.match(html, /Pending OT form/);
    assert.match(html, /OT pending: /);
    assert.match(html, /data-otfile=/);
    assert.match(html, /File one/);
    assert.match(html, /function otPendingApplies\(/);
    assert.match(html, /2026-10-01/);
    assert.doesNotMatch(extractFunction(html, "otEntryBox"), /disabled/);
    assert.match(extractFunction(html, "payLine"), /otPaidHours/);
    assert.match(extractFunction(html, "payLine"), /lateTouched/);
    assert.match(extractFunction(html, "payLine"), /payLateForDays/);
    assert.match(html, /if\(!line\.lateTouched\) delete line\.late/);
    assert.match(html, /data-latemin=/);
    assert.match(html, /daily rate ÷ 8 ÷ 60/);
  });

  it("pays uncovered OT only before 2026-10-01, and withholds it after", () => {
    const ctx = loadPay();
    const e = { id: "e1", name: "Ababon, Jonathan", empNo: "1250", dailyRate: 520 };
    ctx.DAYS = [{ date: "2026-10-02", site: "Danlag", s: "Present", in: "8:00 AM", day: 1, ot: 2, hol: 0, holRate: 0 }];
    const old = ctx.payLine(e, "weekly", ["2026-09-30"], {}, { from: "2026-09-24", to: "2026-09-30" });
    assert.equal(old.ot, 2);
    assert.equal(old.otPending, 0);
    assert.equal(old.otPay, 2 * (520 / 8));
    const waiting = ctx.payLine(e, "weekly", ["2026-10-02"], {}, { from: "2026-10-01", to: "2026-10-07" });
    assert.equal(waiting.ot, 0);
    assert.equal(waiting.otPending, 2);
    assert.equal(waiting.otNoForm, 2);
    assert.equal(waiting.otPay, 0);
    assert.equal(waiting.gross, 1 * 520);
    ctx.S.otreqs = {
      ot1: {
        id: "ot1",
        from: "2026-10-02",
        to: "2026-10-02",
        site: "Danlag",
        wholeSite: true,
        status: "Approved",
        formUrl: FORM,
      },
    };
    const paid = ctx.payLine(e, "weekly", ["2026-10-02"], {}, { from: "2026-10-01", to: "2026-10-07" });
    assert.equal(paid.ot, 2);
    assert.equal(paid.otPending, 0);
    assert.equal(paid.otPay, 2 * (520 / 8));
    assert.equal(ctx.otHoursAllowed("e1", "2026-10-02", "Danlag", null, 4), 4);
    const noPeriod = ctx.payLine(e, "weekly", ["2026-10-02"], {}, null);
    ctx.S.otreqs = {};
    const legacyMissing = ctx.payLine(e, "weekly", ["2026-10-02"], {}, null);
    assert.equal(legacyMissing.ot, 2);
    assert.equal(noPeriod.ot, 2);
  });

  it("fills late from time in and lets a typed figure win", () => {
    const ctx = loadPay();
    assert.equal(ctx.lateMinutesOf("8:00 AM"), 0);
    assert.equal(ctx.lateMinutesOf("8:15 AM"), 15);
    assert.equal(ctx.lateMinutesOf("7:50 AM"), 0);
    assert.equal(ctx.lateMinutesOf("1:00 PM"), 0);
    assert.equal(ctx.lateMinutesOf("1:10 PM"), 10);
    assert.equal(ctx.lateMinutesOf("12:30 PM"), 0);
    assert.equal(ctx.lateMinutesOf(""), 0);
    assert.equal(ctx.lateStartLabel("9:00 AM"), "8:00 AM");
    assert.equal(ctx.lateStartLabel("1:10 PM"), "1:00 PM");
    assert.equal(ctx.dayCountsLate({ s: "Absent", in: "9:00 AM", day: 0 }), false);
    assert.equal(ctx.dayCountsLate({ s: "Present", in: "8:15 AM" }), true);
    assert.equal(ctx.payLateAmount(480, 15), 15);
    assert.equal(ctx.payLateAmount(520, 15), 16.25);
    const e = { id: "e1", name: "Santos, Ben", empNo: "1251", dailyRate: 480 };
    ctx.DAYS = [
      { date: "2026-10-02", site: "Danlag", s: "Present", in: "8:15 AM", day: 1, ot: 0, hol: 0, holRate: 0 },
      { date: "2026-10-03", site: "Danlag", s: "Present", in: "1:10 PM", day: 0.5, ot: 0, hol: 0, holRate: 0 },
      { date: "2026-10-04", site: "Danlag", s: "Absent", in: "9:00 AM", day: 0, ot: 0, hol: 0, holRate: 0 },
    ];
    const auto = ctx.payLine(e, "weekly", [], { late: 0 }, { from: "2026-10-01", to: "2026-10-07" });
    assert.equal(auto.lateMin, 25);
    assert.equal(auto.late, 25);
    assert.equal(auto.ded, 25);
    assert.equal(auto.net, auto.gross - 25);
    const typed = ctx.payLine(e, "weekly", [], { late: 0, lateTouched: true }, { from: "2026-10-01", to: "2026-10-07" });
    assert.equal(typed.late, 0);
    const kept = ctx.payLine(e, "weekly", [], { late: 40 }, { from: "2026-10-01", to: "2026-10-07" });
    assert.equal(kept.late, 40);
  });
});
