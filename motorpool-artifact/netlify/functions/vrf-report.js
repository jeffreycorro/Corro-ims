"use strict";

/**
 * Read-only monthly VRF report for a bot (and the same numbers as the page).
 *
 * GET /.netlify/functions/vrf-report?month=YYYY-MM
 * Authorization: Bearer <APPROVE_VRF_SECRET>
 *
 * Loads reserves and ledger the way the portal already does (getDoc / listIds).
 * It does not write a year, a month, or an index. No SQL.
 * The secret is never logged and never copied into the JSON.
 */

const fs = require("fs");
const path = require("path");
const { json, safeEqual } = require("../lib/session");
const { configuredSecret, requestSecret } = require("./approve-vrf");
const {
  buildMonthlyVrfReport,
  currentMonth,
  defaultReportMonth,
  parseMonth,
} = require("../../public/vrf-report");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-Approve-Secret",
  "access-control-max-age": "86400",
};

function reply(status, body) {
  return json(status, body, CORS);
}

function pageBuild() {
  try {
    const html = fs.readFileSync(path.join(__dirname, "../../public/index.html"), "utf8");
    const match = String(html).match(/var BUILD\s*=\s*"([^"]+)"/);
    return match ? match[1] : "";
  } catch (err) {
    return "";
  }
}

function rowsOf(doc) {
  const data = doc && doc.data != null ? doc.data : doc;
  if (!data) return [];
  if (Array.isArray(data.rows)) return data.rows.filter(Boolean);
  if (Array.isArray(data)) return data.filter(Boolean);
  return [];
}

function idList(doc, field) {
  const data = doc && doc.data != null ? doc.data : doc;
  const list = data && Array.isArray(data[field]) ? data[field] : [];
  return list.map(function (id) { return String(id || "").trim(); }).filter(Boolean);
}

function mergeIds(lists, re) {
  const out = [];
  const seen = {};
  lists.forEach(function (list) {
    (list || []).forEach(function (raw) {
      const id = String(raw || "").trim();
      if (!id || seen[id] || (re && !re.test(id))) return;
      seen[id] = 1;
      out.push(id);
    });
  });
  out.sort();
  return out;
}

/**
 * Read reserve years and ledger months up to the report month.
 * Index documents are only read. A mismatch is not written back.
 */
async function loadMonthlyVrfSources(month, io) {
  const getDoc = io.getDoc;
  const listIds = io.listIds;
  const [reserveIds, ledgerIds, reserveIndex, ledgerIndex] = await Promise.all([
    listIds("reserves").catch(function () { return []; }),
    listIds("ledger").catch(function () { return []; }),
    getDoc("reserves", "index").catch(function () { return null; }),
    getDoc("ledger", "index").catch(function () { return null; }),
  ]);
  const year = String(month).slice(0, 4);
  const years = mergeIds(
    [reserveIds, idList(reserveIndex, "years"), [year]],
    /^\d{4}$/
  );
  const months = mergeIds(
    [ledgerIds, idList(ledgerIndex, "months"), [month]],
    /^\d{4}-\d{2}$/
  ).filter(function (id) { return id <= month; });

  const yearDocs = await Promise.all(years.map(function (id) { return getDoc("reserves", id); }));
  const monthDocs = await Promise.all(months.map(function (id) { return getDoc("ledger", id); }));

  const reserves = [];
  yearDocs.forEach(function (doc) {
    rowsOf(doc).forEach(function (row) { reserves.push(row); });
  });
  const ledger = {};
  months.forEach(function (id, i) {
    ledger[id] = rowsOf(monthDocs[i]);
  });
  return { reserves: reserves, ledger: ledger };
}

function safeMessage(err) {
  const code = err && err.code;
  if (code === "bad_month" || code === "future_month") return err.message;
  return "Could not read the VRF records";
}

function createHandler(deps) {
  deps = deps || {};
  const load = deps.load || function (month) {
    const docs = require("../lib/supabase");
    return loadMonthlyVrfSources(month, { getDoc: docs.getDoc, listIds: docs.listIds });
  };
  const build = deps.build != null ? deps.build : pageBuild;

  return async function handler(event) {
    try {
      if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, headers: CORS, body: "" };
      }
      if (event.httpMethod !== "GET") {
        return reply(405, { error: "Method not allowed", code: "method_not_allowed" });
      }

      const expected = deps.secret != null ? String(deps.secret) : configuredSecret();
      if (!expected) {
        return reply(503, {
          error: "Report API is not configured.",
          code: "not_configured",
        });
      }
      const provided = requestSecret(event);
      if (!provided || !safeEqual(provided, expected)) {
        return reply(401, { error: "Unauthorized", code: "unauthorized" });
      }

      const params = (event && event.queryStringParameters) || {};
      const now = deps.now || new Date();
      let month = params.month == null ? "" : String(params.month).trim();
      if (!month) month = defaultReportMonth(now);
      else month = parseMonth(month);
      if (month > currentMonth(now)) {
        return reply(400, { error: "That month has not started yet.", code: "future_month" });
      }

      const sources = await load(month);
      const report = buildMonthlyVrfReport({
        month: month,
        reserves: sources && sources.reserves,
        ledger: sources && sources.ledger,
        now: now,
        build: typeof build === "function" ? build() : build,
      });
      return reply(200, report);
    } catch (err) {
      const status = err && err.statusCode ? err.statusCode : 500;
      const payload = { error: safeMessage(err) };
      if (err && err.code && (err.code === "bad_month" || err.code === "future_month")) payload.code = err.code;
      else if (status === 400 && err && err.code) payload.code = err.code;
      else payload.code = (err && err.code) || "read_failed";
      if (payload.code === "read_failed") payload.error = "Could not read the VRF records";
      return reply(status >= 400 && status < 600 ? status : 500, payload);
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.loadMonthlyVrfSources = loadMonthlyVrfSources;
exports.pageBuild = pageBuild;
