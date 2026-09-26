"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  applyLiquidationLine,
  canonicalVrfStatus,
  heldLineAmount,
  heldVrfStatus,
  lineMoney,
  liquidationOutcome,
  lineWasNotPurchased,
  vrfCanLiquidate,
  vrfPrintWatermark,
} = require("./lib/rules");

const fuel = {
  vrf: "5830",
  cat: "Fuel — Diesel",
  item: "Diesel",
  qty: 30,
  price: 169,
  total: 5070,
  liters: 30,
  vstatus: "Open",
};

describe("Not bought / cancel after approval zeroes the VRF", () => {
  const approved = { no: "30", vrfNo: "5830", status: "Approved", vrfs: ["5830"], approvedBudget: 5070 };

  it("keeps a bought line at the receipt amount", () => {
    const next = applyLiquidationLine(fuel, { qty: 20, price: 169 }, { at: "2026-09-25", outcome: "bought" }, "bought");
    assert.equal(next.qty, 20);
    assert.equal(next.price, 169);
    assert.equal(next.total, 3380);
    assert.equal(next.vstatus, "Closed");
    assert.equal(next.notBought, false);
    assert.equal(lineMoney(next), 3380);
  });

  it("zeros a Not bought line instead of leaving 5,070", () => {
    const next = applyLiquidationLine(
      fuel,
      { remove: true },
      { at: "2026-09-25", by: "Yard", note: "station refused", outcome: "not-bought" },
      "not-bought"
    );
    assert.equal(next.qty, 0);
    assert.equal(next.price, 0);
    assert.equal(next.total, 0);
    assert.equal(next.liters, null);
    assert.equal(next.notBought, true);
    assert.equal(next.vstatus, "Not bought");
    assert.equal(lineMoney(next), 0);
    assert.equal(lineWasNotPurchased(next), true);
    assert.equal(
      canonicalVrfStatus("Not bought", approved, next.liq, "5830").status,
      "Not bought"
    );
    assert.equal(vrfCanLiquidate({ vrf: "5830", status: "Not bought", liq: next.liq }, approved), false);
    assert.equal(vrfPrintWatermark({ vrf: "5830", status: "Not bought", held: true }), "NOT BOUGHT");
  });

  it("zeros every line when the approved purchase is cancelled", () => {
    const next = applyLiquidationLine(fuel, {}, { at: "2026-09-25", outcome: "cancelled" }, "cancelled");
    assert.equal(next.total, 0);
    assert.equal(next.qty, 0);
    assert.equal(next.price, 0);
    assert.equal(lineMoney(next), 0);
    assert.equal(next.vstatus, "Cancelled");
    assert.equal(canonicalVrfStatus("Cancelled", approved, next.liq, "5830").status, "Cancelled");
    assert.equal(vrfCanLiquidate({ vrf: "5830", status: "Cancelled" }, approved), false);
    assert.equal(vrfPrintWatermark({ vrf: "5830", status: "Cancelled" }), "CANCELLED");
  });

  it("treats all-not-bought as not-bought and a partial as a normal liquidation", () => {
    assert.equal(liquidationOutcome([fuel], [{ remove: true }], []), "not-bought");
    assert.equal(liquidationOutcome([fuel, fuel], [{ remove: true }, {}], []), "bought");
    assert.equal(
      liquidationOutcome([fuel], [{ remove: true }], [{ cat: "Fuel — Diesel", qty: 1, price: 10 }]),
      "bought"
    );
    const partial = applyLiquidationLine(fuel, { remove: true }, { outcome: "bought" }, "bought");
    assert.equal(partial.vstatus, "Closed");
    assert.equal(partial.total, 0);
    assert.equal(lineMoney(partial), 0);
  });

  it("does not rebuild a cancelled hold at the approved 5,070", () => {
    const cancelled = {
      status: "Cancelled",
      cancelOutcome: "cancelled",
      cancelledAt: "2026-09-25",
      approvedBudget: 5070,
      budget: 5070,
    };
    assert.equal(heldLineAmount(cancelled, fuel), 0);
    assert.equal(heldLineAmount(cancelled, null), 0);
    assert.equal(heldVrfStatus(cancelled, "Open"), "Cancelled");
    const notBought = { status: "Cancelled", cancelOutcome: "not-bought", cancelledAt: "2026-09-25", approvedBudget: 5070 };
    assert.equal(heldLineAmount(notBought, fuel), 0);
    assert.equal(heldVrfStatus(notBought, "Open"), "Not bought");
    assert.equal(heldLineAmount(approved, fuel), 5070);
    assert.equal(heldVrfStatus(approved, "Open"), "Open");
  });
});

describe("artifact HTML — not bought and cancel", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("zeros lines on liquidation and offers cancel after approval", () => {
    assert.match(html, /function applyLiquidationLine/);
    assert.match(html, /function cancelApprovedVrf/);
    assert.match(html, /function askCancelVrf/);
    assert.match(html, /function liquidationOutcome/);
    assert.match(html, /function heldLineAmount/);
    assert.match(html, /Cancel VRF — purchase did not go through/);
    assert.match(html, /Close as not bought/);
    assert.match(html, /outcome==="cancelled"\|\|outcome==="not-bought"/);
    assert.doesNotMatch(html, /if\(e\.remove\)\{ arr\.splice\(idx,1\)/);
    assert.match(html, /var BUILD = "2026-09-26 a"/);
  });
});
