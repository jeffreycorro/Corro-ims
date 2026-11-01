#!/usr/bin/env node
"use strict";
/**
 * Dry run: counts VRFs per liquidation status. READS ONLY. Writes nothing.
 *
 *   node scripts/liquidation-dry-run.js --file export.json
 *     export.json = {"ledger":[{id,vrf,rows:[...]}], "reserves":[reserve data...]}
 *     (produced by the read-only SELECT in scripts/liquidation-dry-run.sql)
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE=... node scripts/liquidation-dry-run.js
 *     reads motorpool_records with GET requests only.
 *
 * Status uses public/vrf-liquidation.js, the same code the portal runs.
 * Proof counts come from ops/photoindex (LIQ-<vrf> owners) when read live;
 * with --file there are no LIQ uploads yet, so only fuelPhotos.receipt counts.
 */
const fs = require("fs");
const L = require("../public/vrf-liquidation");

function ledgerStatus(rows) {
  const st = rows.map((r) => String((r && r.vstatus) || "").trim());
  const live = st.filter(Boolean);
  if (!live.length) return "Legacy";
  if (live.some((s) => s === "Open")) return "Open";
  if (live.some((s) => s === "Closed")) return "Closed";
  return live[0];
}
function reserveStatus(r) {
  const s = String(r.status || "");
  if (/^(cancelled|rejected|archived)$/i.test(s) || r.cancelledAt) return r.cancelOutcome === "duplicate" ? "Duplicate" : "Cancelled";
  if (/^(requested|draft)$/i.test(s)) return "Requested";
  if (r.liquidatedAt || s === "Closed") return "Closed";
  return "Open";
}

function buildEntries(data) {
  const byVrf = new Map();
  (data.ledger || []).forEach((rec) => {
    const rows = rec.rows || [];
    const no = String(rec.vrf || String(rec.id || "").replace(/^ledger:/, ""));
    const liqRow = rows.find((r) => r && r.liq && r.liq.at);
    const status = ledgerStatus(rows);
    byVrf.set(no, {
      vrf: no, status, legacy: status === "Legacy", rows,
      total: L.ledgerTotal(rows), liq: liqRow ? liqRow.liq : null,
      approvedAt: (rows[0] && rows[0].date) || "", date: (rows[0] && rows[0].date) || "",
      requestedBy: (rows[0] && rows[0].requestedBy) || "", veh: (rows[0] && rows[0].veh) || "",
    });
  });
  (data.reserves || []).forEach((r) => {
    const no = String(r.vrfNo || "").trim();
    if (!no) return;
    const prev = byVrf.get(no) || { vrf: no, rows: [], total: null };
    byVrf.set(no, Object.assign({}, prev, {
      status: reserveStatus(r), legacy: false, held: true,
      approvedBudget: r.approvedBudget != null ? r.approvedBudget : r.budget,
      actual: r.actual, kind: r.kind, fuelPhotos: r.fuelPhotos || null,
      approvedAt: r.approvedAt || prev.approvedAt || r.date, date: r.date || prev.date,
      requestedBy: r.requestedBy || prev.requestedBy, veh: r.veh || prev.veh,
      liq: prev.liq || (r.liquidatedAt ? { at: r.liquidatedAt, by: r.justifiedBy || "", outcome: r.cancelOutcome || "" } : null),
      total: prev.total != null && prev.rows && prev.rows.length ? prev.total : (r.actual != null ? r.actual : r.approvedBudget),
    }));
  });
  return Array.from(byVrf.values());
}

async function readLive() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE || "";
  if (!url || !key) throw new Error("Pass --file, or set SUPABASE_URL and SUPABASE_SERVICE_ROLE.");
  const headers = { apikey: key, authorization: "Bearer " + key };
  async function page(kind) {
    let out = [], offset = 0;
    for (;;) {
      const res = await fetch(`${url}/rest/v1/motorpool_records?kind=eq.${kind}&select=id,vrf_no,data&order=id.asc&limit=500&offset=${offset}`, { headers });
      if (!res.ok) throw new Error("read failed: HTTP " + res.status);
      const rows = await res.json();
      out = out.concat(rows);
      if (rows.length < 500) return out;
      offset += 500;
    }
  }
  const ledger = (await page("ledger")).map((r) => ({ id: r.id, vrf: r.vrf_no, rows: (r.data && r.data.rows) || [] }));
  const reserves = (await page("reserve")).map((r) => r.data);
  return { ledger, reserves };
}

function summarize(entries, proofCounts, today) {
  const counts = L.countByStatus(entries, {}, proofCounts);
  const open = L.unliquidatedRows(entries.filter((e) => !e.legacy), {}, proofCounts, { today });
  const t = L.totals(open);
  const lines = { total: 0, withStatus: 0, byVstatus: {}, withLiqStamp: 0 };
  entries.forEach((e) => (e.rows || []).forEach((r) => {
    lines.total++;
    const v = String((r && r.vstatus) || "");
    if (v) { lines.withStatus++; lines.byVstatus[v] = (lines.byVstatus[v] || 0) + 1; }
    if (r && r.liq && r.liq.at) lines.withLiqStamp++;
  }));
  const liquidatedBy = {};
  entries.forEach((e) => { if (e.liq && e.liq.by) liquidatedBy[e.liq.by] = (liquidatedBy[e.liq.by] || 0) + 1; });
  return { today, vrfs: entries.length, counts, unliquidatedView: t, ledgerLines: lines, liquidatedBy };
}

async function main() {
  const i = process.argv.indexOf("--file");
  const data = i > 0 ? JSON.parse(fs.readFileSync(process.argv[i + 1], "utf8")) : await readLive();
  const entries = buildEntries(data);
  const out = summarize(entries, {}, L.manilaToday());
  console.log("DRY RUN — nothing was written.");
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { buildEntries, summarize, ledgerStatus, reserveStatus };
