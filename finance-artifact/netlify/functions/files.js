"use strict";

const { errorBody } = require("../lib/errors");
const { json, requireSession } = require("../lib/session");
const { signDownload } = require("../lib/storage");

function queryPath(event) {
  const q = (event && event.queryStringParameters) || {};
  return q.path ? String(q.path) : "";
}

async function handle(event, deps = {}) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  requireSession(event);

  if (event.httpMethod === "GET") {
    const path = queryPath(event);
    if (path) {
      if (path.includes("..") || path.startsWith("/") || path.includes("\\")) {
        return json(400, { error: "That file path is not allowed.", code: "bad_request" });
      }
      const storage = deps.storage || { signDownload };
      const signed = await storage.signDownload(path, 120);
      return {
        statusCode: 302,
        headers: { location: signed.signedUrl, "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
        body: "",
      };
    }
    return json(400, { error: "path is required", code: "bad_request" });
  }

  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const body = JSON.parse(event.body || "{}");
  if (body.op !== "upload_url") return json(400, { error: "Use the finance upload action for receipts.", code: "bad_request" });
  return json(400, { error: "Upload the file through Finance so it stays on the private bucket.", code: "bad_request" });
}

exports.handle = handle;
exports.handler = (event) => handle(event).catch((err) => json(err.statusCode || 500, errorBody(err)));
