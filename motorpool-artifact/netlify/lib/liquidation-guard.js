"use strict";
/**
 * Server-side liquidation proof check (2026-11-02).
 *
 * Runs before every motorpool_records write made by the Netlify db function
 * (UI saves, the Liquidate button, ledger blob saves, reserve closes). The
 * Postgres trigger in supabase/migrations/20261102000001_motorpool_liquidation_proof.sql
 * enforces the same rule for any other writer.
 *
 * A write is checked only when it TRANSITIONS a VRF into Liquidated:
 *   ledger: the stored record has no Closed bought line, the new one has one.
 *   reserve: the stored reserve is not Closed/Flagged, the new one is, with
 *            liquidatedAt set.
 * Rows that were already Liquidated, and unrelated saves, pass untouched.
 */
const V = require("../../public/vrf-liquidation");

const DEAD = /^(cancelled|canceled|not-bought|duplicate)$/i;
const CLOSED_RESERVE = /^(closed|flagged)$/i;

function proofError(vrf, errors) {
  const msgs = (errors || []).map((e) => e.msg);
  const err = new Error(`VRF ${vrf} cannot be set Liquidated without proof: ${msgs.join(" ")}`);
  err.statusCode = 409;
  err.code = "liquidation_proof_required";
  err.errors = errors;
  return err;
}

function closedBoughtLines(rows) {
  return (rows || []).filter(
    (r) => r && r.vstatus === "Closed" && !r.notBought && !DEAD.test(String((r.liq && r.liq.outcome) || ""))
  );
}
function hasClosedLine(rows) {
  return (rows || []).some((r) => r && r.vstatus === "Closed");
}
function rowsOf(rec) {
  return (rec && rec.data && Array.isArray(rec.data.rows) && rec.data.rows) || [];
}
function lineTotal(rows) {
  return V.ledgerTotal(rows);
}

/** True when this ledger write newly liquidates the VRF. */
function ledgerTransition(existing, next) {
  if (hasClosedLine(rowsOf(existing))) return false;
  return closedBoughtLines(rowsOf(next)).length > 0;
}

function approvedFor(reserve, vrf, rows) {
  const d = reserve && reserve.data;
  if (d) {
    const vrfs = Array.isArray(d.vrfs) ? d.vrfs.map(String) : [];
    if (vrfs.length <= 1 && (d.approvedBudget != null || d.budget != null)) {
      return Number(d.approvedBudget != null ? d.approvedBudget : d.budget) || 0;
    }
  }
  return null; /* multi-VRF reserve or none: use the proof's own approved figure */
}

/**
 * io: { readRecord(id), listPhotoMeta(owner), getDoc(collection,id) }
 */
async function checkLedgerWrite(next, existing, io) {
  if (!next || next.kind !== "ledger") return;
  if (!ledgerTransition(existing, next)) return;
  const vrf = String(next.vrf_no || (next.data && next.data.vrf) || String(next.id || "").replace(/^ledger:/, ""));
  const rows = rowsOf(next).filter((r) => r && String(r.vrf) === vrf);
  const line = closedBoughtLines(rows)[0];
  const proof = (line && line.liq && line.liq.proof) || null;
  if (!proof) {
    throw proofError(vrf, [{ field: "proof", msg: "Use the Liquidate dialog: actual amount, date, receipt and who liquidated it are required." }]);
  }
  const entry = { vrf, rows };
  const fuelReserve = V.isReserveWithdrawal(entry);
  const [vrfItems, liqItems] = await Promise.all([io.listPhotoMeta(vrf), io.listPhotoMeta(V.liqOwner(vrf))]);
  const counts = V.proofCounts(vrfItems, liqItems);
  const reserve = next.reserve_no ? await io.readRecord("reserve:" + next.reserve_no) : null;
  const approvedServer = approvedFor(reserve, vrf, rows);
  const approved = approvedServer != null ? approvedServer : Number(proof.approved) || 0;
  const litres = V.fuelLitresOfRows(rows);
  let withdrawal = null;
  if (fuelReserve && V.REQUIRE_FUEL_WITHDRAWAL_MATCH) {
    const doc = await io.getDoc("fuel", "withdrawals");
    const list = (doc && doc.data && doc.data.rows) || [];
    const ref = proof.fuel && proof.fuel.withdrawal && proof.fuel.withdrawal.ref;
    const idx = ref ? Number(String(ref).split("|").pop()) : -1;
    const w = idx >= 0 ? list[idx] : null;
    if (w && V.withdrawalRef(w, idx) === ref) withdrawal = { ref, liters: Number(w.liters) || 0 };
  }
  const errors = V.checkLiquidation(
    {
      actual: proof.actual,
      date: proof.date,
      by: proof.by,
      change: proof.change,
      overReason: proof.overReason,
      counts,
      withdrawal,
    },
    { approved, fuelReserve, litres, today: V.manilaToday() }
  ).errors.slice();
  const actualLines = lineTotal(rows);
  if (Math.abs((Number(proof.actual) || 0) - actualLines) > 0.01) {
    errors.push({ field: "actual", msg: `The actual amount (${proof.actual}) does not match the closed lines (${actualLines}).` });
  }
  if (errors.length) throw proofError(vrf, errors);
}

/** A reserve may close only once every VRF on it is closed on the ledger. */
async function checkReserveWrite(next, existing, io) {
  if (!next || next.kind !== "reserve") return;
  const d = next.data || {};
  const was = (existing && existing.data) || {};
  if (!CLOSED_RESERVE.test(String(d.status || "")) || !d.liquidatedAt) return;
  if (CLOSED_RESERVE.test(String(was.status || ""))) return;
  const vrfs = (Array.isArray(d.vrfs) ? d.vrfs : []).concat(d.vrfNo ? [d.vrfNo] : []).map(String).filter(Boolean);
  const uniq = Array.from(new Set(vrfs));
  if (!uniq.length) {
    throw proofError("RSV-" + (d.no || ""), [{ field: "reserve", msg: "A reserve closes only through its VRFs' liquidation." }]);
  }
  const open = [];
  for (const no of uniq) {
    const rec = await io.readRecord("ledger:" + no);
    const rows = rowsOf(rec);
    const done = rows.length > 0 && rows.every((r) => r && r.vstatus !== "Open");
    if (!done) open.push(no);
  }
  if (open.length) {
    throw proofError(open.join(", "), [{ field: "reserve", msg: "Liquidate the VRF(s) with their receipts before closing the reserve." }]);
  }
}

async function guardRecordWrite(next, io) {
  if (!next || (next.kind !== "ledger" && next.kind !== "reserve")) return;
  if (next.kind === "ledger" && !closedBoughtLines(rowsOf(next)).length) return;
  if (next.kind === "reserve" && !CLOSED_RESERVE.test(String((next.data && next.data.status) || ""))) return;
  const existing = await io.readRecord(next.id);
  if (next.kind === "ledger") return checkLedgerWrite(next, existing, io);
  return checkReserveWrite(next, existing, io);
}

module.exports = { checkLedgerWrite, checkReserveWrite, guardRecordWrite, ledgerTransition, closedBoughtLines };
