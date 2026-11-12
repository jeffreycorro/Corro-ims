"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const issue = fs.readFileSync(path.join(__dirname, "../netlify/lib/vrf-issue.js"), "utf8");

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  if (start < 0 || end < 0) throw new Error("missing " + startNeedle);
  return src.slice(start, end);
}

function loadHelpers() {
  const src = sliceBetween(html, "function liquidationPhotoOwner", "async function listPhotos");
  const sandbox = {
    IMAGE_EXT: /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i,
    VIDEO_MAX_BYTES: 3 * 1024 * 1024,
  };
  vm.runInNewContext(src, sandbox);
  return sandbox;
}

describe("liquidation attachments stay off the request list", () => {
  const api = loadHelpers();

  it("is build 2026-11-12 a and does not move the write floor", () => {
    assert.match(html, /var BUILD = "2026-11-12 a"/);
    assert.match(issue, /const MIN_WRITE_BUILD = "2026-10-06 a"/);
  });

  it("keys liquidation files to their own owner and tags them", () => {
    assert.equal(api.liquidationPhotoOwner("5887"), "liq-5887");
    assert.equal(api.liquidationPhotoOwner({ vrf: " 5887 " }), "liq-5887");
    assert.equal(api.liquidationPhotoOwner(null), "");
    assert.equal(api.isLiquidationAttachment({ vrf: "5887", role: "fuel-gauge" }), false);
    assert.equal(api.isLiquidationAttachment({ vrf: "liq-5887", caption: "receipt" }), true);
    assert.equal(api.isLiquidationAttachment({ vrf: "5887", role: "liquidation" }), true);
    assert.equal(api.isLiquidationAttachment({ vrf: "5887", fuelRole: "liquidation" }), true);
    assert.equal(api.isLiquidationAttachment(null), false);

    const split = api.splitVrfAttachments([
      { id: "req", vrf: "5887", kind: "photo", caption: "gauge" },
      { id: "liq", vrf: "liq-5887", kind: "photo", caption: "official receipt" },
      { id: "pdf", vrf: "liq-5887", kind: "doc", mime: "application/pdf" },
      null,
    ]);
    assert.equal(split.request.map((x) => x.id).join(","), "req");
    assert.equal(split.liquidation.map((x) => x.id).join(","), "liq,pdf");
  });

  it("accepts the same photos as a VRF attachment, plus a PDF", () => {
    assert.equal(api.liquidationFileKind({ type: "image/jpeg", name: "a.jpg" }), "photo");
    assert.equal(api.liquidationFileKind({ type: "", name: "shot.HEIC" }), "photo");
    assert.equal(api.liquidationFileKind({ type: "application/pdf", name: "or.pdf" }), "pdf");
    assert.equal(api.liquidationFileKind({ type: "", name: "scan.PDF" }), "pdf");
    assert.equal(api.liquidationFileKind({ type: "video/mp4", name: "clip.mp4" }), "");
    assert.equal(api.liquidationFileTooLarge({ type: "application/pdf", name: "a.pdf", size: 1024 }), "");
    assert.match(
      api.liquidationFileTooLarge({ type: "application/pdf", name: "big.pdf", size: 8 * 1024 * 1024 }),
      /8 MB/
    );
    assert.equal(api.isDocAttachment({ kind: "doc", mime: "application/pdf" }), true);
    assert.equal(api.isDocAttachment({ kind: "photo", mime: "image/jpeg", data: "data:image/jpeg;base64,QQ==" }), false);
    assert.equal(api.isDocAttachment({ kind: "link", url: "https://example.com/a.pdf" }), false);
  });
});

describe("liquidation attachment UI", () => {
  it("puts the button on the liquidation section and stores that upload apart from the request", () => {
    const ui = sliceBetween(html, "function appendLiquidationAttachments", "async function bumpPhotoCount");
    assert.match(ui, /el\("button","btn","Liquidation attachments"\)/);
    assert.match(ui, /data-liquidation-attachments/);
    assert.match(ui, /accept="image\/\*,application\/pdf,\.pdf"/);
    assert.match(ui, /addPhoto\(owner,/);
    assert.match(ui, /role:"liquidation"/);
    assert.match(ui, /addLink\(owner,/);
    assert.doesNotMatch(ui, /rememberFuelPhotoFlags|photoOwnersForOpenVrf/);

    const open = sliceBetween(html, "function openVrf(entry,tab)", "function blankLine()");
    assert.equal((open.match(/appendLiquidationAttachments\(body, entry\)/g) || []).length, 2);
    assert.match(open, /data-liquidation-attachments-view/);
    assert.match(open, /mountLazyGallery\(lazyGal, photoOwnersForOpenVrf\(entry\)/);
    assert.match(open, /mountLazyGallery\(lazyLiqGal, \[liquidationPhotoOwner\(entry\)\]/);
    const photos = sliceBetween(open, 'var note=el("div","hint","Receipts', "if(!waiting){");
    assert.match(photos, /fi\.accept="image\/\*"/);
    assert.match(photos, /addPhoto\(String\(entry\.vrf\)/);
    assert.doesNotMatch(photos, /role:"liquidation"|liquidationPhotoOwner/);

    const owners = sliceBetween(html, "function photoOwnersForOpenVrf(entry)", "return owners.filter");
    assert.doesNotMatch(owners, /liq-|liquidationPhotoOwner/);
  });

  it("labels liquidation files on the log and on print without changing the proof gate", () => {
    assert.match(html, /function vrfAttachmentChips/);
    assert.match(html, /Liquidation "\+liqN/);
    const log = sliceBetween(html, "function vrfLogView()", "function partsView()");
    assert.match(log, /vrfAttachmentChips\(v\)/);
    assert.doesNotMatch(log, /photoCount\(liquidationPhotoOwner/);

    const doc = sliceBetween(html, "function buildVrfDoc(entry,photos,opts)", "var VRFDOC_CSS");
    assert.match(doc, /splitVrfAttachments\(photos\)/);
    assert.match(doc, /appendAttachmentPages\(grouped\.request, "Attachments", "Linked files"\)/);
    assert.match(doc, /appendAttachmentPages\(grouped\.request, "Request attachments", "Request links"\)/);
    assert.match(doc, /appendAttachmentPages\(grouped\.liquidation, "Liquidation attachments", "Liquidation links"\)/);
    assert.match(doc, /PDF attached/);
    assert.match(doc, /data-photo-id/);

    const gate = sliceBetween(html, "async function liquidatedPrintGate", "async function vrfPrintModel");
    assert.match(gate, /photoOwnersForOpenVrf\(entry\)/);
    assert.doesNotMatch(gate, /liquidationPhotoOwner/);

    const print = sliceBetween(html, "function pullPrintPhoto(x, page, onDone)", "function lightbox(src)");
    assert.match(print, /listPhotoMetaMany\(photoOwnersForOpenVrf\(entry\)\)/);
    assert.match(print, /listPhotoMetaMany\(\[owner\]\)/);
    assert.match(print, /loadPrintAttachmentList\(\)/);
  });
});
