/**
 * VRF cancel requests (2026-11-01).
 *
 * Staff no longer cancel an approved VRF directly. They file a request
 * (whole VRF or chosen lines, reason required). Nothing changes on the
 * amounts until Jeffrey approves it in Office -> Approvals, or the
 * assistant applies it through netlify/functions/approve-cancel after his
 * verbal yes. Requests live on the reserve record: reserve.cancelRequests[].
 *
 * Works in the browser (window.VrfCancel) and under node (UMD).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VrfCancel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEAD = { "Cancelled": 1, "Not bought": 1, "Duplicate": 1 };

  function money(n) {
    var v = Number(n);
    return isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }
  function lineAmount(row) {
    if (!row) return 0;
    if (row.total != null && row.total !== "") return money(row.total);
    return money((Number(row.qty) || 0) * (Number(row.price) || 0));
  }
  function isDeadLine(row) {
    return !!row && (!!DEAD[String(row.vstatus || "")] || (row.notBought === true && row.total === 0));
  }

  function normLines(lines) {
    if (lines == null) return null;
    if (!Array.isArray(lines)) return null;
    var out = [];
    lines.forEach(function (n) {
      var i = Number(n);
      if (isFinite(i) && i >= 0 && out.indexOf(i) < 0) out.push(Math.floor(i));
    });
    out.sort(function (a, b) { return a - b; });
    return out.length ? out : null;
  }

  /* A null `lines` means the whole VRF. */
  function newCancelRequest(spec) {
    var s = spec || {};
    var reason = String(s.reason || "").trim();
    var by = String(s.by || "").trim();
    var vrf = String(s.vrf || "").trim();
    if (!vrf) throw codeError("VRF number is required.", "bad_request");
    if (!reason) throw codeError("A reason is required to request a cancel.", "reason_required");
    if (!by) throw codeError("Put your name on the cancel request.", "bad_request");
    var rows = Array.isArray(s.rows) ? s.rows : [];
    var lines = normLines(s.lines);
    if (lines && rows.length && lines.length >= rows.length) lines = null;
    var picked = lines ? lines.map(function (i) { return rows[i]; }).filter(Boolean) : rows;
    var at = s.at || new Date().toISOString();
    return {
      id: "cxl-" + vrf + "-" + String(at).replace(/[^0-9]/g, "").slice(0, 14) + (s.salt ? "-" + s.salt : ""),
      vrf: vrf,
      reserveNo: s.reserveNo == null ? "" : String(s.reserveNo),
      scope: lines ? "lines" : "vrf",
      lines: lines,
      lineItems: picked.map(function (r) { return String((r && (r.item || r.cat)) || ""); }),
      amount: money(picked.reduce(function (a, r) { return a + lineAmount(r); }, 0)),
      reason: reason,
      by: by,
      at: at,
      status: "Requested",
    };
  }

  function codeError(message, code, status) {
    var err = new Error(message);
    err.code = code;
    err.statusCode = status || (code === "bad_request" || code === "reason_required" ? 400 : 409);
    return err;
  }

  function pendingCancel(reserve, vrf) {
    var list = (reserve && Array.isArray(reserve.cancelRequests)) ? reserve.cancelRequests : [];
    for (var i = list.length - 1; i >= 0; i--) {
      var q = list[i];
      if (q && q.status === "Requested" && (vrf == null || String(q.vrf) === String(vrf))) return q;
    }
    return null;
  }

  function addCancelRequest(reserve, request) {
    if (!reserve) throw codeError("No reserve holds this VRF.", "not_found", 404);
    if (pendingCancel(reserve, request.vrf)) {
      throw codeError("VRF " + request.vrf + " already has a cancel request waiting for approval.", "already_requested");
    }
    var next = Object.assign({}, reserve);
    next.cancelRequests = (reserve.cancelRequests || []).concat([request]);
    next.audit = (reserve.audit || []).concat([{ at: request.at, by: request.by, field: "cancel-request",
      from: "", to: (request.scope === "vrf" ? "whole VRF " : "lines " + (request.lines || []).map(function (i) { return i + 1; }).join(", ") + " of VRF ") + request.vrf, note: request.reason }]);
    return next;
  }

  /* Same zeroing as applyLiquidationLine(row, {remove:true}, stamp, "cancelled") (PR #68). */
  function cancelLine(row, stamp) {
    var next = Object.assign({}, row || {}, {
      qty: 0, price: 0, total: 0, liters: null,
      notBought: true, vstatus: "Cancelled", liq: stamp || null,
    });
    delete next.src;
    return next;
  }

  function cancelStamp(by, note, at) {
    return { at: at || new Date().toISOString().slice(0, 10), by: by || "", note: note || "", outcome: "cancelled" };
  }

  /* Zero only the chosen lines. Returns {rows, amount}. */
  function applyLineCancel(rows, lines, stamp, expectItems) {
    var list = Array.isArray(rows) ? rows : [];
    var pick = normLines(lines) || [];
    var amount = 0;
    pick.forEach(function (i, k) {
      if (!list[i]) throw codeError("Line " + (i + 1) + " is not on this VRF any more. Reload and check the request.", "line_mismatch");
      var want = expectItems && expectItems[k];
      var have = String(list[i].item || list[i].cat || "");
      if (want && have && want !== have) {
        throw codeError("Line " + (i + 1) + " is now \"" + have + "\", not \"" + want + "\". Reload and check the request.", "line_mismatch");
      }
    });
    var out = list.map(function (row, i) {
      if (pick.indexOf(i) < 0 || isDeadLine(row)) return row;
      amount += lineAmount(row);
      return cancelLine(row, stamp);
    });
    return { rows: out, amount: money(amount) };
  }

  /* Budget (and actual, once liquidated) drop by the cancelled lines. */
  function recomputeReserveForLines(reserve, amount, by, at, request) {
    var r = Object.assign({}, reserve);
    var before = r.approvedBudget != null ? Number(r.approvedBudget) : Number(r.budget || 0);
    var after = money(Math.max(0, before - amount));
    if (r.approvedBudget != null) r.approvedBudget = after;
    if (r.budget != null) r.budget = money(Math.max(0, Number(r.budget || 0) - amount));
    if (r.actual != null && r.actual !== "" && (r.liquidatedAt || Number(r.actual) > 0)) {
      r.actual = money(Math.max(0, Number(r.actual) - amount));
    }
    r.audit = (r.audit || []).concat([{ at: at, by: by, field: "cancel-lines",
      from: before.toFixed(2), to: after.toFixed(2),
      note: "VRF " + (request && request.vrf) + " lines " + ((request && request.lines) || []).map(function (i) { return i + 1; }).join(", ") +
        " cancelled: " + ((request && request.reason) || "") }]);
    return r;
  }

  /* Whole-VRF cancel: the reserve closes at zero when all its VRFs are dead (settleReserve). */
  function settleReserveAfterVrfCancel(reserve, linkedStatuses, by, note, at) {
    var r = Object.assign({}, reserve);
    if (r.status !== "Approved") return r;
    var st = linkedStatuses || [];
    if (st.some(function (s) { return s === "Open" || s === "Requested"; })) return r;
    var allDead = !st.length || st.every(function (s) { return !!DEAD[s]; });
    if (!allDead) return r;
    r.liquidatedAt = at;
    r.actual = 0;
    r.status = "Cancelled";
    r.cancelOutcome = "cancelled";
    r.cancelledAt = at;
    r.cancelledBy = by || r.cancelledBy || "";
    r.cancelNote = note || r.cancelNote || "";
    (r.draftLines || []).forEach(function (l) {
      if (!l) return;
      l.qty = 0; l.price = 0; l.notBought = true;
      if (l.liters != null) l.liters = 0;
    });
    return r;
  }

  function decideRequest(reserve, requestId, decision, by, at, note) {
    var list = (reserve && reserve.cancelRequests) || [];
    var found = false;
    var r = Object.assign({}, reserve);
    r.cancelRequests = list.map(function (q) {
      if (!q || q.id !== requestId) return q;
      if (q.status !== "Requested") throw codeError("This cancel request was already " + String(q.status).toLowerCase() + ".", "already_decided");
      found = true;
      return Object.assign({}, q, { status: decision, decidedBy: by || "", decidedAt: at, decisionNote: note || "" });
    });
    if (!found) throw codeError("Cancel request not found. Reload the page.", "not_found", 404);
    r.audit = (r.audit || []).concat([{ at: at, by: by, field: "cancel-" + String(decision).toLowerCase(), from: "Requested", to: decision, note: note || "" }]);
    return r;
  }

  /* Flat list for the VRF Cancellations Log, newest first. */
  function cancelLogEntries(reserves) {
    var out = [];
    (reserves || []).forEach(function (r) {
      ((r && r.cancelRequests) || []).forEach(function (q) {
        if (!q) return;
        out.push(Object.assign({ reserveNo: String(r.no == null ? "" : r.no) }, q));
      });
    });
    out.sort(function (a, b) { return String(b.decidedAt || b.at).localeCompare(String(a.decidedAt || a.at)); });
    return out;
  }

  function describeLines(q) {
    if (!q || q.scope === "vrf" || !q.lines) return "Whole VRF";
    return q.lines.map(function (i, k) {
      var item = q.lineItems && q.lineItems[k];
      return "#" + (i + 1) + (item ? " " + item : "");
    }).join(", ");
  }

  return {
    newCancelRequest: newCancelRequest,
    addCancelRequest: addCancelRequest,
    pendingCancel: pendingCancel,
    cancelLine: cancelLine,
    cancelStamp: cancelStamp,
    applyLineCancel: applyLineCancel,
    recomputeReserveForLines: recomputeReserveForLines,
    settleReserveAfterVrfCancel: settleReserveAfterVrfCancel,
    decideRequest: decideRequest,
    cancelLogEntries: cancelLogEntries,
    describeLines: describeLines,
    lineAmount: lineAmount,
    isDeadLine: isDeadLine,
  };
});
