"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const jpeg = require("jpeg-js");
const {
  normalizePhotoIds,
  assertPhotoBatch,
  photoDataQuery,
  planPhotoBatches,
  limitsFor,
  estimateAttachMs,
} = require("../public/photo-batch");
const { fitPhotoPayload } = require("../netlify/lib/photo-fit");
const { readsRecordStore } = require("../netlify/lib/supabase");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const dbFn = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");
const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");

function noiseJpeg(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 17) % 255;
    data[i + 1] = (i * 31) % 255;
    data[i + 2] = (i * 13) % 255;
    data[i + 3] = 255;
  }
  const encoded = jpeg.encode({ data: data, width: width, height: height }, 90);
  return "data:image/jpeg;base64," + Buffer.from(encoded.data).toString("base64");
}

describe("photo batches stay on primary keys", () => {
  it("drops bad ids and will not filter by the vrf json key", () => {
    assert.deepEqual(normalizePhotoIds(["vrf-5887__1", "nope", "vrf-5887__1", "vrf-liq-5887__2"]), [
      "vrf-5887__1",
      "vrf-liq-5887__2",
    ]);
    const query = decodeURIComponent(photoDataQuery(["vrf-5887__1", "vrf-5887__2", "drop me"]));
    assert.match(query, /collection=eq\.photos/);
    assert.match(query, /id=in\.\("vrf-5887__1","vrf-5887__2"\)/);
    assert.match(query, /select=id,data:data->>data/);
    assert.doesNotMatch(query, /data->>vrf/);
    assert.equal(readsRecordStore("photos"), false);
    assert.equal(readsRecordStore("ledger"), true);
  });

  it("caps a request and splits a form into a few chunks", () => {
    assert.equal(assertPhotoBatch(["vrf-1__1", "vrf-1__2"], "thumb").length, 2);
    assert.throws(() => assertPhotoBatch(["vrf-1__1", "vrf-1__2", "vrf-1__3", "vrf-1__4", "vrf-1__5", "vrf-1__6", "vrf-1__7"], "thumb"), /Too many pictures/);
    const printCap = limitsFor("print").maxCount;
    assert.equal(printCap, 3);
    const items = [];
    for (let i = 1; i <= 10; i++) items.push({ id: "vrf-7001__" + i, bytes: 900 * 1024 });
    const chunks = planPhotoBatches(items, limitsFor("print"));
    assert.ok(chunks.length >= 4);
    chunks.forEach((chunk) => {
      assert.ok(chunk.length <= printCap);
      assert.doesNotThrow(() => assertPhotoBatch(chunk.map((row) => row.id), "print"));
    });
    const shrunk = items.map((row) => ({ id: row.id, bytes: 150 * 1024 }));
    const thumbs = planPhotoBatches(shrunk, limitsFor("thumb"));
    assert.ok(thumbs.length < chunks.length);
    assert.ok(thumbs.length <= 2);
  });
});

describe("fitted bytes are what the page should download", () => {
  it("turns a large jpeg into a small thumb and a smaller print image", () => {
    const big = noiseJpeg(1400, 1000);
    assert.ok(big.length > 200000, "fixture should be a large jpeg, was " + big.length);
    const thumb = fitPhotoPayload(big, "thumb");
    const printed = fitPhotoPayload(big, "print");
    assert.match(thumb, /^data:image\/jpeg;base64,/);
    assert.match(printed, /^data:image\/jpeg;base64,/);
    assert.ok(thumb.length < big.length / 8, thumb.length + " thumb vs " + big.length);
    assert.ok(printed.length < big.length, printed.length + " print vs " + big.length);
    assert.ok(thumb.length < printed.length);
    const pdf = "data:application/pdf;base64,QQ==";
    assert.equal(fitPhotoPayload(pdf, "thumb"), pdf);
    const tiny = "data:image/jpeg;base64," + "A".repeat(20);
    assert.equal(fitPhotoPayload(tiny, "thumb"), tiny);
  });
});

describe("open and print stop waiting on one request per picture", () => {
  /* Model, not a stopwatch on yard wifi.
     10 legacy pictures at 900 KiB each, 50 KiB/s (about 400 kbps), 800 ms
     round trip. The old open path fetched two full documents at a time and
     each document read also probed the records table. The new print figure
     assumes about 80 KiB on the wire, which is what an 800px print fit
     produces for a receipt-like photo, not for pure noise. */
  const link = { bytesPerSec: 50 * 1024, rttMs: 800 };
  const legacy = 900 * 1024;

  it("is wired through photoData, thumbs, and the print batch", () => {
    assert.match(dbFn, /op === "photoData"/);
    assert.match(dbFn, /listPhotoData\(ids, fit\)/);
    assert.match(shim, /photoData:\s*function/);
    assert.match(shim, /dbCall\("photoData"/);
    assert.match(html, /<script src="\/photo-batch.js"><\/script>/);
    assert.match(html, /function loadPhotoDocs\(/);
    assert.match(html, /loadPhotoDocs\(needThumb, "thumb"\)/);
    assert.match(html, /loadPhotoDocs\(files, "print"\)/);
    const add = html.slice(html.indexOf("async function addPhoto(vrf,rec)"), html.indexOf("async function addPhotoToOwners"));
    assert.match(add, /downscaleDataUrl\(rec\.data, PHOTO_THUMB_PX\)/);
    assert.match(add, /body\.thumb=thumb/);
    const start = html.indexOf("<script>\n(function()");
    const end = html.lastIndexOf("</script>");
    assert.ok(start > 0 && end > start);
    new vm.Script(html.slice(start + "<script>\n".length, end));
  });

  it("models minutes for the old path and seconds for the batch", () => {
    const beforeOpen = estimateAttachMs({
      count: 10,
      bytesEach: legacy,
      concurrency: 2,
      tripsPerRequest: 2,
      bytesPerSec: link.bytesPerSec,
      rttMs: link.rttMs,
    });
    const afterOpen = estimateAttachMs({
      count: 2,
      bytesEach: 6 * 8 * 1024,
      concurrency: 2,
      tripsPerRequest: 1,
      bytesPerSec: link.bytesPerSec,
      rttMs: link.rttMs,
    });
    const beforePrint = estimateAttachMs({
      count: 10,
      bytesEach: legacy,
      concurrency: 6,
      tripsPerRequest: 2,
      bytesPerSec: link.bytesPerSec,
      rttMs: link.rttMs,
    });
    const afterPrint = estimateAttachMs({
      count: 4,
      bytesEach: 3 * 80 * 1024,
      concurrency: 2,
      tripsPerRequest: 1,
      bytesPerSec: link.bytesPerSec,
      rttMs: link.rttMs,
    });
    assert.ok(beforeOpen > 120000, "before open " + beforeOpen);
    assert.ok(afterOpen < 8000, "after open " + afterOpen);
    assert.ok(beforeOpen / afterOpen >= 20, beforeOpen + " vs " + afterOpen);
    assert.ok(beforePrint > 120000, "before print " + beforePrint);
    assert.ok(afterPrint < 40000, "after print " + afterPrint);
    assert.ok(beforePrint / afterPrint >= 5, beforePrint + " vs " + afterPrint);
  });
});
