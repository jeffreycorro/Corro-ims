"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  if (start < 0 || end < 0) throw new Error("missing " + startNeedle);
  return src.slice(start, end);
}

function loadMediaHelpers() {
  const src = sliceBetween(
    html,
    "var VIDEO_MAX_BYTES",
    "function readFileDataURL"
  );
  const sandbox = {};
  vm.runInNewContext(src, sandbox);
  return sandbox;
}

describe("job order and task media upload", () => {
  const api = loadMediaHelpers();

  it("bumps the portal build and keeps device upload next to links", () => {
    assert.match(html, /var BUILD = "2026-09-26 a"/);
    assert.match(html, /function joOwner/);
    assert.match(html, /function joProofTotal/);
    assert.match(html, /function prepareLocalMedia/);
    assert.match(html, /function mediaThumb/);
    assert.match(html, /if\(!joProofTotal\(j\)\) out\.push\("no proof attached"\)/);
    assert.equal((html.match(/Attach from this device/g) || []).length, 4);
    assert.match(html, /ffi\.type="file"; ffi\.multiple=true; ffi\.accept=MEDIA_ACCEPT/);
    assert.match(html, /afi\.type="file"; afi\.multiple=true; afi\.accept=MEDIA_ACCEPT/);
    assert.match(html, /Attach the link/);
    assert.match(html, /Attach proof/);
    assert.match(html, /Paste a full link starting with https:\/\//);
    assert.doesNotMatch(html, /afi\.accept="image\/\*"/);
  });

  it("treats gallery photo and video types as attachable files", () => {
    assert.equal(api.mediaKindOf({ type: "image/jpeg", name: "a.jpg" }), "photo");
    assert.equal(api.mediaKindOf({ type: "image/heic", name: "IMG.HEIC" }), "photo");
    assert.equal(api.mediaKindOf({ type: "", name: "shot.webp" }), "photo");
    assert.equal(api.mediaKindOf({ type: "video/mp4", name: "clip.mp4" }), "video");
    assert.equal(api.mediaKindOf({ type: "video/quicktime", name: "clip.mov" }), "video");
    assert.equal(api.mediaKindOf({ type: "", name: "phone.3gp" }), "video");
    assert.equal(api.mediaKindOf({ type: "application/pdf", name: "scan.pdf" }), "");
    assert.equal(api.mediaTooLarge({ type: "image/jpeg", name: "a.jpg", size: 9e6 }), "");
    assert.equal(api.mediaTooLarge({ type: "video/mp4", name: "ok.mp4", size: 2 * 1024 * 1024 }), "");
    assert.match(
      api.mediaTooLarge({ type: "video/mp4", name: "long.mp4", size: 8 * 1024 * 1024 }),
      /8 MB/
    );
    assert.match(api.MEDIA_ACCEPT, /image\/\*/);
    assert.match(api.MEDIA_ACCEPT, /video\/\*/);
    assert.match(api.MEDIA_ACCEPT, /\.heic/);
    assert.match(api.MEDIA_ACCEPT, /\.mov/);
  });

  it("plays a stored video and leaves link rows as links", () => {
    assert.equal(api.isVideoAttachment({ kind: "video", data: "data:video/mp4;base64,QQ==" }), true);
    assert.equal(api.isVideoAttachment({ kind: "photo", mime: "video/webm", data: "x" }), true);
    assert.equal(api.isVideoAttachment({ kind: "link", linkKind: "video", url: "https://drive.google.com/x" }), false);
    assert.equal(api.isVideoAttachment({ kind: "photo", data: "data:image/jpeg;base64,QQ==" }), false);
  });
});
