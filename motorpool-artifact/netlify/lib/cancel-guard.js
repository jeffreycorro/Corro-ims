"use strict";
/**
 * Server-side cancel approval guard (2026-11-02).
 *
 * Runs before every motorpool_records write made by the Netlify functions
 * (writeRecord in lib/supabase.js). The Postgres trigger in
 * supabase/migrations/20261102000002_motorpool_cancel_approval.sql enforces
 * the same status rule for every other writer (SQL RPCs, the SQL editor).
 *
 * Rules
 *  1. ledger: a line may become vstatus "Cancelled" only when the stored
 *     reserve holds an Approved cancel request for that VRF covering that line
 *     (scope "vrf", or lines[] containing the line index).
 *  2. reserve: status may become "Cancelled" with cancelOutcome "cancelled"
 *     (or none) only when the reserve has an Approved request for one of its
 *     VRFs. Not-bought and duplicate closes are not cancellations and pass.
 *  3. reserve: deciding a request (Requested -> Approved / Rejected), adding an
 *     already-decided request, editing a decided one, or deleting any request
 *     needs an approver: the approve-cancel function (APPROVE_VRF_SECRET), a
 *     signed-in admin, a name/email in MOTORPOOL_CANCEL_APPROVERS, or the
 *     Office passcode (the same gate the portal uses for VRF approval).
 *
 * Admin repair bypass: set Netlify env MOTORPOOL_ALLOW_CANCEL_WITHOUT_APPROVAL=on
 * (and redeploy). In SQL: set local motorpool.allow_cancel_without_approval = 'on';
 */
const { AsyncLocalStorage } = require("async_hooks");
const C = require("../../public/vrf-cancel");

const als = new AsyncLocalStorage();
const NOT_CANCEL_OUTCOME = /^(not-bought|duplicate)$/i;

function runWithContext(ctx, fn) {
  return als.run(Object.assign({}, ctx || {}), fn);
}
function currentContext() {
  return als.getStore() || {};
}

function bypassOn() {
  return /^(on|true|1|yes)$/i.test(String(process.env.MOTORPOOL_ALLOW_CANCEL_WITHOUT_APPROVAL || "").trim());
}

function guardError(message, code) {
  const e = new Error(message);
  e.statusCode = code === "cancel_approver_required" ? 403 : 409;
  e.code = code || "cancel_approval_required";
  return e;
}

function rowsOf(rec) {
  return (rec && rec.data && Array.isArray(rec.data.rows) && rec.data.rows) || [];
}
function isCancelled(row) {
  return !!row && String(row.vstatus || "") === "Cancelled";
}

/** Approver check for the db function. pass = typed Office passcode. */
function isApprover(session, opts) {
  const o = opts || {};
  const s = session || {};
  if (String(s.role || "").toLowerCase() === "admin") return true;
  const list = String(process.env.MOTORPOOL_CANCEL_APPROVERS || "")
    .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const ids = [s.email, s.name, s.full_name].map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  if (list.length && ids.some((x) => list.indexOf(x) >= 0)) return true;
  if (o.pass && o.cfgPass && C.officeHash(String(o.pass)) === String(o.cfgPass)) return true;
  const envHash = String(process.env.MOTORPOOL_OFFICE_PASS_HASH || "").trim().toLowerCase();
  if (o.pass && /^[a-f0-9]{64}$/.test(envHash) &&
      require("crypto").createHash("sha256").update(String(o.pass)).digest("hex") === envHash) return true;
  return false;
}

async function checkLedger(next, existing, io) {
  const before = rowsOf(existing);
  const after = rowsOf(next);
  const fresh = [];
  after.forEach((r, i) => {
    if (isCancelled(r) && !isCancelled(before[i])) fresh.push(i);
  });
  if (!fresh.length) return;
  const vrf = String(next.vrf_no || (after[0] && after[0].vrf) || String(next.id || "").replace(/^ledger:/, ""));
  const rsvNo = next.reserve_no || (existing && existing.reserve_no) || (after[0] && after[0].reserve) || "";
  const rsv = rsvNo ? await io.readRecord("reserve:" + rsvNo) : null;
  const data = (rsv && rsv.data) || null;
  const missing = fresh.filter((i) => !C.approvedCovers(data, vrf, i));
  if (missing.length) {
    throw guardError(
      `VRF ${vrf} line(s) ${missing.map((i) => i + 1).join(", ")} cannot be set Cancelled without an approved cancellation request. Use "Request cancellation".`
    );
  }
}

function sameRequest(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function checkReserve(next, existing, ctx) {
  const d = next.data || {};
  const was = (existing && existing.data) || {};
  const oldList = Array.isArray(was.cancelRequests) ? was.cancelRequests : [];
  const newList = Array.isArray(d.cancelRequests) ? d.cancelRequests : [];
  const oldById = {};
  oldList.forEach((q) => { if (q && q.id) oldById[q.id] = q; });
  const newIds = {};
  let needsApprover = false;
  newList.forEach((q) => {
    if (!q || !q.id) return;
    newIds[q.id] = 1;
    const prev = oldById[q.id];
    if (!prev) {
      if (q.status !== "Requested") needsApprover = true;
      return;
    }
    if (prev.status !== "Requested" && !sameRequest(prev, q)) needsApprover = true;
    if (prev.status === "Requested" && q.status !== "Requested") needsApprover = true;
  });
  if (oldList.some((q) => q && q.id && !newIds[q.id])) needsApprover = true;
  if (needsApprover && !ctx.approver) {
    throw guardError("Only an approver can approve, reject or change a cancellation request.", "cancel_approver_required");
  }
  const nowCancelled = String(d.status || "") === "Cancelled" && !NOT_CANCEL_OUTCOME.test(String(d.cancelOutcome || ""));
  const wasCancelled = String(was.status || "") === "Cancelled";
  if (nowCancelled && !wasCancelled) {
    const vrfs = Array.from(new Set((Array.isArray(d.vrfs) ? d.vrfs : []).concat(d.vrfNo ? [d.vrfNo] : []).map(String)));
    const ok = newList.some((q) => q && q.status === "Approved" && q.decidedBy && q.decidedAt &&
      (!vrfs.length || vrfs.indexOf(String(q.vrf)) >= 0));
    if (!ok) {
      throw guardError(`RSV-${d.no || next.reserve_no || ""} cannot be set Cancelled without an approved cancellation request.`);
    }
  }
}

/** Called from writeRecord. io: { readRecord(id) } */
async function guardCancelWrite(next, io, ctxIn) {
  if (!next || (next.kind !== "ledger" && next.kind !== "reserve")) return;
  if (bypassOn()) return;
  const ctx = ctxIn || currentContext();
  if (next.kind === "ledger") {
    if (!rowsOf(next).some(isCancelled)) return;
    const existing = await io.readRecord(next.id);
    return checkLedger(next, existing, io);
  }
  const d = next.data || {};
  if (!Array.isArray(d.cancelRequests) && String(d.status || "") !== "Cancelled") {
    /* Could still be a deletion of every request: compare with stored. */
    const existing = await io.readRecord(next.id);
    const was = (existing && existing.data) || {};
    if (!Array.isArray(was.cancelRequests) || !was.cancelRequests.length) return;
    return checkReserve(next, existing, ctx);
  }
  const existing = await io.readRecord(next.id);
  return checkReserve(next, existing, ctx);
}

module.exports = { guardCancelWrite, runWithContext, currentContext, isApprover, bypassOn };
