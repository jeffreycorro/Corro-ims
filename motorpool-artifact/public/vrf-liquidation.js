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
  var hasProof = (proofCount || 0) > 0 || !!(entry.fuelPhotos && entry.fuelPhotos.receipt) || !!stampedProof(entry);
  var nrCounts = entry.proofCounts || ((proofCount || 0) > 0 ? { receipts: proofCount } : null);
  var nr = closedByFlow ? noReceiptFlag(entry, nrCounts) : { flag: false };
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
    noReceipt: !!nr.flag,
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

/* ===================== Liquidation proof rules (2026-11-02) =====================
 * A VRF may not be set Liquidated (ledger vstatus "Closed" with a bought
 * outcome) without proof. Jeffrey-approved rules:
 *   - actual amount spent, liquidation date, who liquidated (and when, stamped)
 *   - at least one receipt / OR uploaded on the VRF
 *       (owner LIQ-<vrf>, or a VRF photo tagged Receipt)
 *   - actual < approved: change returned amount + how + when
 *   - actual > approved: a reason
 *   - FUEL RESERVE VRF: instead of an OR, an after-fueling gauge photo on the
 *     VRF, plus the matching reserve withdrawal row (fuel/withdrawals) whose
 *     liters match the VRF liters. The withdrawal slip is optional.
 * The same rules run in the browser (dialog), in the Netlify db function, and
 * (as a backstop) in the Postgres trigger 20261102000001.
 */
var NO_RECEIPT_LABEL = "Liquidated – no receipt";
var DEAD_OUTCOMES = /^(cancelled|canceled|not-bought|duplicate)$/i;
var RETURN_METHODS = ["Cash returned to Finance", "Deposited to company account", "Deducted from next cash advance", "Other"];
var AFTER_FUEL_ROLE = "fuel-gauge-after";
var RECEIPT_ROLE = "receipt";
var SLIP_ROLE = "withdrawal-slip";

function photoRoleOf(p) {
  if (!p) return "";
  var role = String(p.role || p.fuelRole || "").trim().toLowerCase();
  var cap = String(p.caption || "").toLowerCase();
  if (role === AFTER_FUEL_ROLE || role === "gauge-after") return "gauge-after";
  if (role === "gauge" || role === "fuel-gauge" || role === "fuel gauge") return /after/.test(cap) ? "gauge-after" : "gauge";
  if (role === SLIP_ROLE) return "slip";
  if (role === "receipt" || role === "or") return "receipt";
  if (role) return role;
  if (/gauge/.test(cap) && /after/.test(cap)) return "gauge-after";
  if (/fuel\s*gauge|\bgauge\b/.test(cap)) return "gauge";
  if (/withdrawal\s*slip/.test(cap)) return "slip";
  if (/\breceipt\b|official receipt|\bo\.?r\.?\b/.test(cap)) return "receipt";
  return "";
}
/** Counts proof kinds from photo meta rows. liqItems are LIQ-<vrf> uploads. */
function proofCounts(vrfItems, liqItems) {
  var c = { receipts: 0, afterFuel: 0, gauge: 0, slips: 0, untagged: 0, liq: 0 };
  (liqItems || []).forEach(function (p) {
    if (!p) return;
    c.liq++;
    var r = photoRoleOf(p);
    if (r === "slip") c.slips++;
    else if (r === "gauge-after") c.afterFuel++;
    else c.receipts++;
  });
  (vrfItems || []).forEach(function (p) {
    if (!p || p.kind === "link") return;
    var r = photoRoleOf(p);
    if (r === "receipt") c.receipts++;
    else if (r === "gauge-after") c.afterFuel++;
    else if (r === "gauge") c.gauge++;
    else if (r === "slip") c.slips++;
    else c.untagged++;
  });
  return c;
}

function fuelLitresOfRows(rows) {
  return Math.round((rows || []).reduce(function (a, r) {
    if (!r || r.notBought) return a;
    var l = r.liters != null && r.liters !== "" ? num(r.liters) : (/^l(iters?|itres?)?$/i.test(String(r.unit || "")) ? num(r.qty) : 0);
    return a + l;
  }, 0) * 100) / 100;
}

/** Withdrawal rows on fuel/withdrawals that may belong to this VRF. */
function withdrawalCandidates(withdrawals, vrf, veh, date) {
  var no = String(vrf || "").trim();
  var out = [];
  (withdrawals || []).forEach(function (w, i) {
    if (!w) return;
    var wv = String(w.vrf || "").replace(/\D/g, "");
    var same = wv && wv === no.replace(/\D/g, "");
    var near = !wv && veh && String(w.vehicle || "") === String(veh) && date && Math.abs(daysBetween(w.date, date) || 99) <= 3;
    if (same || near) out.push({ idx: i, ref: withdrawalRef(w, i), date: w.date || "", vehicle: w.vehicle || "", liters: num(w.liters), vrf: wv, exact: !!same });
  });
  out.sort(function (a, b) { return (b.exact ? 1 : 0) - (a.exact ? 1 : 0); });
  return out;
}
function withdrawalRef(w, i) {
  return [String(w.date || ""), String(w.vehicle || ""), String(num(w.liters)), String(w.vrf || ""), String(i)].join("|");
}

function validDay(s) {
  var d = dayOnly(s);
  return d && !isNaN(Date.parse(d + "T00:00:00Z")) ? d : "";
}

/**
 * input: {actual, date, by, change:{amount, how, date}, overReason,
 *         counts: proofCounts(...), withdrawal:{ref, liters, date, vehicle} }
 * ctx:   {approved, fuelReserve, litres, outcome, today}
 * Returns {ok, errors:[{field, msg}]}.
 */
function checkLiquidation(input, ctx) {
  input = input || {}; ctx = ctx || {};
  var errors = [];
  function err(field, msg) { errors.push({ field: field, msg: msg }); }
  if (DEAD_OUTCOMES.test(String(ctx.outcome || ""))) return { ok: true, errors: [] };
  var actualRaw = String(input.actual == null ? "" : input.actual).trim();
  var actual = round2(input.actual);
  var approved = round2(ctx.approved);
  if (!actualRaw || !(actual > 0)) err("actual", "Type the actual amount spent.");
  var date = validDay(input.date);
  if (!date) err("date", "Pick the liquidation date.");
  else if (ctx.today && date > ctx.today) err("date", "The liquidation date cannot be in the future.");
  if (!String(input.by || "").trim()) err("by", "Put the name of who liquidated it.");
  var c = input.counts || {};
  if (ctx.fuelReserve) {
    if (!((c.afterFuel || 0) > 0)) err("afterFuel", "Upload the after-fueling photo (gauge after fueling) on this VRF.");
    var w = input.withdrawal;
    if (!w || !w.ref) err("withdrawal", "Link the matching withdrawal row from the fuel reserve log.");
    else if (Math.abs(num(w.liters) - num(ctx.litres)) > 0.01) {
      err("withdrawal", "Liters do not match: the withdrawal row is " + num(w.liters) + " L, this VRF is " + num(ctx.litres) + " L.");
    }
  } else if (!((c.receipts || 0) > 0)) {
    err("receipt", "Upload at least one receipt / OR on this VRF.");
  }
  if (actual > 0 && approved > 0) {
    if (actual + 0.005 < approved) {
      var ch = input.change || {};
      var diff = round2(approved - actual);
      var amt = round2(ch.amount);
      if (!(amt > 0)) err("changeAmount", "Spent " + fmt(actual) + " of " + fmt(approved) + ": type the change returned (" + fmt(diff) + ").");
      else if (Math.abs(amt - diff) > 0.005) err("changeAmount", "Change returned should be " + fmt(diff) + " (approved " + fmt(approved) + " − actual " + fmt(actual) + ").");
      if (!String(ch.how || "").trim()) err("changeHow", "Say how the change was returned.");
      var cd = validDay(ch.date);
      if (!cd) err("changeDate", "Pick the date the change was returned.");
      else if (ctx.today && cd > ctx.today) err("changeDate", "The change-returned date cannot be in the future.");
    } else if (actual > approved + 0.005) {
      if (String(input.overReason || "").trim().length < 5) err("overReason", "Spent " + fmt(actual) + ", over the approved " + fmt(approved) + ": give the reason.");
    }
  }
  return { ok: errors.length === 0, errors: errors };
}
function fmt(n) { return "₱" + round2(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

/** The proof object stored on each closed line as liq.proof. */
function buildProof(input, ctx, now) {
  input = input || {}; ctx = ctx || {};
  var c = input.counts || {};
  var actual = round2(input.actual), approved = round2(ctx.approved);
  var p = {
    v: 1,
    actual: actual, approved: approved,
    date: validDay(input.date),
    by: String(input.by || "").trim(),
    at: (now instanceof Date ? now : new Date()).toISOString(),
    receipts: c.receipts || 0,
  };
  if (approved > 0 && actual + 0.005 < approved) {
    var ch = input.change || {};
    p.change = { amount: round2(ch.amount), how: String(ch.how || "").trim().slice(0, 200), date: validDay(ch.date) };
  } else if (approved > 0 && actual > approved + 0.005) {
    p.overReason = String(input.overReason || "").trim().slice(0, 500);
  }
  if (ctx.fuelReserve) {
    var w = input.withdrawal || {};
    p.fuel = { afterPhotos: c.afterFuel || 0, slips: c.slips || 0, litres: num(ctx.litres),
      withdrawal: { ref: w.ref || "", date: w.date || "", vehicle: w.vehicle || "", liters: num(w.liters) } };
  }
  return p;
}

/** Proof stamp already on a ledger line (liq.proof) that passes the shape check. */
function stampedProof(entry) {
  var rows = (entry && entry.rows) || [];
  for (var i = 0; i < rows.length; i++) {
    var p = rows[i] && rows[i].liq && rows[i].liq.proof;
    if (p && p.v && p.actual > 0 && p.date && p.by) return p;
  }
  return null;
}

/**
 * Flag for the lists: a VRF already closed by the Liquidate flow (bought) with
 * no proof on file. counts: proofCounts(...) for the VRF (null = unknown).
 * Fuel reserve VRFs are cleared by an after-fueling / gauge photo. Untagged
 * photos on a fuel reserve VRF clear it too (opts.untaggedClearsFuel, default
 * true): before 2026-11-02 the portal did not tag gauge photos.
 */
function noReceiptFlag(entry, counts, opts) {
  opts = opts || {};
  entry = entry || {};
  var st = String(entry.status || "");
  var liq = entry.liq || null;
  if (!liq) (entry.rows || []).some(function (r) { if (r && r.liq && r.liq.at && !r.notBought) { liq = r.liq; return true; } return false; });
  var outcome = String((liq && liq.outcome) || "");
  var closed = st === "Closed" || /^liquidated$/i.test(st) || !!(liq && liq.at);
  if (!closed || DEAD_OUTCOMES.test(outcome) || EXCLUDED_RE.test(st)) return { flag: false };
  if (!(liq && liq.at) && !entry.liquidatedAt) return { flag: false };
  if (stampedProof(entry)) return { flag: false, clearedBy: "proof" };
  var fuel = isReserveWithdrawal(entry);
  var c = counts || {};
  var fp = entry.fuelPhotos || {};
  if (fuel) {
    if ((c.afterFuel || 0) > 0) return { flag: false, clearedBy: "after-fuel photo", fuel: true };
    if ((c.gauge || 0) > 0 || fp.gauge === true) return { flag: false, clearedBy: "gauge photo", fuel: true };
    if (opts.untaggedClearsFuel !== false && (c.untagged || 0) > 0) return { flag: false, clearedBy: "untagged photo", fuel: true };
    return { flag: true, label: NO_RECEIPT_LABEL, fuel: true };
  }
  if ((c.receipts || 0) > 0 || fp.receipt === true) return { flag: false, clearedBy: "receipt" };
  return { flag: true, label: NO_RECEIPT_LABEL, fuel: false };
}

var api = {
  AGE_BUCKETS: AGE_BUCKETS, STATUSES: STATUSES, PROOF_ACCEPT: PROOF_ACCEPT, PDF_MAX_BYTES: PDF_MAX_BYTES,
  ageBucket: ageBucket, approvalDay: approvalDay, buildLiqRecord: buildLiqRecord,
  countByStatus: countByStatus, daysBetween: daysBetween, filterRows: filterRows,
  isPdfFile: isPdfFile, isReserveWithdrawal: isReserveWithdrawal, ledgerTotal: ledgerTotal,
  liqDocId: liqDocId, liqOwner: liqOwner, liquidationOf: liquidationOf, manilaToday: manilaToday,
  monthEnd: monthEnd, normalizeFinanceRef: normalizeFinanceRef, pdfTooLarge: pdfTooLarge,
  proofLabel: proofLabel, totals: totals, unliquidatedRows: unliquidatedRows,
  NO_RECEIPT_LABEL: NO_RECEIPT_LABEL, RETURN_METHODS: RETURN_METHODS, AFTER_FUEL_ROLE: AFTER_FUEL_ROLE,
  RECEIPT_ROLE: RECEIPT_ROLE, SLIP_ROLE: SLIP_ROLE,
  buildProof: buildProof, checkLiquidation: checkLiquidation, fuelLitresOfRows: fuelLitresOfRows,
  noReceiptFlag: noReceiptFlag, photoRoleOf: photoRoleOf, proofCounts: proofCounts,
  stampedProof: stampedProof, withdrawalCandidates: withdrawalCandidates, withdrawalRef: withdrawalRef,
};
if (typeof module === "object" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.VrfLiquidation = api;
