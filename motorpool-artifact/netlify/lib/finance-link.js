"use strict";

/**
 * Read-only lookup of Finance liquidation receipts for one Motorpool VRF.
 *
 * The Finance app (finance-artifact) keeps its tables in the same Supabase
 * project as Motorpool (see finance-artifact/README.md "SQL to run by hand").
 * finance_liquidation_receipts has no VRF column. It hangs off
 * finance_cash_advances (advance_id), and an advance carries
 * motorpool_source_id / source_number. Finance vouchers carry vrf_no.
 * So the link is: VRF -> advances (motorpool_source_id or source_number)
 * -> receipts, plus vouchers by vrf_no, plus any reference the Motorpool
 * team typed (CA no., voucher no., receipt id).
 *
 * Nothing here writes. If the Finance tables are missing on this site's
 * database, it answers available:false and the portal shows the stored
 * references only.
 */

const { rest } = require("./supabase");

function cleanVrf(v) {
  const s = String(v == null ? "" : v).trim();
  return /^[A-Za-z0-9_.-]{1,40}$/.test(s) ? s : "";
}
function cleanRef(v) {
  const s = String(v == null ? "" : v).trim();
  return /^[A-Za-z0-9_.\-/ ]{1,80}$/.test(s) ? s : "";
}
function inList(values) {
  return "(" + values.map((v) => '"' + String(v).replace(/"/g, "") + '"').join(",") + ")";
}
function isMissingTable(err) {
  const m = String((err && err.message) || "");
  return (err && (err.statusCode === 404 || err.code === "42P01" || err.code === "PGRST205")) ||
    /does not exist|Could not find the table/i.test(m);
}

async function safeRest(args) {
  try {
    const out = await rest(Object.assign({ method: "GET" }, args));
    return Array.isArray(out) ? out : [];
  } catch (err) {
    if (isMissingTable(err)) {
      const e = new Error("finance tables missing");
      e.missing = true;
      throw e;
    }
    throw err;
  }
}

async function financeLiquidationForVrf(vrf, refs, io) {
  const get = (io && io.get) || safeRest;
  const no = cleanVrf(vrf);
  if (!no) return { vrf: "", available: false, reason: "no VRF number", advances: [], receipts: [], vouchers: [] };
  const typed = (Array.isArray(refs) ? refs : []).map(cleanRef).filter(Boolean).slice(0, 10);
  const keys = [no, "VRF-" + no, "VRF " + no].concat(typed);
  try {
    const advances = await get({
      path: "/rest/v1/finance_cash_advances",
      query: "select=id,ca_no,status,employee_name,amount,liquidated_amount,liquidated_on,motorpool_source_id,source_number" +
        "&or=(motorpool_source_id.in." + encodeURIComponent(inList(keys)) +
        ",source_number.in." + encodeURIComponent(inList(keys)) +
        ",ca_no.in." + encodeURIComponent(inList(typed.length ? typed : ["-"])) + ")&limit=20",
    });
    const ids = advances.map((a) => a.id).filter(Boolean);
    const receipts = ids.length
      ? await get({
          path: "/rest/v1/finance_liquidation_receipts",
          query: "select=id,advance_id,receipt_date,particulars,amount,attachment_id&advance_id=in." +
            encodeURIComponent(inList(ids)) + "&order=receipt_date.asc&limit=200",
        })
      : [];
    const byId = typed.length
      ? await get({
          path: "/rest/v1/finance_liquidation_receipts",
          query: "select=id,advance_id,receipt_date,particulars,amount,attachment_id&id=in." +
            encodeURIComponent(inList(typed)) + "&limit=20",
        })
      : [];
    const vouchers = await get({
      path: "/rest/v1/finance_vouchers",
      query: "select=id,dv_no,status,payee,amount,vrf_no&vrf_no=eq." + encodeURIComponent(no) + "&limit=20",
    }).catch(() => []);
    const seen = new Set();
    const allReceipts = receipts.concat(byId).filter((r) => {
      if (!r || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    const total = Math.round(allReceipts.reduce((a, r) => a + (Number(r.amount) || 0), 0) * 100) / 100;
    return { vrf: no, available: true, advances, receipts: allReceipts, vouchers, receiptTotal: total, refs: typed };
  } catch (err) {
    if (err && err.missing) {
      return { vrf: no, available: false, reason: "Finance tables are not on this database", advances: [], receipts: [], vouchers: [], refs: typed };
    }
    throw err;
  }
}

module.exports = { financeLiquidationForVrf, cleanVrf, cleanRef };
