/**
 * Leave payload for Ask the records.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * The leave form stores "Reason for Leave" on the record as `reason`.
 * Ask used to bury that field inside money_for and never tell the model
 * to read it, so answers named type/dates/status and skipped the reason.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.hrAskLeave = api;
  if (typeof window !== "undefined" && window) window.hrAskLeave = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SYSTEM_NOTES = /^(imported from the signed form|created from the manpower report)/i;

  function str(value) {
    return value == null ? "" : String(value).trim();
  }

  function leaveReason(rec) {
    if (!rec || typeof rec !== "object") return "";
    var direct = str(
      rec.reason || rec.reasonForLeave || rec.leaveReason || rec.reason_for_leave
    );
    if (direct) return direct;
    var notes = str(rec.notes);
    if (notes && !SYSTEM_NOTES.test(notes)) return notes;
    return "";
  }

  function typeName(rec, leaveTypeFn) {
    var key = str(rec && rec.type);
    if (!key) return "not set — created from the manpower report";
    if (typeof leaveTypeFn === "function") {
      var spec = leaveTypeFn(key);
      if (spec && spec.n) return spec.n;
    }
    return key;
  }

  function serializeLeave(rec, opts) {
    opts = opts || {};
    rec = rec || {};
    var reason = leaveReason(rec);
    return {
      no: str(rec.no),
      type: str(rec.type),
      typeName: typeName(rec, opts.leaveType),
      from: str(rec.from),
      to: str(rec.to || rec.from),
      days: Number(rec.days) || 0,
      half: rec.half === true,
      status: str(rec.status),
      reason: reason,
      reasonOnForm: Boolean(reason),
      filedOn: str(rec.filedOn),
      approvedBy: str(rec.approvedBy),
      approvedOn: str(rec.approvedOn),
      covering: str(rec.covering),
      notes: str(rec.notes),
    };
  }

  function leavesForEmployee(list, empId, opts) {
    opts = opts || {};
    var cap = Number(opts.cap);
    if (!Number.isFinite(cap) || cap < 1) cap = 30;
    var id = str(empId);
    return (Array.isArray(list) ? list : [])
      .filter(function (row) {
        return row && str(row.empId) === id;
      })
      .slice()
      .sort(function (a, b) {
        return str(b.from).localeCompare(str(a.from));
      })
      .slice(0, cap)
      .map(function (row) {
        return serializeLeave(row, opts);
      });
  }

  var ASK_LEAVE_RULE =
    "When a question is about leave — who is on leave, a recent leave, an LRF number, " +
    "or why someone filed — call leave_for after find_employee. Always include the type, " +
    "dates, status, AND the Reason for Leave the tool returns. That reason is the " +
    "\"Reason for Leave\" field on the leave form / leave record. If reason is blank or " +
    "reasonOnForm is false, say the form has no reason written. Do not invent one.";

  return {
    ASK_LEAVE_RULE: ASK_LEAVE_RULE,
    leaveReason: leaveReason,
    leavesForEmployee: leavesForEmployee,
    serializeLeave: serializeLeave,
    typeName: typeName,
  };
});
