"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { estimateAttachMs, mapLimit } = require("../public/photo-batch");
const {
  CACHE_HIT,
  CACHE_MISS,
  decodeDataUrl,
  presentFile,
  assertStoragePath,
  fileResponse,
} = require("../netlify/lib/photo-file");
const { handle, handler } = require("../netlify/functions/photo");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const toml = fs.readFileSync(path.join(__dirname, "../netlify.toml"), "utf8");

function sliceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  if (start < 0 || end < 0) throw new Error("missing " + startNeedle);
  return src.slice(start, end);
}

const JPEG = "data:image/jpeg;base64," + Buffer.from("yard-photo").toString("base64");

describe("attachment bytes are a cached GET, not a no-store JSON blob", () => {
  let env;
  beforeEach(() => {
    env = { ...process.env };
    delete process.env.MOTORPOOL_GATE_SECRET;
    delete process.env.MOTORPOOL_GATE_PASSWORD;
    delete process.env.MOTORPOOL_GATE_REQUIRED;
    delete process.env.MOTORPOOL_OPEN_YARD;
    delete process.env.MOTORPOOL_SESSION_SECRET;
    delete process.env.SUPABASE_AUTH_ENABLED;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  afterEach(() => {
    process.env = env;
  });

  it("fits a jpeg thumb and tells the browser to keep it", () => {
    const raw = Buffer.from("yard-photo");
    const out = presentFile("image/jpeg", raw, "thumb");
    assert.equal(out.mime, "image/jpeg");
    assert.ok(out.buf.length <= raw.length);
    const res = fileResponse(out.mime, out.buf, "receipt.jpg");
    assert.equal(res.statusCode, 200);
    assert.equal(res.isBase64Encoded, true);
    assert.equal(res.headers["cache-control"], CACHE_HIT);
    assert.equal(res.headers["netlify-cdn-cache-control"], "no-store");
    assert.equal(Buffer.from(res.body, "base64").toString(), out.buf.toString());
    assert.match(res.headers["content-disposition"], /inline; filename="receipt\.jpg"/);
  });

  it("refuses a storage path that leaves the bucket", () => {
    assert.equal(assertStoragePath("receipts/2026/or.jpg"), "receipts/2026/or.jpg");
    assert.throws(() => assertStoragePath("../secret"), /not allowed/);
    assert.throws(() => assertStoragePath("/etc/passwd"), /not allowed/);
    assert.throws(() => assertStoragePath("a\\b"), /not allowed/);
  });

  it("serves one motorpool photo and does not cache a miss", async () => {
    const ok = await handle(
      { httpMethod: "GET", headers: {}, queryStringParameters: { id: "vrf-JO-12__1", fit: "thumb" } },
      { listPhotoData: async () => [{ id: "vrf-JO-12__1", data: JPEG }] }
    );
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers["cache-control"], CACHE_HIT);
    assert.equal(ok.headers["content-type"], "image/jpeg");
    assert.equal(decodeDataUrl(JPEG).buf.equals(Buffer.from(ok.body, "base64")), true);

    const miss = await handle(
      { httpMethod: "GET", headers: {}, queryStringParameters: { id: "vrf-JO-12__9", fit: "full" } },
      { readPhotoRaw: async () => "" }
    ).catch((err) => err);
    assert.equal(miss.statusCode, 404);
    const wrapped = await handler({
      httpMethod: "GET",
      headers: {},
      queryStringParameters: { id: "not a photo", fit: "thumb" },
    });
    assert.equal(wrapped.statusCode, 400);
    assert.equal(wrapped.headers["cache-control"], CACHE_MISS);
  });

  it("opens a finance receipt only when that VRF lists the attachment", async () => {
    let fetched = 0;
    const res = await handle(
      {
        httpMethod: "GET",
        headers: {},
        queryStringParameters: { vrf: "5887", finance: "att_or_1", fit: "thumb" },
      },
      {
        financeLiquidationForVrf: async () => ({ receipts: [{ id: "r1", attachment_id: "att_or_1" }] }),
        attachmentRow: async () => ({ storage_path: "receipts/or.jpg", content_type: "image/jpeg", filename: "or.jpg" }),
        getObject: async (storagePath) => {
          fetched += 1;
          assert.equal(storagePath, "receipts/or.jpg");
          return { buf: Buffer.from("yard-photo"), mime: "image/jpeg" };
        },
      }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(fetched, 1);
    assert.equal(res.headers["cache-control"], CACHE_HIT);

    let blocked = 0;
    const denied = await handle(
      {
        httpMethod: "GET",
        headers: {},
        queryStringParameters: { vrf: "5887", finance: "att_other", fit: "full" },
      },
      {
        financeLiquidationForVrf: async () => ({ receipts: [{ attachment_id: "att_or_1" }] }),
        attachmentRow: async () => ({ storage_path: "receipts/secret.jpg", content_type: "image/jpeg" }),
        getObject: async () => {
          blocked += 1;
          return { buf: Buffer.from("nope"), mime: "image/jpeg" };
        },
      }
    ).catch((err) => err);
    assert.equal(denied.statusCode, 404);
    assert.equal(blocked, 0);

    const escape = await handle(
      {
        httpMethod: "GET",
        headers: {},
        queryStringParameters: { vrf: "5887", finance: "att_or_1", fit: "full" },
      },
      {
        financeLiquidationForVrf: async () => ({ receipts: [{ attachment_id: "att_or_1" }] }),
        attachmentRow: async () => ({ storage_path: "../secret", content_type: "image/jpeg" }),
        getObject: async () => {
          throw new Error("should not read");
        },
      }
    ).catch((err) => err);
    assert.equal(escape.statusCode, 400);
  });
});

describe("galleries no longer download every full file up front", () => {
  it("is build 2026-11-13 a and keeps the write floor", () => {
    assert.match(html, /var BUILD = "2026-11-13 a"/);
    assert.match(fs.readFileSync(path.join(__dirname, "../netlify/lib/vrf-issue.js"), "utf8"), /const MIN_WRITE_BUILD = "2026-10-06 a"/);
    assert.match(toml, /\[functions\.photo\]/);
    assert.match(toml, /timeout = 26/);
  });

  it("loads job order, task, liquidation, and unit files when the cell is visible", () => {
    const jo = html.slice(html.indexOf("function paintJoFiles()"), html.indexOf("paintJoLinks(); paintJoFiles();"));
    assert.match(jo, /mountLazyGallery\(joGal/);
    assert.doesNotMatch(jo, /listPhotos\(/);
    assert.doesNotMatch(jo, /x\.data/);

    const task = html.slice(html.indexOf("function paintAtt()"), html.indexOf('var aby=el("input")'));
    assert.match(task, /mountLazyGallery\(gal/);
    assert.doesNotMatch(task, /listPhotos\(/);
    assert.doesNotMatch(task, /mediaThumb\(/);

    const proof = sliceBetween(html, "async function liqProofPanel", "function unliqView");
    assert.match(proof, /mountLazyGallery\(gal/);
    assert.doesNotMatch(proof, /listPhotos\(/);
    assert.doesNotMatch(proof, /return x&&x\.data/);
    assert.match(proof, /Open receipt file/);
    assert.match(proof, /financeFileUrl/);

    assert.doesNotMatch(html, /listPhotos\(unitOwner/);
    assert.match(html, /mountLazyGallery\(gal2/);
    assert.doesNotMatch(html, /listPhotos\(docOwner/);
    assert.match(html, /photoFileUrl\(d\.id,"thumb"\)/);
    assert.match(html, /The scan did not load\. Retry\./);

    const open = sliceBetween(html, "function openVrf(entry,tab)", "function blankLine()");
    assert.doesNotMatch(open, /eager:\s*true/);
    const opts = sliceBetween(html, "function liquidationGalleryOpts", "function appendLiquidationAttachments");
    assert.doesNotMatch(opts, /eager:\s*true/);
  });

  it("shows a loading state and a retry, and does not hide a failed list", () => {
    assert.match(html, /function photoFileUrl/);
    assert.match(html, /function financeFileUrl/);
    assert.match(html, /function fetchAttachment/);
    assert.match(html, /Loading picture…/);
    assert.match(html, /Picture failed/);
    assert.match(html, /function placeRemoteThumb/);
    assert.match(html, /PHOTO_GET_MS/);
    assert.match(html, /function isStoredLink/);
    const meta = sliceBetween(html, "async function listPhotoMeta(owner)", "async function listPhotoMetaMany(");
    assert.match(meta, /if\(meta\.length\) return applyStoredThumbs\(meta\)/);
    assert.match(meta, /throw e/);
    assert.doesNotMatch(meta, /listPhotos\(/);
    const many = sliceBetween(html, "async function listPhotosMany(owners)", "/* Approvals still loads");
    assert.match(many, /Promise\.all\(jobs\)/);
    assert.doesNotMatch(many, /await listPhotos/);
    const visible = sliceBetween(html, "function whenVisible(node, fn)", "function isVideoMeta");
    assert.match(visible, /fn\(\); return/);
    assert.match(visible, /new IntersectionObserver/);
  });

  it("prepares several chosen files at once and saves them in order", async () => {
    const order = [];
    const prepared = await mapLimit(["a.jpg", "b.jpg", "c.jpg"], 3, async (name) => {
      order.push("read:" + name);
      return name;
    });
    assert.deepEqual(prepared.map((row) => row.value), ["a.jpg", "b.jpg", "c.jpg"]);
    assert.equal(prepared.every((row) => row.ok), true);
    const mixed = await mapLimit(["ok", "bad"], 2, async (name) => {
      if (name === "bad") throw new Error("could not read the file");
      return name;
    });
    assert.equal(mixed[0].ok, true);
    assert.equal(mixed[1].ok, false);
    assert.match(html, /function runAttachBatch/);
    assert.match(html, /PhotoBatch\.mapLimit/);
    assert.deepEqual(order.slice().sort(), ["read:a.jpg", "read:b.jpg", "read:c.jpg"]);
  });

  it("parses the page script", () => {
    const start = html.indexOf("<script>\n(function()");
    const end = html.lastIndexOf("</script>");
    assert.ok(start > 0 && end > start);
    new vm.Script(html.slice(start + "<script>\n".length, end));
  });
});

describe("the old full-file load is the slow, missing one", () => {
  /* Same yard link the photo-batch test uses: 50 KiB/s, 800 ms round trip.
     Six 900 KiB data URLs in one listPhotos response. A thumb is about 8 KiB
     after the fit, and the browser fetches the visible ones together. */
  const link = { bytesPerSec: 50 * 1024, rttMs: 800 };

  it("drops a multi-minute download to a few seconds", () => {
    const before = estimateAttachMs({
      count: 1,
      bytesEach: 6 * 900 * 1024,
      concurrency: 1,
      tripsPerRequest: 1,
      bytesPerSec: link.bytesPerSec,
      rttMs: link.rttMs,
    });
    const thumbs = estimateAttachMs({
      count: 6,
      bytesEach: 8 * 1024,
      concurrency: 6,
      tripsPerRequest: 1,
      bytesPerSec: link.bytesPerSec,
      rttMs: link.rttMs,
    });
    const after = thumbs + link.rttMs;
    assert.ok(before > 100000, "before " + before);
    assert.ok(after < 4000, "after " + after);
    assert.ok(before / after >= 40, before + " vs " + after);
    assert.equal(before, 108800);
    assert.equal(after, 2560);
  });
});
