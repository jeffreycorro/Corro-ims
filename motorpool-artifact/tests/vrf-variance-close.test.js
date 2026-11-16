"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const V = require("../public/vrf-liquidation");
const Approvers = require("../public/approvers");
const G = require("../netlify/lib/liquidation-guard");
const { canonicalVrfStatus, applyLiquidationLine } = require("./lib/rules");
const { mayPrint } = require("../public/fuel-audit");
const { variancePrintBlocked, VARIANCE_PRINT_MAX, liquidatedPrintBlock } = require("../public/liquidation-print");

const TODAY = "2026-11-16";
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const resolve = (name) => Approvers.resolveApprover(name);
const receipt = [{ kind: "photo", role: "liquidation", caption: "Official receipt" }];

function gate(actual, extra, approved) {
  return V.varianceCloseGate(
    Object.assign({ actual: actual, liquidationReceipts: 0, varianceExplanation: "" }, extra || {}),
    { approved: approved == null ? 1500 : approved }
  );
}

function proof(extra) {
  return Object.assign(
    {
      v: 1,
      actual: 1400,
      approved: 1500,
      date: TODAY,
      by: "Ana Cruz",
      varianceExplanation: "Supplier priced it lower than the request.",
      varianceAmount: -100,
      variancePending: true,
    },
    extra || {}
  );
}

function row(vstatus, liqExtra, lineExtra) {
  return Object.assign(
    {
      vrf: "7101",
      vstatus: vstatus,
      qty: 1,
      price: 1400,
      total: 1400,
      liq: Object.assign(
        { at: TODAY + "T08:00:00", by: "Ana Cruz", outcome: "bought", variancePending: true, varianceExplanation: "Supplier priced it lower than the request.", proof: proof() },
        liqExtra || {}
      ),
    },
    lineExtra || {}
  );
}

function io(opts) {
  return {
    readRecord: async (id) => (opts.records || {})[id] || null,
    listPhotoMeta: async (owner) => (opts.photos || {})[owner] || [],
    getDoc: async () => null,
  };
}

const pendingWrite = (liqExtra) => ({
  id: "ledger:7101",
  kind: "ledger",
  vrf_no: "7101",
  reserve_no: "9",
  data: { rows: [row(V.VARIANCE_PENDING_VSTATUS, liqExtra)] },
});

const closedWrite = (liqExtra) => ({
  id: "ledger:7101",
  kind: "ledger",
  vrf_no: "7101",
  reserve_no: "9",
  data: { rows: [row("Closed", liqExtra)] },
});

const reserve = { "reserve:9": { data: { vrfs: ["7101"], approvedBudget: 1500 } } };
const photos = { "liq-7101": receipt };

describe("variance close gate", () => {
  it("blocks a variance when no liquidation receipt is attached", () => {
    const blocked = gate(1400, { varianceExplanation: "The pump was on sale.", liquidationReceipts: 0 });
    assert.equal(blocked.variance, true);
    assert.equal(blocked.ok, false);
    assert.deepEqual(blocked.errors.map((e) => e.field), ["liquidationReceipt"]);
    const linkOnly = V.varianceCloseGate(
      { actual: 1600, varianceExplanation: "Price went up.", liquidationAttachments: [{ kind: "link", role: "liquidation" }] },
      { approved: 1500 }
    );
    assert.equal(linkOnly.ok, false);
    assert.equal(linkOnly.errors[0].field, "liquidationReceipt");
  });

  it("blocks a variance when the explanation is blank", () => {
    const blocked = gate(1600, { liquidationReceipts: 1, varianceExplanation: "   " });
    assert.equal(blocked.ok, false);
    assert.deepEqual(blocked.errors.map((e) => e.field), ["varianceExplanation"]);
  });

  it("allows a variance when a liquidation receipt and an explanation are both present", () => {
    const under = gate(1400, { liquidationReceipts: 1, varianceExplanation: "The pump was on sale." });
    assert.equal(under.ok, true);
    assert.equal(under.diff, -100);
    const over = gate(1600, { liquidationReceipts: 2, varianceExplanation: "Price went up at the supplier." });
    assert.equal(over.ok, true);
    assert.equal(over.diff, 100);
    const exact = gate(1500, { liquidationReceipts: 0, varianceExplanation: "" });
    assert.equal(exact.variance, false);
    assert.equal(exact.ok, true);
  });
});

describe("named approver and pending-to-closed", () => {
  it("rejects any name other than Jeffrey James M. Corro or Carmel, including a bare api", () => {
    const liq = () => ({ variancePending: true, varianceExplanation: "The pump was on sale.", proof: proof() });
    ["", "api", "API", "Noah", "Sophie"].forEach((name) => {
      const sample = liq();
      const result = V.approveSpendVariance(sample, name, TODAY + "T09:00:00", resolve);
      assert.equal(result.ok, false, name || "(blank)");
      assert.equal(sample.variancePending, true);
      assert.equal(sample.varianceApprovedBy, undefined);
    });
    const jeffrey = liq();
    const yes = V.approveSpendVariance(jeffrey, "Jeffrey Corro", TODAY + "T09:00:00", resolve);
    assert.equal(yes.ok, true);
    assert.equal(yes.name, "Jeffrey James M. Corro");
    assert.equal(jeffrey.varianceApprovedBy, "Jeffrey James M. Corro");
    assert.equal(jeffrey.varianceApprovedAt, TODAY + "T09:00:00");
    assert.equal(jeffrey.variancePending, false);
    assert.equal(jeffrey.proof.varianceApprovedBy, "Jeffrey James M. Corro");
    const carmel = liq();
    assert.equal(V.approveSpendVariance(carmel, "Carmel", TODAY + "T10:00:00", resolve).name, "Carmel");
  });

  it("stays pending until the named approver signs, then the ledger line is Closed", async () => {
    const stamp = { variancePending: true, at: TODAY, by: "Ana", outcome: "bought" };
    const pendingLine = applyLiquidationLine({ vrf: "7101", qty: 1, price: 1400, total: 1400, vstatus: "Open" }, {}, stamp, "bought");
    assert.equal(pendingLine.vstatus, "Variance pending");
    assert.equal(canonicalVrfStatus(pendingLine.vstatus, null, stamp, "7101").status, V.VARIANCE_PENDING_STATUS);
    assert.equal(V.varianceClosePending(stamp), true);
    assert.notEqual(canonicalVrfStatus(pendingLine.vstatus, null, stamp, "7101").status, "Closed");

    await assert.rejects(
      () => G.guardRecordWrite(pendingWrite({ varianceExplanation: "" , proof: proof({ varianceExplanation: "" }) }), io({ records: reserve, photos })),
      /why the amount spent differs/
    );
    await assert.rejects(
      () => G.guardRecordWrite(pendingWrite(), io({ records: reserve, photos: {} })),
      /Liquidation attachments/
    );
    await G.guardRecordWrite(pendingWrite(), io({ records: reserve, photos }));

    await assert.rejects(
      () => G.guardRecordWrite(closedWrite(), io({ records: reserve, photos })),
      /variance pending approval/
    );
    await assert.rejects(
      () => G.guardRecordWrite(
        closedWrite({ varianceApprovedBy: "api", varianceApprovedAt: TODAY + "T09:00:00", variancePending: false, proof: proof({ varianceApprovedBy: "api", varianceApprovedAt: TODAY + "T09:00:00", variancePending: false }) }),
        io({ records: reserve, photos })
      ),
      /cannot be "api"/
    );

    const liq = pendingWrite().data.rows[0].liq;
    const approved = V.approveSpendVariance(liq, "Jeffrey James M. Corro", TODAY + "T09:30:00", resolve);
    assert.equal(approved.ok, true);
    const closedRows = V.promoteVarianceRows([row(V.VARIANCE_PENDING_VSTATUS, liq)]);
    assert.equal(closedRows[0].vstatus, "Closed");
    assert.equal(V.varianceClosePending(liq), false);
    assert.equal(canonicalVrfStatus("Closed", null, liq, "7101").status, "Closed");
    const next = {
      id: "ledger:7101",
      kind: "ledger",
      vrf_no: "7101",
      reserve_no: "9",
      data: { rows: closedRows },
    };
    await G.guardRecordWrite(next, io({ records: Object.assign({ "ledger:7101": pendingWrite() }, reserve), photos }));
  });

  it("does not let a variance-pending VRF close its reserve, and an exact spend is unchanged", async () => {
    const reserveClose = { id: "reserve:9", kind: "reserve", data: { no: 9, status: "Closed", liquidatedAt: "x", vrfs: ["7101"] } };
    await assert.rejects(
      () => G.guardRecordWrite(reserveClose, io({ records: { "ledger:7101": pendingWrite() } })),
      /Liquidate the VRF/
    );
    const exact = {
      id: "ledger:7102",
      kind: "ledger",
      vrf_no: "7102",
      reserve_no: "8",
      data: {
        rows: [{
          vrf: "7102", vstatus: "Closed", qty: 1, price: 1500, total: 1500,
          liq: { at: "x", by: "Ana", outcome: "bought", proof: { v: 1, actual: 1500, approved: 1500, date: TODAY, by: "Ana" } },
        }],
      },
    };
    await G.guardRecordWrite(exact, io({
      records: { "reserve:8": { data: { vrfs: ["7102"], approvedBudget: 1500 } } },
      photos: { "LIQ-7102": [{ caption: "OR 1" }] },
    }));
  });
});

describe("liquidated print shows the variance", () => {
  it("prints the spent amount, the variance, the explanation, and the approver", () => {
    const lines = V.spendVariancePrintLines({
      approved: 1500,
      actual: 1400,
      liq: {
        varianceExplanation: "The pump was on sale.",
        varianceApprovedBy: "Jeffrey James M. Corro",
        varianceApprovedAt: TODAY + "T09:30:00",
        variancePending: false,
      },
    });
    assert.deepEqual(lines.lines, [
      "Actual spent ₱1,400.00",
      "Variance amount ₱-100.00",
      "Variance explanation: The pump was on sale.",
      "Variance approved by Jeffrey James M. Corro · " + TODAY + "T09:30:00",
    ]);
    assert.equal(lines.varianceAmount, -100);
    assert.equal(V.spendVariancePrintLines({ approved: 1500, actual: 1500, liq: { varianceExplanation: "n/a" } }), null);
    assert.match(html, /spendVariancePrintLines/);
    assert.match(html, /data-spend-variance/);
    assert.equal(variancePrintBlocked(1000, 1600), true);
    assert.equal(VARIANCE_PRINT_MAX, 0.5);
    assert.equal(liquidatedPrintBlock({ printBlocked: true, message: "Variance +60% needs Jeffrey's approval before the liquidated VRF can print", pct: 0.6 }, { block: false }).print, true);
    assert.deepEqual(mayPrint({ vrf: "1", status: "Requested" }), { ok: false, message: "Not approved — cannot print" });
  });

  it("flags the variance on the VRF log without treating a matching spend as one", () => {
    assert.equal(V.VARIANCE_PENDING_STATUS, "Liquidated \u2013 variance pending approval");
    assert.equal(V.vrfShowsSpendVariance({ status: "Open", liq: null }), false);
    assert.equal(V.vrfShowsSpendVariance({ status: V.VARIANCE_PENDING_STATUS, liq: { variancePending: true, varianceExplanation: "The pump was on sale." } }), true);
    assert.equal(V.vrfShowsSpendVariance({ status: "Closed", liq: { variancePending: false, varianceApprovedBy: "Carmel", varianceExplanation: "Price went up." } }), true);
    assert.match(html, /data-variance-chip/);
    assert.match(html, /variance — spent differs from approved/);
    assert.match(html, /data-variance-explanation/);
    assert.match(html, /closeBtn\.disabled=!hasName\|\|!pres\.ok/);
    assert.match(html, /var BUILD = "2026-11-16 b"/);
  });
});
