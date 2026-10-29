"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
    "fuelRedFlagTable",
    "fuelRefOf",
    "fuelMeasureOf",
    "fuelUsePhrase",
    "fuelMedian",
    "fuelNaPhrase",
    "fuelRecordLitres",
    "fuelRollingNote",
    "shownFuelRollingNote",
  ];
  const ctx = {
    S: { ledger: {}, reserves: [] },
    FUEL_ODO_PLACEHOLDERS: { 76260: 1 },
    HOUR_METER: /^(BH|RR|TM|MBC|Equipment)/i,
    DAY: 86400000,
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function ledgerFuel(over) {
  return Object.assign(
    {
      date: "2026-09-01",
      vrf: "5800",
      veh: "BT-02",
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

function loadRows(ctx, rows) {
  ctx.S.ledger = { "2026-10": rows };
  ctx.S.reserves = [];
}

describe("fuel VRF 90-day consumption", () => {
  it("is build 2026-10-29 a and keeps the sheet floors in a TODO map", () => {
    assert.match(html, /var BUILD = "2026-10-29 a"/);
    assert.match(html, /TODO: this page cannot read that sheet at runtime/);
    assert.match(html, /1rF-ee4RpinJ6EZCxvZ15aWKFEFDmhSNAI-zKy7DBnUg/);
    assert.match(html, /Unit Fuel Reference/);
    const ctx = loadFuel();
    assert.equal(ctx.fuelRefOf("BT-02").floor, 1.95);
    assert.equal(ctx.fuelRefOf("BT-02").dir, "below");
    assert.equal(ctx.fuelRefOf("DT-08").floor, 1.36);
    assert.equal(ctx.fuelRefOf("SV-12").measure, "L/day");
    assert.equal(ctx.fuelRefOf("SV-12").floor, 13);
    assert.equal(ctx.fuelRefOf("BT-03").floor, 10);
    assert.equal(ctx.fuelRefOf("BH-05").floor, 4.28);
    assert.equal(ctx.fuelMeasureOf("DT-01"), "km/L");
    assert.equal(ctx.fuelMeasureOf("MBC-01"), "L/hr");
    assert.equal(ctx.fuelRefOf("DT-01"), null);
  });

  it("states BT-02 total km/L, median, and fill count, and flags only under the 1.95 floor", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ date: "2026-07-01", vrf: "4900", odo: 16000, liters: 100 }),
      ledgerFuel({ date: "2026-08-01", vrf: "5100", odo: 16400, liters: 100 }),
      ledgerFuel({ date: "2026-08-20", vrf: "5200", odo: 16820, liters: 100 }),
      ledgerFuel({ date: "2026-09-10", vrf: "5300", odo: 17240, liters: 80 }),
      ledgerFuel({ date: "2026-10-01", vrf: "5400", odo: 17600, liters: 100 }),
    ]);
    const low = ctx.fuelRollingNote("BT-02", 17750, { beforeDate: "2026-10-20" });
    assert.equal(low.measure, "km/L");
    assert.equal(low.fillsUsed, 4);
    assert.equal([...low.usedVrfs].join(","), "5100,5200,5300,5400");
    assert.ok(Math.abs(low.avg - 1600 / 380) < 1e-9);
    assert.ok(Math.abs(low.median - 4.2) < 1e-9);
    assert.ok(Math.abs(low.currentRate - 1.5) < 1e-9);
    assert.equal(low.currentRate, ctx.fuelPreviousNote("BT-02", 17750, { beforeDate: "2026-10-20" }).consumption);
    assert.equal(low.floorFlag, true);
    assert.equal(low.fallbackFlag, false);
    assert.equal(low.consecutive, false);
    assert.match(low.text, /3-month consumption: 4\.21 km per liter over 90 days/);
    assert.match(low.text, /Median per fill: 4\.20 km per liter/);
    assert.match(low.text, /Fills used: 4/);
    assert.match(low.text, /This request: 1\.50 km per liter — 64% below the 3-month figure/);
    assert.match(low.text, /Red flag: below the 1\.95 km per liter floor/);
    assert.doesNotMatch(low.text, /2 consecutive low fills/);

    const aboveFloor = ctx.fuelRollingNote("BT-02", 17850, { beforeDate: "2026-10-20" });
    assert.ok(Math.abs(aboveFloor.currentRate - 2.5) < 1e-9);
    assert.equal(aboveFloor.floorFlag, false);
    assert.equal(aboveFloor.consecutive, false);
    assert.match(aboveFloor.text, /This request: 2\.50 km per liter/);
    assert.match(aboveFloor.text, /below the 3-month figure/);
    assert.doesNotMatch(aboveFloor.text, /Red flag/);
  });

  it("states DT-08 the same way and flags 1.00 km/L under the 1.36 floor", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ veh: "DT-08", date: "2026-07-10", vrf: "6000", odo: 5000, liters: 60 }),
      ledgerFuel({ veh: "DT-08", date: "2026-08-05", vrf: "6100", odo: 5120, liters: 50 }),
      ledgerFuel({ veh: "DT-08", date: "2026-08-25", vrf: "6110", odo: 5240, liters: 50 }),
      ledgerFuel({ veh: "DT-08", date: "2026-09-15", vrf: "6120", odo: 5360, liters: 40 }),
      ledgerFuel({ veh: "DT-08", date: "2026-10-05", vrf: "6130", odo: 5480, liters: 60 }),
    ]);
    const note = ctx.fuelRollingNote("DT-08", 5540, { beforeDate: "2026-10-20" });
    assert.equal(note.fillsUsed, 4);
    assert.ok(Math.abs(note.avg - 2.4) < 1e-9);
    assert.ok(Math.abs(note.median - 2.4) < 1e-9);
    assert.ok(Math.abs(note.currentRate - 1) < 1e-9);
    assert.equal(note.floorFlag, true);
    assert.equal(note.consecutive, false);
    assert.match(note.text, /3-month consumption: 2\.40 km per liter over 90 days/);
    assert.match(note.text, /Median per fill: 2\.40 km per liter/);
    assert.match(note.text, /Fills used: 4/);
    assert.match(note.text, /This request: 1\.00 km per liter — 58% below the 3-month figure/);
    assert.match(note.text, /Red flag: below the 1\.36 km per liter floor/);
  });

  it("says not enough data with fewer than 3 kept fills", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ date: "2026-09-01", vrf: "5300", odo: 10000, liters: 40 }),
      ledgerFuel({ date: "2026-09-20", vrf: "5400", odo: 10400, liters: 40 }),
    ]);
    const note = ctx.fuelRollingNote("BT-02", 10800, { beforeDate: "2026-10-20" });
    assert.equal(note.fillsUsed, 1);
    assert.equal(note.avg, null);
    assert.match(note.text, /3-month consumption: not enough data \(1 fill in 90 days; need 3\)/);
    assert.doesNotMatch(note.text, /Median per fill/);
    assert.doesNotMatch(note.text, /Fills used:/);
    const none = ctx.fuelRollingNote("BT-02", 10800, { beforeDate: "2026-08-01" });
    assert.match(none.text, /not enough data \(0 fills in 90 days; need 3\)/);
  });

  it("skips negative, huge, unreliable, and placeholder gaps, and a cancelled fill", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ date: "2026-08-01", vrf: "1000", odo: 10000, liters: 50 }),
      ledgerFuel({ date: "2026-08-10", vrf: "1001", odo: 10400, liters: 50 }),
      ledgerFuel({ date: "2026-08-15", vrf: "1008", odo: 50000, liters: 80, vstatus: "Cancelled" }),
      ledgerFuel({ date: "2026-08-20", vrf: "1002", odo: 10800, liters: 50 }),
      ledgerFuel({ date: "2026-09-01", vrf: "1003", odo: 11200, liters: 50 }),
      ledgerFuel({ date: "2026-09-08", vrf: "1004", odo: 11000, liters: 50 }),
      ledgerFuel({ date: "2026-09-12", vrf: "1005", odo: 90000, liters: 50 }),
      ledgerFuel({ date: "2026-09-18", vrf: "1006", odo: 90010, liters: 50 }),
      ledgerFuel({ date: "2026-09-25", vrf: "1007", odo: 76260, liters: 50 }),
    ]);
    const note = ctx.fuelRollingNote("BT-02", 12000, { beforeDate: "2026-10-20" });
    assert.equal([...note.usedVrfs].join(","), "1001,1002,1003");
    assert.equal(note.fillsUsed, 3);
    assert.ok(Math.abs(note.avg - 8) < 1e-9);
  });

  it("keeps a fill on the 90th day and drops the day before it", () => {
    const ctx = loadFuel();
    const before = new Date(2026, 9, 20);
    const start = new Date(before.getTime() - 90 * 86400000);
    const dayBefore = new Date(start.getTime() - 86400000);
    const anchor = new Date(dayBefore.getTime() - 10 * 86400000);
    function iso(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    loadRows(ctx, [
      ledgerFuel({ date: iso(anchor), vrf: "1", odo: 1000, liters: 10 }),
      ledgerFuel({ date: iso(dayBefore), vrf: "2", odo: 1100, liters: 10 }),
      ledgerFuel({ date: iso(start), vrf: "3", odo: 1200, liters: 10 }),
    ]);
    const note = ctx.fuelRollingNote("BT-02", 1300, { beforeDate: iso(before) });
    assert.equal([...note.usedVrfs].join(","), "3");
  });

  it("counts an earlier same-day fill and ignores a later one and this VRF itself", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ date: "2026-10-01", vrf: "5400", odo: 18000, liters: 40 }),
      ledgerFuel({ date: "2026-10-20", vrf: "5490", odo: 18400, liters: 40 }),
      ledgerFuel({ date: "2026-10-20", vrf: "5500", odo: 18600, liters: 40 }),
      ledgerFuel({ date: "2026-10-20", vrf: "5510", odo: 19000, liters: 40 }),
    ]);
    const note = ctx.fuelRollingNote("BT-02", 18600, {
      beforeDate: "2026-10-20",
      exceptVrf: "5500",
      currentVrf: "5500",
    });
    assert.equal([...note.usedVrfs].join(","), "5490");
    assert.ok(Math.abs(note.currentRate - 5) < 1e-9);
    const before = JSON.stringify(ctx.S);
    ctx.fuelRollingNote("BT-02", 18600, { beforeDate: "2026-10-20", exceptVrf: "5500" });
    assert.equal(JSON.stringify(ctx.S), before);
  });

  it("uses the same n/a reasons as the last-fill line", () => {
    const ctx = loadFuel();
    loadRows(ctx, [ledgerFuel({ date: "2026-09-01", vrf: "5400", odo: 17600, liters: 100 })]);
    const missing = ctx.fuelRollingNote("BT-02", "", { beforeDate: "2026-10-20" });
    assert.match(missing.text, /This request: n\/a \(odometer missing\/unchanged\)/);
    const same = ctx.fuelRollingNote("BT-02", 17600, { beforeDate: "2026-10-20" });
    assert.match(same.text, /This request: n\/a \(odometer missing\/unchanged\)/);
    const back = ctx.fuelRollingNote("BT-02", 17000, { beforeDate: "2026-10-20" });
    assert.match(back.text, /This request: n\/a \(odometer missing\/unchanged\)/);
    const placeholder = ctx.fuelRollingNote("BT-02", 76260, { beforeDate: "2026-10-20" });
    assert.match(placeholder.text, /This request: n\/a \(placeholder reading\)/);
    loadRows(ctx, [ledgerFuel({ date: "2026-09-01", vrf: "5400", odo: 17600, liters: 0 })]);
    const noLitres = ctx.fuelRollingNote("BT-02", 18000, { beforeDate: "2026-10-20" });
    assert.match(noLitres.text, /This request: n\/a \(litres missing\)/);
    loadRows(ctx, [ledgerFuel({ date: "2026-09-01", vrf: "5400", odo: 17600, liters: 40, vstatus: "Cancelled" })]);
    const cancelled = ctx.fuelRollingNote("BT-02", 18000, { beforeDate: "2026-10-20" });
    assert.match(cancelled.text, /This request: n\/a \(previous fill cancelled\)/);
    assert.match(cancelled.text, /not enough data/);
  });

  it("shows SV-12 and BT-03 as liters per day over 90 days, not km per liter", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ veh: "SV-12", date: "2026-07-01", vrf: "4900", odo: null, liters: 40 }),
      ledgerFuel({ veh: "SV-12", date: "2026-08-01", vrf: "5100", odo: 76260, liters: 50 }),
      ledgerFuel({ veh: "SV-12", date: "2026-09-01", vrf: "5200", odo: null, liters: 60 }),
      ledgerFuel({ veh: "SV-12", date: "2026-10-01", vrf: "5300", odo: 1, liters: 40 }),
    ]);
    const note = ctx.fuelRollingNote("SV-12", 76260, { beforeDate: "2026-10-20", litres: 20 });
    assert.equal(note.measure, "L/day");
    assert.equal(note.fillsUsed, 3);
    assert.ok(Math.abs(note.avg - 150 / 90) < 1e-9);
    assert.ok(Math.abs(note.currentRate - 20 / 19) < 1e-9);
    assert.equal(note.floorFlag, false);
    assert.match(note.text, /3-month consumption: 1\.67 liters per day over 90 days/);
    assert.match(note.text, /Median per fill: 1\.61 liters per day/);
    assert.match(note.text, /Fills used: 3/);
    assert.match(note.text, /This request: 1\.05 liters per day/);
    assert.doesNotMatch(note.text, /km per liter/);
    assert.doesNotMatch(note.text, /placeholder/);

    loadRows(ctx, [ledgerFuel({ veh: "BT-03", date: "2026-10-10", vrf: "7000", odo: null, liters: 20 })]);
    const boom = ctx.fuelRollingNote("BT-03", null, { beforeDate: "2026-10-20", litres: 120 });
    assert.equal(boom.measure, "L/day");
    assert.equal(boom.fillsUsed, 0);
    assert.equal(boom.floorFlag, true);
    assert.match(boom.text, /not enough data \(0 fills in 90 days; need 3\)/);
    assert.match(boom.text, /This request: 12\.00 liters per day/);
    assert.match(boom.text, /Red flag: above the 10 liters per day floor/);
    assert.doesNotMatch(boom.text, /km per liter/);
  });

  it("rates an hour meter in liters per hour and flags above its floor", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ veh: "BH-05", date: "2026-07-01", vrf: "4900", odo: 100, liters: 40 }),
      ledgerFuel({ veh: "BH-05", date: "2026-08-01", vrf: "5100", odo: 110, liters: 30 }),
      ledgerFuel({ veh: "BH-05", date: "2026-08-20", vrf: "5200", odo: 120, liters: 30 }),
      ledgerFuel({ veh: "BH-05", date: "2026-09-10", vrf: "5300", odo: 130, liters: 40 }),
      ledgerFuel({ veh: "BH-05", date: "2026-10-01", vrf: "5400", odo: 142, liters: 50 }),
    ]);
    const note = ctx.fuelRollingNote("BH-05", 150, { beforeDate: "2026-10-20" });
    assert.equal(note.measure, "L/hr");
    assert.equal(note.fillsUsed, 4);
    assert.ok(Math.abs(note.avg - 140 / 42) < 1e-9);
    assert.ok(Math.abs(note.currentRate - 6.25) < 1e-9);
    assert.equal(note.currentRate, ctx.fuelPreviousNote("BH-05", 150, { beforeDate: "2026-10-20" }).consumption);
    assert.equal(note.floorFlag, true);
    assert.equal(note.consecutive, false);
    assert.match(note.text, /3-month consumption: 3\.33 liters per hour over 90 days/);
    assert.match(note.text, /This request: 6\.25 liters per hour/);
    assert.match(note.text, /Red flag: above the 4\.28 liters per hour floor/);
    assert.doesNotMatch(note.text, /km per liter/);
  });

  it("uses a 40% worse fallback only when the unit has no red-flag floor", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ veh: "DT-01", date: "2026-09-01", vrf: "1", odo: 1000, liters: 10 }),
      ledgerFuel({ veh: "DT-01", date: "2026-09-10", vrf: "2", odo: 1040, liters: 10 }),
      ledgerFuel({ veh: "DT-01", date: "2026-09-20", vrf: "3", odo: 1080, liters: 10 }),
      ledgerFuel({ veh: "DT-01", date: "2026-10-01", vrf: "4", odo: 1120, liters: 10 }),
    ]);
    const edge = ctx.fuelRollingNote("DT-01", 1144, { beforeDate: "2026-10-20" });
    assert.ok(Math.abs(edge.avg - 4) < 1e-9);
    assert.ok(Math.abs(edge.currentRate - 2.4) < 1e-9);
    assert.equal(edge.fallbackFlag, false);
    assert.equal(edge.consecutive, false);
    assert.doesNotMatch(edge.text, /Red flag/);
    const off = ctx.fuelRollingNote("DT-01", 1143, { beforeDate: "2026-10-20" });
    assert.ok(Math.abs(off.currentRate - 2.3) < 1e-9);
    assert.equal(off.fallbackFlag, true);
    assert.equal(off.floorFlag, false);
    assert.equal(off.consecutive, false);
    assert.match(off.text, /Red flag: more than 40% below the 3-month figure/);

    loadRows(ctx, [
      ledgerFuel({ veh: "MBC-01", date: "2026-09-01", vrf: "1", odo: 100, liters: 40 }),
      ledgerFuel({ veh: "MBC-01", date: "2026-09-10", vrf: "2", odo: 110, liters: 40 }),
      ledgerFuel({ veh: "MBC-01", date: "2026-09-20", vrf: "3", odo: 120, liters: 40 }),
      ledgerFuel({ veh: "MBC-01", date: "2026-10-01", vrf: "4", odo: 130, liters: 56 }),
    ]);
    const hourEdge = ctx.fuelRollingNote("MBC-01", 140, { beforeDate: "2026-10-20" });
    assert.ok(Math.abs(hourEdge.currentRate - 5.6) < 1e-9);
    assert.equal(hourEdge.fallbackFlag, false);
    loadRows(ctx, [
      ledgerFuel({ veh: "MBC-01", date: "2026-09-01", vrf: "1", odo: 100, liters: 40 }),
      ledgerFuel({ veh: "MBC-01", date: "2026-09-10", vrf: "2", odo: 110, liters: 40 }),
      ledgerFuel({ veh: "MBC-01", date: "2026-09-20", vrf: "3", odo: 120, liters: 40 }),
      ledgerFuel({ veh: "MBC-01", date: "2026-10-01", vrf: "4", odo: 130, liters: 57 }),
    ]);
    const hourOff = ctx.fuelRollingNote("MBC-01", 140, { beforeDate: "2026-10-20" });
    assert.ok(Math.abs(hourOff.currentRate - 5.7) < 1e-9);
    assert.equal(hourOff.fallbackFlag, true);
    assert.match(hourOff.text, /Red flag: more than 40% above the 3-month figure/);
    assert.equal(hourOff.consecutive, false);
  });

  it("flags 2 consecutive low fills on their own, with both VRF rates, even without a 3-month average", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ date: "2026-09-01", vrf: "5300", odo: 10000, liters: 50 }),
      ledgerFuel({ date: "2026-09-20", vrf: "5400", odo: 10040, liters: 40 }),
    ]);
    const note = ctx.fuelRollingNote("BT-02", 10080, { beforeDate: "2026-10-20" });
    assert.equal(note.fillsUsed, 1);
    assert.equal(note.consecutive, true);
    assert.equal(note.floorFlag, true);
    assert.match(note.text, /not enough data \(1 fill in 90 days; need 3\)/);
    assert.match(note.text, /Red flag: below the 1\.95 km per liter floor/);
    const lines = note.text.split("\n");
    const at = lines.indexOf("Red flag: 2 consecutive low fills");
    assert.ok(at > lines.indexOf("Red flag: below the 1.95 km per liter floor"));
    assert.equal(lines[at + 1], "VRF 5400 · 0.80 km per liter");
    assert.equal(lines[at + 2], "This request · 1.00 km per liter");
    assert.equal(note.consecutiveFills.map((row) => row.vrf).join(","), "5400,");

    const saved = ctx.fuelRollingNote("BT-02", 10080, {
      beforeDate: "2026-10-20",
      exceptVrf: "5500",
      currentVrf: "5500",
    });
    assert.match(saved.text, /VRF 5400 · 0\.80 km per liter\nVRF 5500 · 1\.00 km per liter/);

    loadRows(ctx, [
      ledgerFuel({ date: "2026-09-01", vrf: "5300", odo: 10000, liters: 50 }),
      ledgerFuel({ date: "2026-09-20", vrf: "5400", odo: 10400, liters: 40 }),
    ]);
    const onlyCurrent = ctx.fuelRollingNote("BT-02", 10470, { beforeDate: "2026-10-20" });
    assert.ok(Math.abs(onlyCurrent.currentRate - 1.75) < 1e-9);
    assert.equal(onlyCurrent.floorFlag, true);
    assert.equal(onlyCurrent.consecutiveFills.length, 0);
    assert.equal(onlyCurrent.consecutive, false);
    assert.doesNotMatch(onlyCurrent.text, /2 consecutive low fills/);
  });

  it("flags two consecutive hour-meter and broken-odometer fills on the bad side of the floor", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ veh: "BH-05", date: "2026-09-01", vrf: "5300", odo: 100, liters: 80 }),
      ledgerFuel({ veh: "BH-05", date: "2026-09-15", vrf: "5400", odo: 110, liters: 50 }),
    ]);
    const high = ctx.fuelRollingNote("BH-05", 118, { beforeDate: "2026-10-20", currentVrf: "5500" });
    assert.equal(high.consecutive, true);
    assert.match(high.text, /Red flag: above the 4\.28 liters per hour floor/);
    assert.match(high.text, /Red flag: 2 consecutive low fills\nVRF 5400 · 8\.00 liters per hour\nVRF 5500 · 6\.25 liters per hour/);

    loadRows(ctx, [
      ledgerFuel({ veh: "BH-05", date: "2026-09-01", vrf: "5300", odo: 100, liters: 20 }),
      ledgerFuel({ veh: "BH-05", date: "2026-09-15", vrf: "5400", odo: 110, liters: 30 }),
    ]);
    const fine = ctx.fuelRollingNote("BH-05", 120, { beforeDate: "2026-10-20" });
    assert.equal(fine.consecutive, false);
    assert.equal(fine.floorFlag, false);
    assert.doesNotMatch(fine.text, /Red flag/);

    loadRows(ctx, [
      ledgerFuel({ veh: "SV-12", date: "2026-10-16", vrf: "5300", odo: null, liters: 20 }),
      ledgerFuel({ veh: "SV-12", date: "2026-10-18", vrf: "5400", odo: null, liters: 40 }),
    ]);
    const days = ctx.fuelRollingNote("SV-12", null, {
      beforeDate: "2026-10-20",
      litres: 30,
      currentVrf: "5500",
    });
    assert.equal(days.fillsUsed, 1);
    assert.equal(days.consecutive, true);
    assert.match(days.text, /Red flag: above the 13 liters per day floor/);
    assert.match(days.text, /Red flag: 2 consecutive low fills\nVRF 5400 · 20\.00 liters per day\nVRF 5500 · 15\.00 liters per day/);
    assert.doesNotMatch(days.text, /km per liter/);

    const oneHigh = ctx.fuelRollingNote("SV-12", null, { beforeDate: "2026-10-20", litres: 10 });
    assert.equal(oneHigh.consecutive, false);
    assert.equal(oneHigh.floorFlag, false);
    assert.doesNotMatch(oneHigh.text, /2 consecutive low fills/);
  });

  it("does not store the 90-day note or change the last-fill sentence", () => {
    const ctx = loadFuel();
    loadRows(ctx, [
      ledgerFuel({ date: "2026-09-01", vrf: "5300", odo: 10000, liters: 50 }),
      ledgerFuel({ date: "2026-09-20", vrf: "5400", odo: 10040, liters: 40 }),
      ledgerFuel({ date: "2026-10-20", vrf: "5500", odo: 10080, liters: 30 }),
    ]);
    const frozen = {
      vrf: "5500",
      date: "2026-10-20",
      veh: "BT-02",
      odo: 10080,
      fuelPrevNote: "Previous fuel: frozen at creation\nConsumption: 11.00 km per liter",
      rows: [{ cat: "Fuel — Diesel", odo: 10080, liters: 30, vrf: "5500" }],
    };
    const before = JSON.stringify(frozen);
    assert.equal(ctx.shownFuelPrevNote(frozen), frozen.fuelPrevNote);
    const live = ctx.shownFuelRollingNote(frozen);
    assert.equal(JSON.stringify(frozen), before);
    assert.match(live, /2 consecutive low fills/);
    assert.match(live, /VRF 5400 · 0\.80 km per liter/);
    assert.match(live, /VRF 5500 · 1\.00 km per liter/);
    assert.doesNotMatch(live, /frozen at creation/);

    loadRows(ctx, [
      ledgerFuel({ date: "2026-09-01", vrf: "5300", odo: 10000, liters: 50 }),
      ledgerFuel({ date: "2026-09-20", vrf: "5400", odo: 10040, liters: 40 }),
    ]);
    const sentence = ctx.fuelPrevNoteForNewVrf(
      "BT-02",
      10080,
      "2026-10-20",
      [{ cat: "Fuel — Diesel", qty: 1, unit: "pc", liters: 30 }]
    );
    assert.match(sentence, /1\.00 km per liter/);
    assert.doesNotMatch(sentence, /3-month|90 days|Red flag/);
    assert.equal(ctx.shownFuelRollingNote({ veh: "BT-02", date: "2026-10-20", odo: 1, rows: [{ cat: "Oil" }] }), "");
  });

  it("shows the 90-day block on the request form, the approver review, and the print only", () => {
    const form = extractFunction(html, "vrfView");
    assert.match(form, /fuelRollingNote\(d\.veh/);
    assert.match(form, /appendFuelUse90\(fuelNote/);
    const send = extractFunction(html, "sendForApproval");
    assert.match(send, /fuelPrevNoteForNewVrf\(d\.veh/);
    assert.doesNotMatch(send, /fuelRollingNote|appendFuelUse90|shownFuelRollingNote|3-month consumption/);
    ["openReserve", "openVrf", "buildVrfDoc"].forEach((name) => {
      const fn = extractFunction(html, name);
      assert.match(fn, /shownFuelRollingNote\(/);
      assert.match(fn, /appendFuelUse90\(/);
    });
    const paint = extractFunction(html, "appendFuelUse90");
    assert.match(paint, /Fuel use, 90 days/);
    assert.match(paint, /data-fuel-rolling/);
    assert.doesNotMatch(extractFunction(html, "fuelCheck"), /fuelRollingNote|fuelRedFlagTable/);
    assert.doesNotMatch(extractFunction(html, "fuelPrevNoteForNewVrf"), /fuelRollingNote|3-month/);
    assert.doesNotMatch(extractFunction(html, "shownFuelRollingNote"), /fuelPrevNote\s*=/);
    assert.doesNotMatch(extractFunction(html, "shownFuelPrevNote"), /fuelRollingNote/);
  });
});
