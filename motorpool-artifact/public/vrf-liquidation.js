"use strict";

/**
 * VRF liquidation status, proof, and the Unliquidated list.
 * Shared by the Motorpool page (script tag -> window.VrfLiquidation),
 * the dry-run count script, and the tests. Pure: it reads what it is given.
 *
 * It EXTENDS the existing Liquidate flow. That flow still closes the VRF
 * (ledger vstatus "Closed" + liq {at, by, outcome}, reserve liquidatedAt +
 * actual). This module adds the receipts/withdrawal-slip proof, the
 * liquidated amount/date/by record (ops/liq-<vrf>), and the Finance link.
 *
 * Status:
 *   Excluded              cancelled, duplicate, voided, rejected
 *   Unliquidated          nothing liquidated yet
 *   Partially liquidated  some amount, but below the approved amount,
 *                         or the full amount without any proof attached
 *   Liquidated            liquidated amount >= approved amount AND proof
 * A legacy ledger VRF (blank vstatus, from the old workbooks) is Liquidated
 * on paper and is flagged legacy:true. Its proof is the paper file.
 */

var MANILA_TZ = "Asia/Manila";
var STATUSES = ["Unliquidated", "Partially liquidated", "Liquidated"];
var EXCLUDED_RE = /^(cancelled|canceled|duplicate|void|voided|rejected|archived|disapproved)$/i;
var AGE_BUCKETS = [
  { id: "0-7", label: "0–7 days", min: 0, max: 7 },
  { id: "8-15", label: "8–15 days", min: 8, max: 15 },
  { id: "16-30", label: "16–30 days", min: 16, max: 30 },
  { id: "31+", label: "Over 30 days", min: 31, max: Infinity },
];

function num(v) {
  var n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(/[₱,\s]/g, ""));
  return isFinite(n) ? n : 0;
}
function round2(n) { return Math.round(num(n) * 100) / 100; }

function manilaToday(now) {
  var d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  var p = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: MANILA_TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
  return p.year + "-" + p.month + "-" + p.day;
}
function dayOnly(s) {
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || ""));
  return m ? m[1] : "";
}
function daysBetween(a, b) {
  a = dayOnly(a); b = dayOnly(b);
  if (!a || !b) return null;
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function monthEnd(month) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!m) return "";
  var last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
  return m[1] + "-" + m[2] + "-" + String(last).padStart(2, "0");
}

/** Fuel drawn from the motorpool's own fuel reserve: proof is a withdrawal slip. */
function isReserveWithdrawal(entry) {
  if (!entry) return false;
  var rows = (entry.rows || []).filter(Boolean);
  /* The lines decide when there are any: a stored reserve kind can say
     fuel-issue on a station purchase (VRF 5823). */
  if (!rows.length && entry.kind === "fuel-issue") return true;
  if (rows.length && rows.every(function (r) {
    return r && (r.work === "FUEL-RES" || String(r.supplier || "").toUpperCase() === "FUEL RESERVE");
  })) return true;
  return (entry.works || []).length === 1 && entry.works[0] === "FUEL-RES";
}
function proofLabel(entry) {
  return isReserveWithdrawal(entry) ? "withdrawal slip" : "receipt / OR";
}

function ledgerTotal(rows) {
  return round2((rows || []).reduce(function (a, r) {
    if (!r || r.notBought) return a;
    var t = r.total != null && r.total !== "" ? num(r.total) : num(r.qty) * num(r.price);
    return a + t;
  }, 0));
}

/**
 * entry: {vrf, status, legacy, rows, total, approvedBudget, approvedAt, date,
 *         liq, actual, fuelPhotos, kind}
 * record: ops/liq-<vrf> {amount, date, by, financeRefs, ...} or null
 * proofCount: number of uploads under LIQ-<vrf>
 */
function liquidationOf(entry, record, proofCount) {
  entry = entry || {};
  record = record || null;
  var st = String(entry.status || "").trim();
  var approved = round2(entry.approvedBudget != null && entry.approvedBudget !== ""
    ? entry.approvedBudget
    : (entry.total != null ? entry.total : ledgerTotal(entry.rows)));
  var base = { vrf: String(entry.vrf || ""), approved: approved, legacy: false,
    proofCount: proofCount || 0, proofKind: proofLabel(entry) };

  if (/^(requested|draft|pending|for approval)$/i.test(st)) {
    return Object.assign(base, { status: "Excluded", liquidated: 0, outstanding: 0, by: "", date: "", source: "not-approved" });
  }
  if (EXCLUDED_RE.test(st) || (entry.liq && /^(cancelled|duplicate)$/i.test(String(entry.liq.outcome || "")))) {
    return Object.assign(base, { status: "Excluded", liquidated: 0, outstanding: 0, by: "", date: "", source: "cancelled" });
  }

  var closedByFlow = st === "Closed" || /^liquidated$/i.test(st) || !!(entry.liq && entry.liq.at);
  var legacy = !closedByFlow && (!!entry.legacy || st === "Legacy" || (!st && !entry.held));
  var amount = 0, by = "", date = "", source = "none";
  if (record && record.amount != null && record.amount !== "") {
    amount = round2(record.amount); by = record.by || ""; date = record.date || ""; source = "record";
  } else if (closedByFlow || legacy) {
    amount = round2(entry.actual != null && entry.actual !== "" ? entry.actual : ledgerTotal(entry.rows) || entry.total);
    by = (entry.liq && entry.liq.by) || "";
    date = dayOnly((entry.liq && entry.liq.at) || entry.liquidatedAt || "");
    source = legacy && !closedByFlow ? "legacy" : "liquidate-button";
  }
  var hasProof = (proofCount || 0) > 0 || !!(entry.fuelPhotos && entry.fuelPhotos.receipt);
  var status;
  if (amount <= 0 && !closedByFlow && !legacy) status = "Unliquidated";
  else if (legacy && !closedByFlow && source !== "record") status = "Liquidated";
  else if (amount + 0.005 >= approved && hasProof) status = "Liquidated";
  else status = "Partially liquidated";
  return Object.assign(base, {
    status: status,
    legacy: legacy && source === "legacy",
    liquidated: amount,
    outstanding: round2(Math.max(0, approved - amount)),
    hasProof: hasProof,
    by: by, date: date, source: source,
    needs: status === "Partially liquidated"
      ? (amount + 0.005 < approved ? "amount below approved" : "no " + proofLabel(entry) + " uploaded")
      : "",
  });
}

function approvalDay(entry) {
  return dayOnly(entry && (entry.approvedAt || entry.date)) || "";
}

/** Rows for the Unliquidated view: every non-excluded VRF not fully Liquidated. */
function unliquidatedRows(entries, records, proofCounts, opts) {
  opts = opts || {};
  var today = opts.today || manilaToday(opts.now);
  var curMonth = today.slice(0, 7);
  records = records || {}; proofCounts = proofCounts || {};
  var out = [];
  (entries || []).forEach(function (e) {
    if (!e) return;
    var no = String(e.vrf || "");
    var L = liquidationOf(e, records[no], proofCounts[no] || 0);
    if (L.status === "Excluded" || L.status === "Liquidated") return;
    var ap = approvalDay(e);
    var month = ap.slice(0, 7);
    var due = month ? monthEnd(month) : "";
    var age = ap ? daysBetween(ap, today) : null;
    out.push({
      vrf: no, entry: e, liq: L, status: L.status,
      approvedOn: ap, month: month, age: age,
      requester: String(e.requestedBy || (e.rows && e.rows[0] && e.rows[0].requestedBy) || "").trim(),
      unit: String(e.veh || (e.units && e.units[0]) || "").trim(),
      due: due,
      overdue: !!(month && month < curMonth),
      daysToDue: due ? daysBetween(today, due) : null,
      approved: L.approved, liquidated: L.liquidated, outstanding: L.outstanding,
    });
  });
  out.sort(function (a, b) {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (b.age || 0) - (a.age || 0);
  });
  return out;
}

function ageBucket(age) {
  if (age == null) return "";
  for (var i = 0; i < AGE_BUCKETS.length; i++) {
    if (age >= AGE_BUCKETS[i].min && age <= AGE_BUCKETS[i].max) return AGE_BUCKETS[i].id;
  }
  return "";
}

function filterRows(rows, f) {
  f = f || {};
  return (rows || []).filter(function (r) {
    if (f.age && ageBucket(r.age) !== f.age) return false;
    if (f.requester && r.requester !== f.requester) return false;
    if (f.unit && r.unit !== f.unit) return false;
    if (f.month && r.month !== f.month) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.overdue && !r.overdue) return false;
    return true;
  });
}

function totals(rows) {
  var t = { count: 0, overdue: 0, approved: 0, liquidated: 0, outstanding: 0, overdueOutstanding: 0 };
  (rows || []).forEach(function (r) {
    t.count++;
    t.approved += r.approved; t.liquidated += r.liquidated; t.outstanding += r.outstanding;
    if (r.overdue) { t.overdue++; t.overdueOutstanding += r.outstanding; }
  });
  ["approved", "liquidated", "outstanding", "overdueOutstanding"].forEach(function (k) { t[k] = round2(t[k]); });
  return t;
}

function countByStatus(entries, records, proofCounts) {
  var c = { Unliquidated: 0, "Partially liquidated": 0, Liquidated: 0, "Liquidated (legacy)": 0, Excluded: 0 };
  records = records || {}; proofCounts = proofCounts || {};
  (entries || []).forEach(function (e) {
    var L = liquidationOf(e, records[String(e.vrf)], proofCounts[String(e.vrf)] || 0);
    if (L.status === "Liquidated" && L.legacy) c["Liquidated (legacy)"]++;
    else c[L.status]++;
  });
  return c;
}

/** A Finance reference typed by hand: CA-2026-0012, a voucher no., or a receipt id. */
function normalizeFinanceRef(s) {
  return String(s || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

/** Validates the ops/liq-<vrf> record before it is saved. */
function buildLiqRecord(prev, input, now) {
  prev = prev || {};
  input = input || {};
  var amount = round2(input.amount);
  if (!(amount >= 0) || String(input.amount == null ? "" : input.amount).trim() === "") throw new Error("Type the liquidated amount.");
  var by = String(input.by || "").trim();
  if (!by) throw new Error("Put the name of who liquidated it.");
  var date = dayOnly(input.date);
  if (!date) throw new Error("Pick the liquidation date.");
  var refs = (input.financeRefs || prev.financeRefs || []).map(normalizeFinanceRef).filter(Boolean);
  var at = (now instanceof Date ? now : new Date()).toISOString();
  var history = (prev.history || []).slice(-19);
  if (prev.amount != null) history.push({ amount: prev.amount, date: prev.date, by: prev.by, at: prev.at });
  return {
    vrf: String(input.vrf || prev.vrf || ""),
    amount: amount, date: date, by: by,
    financeRefs: refs,
    note: String(input.note == null ? (prev.note || "") : input.note).trim().slice(0, 500),
    at: at, history: history,
  };
}

function liqDocId(vrf) { return "liq-" + String(vrf || "").replace(/[^A-Za-z0-9_.-]/g, "_"); }
function liqOwner(vrf) { return "LIQ-" + String(vrf || ""); }

var PROOF_ACCEPT = "image/*,application/pdf,.pdf,.heic,.heif";
var PDF_MAX_BYTES = 3 * 1024 * 1024;
function isPdfFile(file) {
  return /pdf/i.test(String(file && file.type || "")) || /\.pdf$/i.test(String(file && file.name || ""));
}
function pdfTooLarge(file) {
  var n = (file && file.size) || 0;
  if (n <= PDF_MAX_BYTES) return "";
  return "This PDF is " + Math.max(1, Math.round(n / 1048576)) + " MB. The portal keeps a PDF up to 3 MB — scan it smaller, or paste a Drive link.";
}

var api = {
  AGE_BUCKETS: AGE_BUCKETS, STATUSES: STATUSES, PROOF_ACCEPT: PROOF_ACCEPT, PDF_MAX_BYTES: PDF_MAX_BYTES,
  ageBucket: ageBucket, approvalDay: approvalDay, buildLiqRecord: buildLiqRecord,
  countByStatus: countByStatus, daysBetween: daysBetween, filterRows: filterRows,
  isPdfFile: isPdfFile, isReserveWithdrawal: isReserveWithdrawal, ledgerTotal: ledgerTotal,
  liqDocId: liqDocId, liqOwner: liqOwner, liquidationOf: liquidationOf, manilaToday: manilaToday,
  monthEnd: monthEnd, normalizeFinanceRef: normalizeFinanceRef, pdfTooLarge: pdfTooLarge,
  proofLabel: proofLabel, totals: totals, unliquidatedRows: unliquidatedRows,
};
if (typeof module === "object" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.VrfLiquidation = api;
