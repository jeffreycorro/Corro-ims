"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildEntries, summarize, ledgerStatus } = require("../scripts/liquidation-dry-run");

describe("liquidation dry-run count", () => {
  it("reads ledger vstatus (blank = old workbook) and lets the reserve win", () => {
    assert.equal(ledgerStatus([{}, { vstatus: "" }]), "Legacy");
    assert.equal(ledgerStatus([{ vstatus: "Closed" }, { vstatus: "Open" }]), "Open");
    const entries = buildEntries({
      ledger: [
        { id: "ledger:1", vrf: "1", rows: [{ total: 10 }] },
        { id: "ledger:2", vrf: "2", rows: [{ total: 50, vstatus: "Closed", liq: { at: "2026-09-02", by: "B" } }] },
        { id: "ledger:3", vrf: "3", rows: [{ total: 20, vstatus: "Cancelled", liq: { at: "2026-09-02", outcome: "cancelled" } }] },
      ],
      reserves: [
        { no: "9", vrfNo: "4", status: "Approved", approvedBudget: 100, approvedAt: "2026-10-30", requestedBy: "A", veh: "X" },
        { no: "10", vrfNo: "", status: "Requested" },
      ],
    });
    const s = summarize(entries, {}, "2026-11-01");
    assert.deepEqual(s.counts, { Unliquidated: 1, "Partially liquidated": 1, Liquidated: 0, "Liquidated (legacy)": 1, Excluded: 1 });
    assert.equal(s.unliquidatedView.count, 2);
    assert.equal(s.unliquidatedView.overdue, 1); // VRF 2 has no date, so it cannot be dated overdue
    assert.equal(s.ledgerLines.withStatus, 2);
    assert.equal(s.liquidatedBy.B, 1);
  });
});
