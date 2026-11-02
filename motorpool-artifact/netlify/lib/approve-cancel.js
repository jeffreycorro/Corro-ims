"use strict";

/**
 * Apply (or reject) a VRF cancel request on the server.
 * Used by netlify/functions/approve-cancel after Jeffrey's verbal yes.
 *
 * Body: { vrf, lines?, reject?, by?, note?, reason? }
 *  - vrf: the VRF number.
 *  - lines: optional 0-based line indexes. Missing or empty means the
 *    whole VRF (or the lines on the pending request, when there is one).
 *  - reject: true turns the pending request down. Amounts do not change.
 *  - reason: needed only when there is no pending request on file.
 */

const C = require("../../public/vrf-cancel");
const { runWithContext } = require("./cancel-guard");

function err(message, code, statusCode) {
  const e = new Error(message);
  e.code = code;
  e.statusCode = statusCode || 409;
  return e;
}

function manilaDate(now) {
  const d = new Date((now ? now() : Date.now()) + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function createRecordsStore(api) {
  const db = api || require("./supabase");
  async function read(id) {
    const rows = await db.rest({
      method: "GET",
      path: "/rest/v1/motorpool_records",
      query: `id=eq.${encodeURIComponent(id)}&select=id,kind,reserve_no,vrf_no,year,month,data,updated_at`,
    });
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  return {
    readLedger: (vrf) => read("ledger:" + vrf),
    readReserve: (no) => read("reserve:" + no),
    async findReserveByVrf(vrf) {
      const rows = await db.rest({
        method: "GET",
        path: "/rest/v1/motorpool_records",
        query: `kind=eq.reserve&vrf_no=eq.${encodeURIComponent(vrf)}&select=id,reserve_no,year,data,updated_at`,
      });
      return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    },
    saveLedger: (spec) => db.saveLedgerVrf(Object.assign({ mode: "replace" }, spec)),
    putReserve: (spec) => db.putReserveRecord(spec),
  };
}

/* The approve-cancel function is APPROVE_VRF_SECRET-gated, so its writes
   count as an approver's for lib/cancel-guard.js. */
async function applyCancel(store, body, opts) {
  return runWithContext({ approver: true, by: "approve-cancel" }, () => applyCancelInner(store, body, opts));
}

async function applyCancelInner(store, body, opts) {
  const b = body || {};
  const vrf = String(b.vrf || "").trim().replace(/^VRF\s*/i, "");
  if (!/^\d+$/.test(vrf)) throw err("vrf is required (digits)", "bad_request", 400);
  const by = String(b.by || "Jeffrey").trim();
  const at = manilaDate(opts && opts.now);

  const ledger = await store.readLedger(vrf);
  let reserveRec = null;
  const rsvNo = (ledger && ledger.reserve_no) || (b.reserve != null ? String(b.reserve) : "");
  if (rsvNo) reserveRec = await store.readReserve(rsvNo);
  if (!reserveRec) reserveRec = await store.findReserveByVrf(vrf);
  if (!reserveRec || !reserveRec.data) throw err("No reserve holds VRF " + vrf + ".", "not_found", 404);
  let reserve = reserveRec.data;
  const year = String(reserveRec.year || String(reserve.date || "").slice(0, 4));
  const rows = (ledger && ledger.data && Array.isArray(ledger.data.rows)) ? ledger.data.rows : [];
  const month = (ledger && ledger.month) || String(reserve.date || at).slice(0, 7);

  let request = C.pendingCancel(reserve, vrf);
  if (b.reject === true) {
    if (!request) throw err("VRF " + vrf + " has no cancel request waiting.", "not_found", 404);
    reserve = C.decideRequest(reserve, request.id, "Rejected", by, at, String(b.note || ""));
    await store.putReserve({ year, reserve });
    return { ok: true, vrf, decision: "Rejected", request: Object.assign({}, request, { status: "Rejected" }) };
  }

  const lines = Array.isArray(b.lines) && b.lines.length ? b.lines : null;
  if (!request) {
    request = C.newCancelRequest({
      vrf, reserveNo: reserve.no, rows, lines, by,
      reason: b.reason || b.note || "", at,
      prevStatus: (rows[0] && rows[0].vstatus) || reserve.status || "",
    });
    reserve = C.addCancelRequest(reserve, request);
  } else if (lines) {
    const redo = C.newCancelRequest({ vrf, reserveNo: reserve.no, rows, lines, by: request.by, reason: request.reason, at: request.at });
    request = Object.assign({}, request, { scope: redo.scope, lines: redo.lines, lineItems: redo.lineItems, amount: redo.amount });
    reserve = Object.assign({}, reserve, {
      cancelRequests: (reserve.cancelRequests || []).map((q) => (q && q.id === request.id ? request : q)),
    });
  }

  /* 1) Record the approval first. The cancel guards (Node + DB trigger) only
        let a line or reserve become Cancelled once the stored reserve holds
        an Approved request, so the decision must land before the cancel. */
  reserve = C.decideRequest(reserve, request.id, "Approved", by, at, String(b.note || ""));
  await store.putReserve({ year, reserve });

  /* 2) Apply the cancel. */
  const stamp = C.cancelStamp(by, request.reason, at);
  let nextRows;
  let amount;
  if (request.scope === "lines" && request.lines) {
    const out = C.applyLineCancel(rows, request.lines, stamp, request.lineItems);
    nextRows = out.rows;
    amount = out.amount;
    reserve = C.recomputeReserveForLines(reserve, amount, by, at, request);
  } else {
    const seeds = rows.length ? rows : (reserve.draftLines || [{}]).map((l) =>
      Object.assign({ month, date: reserve.date || at, vrf, reserve: String(reserve.no) }, l || {}));
    amount = seeds.reduce((a, r) => a + (C.isDeadLine(r) ? 0 : C.lineAmount(r)), 0);
    nextRows = seeds.map((r) => Object.assign(C.cancelLine(r, stamp), { vrf, month: r.month || month }));
    const linked = (reserve.vrfs && reserve.vrfs.length ? reserve.vrfs : [vrf]).map(String);
    const statuses = [];
    for (const no of linked) {
      if (no === vrf) { statuses.push("Cancelled"); continue; }
      const other = await store.readLedger(no);
      const oRows = (other && other.data && other.data.rows) || [];
      const dead = oRows.length && oRows.every(C.isDeadLine);
      statuses.push(dead ? "Cancelled" : (oRows[0] && oRows[0].vstatus) || "Open");
    }
    reserve = C.settleReserveAfterVrfCancel(reserve, statuses, by, request.reason, at);
  }
  const saved = reserve.cancelRequests.find((q) => q && q.id === request.id);
  saved.amount = Math.round(amount * 100) / 100;

  await store.saveLedger({ vrf, month, rows: nextRows });
  await store.putReserve({ year, reserve });
  return {
    ok: true,
    vrf,
    decision: "Approved",
    scope: request.scope,
    lines: request.lines,
    amount: saved.amount,
    reserveNo: String(reserve.no),
    reserveStatus: reserve.status,
    approvedBudget: reserve.approvedBudget != null ? reserve.approvedBudget : reserve.budget,
  };
}

module.exports = { applyCancel, createRecordsStore };
