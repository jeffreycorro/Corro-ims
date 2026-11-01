"use strict";

/**
 * Secret-gated approve (or reject) of one Motorpool VRF cancel request.
 * Same auth as approve-vrf: Authorization: Bearer APPROVE_VRF_SECRET
 * (or X-Approve-Secret). Call only after Jeffrey's per-VRF yes.
 *
 * POST { "vrf": "6264" }                  whole VRF (or the pending request's lines)
 * POST { "vrf": "6264", "lines": [0, 2] }  only those lines (0-based)
 * POST { "vrf": "6264", "reject": true, "note": "..." }
 */

const { json, safeEqual } = require("../lib/session");
const { configuredSecret, requestSecret } = require("./approve-vrf");
const { applyCancel, createRecordsStore } = require("../lib/approve-cancel");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-Approve-Secret",
  "access-control-max-age": "86400",
};

function reply(status, body) {
  return json(status, body, CORS);
}

function createHandler(deps) {
  return async function handler(event) {
    try {
      if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
      if (event.httpMethod !== "POST") return reply(405, { error: "Method not allowed", code: "method_not_allowed" });
      const expected = configuredSecret();
      if (!expected) {
        return reply(503, { error: "Approve API is not configured. Set APPROVE_VRF_SECRET on Netlify.", code: "not_configured" });
      }
      const provided = requestSecret(event);
      if (!provided || !safeEqual(provided, expected)) return reply(401, { error: "Unauthorized", code: "unauthorized" });
      let body;
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return reply(400, { error: "Body must be JSON", code: "bad_request" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return reply(400, { error: "Body must be a JSON object", code: "bad_request" });
      }
      const store = (deps && deps.store) || createRecordsStore();
      const result = await applyCancel(store, body, deps);
      return reply(200, result);
    } catch (err) {
      const payload = { error: (err && err.message) || "Cancel approve failed" };
      if (err && err.code) payload.code = err.code;
      return reply((err && err.statusCode) || 500, payload);
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
