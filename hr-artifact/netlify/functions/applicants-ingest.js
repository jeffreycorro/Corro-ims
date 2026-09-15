"use strict";

const { json } = require("../lib/session");
const { getDoc, setDoc, listCollection } = require("../lib/supabase");
const { formatManilaDate, formatManilaIso } = require("../lib/manila");
const { createLimiter } = require("../lib/rate-limit");
const {
  authorizeIngest,
  ingestApplicants,
  parseIngestBody,
} = require("../lib/applicants-ingest");

const checkIngestLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: "Too many ingest requests. Try again later.",
});

function createHandler(deps = {}) {
  const load = deps.getDoc || getDoc;
  const save = deps.setDoc || setDoc;
  const list = deps.listCollection || listCollection;
  const todayFn = deps.today || formatManilaDate;

  return async function handler(event) {
    try {
      if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, body: "" };
      }
      if (event.httpMethod !== "POST") {
        return json(405, { error: "Method not allowed" });
      }

      const auth = authorizeIngest(event);
      if (auth.method === "ingest-key") {
        checkIngestLimit(event);
      }

      const parsed = parseIngestBody(event.body);
      const result = await ingestApplicants(parsed.applicants, {
        getDoc: load,
        setDoc: save,
        listCollection: list,
        today: todayFn(),
        batchOverwrite: parsed.overwrite,
        batchForceNew: parsed.forceNew,
      });

      return json(200, {
        ...result,
        timezone: "Asia/Manila",
        serverTime: formatManilaIso(),
      });
    } catch (err) {
      const status = err.statusCode || 500;
      const body = { error: (err && err.message) || "Ingest error" };
      if (err && err.code) body.code = err.code;
      return json(status, body);
    }
  };
}

exports.createHandler = createHandler;
exports.handler = createHandler();
