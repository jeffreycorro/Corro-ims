"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalVrfStatus,
  vrfAwaitingApproval,
  vrfPrintWatermark,
  vrfPreviewUnapproved,
  vrfCanLiquidate,
} = require("./lib/rules");
const audit = require("../public/fuel-audit");
const { ledgerIsOnlyStaleHold } = require("../netlify/lib/supabase");

const approved = { no: "346", status: "Approved", vrfNo: "6360", vrfs: [], approvedBy: "Jeffrey", approvedAt: "2026-11-13T12:55:37+08:00" };
const closed = { no: "12", status: "Closed", vrfNo: "6360", vrfs: ["6360"] };
const flagged = { no: "12", status: "Flagged", vrfNo: "6360", vrfs: ["6360"] };
const requested = { no: "346", status: "Requested", vrfNo: "6360", vrfs: [] };
const cancelled = { no: "346", status: "Cancelled", vrfNo: "6360", cancelledAt: "2026-11-13T13:00:00+08:00" };

describe("stale Requested reserve-hold does not override an approved reserve", () => {
  it("treats Requested as Open when the reserve is Approved, Closed, or Flagged", () => {
    assert.equal(canonicalVrfStatus("Requested", approved, null, "6360").status, "Open");
    assert.equal(canonicalVrfStatus("For approval", closed, null, "6360").status, "Open");
    assert.equal(canonicalVrfStatus("Sent for approval", flagged, null, "6360").status, "Open");
    assert.equal(vrfAwaitingApproval({ vrf: "6360", status: "Requested", src: "reserve-hold" }, approved), false);
    assert.equal(vrfCanLiquidate({ vrf: "6360", status: "Requested", src: "reserve-hold" }, approved), true);
    assert.equal(
      vrfPrintWatermark({ vrf: "6360", status: "Requested", src: "reserve-hold", reserveStatus: "Approved" }),
      "APPROVED"
    );
    assert.equal(
      vrfPreviewUnapproved({ vrf: "6360", status: "Requested", src: "reserve-hold", held: true, reserveStatus: "Approved" }),
      false
    );
  });

  it("still blocks a Requested hold whose reserve is not approved", () => {
    assert.equal(canonicalVrfStatus("Requested", requested, null, "6360").status, "Requested");
    assert.equal(canonicalVrfStatus("Requested", null, null, "6360").status, "Requested");
    assert.equal(vrfAwaitingApproval({ vrf: "6360", status: "Requested", src: "reserve-hold" }, requested), true);
    assert.equal(vrfPrintWatermark({ vrf: "6360", status: "Requested", src: "reserve-hold" }), "FOR APPROVAL");
    assert.equal(audit.mayPrint({ vrf: "6360", status: "Requested", held: true, src: "reserve-hold" }).ok, false);
  });

  it("does not upgrade a cancelled reserve or a Not bought / Cancelled line", () => {
    assert.equal(canonicalVrfStatus("Requested", cancelled, null, "6360").status, "Requested");
    assert.equal(canonicalVrfStatus("Not bought", approved, null, "6360").status, "Not bought");
    assert.equal(canonicalVrfStatus("Cancelled", approved, null, "6360").status, "Cancelled");
    assert.equal(vrfAwaitingApproval({ vrf: "6360", status: "Not bought" }, approved), false);
    assert.equal(vrfPrintWatermark({ vrf: "5830", status: "Not bought" }), "NOT BOUGHT");
    assert.equal(vrfPrintWatermark({ vrf: "5830", status: "Cancelled" }), "CANCELLED");
  });

  it("lets FuelAudit print an approved reserve even when the line still says Requested", () => {
    const held = { vrf: "6360", status: "Requested", held: true, src: "reserve-hold", reserveStatus: "Approved" };
    assert.equal(audit.mayPrint(held).ok, true);
    assert.equal(audit.mayPrint(Object.assign({}, held, { reserveStatus: "Closed" })).ok, true);
    assert.equal(audit.mayPrint(Object.assign({}, held, { reserveStatus: "Flagged" })).ok, true);
    assert.equal(audit.mayPrint(Object.assign({}, held, { reserveStatus: "Cancelled" })).ok, false);
    assert.equal(audit.mayPrint({ vrf: "5901", status: "Cancelled", held: true, src: "reserve-hold" }).ok, false);
    assert.equal(audit.mayPrint({ vrf: "5812", status: "Cancelled", approvedAt: "2026-10-02", src: "ledger" }).ok, true);
    assert.equal(audit.mayPrint({ vrf: "5833", status: "Not bought", src: "ledger" }).ok, true);
    assert.equal(audit.mayPrint({ vrf: "5901", status: "Rejected" }).ok, false);
  });

  it("treats only a Requested reserve-hold as replaceable ledger lines", () => {
    assert.equal(ledgerIsOnlyStaleHold([{ vrf: "6360", vstatus: "Requested", src: "reserve-hold" }]), true);
    assert.equal(ledgerIsOnlyStaleHold([{ vrf: "6360", vstatus: "For approval" }]), true);
    assert.equal(ledgerIsOnlyStaleHold([{ vrf: "6360", vstatus: "Open", src: "reserve-hold" }]), true);
    assert.equal(ledgerIsOnlyStaleHold([{ vrf: "6360", vstatus: "Open" }]), false);
    assert.equal(ledgerIsOnlyStaleHold([{ vrf: "6360", vstatus: "Closed" }]), false);
    assert.equal(
      ledgerIsOnlyStaleHold([
        { vrf: "6360", vstatus: "Requested", src: "reserve-hold" },
        { vrf: "6360", vstatus: "Open" },
      ]),
      false
    );
    assert.equal(ledgerIsOnlyStaleHold([]), false);
  });
});
