"use strict";

/**
 * Fuel audit checks for the Motorpool portal.
 *
 * TODO: Load this seed from Google Sheet
 * 1rF-ee4RpinJ6EZCxvZ15aWKFEFDmhSNAI-zKy7DBnUg
 * tabs "Unit Fuel Reference", "Loaded Benchmarks", and "Daily Fuel Allocation"
 * when runtime sheet access is available. Until then the tables below are the
 * seeded copy. Daily Fuel Allocation column K (Jeffrey override days) wins
 * over the computed cycle. Max litres per fill = daily allocation × that cycle.
 *
 * This file does not approve VRFs and does not decide who may approve.
 */

var SHORT_GAP_KM_DEFAULT = 50;
var AMOUNT_TOLERANCE_DEFAULT = 1;

/* measure, normal, low, high, red, dir, floor, broken, note */
var UNIT_REF = {
  "BH-03": pack("L/hr", 5.29, 4.13, 7.76, 10.33, "above", 16.8, false, ""),
  "BH-05": pack("L/hr", 2.19, 1.91, 3.35, 4.28, "above", 5.6, false, ""),
  "BH-06": pack("L/hr", 3.84, 2.95, 4.4, 5.89, "above", 11.5, false, ""),
  "BH-08": pack("L/hr", 3.08, 2.52, 4.01, 6.56, "above", 9.9, false, ""),
  "BH-09": pack("L/hr", 3.34, 2.43, 3.99, 4.37, "above", 9.9, false, ""),
  "BH-10": pack("L/hr", 8.73, 5.24, 9.98, 13.19, "above", 29.9, false, ""),
  "BT-01": pack("km/L", null, null, null, null, "below", 1.3, false, "No unit-fuel baseline yet"),
  "BT-02": pack("km/L", 4.28, 2.9, 5.35, 1.95, "below", 1.3, false, "Use normal 4–5 km/L (override)"),
  "BT-03": pack("L/day", null, 2.5, 3.3, 10, "above", null, true, "Odometer broken — litres per day since last fill"),
  "DT-05": pack("km/L", 1.98, 1.26, 3.01, 0.91, "below", 1.3, false, ""),
  "DT-06": pack("km/L", null, null, null, null, "below", 1.3, false, "No unit-fuel baseline yet"),
  "DT-08": pack("km/L", 2.2, 1.82, 2.53, 1.36, "below", 1.3, false, ""),
  "MC-05": pack("km/L", 36.31, 35.07, 68.26, 23.79, "below", null, false, ""),
  "MC-07": pack("km/L", 72, 49.25, 116.09, 42.31, "below", null, false, ""),
  "MC-14": pack("km/L", 28.69, 22.76, 47.35, 13.39, "below", null, false, ""),
  "MC-16": pack("km/L", 50.78, 46.07, 56.66, 30.9, "below", null, false, ""),
  "MC-21": pack("km/L", 41.67, 35.82, 58.67, 27.8, "below", null, false, ""),
  "MC-27": pack("km/L", 59.75, 41.25, 87.3, 36.9, "below", null, false, ""),
  "RR-03": pack("L/hr", 4.5, 2.59, 8.85, 13.97, "above", null, false, ""),
  "SV-03": pack("km/L", 12.59, 7.53, 19.73, 5.69, "below", 5, false, ""),
  "SV-09": pack("km/L", 6.7, 4.68, 9.18, 2.67, "below", 5, false, ""),
  "SV-10": pack("km/L", 6.87, 5.91, 9.71, 5.11, "below", 5, false, ""),
  "SV-11": pack("km/L", 3.05, 2.94, 3.32, 2.87, "below", 5, false, ""),
  "SV-12": pack("L/day", null, 5, 6.5, 13, "above", null, true, "Odometer broken — litres per day since last fill"),
  "SV-13": pack("km/L", 7.44, 6.89, 9.4, 5.47, "below", 5, false, ""),
  "TM-03": pack("L/hr", 0.92, 0.53, 1.17, 5.6, "above", null, false, "Meter type unconfirmed — loaded floor not judged"),
  "TM-04": pack("L/hr", 2.6, 2.36, 5.41, 10.94, "above", 9.2, false, "")
};

var CLASS_FLOOR = { DT: { measure: "km/L", floor: 1.3 }, BT: { measure: "km/L", floor: 1.3 }, SV: { measure: "km/L", floor: 5 } };

var NO_BASELINE = {
  "BT-01": 1, "BT-04": 1, "DT-01": 1, "DT-02": 1, "DT-03": 1, "DT-04": 1, "DT-06": 1, "DT-07": 1,
  "MBC-01": 1, "MC-01": 1, "MC-02": 1, "MC-04": 1, "MC-09": 1, "MC-15": 1, "MC-20": 1, "MC-22": 1,
  "MC-23": 1, "MC-24": 1, "MC-25": 1, "MC-26": 1, "MC-28": 1, "MC-29": 1, "MC-31": 1, "MC-32": 1,
  "RR-02": 1, "ST-01": 1, "ST-02": 1, "ST-03": 1, "SV-01": 1, "SV-02": 1, "SV-04": 1, "SV-06": 1,
  "SV-08": 1, "SV-14": 1, "SV-16": 1, "SV-17": 1, "SV-18": 1, "TM-01": 1
};

/* daily L, computed cycle days, Jeffrey override days (null when col K is blank), sheet max */
var ALLOCATION = {
  "BH-03": alloc(11.5, 13, null),
  "BH-05": alloc(6.5, 7.5, null),
  "BH-06": alloc(20, 4.5, null),
  "BH-08": alloc(10, 6.1, null),
  "BH-09": alloc(11, 8.5, null),
  "BH-10": alloc(37, 5.5, null),
  "BT-01": alloc(13.5, 3.9, null),
  "BT-02": alloc(13.5, 3.7, null),
  "BT-03": alloc(2.5, 7.7, null),
  "BT-04": alloc(6, 9, null),
  "DT-01": alloc(4, 13.1, null),
  "DT-02": alloc(3, 11.2, null),
  "DT-03": alloc(41.5, 13.5, null),
  "DT-04": alloc(8.5, 4.8, null),
  "DT-05": alloc(5.5, 8.3, null),
  "DT-06": alloc(3, 14, null),
  "DT-08": alloc(9, 6.2, null),
  "MBC-01": alloc(12.5, 7.7, null),
  "MC-01": alloc(1, 4.7, null),
  "MC-02": alloc(0.5, 7, null),
  "MC-04": alloc(0.5, 12, null),
  "MC-05": alloc(1.5, 3, null),
  "MC-07": alloc(0.5, 6.6, null),
  "MC-14": alloc(0.5, 7, null),
  "MC-15": alloc(0.5, 15.9, null),
  "MC-16": alloc(1, 6.3, null),
  "MC-21": alloc(1.5, 2.3, null),
  "MC-23": alloc(1, 8, null),
  "MC-27": alloc(1, 4.8, null),
  "MC-28": alloc(0.5, 8, null),
  "MC-31": alloc(0.5, 14, null),
  "MC-32": alloc(0.5, 18, null),
  "RR-03": alloc(9, 6, null),
  "ST-01": alloc(7, 6, null),
  "ST-02": alloc(7, 10.7, null),
  "ST-03": alloc(6, 7.3, null),
  "SV-02": alloc(2, 20, null),
  "SV-03": alloc(6, 8.1, null),
  "SV-08": alloc(8.5, 6, null),
  "SV-09": alloc(2.5, 8.9, null),
  "SV-10": alloc(5.5, 8, null),
  "SV-11": alloc(2.5, 15.2, null),
  "SV-12": alloc(5, 7.3, null),
  "SV-13": alloc(6, 8.4, null),
  "SV-14": alloc(5, 7, null),
  "SV-17": alloc(7, 4, null),
  "TM-03": alloc(8, 7.3, null),
  "TM-04": alloc(12, 6.7, null)
};

var CHECKLIST_ITEMS = [
  { id: "photo", label: "Photo checked" },
  { id: "km", label: "Km since last fill vs normal" },
  { id: "gauge", label: "Gauge" },
  { id: "duplicate", label: "Duplicate check" },
  { id: "project", label: "Project match" }
];

function pack(measure, normal, low, high, red, dir, floor, broken, note) {
  return {
    measure: measure,
    normal: normal,
    low: low,
    high: high,
    red: red,
    dir: dir,
    floor: floor,
    brokenOdo: !!broken,
    note: note || ""
  };
}
function alloc(daily, cycleDays, overrideDays) {
  return { daily: daily, cycleDays: cycleDays, overrideDays: overrideDays };
}

function num(v) {
  if (v == null || String(v).trim() === "") return null;
  var n = parseFloat(String(v).replace(/,/g, ""));
  return isFinite(n) ? n : null;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function unitCode(code) {
  return String(code || "").trim().toUpperCase();
}
function isoDay(v) {
  var s = String(v || "").trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return m[1] + "-" + m[2] + "-" + m[3];
}
function dayNumber(iso) {
  var d = isoDay(iso);
  if (!d) return null;
  var p = d.split("-");
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / 86400000;
}
function addDays(iso, days) {
  var n = dayNumber(iso);
  if (n == null || !isFinite(days)) return "";
  var dt = new Date((n + days) * 86400000);
  var y = dt.getUTCFullYear();
  var m = String(dt.getUTCMonth() + 1);
  var da = String(dt.getUTCDate());
  if (m.length < 2) m = "0" + m;
  if (da.length < 2) da = "0" + da;
  return y + "-" + m + "-" + da;
}
function daysBetween(a, b) {
  var x = dayNumber(a), y = dayNumber(b);
  if (x == null || y == null) return null;
  return y - x;
}
function closedStatus(status) {
  var s = String(status || "").trim().toLowerCase();
  return s === "cancelled" || s === "canceled" || s === "duplicate" || s === "not bought" || s === "rejected" || s === "archived";
}
function normProj(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function classOf(code) {
  var m = unitCode(code).match(/^[A-Z]+/);
  return m ? m[0] : "";
}

function refBundle(override) {
  if (override && override.units) return override;
  return { units: UNIT_REF, allocation: ALLOCATION, classFloor: CLASS_FLOOR, noBaseline: NO_BASELINE };
}
function unitRef(code, ref) {
  ref = refBundle(ref);
  return ref.units[unitCode(code)] || null;
}
function allocationOf(code, ref) {
  ref = refBundle(ref);
  return ref.allocation[unitCode(code)] || null;
}
function cycleDaysOf(row) {
  if (!row) return null;
  if (row.overrideDays != null && isFinite(Number(row.overrideDays)) && Number(row.overrideDays) > 0) return Number(row.overrideDays);
  if (row.cycleDays != null && isFinite(Number(row.cycleDays)) && Number(row.cycleDays) > 0) return Number(row.cycleDays);
  return null;
}
function maxPerFill(code, ref) {
  var row = allocationOf(code, ref);
  if (!row) return null;
  var days = cycleDaysOf(row);
  if (!(row.daily > 0) || !(days > 0)) return null;
  return round2(row.daily * days);
}
function earliestNextFill(lastDate, code, ref) {
  var days = cycleDaysOf(allocationOf(code, ref));
  var day = isoDay(lastDate);
  if (!day || !(days > 0)) return "";
  return addDays(day, Math.round(days));
}

function floorFor(code, ref) {
  var u = unitRef(code, ref);
  if (u && u.floor != null && isFinite(u.floor)) return { floor: u.floor, measure: u.measure, source: "loaded" };
  var cls = classOf(code);
  var bundle = refBundle(ref);
  var cf = bundle.classFloor && bundle.classFloor[cls];
  if (cf && u && u.measure === cf.measure) return { floor: cf.floor, measure: cf.measure, source: "class" };
  if (u && u.red != null && isFinite(u.red)) return { floor: u.red, measure: u.measure, source: "red-flag" };
  if (cf) return { floor: cf.floor, measure: cf.measure, source: "class" };
  return null;
}

function benchmarkPanel(code, ref) {
  var key = unitCode(code);
  var u = unitRef(key, ref);
  var bundle = refBundle(ref);
  if (!u) {
    var note = bundle.noBaseline && bundle.noBaseline[key]
      ? "No baseline yet — odometer photo required."
      : "No benchmark on file.";
    return { known: false, label: "n/a", code: key, lines: [{ k: "Benchmark", v: "n/a" }], note: note, brokenOdo: false };
  }
  var normalText = u.measure === "L/day"
    ? (u.low != null && u.high != null ? (u.low + "–" + u.high + " L/day") : "n/a")
    : (u.normal != null ? (u.normal + " " + u.measure) : "n/a");
  var redText = u.red != null
    ? ((u.dir === "below" ? "below " : "above ") + u.red + " " + u.measure)
    : "n/a";
  var lines = [
    { k: "Measure", v: u.measure },
    { k: "Normal", v: normalText },
    { k: "Red flag", v: redText }
  ];
  var fl = floorFor(key, ref);
  if (fl && fl.floor != null && u.measure !== "L/day") lines.push({ k: "Loaded floor", v: fl.floor + " " + fl.measure });
  if (u.brokenOdo) lines.push({ k: "Meter", v: "Odometer broken — use litres per day" });
  if (u.note) lines.push({ k: "Note", v: u.note });
  return {
    known: true,
    label: normalText,
    code: key,
    measure: u.measure,
    normalText: normalText,
    redText: redText,
    brokenOdo: !!u.brokenOdo,
    lines: lines,
    note: u.note || ""
  };
}

function photoRole(photo) {
  if (!photo) return "";
  var role = String(photo.role || photo.fuelRole || "").trim().toLowerCase();
  if (role === "gauge" || role === "fuel-gauge" || role === "fuel gauge") return "gauge";
  if (role === "odo" || role === "odometer" || role === "hour" || role === "hour-meter" || role === "hour meter" || role === "meter") return "meter";
  if (role === "receipt") return "receipt";
  var cap = String(photo.caption || "").toLowerCase();
  if (/fuel\s*gauge|\bgauge\b/.test(cap)) return "gauge";
  if (/hour\s*meter|\bodometer\b|\bodo\b/.test(cap)) return "meter";
  if (/\breceipt\b|official receipt/.test(cap)) return "receipt";
  return "";
}
function fuelPhotoStatus(photos) {
  if (photos == null) return { known: false, gauge: null, meter: null, receipt: null, missing: false, label: "n/a" };
  var gauge = false, meter = false, receipt = false;
  (photos || []).forEach(function (p) {
    var role = photoRole(p);
    if (role === "gauge") gauge = true;
    if (role === "meter") meter = true;
    if (role === "receipt") receipt = true;
  });
  /* Gauge and odometer photos are optional. A missing gauge is a warning tag,
     never a reason to refuse Send for approval. */
  var noGauge = !gauge;
  return {
    known: true,
    gauge: gauge,
    meter: meter,
    receipt: receipt,
    missing: false,
    noGauge: noGauge,
    label: noGauge ? "No gauge photo" : ""
  };
}
function missingPhotoBadge(spec) {
  spec = spec || {};
  if (!spec.fuel) return "";
  if (spec.photos) {
    var live = fuelPhotoStatus(spec.photos);
    return live.known && live.noGauge ? "No gauge photo" : "";
  }
  if (spec.fuelPhotos && spec.fuelPhotos.gauge === false) return "No gauge photo";
  if (spec.fuelPhotos && spec.fuelPhotos.gauge === true) return "";
  if (spec.photoCount === 0) return "No gauge photo";
  return "";
}

function odoLowerThanLast(reading, last) {
  var now = num(reading), prev = num(last);
  if (now == null || prev == null) return { known: false, lower: false, label: "n/a", reading: now, last: prev };
  return { known: true, lower: now < prev, label: now < prev ? "Odometer is lower than the last reading" : "", reading: now, last: prev };
}

function shortGapFlag(spec) {
  spec = spec || {};
  var threshold = spec.shortGapKm == null ? SHORT_GAP_KM_DEFAULT : Number(spec.shortGapKm);
  if (!isFinite(threshold) || threshold < 0) threshold = SHORT_GAP_KM_DEFAULT;
  var date = isoDay(spec.date), last = isoDay(spec.lastDate);
  if (!date || !last) return { known: false, flag: false, label: "n/a", sameDay: false, shortKm: false, move: null, threshold: threshold };
  var sameDay = date === last;
  var move = null, shortKm = false;
  if (String(spec.meter || "km") !== "hr") {
    var now = num(spec.odo), prev = num(spec.lastOdo);
    if (now != null && prev != null) {
      move = now - prev;
      if (move >= 0 && move < threshold) shortKm = true;
    }
  }
  var flag = !!(sameDay || shortKm);
  var label = "";
  if (sameDay && shortKm) label = "Same day and under " + threshold + " km since the last fill";
  else if (sameDay) label = "Same day as the previous fill";
  else if (shortKm) label = "Only " + round2(move) + " km since the last fill (under " + threshold + ")";
  return { known: true, flag: flag, label: label, sameDay: sameDay, shortKm: shortKm, move: move, threshold: threshold };
}

function allocationFlags(spec) {
  spec = spec || {};
  var max = maxPerFill(spec.unit, spec.ref);
  var earliest = earliestNextFill(spec.lastDate, spec.unit, spec.ref);
  var liters = num(spec.liters);
  if (max == null && !earliest) return { known: false, flag: false, label: "n/a", overMax: false, beforeDate: false, max: null, earliest: "" };
  var over = !!(max != null && liters != null && liters > max + 0.05);
  var day = isoDay(spec.date);
  var early = !!(earliest && day && day < earliest);
  var bits = [];
  if (over) bits.push(round2(liters) + " L is above the " + max + " L max for this unit");
  if (early) bits.push("Before the next fill date " + earliest);
  return {
    known: true,
    flag: over || early,
    label: bits.join(". "),
    overMax: over,
    beforeDate: early,
    max: max,
    earliest: earliest,
    liters: liters
  };
}

function duplicateFuelHits(existing, rec) {
  rec = rec || {};
  var veh = unitCode(rec.veh);
  var date = isoDay(rec.date);
  var liters = num(rec.liters);
  var amount = num(rec.amount);
  var self = String(rec.vrf || "").replace(/\D/g, "");
  var receipt = String(rec.receipt || "").trim().toLowerCase();
  var sameFill = [], reused = [];
  var seenSame = {}, seenReuse = {};
  (existing || []).forEach(function (row) {
    if (!row || closedStatus(row.status)) return;
    var rowVrf = String(row.vrf || "").replace(/\D/g, "");
    var rowVeh = unitCode(row.veh);
    var rowReceipt = String(row.receipt || "").trim().toLowerCase();
    if (self && rowVrf && rowVrf === self && rowVeh === veh) return;
    if (self && rowVrf && rowVrf === self && rowVeh && veh && rowVeh !== veh) {
      var key = rowVrf + "|" + rowVeh;
      if (!seenReuse[key]) { seenReuse[key] = 1; reused.push(row); }
    }
    if (receipt && rowReceipt && rowReceipt === receipt && rowVeh && veh && rowVeh !== veh) {
      var keyR = "r:" + rowReceipt + "|" + rowVeh;
      if (!seenReuse[keyR]) { seenReuse[keyR] = 1; reused.push(row); }
    }
    if (veh && rowVeh === veh && date && isoDay(row.date) === date) {
      var sameL = liters != null && num(row.liters) != null && Math.abs(num(row.liters) - liters) < 0.05;
      var sameA = amount != null && num(row.amount) != null && Math.abs(num(row.amount) - amount) <= AMOUNT_TOLERANCE_DEFAULT;
      if (sameL || sameA) {
        var keyS = (rowVrf || rowReceipt || row.date || "") + "|" + rowVeh + "|" + isoDay(row.date);
        if (!seenSame[keyS]) { seenSame[keyS] = 1; sameFill.push(row); }
      }
    }
  });
  var label = "";
  if (sameFill.length && reused.length) label = "Same unit, date and litres or amount, and a VRF or receipt number used on another unit";
  else if (sameFill.length) label = "Same unit, date and litres or amount as another fuel line";
  else if (reused.length) label = "VRF or receipt number is already on another unit";
  return { flag: !!(sameFill.length || reused.length), sameFill: sameFill, reusedNumber: reused, label: label };
}
function reusedVrfNumbers(rows) {
  var by = {};
  (rows || []).forEach(function (row) {
    if (!row || closedStatus(row.status)) return;
    var n = String(row.vrf || "").replace(/\D/g, "");
    var veh = unitCode(row.veh);
    if (!n || !veh || veh === "AV") return;
    if (!by[n]) by[n] = {};
    by[n][veh] = 1;
  });
  var hits = [];
  Object.keys(by).forEach(function (n) {
    var units = Object.keys(by[n]);
    if (units.length > 1) hits.push({ vrf: n, units: units });
  });
  return hits;
}

function voidRecord(rec, spec) {
  spec = spec || {};
  var reason = String(spec.reason || "").trim();
  var by = String(spec.by || "").trim();
  if (!by) return { ok: false, message: "Say who is cancelling it." };
  if (!reason) return { ok: false, message: "A reason is required." };
  var st = String(rec && rec.status || "Draft").trim();
  var key = st.toLowerCase();
  var allowed = !st || key === "draft" || key.indexOf("draft") === 0 || key === "requested" || key === "pending" || key === "for approval" || key === "sent for approval" || key.indexOf("requested") === 0;
  if (!allowed) return { ok: false, message: "Only a draft or a requested VRF can be voided here." };
  var at = String(spec.at || "").trim();
  var next = {};
  Object.keys(rec || {}).forEach(function (k) { next[k] = rec[k]; });
  next.status = "Cancelled";
  next.cancelledBy = by;
  next.cancelledAt = at;
  next.cancelNote = reason;
  next.voidLog = (rec && rec.voidLog || []).concat([{ by: by, at: at, reason: reason, from: st || "Draft" }]);
  return { ok: true, record: next };
}

function mayPrint(entry) {
  var message = "Not approved — cannot print";
  if (!entry) return { ok: false, message: message };
  var vrf = String(entry.vrf || "").trim();
  if (!vrf || /not yet posted/i.test(vrf) || entry.unnumbered) return { ok: false, message: message };
  var st = String(entry.status || "").trim();
  var key = st.toLowerCase();
  if (!st || key === "requested" || key === "rejected" || key === "draft" || key === "pending" || key === "for approval" || key === "sent for approval" || key === "disapproved") {
    return { ok: false, message: message };
  }
  if (entry.held && key !== "open" && key !== "closed" && key !== "legacy" && key !== "approved" && key !== "not bought" && key !== "duplicate" && key !== "cancelled" && key !== "canceled") {
    return { ok: false, message: message };
  }
  if (key === "cancelled" || key === "canceled") {
    var wasApproved = !!(entry.approvedAt || entry.approvedBy || entry.posted || entry.src === "ledger");
    if (!wasApproved && (entry.held || entry.src === "reserve-hold")) return { ok: false, message: message };
  }
  return { ok: true, message: "" };
}

function driverState(rec, spec) {
  spec = spec || {};
  if (!spec.fuel) return { required: false, ok: true, legacy: false, label: "" };
  var has = rec && (Object.prototype.hasOwnProperty.call(rec, "driver") || Object.prototype.hasOwnProperty.call(rec, "operator"));
  var name = String((rec && (rec.driver || rec.operator)) || "").trim();
  if (!has && !spec.entering) return { required: true, ok: true, legacy: true, label: "n/a" };
  if (!name) return { required: true, ok: false, legacy: false, label: "Driver is required on a fuel VRF." };
  return { required: true, ok: true, legacy: false, label: name };
}

function projectMismatch(requestProject, unitProject) {
  var got = String(requestProject || "").trim();
  var expected = String(unitProject || "").trim();
  if (!got || !expected) return { known: false, flag: false, label: "n/a", expected: expected, got: got };
  var flag = normProj(got) !== normProj(expected);
  return {
    known: true,
    flag: flag,
    label: flag ? ("Project " + got + " does not match this unit’s " + expected) : "",
    expected: expected,
    got: got
  };
}

function amountCheck(spec) {
  spec = spec || {};
  var liters = num(spec.liters), price = num(spec.pricePerL), amount = num(spec.amount);
  if (liters == null || price == null || amount == null) return { known: false, ok: true, label: "n/a", diff: null };
  var tol = spec.tolerance == null ? AMOUNT_TOLERANCE_DEFAULT : Number(spec.tolerance);
  if (!isFinite(tol) || tol < 0) tol = AMOUNT_TOLERANCE_DEFAULT;
  var expected = liters * price;
  var diff = Math.abs(expected - amount);
  var ok = diff <= tol + 1e-6;
  return { known: true, ok: ok, label: ok ? "" : ("Litres × price/L is " + round2(expected) + " but the amount is " + round2(amount)), expected: round2(expected), diff: round2(diff), tolerance: tol };
}

function pesosAsLiters(spec) {
  spec = spec || {};
  var liters = num(spec.liters);
  var unit = unitCode(spec.unit);
  if (liters == null) return { known: false, flag: false, label: "n/a", cap: null };
  if (unit === "AV" || /^EQUIPMENT/.test(unit)) return { known: true, flag: false, label: "", cap: null };
  var max = num(spec.maxPerFill);
  var cap;
  if (max != null && max > 0) cap = Math.max(max * 1.5, max + 30);
  else if (/^MC/.test(unit)) cap = 20;
  else if (/^(BH|RR|TM|MBC)/.test(unit)) cap = 400;
  else cap = 120;
  var flag = liters > cap + 0.05 || liters >= 1000;
  return { known: true, flag: flag, label: flag ? (round2(liters) + " L is implausibly large against the " + round2(cap) + " L check") : "", cap: round2(cap) };
}

function priceOutsideRange(price, recent) {
  var p = num(price);
  var nums = [];
  (recent || []).forEach(function (v) { var n = num(v); if (n != null && n > 0) nums.push(n); });
  if (p == null || nums.length < 2) return { known: false, flag: false, label: "n/a", min: null, max: null };
  var min = nums[0], max = nums[0], i;
  for (i = 1; i < nums.length; i++) { if (nums[i] < min) min = nums[i]; if (nums[i] > max) max = nums[i]; }
  var flag = p < min - 0.01 || p > max + 0.01;
  return { known: true, flag: flag, label: flag ? ("₱" + round2(p) + "/L is outside this supplier’s recent ₱" + round2(min) + "–₱" + round2(max)) : "", min: round2(min), max: round2(max), price: round2(p) };
}

function reconcileReserve(reserveLiters, issues) {
  var issued = 0;
  (issues || []).forEach(function (row) { var n = num(row && (row.liters != null ? row.liters : row.litres)); if (n != null && n > 0) issued += n; });
  var stock = num(reserveLiters);
  if (stock == null) return { known: false, label: "n/a", remaining: null, issued: round2(issued), mismatch: false };
  var remaining = stock - issued;
  return {
    known: true,
    reserveLiters: round2(stock),
    issued: round2(issued),
    remaining: round2(remaining),
    mismatch: remaining < -0.05,
    label: remaining < -0.05 ? ("Issued " + round2(issued) + " L against " + round2(stock) + " L in the reserve") : ""
  };
}
function reconcileLots(lots, issues) {
  var by = {};
  (lots || []).forEach(function (lot) {
    if (!lot || !lot.id) return;
    by[String(lot.id)] = { id: String(lot.id), liters: num(lot.liters) || 0, issues: [], date: lot.date || "", source: lot.source || "" };
  });
  var loose = [];
  (issues || []).forEach(function (row) {
    var id = String(row && row.reserve || "");
    if (id && by[id]) by[id].issues.push(row);
    else loose.push(row);
  });
  var rows = Object.keys(by).map(function (id) {
    var lot = by[id];
    var rec = reconcileReserve(lot.liters, lot.issues);
    rec.id = id;
    rec.date = lot.date;
    rec.issueCount = lot.issues.length;
    return rec;
  });
  var looseRec = reconcileReserve(0, loose);
  return { lots: rows, unassigned: loose, unassignedLiters: looseRec.issued };
}

function liquidationStatus(rec, today) {
  rec = rec || {};
  var receipt = "n/a";
  if (rec.receiptUploaded === true || rec.driveUrl || (num(rec.photoCount) != null && num(rec.photoCount) > 0) || (rec.fuelPhotos && rec.fuelPhotos.receipt)) receipt = "y";
  else if (rec.receiptUploaded === false) receipt = "n";
  else if (rec.photosKnown && num(rec.photoCount) === 0) receipt = "n";
  var liq = String(rec.liquidatedAt || rec.liqDate || "").trim();
  var st = String(rec.status || "").toLowerCase();
  var liquidated = !!isoDay(liq) || st === "closed" || st === "liquidated";
  var ended = closedStatus(st) || st === "closed" || st === "legacy";
  var outstanding = !liquidated && !ended && st !== "rejected";
  var aging = null;
  if (outstanding) {
    var span = daysBetween(rec.date, today || "");
    aging = span == null ? null : span;
  }
  return {
    vrf: rec.vrf || "",
    veh: rec.veh || "",
    date: isoDay(rec.date),
    receipt: receipt,
    liquidatedDate: isoDay(liq) || (liquidated ? "n/a" : ""),
    outstanding: outstanding,
    agingDays: aging,
    agingLabel: aging == null ? "n/a" : String(aging)
  };
}

function checklistItems() { return CHECKLIST_ITEMS.map(function (x) { return { id: x.id, label: x.label }; }); }
function normalizeChecklist(raw) {
  if (raw == null) return { known: false, label: "n/a", complete: false, items: [], by: "", at: "" };
  var incoming = {};
  ((raw && raw.items) || []).forEach(function (item) { if (item && item.id) incoming[item.id] = item; });
  var items = CHECKLIST_ITEMS.map(function (def) {
    var got = incoming[def.id] || {};
    return { id: def.id, label: def.label, checked: !!got.checked, note: String(got.note || "") };
  });
  var complete = items.every(function (item) { return item.checked; });
  return { known: true, label: complete ? "complete" : "incomplete", complete: complete, items: items, by: String(raw.by || ""), at: String(raw.at || "") };
}
function checklistReady(raw, needsNote) {
  var norm = normalizeChecklist(raw);
  if (!norm.known) return { ok: false, message: "Tick the encoder checklist before sending a fuel VRF." };
  var i;
  for (i = 0; i < norm.items.length; i++) {
    if (!norm.items[i].checked) return { ok: false, message: "Tick “" + norm.items[i].label + "” before sending." };
    var need = needsNote && needsNote[norm.items[i].id];
    if (need && !norm.items[i].note.trim()) return { ok: false, message: "Add a note on “" + norm.items[i].label + "”." };
  }
  return { ok: true, checklist: norm };
}

function unexplainedInterval(spec) {
  spec = spec || {};
  var liters = num(spec.liters);
  var move = num(spec.move);
  var floor = num(spec.floor);
  var price = num(spec.pricePerL);
  var measure = spec.measure || "";
  if (liters == null || move == null || floor == null || !(floor > 0) || !(move > 0)) {
    return { known: false, liters: null, pesos: null, label: "n/a" };
  }
  var needed = measure === "km/L" ? (move / floor) : (move * floor);
  var extra = liters - needed;
  if (extra < 0) extra = 0;
  var pesos = price != null ? extra * price : null;
  return { known: true, liters: round2(extra), pesos: pesos == null ? null : round2(pesos), needed: round2(needed), rate: round2(measure === "km/L" ? move / liters : liters / move), label: "" };
}

function unexplainedSummary(fills, opts) {
  opts = opts || {};
  var from = isoDay(opts.from), to = isoDay(opts.to);
  var by = {};
  (fills || []).forEach(function (row) {
    if (!row || closedStatus(row.status)) return;
    var veh = unitCode(row.veh);
    if (!veh || veh === "AV") return;
    var day = isoDay(row.date);
    if (!day) return;
    (by[veh] = by[veh] || []).push(row);
  });
  var out = [];
  Object.keys(by).sort().forEach(function (veh) {
    var rows = by[veh].slice().sort(function (a, b) {
      var d = isoDay(a.date).localeCompare(isoDay(b.date));
      if (d) return d;
      return String(a.vrf || "").localeCompare(String(b.vrf || ""));
    });
    var bench = benchmarkPanel(veh, opts.ref);
    var fl = floorFor(veh, opts.ref);
    var liters = 0, pesos = 0, pesosKnown = false, intervals = 0, skipped = 0;
    var i;
    for (i = 1; i < rows.length; i++) {
      var cur = rows[i];
      var prev = rows[i - 1];
      var day = isoDay(cur.date);
      if (from && day < from) continue;
      if (to && day > to) continue;
      var measure = bench.measure || (fl && fl.measure) || "";
      var move = null;
      if (measure === "L/day" || bench.brokenOdo) {
        move = daysBetween(prev.date, cur.date);
        measure = "L/day";
      } else {
        var a = num(prev.odo), b = num(cur.odo);
        if (a != null && b != null && String(Math.round(a)) !== "76260" && String(Math.round(b)) !== "76260" && b > a) move = b - a;
      }
      var floor = null;
      if (measure === "L/day") {
        var u = unitRef(veh, opts.ref);
        floor = u && u.red != null ? u.red : null;
      } else if (fl && fl.measure === measure) floor = fl.floor;
      var price = num(cur.pricePerL);
      if (price == null && num(cur.amount) != null && num(cur.liters) > 0) price = num(cur.amount) / num(cur.liters);
      var hit = unexplainedInterval({ liters: cur.liters, move: move, floor: floor, pricePerL: price, measure: measure === "L/day" ? "L/hr" : measure });
      if (measure === "L/day") {
        hit = unexplainedInterval({ liters: cur.liters, move: move, floor: floor, pricePerL: price, measure: "L/hr" });
      }
      if (!hit.known) { skipped += 1; continue; }
      intervals += 1;
      liters += hit.liters;
      if (hit.pesos != null) { pesos += hit.pesos; pesosKnown = true; }
    }
    out.push({
      veh: veh,
      measure: bench.known ? bench.measure : "n/a",
      normal: bench.known ? bench.normalText : "n/a",
      red: bench.known ? bench.redText : "n/a",
      liters: round2(liters),
      pesos: pesosKnown ? round2(pesos) : null,
      intervals: intervals,
      skipped: skipped,
      benchmark: bench.known ? "" : "n/a"
    });
  });
  return out;
}

var api = {
  SHORT_GAP_KM_DEFAULT: SHORT_GAP_KM_DEFAULT,
  AMOUNT_TOLERANCE_DEFAULT: AMOUNT_TOLERANCE_DEFAULT,
  UNIT_REF: UNIT_REF,
  ALLOCATION: ALLOCATION,
  CHECKLIST_ITEMS: CHECKLIST_ITEMS,
  refBundle: refBundle,
  unitRef: unitRef,
  allocationOf: allocationOf,
  cycleDaysOf: cycleDaysOf,
  maxPerFill: maxPerFill,
  earliestNextFill: earliestNextFill,
  floorFor: floorFor,
  benchmarkPanel: benchmarkPanel,
  photoRole: photoRole,
  fuelPhotoStatus: fuelPhotoStatus,
  missingPhotoBadge: missingPhotoBadge,
  odoLowerThanLast: odoLowerThanLast,
  shortGapFlag: shortGapFlag,
  allocationFlags: allocationFlags,
  duplicateFuelHits: duplicateFuelHits,
  reusedVrfNumbers: reusedVrfNumbers,
  voidRecord: voidRecord,
  mayPrint: mayPrint,
  driverState: driverState,
  projectMismatch: projectMismatch,
  amountCheck: amountCheck,
  pesosAsLiters: pesosAsLiters,
  priceOutsideRange: priceOutsideRange,
  reconcileReserve: reconcileReserve,
  reconcileLots: reconcileLots,
  liquidationStatus: liquidationStatus,
  checklistItems: checklistItems,
  normalizeChecklist: normalizeChecklist,
  checklistReady: checklistReady,
  unexplainedInterval: unexplainedInterval,
  unexplainedSummary: unexplainedSummary
};

if (typeof module === "object" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.FuelAudit = api;
