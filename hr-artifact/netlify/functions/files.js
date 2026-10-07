"use strict";

const crypto = require("crypto");
const { json, requireSession } = require("../lib/session");
const { codedError, errorBody } = require("../lib/coded-error");
const { formatManilaDate } = require("../lib/manila");
const {
  FILE_SIZE_LIMIT,
  ensureBucket,
  signDownload,
  signUpload,
} = require("../lib/supabase-storage");

const DOWNLOAD_TTL = 120;

function parentSegment(parentId) {
  const cleaned = String(parentId || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "")
    .slice(0, 80);
  return cleaned || "misc";
}

function sanitizeTitle(title) {
  const base = String(title || "file").split(/[/\\]/).pop().trim() || "file";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || "file";
}

function buildUploadPath({ parentId, title, now, id } = {}) {
  const parent = parentSegment(parentId);
  const month = formatManilaDate(now || new Date()).slice(0, 7);
  const name = sanitizeTitle(title);
  const uuid = id || crypto.randomUUID();
  return `${parent}/${month}/${uuid}-${name}`;
}

function assertSafePath(path) {
  const value = String(path || "").trim();
  if (!value || value.length > 512) {
    throw codedError("bad_request", "A file path is required.");
  }
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("://") ||
    value.includes("\0") ||
    !/^[A-Za-z0-9._/-]+$/.test(value)
  ) {
    throw codedError("bad_request", "That file path is not allowed.");
  }
  return value;
}

function queryPath(event) {
  const q = (event && event.queryStringParameters) || {};
  if (q.path) return String(q.path);
  const raw = String((event && event.rawQuery) || "");
  const match = /(?:^|&)path=([^&]*)/.exec(raw);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1].replace(/\+/g, " "));
  } catch {
    return "";
  }
}

async function uploadUrl(body) {
  const size = Number(body && body.size);
  if (!Number.isFinite(size) || size < 0) {
    throw codedError("bad_request", "size is required.");
  }
  if (size > FILE_SIZE_LIMIT) {
    throw codedError("bad_request", "That file is over 50 MB.");
  }
  const path = buildUploadPath({
    parentId: body && body.parentId,
    title: body && body.title,
  });
  await ensureBucket();
  const signed = await signUpload(path);
  return { uploadUrl: signed.uploadUrl, path };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, body: "" };
    }

    requireSession(event);

    if (event.httpMethod === "GET") {
      const path = assertSafePath(queryPath(event));
      const signed = await signDownload(path, DOWNLOAD_TTL);
      return {
        statusCode: 302,
        headers: {
          location: signed.signedUrl,
          "cache-control": "no-store",
          "x-robots-tag": "noindex, nofollow",
        },
        body: "",
      };
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const op = String(body.op || body.tool || "").trim();
    if (op !== "upload_url") {
      throw codedError("bad_request", `Unknown file op: ${op || "(none)"}`);
    }
    return json(200, await uploadUrl(body));
  } catch (err) {
    const status = err.statusCode || (err instanceof SyntaxError ? 400 : 500);
    return json(status, errorBody(err));
  }
};

exports.DOWNLOAD_TTL = DOWNLOAD_TTL;
exports.assertSafePath = assertSafePath;
exports.buildUploadPath = buildUploadPath;
exports.parentSegment = parentSegment;
exports.sanitizeTitle = sanitizeTitle;
