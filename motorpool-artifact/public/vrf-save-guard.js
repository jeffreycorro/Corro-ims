/**
 * Stale-save guard for reserve and ledger records (2026-11-01).
 *
 * VRF 6264 (10/30): approved, then an old browser tab saved its copy and
 * reset it to Requested. These rules refuse that write in the browser, in
 * the Netlify db function, and (mirrored) in the Postgres trigger in
 * supabase/migrations/20261101000001_motorpool_stale_save_guard.sql.
 *
 * Works in the browser (window.VrfSaveGuard) and under node (UMD).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VrfSaveGuard = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CODE = "vrf_changed_elsewhere";
  var PROTECTED = { approved: 1, open: 1, closed: 1, cancelled: 1, canceled: 1, "not bought": 1, duplicate: 1 };
  var DRAFTISH = { "": 1, requested: 1, draft: 1, pending: 1, "for approval": 1, "sent for approval": 1, held: 1 };

  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function isProtected(status) { return !!PROTECTED[norm(status)]; }
  function isDraftish(status) { return !!DRAFTISH[norm(status)]; }
  function isDowngrade(prev, next) { return isProtected(prev) && isDraftish(next); }

  function revOf(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function message(vrf, prevStatus) {
    var what = isProtected(prevStatus) ? "approved/changed" : "changed";
    return "This VRF" + (vrf ? " " + vrf : "") + " was " + what + " elsewhere" +
      (prevStatus ? " (now " + prevStatus + ")" : "") +
      ". Your copy is out of date and was not saved — reload the page and try again.";
  }

  function refusal(vrf, prevStatus, reason) {
    return { code: CODE, reason: reason, vrf: vrf ? String(vrf) : "", status: prevStatus || "", message: message(vrf, prevStatus) };
  }

  /* prev / next: reserve data objects. Returns null when the write is fine. */
  function checkReserveWrite(prev, next) {
    if (!prev || !next) return null;
    var vrf = next.vrfNo || prev.vrfNo || "";
    if (isDowngrade(prev.status, next.status)) return refusal(vrf, prev.status, "downgrade");
    var have = revOf(prev.rev), base = revOf(next.rev);
    if (have && base && base !== have) return refusal(vrf, prev.status, "stale_rev");
    return null;
  }

  function ledgerStatus(rows) {
    var best = "";
    (rows || []).forEach(function (r) {
      var st = r && (r.vstatus || r.status);
      if (isProtected(st)) best = st;
      else if (!best && st) best = st;
    });
    return best;
  }

  function maxRev(rows) {
    var m = 0;
    (rows || []).forEach(function (r) { m = Math.max(m, revOf(r && r.rev)); });
    return m;
  }

  /* prevRec: stored ledger data {rev, rows}; nextRows: rows the save carries. */
  function checkLedgerWrite(prevRec, nextRows, mode) {
    if (!prevRec) return null;
    var prevRows = Array.isArray(prevRec.rows) ? prevRec.rows : [];
    if (!prevRows.length || !(nextRows || []).length) return null;
    var vrf = (prevRows[0] && prevRows[0].vrf) || "";
    var prevSt = ledgerStatus(prevRows);
    if (isProtected(prevSt) && mode !== "append") {
      /* A line with no status is a new or untouched line, not a downgrade. */
      var down = (nextRows || []).some(function (r) {
        var st = r && (r.vstatus || r.status);
        return !!st && isDraftish(st);
      });
      if (down) return refusal(vrf, prevSt, "downgrade");
    }
    if (mode === "append") return null;
    var have = maxRev(prevRows), base = maxRev(nextRows);
    if (have && base && base !== have) return refusal(vrf, prevSt, "stale_rev");
    return null;
  }

  function toError(ref) {
    var err = new Error(ref.message);
    err.code = CODE;
    err.statusCode = 409;
    err.reason = ref.reason;
    err.vrf = ref.vrf;
    return err;
  }

  function isStaleError(err) {
    return !!err && (err.code === CODE || (err.body && err.body.code === CODE) ||
      /vrf_changed_elsewhere/.test(String(err.message || "")));
  }

  return {
    CODE: CODE,
    isProtected: isProtected,
    isDraftish: isDraftish,
    isDowngrade: isDowngrade,
    checkReserveWrite: checkReserveWrite,
    checkLedgerWrite: checkLedgerWrite,
    message: message,
    toError: toError,
    isStaleError: isStaleError,
    revOf: revOf,
  };
});
