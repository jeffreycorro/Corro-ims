"use strict";

const { json, requireSession, safeEqual } = require("../lib/session");
const { officeHashConfigured } = require("../lib/capabilities");

function envHash() {
  return String(process.env.MOTORPOOL_OFFICE_PASS_HASH || "")
    .trim()
    .toLowerCase();
}

function isSha256Hex(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, body: "" };
    }
    if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
      return json(405, { error: "Method not allowed" });
    }

    requireSession(event);

    const body = event.httpMethod === "GET" ? {} : JSON.parse(event.body || "{}");
    const action = body.action || "status";

    if (body.password != null || body.pass != null || body.passcode != null) {
      return json(400, { error: "send hash only", configured: officeHashConfigured() });
    }

    if (action === "status") {
      return json(200, { configured: officeHashConfigured() });
    }

    if (action === "check") {
      const hash = String(body.hash || "").trim().toLowerCase();
      if (!isSha256Hex(hash)) {
        return json(400, { ok: false, error: "hash must be sha-256 hex" });
      }
      const expected = envHash();
      if (!isSha256Hex(expected)) {
        return json(200, { ok: false, configured: false });
      }
      return json(200, {
        ok: safeEqual(hash, expected),
        configured: true,
      });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    const status = err.statusCode || 500;
    return json(status, { error: err.message || "Office gate error" });
  }
};
