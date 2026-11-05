"use strict";

/**
 * Read-only list of liquidated VRFs whose peso variance is above 50%.
 * GET /.netlify/functions/liquidation-variance-report
 * Authorization: Bearer <APPROVE_VRF_SECRET>
 *
 * Does not approve, write, or change a record. Jeffrey can review this
 * before a deploy so an existing overrun is not a surprise.
 */

const { json, safeEqual } = require("../lib/session");
const { configuredSecret, requestSecret } = require("./approve-vrf");
const { liquidationVarianceReport } = require("../lib/liquidation-variance");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-Approve-Secret",
  "access-control-max-age": "86400",
};

function reply(status, body) {
  return json(status, body, CORS);
}

function rowsOf(doc) {
  const data = doc && doc.data != null ? doc.data : doc;
  if (!data) return [];
  if (Array.isArray(data.rows)) return data.rows.filter(Boolean);
  if (Array.isArray(data)) return data.filter(Boolean);
  return [];
}

function vrfsFromLedger(ledger) {
  const by = {};
  Object.keys(ledger || {}).forEach(function (month) {
    (ledger[month] || []).forEach(function (row) {
      if (!row || row.vrf == null || String(row.vrf).trim() === "") return;
      const no = String(row.vrf).trim();
      if (!by[no]) by[no] = { vrf: no, status: "", rows: [], reserve: "" };
      by[no].rows.push(row);
      if (row.vstatus) by[no].status = String(row.vstatus);
      if (row.liq) by[no].liq = row.liq;
      if (row.reserve) by[no].reserve = String(row.reserve);
    });
  });
  return Object.keys(by).map(function (k) {
    return by[k];
  });
}

async function loadVarianceSources(io) {
  const getDoc = io.getDoc;
  const listIds = io.listIds;
  const [reserveIds, ledgerIds, issued] = await Promise.all([
    listIds("reserves").catch(function () { return []; }),
    listIds("ledger").catch(function () { return []; }),
    getDoc("config", "issued").catch(function () { return null; }),
  ]);
  const years = (reserveIds || []).map(String).filter(function (id) { return /^\d{4}$/.test(id); });
  const months = (ledgerIds || []).map(String).filter(function (id) { return /^\d{4}-\d{2}$/.test(id); });
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
  const issuedData = issued && issued.data != null ? issued.data : issued;
  return {
    issued: issuedData && issuedData.numbers ? issuedData : { numbers: (issuedData && issuedData.numbers) || {} },
    reserves: reserves,
    vrfs: vrfsFromLedger(ledger),
  };
}

function createHandler(deps) {
  deps = deps || {};
  const load = deps.load || function () {
    const docs = require("../lib/supabase");
    return loadVarianceSources({ getDoc: docs.getDoc, listIds: docs.listIds });
  };
  return async function handler(event) {
    try {
      if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
      if (event.httpMethod !== "GET") {
        return reply(405, { error: "Method not allowed", code: "method_not_allowed" });
      }
      const expected = deps.secret != null ? String(deps.secret) : configuredSecret();
      if (!expected) {
        return reply(503, { error: "Report API is not configured.", code: "not_configured" });
      }
      const provided = requestSecret(event);
      if (!provided || !safeEqual(provided, expected)) {
        return reply(401, { error: "Unauthorized", code: "unauthorized" });
      }
      const sources = await load();
      const report = liquidationVarianceReport(sources || {});
      report.readOnly = true;
      return reply(200, report);
    } catch (err) {
      return reply(500, { error: "Could not read the VRF records", code: "read_failed" });
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.loadVarianceSources = loadVarianceSources;
exports.vrfsFromLedger = vrfsFromLedger;
