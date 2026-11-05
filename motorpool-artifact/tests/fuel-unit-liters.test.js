"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  isFuelCategory,
  normalizeFuelLine: serverFuelLine,
  normalizeIssueSpec,
  normalizeLedgerRows,
  normalizeReserve,
} = require("../netlify/lib/project-name");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  let start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  if (src.slice(start - 6, start) === "async ") start -= 6;
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

function loadPage() {
  const names = [
    "isFuel",
    "fuelLitersMissing",
    "fuelQtyNum",
    "normalizeFuelLine",
    "normalizeFuelLines",
    "fuelLitresOf",
    "fillReserveFuelLitres",
    "blankLine",
  ];
  const ctx = {};
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

describe("fuel lines on the VRF form", () => {
  it("is build 2026-11-05 e", () => {
    assert.match(html, /var BUILD = "2026-11-05 e"/);
  });

  it("still starts a new line at pc", () => {
    const page = loadPage();
    assert.equal(page.blankLine().unit, "pc");
    assert.equal(page.blankLine().liters, "");
    assert.match(html, /function blankLine\(\)\{ return \{cat:"",item:"",supplier:"",qty:"",unit:"pc"/);
    assert.match(
      html,
      /added\.push\(\{cat:"",item:"",supplier:"",project:entry\.project\|\|"",qty:"",unit:"pc"/
    );
  });

  it("locks the unit box once the category is fuel", () => {
    assert.match(html, /if\(isFuel\(l\.cat\)\) normalizeFuelLine\(l\)/);
    assert.match(html, /ui\.readOnly=true/);
    assert.match(html, /ui\.disabled=true/);
    assert.match(html, /data-fuel-unit","locked"/);
    assert.match(html, /else if\(wasFuel && String\(l\.unit\|\|""\)==="liters"\) l\.unit="pc"/);
    assert.match(html, /if\(isFuel\(a2\.cat\)\) normalizeFuelLine\(a2\)/);
    assert.match(html, /normalizeFuelLines\(rows\)/);
    assert.match(html, /fillReserveFuelLitres\(hold\)/);
  });

  it("stores Fuel — Diesel and Fuel — Gasoline as liters and fills a blank litres box from qty", () => {
    const page = loadPage();
    ["pc", "L", "liter", "LITER", "litre", "", "   "].forEach((unit) => {
      const line = { cat: "Fuel — Diesel", qty: 40, unit: unit, price: 88, total: 3520, liters: "" };
      page.normalizeFuelLine(line);
      assert.equal(line.unit, "liters");
      assert.equal(line.liters, 40);
      assert.equal(line.qty, 40);
      assert.equal(line.price, 88);
      assert.equal(line.total, 3520);
    });
    const gas = { cat: "fuel – gasoline", qty: "11.53", unit: "L", price: 86.73, liters: null };
    page.normalizeFuelLine(gas);
    assert.equal(gas.unit, "liters");
    assert.equal(gas.liters, 11.53);
    assert.equal(gas.price, 86.73);
    const hyphen = { cat: "  FUEL—DIESEL", qty: 7, unit: "liter", liters: 0, price: 90 };
    page.normalizeFuelLine(hyphen);
    assert.equal(hyphen.unit, "liters");
    assert.equal(hyphen.liters, 7);
    assert.equal(hyphen.price, 90);
  });

  it("keeps litres that were already typed, and does not touch a non-fuel line", () => {
    const page = loadPage();
    const typed = { cat: "Fuel — Diesel", qty: 1, unit: "pc", liters: 40, price: 2500, total: 2500 };
    page.normalizeFuelLine(typed);
    assert.equal(typed.unit, "liters");
    assert.equal(typed.liters, 40);
    assert.equal(typed.qty, 1);
    assert.equal(typed.price, 2500);
    assert.equal(typed.total, 2500);

    const belt = { cat: "Belt", qty: 2, unit: "pc", price: 100, liters: "" };
    assert.equal(page.normalizeFuelLine(belt), belt);
    assert.equal(belt.unit, "pc");
    const filter = { cat: "Fuel Filter", qty: 1, unit: "pc", liters: "", price: 200 };
    assert.equal(page.normalizeFuelLine(filter), filter);
    assert.equal(filter.unit, "pc");
    assert.equal(filter.liters, "");
    assert.equal(page.isFuel("Fuel Filter"), false);
    assert.equal(page.isFuel("Fuel — Gasoline"), true);
    assert.equal(page.fuelLitresOf({ qty: 1, unit: "pc", liters: "", price: 200 }), 0);
    assert.equal(page.fuelLitresOf({ qty: 40, unit: "liters", liters: 40, price: 88 }), 40);
  });

  it("fills the reserve litres total from qty when that total is 0", () => {
    const page = loadPage();
    const reserve = {
      status: "Requested",
      budget: 3720,
      litres: 0,
      approvedBy: "",
      approvedBudget: null,
      draftLines: [
        { cat: "Fuel — Diesel", qty: 40, unit: "pc", price: 88, liters: "" },
        { cat: "Belt", qty: 1, unit: "pc", price: 200, liters: "" },
      ],
    };
    page.fillReserveFuelLitres(reserve);
    assert.equal(reserve.draftLines[0].unit, "liters");
    assert.equal(reserve.draftLines[0].liters, 40);
    assert.equal(reserve.draftLines[0].price, 88);
    assert.equal(reserve.litres, 40);
    assert.equal(reserve.budget, 3720);
    assert.equal(reserve.status, "Requested");
    assert.equal(reserve.approvedBy, "");
    assert.equal(reserve.approvedBudget, null);
    assert.equal(reserve.draftLines[1].unit, "pc");
    assert.equal(reserve.draftLines[1].liters, "");
    assert.equal(reserve.draftLines[1].price, 200);
  });

  it("leaves a reserve litres total that is already filled", () => {
    const page = loadPage();
    const reserve = {
      litres: 40,
      budget: 2500,
      status: "Requested",
      draftLines: [{ cat: "Fuel — Diesel", qty: 1, unit: "pc", liters: 40, price: 2500, total: 2500 }],
    };
    page.fillReserveFuelLitres(reserve);
    assert.equal(reserve.litres, 40);
    assert.equal(reserve.draftLines[0].unit, "liters");
    assert.equal(reserve.draftLines[0].liters, 40);
    assert.equal(reserve.draftLines[0].qty, 1);
    assert.equal(reserve.budget, 2500);
  });
});

describe("a save stores a fuel line as liters", () => {
  it("normalizes a stale reserve and does not rewrite the copy that was sent", () => {
    const line = { cat: "Fuel — Gasoline", qty: 11.53, unit: "L", price: 86.73, total: 1000, liters: "" };
    const belt = { cat: "Belt", qty: 1, unit: "pc", price: 150, total: 150 };
    const reserve = {
      no: "12",
      status: "Requested",
      approvedBy: "",
      approvedBudget: null,
      budget: 1150,
      litres: null,
      draftLines: [line, belt],
    };
    const next = normalizeReserve(reserve);
    assert.notEqual(next, reserve);
    assert.equal(line.unit, "L");
    assert.equal(line.liters, "");
    assert.equal(next.draftLines[0].unit, "liters");
    assert.equal(next.draftLines[0].liters, 11.53);
    assert.equal(next.draftLines[0].price, 86.73);
    assert.equal(next.draftLines[0].total, 1000);
    assert.equal(next.draftLines[0].qty, 11.53);
    assert.equal(next.draftLines[1], belt);
    assert.equal(next.litres, 11.53);
    assert.equal(next.budget, 1150);
    assert.equal(next.status, "Requested");
    assert.equal(next.approvedBy, "");
    assert.equal(next.approvedBudget, null);
  });

  it("normalizes a ledger line from liquidation and leaves Fuel Filter alone", () => {
    const fuel = { vrf: "6101", cat: "Fuel — Diesel", qty: 20, unit: "LITER", price: 90, total: 1800, liters: 0 };
    const part = { vrf: "6101", cat: "Fuel Filter", qty: 1, unit: "pc", price: 200, total: 200, project: "BARILI" };
    const rows = normalizeLedgerRows([fuel, part]);
    assert.equal(fuel.unit, "LITER");
    assert.equal(fuel.liters, 0);
    assert.equal(rows[0].unit, "liters");
    assert.equal(rows[0].liters, 20);
    assert.equal(rows[0].price, 90);
    assert.equal(rows[0].total, 1800);
    assert.equal(rows[0].qty, 20);
    assert.equal(rows[1], part);
    assert.equal(rows[1].unit, "pc");
    assert.equal(isFuelCategory("Fuel Filter"), false);
    assert.equal(isFuelCategory("Fuel — Diesel"), true);
  });

  it("returns the same reserve when the fuel line is already liters", () => {
    const reserve = {
      no: "9",
      project: "BARILI",
      litres: 10,
      status: "Approved",
      approvedBy: "Jeffrey James M. Corro",
      budget: 500,
      draftLines: [{ cat: "Fuel — Diesel", qty: 10, unit: "liters", liters: 10, price: 50, total: 500 }],
    };
    assert.equal(normalizeReserve(reserve), reserve);
    const spec = { kind: "reserve", reserve: reserve };
    assert.equal(normalizeIssueSpec(spec), spec);
    assert.equal(serverFuelLine(reserve.draftLines[0]), reserve.draftLines[0]);
  });

  it("keeps a litres total and a typed litres figure that are already on the reserve", () => {
    const reserve = {
      no: "3",
      litres: 48,
      budget: 2500,
      status: "Requested",
      approvedBudget: null,
      draftLines: [{ cat: "Fuel — Diesel", qty: 1, unit: "pc", liters: 40, price: 2500, total: 2500 }],
    };
    const next = normalizeReserve(reserve);
    assert.equal(next.draftLines[0].unit, "liters");
    assert.equal(next.draftLines[0].liters, 40);
    assert.equal(next.draftLines[0].qty, 1);
    assert.equal(next.draftLines[0].price, 2500);
    assert.equal(next.draftLines[0].total, 2500);
    assert.equal(next.litres, 48);
    assert.equal(next.budget, 2500);
    assert.equal(next.status, "Requested");
    assert.equal(next.approvedBudget, null);
    assert.equal(reserve.draftLines[0].unit, "pc");
    assert.equal(reserve.litres, 48);
  });
});
