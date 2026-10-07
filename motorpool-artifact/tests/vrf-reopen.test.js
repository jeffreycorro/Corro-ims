"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  applyLiquidationLine,
  applyReserveReopen,
  canonicalVrfStatus,
  holdIsSealed,
  liquidationNewTotal,
  mergeLedgerRows,
  planLiquidationLedgerWrite,
  recloseAmountAudit,
  reopenClosedLedgerRow,
  reserveNeedsReopen,
  shouldRemintHeldVrf,
  vrfCanLiquidate,
} = require("./lib/rules");

/* VRF 5890 as staff reported it: fuel purchase already liquidated at 200. */
function closed5890() {
  return {
    vrf: "5890",
    date: "2026-09-28",
    month: "2026-09",
    veh: "MC-21",
    cat: "Fuel — Gasoline",
    item: "Fuel purchase (station)",
    qty: 1,
    price: 200,
    total: 200,
    reserve: "56",
    vstatus: "Closed",
    liq: { at: "2026-10-01", by: "Brinneshiel", note: "", outcome: "bought" },
    audit: [],
  };
}

const reserve56 = () => ({
  no: "56",
  vrfNo: "5890",
  status: "Closed",
  vrfs: ["5890"],
  liquidatedAt: "2026-10-01",
  actual: 200,
  approvedBudget: 200,
  audit: [],
});

describe("reopen a liquidated VRF without a new number or a second ledger row", () => {
  it("clears the liquidation stamp and keeps the closed amount on the same VRF", () => {
    const row = closed5890();
    const next = reopenClosedLedgerRow(row, "Brinneshiel", "2026-10-02", 200, row.liq);
    assert.equal(next.vrf, "5890");
    assert.equal(next.vstatus, "Open");
    assert.equal(next.qty, 1);
    assert.equal(next.price, 200);
    assert.equal(next.total, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(next, "liq"), false);
    assert.equal(next.audit.length, 1);
    assert.equal(next.audit[0].field, "reopen");
    assert.equal(next.audit[0].by, "Brinneshiel");
    assert.equal(next.audit[0].at, "2026-10-02");
    assert.equal(next.audit[0].from, "200.00");
    assert.equal(next.audit[0].to, "awaiting liquidation");
    assert.match(next.audit[0].note, /2026-10-01/);
    assert.match(next.audit[0].note, /Brinneshiel/);
    assert.equal(canonicalVrfStatus(next.vstatus, null, next.liq, "5890").status, "Open");
    assert.equal(
      vrfCanLiquidate({ vrf: "5890", status: "Open", liq: null, rows: [next] }, { no: "56", status: "Approved", vrfNo: "5890" }),
      true
    );
    assert.equal(row.vstatus, "Closed");
    assert.ok(row.liq);
  });

  it("replaces the closed ledger row instead of adding a second one", () => {
    const other = { vrf: "5888", veh: "MC-01", total: 50, vstatus: "Open" };
    const closed = closed5890();
    const opened = reopenClosedLedgerRow(closed, "Brinneshiel", "2026-10-02", 200, closed.liq);
    const month = mergeLedgerRows([other, closed], "5890", [opened], "replace");
    const mine = month.filter((row) => row && row.vrf === "5890");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].vstatus, "Open");
    assert.equal(mine[0].total, 200);
    assert.equal(month.filter((row) => row && row.vrf === "5888").length, 1);
    assert.equal(planLiquidationLedgerWrite({ vrf: "5890", status: "Open", rows: mine }, reserve56(), mine.length), "update");
  });

  it("records old versus new amount when the reopened VRF is closed again", () => {
    const opened = reopenClosedLedgerRow(closed5890(), "Brinneshiel", "2026-10-02", 200, closed5890().liq);
    const edited = applyLiquidationLine(opened, { price: 150 }, { at: "2026-10-02", by: "Brinneshiel", outcome: "bought" }, "bought");
    assert.equal(edited.vrf, "5890");
    assert.equal(edited.vstatus, "Closed");
    assert.equal(edited.total, 150);
    const again = mergeLedgerRows([opened], "5890", [edited], "replace");
    assert.equal(again.filter((row) => row.vrf === "5890").length, 1);
    const note = recloseAmountAudit([opened], null, 150, "Brinneshiel", "2026-10-02");
    assert.equal(note.field, "amount");
    assert.equal(note.from, "200.00");
    assert.equal(note.to, "150.00");
    assert.equal(note.by, "Brinneshiel");
    assert.match(note.note, /Reopened by Brinneshiel on 2026-10-02/);
    assert.equal(recloseAmountAudit([closed5890()], null, 150, "Brinneshiel", "2026-10-02"), null);
    const entry = { rows: [{ qty: 1, price: 200, total: 200 }] };
    assert.equal(liquidationNewTotal(entry, [{ price: 150 }], [], "bought"), 150);
  });

  it("puts the reserve back to awaiting liquidation without minting a new VRF number", () => {
    const reserve = reserve56();
    assert.equal(reserveNeedsReopen(reserve), true);
    assert.equal(applyReserveReopen(reserve, "Brinneshiel", "2026-10-02", 200, { at: "2026-10-01", by: "Brinneshiel" }), true);
    assert.equal(reserve.status, "Approved");
    assert.equal(reserve.liquidatedAt, "");
    assert.equal(reserve.actual, null);
    assert.equal(reserve.vrfNo, "5890");
    assert.deepEqual(reserve.vrfs, ["5890"]);
    assert.equal(reserve.approvedBudget, 200);
    assert.equal(holdIsSealed(reserve), true);
    assert.equal(shouldRemintHeldVrf(reserve, [{ vrf: "5890", src: "ledger" }], [reserve]), false);
    assert.equal(reserveNeedsReopen({ no: "30", status: "Cancelled", cancelledAt: "2026-10-01", vrfNo: "5830" }), false);
  });
});

describe("artifact HTML — Reopen returns a liquidated VRF to the liquidation form", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("clears liq, asks for a name, and does not pretend a no-op succeeded", () => {
    assert.match(html, /function reopenClosedLedgerRow/);
    assert.match(html, /async function reopenLiquidatedVrf/);
    assert.match(html, /delete next\.liq/);
    assert.match(html, /Put your name on the reopen\. Nothing was changed\./);
    assert.match(html, /function recloseAmountAudit/);
    assert.match(html, /stampRecloseAudit\(byUp/);
    assert.doesNotMatch(html, /Object\.assign\(\{\}, r, \{vstatus:"Open", vrf:no\}\)/);
    assert.match(html, /var BUILD = "2026-10-07 a"/);
  });
});
