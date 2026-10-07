"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const payrollSrc = fs.readFileSync(path.join(__dirname, "../public/hr-payroll.js"), "utf8");

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

function isoDate(t) {
  return (
    t.getFullYear() +
    "-" +
    String(t.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(t.getDate()).padStart(2, "0")
  );
}

function loadDates() {
  const src = ["dateInputValue", "keepEmpDateEdits"].map((n) => extractFunction(html, n)).join("\n");
  const ctx = { isoDate, EMP_DIRTY: {} };
  vm.runInNewContext(src, ctx);
  return ctx;
}

function loadPay() {
  const names = [
    "dateInputValue",
    "addDays",
    "addMonths",
    "caLiquidated",
    "caBalance",
    "caList",
    "payCaClosed",
    "payCaApproved",
    "payCaStep",
    "payCaInstallments",
    "payCaTakenBefore",
    "payCaDue",
    "payTotals",
    "payLine",
  ];
  const src =
    'const CA_PAY_CLOSED=["Cancelled","Disapproved","Liquidated","Recovered","Recovered from pay"];\n' +
    names.map((n) => extractFunction(html, n)).join("\n");
  const ctx = {
    isoDate,
    HOL_PREMIUM: 0.3,
    pesoCeil(n) {
      return Math.ceil(Number(n || 0) - 1e-9);
    },
    S: {
      advances: {},
      payruns: {},
      settings: { otPolicy: 1 },
    },
    payRate() {
      return { daily: 500, hourly: 62.5, basis: "daily", monthly: 0 };
    },
    payDaysFor() {
      return [{ day: 5, ot: 0, hol: 0, holRate: 0, elig: false, site: "Site" }];
    },
    govDeductionRefused() {
      return false;
    },
    payStatForLine() {
      return 0;
    },
  };
  vm.runInNewContext(src, ctx);
  return ctx;
}

function loadCompanion() {
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

const per = { from: "2026-09-04", to: "2026-09-10" };

function adv(partial) {
  return Object.assign(
    {
      empId: "e1",
      status: "Approved",
      amount: 1000,
      deducted: 0,
      deductPerPeriod: 0,
      liquidations: [],
      date: "2026-09-08",
    },
    partial
  );
}

describe("2026-10-01a date hired and cash advance", () => {
  it("is build 2026-10-05a and does not redraw a focused 201 date", () => {
    assert.match(html, /const BUILD = "2026-10-07b"/);
    assert.match(html, /let RENDER_DEPTH=0/);
    assert.match(html, /function dateInputValue\(/);
    assert.match(html, /function keepEmpDateEdits\(/);
    assert.match(html, /else if\(type==="date"\) ctl='<input id="'\+id\+'" data-ef="'\+key\+'" type="date" value="'\+esc\(dateInputValue\(val\)\)\+'">'/);
    assert.match(html, /input\[type='date'\]\[data-ef\]/);
    assert.match(html, /if\(e\.target\.type==="date"\) return/);
    assert.match(html, /function renderEmpAfterDate\(/);
    assert.match(html, /function paintProbationEnd\(/);
    assert.match(html, /if\(!line\.caTouched\) delete line\.ca/);
    assert.match(html, /Days and overtime recomputed from Daily Manpower\./);
    assert.match(html, /payCaDue\(e\.id, per, kind\)/);
    const start = html.indexOf("/* field bindings */");
    const end = html.indexOf('on("[data-ob]"', start);
    const block = html.slice(start, end);
    assert.match(block, /queueEmpSave\(S\.ui\.emp\)/);
    assert.doesNotMatch(block, /await put\("employees"/);
    const changeAt = block.indexOf('on("[data-ef]","change"');
    const change = block.slice(changeAt, block.indexOf('on("[data-ef]","blur"'));
    const dateBranch = change.slice(
      change.indexOf('if(e.target.type==="date")'),
      change.indexOf("if(k && EMP_RENDER_FIELDS")
    );
    assert.match(dateBranch, /renderEmpAfterDate\(\)/);
    assert.doesNotMatch(dateBranch, /render\(\)/);
  });

  it("keeps a calendar day and reads a timestamp on the Manila calendar", () => {
    const ctx = loadDates();
    assert.equal(ctx.dateInputValue("2026-09-30"), "2026-09-30");
    assert.equal(ctx.dateInputValue("2026-09-29T16:00:00.000Z"), "2026-09-30");
    assert.equal(ctx.dateInputValue("2026-09-30T00:00:00.000Z"), "2026-09-30");
    assert.equal(ctx.dateInputValue("2026-02-31"), "");
    assert.equal(ctx.dateInputValue("not-a-date"), "");
    assert.equal(ctx.dateInputValue(""), "");
    assert.equal(ctx.dateInputValue(null), "");
  });

  it("keeps a hire date that was just typed when a stale employee row arrives", () => {
    const ctx = loadDates();
    ctx.EMP_DIRTY = { e1: 1 };
    const kept = ctx.keepEmpDateEdits(
      { id: "e1", dateHired: "2026-01-01", birthdate: "1990-01-01" },
      { id: "e1", dateHired: "2026-09-30", birthdate: "1990-01-01" }
    );
    assert.equal(kept.dateHired, "2026-09-30");
    assert.equal(kept.birthdate, "1990-01-01");
    ctx.EMP_DIRTY = {};
    const incoming = ctx.keepEmpDateEdits(
      { id: "e1", dateHired: "2026-01-01" },
      { id: "e1", dateHired: "2026-09-30" }
    );
    assert.equal(incoming.dateHired, "2026-01-01");
  });

  it("puts an approved cash advance on the run and lets a typed figure win", () => {
    const ctx = loadPay();
    ctx.S.advances = { a: adv({ amount: 1500, date: "2026-09-08" }) };
    const e = { id: "e1", empNo: "1", name: "Test, Person", position: "", project: "Site" };
    assert.equal(ctx.payCaDue("e1", per, "weekly"), 1500);
    const line = ctx.payLine(e, "weekly", [], null, per);
    assert.equal(line.ca, 1500);
    assert.equal(line.ded, 1500);
    assert.equal(line.gross, 2500);
    assert.equal(line.net, 1000);

    const cleared = ctx.payLine(e, "weekly", [], { ca: null, caTouched: true }, per);
    assert.equal(cleared.ca, 0);
    assert.equal(cleared.net, 2500);

    const storedZero = ctx.payLine(e, "weekly", [], { ca: 0 }, per);
    assert.equal(storedZero.ca, 1500);

    const hand = ctx.payLine(e, "weekly", [], { ca: 200 }, per);
    assert.equal(hand.ca, 200);
    assert.equal(hand.net, 2300);
  });

  it("skips closed and unapproved balances, and follows the repayment schedule", () => {
    const ctx = loadPay();
    ["Cancelled", "Disapproved", "Liquidated", "Recovered from pay", "Recovered"].forEach((status) => {
      ctx.S.advances = { a: adv({ status, amount: 900 }) };
      assert.equal(ctx.payCaDue("e1", per, "weekly"), 0, status);
    });
    ctx.S.advances = { a: adv({ status: "Requested", amount: 900, deductPerPeriod: 0 }) };
    assert.equal(ctx.payCaDue("e1", per, "weekly"), 0);
    ctx.S.advances = { a: adv({ status: "For signature", amount: 900 }) };
    assert.equal(ctx.payCaDue("e1", per, "weekly"), 0);

    ctx.S.advances = {
      a: adv({
        status: "Partially liquidated",
        amount: 1000,
        liquidations: [{ amount: 400 }],
        date: "2026-09-06",
      }),
    };
    assert.equal(ctx.payCaDue("e1", per, "weekly"), 600);

    ctx.S.advances = {
      a: adv({
        status: "Released",
        amount: 2000,
        deducted: 500,
        deductPerPeriod: 400,
        planEvery: "Weekly",
        planFrom: "2026-09-04",
        date: "2026-09-04",
      }),
    };
    assert.equal(ctx.payCaDue("e1", per, "weekly"), 400);
    assert.equal(ctx.payCaDue("e1", { from: "2026-09-05", to: "2026-09-09" }, "weekly"), 0);
    assert.equal(
      ctx.payCaDue("e1", { from: "2026-09-01", to: "2026-09-03" }, "weekly"),
      0
    );

    ctx.S.advances = {
      a: adv({
        amount: 1000,
        deductPerPeriod: 100,
        planEvery: "Semi-monthly",
        planFrom: "2026-09-01",
        date: "2026-09-01",
      }),
    };
    assert.equal(ctx.payCaDue("e1", { from: "2026-09-01", to: "2026-09-16" }, "weekly"), 200);
    assert.equal(ctx.payCaDue("e1", { from: "2026-09-02", to: "2026-09-15" }, "weekly"), 0);
  });

  it("deducts a pre-period balance once, and still takes a new advance inside the period", () => {
    const ctx = loadPay();
    ctx.S.advances = {
      old: adv({ amount: 400, date: "2026-08-01", status: "Approved" }),
      neu: adv({ amount: 250, date: "2026-09-08", status: "Released" }),
    };
    assert.equal(ctx.payCaDue("e1", per, "weekly"), 650);
    ctx.S.payruns = {
      earlier: { kind: "weekly", from: "2026-08-21", to: "2026-08-27", lines: { e1: { ca: 400 } } },
      current: { kind: "weekly", from: per.from, to: per.to, lines: { e1: { ca: 250 } } },
    };
    assert.equal(ctx.payCaDue("e1", per, "weekly"), 250);

    ctx.S.advances = { bare: adv({ amount: 700, date: "" }) };
    ctx.S.payruns = {};
    assert.equal(ctx.payCaDue("e1", per, "weekly"), 700);
    ctx.S.payruns = {
      earlier: { kind: "weekly", to: "2026-08-27", lines: { e1: { ca: 700 } } },
    };
    assert.equal(ctx.payCaDue("e1", per, "weekly"), 0);
  });

  it("keeps the no-period plan rate on the companion, and applies a period when one is passed", () => {
    const P = loadCompanion();
    const advances = {
      a: { empId: "e1", status: "Released", amount: 2000, deducted: 500, deductPerPeriod: 400, liquidations: [] },
      f: { empId: "e1", status: "Released", amount: 1000, deducted: 0, deductPerPeriod: 0, liquidations: [], date: "2026-09-08" },
    };
    assert.equal(P.caDueForPeriod(advances, "e1"), 400);
    advances.f.date = "2026-08-01";
    assert.equal(P.caDueForPeriod(advances, "e1", per, 0), 1400);
    assert.equal(P.caDueForPeriod(advances, "e1", per, 400), 400);
    advances.f.date = "2026-09-08";
    assert.equal(P.caDueForPeriod(advances, "e1", per, 400), 1400);
  });
});
