/**
 * Read-only decision info for a leave or cash-advance form.
 * Counts come from the records already loaded (leaves, advances, Daily
 * Manpower, pay runs, the 201 file). Nothing here writes those records
 * or changes payroll math. Approve stores the object it returns.
 */
(function (root) {
  "use strict";

  if (root.hrDecision && root.hrDecision.version) return;

  var LEAVE_TYPES = [
    { k: "SIL", n: "Service Incentive Leave", pay: true },
    { k: "VL", n: "Vacation Leave", pay: true },
    { k: "SL", n: "Sick Leave", pay: true },
    { k: "EL", n: "Emergency Leave", pay: true },
    { k: "ML", n: "Maternity Leave", pay: true },
    { k: "PL", n: "Paternity Leave", pay: true },
    { k: "SPL", n: "Solo Parent Leave", pay: true },
    { k: "SLW", n: "Special Leave for Women", pay: true },
    { k: "VAWC", n: "VAWC Leave", pay: true },
    { k: "BEREV", n: "Bereavement Leave", pay: true },
    { k: "LWOP", n: "Leave Without Pay", pay: false }
  ];

  var APPROVED_LEAVE = { Approved: 1, Availed: 1 };
  var SKIP_LEAVE = { Disapproved: 1, Cancelled: 1, Rejected: 1, Void: 1 };
  var PENDING_CA = { Requested: 1, Filed: 1, "For signature": 1, "For approval": 1, Pending: 1 };
  var CLOSED_CA = {
    Cancelled: 1,
    Disapproved: 1,
    Rejected: 1,
    Void: 1,
    Liquidated: 1,
    Recovered: 1,
    "Recovered from pay": 1,
    "Fully deducted": 1,
    Paid: 1,
    Settled: 1,
    Closed: 1
  };
  /* Daily Manpower on file starts on this date. Earlier days are not in the sheets. */
  var ATTENDANCE_FIRST = "2026-02-17";
  var APPROVED_CA = { Approved: 1, Released: 1, "Partially liquidated": 1 };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isoDate(v) {
    if (v == null || v === "") return "";
    var s = String(v).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    return m[1] + "-" + m[2] + "-" + m[3];
  }

  function addDays(iso, n) {
    var t = new Date(iso + "T00:00:00Z");
    if (isNaN(t.getTime())) return "";
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  }

  function round2(n) {
    var x = Number(n);
    if (!isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  function numOrNull(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function values(obj) {
    if (!obj || typeof obj !== "object") return [];
    return Object.keys(obj).map(function (k) {
      return obj[k];
    }).filter(function (x) {
      return x && typeof x === "object";
    });
  }

  function manilaDay(now) {
    var d = now instanceof Date ? now : new Date(now || Date.now());
    if (isNaN(d.getTime())) d = new Date();
    var fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    var iso = fmt.format(d);
    var y = Number(iso.slice(0, 4));
    var m = Number(iso.slice(5, 7));
    var day = Number(iso.slice(8, 10));
    return {
      iso: iso,
      year: y,
      label: day + " " + (MONTHS[m - 1] || "") + " " + y
    };
  }

  function pretty(iso) {
    var s = isoDate(iso);
    if (!s) return "";
    return Number(s.slice(8, 10)) + " " + (MONTHS[Number(s.slice(5, 7)) - 1] || "") + " " + s.slice(0, 4);
  }

  function peso(n) {
    var x = round2(n);
    var neg = x < 0;
    var s = Math.abs(x).toFixed(2);
    var p = s.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + "₱" + p[0] + "." + p[1];
  }

  function dayPhrase(n) {
    var x = Math.round(Number(n) * 10) / 10;
    if (!isFinite(x)) x = 0;
    var s = Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1);
    return s + (Math.abs(x - 1) < 0.05 ? " day" : " days");
  }

  function leaveTypeOf(code, catalog) {
    var k = String(code || "");
    var list = catalog || LEAVE_TYPES;
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].k === k) return { k: list[i].k, n: list[i].n, pay: !!list[i].pay };
    }
    if (!k) return { k: "", n: "Type not set", pay: null };
    return { k: k, n: k, pay: null };
  }

  function leaveBucket(status) {
    var s = String(status || "");
    if (APPROVED_LEAVE[s]) return "approved";
    if (SKIP_LEAVE[s]) return "skip";
    return "pending";
  }

  function formKind(kind) {
    var k = String(kind || "").toLowerCase();
    if (k === "lrf" || k === "leave") return "leave";
    if (k === "caf" || k === "ca" || k === "advance") return "ca";
    return k;
  }

  function formApproved(kind, rec) {
    if (!rec) return false;
    if (rec.pdfIncludesSignature) return true;
    var s = String(rec.status || "");
    kind = formKind(kind);
    if (kind === "leave") return s === "Approved" || s === "Availed";
    if (kind === "ca") {
      return s === "Approved" || s === "Released" || s === "Partially liquidated"
        || s === "Liquidated" || s === "Recovered" || s === "Recovered from pay";
    }
    return false;
  }

  function normStatus(row) {
    var raw = String((row && (row.s != null && String(row.s).trim() !== "" ? row.s : row && row.status)) || "").trim();
    var x = raw.toLowerCase().replace(/\s+/g, " ");
    if (!x) return "";
    if (/rest\s*day/.test(x)) return "Rest Day";
    if (/present\s*\/\s*late/.test(x) || /present\s*\(\s*late\s*\)/.test(x) || x === "late" || x === "tardy") return "Present/Late";
    if (/undertime|under\s*time|left\s+early/.test(x)) return "Undertime";
    if (/leave\s+with\s+pay|paid leave/.test(x)) return "Leave with Pay";
    if (/^leave/.test(x)) return "Leave";
    if (/^absent/.test(x)) return "Absent";
    if (/^present/.test(x)) return "Present";
    if (/holiday/.test(x)) return "Holiday";
    return raw;
  }

  function isRestDay(row) {
    if (normStatus(row) === "Rest Day") return true;
    var reason = String((row && (row.r || row.reason)) || "").trim();
    return /^rest\s*day$/i.test(reason);
  }

  /* The manpower day is the doc id (dYYYYMMDD…). `on` is when the row was
     entered, not the day being counted. */
  function recDate(id, rec) {
    var m = String(id || "").match(/^d(\d{4})(\d{2})(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    return isoDate(rec && rec.date);
  }

  function eachDate(from, to) {
    var out = [];
    var d = isoDate(from);
    var end = isoDate(to);
    if (!d || !end || d > end) return out;
    var guard = 0;
    while (d <= end && guard < 400) {
      out.push(d);
      d = addDays(d, 1);
      guard++;
    }
    return out;
  }

  function daysInWindow(rec, winFrom, winTo) {
    var from = isoDate(rec.from || rec.filedOn);
    var to = isoDate(rec.to || rec.from || rec.filedOn);
    if (!from) return 0;
    if (to < winFrom || from > winTo) return 0;
    var inside = from >= winFrom && to <= winTo;
    if (inside && rec.days != null && rec.days !== "" && isFinite(Number(rec.days))) return Number(rec.days);
    if (rec.half && from === to && from >= winFrom && from <= winTo) return 0.5;
    var a = from > winFrom ? from : winFrom;
    var b = to < winTo ? to : winTo;
    return eachDate(a, b).length;
  }

  function leaveCoversDate(leaves, empId, date) {
    var i;
    for (i = 0; i < leaves.length; i++) {
      var l = leaves[i];
      if (!l || l.empId !== empId) continue;
      if (!APPROVED_LEAVE[l.status]) continue;
      var from = isoDate(l.from);
      var to = isoDate(l.to || l.from);
      if (from && date >= from && date <= to) return true;
    }
    return false;
  }

  function blankCount() {
    return { count: 0, days: 0, unset: 0 };
  }

  function leaveUndated(rec) {
    return !isoDate(rec && rec.from) && !isoDate(rec && rec.to);
  }

  function leavesFor(store, empId, currentId, winFrom, winTo, catalog) {
    var byType = {};
    var totalCount = 0;
    var totalDays = 0;
    var totalUnset = 0;
    var thisRequest = null;
    var year = String(winFrom || "").slice(0, 4);
    values(store && store.leaves).forEach(function (l) {
      if (!l || l.empId !== empId) return;
      var id = l.id || "";
      var bucket = leaveBucket(l.status);
      var unset = leaveUndated(l);
      var days = unset ? 0 : daysInWindow(l, winFrom, winTo);
      var type = leaveTypeOf(l.type, catalog);
      if (unset) {
        var filed = isoDate(l.filedOn);
        if (filed && filed.slice(0, 4) !== year) unset = false;
      }
      if (currentId && id === currentId) {
        thisRequest = {
          id: id,
          no: l.no || "",
          type: type.k,
          name: type.n,
          pay: type.pay,
          status: l.status || "",
          days: days,
          daysUnset: unset,
          label: "this request"
        };
        return;
      }
      if (bucket === "skip") return;
      if (unset) {
        var filedYear = isoDate(l.filedOn);
        if (filedYear && filedYear.slice(0, 4) !== year) return;
      } else if (!(days > 0)) return;
      var row = byType[type.k] || {
        type: type.k,
        name: type.n,
        pay: type.pay,
        approved: blankCount(),
        pending: blankCount()
      };
      row[bucket].count += 1;
      if (unset) row[bucket].unset += 1;
      else row[bucket].days = round2(row[bucket].days + days);
      byType[type.k] = row;
      totalCount += 1;
      if (unset) totalUnset += 1;
      else totalDays = round2(totalDays + days);
    });
    var types = Object.keys(byType).map(function (k) {
      return byType[k];
    }).sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
    return { count: totalCount, days: round2(totalDays), unset: totalUnset, byType: types, thisRequest: thisRequest };
  }

  function attendanceRows(store, empId) {
    var out = [];
    var daily = (store && store.daily) || {};
    Object.keys(daily).forEach(function (id) {
      var rec = daily[id];
      if (!rec || typeof rec !== "object") return;
      var date = recDate(id, rec);
      if (!date) return;
      var row = rec.rows && rec.rows[empId];
      if (!row || typeof row !== "object") return;
      out.push({ date: date, row: row });
    });
    return out;
  }

  function countAbsences(rows, leaves, empId, from, to) {
    var days = 0;
    var dates = [];
    rows.forEach(function (item) {
      if (item.date < from || item.date > to) return;
      var row = item.row;
      if (isRestDay(row)) return;
      if (normStatus(row) !== "Absent") return;
      if (leaveCoversDate(leaves, empId, item.date)) return;
      var credit = 1;
      if (row.day != null && String(row.day).trim() !== "" && isFinite(Number(row.day))) {
        var n = Number(row.day);
        if (n > 0 && n < 1) credit = n;
      }
      days = round2(days + credit);
      dates.push(item.date);
    });
    return { days: days, dates: dates };
  }

  var EXCUSED_RK = {
    sick: 1, clinic: 1, fit: 1, al: 1, vl: 1, el: 1, bl: 1, ml: 1,
    ob: 1, assign: 1, weather: 1, calamity: 1, power: 1
  };
  var SUNDAY_KEEP = {
    Absent: 1, "Present/Late": 1, Undertime: 1, "Half Day": 1, Leave: 1, "Leave with Pay": 1
  };

  /* '8:17', '9', '08:04', '1:25 pm', '16:28', '2:00 PM'. Seconds optional.
     On a time-out, an hour below 8 with no am/pm is the afternoon. */
  function parseClock(raw, asOut) {
    if (raw == null) return null;
    var s = String(raw).trim().toLowerCase().replace(/\./g, "");
    if (!s) return null;
    var m = s.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*(am|pm)?$/);
    if (!m) return null;
    var h = Number(m[1]);
    var mi = m[2] != null ? Number(m[2]) : 0;
    if (!isFinite(h) || !isFinite(mi) || h > 23 || mi > 59) return null;
    var ap = m[4] || "";
    if (ap === "am") {
      if (h === 12) h = 0;
    } else if (ap === "pm") {
      if (h < 12) h += 12;
    } else if (asOut && h < 8) {
      h += 12;
    }
    if (h > 23) return null;
    return h * 60 + mi;
  }

  function lateMinutesFromIn(raw) {
    var t = parseClock(raw, false);
    if (t == null || t < 7 * 60) return null;
    var mins = t - 480;
    return mins > 0 ? mins : null;
  }

  function undertimeMinutesFromOut(raw) {
    var t = parseClock(raw, true);
    if (t == null) return null;
    var mins = 1020 - t;
    return mins > 0 ? mins : null;
  }

  function inIsAlsoLate(raw) {
    var t = parseClock(raw, false);
    if (t == null || t < 7 * 60) return false;
    return t > 8 * 60 + 15 && t < 12 * 60;
  }

  function rowIsExcused(row) {
    if (!row) return false;
    if (row.ex != null && String(row.ex).trim() !== "") return Number(row.ex) === 1;
    var rk = String(row.rk || "").trim().toLowerCase();
    return !!EXCUSED_RK[rk];
  }

  function weekdayUtc(iso) {
    return new Date(iso + "T00:00:00Z").getUTCDay();
  }

  function holidayIndex(settings) {
    var set = {};
    var list = (settings && settings.holidays) || [];
    list.forEach(function (h) {
      if (h == null || h === "") return;
      var d = typeof h === "string" ? h : (h.d || h.date || "");
      d = String(d).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set[d] = 1;
      else if (/^\d{2}-\d{2}$/.test(d)) set["md:" + d] = 1;
    });
    return set;
  }

  function isHolidayDate(date, index) {
    if (!date || !index) return false;
    if (index[date]) return true;
    return !!index["md:" + date.slice(5)];
  }

  function skipLateDay(date, status, row, emp, holidays) {
    if (normStatus(row) === "Rest Day" || status === "Rest Day") return true;
    if (weekdayUtc(date) === 0 && !SUNDAY_KEEP[status]) return true;
    if (isHolidayDate(date, holidays)) return true;
    var hired = isoDate(emp && emp.dateHired);
    if (hired && date < hired) return true;
    var sep = isoDate(emp && emp.separatedOn);
    if (sep && date > sep) return true;
    return false;
  }

  function blankLateCount() {
    return {
      lates: 0,
      lateMinutes: 0,
      lateUnknown: 0,
      excused: 0,
      undertime: 0,
      undertimeMinutes: 0,
      undertimeUnknown: 0,
      undertimeExcused: 0,
      payrollAmount: 0,
      payrollRuns: 0
    };
  }

  function addLate(block, minutes, excused) {
    if (excused) {
      block.excused += 1;
      return;
    }
    block.lates += 1;
    if (minutes > 0) block.lateMinutes += minutes;
    else block.lateUnknown += 1;
  }

  function countStatuses(rows, emp, from, to, holidays) {
    var block = blankLateCount();
    rows.forEach(function (item) {
      if (item.date < from || item.date > to) return;
      var row = item.row;
      var status = normStatus(row);
      if (skipLateDay(item.date, status, row, emp, holidays)) return;
      var excused = rowIsExcused(row);
      if (status === "Present/Late") {
        addLate(block, lateMinutesFromIn(row.in != null ? row.in : row.timeIn), excused);
      }
      if (status === "Undertime") {
        var um = undertimeMinutesFromOut(row.out != null ? row.out : row.timeOut);
        if (excused) block.undertimeExcused += 1;
        else {
          block.undertime += 1;
          if (um > 0) block.undertimeMinutes += um;
          else block.undertimeUnknown += 1;
        }
        if (inIsAlsoLate(row.in != null ? row.in : row.timeIn)) {
          addLate(block, lateMinutesFromIn(row.in != null ? row.in : row.timeIn), excused);
        }
      }
    });
    return block;
  }

  function hasAttendance(rows, from, to) {
    var i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].date >= from && rows[i].date <= to) return true;
    }
    return false;
  }

  function runEnd(run) {
    return isoDate(run && (run.to || run.from));
  }

  function runStart(run) {
    return isoDate(run && (run.from || run.to));
  }

  function lineOf(run, empId) {
    var lines = run && run.lines;
    if (!lines) return { present: false, line: null };
    if (Array.isArray(lines)) {
      var i;
      for (i = 0; i < lines.length; i++) {
        if (lines[i] && lines[i].empId === empId) return { present: true, line: lines[i] };
      }
      return { present: false, line: null };
    }
    if (Object.prototype.hasOwnProperty.call(lines, empId)) return { present: true, line: lines[empId] };
    return { present: false, line: null };
  }

  function itemList(line) {
    if (!line) return null;
    if (Array.isArray(line.caItems) && line.caItems.length) return line.caItems;
    if (line.caDetail && Array.isArray(line.caDetail.items) && line.caDetail.items.length) return line.caDetail.items;
    if (line.cas && typeof line.cas === "object" && !Array.isArray(line.cas)) {
      return Object.keys(line.cas).map(function (id) {
        return { id: id, amount: line.cas[id] };
      });
    }
    return null;
  }

  function itemsMatch(items, amount) {
    var sum = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      var n = numOrNull(items[i] && items[i].amount);
      if (n == null) return false;
      sum += n;
    }
    return Math.abs(round2(sum) - round2(amount)) <= 0.02;
  }

  function runIsPayable(run) {
    var s = String(run && run.status || "").trim().toLowerCase();
    return s === "approved" || s === "finalized" || s === "final";
  }

  /* An approved run stores the late/UT override on the line, and sometimes
     a computed deduction beside it. A missing field is not a zero. */
  function lineLatePeso(line) {
    if (!line) return null;
    var n = null;
    if (line.late != null && line.late !== "") n = numOrNull(line.late);
    if (!(n > 0)) {
      ["lateComputed", "computedLate", "lateDeduction", "lateUt", "lateUT", "undertimeDeduction"].forEach(function (k) {
        if (n > 0) return;
        if (line[k] == null || line[k] === "") return;
        var x = numOrNull(line[k]);
        if (x > 0) n = x;
      });
    }
    return n > 0 ? n : null;
  }

  function payrollLates(payruns, empId, from, to) {
    var count = 0;
    var amount = 0;
    if (!payruns) return { count: 0, amount: 0 };
    Object.keys(payruns).forEach(function (k) {
      var run = payruns[k];
      if (!run || !runIsPayable(run)) return;
      var end = runEnd(run);
      if (!end || end < from || end > to) return;
      var found = lineOf(run, empId);
      if (!found.present || !found.line) return;
      var n = lineLatePeso(found.line);
      if (!(n > 0)) return;
      count += 1;
      amount += n;
    });
    return { count: count, amount: round2(amount) };
  }

  function coverageDate(rows, yearFrom) {
    var earliest = "";
    (rows || []).forEach(function (item) {
      if (item.date && (!earliest || item.date < earliest)) earliest = item.date;
    });
    var from = earliest || ATTENDANCE_FIRST;
    if (from > yearFrom) return from;
    return "";
  }

  function isNewHire(emp, asOf) {
    var hired = isoDate(emp && emp.dateHired);
    if (!hired || !asOf) return false;
    return hired >= asOf.slice(0, 4) + "-01-01" && hired <= asOf;
  }

  function attachPayroll(block, pay) {
    block.payrollAmount = pay.amount || 0;
    block.payrollRuns = pay.count || 0;
    return block;
  }

  function lateSource(block) {
    var statuses = (block.lates || 0) + (block.excused || 0) + (block.undertime || 0) + (block.undertimeExcused || 0);
    if (statuses && block.payrollAmount > 0) return "both";
    if (statuses) return "attendance";
    if (block.payrollAmount > 0) return "payroll";
    return "none";
  }

  function latesFor(rows, payruns, empId, yearFrom, asOf, lastFrom, emp, settings, tombstones) {
    var coverageFrom = coverageDate(rows, yearFrom);
    var holidays = holidayIndex(settings);
    var dead = tombstones && empId && tombstones[empId];
    var useRows = dead ? [] : rows;
    var year = countStatuses(useRows, emp, yearFrom, asOf, holidays);
    var last = countStatuses(useRows, emp, lastFrom, asOf, holidays);
    attachPayroll(year, dead ? { count: 0, amount: 0 } : payrollLates(payruns, empId, yearFrom, asOf));
    attachPayroll(last, dead ? { count: 0, amount: 0 } : payrollLates(payruns, empId, lastFrom, asOf));
    var src = lateSource(year);
    if (src === "none" && lateSource(last) !== "none") src = lateSource(last);
    return {
      source: src,
      coverageFrom: coverageFrom,
      newHire: isNewHire(emp, asOf) && !hasAttendance(useRows, yearFrom, asOf),
      year: year,
      last30: last
    };
  }

  function isCatchup(a) {
    var id = String((a && a.id) || "");
    var no = String((a && a.no) || "");
    return id.indexOf("ca_catchup_") === 0 || no.indexOf("ca_catchup_") === 0;
  }

  function isPendingCa(a) {
    return !!PENDING_CA[String((a && a.status) || "")];
  }

  function isClosedCa(a) {
    var s = String((a && a.status) || "").trim();
    if (!s) return false;
    if (CLOSED_CA[s]) return true;
    var low = s.toLowerCase();
    return low === "fully deducted" || low === "paid" || low === "settled" || low === "closed"
      || low === "liquidated" || low === "recovered" || low === "recovered from pay"
      || low === "cancelled" || low === "disapproved" || low === "rejected" || low === "void";
  }

  function amountUnstated(a) {
    var blob = ["notes", "note", "particulars", "remarks", "comment", "memo", "balanceNote", "amountNote", "detail"].map(function (k) {
      return String((a && a[k]) || "");
    }).join(" \n ");
    if (a && a.balance != null && typeof a.balance !== "number" && String(a.balance).trim()) blob += " \n " + String(a.balance);
    return /not known|isn.?t known|\bunknown\b|not on the payroll|payroll files|not on file|can.?t be determin|cannot be determin|to confirm/i.test(blob);
  }

  function liquidatedOf(a) {
    var list = (a && a.liquidations) || [];
    if (!Array.isArray(list)) return { known: false, amount: null };
    var sum = 0;
    var i;
    for (i = 0; i < list.length; i++) {
      var n = numOrNull(list[i] && list[i].amount);
      if (n == null) return { known: false, amount: null };
      sum += n;
    }
    return { known: true, amount: round2(sum) };
  }

  function planText(a) {
    var per = Number(a && a.deductPerPeriod) || 0;
    var amt = Number(a && a.amount) || 0;
    if (!(per > 0) || !(amt > 0)) return "No repayment plan on the form.";
    var every = String(a.planEvery || "Semi-monthly");
    var unit = every === "Weekly" ? "week" : every === "Monthly" ? "month" : "payroll (twice a month)";
    var n = Math.ceil(amt / per);
    var from = isoDate(a.planFrom);
    return peso(per) + " every " + unit + " — " + n + " deduction" + (n === 1 ? "" : "s") + (from ? ", from " + pretty(from) : "");
  }

  function payrollCa(payruns, empId) {
    if (payruns == null) return { known: false, total: null, byId: {}, unallocated: null };
    var total = 0;
    var byId = {};
    var unallocated = 0;
    var bad = false;
    Object.keys(payruns).forEach(function (k) {
      var run = payruns[k];
      if (!run) return;
      var found = lineOf(run, empId);
      if (!found.present || !found.line) return;
      var raw = found.line.ca;
      if (raw == null || raw === "") return;
      var amount = numOrNull(raw);
      if (amount == null) {
        bad = true;
        return;
      }
      total += amount;
      var items = itemList(found.line);
      if (items && itemsMatch(items, amount)) {
        items.forEach(function (it) {
          var id = String((it && (it.id || it.no)) || "");
          if (!id) return;
          var part = numOrNull(it.amount) || 0;
          byId[id] = round2((byId[id] || 0) + part);
        });
      } else if (amount > 0.005) {
        unallocated += amount;
      }
    });
    if (bad) return { known: false, total: null, byId: {}, unallocated: null };
    return { known: true, total: round2(total), byId: byId, unallocated: round2(unallocated) };
  }

  function deductedFor(a, pack, soleApprovedId) {
    if (!pack.known) return { known: false, amount: null, trusted: false };
    var id = String(a.id || "");
    var no = String(a.no || "");
    var itemized = null;
    var fromItems = false;
    if (id && Object.prototype.hasOwnProperty.call(pack.byId, id)) {
      itemized = pack.byId[id];
      fromItems = true;
    } else if (no && Object.prototype.hasOwnProperty.call(pack.byId, no)) {
      itemized = pack.byId[no];
      fromItems = true;
    }
    if (isPendingCa(a)) return { known: true, amount: itemized || 0, trusted: true };
    /* A pay run that does not say which advance it paid cannot be split
       across more than one advance. Showing a partial figure would invent
       the balance. A catch-up stub is not trusted from a missing override:
       lines store overrides only, so a blank is not zero recovered. */
    if (pack.unallocated > 0.005) {
      if (soleApprovedId && id === soleApprovedId) return { known: true, amount: round2((itemized || 0) + pack.unallocated), trusted: true };
      return { known: false, amount: null, trusted: false };
    }
    var trusted = fromItems || !isCatchup(a);
    return { known: true, amount: itemized || 0, trusted: trusted };
  }

  function cashAdvances(store, empId, currentId) {
    var all = values(store && store.advances).filter(function (a) {
      return a && a.empId === empId;
    });
    var pack = payrollCa(store && store.payruns, empId);
    /* A lump sum on the pay run can be tied to one advance only when that
       person has no other advance payroll could already have been paying.
       A second advance, including one already marked liquidated, leaves the
       split unknown. */
    var deductible = all.filter(function (a) {
      var s = String(a.status || "");
      if (isPendingCa(a)) return false;
      if (/^cancelled$|^disapproved$|^rejected$|^void$/i.test(s.trim())) return false;
      return !!APPROVED_CA[s] || isClosedCa(a) || isCatchup(a);
    });
    var sole = deductible.length === 1 ? String(deductible[0].id || "") : "";
    var rows = [];
    all.forEach(function (a) {
      if (isClosedCa(a) && !isCatchup(a)) return;
      if (isClosedCa(a) && isCatchup(a)) return;
      var pending = isPendingCa(a);
      var catchup = isCatchup(a);
      var approved = APPROVED_CA[a.status] || (!pending && catchup) || (!pending && !a.status && catchup);
      if (!pending && !approved && !catchup) return;
      if (!pending && !catchup && !APPROVED_CA[a.status]) return;
      var amount = numOrNull(a.amount);
      var liq = liquidatedOf(a);
      var ded = deductedFor(a, pack, sole);
      var unstated = catchup && amountUnstated(a);
      var confirm = catchup && (unstated || !ded.trusted);
      var balanceKnown = !confirm && amount != null && liq.known && ded.known;
      var balance = balanceKnown ? round2(amount - liq.amount - ded.amount) : null;
      if (balanceKnown && balance <= 0.005 && !(currentId && a.id === currentId)) return;
      if (unstated) amount = null;
      rows.push({
        id: a.id || "",
        no: a.no || (catchup ? a.id || "Catch-up" : ""),
        catchup: catchup,
        pending: pending,
        thisRequest: !!(currentId && a.id === currentId),
        status: a.status || (catchup ? "Catch-up" : ""),
        amount: amount,
        deducted: !confirm && ded.known ? ded.amount : null,
        deductedKnown: !confirm && ded.known,
        liquidated: liq.known ? liq.amount : null,
        balance: balanceKnown ? balance : null,
        balanceKnown: balanceKnown,
        toConfirm: !balanceKnown,
        plan: planText(a)
      });
    });
    rows.sort(function (a, b) {
      if (a.pending !== b.pending) return a.pending ? 1 : -1;
      return String(a.no).localeCompare(String(b.no));
    });
    var knownTotal = 0;
    var confirmCount = 0;
    rows.forEach(function (r) {
      if (r.balanceKnown) knownTotal += r.balance;
      else confirmCount += 1;
    });
    knownTotal = round2(knownTotal);
    var totalKnown = confirmCount === 0;
    return {
      rows: rows,
      total: totalKnown ? knownTotal : null,
      knownTotal: knownTotal,
      confirmCount: confirmCount,
      totalKnown: totalKnown,
      payrollDeducted: pack.known ? pack.total : null,
      payrollKnown: pack.known
    };
  }

  function tenureOf(emp, asOf) {
    var hired = isoDate(emp && emp.dateHired);
    if (!hired) {
      return { dateHired: "", years: null, months: null, label: "Date hired is not on the 201 file." };
    }
    var y1 = Number(hired.slice(0, 4));
    var m1 = Number(hired.slice(5, 7));
    var d1 = Number(hired.slice(8, 10));
    var y2 = Number(asOf.slice(0, 4));
    var m2 = Number(asOf.slice(5, 7));
    var d2 = Number(asOf.slice(8, 10));
    var years = y2 - y1;
    var months = m2 - m1;
    if (d2 < d1) months -= 1;
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    if (years < 0) {
      years = 0;
      months = 0;
    }
    var label;
    if (years === 0 && months === 0) label = "Less than a month";
    else if (years === 0) label = months + (months === 1 ? " month" : " months");
    else if (months === 0) label = years + (years === 1 ? " year" : " years");
    else label = years + (years === 1 ? " year" : " years") + ", " + months + (months === 1 ? " month" : " months");
    return { dateHired: hired, years: years, months: months, label: label };
  }

  function compute(store, opts) {
    store = store || {};
    opts = opts || {};
    var kind = formKind(opts.kind);
    var rec = opts.record || {};
    var empId = opts.empId || rec.empId || rec.filedEmpId || "";
    var currentId = opts.currentId || rec.id || "";
    var day = manilaDay(opts.now || new Date());
    var yearFrom = day.year + "-01-01";
    var lastFrom = addDays(day.iso, -29);
    var leaves = Object.assign({}, store.leaves || {});
    var advances = Object.assign({}, store.advances || {});
    if (kind === "leave" && rec && currentId) leaves[currentId] = rec;
    if (kind === "ca" && rec && currentId) advances[currentId] = rec;
    var view = Object.assign({}, store, { leaves: leaves, advances: advances });
    var emp = (view.employees || {})[empId] || null;
    var leaveRows = values(view.leaves);
    var attended = attendanceRows(view, empId);
    var absYear = countAbsences(attended, leaveRows, empId, yearFrom, day.iso);
    var abs30 = countAbsences(attended, leaveRows, empId, lastFrom, day.iso);
    var coveredFrom = coverageDate(attended, yearFrom);
    return {
      asOf: day.iso,
      asOfLabel: day.label + ", Asia/Manila",
      empId: empId,
      kind: kind,
      currentId: currentId,
      window: { yearFrom: yearFrom, yearTo: day.iso, last30From: lastFrom, last30To: day.iso },
      leaves: leavesFor(view, empId, kind === "leave" ? currentId : "", yearFrom, day.iso, opts.leaveTypes),
      absences: {
        year: absYear.days,
        last30: abs30.days,
        coverageFrom: coveredFrom
      },
      lates: latesFor(attended, store.payruns, empId, yearFrom, day.iso, lastFrom, emp, store.settings, store.tombstones),
      cashAdvances: cashAdvances(view, empId, kind === "ca" ? currentId : ""),
      tenure: tenureOf(emp, day.iso)
    };
  }

  function forForm(store, opts) {
    opts = opts || {};
    var rec = opts.record || {};
    var kind = formKind(opts.kind || (rec.type ? "leave" : "ca"));
    if (formApproved(kind, rec)) {
      if (rec.decisionInfo && rec.decisionInfo.asOf) {
        var snap = JSON.parse(JSON.stringify(rec.decisionInfo));
        snap.source = "snapshot";
        return snap;
      }
      return { source: "missing", asOf: "", asOfLabel: "", kind: kind, empId: rec.empId || "" };
    }
    var live = compute(store, opts);
    live.source = "live";
    return live;
  }

  function payWord(pay) {
    if (pay === true) return "with pay";
    if (pay === false) return "without pay";
    return "";
  }

  function bucketPhrase(label, bucket) {
    if (!bucket || !bucket.count) return "";
    var dated = bucket.count - (bucket.unset || 0);
    var bits = [];
    if (dated) bits.push(dated + " · " + dayPhrase(bucket.days || 0));
    if (bucket.unset) bits.push(bucket.unset + " · days not set");
    return label + " " + bits.join(", ");
  }

  function leaveLines(info) {
    var L = info.leaves || { count: 0, days: 0, unset: 0, byType: [], thisRequest: null };
    var head = (L.count || 0) + " " + ((L.count === 1) ? "form" : "forms") + " · " + dayPhrase(L.days || 0);
    if (L.unset) head += " · " + L.unset + " with days not set";
    var lines = [head];
    (L.byType || []).forEach(function (t) {
      var pay = payWord(t.pay);
      var bits = [];
      var approved = bucketPhrase("approved", t.approved);
      var pending = bucketPhrase("pending", t.pending);
      if (approved) bits.push(approved);
      if (pending) bits.push(pending);
      lines.push((t.name || t.type || "Type not set") + (pay ? " (" + pay + ")" : "") + " — " + bits.join("; "));
    });
    if (!L.byType || !L.byType.length) lines.push("No other leave in this calendar year.");
    if (L.thisRequest) {
      var tr = L.thisRequest;
      var days = tr.daysUnset ? "days not set" : dayPhrase(tr.days || 0);
      lines.push("This request: " + (tr.name || "Leave") + " · " + days + " · " + (tr.status || "draft") + " — this request");
    }
    return lines;
  }

  function lateWindowLines(block) {
    block = block || blankLateCount();
    var lines = [];
    var statuses = (block.lates || 0) + (block.excused || 0) + (block.undertime || 0) + (block.undertimeExcused || 0);
    if (block.lates || block.excused) {
      var line = block.lates + " lates (" + (block.lateMinutes || 0) + " min known)";
      if (block.excused) line += ". " + block.lates + " late, " + block.excused + " excused";
      lines.push(line);
    }
    if (block.lateUnknown) lines.push("minutes not recorded for " + block.lateUnknown);
    if (block.undertime || block.undertimeExcused) {
      var u = block.undertime + " undertime (" + (block.undertimeMinutes || 0) + " min known)";
      if (block.undertimeExcused) u += ", " + block.undertimeExcused + " excused";
      lines.push(u);
    }
    if (block.payrollAmount > 0) {
      var p = block.payrollRuns || 0;
      lines.push("Payroll late/UT deductions: " + peso(block.payrollAmount) + " across " + p + " pay run" + (p === 1 ? "" : "s"));
    }
    if (!statuses && !(block.payrollAmount > 0)) lines.push("no late data");
    return lines;
  }

  function lateSection(info) {
    var L = info.lates || {};
    var lines = ["This year"].concat(lateWindowLines(L.year)).concat(["Last 30 days"]).concat(lateWindowLines(L.last30));
    if (L.coverageFrom) lines.push("Attendance on file from " + pretty(L.coverageFrom));
    if (L.newHire) lines.push("They have no attendance yet.");
    return lines;
  }

  function absenceLines(info) {
    var a = info.absences || {};
    var lines = [
      "This year " + dayPhrase(a.year),
      "Last 30 days " + dayPhrase(a.last30),
      "Absent days only. Rest days and approved-leave days are not counted."
    ];
    if (a.coverageFrom) lines.push("Attendance on file from " + pretty(a.coverageFrom));
    return lines;
  }

  function caLines(info) {
    var pack = info.cashAdvances || { rows: [], totalKnown: true, total: 0, knownTotal: 0, confirmCount: 0 };
    var lines = [];
    if (!pack.rows || !pack.rows.length) lines.push("No open cash advance.");
    (pack.rows || []).forEach(function (r) {
      var tags = [];
      if (r.thisRequest) tags.push("this request");
      if (r.pending) tags.push("pending");
      if (r.catchup) tags.push("catch-up");
      var head = (r.no || "Cash advance") + (tags.length ? " (" + tags.join(", ") + ")" : "");
      var ded = r.deductedKnown ? peso(r.deducted) + " deducted" : "deducted so far not determined";
      var bal = r.balanceKnown ? peso(r.balance) + " balance" : "balance to confirm";
      var amt = r.amount == null ? "amount unknown" : peso(r.amount);
      lines.push(head + " — " + amt + " · " + ded + " · " + bal + ". " + (r.plan || ""));
    });
    if (pack.confirmCount) lines.push(peso(pack.knownTotal || 0) + " known + " + pack.confirmCount + " to confirm");
    else if (pack.totalKnown) lines.push("Total outstanding " + peso(pack.total || 0) + ".");
    return lines;
  }

  function renderScreen(info) {
    info = info || {};
    if (!info.empId && info.source !== "snapshot" && info.source !== "missing") {
      return '<section class="di-panel" data-decision-info="1" data-decision-readonly="1" data-decision-source="live">'
        + '<div class="di-h">Decision info</div>'
        + '<p class="di-empty">Choose the employee to see leaves, absences, lates, open cash advances, and tenure.</p>'
        + "</section>";
    }
    if (info.source === "missing") {
      return '<section class="di-panel" data-decision-info="1" data-decision-readonly="1" data-decision-source="missing">'
        + '<div class="di-h">Decision info</div>'
        + "<p>Decision info was not saved on this approval.</p></section>";
    }
    var src = info.source || "live";
    var asOf = info.asOfLabel || (info.asOf ? "as of " + info.asOf + ", Asia/Manila" : "");
    function block(title, lines) {
      return '<div class="di-block"><div class="di-k">' + esc(title) + "</div><ul>"
        + lines.map(function (line) {
          return "<li>" + esc(line) + "</li>";
        }).join("")
        + "</ul></div>";
    }
    return '<section class="di-panel" data-decision-info="1" data-decision-readonly="1" data-decision-source="' + esc(src) + '">'
      + '<div class="di-h">Decision info'
      + (asOf ? ' <span class="di-asof">as of ' + esc(info.asOfLabel || info.asOf) + "</span>" : "")
      + (src === "snapshot" ? ' <span class="di-asof">saved at approval</span>' : "")
      + "</div>"
      + '<div class="di-grid">'
      + block("Leaves this calendar year", leaveLines(info))
      + block("Absences", absenceLines(info))
      + block("Lates and undertime", lateSection(info))
      + block("Open cash advances", caLines(info))
      + block("Tenure", [
        info.tenure && info.tenure.dateHired ? "Date hired " + pretty(info.tenure.dateHired) : "Date hired is not on the 201 file.",
        info.tenure && info.tenure.label ? info.tenure.label : ""
      ].filter(Boolean))
      + "</div>"
      + '<p class="di-note">Read only. This does not change leave, cash advance, attendance, or pay.</p>'
      + "</section>";
  }

  function renderPrint(info) {
    info = info || {};
    var src = info.source || "live";
    if (info.source === "missing") {
      return '<div class="di-print" data-decision-info="1" data-decision-readonly="1" data-decision-source="missing" style="border:1.4px solid #000;padding:4px 6px;font-size:8.5px;margin-top:6px"><b>DECISION INFO</b> — Decision info was not saved on this approval.</div>';
    }
    if (!info.empId && src !== "snapshot") {
      return '<div class="di-print" data-decision-info="1" data-decision-readonly="1" data-decision-source="live" style="border:1.4px solid #000;padding:4px 6px;font-size:8.5px;margin-top:6px"><b>DECISION INFO</b> — employee not chosen.</div>';
    }
    function cell(title, lines) {
      return '<td style="border:1px solid #000;padding:3px 5px;vertical-align:top;width:20%"><div style="font-weight:700;font-size:8px;letter-spacing:.03em;text-transform:uppercase">'
        + esc(title) + "</div><div>" + lines.map(esc).join("<br>") + "</div></td>";
    }
    return '<div class="di-print" data-decision-info="1" data-decision-readonly="1" data-decision-source="' + esc(src) + '" style="border:1.4px solid #000;margin-top:6px;font-size:8px;line-height:1.3">'
      + '<div style="background:#3f3f3f;color:#fff;font-weight:700;font-size:9px;letter-spacing:.04em;padding:2px 6px">DECISION INFO'
      + ' <span style="font-weight:400">as of ' + esc(info.asOfLabel || info.asOf || "") + (src === "snapshot" ? " · saved at approval" : "") + "</span></div>"
      + '<table style="width:100%;border-collapse:collapse;table-layout:fixed"><tr>'
      + cell("Leaves this year", leaveLines(info))
      + cell("Absences", absenceLines(info))
      + cell("Lates and undertime", lateSection(info))
      + cell("Open cash advances", caLines(info))
      + cell("Tenure", [
        info.tenure && info.tenure.dateHired ? "Hired " + pretty(info.tenure.dateHired) : "Date hired is not on the 201 file.",
        (info.tenure && info.tenure.label) || ""
      ].filter(Boolean))
      + "</tr></table></div>";
  }

  root.hrDecision = {
    version: "2026-11-23a",
    compute: compute,
    forForm: forForm,
    renderScreen: renderScreen,
    renderPrint: renderPrint,
    formApproved: formApproved,
    manilaDay: manilaDay
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
