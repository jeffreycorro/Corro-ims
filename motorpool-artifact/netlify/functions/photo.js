"use strict";

/**
 * Byte proxy for an attachment that already exists.
 *
 * Motorpool pictures live in motorpool_docs as data URLs. Finance receipt
 * files live in the private finance-uploads bucket, pointed at by
 * finance_liquidation_receipts.attachment_id. This function returns fitted
 * bytes for a thumbnail or a print preview, or the stored file when the
 * caller opens it. It does not write.
 *
 * A gallery used to ask the database for every full data URL in one JSON
 * body (cache-control: no-store). A timeout then looked the same as "no
 * attachments". One file per GET can be cached by the browser, and a miss
 * is a real error the page can retry.
 */

const { json, requireSession } = require("../lib/session");
const { listPhotoData, rest, supabaseUrl, serviceRole } = require("../lib/supabase");
const { financeLiquidationForVrf, cleanVrf } = require("../lib/finance-link");
const { photoDataQuery } = require("../../public/photo-batch");
const {
  CACHE_MISS,
  FINANCE_BUCKET,
  assertStoragePath,
  decodeDataUrl,
  fetchStorageObject,
  fileResponse,
  presentFile,
} = require("../lib/photo-file");

const PHOTO_ID = /^vrf-[A-Za-z0-9_.~:@+-]+__\d+$/;

function cleanPhotoId(id) {
  const s = String(id || "").trim();
  return PHOTO_ID.test(s) ? s : "";
}

function cleanFit(fit) {
  if (fit === "print" || fit === "full") return fit;
  return "thumb";
}

function cleanAttachmentId(id) {
  const s = String(id || "").trim();
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(s) ? s : "";
}

function queryOf(event) {
  return (event && event.queryStringParameters) || {};
}

async function readPhotoRaw(id, deps) {
  const call = deps.rest || rest;
  const rows = await call({
    method: "GET",
    path: "/rest/v1/motorpool_docs",
    query: photoDataQuery([id]),
  });
  const row = Array.isArray(rows) ? rows.find((item) => item && item.id === id) : null;
  return row && row.data != null ? String(row.data) : "";
}

async function bytesForPhoto(id, fit, deps) {
  if (fit === "full") {
    const read = deps.readPhotoRaw || readPhotoRaw;
    const dataUrl = await read(id, deps);
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) {
      const err = new Error("That attachment is not in the file store.");
      err.statusCode = 404;
      throw err;
    }
    return presentFile(decoded.mime, decoded.buf, "full");
  }
  const list = deps.listPhotoData || listPhotoData;
  const rows = await list([id], fit);
  const row = Array.isArray(rows) ? rows.find((item) => item && item.id === id) : null;
  const decoded = decodeDataUrl(row && row.data);
  if (!decoded) {
    const err = new Error("That attachment is not in the file store.");
    err.statusCode = 404;
    throw err;
  }
  /* listPhotoData already fitted a JPEG. presentFile will not grow it. */
  return presentFile(decoded.mime, decoded.buf, fit);
}

async function defaultAttachmentRow(id) {
  const rows = await rest({
    method: "GET",
    path: "/rest/v1/finance_attachments",
    query: "id=eq." + encodeURIComponent(id) + "&select=id,filename,storage_path,content_type&limit=1",
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function defaultStorageObject(storagePath) {
  return fetchStorageObject({
    url: supabaseUrl(),
    key: serviceRole(),
    bucket: FINANCE_BUCKET,
    path: storagePath,
  });
}

async function bytesForFinance(vrf, attachmentId, fit, deps) {
  const lookup = deps.financeLiquidationForVrf || financeLiquidationForVrf;
  const linked = await lookup(vrf, [], deps.financeIo);
  const receipts = (linked && linked.receipts) || [];
  const known = receipts.some((row) => String((row && row.attachment_id) || "") === attachmentId);
  if (!known) {
    const err = new Error("That file is not attached to this VRF.");
    err.statusCode = 404;
    throw err;
  }
  const rowOf = deps.attachmentRow || defaultAttachmentRow;
  const row = await rowOf(attachmentId);
  const storagePath = row && (row.storage_path || row.storagePath);
  if (!storagePath) {
    const err = new Error("That attachment record has no file.");
    err.statusCode = 404;
    throw err;
  }
  assertStoragePath(storagePath);
  const read = deps.getObject || defaultStorageObject;
  const object = await read(storagePath);
  const mime = (row && (row.content_type || row.contentType)) || (object && object.mime) || "application/octet-stream";
  const buf = object && object.buf ? object.buf : object;
  return Object.assign(presentFile(mime, buf, fit), {
    filename: row && (row.filename || row.name),
  });
}

async function handle(event, deps) {
  deps = deps || {};
  if (!event || event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "cache-control": CACHE_MISS }, body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  requireSession(event);

  const q = queryOf(event);
  const fit = cleanFit(q.fit);
  const financeId = cleanAttachmentId(q.finance);
  if (q.finance) {
    const vrf = cleanVrf(q.vrf);
    if (!financeId || !vrf) return json(400, { error: "A VRF number and attachment id are required." });
    const file = await bytesForFinance(vrf, financeId, fit, deps);
    return fileResponse(file.mime, file.buf, file.filename);
  }

  const id = cleanPhotoId(q.id);
  if (!id) return json(400, { error: "A photo id is required." });
  const file = await bytesForPhoto(id, fit, deps);
  return fileResponse(file.mime, file.buf, id);
}

exports.handle = handle;
exports.bytesForPhoto = bytesForPhoto;
exports.bytesForFinance = bytesForFinance;
exports.handler = (event) =>
  handle(event).catch((err) => {
    const status = err && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    return json(status, { error: (err && err.message) || "Could not load that attachment." });
  });
