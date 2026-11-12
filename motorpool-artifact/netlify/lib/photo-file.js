"use strict";

const { fitPhotoPayload } = require("./photo-fit");

/* Browser cache for a successful file. The CDN must not keep it: the bytes
   belong to the signed-in session. Errors use no-store so a miss is not
   stuck for a day. */
const CACHE_HIT = "private, max-age=86400";
const CACHE_MISS = "no-store";
const CDN_PRIVATE = "no-store";
const MAX_BYTES = 4 * 1024 * 1024;
const FINANCE_BUCKET = "finance-uploads";

function decodeDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  const comma = raw.indexOf(",");
  if (!raw.startsWith("data:") || comma < 6) return null;
  const meta = raw.slice(5, comma);
  const payload = raw.slice(comma + 1);
  const mime = String(meta.split(";")[0] || "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!mime || /[\r\n]/.test(mime)) return null;
  let buf;
  try {
    buf = /;base64/i.test(meta)
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
  } catch (e) {
    return null;
  }
  if (!buf || !buf.length) return null;
  return { mime, buf };
}

function encodeDataUrl(mime, buf) {
  return "data:" + mime + ";base64," + Buffer.from(buf).toString("base64");
}

/**
 * Gallery and print ask for a fitted JPEG. A PDF, a video, or a full open
 * keeps the stored bytes. Nothing is written back.
 */
function presentFile(mime, buf, fit) {
  const type = String(mime || "application/octet-stream").split(";")[0].trim().toLowerCase() || "application/octet-stream";
  const bytes = Buffer.from(buf);
  const name = fit === "full" ? "full" : fit === "print" ? "print" : "thumb";
  if (name !== "full" && /^image\/jpe?g$/.test(type)) {
    const fitted = fitPhotoPayload(encodeDataUrl(type, bytes), name);
    const decoded = decodeDataUrl(fitted);
    if (decoded && decoded.buf.length) {
      assertSize(decoded.buf);
      return decoded;
    }
  }
  assertSize(bytes);
  return { mime: type, buf: bytes };
}

function assertSize(buf) {
  if (!buf || buf.length > MAX_BYTES) {
    const err = new Error("That file is too large to preview here.");
    err.statusCode = 413;
    throw err;
  }
}

function assertStoragePath(path) {
  const value = String(path || "").trim();
  if (
    !value ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("\0") ||
    value.includes("://")
  ) {
    const err = new Error("That file path is not allowed.");
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function safeDownloadName(name, mime) {
  const base = String(name || "attachment")
    .split(/[/\\]/)
    .pop()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "attachment";
  if (mime === "application/pdf" && !/\.pdf$/i.test(base)) return base + ".pdf";
  return base;
}

function fileResponse(mime, buf, filename) {
  const type = String(mime || "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
  const body = Buffer.from(buf);
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      "content-type": type,
      "cache-control": CACHE_HIT,
      "netlify-cdn-cache-control": CDN_PRIVATE,
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      "content-disposition": "inline; filename=\"" + safeDownloadName(filename, type) + "\"",
    },
    body: body.toString("base64"),
  };
}

async function fetchStorageObject({ url, key, bucket, path, fetchImpl }) {
  const clean = assertStoragePath(path);
  const root = String(url || "").replace(/\/$/, "");
  const token = String(key || "");
  if (!root || !token) {
    const err = new Error("Supabase Storage is not configured on this site.");
    err.statusCode = 503;
    throw err;
  }
  const encoded = clean
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const go = fetchImpl || fetch;
  const res = await go(root + "/storage/v1/object/" + (bucket || FINANCE_BUCKET) + "/" + encoded, {
    headers: { apikey: token, authorization: "Bearer " + token },
  });
  if (!res.ok) {
    const err = new Error(res.status === 404 ? "That attachment is not in storage." : "Could not read that upload.");
    err.statusCode = res.status === 404 ? 404 : 502;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const headerType = res.headers && res.headers.get ? res.headers.get("content-type") : "";
  return { buf, mime: String(headerType || "").split(";")[0].trim().toLowerCase() };
}

module.exports = {
  CACHE_HIT,
  CACHE_MISS,
  CDN_PRIVATE,
  FINANCE_BUCKET,
  MAX_BYTES,
  assertSize,
  assertStoragePath,
  decodeDataUrl,
  encodeDataUrl,
  fetchStorageObject,
  fileResponse,
  presentFile,
  safeDownloadName,
};
