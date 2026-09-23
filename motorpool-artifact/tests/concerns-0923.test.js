"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  parseOdo,
  reserveMeter,
  vrfMeter,
  canonicalVrfStatus,
  vrfAwaitingApproval,
  vrfCanLiquidate,
  vrfPrintWatermark,
  classifyPreparedSigFilename,
  photoOwnersForOpenVrf,
} = require("./lib/rules");
const { holdOdo } = require("../netlify/lib/approve-from-hold");

describe("9/23 — odometer stays on the VRF that was filled", () => {
  it("parses a typed meter and does not treat another VRF's reading as this one", () => {
    assert.equal(parseOdo("12,345"), 12345);
    assert.equal(parseOdo(""), null);
    assert.equal(parseOdo("NF"), null);
    const a = { no: "41", vrfNo: "5841", draftOdo: "111,000", status: "Requested" };
    const b = { no: "42", vrfNo: "5842", odoAtRequest: 222000, draftOdo: "", status: "Approved" };
    assert.equal(reserveMeter(a), 111000);
    assert.equal(reserveMeter(b), 222000);
    assert.equal(vrfMeter({ vrf: "5841", reserve: "41", rows: [{}] }, a), 111000);
    assert.equal(vrfMeter({ vrf: "5842", reserve: "42", rows: [{ odo: null }] }, b), 222000);
    assert.equal(vrfMeter({ vrf: "5843", reserve: "41", rows: [] }, b), null);
    assert.equal(vrfMeter({ vrf: "5841", rows: [{ odo: 111000 }] }, b), 111000);
  });

  it("reads draftOdo, then the older odoAtRequest field, on the approval post", () => {
    assert.equal(holdOdo({ draftOdo: "45,210" }), 45210);
    assert.equal(holdOdo({ draftOdo: "", odoAtRequest: 88001 }), 88001);
    assert.equal(holdOdo({ draftOdo: "0" }), 0);
  });
});

describe("9/23 — Liquidate only for approved, not-yet-closed VRFs", () => {
  const approved = { no: "12", vrfNo: "5795", status: "Approved", vrfs: ["5795"] };

  it("shows Liquidate for an approved hold and for a drifted Open status", () => {
    const hold = { vrf: "5795", held: true, status: "Open", reserve: "12", src: "reserve-hold" };
    assert.equal(vrfAwaitingApproval(hold, approved), false);
    assert.equal(vrfCanLiquidate(hold, approved), true);
    assert.equal(vrfPrintWatermark(hold), "APPROVED");
    assert.equal(vrfCanLiquidate({ vrf: "5798", status: "Approved", reserve: "12" }, approved), true);
    assert.equal(
      vrfCanLiquidate({ vrf: "5802", status: "Open — awaiting liquidation" }, { no: "8", status: "Approved", vrfNo: "5802" }),
      true
    );
    assert.equal(
      canonicalVrfStatus("", { status: "Approved", vrfNo: "5823" }, null, "5823").status,
      "Open"
    );
    assert.equal(
      vrfCanLiquidate({ vrf: "5823", status: "Legacy", legacy: true }, { no: "23", status: "Approved", vrfNo: "5823" }),
      true
    );
  });

  it("does not offer Liquidate for a hold still FOR APPROVAL, a closed VRF, or old workbook history", () => {
    const requested = { vrf: "5901", held: true, status: "Requested", reserve: "88" };
    assert.equal(vrfAwaitingApproval(requested, { no: "88", status: "Requested", vrfNo: "5901" }), true);
    assert.equal(vrfCanLiquidate(requested, { no: "88", status: "Requested", vrfNo: "5901" }), false);
    assert.equal(vrfPrintWatermark(requested), "FOR APPROVAL");
    assert.equal(vrfPrintWatermark({ vrf: "5901", src: "reserve-hold", status: "Requested" }), "FOR APPROVAL");
    assert.equal(vrfCanLiquidate({ vrf: "5795", status: "Closed", liq: { at: "2026-09-22" } }, approved), false);
    assert.equal(vrfCanLiquidate({ vrf: "1001", status: "Legacy", legacy: true }, null), false);
    assert.equal(canonicalVrfStatus("", { status: "Approved", vrfNo: "5795" }, null, "1001").status, "Legacy");
    assert.equal(vrfPrintWatermark({ vrf: "5828", status: "Open" }), "APPROVED");
  });

  it("does not pull a sibling VRF's photos onto an approved hold", () => {
    const approvedHold = { vrf: "5795", reserve: "3", held: true, status: "Open" };
    const reserve = { no: "3", vrfNo: "5795", status: "Approved", vrfs: ["5795", "5794"] };
    assert.deepEqual(photoOwnersForOpenVrf(approvedHold, reserve), ["5795"]);
    const waiting = { vrf: "5901", reserve: "88", held: true, status: "Requested" };
    assert.deepEqual(
      photoOwnersForOpenVrf(waiting, { no: "88", vrfNo: "5901", status: "Requested", vrfs: [] }),
      ["5901", "RSV-88"]
    );
  });
});

describe("9/23 — Prepared/Purchased By e-signature filename", () => {
  it("accepts the prepared slot names and refuses the other signatories", () => {
    assert.equal(classifyPreparedSigFilename("sophie-batas.jpg"), "prepared");
    assert.equal(classifyPreparedSigFilename("Prepared_Purchased.png"), "prepared");
    assert.equal(classifyPreparedSigFilename("Sophie V. Batas.jpeg"), "prepared");
    assert.equal(classifyPreparedSigFilename("jeffrey-corro.jpg"), "other");
    assert.equal(classifyPreparedSigFilename("cristine-checked.png"), "other");
    assert.equal(classifyPreparedSigFilename("signature.png"), "prepared");
  });
});

describe("artifact HTML — 9/23 concern fixes", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("persists the meter, gates Liquidate, and offers the prepared e-signature", () => {
    assert.match(html, /function parseOdo/);
    assert.match(html, /function vrfOdo/);
    assert.match(html, /function vrfCanLiquidate/);
    assert.match(html, /function vrfAwaitingApproval/);
    assert.match(html, /function classifyPreparedSigFilename/);
    assert.match(html, /odo:meter/);
    assert.match(html, /odoAtRequest:parseOdo\(d\.odo\)/);
    assert.match(html, /var waiting=vrfAwaitingApproval\(entry\)/);
    assert.match(html, /if\(!waiting\) tabDefs\.push\(\["liq"/);
    assert.match(html, /Prepared\/Purchased By e-signature/);
    assert.match(html, /Apply on this VRF/);
    assert.match(html, /config\/esigs/);
    assert.match(html, /var BUILD = "2026-09-23 b"/);
    assert.doesNotMatch(html, /if\(entry\.held\|\|entry\.status==="Requested"\)/);
  });
});
