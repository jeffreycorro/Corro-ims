"use strict";

/**
 * The cash desks (Petty Cash / GCash, in the Corro Materials web app) ↔ Motorpool VRFs (2026-11-24 a).
 * Jeffrey: "we have this dilemma in the motorpool portal and most of these copies and data are in the petty cash and
 * finance. how can we connect them" — 321 VRFs partly or not liquidated, none carrying a petty cash voucher no., while
 * the receipts sit on the vouchers in the web app.
 *
 * GET  ?months=3                      open VRFs of the last N months (for the desk's "which VRF?" list)
 * POST { vrf, voucherNo, fund, batch, amount, actual, orNo, receipts: [url], by, note }
 *      files each receipt link under the VRF's Receipts & proof (photos owner LIQ-<vrf>, kind "link"), captioned with the
 *      voucher, OR no. and amount, and counts it on ops/photoindex, so the VRF no longer reads "no receipt".
 *      A link already filed for that VRF is not filed twice. Nothing else on the VRF is changed.
 *
 * Header X-Cash-Link-Secret must equal CASH_LINK_SECRET (Netlify env). The secret is never logged or echoed.
 */

const { json, safeEqual } = require("../lib/session");
const { getDoc, setDoc, listPhotoMeta, listIds } = require("../lib/supabase");
const { loadMonthlyVrfSources } = require("./vrf-report");
const { buildMonthlyVrfReport, currentMonth } = require("../../public/vrf-report");

function reply(status, body) { return json(status, body); }

function configured() { return String(process.env.CASH_LINK_SECRET || "").trim(); }
function provided(event) {
  const h = (event && event.headers) || {};
  return String(h["x-cash-link-secret"] || h["X-Cash-Link-Secret"] || "").trim();
}

function cleanVrf(v) { const s = String(v == null ? "" : v).trim(); return /^\d{3,6}$/.test(s) ? s : ""; }
function cleanText(v, n) { return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n || 120); }
function cleanUrl(u) {
  const s = String(u || "").trim();
  return /^https:\/\/(drive|docs)\.google\.com\/[^\s"'<>]{5,400}$/.test(s) ? s : "";
}
function photoKey(owner, n) { return "vrf-" + String(owner).replace(/[^A-Za-z0-9_.~:@+-]/g, "_") + "__" + n; }
function peso(n) { const x = Number(n); return isFinite(x) ? "₱" + x.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; }
function monthsBack(now, n) {
  const out = [];
  let [y, m] = currentMonth(now).split("-").map(Number);
  for (let i = 0; i < n; i++) { out.push(y + "-" + String(m).padStart(2, "0")); m -= 1; if (!m) { m = 12; y -= 1; } }
  return out;
}

/** Open VRFs: not fully liquidated, or liquidated with no receipt on file. */
async function openVrfs(months, deps) {
  const load = deps.load || ((month) => loadMonthlyVrfSources(month, { getDoc, listIds }));
  const now = deps.now || new Date();
  const counts = ((await (deps.getDoc || getDoc)("ops", "photoindex").catch(() => null)) || {}).data || {};
  const pc = (counts && counts.counts) || {};
  const seen = new Set(), out = [];
  for (const month of monthsBack(now, months)) {
    const src = await load(month);
    const rep = buildMonthlyVrfReport({ month, reserves: src && src.reserves, ledger: src && src.ledger, now });
    (rep.vrfs || []).forEach((r) => {
      const no = cleanVrf(r.vrf);
      if (!no || seen.has(no)) return;
      seen.add(no);
      const receipts = pc["LIQ-" + no] || 0;
      const st = String(r.status || "");
      if (/cancel|reject|duplicate/i.test(st)) return;
      if (/liquidated/i.test(st) && !/partial|unliquidated|not liquidated/i.test(st) && receipts > 0) return;
      out.push({ vrf: no, date: r.date || "", unit: r.unit || "", requestedBy: r.requestedBy || "", jobType: r.jobType || "",
        description: cleanText(r.description, 160), project: r.project || "", approved: r.approved || 0, actual: r.actual || 0,
        status: st, voucherNo: r.voucherNo || "", receipts });
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

async function fileReceipts(body, deps) {
  const vrf = cleanVrf(body.vrf);
  if (!vrf) { const e = new Error("A motorpool VRF number (digits) is needed."); e.statusCode = 400; throw e; }
  const voucherNo = cleanText(body.voucherNo, 40);
  if (!voucherNo) { const e = new Error("Which voucher paid it?"); e.statusCode = 400; throw e; }
  const urls = (Array.isArray(body.receipts) ? body.receipts : []).map(cleanUrl).filter(Boolean).slice(0, 12);
  const owner = "LIQ-" + vrf;
  const list = deps.listPhotoMeta || listPhotoMeta, get = deps.getDoc || getDoc, set = deps.setDoc || setDoc;
  const existing = await list(owner);
  const have = new Set(existing.map((x) => String((x && x.url) || "")).filter(Boolean));
  let idx = existing.reduce((a, x) => Math.max(a, Number(x && x.idx) || 0), 0);
  const fund = cleanText(body.fund, 20) || "Petty cash";
  const caption = [fund + " " + voucherNo, body.batch ? cleanText(body.batch, 20) : "", body.orNo ? "OR " + cleanText(body.orNo, 40) : "",
    body.actual != null && body.actual !== "" ? "spent " + peso(body.actual) : (body.amount != null ? "released " + peso(body.amount) : ""),
    cleanText(body.note, 80)].filter(Boolean).join(" · ");
  const by = cleanText(body.by, 60) || "Cash desk";
  const at = new Date().toISOString();
  let added = 0;
  for (const url of urls) {
    if (have.has(url)) continue;
    idx += 1;
    await set("photos", photoKey(owner, idx), { vrf: owner, idx, kind: "link", url, linkKind: "photo", caption, by, at, source: "cash-desk", voucherNo });
    have.add(url);
    added += 1;
  }
  if (added) {
    const doc = await get("ops", "photoindex").catch(() => null);
    const counts = Object.assign({}, ((doc && doc.data) || {}).counts || {});
    counts[owner] = (counts[owner] || 0) + added;
    await set("ops", "photoindex", Object.assign({}, (doc && doc.data) || {}, { counts }));
  }
  return { ok: true, vrf, voucherNo, added, alreadyFiled: urls.length - added, caption };
}

function createHandler(deps) {
  deps = deps || {};
  return async function handler(event) {
    try {
      if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
      const expected = deps.secret != null ? String(deps.secret) : configured();
      if (!expected) return reply(503, { error: "Cash link is not configured.", code: "not_configured" });
      const got = provided(event);
      if (!got || !safeEqual(got, expected)) return reply(401, { error: "Unauthorized", code: "unauthorized" });
      if (event.httpMethod === "GET") {
        const q = (event.queryStringParameters) || {};
        const months = Math.max(1, Math.min(4, Number(q.months) || 3));
        return reply(200, { ok: true, vrfs: await openVrfs(months, deps) });
      }
      if (event.httpMethod === "POST") {
        let body = {};
        try { body = JSON.parse(event.body || "{}"); } catch (e) { return reply(400, { error: "Expected JSON" }); }
        return reply(200, await fileReceipts(body, deps));
      }
      return reply(405, { error: "Method not allowed" });
    } catch (err) {
      const status = err && err.statusCode ? err.statusCode : 500;
      return reply(status >= 400 && status < 600 ? status : 500, { error: status < 500 ? err.message : "Cash link failed" });
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.fileReceipts = fileReceipts;
exports.openVrfs = openVrfs;
