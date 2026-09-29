"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { photoMetaQuery, photoMetaRow, photoMetaSelect } = require("../netlify/lib/supabase");
const { applyVrfAutoApproval, VRF_AUTO_APPROVE_UNDER } = require("./lib/rules");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
const dbFn = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");

function sliceFn(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start + startMark.length);
  assert.ok(start > 0 && end > start, startMark);
  return source.slice(start, end);
}

describe("photo meta omits the image blob", () => {
  it("selects names and sizes, not the base64 data column", () => {
    const select = photoMetaSelect();
    assert.deepEqual(
      select.split(",").filter((part) => part === "data" || part.startsWith("data:")),
      []
    );
    assert.match(select, /vrf:data->>vrf/);
    assert.match(select, /thumb:data->>thumb/);
    const query = decodeURIComponent(photoMetaQuery("RSV-12"));
    assert.match(query, /collection=eq\.photos/);
    assert.match(query, /data->>vrf=eq\.RSV-12/);
    assert.equal(query.includes(",data,") || query.includes("select=data"), false);
  });

  it("drops a blob if one is present on the row", () => {
    const blob = "data:image/jpeg;base64," + "A".repeat(4000);
    const row = photoMetaRow({
      id: "vrf-5864__1",
      vrf: "5864",
      caption: "gauge",
      bytes: "150000",
      data: blob,
    });
    assert.equal(row.id, "vrf-5864__1");
    assert.equal(row.vrf, "5864");
    assert.equal(row.caption, "gauge");
    assert.equal("data" in row, false);
    assert.equal(JSON.stringify(row).includes("base64"), false);
  });

  it("is a db op the page can call", () => {
    assert.match(dbFn, /op === "photoMeta"/);
    assert.match(dbFn, /listPhotoMeta\(owner\)/);
    assert.match(shim, /photoMeta:\s*function/);
    assert.match(shim, /dbCall\("photoMeta"/);
  });
});

describe("Approvals renders before any picture fetch", () => {
  it("lists pending VRFs from photo counts only", () => {
    const body = sliceFn(html, "function approveView()", "function remindView()");
    assert.match(body, /photoCount\(/);
    assert.doesNotMatch(body, /listPhotos|photoMeta|mountLazyGallery|signedUrl|createSignedUrl/);
    const load = sliceFn(html, "async function loadAll()", "async function listCollectionIds(");
    assert.match(load, /PATHS\.photoIdx/);
    assert.doesNotMatch(load, /listPhotos|collection\("photos"\)/);
  });

  it("puts Approve on the page before picture names or bytes", () => {
    const body = sliceFn(html, "function openReserve(no,asApprover)", "function approveView()");
    const painted = body.slice(0, body.indexOf("document.body.appendChild(m)"));
    assert.match(painted, /el\("button","btn pri","Approve"\)/);
    assert.match(painted, /el\("button","btn","Reject"\)/);
    assert.doesNotMatch(painted, /listPhotos|mountLazyGallery|S\.db\.photoMeta|signedUrl|createSignedUrl/);
    assert.ok(body.indexOf("document.body.appendChild(m)") < body.indexOf("mountLazyGallery(pgal"));
    assert.match(html, /var BUILD = "2026-09-29 c"/);
  });

  it("opens a VRF sheet without fetching pictures, and prints only when asked", () => {
    assert.match(html, /function openVrf\(entry,tab\)\{/);
    assert.doesNotMatch(html, /async function openVrf\(entry,tab\)/);
    const body = sliceFn(html, "function openVrf(entry,tab)", "function blankLine()");
    const painted = body.slice(0, body.indexOf("document.body.appendChild(m)"));
    const printAt = painted.indexOf('pr.addEventListener("click",async function()');
    const printEnd = painted.indexOf("tabs.appendChild(pr)", printAt);
    assert.ok(printAt > 0 && printEnd > printAt);
    const withoutPrint = painted.slice(0, printAt) + painted.slice(printEnd);
    assert.match(painted.slice(printAt, printEnd), /await listPhotosMany\(photoOwnersForOpenVrf\(entry\)\)/);
    assert.doesNotMatch(withoutPrint, /listPhotos/);
    assert.doesNotMatch(painted, /mountLazyGallery/);
    assert.match(body, /if\(lazyGal\)/);
    assert.match(body, /mountLazyGallery\(lazyGal/);
    assert.equal((body.match(/listPhotosMany/g) || []).length, 1);
  });
});

describe("pictures load small, later, and full size only on tap", () => {
  it("uses a lazy thumbnail path with a concurrency cap", () => {
    assert.match(html, /var PHOTO_FETCH_LIMIT=2/);
    assert.match(html, /new IntersectionObserver/);
    assert.match(html, /rootMargin:"200px"/);
    assert.match(html, /setAttribute\("loading","lazy"\)/);
    assert.match(html, /setAttribute\("decoding","async"\)/);
    assert.match(html, /function downscaleDataUrl/);
    assert.match(html, /function thumbSrcFor/);
    assert.match(html, /PHOTO_THUMB_PX/);
    assert.match(html, /Video — tap to play/);
    assert.match(html, /function lightboxVideo/);
    assert.match(html, /setTimeout\(function\(\)\{ fillLazyGallery/);
    const meta = sliceFn(html, "async function listPhotoMeta(owner)", "async function listPhotoMetaMany(");
    assert.match(meta, /S\.db\.photoMeta/);
    assert.doesNotMatch(meta, /listPhotos\(/);
    assert.match(meta, /return meta/);
  });
});

describe("approval rules stay put", () => {
  it("still auto-approves under 1000 as CEO policy", () => {
    assert.equal(VRF_AUTO_APPROVE_UNDER, 1000);
    const hold = { status: "Requested" };
    assert.equal(applyVrfAutoApproval(hold, 150, "2026-09-29"), true);
    assert.equal(hold.approvedBy, "CEO policy");
    const queued = { status: "Requested" };
    assert.equal(applyVrfAutoApproval(queued, 1690, "2026-09-29"), false);
    assert.equal(queued.status, "Requested");
  });
});
