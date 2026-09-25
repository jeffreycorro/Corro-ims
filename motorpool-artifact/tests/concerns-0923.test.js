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
  cropSignaturePixels,
  VRF_SIG_PRINT_H,
  VRF_SIG_PRINT_W,
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

describe("VRF prepared e-sig print — size and transparency", () => {
  function px(w, h, paint) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    paint(data, w, h);
    return data;
  }
  function set(data, w, x, y, r, g, b, a) {
    const i = (y * w + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }

  it("knocks paper-white out to alpha and crops to the ink", () => {
    const w = 40;
    const h = 20;
    const data = px(w, h, (buf) => {
      set(buf, w, 0, 0, 0, 0, 0, 0);
      set(buf, w, 30, 8, 20, 20, 20, 255);
      set(buf, w, 32, 10, 20, 20, 20, 255);
    });
    const cropped = cropSignaturePixels(data, w, h, 6);
    assert.ok(cropped.width < w, "wide white margin is cropped");
    assert.ok(cropped.height < h);
    assert.equal(data[(8 * w + 30) * 4 + 3], 255);
    let opaque = 0;
    let clear = 0;
    for (let i = 3; i < cropped.data.length; i += 4) {
      if (cropped.data[i] === 0) clear++;
      else opaque++;
    }
    assert.equal(opaque, 2);
    assert.ok(clear > 0, "padding around the ink stays transparent");
    assert.equal(VRF_SIG_PRINT_H, 56);
    assert.equal(VRF_SIG_PRINT_W, 180);
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
    assert.match(html, /function shrinkSignature/);
    assert.match(html, /function trimSignatureDataUrl/);
    assert.match(html, /function signatureToPng/);
    assert.match(html, /function knockOutSignaturePixels/);
    assert.match(html, /function cropSignaturePixels/);
    assert.match(html, /mix-blend-mode:multiply/);
    assert.match(html, /height:56px;max-height:56px;max-width:180px/);
    assert.doesNotMatch(html, /img\.sig\{display:block;max-height:34px/);
    assert.match(html, /shrinkSignature\(file\)/);
    assert.match(html, /LTO Registration\/Renewal\/Name Change/);
    assert.match(html, /function renameLtoJobLabel/);
    assert.match(html, /var BUILD = "2026-09-25 a"/);
    assert.doesNotMatch(html, /if\(entry\.held\|\|entry\.status==="Requested"\)/);
  });
});
