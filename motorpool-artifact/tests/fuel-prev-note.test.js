"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { applyApproveFromHold } = require("../netlify/lib/approve-from-hold");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const approveSrc = fs.readFileSync(path.join(__dirname, "../netlify/lib/approve-from-hold.js"), "utf8");

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

function loadFuel() {
  const names = [
    "spendEndStatus",
    "isFuel",
    "nnum",
    "parseDate",
    "parseOdo",
    "meterOf",
    "fuelLitresOf",
    "allLines",
    "isPlaceholderOdo",
    "isFuelWorkCode",
    "isCancelledFuelStatus",
    "fuelFillVrfOf",
    "fuelFillOdoOf",
    "fuelFillLitresOf",
    "reserveIsFuelFill",
    "listFuelFills",
    "fuelVrfNum",
    "previousFuelFill",
    "fuelPreviousNote",
    "fuelPrevNoteForNewVrf",
    "recordHasFuelLine",
    "recordFuelPrevNote",
    "shownFuelPrevNote",
  ];
  const ctx = {
    S: { ledger: {}, reserves: [] },
    FUEL_ODO_PLACEHOLDERS: { 76260: 1 },
    HOUR_METER: /^(BH|RR|TM|MBC|Equipment)/i,
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function ledgerFuel(over) {
  return Object.assign(
    {
      date: "2026-09-01",
      vrf: "5800",
      veh: "DT-09",
      cat: "Fuel — Diesel",
      work: "FUEL-STN",
      liters: 40,
      qty: 1,
      unit: "pc",
      odo: 10000,
      vstatus: "Open",
    },
    over || {}
  );
}

describe("fuel VRF previous-fill note", () => {
  it("is build 2026-10-29 b", () => {
    assert.match(html, /var BUILD = "2026-10-29 b"/);
  });

  it("states km per liter when both odometers increase", () => {
    const ctx = loadFuel();
    ctx.S.ledger["2026-09"] = [ledgerFuel()];
    const note = ctx.fuelPreviousNote("DT-09", 10500, { beforeDate: "2026-10-20" });
    assert.match(note.text, /Previous fuel: 2026-09-01/);
    assert.match(note.text, /VRF 5800/);
    assert.match(note.text, /40\.00 L/);
    assert.match(note.text, /odometer 10,000 km/);
    assert.match(note.text, /Current odometer 10,500 km/);
    assert.match(note.text, /500 km since/);
    assert.match(note.text, /Consumption: 12\.50 km per liter/);
    assert.equal(note.reason, "ok");
  });

  it("states liters per hour for heavy equipment", () => {
    const ctx = loadFuel();
    ctx.S.ledger["2026-09"] = [
      ledgerFuel({ veh: "BH-02", odo: 120, liters: 16, work: "FUEL-RES", vrf: "5810" }),
    ];
    const note = ctx.fuelPreviousNote("BH-02", 128, { beforeDate: "2026-10-20" });
    assert.match(note.text, /hour meter 120 hrs/);
    assert.match(note.text, /Current hour meter 128 hrs/);
    assert.match(note.text, /8\.0 hours since/);
    assert.match(note.text, /Consumption: 2\.00 liters per hour/);
  });

  it("says consumption is n/a when the odometer is missing or unchanged", () => {
    const ctx = loadFuel();
    ctx.S.ledger["2026-09"] = [ledgerFuel({ odo: null })];
    const missing = ctx.fuelPreviousNote("DT-09", 10500, { beforeDate: "2026-10-20" });
    assert.match(missing.text, /VRF 5800/);
    assert.match(missing.text, /Consumption: n\/a \(odometer missing\/unchanged\)/);
    assert.equal(missing.consumption, null);

    ctx.S.ledger["2026-09"] = [ledgerFuel({ odo: 10500 })];
    const same = ctx.fuelPreviousNote("DT-09", 10500, { beforeDate: "2026-10-20" });
    assert.match(same.text, /Consumption: n\/a \(odometer missing\/unchanged\)/);

    const blankNow = ctx.fuelPreviousNote("DT-09", "", { beforeDate: "2026-10-20" });
    assert.match(blankNow.text, /Consumption: n\/a \(odometer missing\/unchanged\)/);

    const backwards = ctx.fuelPreviousNote("DT-09", 9000, { beforeDate: "2026-10-20" });
    assert.match(backwards.text, /Consumption: n\/a \(odometer missing\/unchanged\)/);
  });

  it("does not treat placeholder 76260 as a real reading", () => {
    const ctx = loadFuel();
    ctx.S.ledger["2026-09"] = [ledgerFuel({ odo: 76260 })];
    const prev = ctx.fuelPreviousNote("DT-09", 80000, { beforeDate: "2026-10-20" });
    assert.match(prev.text, /odometer 76,260 km/);
    assert.match(prev.text, /Consumption: n\/a \(placeholder reading\)/);

    ctx.S.ledger["2026-09"] = [ledgerFuel({ odo: 10000 })];
    const now = ctx.fuelPreviousNote("DT-09", "76260", { beforeDate: "2026-10-20" });
    assert.match(now.text, /Consumption: n\/a \(placeholder reading\)/);
  });

  it("does not compute consumption from a cancelled fill, and skips it when a real fill exists", () => {
    const ctx = loadFuel();
    ctx.S.ledger["2026-09"] = [
      ledgerFuel({ date: "2026-08-01", vrf: "5700", odo: 9000, liters: 30, vstatus: "Closed" }),
      ledgerFuel({ date: "2026-09-15", vrf: "5900", odo: 9500, liters: 50, vstatus: "Cancelled" }),
    ];
    const note = ctx.fuelPreviousNote("DT-09", 10000, { beforeDate: "2026-10-20" });
    assert.match(note.text, /VRF 5700/);
    assert.match(note.text, /Consumption: 33\.33 km per liter/);
    assert.doesNotMatch(note.text, /VRF 5900/);

    ctx.S.ledger["2026-09"] = [
      ledgerFuel({ date: "2026-09-15", vrf: "5900", odo: 9500, liters: 50, vstatus: "Cancelled" }),
    ];
    const only = ctx.fuelPreviousNote("DT-09", 10000, { beforeDate: "2026-10-20" });
    assert.match(only.text, /VRF 5900/);
    assert.match(only.text, /Cancelled/);
    assert.match(only.text, /Consumption: n\/a \(previous fill cancelled\)/);
  });

  it("reads a reserve-only fuel fill (draft odometer, litres, FUEL-RES)", () => {
    const ctx = loadFuel();
    ctx.S.reserves = [
      {
        no: "40",
        vrfNo: "6001",
        veh: "MC-02",
        date: "2026-10-01",
        status: "Requested",
        work: "FUEL-RES",
        kind: "fuel-issue",
        litres: 12.5,
        draftOdo: "2000",
        draftLines: [{ cat: "Fuel — Gasoline", qty: 1, unit: "pc", liters: "", work: "FUEL-RES" }],
      },
    ];
    const note = ctx.fuelPreviousNote("MC-02", 2125, { beforeDate: "2026-10-20" });
    assert.match(note.text, /VRF 6001/);
    assert.match(note.text, /12\.50 L/);
    assert.match(note.text, /odometer 2,000 km/);
    assert.match(note.text, /125 km since/);
    assert.match(note.text, /Consumption: 10\.00 km per liter/);
  });

  it("stores the sentence for a new fuel line and leaves a non-fuel VRF blank", () => {
    const ctx = loadFuel();
    ctx.S.ledger["2026-09"] = [ledgerFuel()];
    const fuel = ctx.fuelPrevNoteForNewVrf(
      "DT-09",
      11000,
      "2026-10-20",
      [{ cat: "Fuel — Diesel", qty: 1, unit: "pc", liters: 20 }]
    );
    assert.match(fuel, /Consumption: 25\.00 km per liter/);
    const parts = ctx.fuelPrevNoteForNewVrf(
      "DT-09",
      11000,
      "2026-10-20",
      [{ cat: "Fuel Filter", qty: 1, unit: "pc" }]
    );
    assert.equal(parts, "");
  });

  it("shows a stored sentence as-is and does not write a computed one onto an old VRF", () => {
    const ctx = loadFuel();
    ctx.S.ledger["2026-09"] = [
      ledgerFuel({ date: "2026-08-01", vrf: "5700", odo: 8000, liters: 20 }),
      ledgerFuel({ date: "2026-10-01", vrf: "6100", odo: 9000, liters: 25 }),
    ];
    const old = {
      vrf: "6100",
      date: "2026-10-01",
      veh: "DT-09",
      odo: 9000,
      rows: [{ cat: "Fuel — Diesel", odo: 9000, vrf: "6100", liters: 25 }],
    };
    const before = JSON.stringify(old);
    const live = ctx.shownFuelPrevNote(old);
    assert.equal(JSON.stringify(old), before);
    assert.equal(old.fuelPrevNote, undefined);
    assert.match(live, /VRF 5700/);
    assert.doesNotMatch(live, /VRF 6100/);

    const frozen = {
      vrf: "6100",
      date: "2026-10-01",
      veh: "DT-09",
      odo: 9000,
      fuelPrevNote: "Previous fuel: frozen at creation\nConsumption: 11.00 km per liter",
      rows: [{ cat: "Fuel — Diesel", odo: 9000 }],
    };
    assert.equal(ctx.shownFuelPrevNote(frozen), frozen.fuelPrevNote);
    assert.equal(frozen.fuelPrevNote, "Previous fuel: frozen at creation\nConsumption: 11.00 km per liter");
  });

  it("shows the note on the request form, the approver review, and the VRF print", () => {
    const form = extractFunction(html, "vrfView");
    assert.match(form, /fuelPreviousNote\(d\.veh/);
    assert.match(form, /fuelPrevNoteForNewVrf\(d\.veh/);
    assert.match(form, /Previous fuel/);
    const send = extractFunction(html, "sendForApproval");
    assert.match(send, /fuelPrevNoteForNewVrf\(d\.veh/);
    assert.match(send, /if\(fuelPrevNote\) hold\.fuelPrevNote=fuelPrevNote/);
    assert.doesNotMatch(send, /S\.reserves\.forEach\([\s\S]*fuelPrevNote=/);
    const review = extractFunction(html, "openVrf");
    const approver = extractFunction(html, "openReserve");
    const print = extractFunction(html, "buildVrfDoc");
    [review, approver, print].forEach((fn) => {
      assert.match(fn, /shownFuelPrevNote\(/);
      assert.match(fn, /Previous fuel/);
    });
    const shown = extractFunction(html, "shownFuelPrevNote");
    assert.doesNotMatch(shown, /fuelPrevNote\s*=/);
    const post = extractFunction(html, "prepareReservePost");
    assert.match(post, /if\(r\.fuelPrevNote\) row\.fuelPrevNote=r\.fuelPrevNote/);
  });
});

describe("approve copies a stored fuel note and does not invent one", () => {
  function hold(extra) {
    return Object.assign(
      {
        no: "20",
        vrfNo: "7001",
        date: "2026-10-20",
        status: "Requested",
        veh: "DT-09",
        work: "FUEL-STN",
        budget: 2000,
        requestedBy: "Ana",
        draftOdo: "11000",
        draftLines: [
          { cat: "Fuel — Diesel", item: "Diesel", qty: 1, price: 2000, unit: "pc", liters: 20, work: "FUEL-STN" },
        ],
      },
      extra || {}
    );
  }

  it("copies fuelPrevNote onto the posted lines", () => {
    const sentence = "Previous fuel: 2026-09-01 · VRF 5800\nConsumption: 12.50 km per liter";
    const row = hold({ fuelPrevNote: sentence });
    const result = applyApproveFromHold(
      { ledgerRows: [], reserves: [row], vehicles: [], parts: [] },
      row,
      { approvedBy: "Jeffrey", now: "2026-10-20" }
    );
    assert.equal(result.rows[0].fuelPrevNote, sentence);
    assert.equal(result.hold.fuelPrevNote, sentence);
    assert.match(approveSrc, /if \(hold\.fuelPrevNote\) row\.fuelPrevNote = String\(hold\.fuelPrevNote\)/);
  });

  it("leaves an older hold without the field", () => {
    const row = hold({ vrfNo: "7002", no: "21" });
    const result = applyApproveFromHold(
      { ledgerRows: [], reserves: [row], vehicles: [], parts: [] },
      row,
      { approvedBy: "Jeffrey", now: "2026-10-20" }
    );
    assert.equal(Object.prototype.hasOwnProperty.call(result.rows[0], "fuelPrevNote"), false);
    assert.equal(row.fuelPrevNote, undefined);
  });
});
