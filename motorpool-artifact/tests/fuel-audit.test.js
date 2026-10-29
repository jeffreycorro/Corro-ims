"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const audit = require("../public/fuel-audit.js");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const approveSrc = fs.readFileSync(path.join(__dirname, "../netlify/functions/approve-vrf.js"), "utf8");

describe("fuel audit seed and rules", () => {
  it("is build 2026-10-29 b and leaves approve-vrf alone", () => {
    assert.match(html, /var BUILD = "2026-10-29 b"/);
    assert.match(html, /<script src="\/fuel-audit\.js"><\/script>/);
    assert.match(html, /Not approved — cannot print/);
    assert.match(html, /missing photos/);
    assert.match(html, /function askEncoderChecklist/);
    assert.match(html, /function voidRequestedReserve/);
    assert.match(html, /function fuelAuditView/);
    assert.doesNotMatch(approveSrc, /encoderChecklist|fuelPhotos|odoOverride/);
    assert.match(approveSrc, /approvePendingVrf/);
  });

  it("keeps the consumption screen for the other rolling-consumption work", () => {
    assert.match(html, /function consumeView\(\)/);
    assert.match(html, /function consumption\(\)/);
    assert.match(html, /Rolling consumption stays on Consumption/);
  });

  it("uses Jeffrey’s override days for max litres and the next fill date", () => {
    assert.equal(audit.maxPerFill("SV-12"), 36.5);
    assert.equal(audit.earliestNextFill("2026-10-01", "BH-03"), "2026-10-14");
    const ref = audit.refBundle();
    const custom = {
      units: ref.units,
      allocation: Object.assign({}, ref.allocation, {
        "SV-10": { daily: 5, cycleDays: 7, overrideDays: 10 }
      }),
      classFloor: ref.classFloor,
      noBaseline: {}
    };
    assert.equal(audit.cycleDaysOf(custom.allocation["SV-10"]), 10);
    assert.equal(audit.maxPerFill("SV-10", custom), 50);
    assert.equal(audit.earliestNextFill("2026-10-01", "SV-10", custom), "2026-10-11");
    const flags = audit.allocationFlags({
      unit: "SV-10", date: "2026-10-05", lastDate: "2026-10-01", liters: 60, ref: custom
    });
    assert.equal(flags.overMax, true);
    assert.equal(flags.beforeDate, true);
  });

  it("shows km/L, L/hr, and L/day benchmarks, and n/a when a unit has none", () => {
    const bt = audit.benchmarkPanel("BT-02");
    assert.equal(bt.measure, "km/L");
    assert.match(bt.normalText, /4\.28 km\/L/);
    assert.match(bt.redText, /below 1\.95/);
    const bh = audit.benchmarkPanel("BH-03");
    assert.equal(bh.measure, "L/hr");
    assert.match(bh.redText, /above 10\.33/);
    const sv = audit.benchmarkPanel("SV-12");
    assert.equal(sv.measure, "L/day");
    assert.equal(sv.brokenOdo, true);
    assert.match(sv.normalText, /5–6\.5 L\/day/);
    const bt3 = audit.benchmarkPanel("BT-03");
    assert.equal(bt3.brokenOdo, true);
    assert.match(bt3.normalText, /2\.5–3\.3 L\/day/);
    const missing = audit.benchmarkPanel("ZZ-99");
    assert.equal(missing.known, false);
    assert.equal(missing.label, "n/a");
    const bare = audit.benchmarkPanel("MC-02");
    assert.equal(bare.known, false);
    assert.match(bare.note, /odometer photo required/i);
  });

  it("requires a fuel-gauge photo and an odometer or hour-meter photo", () => {
    const absent = audit.fuelPhotoStatus([
      { role: "receipt", caption: "Receipt" }
    ]);
    assert.equal(absent.missing, true);
    assert.equal(absent.label, "missing photos");
    const ok = audit.fuelPhotoStatus([
      { caption: "Fuel gauge before fill" },
      { role: "odometer", caption: "dash" }
    ]);
    assert.equal(ok.missing, false);
    assert.equal(ok.gauge, true);
    assert.equal(ok.meter, true);
    assert.equal(audit.fuelPhotoStatus(null).label, "n/a");
    assert.equal(audit.missingPhotoBadge({ fuel: true, photoCount: 0 }), "missing photos");
    assert.equal(audit.missingPhotoBadge({ fuel: true, photoCount: 2 }), "");
  });

  it("flags a lower odometer and a short gap", () => {
    const lower = audit.odoLowerThanLast(9000, 10000);
    assert.equal(lower.lower, true);
    assert.equal(audit.odoLowerThanLast("", 10000).label, "n/a");
    const gap = audit.shortGapFlag({
      date: "2026-10-02", lastDate: "2026-10-01", odo: 10040, lastOdo: 10000, meter: "km", shortGapKm: 50
    });
    assert.equal(gap.shortKm, true);
    assert.equal(gap.flag, true);
    const enough = audit.shortGapFlag({
      date: "2026-10-03", lastDate: "2026-10-01", odo: 10050, lastOdo: 10000, meter: "km", shortGapKm: 50
    });
    assert.equal(enough.flag, false);
    const same = audit.shortGapFlag({
      date: "2026-10-01", lastDate: "2026-10-01", odo: 10200, lastOdo: 10000, meter: "km"
    });
    assert.equal(same.sameDay, true);
    assert.equal(same.flag, true);
  });

  it("detects the same fill and a VRF or receipt reused on another unit", () => {
    const rows = [
      { veh: "DT-09", date: "2026-10-01", liters: 40, amount: 3200, vrf: "6100", status: "Open" },
      { veh: "SV-10", date: "2026-10-02", liters: 20, amount: 1500, vrf: "6101", receipt: "OR-9", status: "Open" }
    ];
    const same = audit.duplicateFuelHits(rows, { veh: "DT-09", date: "2026-10-01", liters: 40, amount: 100, vrf: "6200" });
    assert.equal(same.sameFill.length, 1);
    const amount = audit.duplicateFuelHits(rows, { veh: "DT-09", date: "2026-10-01", liters: 10, amount: 3200, vrf: "6201" });
    assert.equal(amount.flag, true);
    const reused = audit.duplicateFuelHits(rows, { veh: "MC-07", date: "2026-10-04", liters: 3, amount: 200, vrf: "6100" });
    assert.equal(reused.reusedNumber.length, 1);
    const receipt = audit.duplicateFuelHits(rows, { veh: "MC-07", date: "2026-10-04", liters: 3, amount: 200, vrf: "6300", receipt: "OR-9" });
    assert.equal(receipt.reusedNumber.length, 1);
    const cancelled = audit.duplicateFuelHits(
      [{ veh: "DT-09", date: "2026-10-01", liters: 40, amount: 3200, vrf: "6100", status: "Cancelled" }],
      { veh: "DT-09", date: "2026-10-01", liters: 40, vrf: "6200" }
    );
    assert.equal(cancelled.flag, false);
    assert.deepEqual(audit.reusedVrfNumbers(rows.concat([{ veh: "MC-07", vrf: "6101", status: "Open" }])).map((h) => h.vrf), ["6101"]);
  });

  it("voids a requested VRF only with a person and a reason", () => {
    const missing = audit.voidRecord({ status: "Requested", no: "4" }, { by: "Ana" });
    assert.equal(missing.ok, false);
    const posted = audit.voidRecord({ status: "Open" }, { by: "Ana", reason: "wrong unit" });
    assert.equal(posted.ok, false);
    const ok = audit.voidRecord({ status: "Draft", no: "4", budget: 500 }, { by: "Ana", reason: "driver stood down", at: "2026-10-29" });
    assert.equal(ok.ok, true);
    assert.equal(ok.record.status, "Cancelled");
    assert.equal(ok.record.cancelNote, "driver stood down");
    assert.equal(ok.record.cancelledBy, "Ana");
    assert.equal(ok.record.budget, 500);
    assert.equal(ok.record.voidLog[0].from, "Draft");
  });

  it("blocks print until the VRF is approved and still allows a reprint", () => {
    assert.equal(audit.mayPrint({ vrf: "5901", status: "Requested", held: true }).ok, false);
    assert.equal(audit.mayPrint({ vrf: "5901", status: "Requested", held: true }).message, "Not approved — cannot print");
    assert.equal(audit.mayPrint({ vrf: "— not yet posted —", status: "Draft", unnumbered: true }).ok, false);
    assert.equal(audit.mayPrint({ vrf: "5812", status: "Open" }).ok, true);
    assert.equal(audit.mayPrint({ vrf: "5812", status: "Closed", approvedAt: "2026-10-02" }).ok, true);
    assert.equal(audit.mayPrint({ vrf: "5812", status: "Cancelled", approvedAt: "2026-10-02", src: "ledger" }).ok, true);
    assert.equal(audit.mayPrint({ vrf: "5901", status: "Cancelled", held: true, src: "reserve-hold" }).ok, false);
  });

  it("requires a driver on a new fuel VRF and leaves an old record as n/a", () => {
    assert.equal(audit.driverState({}, { fuel: true }).label, "n/a");
    assert.equal(audit.driverState({ driver: "" }, { fuel: true, entering: true }).ok, false);
    assert.equal(audit.driverState({ driver: "Juan" }, { fuel: true, entering: true }).ok, true);
    assert.equal(audit.driverState({ driver: "" }, { fuel: false }).required, false);
  });

  it("flags a project that is not the unit’s current project", () => {
    assert.equal(audit.projectMismatch("Yard", "HH-STAFF").flag, true);
    assert.equal(audit.projectMismatch("HH-STAFF", "hh-staff").flag, false);
    assert.equal(audit.projectMismatch("", "HH-STAFF").label, "n/a");
  });

  it("checks litres times price, pesos typed as litres, and the supplier price band", () => {
    const ok = audit.amountCheck({ liters: 40, pricePerL: 80, amount: 3200 });
    assert.equal(ok.ok, true);
    const off = audit.amountCheck({ liters: 40, pricePerL: 80, amount: 3000 });
    assert.equal(off.ok, false);
    assert.equal(audit.amountCheck({ liters: 40 }).label, "n/a");
    const pesos = audit.pesosAsLiters({ liters: 3500, maxPerFill: 50, unit: "DT-09" });
    assert.equal(pesos.flag, true);
    const normal = audit.pesosAsLiters({ liters: 40, maxPerFill: 50, unit: "DT-09" });
    assert.equal(normal.flag, false);
    const price = audit.priceOutsideRange(120, [70, 75, 80, 82]);
    assert.equal(price.flag, true);
    assert.equal(audit.priceOutsideRange(78, [70, 82]).flag, false);
    assert.equal(audit.priceOutsideRange(78, [80]).label, "n/a");
  });

  it("reconciles reserve litres with the fills drawn from that reserve", () => {
    const one = audit.reconcileReserve(200, [{ liters: 40 }, { liters: 50 }]);
    assert.equal(one.remaining, 110);
    assert.equal(one.mismatch, false);
    const over = audit.reconcileReserve(30, [{ liters: 40 }]);
    assert.equal(over.mismatch, true);
    const book = audit.reconcileLots(
      [{ id: "VRF-100", liters: 100 }],
      [{ reserve: "VRF-100", liters: 40, veh: "DT-09" }, { reserve: "", liters: 15, veh: "SV-10" }]
    );
    assert.equal(book.lots[0].remaining, 60);
    assert.equal(book.unassignedLiters, 15);
    assert.equal(audit.reconcileReserve(null, []).label, "n/a");
  });

  it("reports receipt, liquidated date, and aging, with n/a when the fields were never stored", () => {
    const open = audit.liquidationStatus({
      vrf: "6100", veh: "DT-09", date: "2026-10-01", status: "Open",
      photoCount: 0, photosKnown: true
    }, "2026-10-29");
    assert.equal(open.receipt, "n");
    assert.equal(open.outstanding, true);
    assert.equal(open.agingDays, 28);
    const done = audit.liquidationStatus({
      vrf: "6101", date: "2026-09-01", status: "Closed", liquidatedAt: "2026-09-20", driveUrl: "https://drive.example/r"
    }, "2026-10-29");
    assert.equal(done.receipt, "y");
    assert.equal(done.liquidatedDate, "2026-09-20");
    assert.equal(done.outstanding, false);
    const legacy = audit.liquidationStatus({ vrf: "100", status: "Open" }, "2026-10-29");
    assert.equal(legacy.receipt, "n/a");
    assert.equal(legacy.agingLabel, "n/a");
  });

  it("stores an encoder checklist and will not forward until every tick is set", () => {
    assert.equal(audit.normalizeChecklist(null).label, "n/a");
    const items = audit.checklistItems().map((item) => ({ id: item.id, checked: true, note: item.id === "km" ? "short haul" : "" }));
    const ready = audit.checklistReady({ by: "Ana", at: "2026-10-29", items: items }, { km: true });
    assert.equal(ready.ok, true);
    const missing = audit.checklistReady({ items: items.map((item) => Object.assign({}, item, { checked: item.id !== "gauge" })) }, {});
    assert.equal(missing.ok, false);
    const noNote = audit.checklistReady({ items: items.map((item) => Object.assign({}, item, { note: "" })) }, { duplicate: true });
    assert.equal(noNote.ok, false);
    assert.match(noNote.message, /Duplicate check/);
  });

  it("sums litres and pesos beyond the loaded floor for a chosen period", () => {
    const one = audit.unexplainedInterval({ liters: 60, move: 35, floor: 1.3, pricePerL: 95.1, measure: "km/L" });
    assert.ok(Math.abs(one.liters - 33.08) < 0.02);
    assert.ok(one.pesos > 3100);
    const hour = audit.unexplainedInterval({ liters: 120, move: 8.2, floor: 9.2, pricePerL: 54.66, measure: "L/hr" });
    assert.ok(Math.abs(hour.liters - 44.56) < 0.02);
    const summary = audit.unexplainedSummary([
      { veh: "DT-05", date: "2026-10-01", liters: 40, odo: 10000, amount: 3200, status: "Open", vrf: "1" },
      { veh: "DT-05", date: "2026-10-09", liters: 60, odo: 10035, amount: 5706, status: "Open", vrf: "6140" },
      { veh: "SV-12", date: "2026-10-01", liters: 10, status: "Open", vrf: "2" },
      { veh: "SV-12", date: "2026-10-02", liters: 40, amount: 3120, status: "Open", vrf: "3" }
    ], { from: "2026-10-01", to: "2026-10-31" });
    const dt = summary.filter((row) => row.veh === "DT-05")[0];
    assert.ok(dt.liters > 30);
    assert.equal(dt.measure, "km/L");
    const sv = summary.filter((row) => row.veh === "SV-12")[0];
    assert.equal(sv.measure, "L/day");
    assert.ok(sv.liters > 20);
    const none = audit.unexplainedInterval({});
    assert.equal(none.label, "n/a");
  });
});
