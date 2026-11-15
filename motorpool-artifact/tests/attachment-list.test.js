"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { withTimeout } = require("../public/photo-batch");
const audit = require("../public/fuel-audit");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");

function sliceFn(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start + startMark.length);
  assert.ok(start > 0 && end > start, startMark);
  return source.slice(start, end);
}

describe("attachment list timeout", () => {
  it("rejects a hung list and keeps a list that arrives", async () => {
    const hung = await withTimeout(new Promise(function () {}), 30).then(
      function () { return null; },
      function (err) { return err; }
    );
    assert.equal(hung && hung.code, "timeout");
    assert.equal(await withTimeout(Promise.resolve("vrf-6148__1"), 200), "vrf-6148__1");
  });

  it("caps name lookups at three, times out at eight seconds, and aborts the call", () => {
    assert.match(html, /var PHOTO_META_LIMIT=3/);
    assert.match(html, /var PHOTO_LIST_MS=8000/);
    assert.match(html, /var PHOTO_FETCH_LIMIT=2/);
    const meta = sliceFn(html, "async function listPhotoMeta(owner, opts)", "async function listPhotoMetaMany(");
    assert.match(meta, /runPhotoMeta\(/);
    assert.match(meta, /callWithTimeout\(call, PHOTO_LIST_MS\)/);
    assert.match(meta, /AbortController/);
    assert.match(meta, /ctrl\.abort\(\)/);
    assert.match(meta, /photoMetaCache\[owner\]/);
    assert.doesNotMatch(meta, /listPhotos\(/);
    assert.match(shim, /photoMeta:\s*function \(owner, callOpts\)/);
    assert.match(shim, /dbCall\("photoMeta", \{ owner: String\(owner \|\| ""\) \}, callOpts \|\| \{\}\)/);
  });
});

describe("the log does not ask for every fuel VRF at once", () => {
  it("waits until the gauge chip is on screen", () => {
    const chip = sliceFn(html, "function missingPhotosChip(entry)", "function vrfPrintGate(entry)");
    const visible = chip.indexOf("whenVisible(node, function()");
    const fetchAt = chip.indexOf("listPhotoMetaMany(photoOwnersForOpenVrf(entry))");
    assert.ok(visible > 0 && fetchAt > visible);
    assert.match(chip, /must\s+not start a request/);
  });
});

describe("print names and pictures are separate", () => {
  it("retries the name list once and does not fail it when a picture is slow", () => {
    const print = sliceFn(html, "function placePrintRemote(x, page, url)", "function lightbox(src)");
    assert.match(print, /function loadPictures\(\)/);
    assert.match(print, /loadPictures\(\);/);
    assert.doesNotMatch(print, /return loadPictures\(\)/);
    assert.match(print, /if\(attempt>=2\) throw err/);
    assert.match(print, /return once\(\)/);
    assert.match(print, /The attachment list did not load/);
    assert.match(print, /Retry pictures/);
    assert.match(print, /photoFileUrl\(x\.id,"print"\)/);
    assert.match(print, /runPhotoJob\(function\(\)\{ return placePrintRemote/);
    assert.match(print, /PHOTO_GET_MS/);
    assert.doesNotMatch(print, /loadPhotoDocs\(files, "print"\)/);
    assert.match(print, /\{first:true\}/);
  });

  it("is build 2026-11-14 a", () => {
    assert.match(html, /var BUILD = "2026-11-14 a"/);
  });
});

describe("print gates stay as they are", () => {
  it("still refuses a request that is not approved, and lets an approved reserve through", () => {
    assert.equal(audit.mayPrint({ vrf: "6148", status: "Requested" }).ok, false);
    assert.equal(audit.mayPrint({ vrf: "6148", status: "Draft" }).ok, false);
    assert.equal(audit.mayPrint({ vrf: "6148", status: "Approved" }).ok, true);
    assert.equal(audit.mayPrint({ vrf: "6148", status: "Closed", held: true }).ok, true);
    assert.equal(audit.mayPrint({ vrf: "6148", status: "Open" }).ok, true);
    assert.equal(audit.mayPrint({ vrf: "6148", status: "Requested", held: true, reserveStatus: "Approved" }).ok, true);
    assert.equal(audit.mayPrint({ vrf: "6148", status: "Requested", held: true, reserveStatus: "Requested" }).ok, false);
    assert.match(html, /return api\.mayPrint\(view\)/);
    assert.match(html, /reserveStatus:entry\.reserveStatus\|\|reserve\.status/);
  });
});
