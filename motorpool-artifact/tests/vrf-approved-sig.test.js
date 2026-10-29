"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  classifyPreparedSigFilename,
  classifyApprovedSigFilename,
  vrfShowsApprovedSig,
  vrfApprovedSig,
  vrfPrintWatermark,
} = require("./lib/rules");

const SIG = "data:image/png;base64,JEFFREY";
const PREPARED = "data:image/png;base64,SOPHIE";

function line() {
  return { cat: "Belt", item: "Fan belt", qty: 1, price: 2500, total: 2500 };
}

describe("Approved By e-signature — when it prints", () => {
  it("stamps Jeffrey on an approved VRF, an API approval, and a past reprint", () => {
    const portal = {
      vrf: "5812",
      status: "Open",
      approvedBy: "Jeffrey",
      rows: [Object.assign({ preparedSig: PREPARED }, line())],
    };
    assert.equal(vrfPrintWatermark(portal), "APPROVED");
    assert.equal(vrfShowsApprovedSig(portal), true);
    assert.equal(vrfApprovedSig(portal, null, SIG), SIG);
    assert.equal(vrfApprovedSig(portal, null, SIG), SIG);
    assert.notEqual(vrfApprovedSig(portal, null, SIG), PREPARED);

    const api = { vrf: "5812", status: "Open", approvedBy: "api", approvedVia: "api" };
    assert.equal(vrfShowsApprovedSig(api), true);
    assert.equal(vrfApprovedSig(api, null, SIG), SIG);

    const named = { vrf: "5795", status: "Closed", approvedBy: "Jeffrey James M. Corro" };
    assert.equal(vrfShowsApprovedSig(named), true);

    const past = { vrf: "1001", status: "Legacy" };
    assert.equal(vrfShowsApprovedSig(past), true);
    assert.equal(vrfApprovedSig(past, null, SIG), SIG);

    const hold = { vrf: "5828", status: "Approved", held: true, approvedBy: "Jeffrey" };
    assert.equal(vrfShowsApprovedSig(hold), true);

    const policy = { vrf: "5830", status: "Open", approvedBy: "CEO policy" };
    assert.equal(vrfShowsApprovedSig(policy), true);

    const office = { vrf: "5840", status: "Open", approvedBy: "Office" };
    assert.equal(vrfShowsApprovedSig(office), true);
    assert.equal(vrfApprovedSig(office, null, SIG), SIG);
  });

  it("leaves Requested, Cancelled and Disapproved forms blank", () => {
    const requested = { vrf: "5901", status: "Requested", held: true, approvedBy: "Jeffrey", approvedVia: "api" };
    assert.equal(vrfPrintWatermark(requested), "FOR APPROVAL");
    assert.equal(vrfShowsApprovedSig(requested), false);
    assert.equal(vrfApprovedSig(requested, null, SIG), "");
    assert.equal(
      vrfApprovedSig(Object.assign({}, requested, { approvedSig: SIG }), null, SIG),
      ""
    );

    assert.equal(vrfShowsApprovedSig({ vrf: "5830", status: "Cancelled", approvedBy: "Jeffrey" }), false);
    assert.equal(vrfShowsApprovedSig({ vrf: "5831", status: "Disapproved", approvedBy: "Jeffrey" }), false);
    assert.equal(vrfShowsApprovedSig({ vrf: "5832", status: "Rejected", approvedBy: "Jeffrey" }), false);
    assert.equal(vrfShowsApprovedSig({ vrf: "5833", status: "Not bought" }), false);
    assert.equal(vrfShowsApprovedSig({ vrf: "5834", status: "Duplicate" }), false);
    assert.equal(vrfShowsApprovedSig(null), false);
    assert.equal(vrfApprovedSig({ vrf: "5901", status: "Requested" }, null, SIG), "");
  });

  it("does not treat a rejected or cancelled reserve as an approved reprint", () => {
    const indexed = { vrf: "5902", status: "Closed", held: true, reserve: "12" };
    assert.equal(vrfPrintWatermark(indexed), "APPROVED");
    assert.equal(vrfShowsApprovedSig(indexed, { no: "12", status: "Rejected", vrfNo: "5902" }), false);
    assert.equal(
      vrfApprovedSig(indexed, { no: "12", status: "Rejected", vrfNo: "5902" }, SIG),
      ""
    );
    const cancelled = { vrf: "5830", status: "Open" };
    const reserve = { no: "8", status: "Cancelled", vrfNo: "5830", cancelledAt: "2026-10-01" };
    assert.equal(vrfShowsApprovedSig(cancelled, reserve), false);
  });

  it("keeps a signature stored on the VRF, and does not use the prepared image", () => {
    const entry = {
      vrf: "5812",
      status: "Open",
      approvedBy: "api",
      approvedVia: "api",
      approvedSig: SIG,
      preparedSig: PREPARED,
    };
    assert.equal(vrfApprovedSig(entry, null, "data:image/png;base64,LIBRARY"), SIG);
  });
});

describe("Approved By e-signature filename", () => {
  it("accepts Jeffrey's names and refuses the prepared signatory", () => {
    assert.equal(classifyApprovedSigFilename("jeffrey.png"), "approved");
    assert.equal(classifyApprovedSigFilename("Jeffrey James M. Corro.png"), "approved");
    assert.equal(classifyApprovedSigFilename("ceo.jpg"), "approved");
    assert.equal(classifyApprovedSigFilename("Approved_By.png"), "approved");
    assert.equal(classifyApprovedSigFilename("signatory.png"), "approved");
    assert.equal(classifyApprovedSigFilename("sophie-batas.jpg"), "other");
    assert.equal(classifyApprovedSigFilename("Prepared_Purchased.png"), "other");
    assert.equal(classifyApprovedSigFilename("cristine-checked.png"), "other");
    assert.equal(classifyApprovedSigFilename("signature.png"), "other");
    assert.equal(classifyApprovedSigFilename(""), "other");
  });

  it("still keeps Jeffrey out of the Prepared/Purchased By slot", () => {
    assert.equal(classifyPreparedSigFilename("sophie-batas.jpg"), "prepared");
    assert.equal(classifyPreparedSigFilename("Prepared_Purchased.png"), "prepared");
    assert.equal(classifyPreparedSigFilename("jeffrey.png"), "other");
    assert.equal(classifyPreparedSigFilename("jeffrey-corro.jpg"), "other");
    assert.equal(classifyPreparedSigFilename("ceo.png"), "other");
    assert.equal(classifyPreparedSigFilename("Approved_By.png"), "other");
    assert.equal(classifyPreparedSigFilename("signature.png"), "prepared");
  });
});

describe("seeded signature file and print markup", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const png = fs.readFileSync(path.join(__dirname, "../public/signatures/jeffrey.png"));

  it("ships a transparent PNG named for the Approved By slot", () => {
    assert.equal(png.slice(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png[25], 6);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.ok(width > height * 4, "wide signature strip");
    assert.match(html, /\/signatures\/jeffrey\.png/);
    assert.match(html, /title:"jeffrey\.png"/);
    assert.match(html, /Jeffrey James M\. Corro/);
  });

  it("stamps Approved By from the library and still stamps Prepared by", () => {
    assert.match(html, /function classifyApprovedSigFilename/);
    assert.match(html, /function vrfShowsApprovedSig/);
    assert.match(html, /function vrfApprovedSig/);
    assert.match(html, /function libraryApprovedSig/);
    assert.match(html, /function ensureApprovedEsig/);
    assert.match(html, /x\.cap==="Prepared\/Purchased By"\) slotSrc=preparedSrc/);
    assert.match(html, /x\.cap==="Approved By"\) slotSrc=approvedSrc/);
    assert.match(html, /function classifyPreparedSigFilename/);
    assert.match(html, /var other=\["jeffrey","approved by","cristine"/);
    assert.match(html, /var BUILD = "2026-10-29 c"/);
    assert.doesNotMatch(html, /img\.sig\{display:block;max-height:34px/);
  });
});
