"use strict";

/**
 * Monthly VRF report.
 * Shared by the Motorpool page (script tag → window.VrfMonthlyReport)
 * and the vrf-report Netlify function (module.exports).
 * Pure: it only reads the reserves and ledger rows it is given.
 */

var COMPANY = "Corro Construction Development and Trade Corporation";
var REPORT_TITLE = "Motorpool Monthly VRF Report";
var MANILA = "Asia/Manila";
var CATEGORIES = ["Fuel", "Parts", "Labor/Service", "Others"];
var MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
var MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function manilaParts(date) {
  var fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  var parts = {};
  fmt.formatToParts(date).forEach(function (p) {
    if (p.type !== "literal") parts[p.type] = p.value;
  });
  if (parts.hour === "24") parts.hour = "00";
  return parts;
}

function pad2(n) {
  n = String(n);
  return n.length < 2 ? "0" + n : n;
}

function asDate(value) {
  if (value instanceof Date) return value;
  if (value == null || value === "") return new Date();
  var d = new Date(value);
  return isNaN(d.getTime()) ? new Date() : d;
}

function formatManilaIso(date) {
  var p = manilaParts(asDate(date));
  return p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute + ":" + p.second + "+08:00";
}

function formatManilaLabel(date) {
  var p = manilaParts(asDate(date));
  var hour = Number(p.hour);
  var ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return (
    Number(p.day) + " " + MONTH_SHORT[Number(p.month) - 1] + " " + p.year +
    ", " + hour + ":" + p.minute + ":" + p.second + " " + ampm
  );
}

function manilaToday(date) {
  var p = manilaParts(asDate(date));
  return p.year + "-" + p.month + "-" + p.day;
}

function currentMonth(date) {
  return manilaToday(date).slice(0, 7);
}

function defaultReportMonth(date) {
  var today = manilaToday(date);
  var y = Number(today.slice(0, 4));
  var m = Number(today.slice(5, 7)) - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return y + "-" + pad2(m);
}

function parseMonth(month) {
  var m = String(month == null ? "" : month).trim();
  if (!/^\d{4}-\d{2}$/.test(m)) {
    var err = new Error("month must be YYYY-MM");
    err.statusCode = 400;
    err.code = "bad_month";
    throw err;
  }
  var mm = Number(m.slice(5, 7));
  if (mm < 1 || mm > 12) {
    var err2 = new Error("month must be YYYY-MM");
    err2.statusCode = 400;
    err2.code = "bad_month";
    throw err2;
  }
  return m;
}

function monthEnd(month) {
  var y = Number(month.slice(0, 4));
  var m = Number(month.slice(5, 7));
  var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return month + "-" + pad2(last);
}

function monthLabel(month) {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] + " " + month.slice(0, 4);
}

function dateKey(value) {
  if (value == null || value === "") return "";
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(value));
  if (m) return m[3] + "-" + pad2(m[1]) + "-" + pad2(m[2]);
  return "";
}

function daysBetween(from, to) {
  var a = dateKey(from);
  var b = dateKey(to);
  if (!a || !b) return null;
  var ap = a.split("-");
  var bp = b.split("-");
  var ua = Date.UTC(Number(ap[0]), Number(ap[1]) - 1, Number(ap[2]));
  var ub = Date.UTC(Number(bp[0]), Number(bp[1]) - 1, Number(bp[2]));
  return Math.round((ub - ua) / 86400000);
}

function money(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  var n = parseFloat(String(v).replace(/[₱,\s]/g, "").trim());
  return isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function formatPeso(n) {
  if (n == null || !isFinite(Number(n))) return "—";
  var v = round2(n);
  var sign = v < 0 ? "-" : "";
  var abs = Math.abs(v).toFixed(2).split(".");
  abs[0] = abs[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + "₱ " + abs[0] + "." + abs[1];
}

function isFuel(cat) {
  return /^\s*fuel\s*[—–-]/i.test(String(cat || ""));
}

function categoryOf(row) {
  var cat = String((row && row.cat) || "");
  var grp = String((row && row.grp) || "");
  var sub = String((row && row.sub) || "");
  if (isFuel(cat) || /^\s*fuel\s*$/i.test(grp)) return "Fuel";
  if (/\blabor\b|\blabour\b/i.test(cat + " " + grp + " " + sub)) return "Labor/Service";
  if (/\bservice\b/i.test(grp) || /^\s*service\b/i.test(cat)) return "Labor/Service";
  if (/^\s*parts\s*$/i.test(grp) || /^\s*parts\s*$/i.test(cat)) return "Parts";
  if (/^\s*maintenance\s*$/i.test(grp)) return "Parts";
  if (/[—–-]/.test(cat) && !isFuel(cat)) return "Parts";
  return "Others";
}

function normOutcome(value) {
  var s = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (s === "notbought" || s === "not-bought") return "not-bought";
  if (s === "duplicate" || s.indexOf("duplicate") === 0) return "duplicate";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "bought") return "bought";
  return s;
}

function lineOutcome(line) {
  if (!line || !line.liq) return "";
  return normOutcome(line.liq.outcome != null ? line.liq.outcome : line.liq.status);
}

function lineExcluded(line) {
  if (!line) return true;
  if (line.notBought) return true;
  var vs = String(line.vstatus || "");
  if (/^not[- ]bought$/i.test(vs) || /^duplicate\b/i.test(vs) || /^cancel/i.test(vs)) return true;
  var outcome = lineOutcome(line);
  if (outcome === "not-bought" || outcome === "cancelled" || outcome === "duplicate") return true;
  return false;
}

function lineAmount(line) {
  if (!line) return 0;
  var q = money(line.qty);
  var p = money(line.price);
  if (q || p) return round2(q * p);
  return round2(money(line.total));
}

function fuelLiters(line) {
  if (!line || categoryOf(line) !== "Fuel") return 0;
  var liters = money(line.liters);
  if (liters > 0) return liters;
  var unit = String(line.unit || "").trim().toLowerCase();
  if (/^(l|lt|ltr|liter|liters|litre|litres)$/.test(unit)) return money(line.qty);
  return 0;
}

function parseOdo(v) {
  if (v == null || String(v).trim() === "") return null;
  var n = parseFloat(String(v).replace(/,/g, "").trim());
  return isFinite(n) ? n : null;
}

function reserveOdo(reserve) {
  if (!reserve) return null;
  var n = parseOdo(reserve.draftOdo);
  if (n == null) n = parseOdo(reserve.odoAtRequest);
  if (n == null) n = parseOdo(reserve.odo);
  return n;
}

function vrfSeq(v) {
  var n = parseInt(String(v == null ? "" : v).replace(/\D/g, ""), 10);
  return isFinite(n) ? n : 0;
}

function keepReserve(reserve) {
  if (!reserve || reserve.archived === true) return false;
  var st = String(reserve.status || "");
  if (st === "Archived" || st === "Rejected") return false;
  return true;
}

function ledgerList(ledger) {
  var out = [];
  if (Array.isArray(ledger)) {
    ledger.forEach(function (row) { if (row) out.push(row); });
    return out;
  }
  if (!ledger || typeof ledger !== "object") return out;
  Object.keys(ledger).forEach(function (key) {
    var pack = ledger[key];
    var rows = Array.isArray(pack) ? pack : (pack && pack.rows) || [];
    rows.forEach(function (row) {
      if (!row) return;
      if (!row.month && /^\d{4}-\d{2}$/.test(key)) out.push(Object.assign({ month: key }, row));
      else out.push(row);
    });
  });
  return out;
}

function lineInPeriod(line, month, from, to) {
  var d = dateKey(line && line.date);
  if (d) return d >= from && d <= to;
  return String((line && line.month) || "") === month;
}

function classify(reserve, lines) {
  var st = String((reserve && reserve.status) || "").trim();
  var outcome = normOutcome(reserve && reserve.cancelOutcome);
  var lineStatus = "";
  var liq = "";
  (lines || []).forEach(function (line) {
    if (!lineStatus && line && line.vstatus) lineStatus = String(line.vstatus).trim();
    if (!liq) liq = lineOutcome(line);
  });
  if (outcome === "duplicate" || /^duplicate\b/i.test(st) || liq === "duplicate" || /^duplicate\b/i.test(lineStatus)) {
    return "Duplicate";
  }
  if (outcome === "not-bought" || /^not[- ]bought$/i.test(st) || liq === "not-bought" || /^not[- ]bought$/i.test(lineStatus)) {
    return "Not bought";
  }
  if (outcome === "cancelled" || /^cancel/i.test(st) || liq === "cancelled" || /^cancel/i.test(lineStatus)) {
    return "Cancelled";
  }
  if (/^requested$/i.test(st) || /^for approval$/i.test(st) || /^sent for approval$/i.test(st) || /^requested$/i.test(lineStatus)) {
    return "Pending";
  }
  if (/^flagged$/i.test(st)) return "Flagged";
  if (/^closed$/i.test(st) || (reserve && reserve.liquidatedAt) || /^closed$/i.test(lineStatus) || (lines || []).some(function (line) { return line && line.liq; })) {
    return "Closed";
  }
  if (/^approved$/i.test(st) || /^open$/i.test(st) || /^open$/i.test(lineStatus) || /^approved$/i.test(lineStatus) || /awaiting liquidation/i.test(st)) {
    return "Open";
  }
  if (!reserve && !lineStatus) return "Legacy";
  if (/^open$/i.test(lineStatus)) return "Open";
  return lineStatus ? "Legacy" : "Legacy";
}

function isClosedStatus(status) {
  return status === "Closed" || status === "Flagged" || status === "Not bought" || status === "Legacy";
}

function isApprovedStatus(status) {
  return status === "Open" || isClosedStatus(status);
}

function textOf() {
  var parts = [];
  for (var i = 0; i < arguments.length; i++) {
    var s = String(arguments[i] == null ? "" : arguments[i]).replace(/\s+/g, " ").trim();
    if (s && parts.indexOf(s) < 0) parts.push(s);
  }
  return parts.join("; ");
}

function descriptionOf(reserve, lines) {
  var purpose = reserve && (reserve.draftPurpose || reserve.scope || reserve.notes);
  if (purpose && String(purpose).trim()) return String(purpose).replace(/\s+/g, " ").trim();
  var bits = [];
  (lines || []).forEach(function (line) {
    var bit = textOf(line && line.item, line && !line.item ? line.notes : "");
    if (bit && bits.indexOf(bit) < 0) bits.push(bit);
  });
  return bits.join("; ").slice(0, 240);
}

function jobTypeOf(reserve, lines) {
  var work = String((reserve && reserve.work) || "").trim();
  if (work) return work;
  for (var i = 0; i < (lines || []).length; i++) {
    if (lines[i] && String(lines[i].work || "").trim()) return String(lines[i].work).trim();
  }
  return "";
}

function requestedByOf(reserve, lines) {
  var who = String((reserve && reserve.requestedBy) || "").trim();
  if (who) return who;
  for (var i = 0; i < (lines || []).length; i++) {
    if (lines[i] && String(lines[i].requestedBy || "").trim()) return String(lines[i].requestedBy).trim();
  }
  return "";
}

function projectOf(reserve, lines) {
  var p = String((reserve && reserve.project) || "").trim();
  if (p) return p;
  for (var i = 0; i < (lines || []).length; i++) {
    if (lines[i] && String(lines[i].project || "").trim()) return String(lines[i].project).trim();
  }
  return "";
}

function unitOf(reserve, lines) {
  var u = String((reserve && (reserve.veh || reserve.unit)) || "").trim();
  if (u) return u;
  for (var i = 0; i < (lines || []).length; i++) {
    if (lines[i] && String(lines[i].veh || "").trim()) return String(lines[i].veh).trim();
  }
  return "";
}

function dateOf(reserve, lines) {
  var d = dateKey(reserve && reserve.date);
  if (d) return d;
  var best = "";
  (lines || []).forEach(function (line) {
    var k = dateKey(line && line.date);
    if (k && (!best || k < best)) best = k;
  });
  return best;
}

function odoFromLines(lines) {
  for (var i = 0; i < (lines || []).length; i++) {
    var n = parseOdo(lines[i] && lines[i].odo);
    if (n != null) return n;
  }
  return null;
}

function approvedAmountOf(status, reserve, lines) {
  if (status === "Duplicate" || status === "Cancelled" || status === "Pending") return 0;
  if (reserve && reserve.approvedBudget != null && reserve.approvedBudget !== "") return round2(money(reserve.approvedBudget));
  if (reserve && reserve.budget != null && reserve.budget !== "" && status !== "Legacy") return round2(money(reserve.budget));
  if (status === "Legacy") {
    var t = 0;
    (lines || []).forEach(function (line) {
      if (!lineExcluded(line)) t += lineAmount(line);
    });
    return round2(t);
  }
  var draft = 0;
  ((reserve && reserve.draftLines) || []).forEach(function (line) {
    if (line && (line.cat || line.item)) draft += lineAmount(line);
  });
  return round2(draft);
}

function requestedAmountOf(reserve, lines) {
  if (reserve && reserve.budget != null && reserve.budget !== "") return round2(money(reserve.budget));
  if (reserve && reserve.approvedBudget != null && reserve.approvedBudget !== "") return round2(money(reserve.approvedBudget));
  var t = 0;
  ((reserve && reserve.draftLines) || []).forEach(function (line) {
    if (line && (line.cat || line.item)) t += lineAmount(line);
  });
  if (t) return round2(t);
  (lines || []).forEach(function (line) { t += lineAmount(line); });
  return round2(t);
}

function spendLines(status, reserve, lines) {
  if (status === "Duplicate" || status === "Cancelled" || status === "Not bought" || status === "Pending" || status === "Open") {
    return [];
  }
  var posted = (lines || []).filter(function (line) { return line && line.src !== "reserve-hold"; });
  var use = posted.length ? posted : (lines || []).slice();
  use = use.filter(function (line) { return line && !lineExcluded(line); });
  if (use.length) return use;
  if (!reserve || (status !== "Closed" && status !== "Flagged" && status !== "Legacy")) return [];
  if (reserve.actual != null && reserve.actual !== "") {
    return [{
      total: reserve.actual,
      veh: reserve.veh || "",
      project: reserve.project || "",
      grp: "Others",
      cat: "",
      vstatus: "Closed",
      liq: { outcome: "bought" },
    }];
  }
  return [];
}

function buildSlots(reserves, lines, month, from, to) {
  var slots = [];
  var byKey = {};
  var byVrf = {};
  var byReserve = {};
  var claimCount = {};
  var inRes = (reserves || []).filter(function (r) {
    return keepReserve(r) && dateKey(r.date) && dateKey(r.date) >= from && dateKey(r.date) <= to;
  });
  inRes.forEach(function (r) {
    var claim = String(r.vrfNo || "").trim();
    if (claim) claimCount[claim] = (claimCount[claim] || 0) + 1;
  });
  inRes.forEach(function (r) {
    var claim = String(r.vrfNo || "").trim();
    var key = !claim ? "rsv:" + r.no : (claimCount[claim] > 1 ? claim + "@" + r.no : claim);
    var slot = { key: key, vrf: claim || ("RSV-" + r.no), reserve: r, lines: [] };
    slots.push(slot);
    byKey[key] = slot;
    byReserve[String(r.no)] = slot;
    if (claim && claimCount[claim] === 1) byVrf[claim] = slot;
  });
  (lines || []).forEach(function (line) {
    if (!line || !lineInPeriod(line, month, from, to)) return;
    var vrf = String(line.vrf || "").trim();
    var rno = String(line.reserve || "").trim();
    var slot = (rno && byReserve[rno]) || (vrf && byVrf[vrf]) || null;
    if (slot && slot.reserve && rno && String(slot.reserve.no) !== rno) slot = null;
    if (!slot && vrf) {
      slot = byVrf[vrf];
      if (!slot) {
        slot = { key: vrf, vrf: vrf, reserve: null, lines: [] };
        slots.push(slot);
        byVrf[vrf] = slot;
      }
    }
    if (!slot) return;
    slot.lines.push(line);
  });
  return slots;
}

function historyReadings(reserves, lines) {
  var by = {};
  function put(vrf, unit, date, odo) {
    vrf = String(vrf || "").trim();
    unit = String(unit || "").trim();
    date = dateKey(date);
    if (!vrf || !unit || !date || odo == null) return;
    var key = unit + "\0" + vrf;
    var prev = by[key];
    if (!prev || date < prev.date) by[key] = { vrf: vrf, unit: unit, date: date, odo: odo };
  }
  (lines || []).forEach(function (line) {
    if (!line) return;
    put(line.vrf, line.veh, line.date, parseOdo(line.odo));
  });
  (reserves || []).forEach(function (r) {
    if (!keepReserve(r)) return;
    put(r.vrfNo, r.veh, r.date, reserveOdo(r));
  });
  return Object.keys(by).map(function (k) { return by[k]; });
}

function previousReading(readings, unit, vrf, date) {
  var best = null;
  readings.forEach(function (row) {
    if (!row || row.unit !== unit || row.vrf === vrf) return;
    if (!row.date || !date) return;
    var earlier = row.date < date || (row.date === date && vrfSeq(row.vrf) < vrfSeq(vrf));
    if (!earlier) return;
    if (!best || row.date > best.date || (row.date === best.date && vrfSeq(row.vrf) > vrfSeq(best.vrf))) best = row;
  });
  return best;
}

function buildMonthlyVrfReport(input) {
  input = input || {};
  var month = parseMonth(input.month);
  var now = asDate(input.now);
  var today = manilaToday(now);
  var from = month + "-01";
  var end = monthEnd(month);
  var to = end;
  var monthToDate = month === currentMonth(now);
  if (monthToDate && today < end) to = today;
  var future = today < from;
  if (future) to = today;

  var reserves = Array.isArray(input.reserves) ? input.reserves : [];
  var lines = ledgerList(input.ledger);
  var slots = future || to < from ? [] : buildSlots(reserves, lines, month, from, to);
  var readings = historyReadings(reserves, lines);

  var records = slots.map(function (slot) {
    var reserve = slot.reserve;
    var status = classify(reserve, slot.lines);
    var spend = spendLines(status, reserve, slot.lines);
    var actual = 0;
    spend.forEach(function (line) { actual += lineAmount(line); });
    actual = round2(actual);
    var approved = approvedAmountOf(status, reserve, spend.length ? spend : slot.lines);
    var odo = odoFromLines(slot.lines);
    if (odo == null) odo = reserveOdo(reserve);
    return {
      vrf: slot.vrf,
      reserve: reserve && reserve.no != null ? String(reserve.no) : "",
      date: dateOf(reserve, slot.lines),
      unit: unitOf(reserve, slot.lines),
      requestedBy: requestedByOf(reserve, slot.lines),
      jobType: jobTypeOf(reserve, slot.lines),
      description: descriptionOf(reserve, slot.lines),
      project: projectOf(reserve, slot.lines) || "(no project)",
      approved: approved,
      actual: actual,
      requested: requestedAmountOf(reserve, slot.lines),
      status: status,
      odo: odo,
      duplicateOf: String((reserve && reserve.duplicateOf) || "").trim(),
      spend: spend,
    };
  });

  records.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return vrfSeq(a.vrf) - vrfSeq(b.vrf) || String(a.vrf).localeCompare(String(b.vrf));
  });

  var summary = {
    raised: records.length,
    approved: 0,
    closed: 0,
    open: 0,
    cancelled: 0,
    duplicates: 0,
    pending: 0,
    flagged: 0,
    notBought: 0,
    approvedAmount: 0,
    actualSpent: 0,
    variance: 0,
  };
  records.forEach(function (row) {
    if (row.status === "Pending") summary.pending += 1;
    else if (row.status === "Open") summary.open += 1;
    else if (row.status === "Cancelled") summary.cancelled += 1;
    else if (row.status === "Duplicate") summary.duplicates += 1;
    else if (isClosedStatus(row.status)) summary.closed += 1;
    if (row.status === "Flagged") summary.flagged += 1;
    if (row.status === "Not bought") summary.notBought += 1;
    if (isApprovedStatus(row.status)) {
      summary.approved += 1;
      summary.approvedAmount += row.approved;
    }
    summary.actualSpent += row.actual;
  });
  summary.approvedAmount = round2(summary.approvedAmount);
  summary.actualSpent = round2(summary.actualSpent);
  summary.variance = round2(summary.actualSpent - summary.approvedAmount);

  var catMap = {};
  CATEGORIES.forEach(function (name) {
    catMap[name] = { category: name, amount: 0, liters: 0, vrfCount: 0, vrfs: {} };
  });
  var vehMap = {};
  var projMap = {};
  records.forEach(function (row) {
    var seenCat = {};
    var seenVeh = {};
    var seenProj = {};
    row.spend.forEach(function (line) {
      var amount = lineAmount(line);
      var cat = categoryOf(line);
      var bucket = catMap[cat] || catMap.Others;
      bucket.amount += amount;
      if (cat === "Fuel") bucket.liters += fuelLiters(line);
      if (!seenCat[cat]) { seenCat[cat] = 1; bucket.vrfs[row.vrf] = 1; }
      var unit = String((line && line.veh) || row.unit || "").trim() || "(no unit)";
      if (!vehMap[unit]) vehMap[unit] = { unit: unit, count: 0, liters: 0, amount: 0, vrfs: {} };
      vehMap[unit].amount += amount;
      vehMap[unit].liters += fuelLiters(line);
      if (!seenVeh[unit]) { seenVeh[unit] = 1; vehMap[unit].vrfs[row.vrf] = 1; }
      var project = String((line && line.project) || row.project || "").trim() || "(no project)";
      if (!projMap[project]) projMap[project] = { project: project, count: 0, amount: 0, vrfs: {} };
      projMap[project].amount += amount;
      if (!seenProj[project]) { seenProj[project] = 1; projMap[project].vrfs[row.vrf] = 1; }
    });
  });
  var byCategory = CATEGORIES.map(function (name) {
    var bucket = catMap[name];
    var liters = round2(bucket.liters);
    return {
      category: name,
      amount: round2(bucket.amount),
      liters: name === "Fuel" ? liters : null,
      avgPricePerLiter: name === "Fuel" && liters > 0 ? round2(bucket.amount / liters) : null,
      count: Object.keys(bucket.vrfs).length,
    };
  });
  var byVehicle = Object.keys(vehMap).map(function (key) {
    var row = vehMap[key];
    return {
      unit: row.unit,
      count: Object.keys(row.vrfs).length,
      liters: round2(row.liters),
      amount: round2(row.amount),
    };
  }).filter(function (row) { return row.amount !== 0 || row.liters !== 0; });
  byVehicle.sort(function (a, b) {
    if (b.amount !== a.amount) return b.amount - a.amount;
    return String(a.unit).localeCompare(String(b.unit));
  });
  var byProject = Object.keys(projMap).map(function (key) {
    var row = projMap[key];
    return {
      project: row.project,
      count: Object.keys(row.vrfs).length,
      amount: round2(row.amount),
    };
  }).filter(function (row) { return row.amount !== 0; });
  byProject.sort(function (a, b) {
    if (b.amount !== a.amount) return b.amount - a.amount;
    return String(a.project).localeCompare(String(b.project));
  });

  function publicRow(row) {
    return {
      vrf: row.vrf,
      reserve: row.reserve,
      date: row.date,
      unit: row.unit,
      requestedBy: row.requestedBy,
      jobType: row.jobType,
      description: row.description,
      project: row.project,
      approved: row.approved,
      actual: row.actual,
      requested: row.requested,
      status: row.status,
      odo: row.odo,
      duplicateOf: row.duplicateOf,
    };
  }

  var top = records.filter(function (row) {
    return row.status !== "Duplicate" && row.status !== "Cancelled";
  }).map(function (row) {
    var rank = row.actual > 0 ? row.actual : (row.approved > 0 ? row.approved : row.requested);
    return { row: row, rank: rank, basis: row.actual > 0 ? "actual" : (row.approved > 0 ? "approved" : "requested") };
  }).filter(function (item) { return item.rank > 0; });
  top.sort(function (a, b) {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return vrfSeq(a.row.vrf) - vrfSeq(b.row.vrf);
  });
  var top10 = top.slice(0, 10).map(function (item) {
    var out = publicRow(item.row);
    out.rankAmount = round2(item.rank);
    out.basis = item.basis;
    return out;
  });

  var openOlder = [];
  var duplicates = [];
  records.forEach(function (row) {
    if (row.status === "Duplicate") duplicates.push(publicRow(row));
    if (row.status !== "Open") return;
    var age = daysBetween(row.date, today);
    if (age != null && age > 7) {
      var item = publicRow(row);
      item.ageDays = age;
      item.detail = "VRF " + row.vrf + " · " + (row.unit || "—") + " · open " + age + " days, not liquidated";
      openOlder.push(item);
    }
  });

  var odometer = [];
  var reportRefs = records.map(function (row) {
    return { vrf: row.vrf, unit: row.unit, date: row.date, odo: row.odo, status: row.status };
  });
  reportRefs.forEach(function (row) {
    if (!row.unit || row.odo == null) return;
    var prev = previousReading(readings, row.unit, row.vrf, row.date);
    if (prev && row.odo < prev.odo) {
      odometer.push({
        vrf: row.vrf,
        unit: row.unit,
        date: row.date,
        odo: row.odo,
        kind: "lower-than-previous",
        previousVrf: prev.vrf,
        previousUnit: prev.unit,
        previousDate: prev.date,
        previousOdo: prev.odo,
        detail: "VRF " + row.vrf + " · " + row.unit + " · odometer " + row.odo +
          " is lower than VRF " + prev.vrf + " (" + prev.odo + ") on " + prev.date,
      });
    }
  });
  var byOdo = {};
  reportRefs.forEach(function (row) {
    if (row.odo == null || row.odo <= 0 || !row.unit) return;
    var key = String(row.odo);
    if (!byOdo[key]) byOdo[key] = [];
    byOdo[key].push(row);
  });
  Object.keys(byOdo).forEach(function (key) {
    var group = byOdo[key];
    var units = {};
    group.forEach(function (row) { units[row.unit] = 1; });
    if (Object.keys(units).length < 2) return;
    group.forEach(function (row) {
      var other = null;
      for (var i = 0; i < group.length; i++) {
        if (group[i].unit !== row.unit) { other = group[i]; break; }
      }
      if (!other) return;
      odometer.push({
        vrf: row.vrf,
        unit: row.unit,
        date: row.date,
        odo: row.odo,
        kind: "identical-other-unit",
        otherVrf: other.vrf,
        otherUnit: other.unit,
        otherDate: other.date,
        otherOdo: other.odo,
        detail: "VRF " + row.vrf + " · " + row.unit + " · odometer " + row.odo +
          " is the same as VRF " + other.vrf + " on " + other.unit,
      });
    });
  });

  var periodLabel = monthLabel(month);
  if (monthToDate) periodLabel = "1–" + Number(to.slice(8, 10)) + " " + monthLabel(month) + " (month to date)";

  var list = records.map(publicRow);

  return {
    header: {
      company: COMPANY,
      title: REPORT_TITLE,
      month: month,
      monthLabel: monthLabel(month),
      periodLabel: periodLabel,
      from: from,
      to: future ? "" : to,
      monthToDate: monthToDate && !future,
      future: future,
      generatedAt: formatManilaIso(now),
      generatedAtLabel: formatManilaLabel(now),
      build: input.build == null ? "" : String(input.build),
    },
    summary: summary,
    byCategory: byCategory,
    byVehicle: byVehicle,
    byProject: byProject,
    top: top10,
    vrfs: list,
    exceptions: {
      openOlderThan7Days: openOlder,
      duplicatesCancelled: duplicates,
      odometer: odometer,
    },
  };
}

var api = {
  COMPANY: COMPANY,
  REPORT_TITLE: REPORT_TITLE,
  buildMonthlyVrfReport: buildMonthlyVrfReport,
  categoryOf: categoryOf,
  currentMonth: currentMonth,
  defaultReportMonth: defaultReportMonth,
  formatPeso: formatPeso,
  parseMonth: parseMonth,
};

if (typeof module === "object" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.VrfMonthlyReport = api;
