"use strict";

const { json, requireSession } = require("../lib/session");
const { rest } = require("../lib/supabase");
const { matchFinanceVouchers } = require("../lib/finance-voucher-match");

function unavailable(err) {
  const msg = String((err && err.message) || "");
  return err && (err.code === "unavailable" || /SUPABASE_URL|SUPABASE_SERVICE_ROLE/.test(msg));
}

/**
 * Read-only match of a Motorpool voucher number against Finance registers.
 * Does not insert, update, or delete. Returns the register label and status only.
 */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    requireSession(event);

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (err) {
      return json(400, { error: "Expected JSON" });
    }
    const numbers = Array.isArray(body.numbers)
      ? body.numbers
      : body.number != null
        ? [body.number]
        : [];
    if (numbers.length > 20) return json(400, { error: "At most 20 voucher numbers" });

    try {
      const results = await matchFinanceVouchers(numbers, rest);
      return json(200, { ok: true, available: true, results });
    } catch (err) {
      if (unavailable(err)) return json(200, { ok: true, available: false, results: [] });
      return json(err.statusCode || 502, { error: "Could not look up Finance vouchers" });
    }
  } catch (err) {
    const status = err.statusCode || 500;
    return json(status, { error: err.message || "Voucher lookup failed" });
  }
};
