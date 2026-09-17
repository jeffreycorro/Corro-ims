"use strict";

const { json, requireSession } = require("../lib/session");
const { rest } = require("../lib/supabase");
const { canReadHrLeaves, lookupLeaves } = require("../lib/hr-leave-lookup");
const { codedError, errorBody } = require("../lib/coded-error");
const { createLimiter } = require("../lib/rate-limit");
const { formatManilaIso } = require("../lib/manila");

const limitLookup = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: "Too many leave lookups. Try again in a moment.",
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const session = requireSession(event);
    if (!canReadHrLeaves(session)) {
      return json(200, {
        timezone: "Asia/Manila",
        serverTime: formatManilaIso(),
        available: false,
        note:
          "Leave applications live in the HR portal. This Motorpool login cannot read them. " +
          "An HR or admin account can ask here, or ask the same question under Ask the records.",
      });
    }

    limitLookup(event);

    const body = JSON.parse(event.body || "{}");
    const result = await lookupLeaves(body.query != null ? body.query : body.empNo || body.name, {
      rest,
    });

    return json(200, {
      timezone: "Asia/Manila",
      serverTime: formatManilaIso(),
      ...result,
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return json(400, errorBody(codedError("bad_request", "Invalid JSON")));
    }
    const status = err.statusCode || 500;
    return json(status, errorBody(err));
  }
};
