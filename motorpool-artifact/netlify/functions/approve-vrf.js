"use strict";

/**
 * Secret-gated approve of one pending Motorpool VRF.
 * Does the same write as Office → Approvals → Approve: held reserve
 * (status Requested) becomes posted/open on the ledger.
 *
 * Auth is APPROVE_VRF_SECRET or MOTORPOOL_APPROVE_SECRET — not the
 * Office passcode and not the staff session cookie. Builder / Noah
 * call this after Jeffrey's per-VRF yes.
 */

const { json, safeEqual } = require("../lib/session");
const {
  approvePendingVrf,
  createSupabaseStore,
} = require("../lib/approve-from-hold");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-Approve-Secret",
  "access-control-max-age": "86400",
};

function configuredSecret() {
  const a = String(process.env.APPROVE_VRF_SECRET || "").trim();
  if (a) return a;
  return String(process.env.MOTORPOOL_APPROVE_SECRET || "").trim();
}

function headerValue(headers, name) {
  const h = headers || {};
  const want = String(name).toLowerCase();
  for (const key of Object.keys(h)) {
    if (String(key).toLowerCase() === want) return h[key];
  }
  return "";
}

function requestSecret(event) {
  const headers = event && event.headers;
  const named = String(headerValue(headers, "x-approve-secret") || "").trim();
  if (named) return named;
  const auth = String(headerValue(headers, "authorization") || "").trim();
  const bearer = /^Bearer\s+(\S+)/i.exec(auth);
  return bearer ? bearer[1].trim() : "";
}

function reply(status, body) {
  return json(status, body, CORS);
}

function createHandler(deps) {
  const store = (deps && deps.store) || createSupabaseStore();

  return async function handler(event) {
    try {
      if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, headers: CORS, body: "" };
      }
      if (event.httpMethod !== "POST") {
        return reply(405, { error: "Method not allowed", code: "method_not_allowed" });
      }

      const expected = configuredSecret();
      if (!expected) {
        return reply(503, {
          error: "Approve API is not configured. Set APPROVE_VRF_SECRET on Netlify.",
          code: "not_configured",
        });
      }

      const provided = requestSecret(event);
      if (!provided || !safeEqual(provided, expected)) {
        return reply(401, { error: "Unauthorized", code: "unauthorized" });
      }

      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return reply(400, { error: "Body must be JSON", code: "bad_request" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return reply(400, { error: "Body must be a JSON object", code: "bad_request" });
      }

      const result = await approvePendingVrf(store, body);
      return reply(200, result);
    } catch (err) {
      const status = err && err.statusCode ? err.statusCode : 500;
      const payload = {
        error: (err && err.message) || "Approve failed",
      };
      if (err && err.code) payload.code = err.code;
      return reply(status, payload);
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.configuredSecret = configuredSecret;
exports.requestSecret = requestSecret;
