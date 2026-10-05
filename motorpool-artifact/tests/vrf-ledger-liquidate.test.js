"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  approvedVrfMayJoinLedger,
  planLiquidationLedgerWrite,
  closedLedgerLinesFromHold,
  vrfCanLiquidate,
} = require("./lib/rules");

/* VRF 5795 as staff see it: approved, open, only a reserve-hold, no part
   category, so approval never posted a ledger row. */
const hold5795 = {
  vrf: "5795",
  date: "2026-09-14",
  veh: "DT-06",
  status: "Open",
  held: true,
  src: "reserve-hold",
  reserve: "3",
  odo: 431885,
  requestedBy: "Motorpool Dept.",
  total: 6760,
  rows: [
    {
      vrf: "5795",
      date: "2026-09-14",
      month: "2026-09",
      veh: "DT-06",
      cat: "",
      item: "Fuel reserve dispense",
      qty: 0,
      price: 0,
      total: 6760,
      src: "reserve-hold",
      reserve: "3",
      odo: 431885,
      vstatus: "Open",
    },
  ],
};
const reserve5795 = {
  no: "3",
  vrfNo: "5795",
  status: "Approved",
  vrfs: [],
  approvedBudget: 6760,
  draftLines: [],
};

describe("approved VRF missing from the ledger can still be liquidated", () => {
  it("seeds VRF 5795 under that number instead of refusing", () => {
    assert.equal(approvedVrfMayJoinLedger(hold5795, reserve5795), true);
    assert.equal(vrfCanLiquidate(hold5795, reserve5795), true);
    assert.equal(planLiquidationLedgerWrite(hold5795, reserve5795, 0), "seed");
    const lines = closedLedgerLinesFromHold(
      hold5795,
      [{ qty: 144.82, price: 95.34, supplier: "Kapitan" }],
      { at: "2026-09-26", by: "Yard", note: "", outcome: "bought" },
      "2026-09-26"
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].vrf, "5795");
    assert.equal(lines[0].month, "2026-09");
    assert.equal(lines[0].reserve, "3");
    assert.equal(lines[0].veh, "DT-06");
    assert.equal(lines[0].odo, 431885);
    assert.equal(lines[0].supplier, "Kapitan");
    assert.equal(lines[0].vstatus, "Closed");
    assert.equal(lines[0].notBought, false);
    assert.equal(Object.prototype.hasOwnProperty.call(lines[0], "src"), false);
    assert.ok(Math.abs(lines[0].total - 144.82 * 95.34) < 0.02);
  });

  it("updates a VRF that is already on the ledger instead of writing a second copy", () => {
    assert.equal(planLiquidationLedgerWrite(hold5795, reserve5795, 2), "update");
  });

  it("does not seed a draft, a closed VRF, or old workbook history", () => {
    const requested = {
      vrf: "5901",
      status: "Requested",
      held: true,
      src: "reserve-hold",
      reserve: "88",
      rows: [{ vrf: "5901", cat: "Fuel — Diesel", qty: 10, price: 50, total: 500, src: "reserve-hold" }],
    };
    const requestedReserve = { no: "88", vrfNo: "5901", status: "Requested", vrfs: [] };
    assert.equal(approvedVrfMayJoinLedger(requested, requestedReserve), false);
    assert.equal(planLiquidationLedgerWrite(requested, requestedReserve, 0), "refuse");

    const closed = { vrf: "5795", status: "Closed", liq: { at: "2026-09-22" }, rows: [{ vrf: "5795" }] };
    assert.equal(planLiquidationLedgerWrite(closed, reserve5795, 0), "refuse");

    const notBought = { vrf: "5830", status: "Not bought", liq: { at: "2026-09-25", outcome: "not-bought" } };
    assert.equal(planLiquidationLedgerWrite(notBought, { no: "30", vrfNo: "5830", status: "Cancelled" }, 0), "refuse");

    const legacy = { vrf: "1001", status: "Legacy", legacy: true, rows: [{ vrf: "1001" }] };
    assert.equal(planLiquidationLedgerWrite(legacy, null, 0), "refuse");
  });

  it("still allows an approved legacy number that the log shows as open", () => {
    const legacyOpen = { vrf: "5823", status: "Legacy", legacy: true, reserve: "23", rows: [{ vrf: "5823", total: 100 }] };
    const approved = { no: "23", vrfNo: "5823", status: "Approved", vrfs: ["5823"] };
    assert.equal(planLiquidationLedgerWrite(legacyOpen, approved, 0), "seed");
    const lines = closedLedgerLinesFromHold(legacyOpen, [{}], { at: "2026-09-27", by: "Yard", outcome: "bought" }, "2026-09-27");
    assert.equal(lines[0].vrf, "5823");
    assert.equal(lines[0].vstatus, "Closed");
  });
});

describe("artifact HTML — liquidate an approved hold onto the ledger", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("seeds the same VRF number and still blocks a VRF that is not approved", () => {
    assert.match(html, /function planLiquidationLedgerWrite/);
    assert.match(html, /function closedLedgerLinesFromHold/);
    assert.match(html, /function approvedVrfMayJoinLedger/);
    assert.match(html, /if\(plan==="seed"\)/);
    assert.match(html, /await appendLedger\(seedMonths\[si\], byMk\[seedMonths\[si\]\]\)/);
    assert.match(html, /if\(prePlan!=="seed"\)/);
    assert.match(html, /planNow==="refuse"/);
    assert.match(html, /is still waiting for approval, so it cannot be liquidated/);
    assert.doesNotMatch(html, /vrfNo\s*=\s*"5795"/);
    assert.match(html, /var BUILD = "2026-10-05 b"/);
  });
});
