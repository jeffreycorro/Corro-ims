/**
 * Payroll Maker for the CorConDev HR artifact.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * Hardens the existing Payroll / Daily Manpower / Analytics path to Catherine
 * Largo's weekly (Thu–Wed) and semi-monthly (13–27 / 28–12) sheets.
 * Days, OT and holiday premium are live from daily reports — never typed here.
 */
(function (root) {
  "use strict";

  if (root.hrPayroll && root.hrPayroll.version) return;

  var OT_MULTIPLIER = 1.0;
  var HOL_PREMIUM = 0.3;
  var LOG_NAME_CAP = 40;
  var LOG_ENTRY_CAP = 60;
  var DEFAULT_DED = { sss: 325, phic: 131.25, hdmf: 100 };
  var CA_SKIP = {
    Cancelled: 1,
    Disapproved: 1,
    Liquidated: 1,
    Recovered: 1,
    "Recovered from pay": 1,
  };
  var FIXED_REGULAR_HOLIDAYS = [
    { d: "01-01", n: "New Year's Day", t: "Regular" },
    { d: "04-09", n: "Araw ng Kagitingan", t: "Regular" },
    { d: "05-01", n: "Labor Day", t: "Regular" },
    { d: "06-12", n: "Independence Day", t: "Regular" },
    { d: "11-30", n: "Bonifacio Day", t: "Regular" },
    { d: "12-25", n: "Christmas Day", t: "Regular" },
    { d: "12-30", n: "Rizal Day", t: "Regular" },
  ];
  var WEEKLY_WIDTHS = [
    "2.6%", "4.6%", "12%", "7.4%", "3.4%", "3.4%", "5.2%", "5.6%",
    "5.2%", "4.6%", "4.6%", "5.8%", "4.4%", "4.4%", "3.8%",
    "4.4%", "4.4%", "4.4%", "5%", "5.2%",
  ];
  var SEMI_WIDTHS = [
    "2.4%", "4.2%", "11%", "6.6%", "3.2%", "3.2%", "4.8%", "5.2%",
    "4.8%", "4.2%", "4.6%", "4.4%", "5.4%", "4.2%", "4.2%", "3.6%",
    "4.2%", "4.2%", "4.2%", "4.8%", "5%",
  ];

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function isoDate(t) {
    if (t == null || t === "") return "";
    if (typeof t === "string") {
      var s = t.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      t = new Date(s.indexOf("T") >= 0 ? s : s + "T00:00:00");
    }
    if (!(t instanceof Date) || isNaN(t.getTime())) return "";
    return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate());
  }

  function addDays(d, n) {
    if (!d) return "";
    var t = new Date(isoDate(d) + "T00:00:00");
    t.setDate(t.getDate() + n);
    return isoDate(t);
  }

  function daysBetween(a, b) {
    if (!a || !b) return 0;
    return Math.round(
      (new Date(isoDate(b) + "T00:00:00") - new Date(isoDate(a) + "T00:00:00")) / 864e5
    );
  }

  function weekdayLocal(iso) {
    return new Date(isoDate(iso) + "T00:00:00").getDay();
  }

  function eachDate(from, to) {
    var out = [];
    var d = isoDate(from);
    var end = isoDate(to);
    if (!d || !end || d > end) return out;
    while (d <= end) {
      out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  function startOfWeekThu(d) {
    var iso = isoDate(d);
    var t = new Date(iso + "T00:00:00");
    var back = (t.getDay() + 3) % 7;
    t.setDate(t.getDate() - back);
    return isoDate(t);
  }

  function payPeriod(kind, anchor) {
    var d = isoDate(anchor);
    if (kind === "weekly") {
      var from = startOfWeekThu(d);
      return { from: from, to: addDays(from, 6) };
    }
    var t = new Date(d + "T00:00:00");
    var y = t.getFullYear();
    var m = t.getMonth();
    var day = t.getDate();
    if (day >= 13 && day <= 27) {
      return { from: isoDate(new Date(y, m, 13)), to: isoDate(new Date(y, m, 27)) };
    }
    if (day >= 28) {
      return { from: isoDate(new Date(y, m, 28)), to: isoDate(new Date(y, m + 1, 12)) };
    }
    return { from: isoDate(new Date(y, m - 1, 28)), to: isoDate(new Date(y, m, 12)) };
  }

  function payRelease(kind, per) {
    var std = payPeriod(kind, per.from);
    if (per.from !== std.from || per.to !== std.to) return "";
    if (kind === "weekly") return addDays(per.to, 3);
    var t = new Date(per.to + "T00:00:00");
    var y = t.getFullYear();
    var m = t.getMonth();
    if (t.getDate() >= 13) {
      var last = new Date(y, m + 1, 0).getDate();
      return isoDate(new Date(y, m, Math.min(30, last)));
    }
    return isoDate(new Date(y, m, 15));
  }

  function payRunKey(kind, from, to) {
    var std = payPeriod(kind, from);
    return to && to !== std.to ? kind + "|" + from + "|" + to : kind + "|" + from;
  }

  function isCustomRange(kind, from, to) {
    var std = payPeriod(kind, from);
    return !!(to && (from !== std.from || to !== std.to));
  }

  function stepRange(from, to, dir) {
    var span = daysBetween(from, to) + 1;
    return { from: addDays(from, dir * span), to: addDays(to, dir * span) };
  }

  function payKindOf(e) {
    return String((e && e.rateType) || "").toLowerCase() === "monthly" ? "semi" : "weekly";
  }

  function payRate(e, kind) {
    var monthly = String((e && e.rateType) || "").toLowerCase() === "monthly";
    var daily = monthly ? (Number(e && e.dailyRate) || 0) / 26 : Number(e && e.dailyRate) || 0;
    return { daily: daily, hourly: daily / 8, monthly: monthly, kind: kind || (monthly ? "semi" : "weekly") };
  }

  function weeklyHalf(full) {
    return Math.floor((Number(full) || 0) / 2 * 100) / 100;
  }

  function companyDed(settings) {
    var d = (settings && settings.ded) || DEFAULT_DED;
    return {
      sss: d.sss == null ? DEFAULT_DED.sss : Number(d.sss) || 0,
      phic: d.phic == null ? DEFAULT_DED.phic : Number(d.phic) || 0,
      hdmf: d.hdmf == null ? DEFAULT_DED.hdmf : Number(d.hdmf) || 0,
    };
  }

  function empSemiDed(e, settings) {
    var def = companyDed(settings);
    var d = (e && e.ded) || {};
    function pick(k) {
      if (d[k] == null || d[k] === "") return def[k];
      var n = Number(d[k]);
      return isNaN(n) ? def[k] : n;
    }
    return { sss: pick("sss"), phic: pick("phic"), hdmf: pick("hdmf") };
  }

  function statutoryOf(e, kind, settings) {
    var full = empSemiDed(e, settings);
    if (kind === "weekly") {
      return { sss: weeklyHalf(full.sss), phic: weeklyHalf(full.phic), hdmf: weeklyHalf(full.hdmf) };
    }
    return full;
  }

  function defaultAllowance(e) {
    var monthly = String((e && e.rateType) || "").toLowerCase() === "monthly";
    var a = Number((e && e.allowance) || 0) || 0;
    return monthly ? a / 2 : a;
  }

  function otMultiplier(settings) {
    var n = settings && settings.otPolicy;
    if (n == null || n === "") return OT_MULTIPLIER;
    n = Number(n);
    return isNaN(n) ? OT_MULTIPLIER : n;
  }

  function computeLine(input) {
    var L = input || {};
    var daily = Number(L.daily) || 0;
    var hourly = L.hourly != null ? Number(L.hourly) : daily / 8;
    var otX = L.otMultiplier != null ? Number(L.otMultiplier) : OT_MULTIPLIER;
    L.days = Number(L.days) || 0;
    L.ot = Number(L.ot) || 0;
    L.hol = Number(L.hol) || 0;
    L.daily = daily;
    L.hourly = hourly;
    L.allowance = Number(L.allowance) || 0;
    L.incentive = Number(L.incentive) || 0;
    L.late = Number(L.late) || 0;
    L.ca = Number(L.ca) || 0;
    L.uniform = Number(L.uniform) || 0;
    L.sssLoan = Number(L.sssLoan) || 0;
    L.hdmfLoan = Number(L.hdmfLoan) || 0;
    L.sss = Number(L.sss) || 0;
    L.phic = Number(L.phic) || 0;
    L.hdmf = Number(L.hdmf) || 0;
    L.basic = L.days * L.daily;
    L.otPay = L.ot * L.hourly * otX;
    /* Paper runs pass hol as a day count at the shipped 30%. Mixed 30/100
       days send holFactor (sum of per-day rates) so pay follows the ticks. */
    var holFactor = L.holFactor != null && L.holFactor !== ""
      ? Number(L.holFactor) || 0
      : L.hol * HOL_PREMIUM;
    L.holFactor = holFactor;
    L.holPay = holFactor * L.daily;
    L.gross = L.basic + L.otPay + L.holPay + L.allowance + L.incentive;
    L.ded =
      L.late + L.ca + L.uniform + L.sssLoan + L.hdmfLoan + L.sss + L.phic + L.hdmf;
    L.net = Math.ceil(L.gross - L.ded - 1e-9);
    return L;
  }

  function holidayMatches(h, iso) {
    if (!h || !h.d || !iso) return false;
    var d = String(h.d);
    if (d === iso) return true;
    if (d.length === 5 && d === iso.slice(5)) return true;
    if (d.length === 10 && d.slice(5) === iso.slice(5) && d.slice(0, 4) === iso.slice(0, 4)) return true;
    return false;
  }

  function holidayOn(date, holidays) {
    var iso = isoDate(date);
    var list = holidays || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (holidayMatches(list[i], iso)) return list[i];
    }
    return null;
  }

  function ensureHolidayCalendar(settings) {
    settings = settings || {};
    if (settings.holidays && settings.holidays.length) return settings.holidays;
    settings.holidays = FIXED_REGULAR_HOLIDAYS.map(function (h) {
      return { d: h.d, n: h.n, t: h.t };
    });
    return settings.holidays;
  }

  function effectiveStatusOf(empId, date, raw, reason, ctx) {
    if (ctx && typeof ctx.effectiveStatus === "function") {
      return ctx.effectiveStatus(empId, date, raw, reason, ctx);
    }
    if (root.hrAttendance && typeof root.hrAttendance.effectiveStatus === "function") {
      return root.hrAttendance.effectiveStatus(empId, date, raw, reason, ctx);
    }
    if (typeof root.effectiveStatus === "function") {
      return root.effectiveStatus(empId, date, raw, reason);
    }
    return raw;
  }

  function dayCredit(status, row, empId, date, ctx) {
    var st = status;
    if (row && (empId || date)) {
      st = effectiveStatusOf(empId, date, row.s || row.status || status, row.r || row.reason, ctx);
    }
    if (st === "Present" || st === "Present/Late" || st === "Undertime") return 1;
    if (st === "Leave with Pay") return 1;
    if (st === "Regular Holiday") return 1;
    if (st === "Half Day") return 0.5;
    return 0;
  }

  /* Payroll ignores stored DayRow.day overrides — live credit only. */
  function payDayCredit(row, empId, date, ctx) {
    return dayCredit(row && (row.s || row.status), row, empId, date, ctx);
  }

  function holEligible(row, date, empId, ctx) {
    var credit = payDayCredit(row, empId, date, ctx);
    if (credit <= 0) return false;
    var raw = (row && (row.s || row.status)) || "";
    var st = effectiveStatusOf(empId, date, raw, row && (row.r || row.reason), ctx);
    if (st === "Regular Holiday" || st === "Special Holiday") return true;
    if (raw === "Regular Holiday" || raw === "Special Holiday") return true;
    var holidays = (ctx && ctx.holidays) || (ctx && ctx.settings && ctx.settings.holidays) || [];
    if (holidayOn(date, holidays)) return true;
    if (weekdayLocal(date) === 0) return true;
    return false;
  }

  /* Stored hol: 0 / missing = as is; 1 / true / 0.3 = +30%; 2 / 100 = +100%.
     Existing Daily Manpower ticks wrote 1, which stays +30%. */
  function holidayPremiumCode(row) {
    if (!row) return 0;
    var h = row.hol;
    if (h === 2 || h === "2" || h === 100 || h === "100") return 2;
    if (h === 1 || h === true || h === "1" || h === 0.3 || h === "0.3" || h === "30") return 1;
    return 0;
  }

  function holidayPremiumRate(row) {
    var code = holidayPremiumCode(row);
    if (code === 2) return 1;
    if (code === 1) return HOL_PREMIUM;
    return 0;
  }

  function holidayGranted(row) {
    return holidayPremiumRate(row) > 0;
  }

  function holLabel(code) {
    if (code === 2 || code === "2" || code === 100 || code === "100") return "+100%";
    if (code === 1 || code === true || code === "1" || code === 0.3 || code === "30") return "+30%";
    return "as is";
  }

  function holSelectHTML(id, attr, code, extra) {
    var c = Number(code) || 0;
    if (c !== 1 && c !== 2) c = 0;
    return (
      '<select ' +
      attr +
      '="' +
      esc(id) +
      '" title="Holiday treatment for this day"' +
      (extra || "") +
      ' style="min-height:40px;max-width:92px">' +
      '<option value="0"' + (c === 0 ? " selected" : "") + ">As is</option>" +
      '<option value="1"' + (c === 1 ? " selected" : "") + ">+30%</option>" +
      '<option value="2"' + (c === 2 ? " selected" : "") + ">+100%</option>" +
      "</select>"
    );
  }

  function holValueFromInput(el) {
    if (!el) return 0;
    if (el.type === "checkbox") return el.checked ? 1 : 0;
    var v = el.value;
    if (v === "2" || v === 2 || v === "100") return 2;
    if (v === "1" || v === 1 || v === "0.3" || el.checked) return 1;
    return 0;
  }

  function dailyId(d) {
    return "d" + String(isoDate(d) || d || "").replace(/-/g, "");
  }

  function rowOt(row) {
    return Number(row && row.ot) || 0;
  }

  function rowHasEnteredData(row) {
    if (!row || typeof row !== "object") return false;
    var st = String(row.s || row.status || "").trim();
    if (st && st !== "Present") return true;
    if (row.ot != null && String(row.ot).trim() !== "") return true;
    if (String(row.r || row.reason || "").trim()) return true;
    if (row.day != null && String(row.day).trim() !== "") return true;
    var hol = row.hol;
    if (hol != null && hol !== "" && hol !== 0 && hol !== "0" && hol !== false) return true;
    return false;
  }

  /* No dateHired keeps the row. A hire date after this day hides a default row. */
  function prehireRowHidden(emp, date, row) {
    if (!emp) return false;
    var h = String(emp.dateHired || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h)) return false;
    var day = String(date || "").slice(0, 10);
    if (!day || h <= day) return false;
    return !rowHasEnteredData(row);
  }

  function tallyPersonPeriod(empId, from, to, ctx) {
    ctx = ctx || {};
    var daily = ctx.daily || {};
    var days = 0;
    var ot = 0;
    var hol = 0;
    var holFactor = 0;
    var hol30 = 0;
    var hol100 = 0;
    var eligible = 0;
    var dayDates = [];
    var otDates = [];
    var holDates = [];
    var eligDates = [];
    var missing = [];
    eachDate(from, to).forEach(function (d) {
      var rec = daily[dailyId(d)];
      if (!rec) {
        missing.push(d);
        return;
      }
      var row = (rec.rows || {})[empId];
      if (!row) return;
      var emp = (ctx.employees || {})[empId];
      if (prehireRowHidden(emp, d, row)) return;
      var credit = payDayCredit(row, empId, d, ctx);
      if (credit) {
        days += credit;
        dayDates.push(d);
      }
      var oth = rowOt(row);
      if (oth) {
        ot += oth;
        otDates.push(d);
      }
      if (holEligible(row, d, empId, ctx)) {
        eligible += 1;
        eligDates.push(d);
      }
      var rate = holidayPremiumRate(row);
      if (rate) {
        hol += 1;
        holFactor += rate;
        holDates.push(d);
        if (rate >= 1) hol100 += 1;
        else hol30 += 1;
      }
    });
    return {
      days: days,
      ot: ot,
      hol: hol,
      holFactor: holFactor,
      hol30: hol30,
      hol100: hol100,
      eligible: eligible,
      dayDates: dayDates,
      otDates: otDates,
      holDates: holDates,
      eligDates: eligDates,
      missing: missing,
    };
  }

  function missingReportDays(from, to, daily) {
    daily = daily || {};
    return eachDate(from, to).filter(function (d) {
      if (weekdayLocal(d) === 0) return false;
      return !daily[dailyId(d)];
    });
  }

  function periodHasReports(from, to, daily) {
    daily = daily || {};
    return eachDate(from, to).some(function (d) {
      return !!daily[dailyId(d)];
    });
  }

  function latestFiledDate(daily) {
    var last = "";
    Object.keys(daily || {}).forEach(function (id) {
      var d = isoDate((daily[id] || {}).date);
      if (d && d > last) last = d;
    });
    return last;
  }

  function latestFiledPeriod(kind, daily) {
    var last = latestFiledDate(daily);
    if (!last) return null;
    return payPeriod(kind === "semi" ? "semi" : "weekly", last);
  }

  function importedPeriodCount(S) {
    S = S || {};
    var n = 0;
    Object.keys(S.periods || {}).forEach(function (id) {
      if (id === "paymaker") return;
      var p = S.periods[id];
      if (p && (p.rows || []).length) n += 1;
    });
    return n;
  }

  function statusAbbr(st) {
    return (
      {
        Present: "P",
        "Present/Late": "L",
        Undertime: "U",
        Absent: "A",
        Leave: "LV",
        "Leave with Pay": "LP",
        "Regular Holiday": "H",
        "Special Holiday": "SH",
        "Half Day": "HD",
        "Rest Day": "R",
      }[st] || (st ? "?" : "·")
    );
  }

  function periodDaySummaries(from, to, ctx) {
    ctx = ctx || {};
    var daily = ctx.daily || {};
    return eachDate(from, to).map(function (d) {
      var rec = daily[dailyId(d)];
      var counts = {
        present: 0,
        late: 0,
        undertime: 0,
        absent: 0,
        leave: 0,
        other: 0,
        people: 0,
      };
      if (rec && rec.rows) {
        Object.keys(rec.rows).forEach(function (id) {
          var row = rec.rows[id] || {};
          if (prehireRowHidden((ctx.employees || {})[id], d, row)) return;
          var st = effectiveStatusOf(id, d, row.s || row.status, row.r || row.reason, ctx);
          counts.people += 1;
          if (st === "Present") counts.present += 1;
          else if (st === "Present/Late") {
            counts.present += 1;
            counts.late += 1;
          } else if (st === "Undertime") counts.undertime += 1;
          else if (st === "Absent") counts.absent += 1;
          else if (st === "Leave" || st === "Leave with Pay") counts.leave += 1;
          else if (st) counts.other += 1;
        });
      }
      return {
        date: d,
        filed: !!(rec && rec.rows && Object.keys(rec.rows).length),
        sunday: weekdayLocal(d) === 0,
        source: rec && rec.source,
        counts: counts,
      };
    });
  }

  function personPeriodDays(empId, from, to, ctx) {
    ctx = ctx || {};
    var daily = ctx.daily || {};
    return eachDate(from, to).map(function (d) {
      var rec = daily[dailyId(d)];
      var row = rec && rec.rows && rec.rows[empId];
      if (row && prehireRowHidden((ctx.employees || {})[empId], d, row)) row = null;
      return {
        date: d,
        filed: !!rec,
        row: row || null,
        status: row ? effectiveStatusOf(empId, d, row.s || row.status, row.r || row.reason, ctx) : "",
        in: (row && row.in) || "",
        out: (row && row.out) || "",
        hol: holidayPremiumCode(row),
        ot: rowOt(row),
      };
    });
  }

  function maybeSnapPayWindow(S) {
    S = S || store();
    S.ui = S.ui || {};
    if (S.ui.payFrom || S.ui.payTo || S.ui.payAnchor || S.ui.payNoSnap) return null;
    var kind = S.ui.payKind === "semi" ? "semi" : "weekly";
    var today = (typeof root.TODAY === "string" && root.TODAY) || isoDate(new Date());
    var std = payPeriod(kind, today);
    if (periodHasReports(std.from, std.to, S.daily || {})) return null;
    var latest = latestFiledPeriod(kind, S.daily || {});
    if (!latest) return null;
    S.ui.payFrom = latest.from;
    S.ui.payTo = latest.to;
    S.ui.payAnchor = latest.from;
    S.ui.paySnapped = 1;
    return latest;
  }

  function caBalance(a) {
    var liq = ((a && a.liquidations) || []).reduce(function (s, l) {
      return s + (Number(l.amount) || 0);
    }, 0);
    return (Number(a && a.amount) || 0) - liq - (Number(a && a.deducted) || 0);
  }

  function caDueForPeriod(advances, empId) {
    var due = 0;
    Object.keys(advances || {}).forEach(function (id) {
      var a = advances[id];
      if (!a || a.empId !== empId) return;
      if (CA_SKIP[a.status]) return;
      var perPeriod = Number(a.deductPerPeriod) || 0;
      if (perPeriod <= 0) return;
      var bal = caBalance(a);
      if (bal <= 0) return;
      due += Math.min(perPeriod, bal);
    });
    return due;
  }

  function money(n) {
    return (Number(n) || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function peso(n) {
    return "₱" + money(n);
  }

  function flipName(n) {
    if (root.flipName) return root.flipName(n);
    n = String(n || "");
    if (n.indexOf(",") >= 0) {
      var p = n.split(",");
      return (p[1] || "").trim() + " " + (p[0] || "").trim();
    }
    return n;
  }

  function foldName(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function nameMatches(e, q) {
    q = foldName(q);
    if (!q) return true;
    var a = foldName((e && e.name) || "");
    var b = foldName(flipName((e && e.name) || ""));
    var no = String((e && e.empNo) || "");
    if (a.indexOf(q) >= 0 || b.indexOf(q) >= 0 || no.indexOf(q) >= 0) return true;
    return q.split(" ").every(function (tok) {
      return !tok || a.indexOf(tok) >= 0 || b.indexOf(tok) >= 0 || no.indexOf(tok) >= 0;
    });
  }

  function localStamp(now) {
    now = now || new Date();
    try {
      var fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      var parts = {};
      fmt.formatToParts(now).forEach(function (p) {
        if (p.type !== "literal") parts[p.type] = p.value;
      });
      if (parts.year) {
        return (
          parts.year +
          "-" +
          parts.month +
          "-" +
          parts.day +
          "T" +
          parts.hour +
          ":" +
          parts.minute +
          ":" +
          parts.second +
          "+08:00"
        );
      }
    } catch (err) {}
    var y = now.getFullYear();
    var mo = pad2(now.getMonth() + 1);
    var da = pad2(now.getDate());
    var hh = pad2(now.getHours());
    var mm = pad2(now.getMinutes());
    var ss = pad2(now.getSeconds());
    return y + "-" + mo + "-" + da + "T" + hh + ":" + mm + ":" + ss;
  }

  function fieldLabel(k) {
    return (
      {
        s: "status",
        status: "status",
        r: "reason",
        reason: "reason",
        site: "area",
        hol: "holiday premium",
        ot: "overtime hours",
        in: "time in",
        out: "time out",
      }[k] || k
    );
  }

  function plainChange(name, field, from, to) {
    var label = fieldLabel(field);
    if (field === "hol") {
      var fromN = Number(from) || 0;
      var toN = Number(to) || 0;
      if (!fromN && toN === 1) return name + ": holiday premium granted";
      if (fromN === 1 && !toN) return name + ": holiday premium cleared";
      return name + ": holiday premium " + holLabel(from) + " → " + holLabel(to);
    }
    if (from == null || from === "") return name + ": " + label + " set to " + (to || "blank");
    if (to == null || to === "") return name + ": " + label + " cleared (was " + from + ")";
    return name + ": " + label + " " + from + " → " + to;
  }

  function rowSnapshot(row) {
    row = row || {};
    return {
      s: row.s || row.status || "",
      r: row.r || row.reason || "",
      site: row.site || "",
      hol: holidayPremiumCode(row),
      ot: rowOt(row),
      in: row.in || "",
      out: row.out || "",
    };
  }

  function diffDaily(prev, next, nameOf) {
    nameOf = nameOf || function (id) { return id; };
    var changes = [];
    var before = (prev && prev.rows) || {};
    var after = (next && next.rows) || {};
    var ids = {};
    Object.keys(before).forEach(function (id) { ids[id] = 1; });
    Object.keys(after).forEach(function (id) { ids[id] = 1; });
    Object.keys(ids).forEach(function (id) {
      var a = rowSnapshot(before[id]);
      var b = rowSnapshot(after[id]);
      ["s", "r", "site", "hol", "ot", "in", "out"].forEach(function (k) {
        if (String(a[k]) === String(b[k])) return;
        changes.push({
          empId: id,
          field: k,
          from: a[k],
          to: b[k],
          text: plainChange(nameOf(id), k, a[k], b[k]),
        });
      });
    });
    return changes;
  }

  function makeLogEntry(changes, opts) {
    opts = opts || {};
    return {
      at: opts.at || localStamp(),
      by: String(opts.by || "").slice(0, LOG_NAME_CAP),
      firstImport: !!opts.firstImport,
      import: !!opts.import,
      changes: (changes || []).slice(0, LOG_ENTRY_CAP),
    };
  }

  function attachDailyLog(prev, next, opts) {
    opts = opts || {};
    next = next || {};
    var nameOf = opts.nameOf || function (id) { return id; };
    var changes = diffDaily(prev, next, nameOf);
    var isNew = !prev;
    var firstImport = isNew && !!(opts.import || next.source || next.fixed || next.fromImport);
    if (!changes.length && !firstImport) return next;
    var entry = makeLogEntry(changes, {
      by: opts.by,
      at: opts.at,
      firstImport: firstImport,
      import: !!(opts.import || next.source || next.fromImport),
    });
    var log = ((prev && prev.log) || next.log || []).slice();
    log.push(entry);
    next.log = log.slice(-LOG_ENTRY_CAP);
    return next;
  }

  function editedAfterFiling(rec) {
    if (!rec) return false;
    var filed = !!(rec.driveLink || rec.filedOn || rec.source);
    if (!filed) return false;
    return (rec.log || []).some(function (e) {
      return e && !e.firstImport && (e.changes || []).length;
    });
  }

  function logSummary(entry) {
    if (!entry) return "";
    if (entry.firstImport) return "First import of this report";
    var bits = (entry.changes || []).map(function (c) { return c.text; }).filter(Boolean);
    if (!bits.length) return entry.import ? "Imported without row changes" : "Saved";
    return bits.slice(0, 8).join("; ");
  }

  function foldDeductionKeys(lines) {
    var always = { late: 1, ca: 1, sss: 1, phic: 1, hdmf: 1 };
    var optional = ["uniform", "sssLoan", "hdmfLoan", "incentive"];
    var show = { late: 1, ca: 1, sss: 1, phic: 1, hdmf: 1 };
    optional.forEach(function (k) {
      if ((lines || []).some(function (L) { return Number(L[k]) > 0; })) show[k] = 1;
    });
    Object.keys(always).forEach(function (k) { show[k] = 1; });
    return show;
  }

  function colgroup(widths) {
    return (
      "<colgroup>" +
      widths.map(function (w) { return '<col style="width:' + w + '">'; }).join("") +
      "</colgroup>"
    );
  }

  function registerHTML(run, opts) {
    opts = opts || {};
    var kind = run.kind;
    var lines = run.lines || [];
    var show = foldDeductionKeys(lines);
    var hasAllow = kind === "semi" || lines.some(function (L) { return Number(L.allowance) > 0; });
    var widths = kind === "semi" || hasAllow ? SEMI_WIDTHS : WEEKLY_WIDTHS;
    var heads = ["No.", "ID", "Name", "Project", "Days", "OT", "Daily", "Basic", "OT pay", "Hol"];
    if (hasAllow) heads.push("Allow.");
    heads.push("Inc.", "Gross", "Late", "CA");
    if (show.uniform) heads.push("Unif.");
    if (show.sssLoan) heads.push("SSS ln");
    if (show.hdmfLoan) heads.push("HDMF ln");
    heads.push("SSS", "PHIC", "HDMF", "Ded", "Net");
    var byProj = {};
    lines.forEach(function (L) {
      var p = L.project || "—";
      byProj[p] = (byProj[p] || 0) + (L.net || 0);
    });
    var rows = lines
      .map(function (L, i) {
        var cells = [
          i + 1,
          L.empNo || "",
          flipName(L.name),
          L.project || "—",
          L.days,
          L.ot,
          money(L.daily),
          money(L.basic),
          money(L.otPay),
          money(L.holPay),
        ];
        if (hasAllow) cells.push(money(L.allowance));
        cells.push(money(L.incentive), money(L.gross), money(L.late), money(L.ca));
        if (show.uniform) cells.push(money(L.uniform));
        if (show.sssLoan) cells.push(money(L.sssLoan));
        if (show.hdmfLoan) cells.push(money(L.hdmfLoan));
        cells.push(money(L.sss), money(L.phic), money(L.hdmf), money(L.ded), money(L.net));
        return (
          "<tr>" +
          cells
            .map(function (c, idx) {
              var cls = idx <= 3 ? (idx === 2 ? ' class="hr-pay-name"' : "") : ' class="hr-pay-num"';
              return "<td" + cls + ">" + esc(c) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
    var sum = Object.keys(byProj)
      .map(function (p) {
        return "<div>" + esc(p) + " — " + peso(byProj[p]) + "</div>";
      })
      .join("");
    var letter =
      opts.letterhead ||
      '<div class="hr-pay-letter">' +
        "<b>CORRO CONSTRUCTION DEVELOPMENT AND TRADE CORPORATION</b>" +
        "<div>15 First Street, La Guardia, Lahug, Cebu City</div></div>";
    return (
      '<div class="hr-pay-reg">' +
      letter +
      '<div class="hr-pay-h">PAYROLL REGISTER — ' +
      esc(kind === "semi" ? "SEMI-MONTHLY" : "WEEKLY") +
      "</div>" +
      '<div class="hr-pay-meta">PERIOD ' +
      esc(run.from) +
      " – " +
      esc(run.to) +
      " &nbsp; RELEASE DATE " +
      esc(run.release || "") +
      "</div>" +
      '<table class="hr-pay-t">' +
      colgroup(widths.slice(0, heads.length)) +
      "<thead><tr>" +
      heads.map(function (h) { return "<th>" + h + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>" +
      '<div class="hr-pay-sum"><b>By project</b>' +
      sum +
      "</div>" +
      '<div class="hr-pay-sign">Prepared by ______________________ &nbsp; Approved by ______________________</div>' +
      '<div class="hr-pay-iso">Form No. &nbsp; Rev. 1.0 &nbsp; Page 1 of 1</div>' +
      "</div>"
    );
  }

  function holWorkings(L) {
    var bits = [];
    if (L.hol30) bits.push(L.hol30 + " × " + money(L.daily) + " × 30%");
    if (L.hol100) bits.push(L.hol100 + " × " + money(L.daily) + " × 100%");
    if (!bits.length && L.hol) bits.push((L.hol || 0) + " × " + money(L.daily) + " × 30%");
    return bits.join(" + ");
  }

  function slipLine(label, amount, work) {
    if (!amount) return "";
    return (
      "<tr><td>" +
      esc(label) +
      (work ? ' <span class="hr-pay-work">' + esc(work) + "</span>" : "") +
      '</td><td class="hr-pay-num">' +
      peso(amount) +
      "</td></tr>"
    );
  }

  function payslipHTML(L, run) {
    var earn =
      slipLine("Basic pay", L.basic, (L.days || 0) + " days × " + money(L.daily)) +
      slipLine("Overtime", L.otPay, (L.ot || 0) + " hrs × " + money(L.hourly) + " × " + (L.otMultiplier || OT_MULTIPLIER)) +
      slipLine("Holiday premium", L.holPay, holWorkings(L)) +
      slipLine("Allowance", L.allowance) +
      slipLine("Incentive", L.incentive);
    var ded =
      slipLine("Late / undertime", L.late) +
      slipLine("Cash advance", L.ca) +
      slipLine("Uniform", L.uniform) +
      slipLine("SSS loan", L.sssLoan) +
      slipLine("Pag-IBIG loan", L.hdmfLoan) +
      slipLine("SSS", L.sss) +
      slipLine("PhilHealth", L.phic) +
      slipLine("Pag-IBIG", L.hdmf);
    var caLeft = L.caRemaining != null ? L.caRemaining : null;
    return (
      '<div class="hr-pay-slip">' +
      '<div class="hr-pay-letter"><b>CORRO CONSTRUCTION DEVELOPMENT AND TRADE CORPORATION</b>' +
      "<div>Payslip</div></div>" +
      "<div><b>" +
      esc(flipName(L.name)) +
      '</b> <span class="mono">' +
      esc(L.empNo || "") +
      "</span></div>" +
      "<div>Period " +
      esc(run.from) +
      " – " +
      esc(run.to) +
      (run.release ? " &nbsp; Release " + esc(run.release) : "") +
      "</div>" +
      '<table class="hr-pay-t"><thead><tr><th>Earnings</th><th></th></tr></thead><tbody>' +
      (earn || "<tr><td colspan=2>—</td></tr>") +
      "</tbody></table>" +
      '<table class="hr-pay-t"><thead><tr><th>Deductions</th><th></th></tr></thead><tbody>' +
      (ded || "<tr><td colspan=2>None</td></tr>") +
      "</tbody></table>" +
      '<div class="hr-pay-net">NET PAY ' +
      peso(L.net) +
      "</div>" +
      (caLeft != null
        ? '<div class="hr-pay-ca">Cash advance remaining ' + peso(caLeft) + "</div>"
        : "") +
      "</div>"
    );
  }

  function payslipsSheetHTML(lines, run) {
    var blocks = [];
    var i;
    for (i = 0; i < lines.length; i += 2) {
      blocks.push(
        '<div class="hr-pay-pair">' +
          payslipHTML(lines[i], run) +
          '<div class="hr-pay-cut"></div>' +
          (lines[i + 1] ? payslipHTML(lines[i + 1], run) : "") +
          "</div>"
      );
    }
    return '<div class="hr-pay-slips">' + blocks.join("") + "</div>";
  }

  function printStyles() {
    return (
      "<style>" +
      "@page hr-pay-land{size:A4 landscape;margin:10mm 12mm}" +
      "@page hr-pay-port{size:A4 portrait;margin:10mm}" +
      ".hr-pay-reg{width:273mm;min-height:188mm;page:hr-pay-land;font:10px/1.25 Archivo,Arial,sans-serif}" +
      ".hr-pay-slips{page:hr-pay-port}" +
      ".hr-pay-t{width:100%;border-collapse:collapse;table-layout:fixed}" +
      ".hr-pay-t th,.hr-pay-t td{border:1px solid #2e2e2e;padding:2px 3px;vertical-align:top}" +
      ".hr-pay-num{white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right}" +
      ".hr-pay-name{overflow-wrap:break-word;word-break:normal;hyphens:none}" +
      ".hr-pay-net{background:#111;color:#fff;font-weight:700;padding:8px 10px;margin-top:8px;letter-spacing:.04em}" +
      ".hr-pay-pair{page-break-after:always}" +
      ".hr-pay-cut{border-top:1px dashed #888;margin:10px 0}" +
      ".hr-pay-slip{min-height:128mm;padding:4mm 0}" +
      ".hr-pay-work{color:#5b5e5e;font-size:9px}" +
      ".hr-pay-letter{text-align:center;margin-bottom:6px}" +
      ".hr-pay-h{text-align:center;font-weight:700;letter-spacing:.06em;margin:6px 0}" +
      ".hr-pay-iso{margin-top:10px;font-size:9px}" +
      "</style>"
    );
  }

  function esc(s) {
    if (root.esc) return root.esc(s);
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var api = {
    version: "1.1",
    OT_MULTIPLIER: OT_MULTIPLIER,
    FIXED_REGULAR_HOLIDAYS: FIXED_REGULAR_HOLIDAYS,
    isoDate: isoDate,
    addDays: addDays,
    daysBetween: daysBetween,
    eachDate: eachDate,
    payPeriod: payPeriod,
    payRelease: payRelease,
    payRunKey: payRunKey,
    isCustomRange: isCustomRange,
    stepRange: stepRange,
    payKindOf: payKindOf,
    payRate: payRate,
    weeklyHalf: weeklyHalf,
    statutoryOf: statutoryOf,
    empSemiDed: empSemiDed,
    defaultAllowance: defaultAllowance,
    computeLine: computeLine,
    holidayOn: holidayOn,
    ensureHolidayCalendar: ensureHolidayCalendar,
    dayCredit: dayCredit,
    payDayCredit: payDayCredit,
    holEligible: holEligible,
    holidayGranted: holidayGranted,
    holidayPremiumCode: holidayPremiumCode,
    holidayPremiumRate: holidayPremiumRate,
    holLabel: holLabel,
    holValueFromInput: holValueFromInput,
    applyHolOtFromUi: applyHolOtFromUi,
    tallyPersonPeriod: tallyPersonPeriod,
    missingReportDays: missingReportDays,
    periodHasReports: periodHasReports,
    latestFiledDate: latestFiledDate,
    latestFiledPeriod: latestFiledPeriod,
    importedPeriodCount: importedPeriodCount,
    periodDaySummaries: periodDaySummaries,
    personPeriodDays: personPeriodDays,
    maybeSnapPayWindow: maybeSnapPayWindow,
    statusAbbr: statusAbbr,
    holWorkings: holWorkings,
    validateTimes: validateTimes,
    caDueForPeriod: caDueForPeriod,
    caBalance: caBalance,
    attachDailyLog: attachDailyLog,
    diffDaily: diffDaily,
    makeLogEntry: makeLogEntry,
    editedAfterFiling: editedAfterFiling,
    logSummary: logSummary,
    foldDeductionKeys: foldDeductionKeys,
    registerHTML: registerHTML,
    payslipHTML: payslipHTML,
    payslipsSheetHTML: payslipsSheetHTML,
    printStyles: printStyles,
    localStamp: localStamp,
    attached: false,
  };

  function bindStore() {
    if (root.__hrS && root.__hrS.employees) return root.__hrS;
    if (root.S && root.S.employees) return root.S;
    try {
      if (typeof document !== "undefined" && document.createElement) {
        var s = document.createElement("script");
        s.textContent = "window.__hrS=S;window.S=S;";
        (document.documentElement || document.head || document.body).appendChild(s);
        if (s.parentNode) s.parentNode.removeChild(s);
      }
    } catch (e) {}
    return root.__hrS || root.S || {};
  }

  function store() {
    return bindStore();
  }

  function payDoc(S) {
    S = S || store();
    S.periods = S.periods || {};
    if (!S.periods.paymaker || typeof S.periods.paymaker !== "object") {
      S.periods.paymaker = { id: "paymaker", runs: {} };
    }
    if (!S.periods.paymaker.runs) S.periods.paymaker.runs = {};
    return S.periods.paymaker;
  }

  function editorName(S) {
    S = S || store();
    var ui = S.ui || {};
    return String(ui.dailyEditor || (S.periods && S.periods.paymaker && S.periods.paymaker.editorName) || "").slice(
      0,
      LOG_NAME_CAP
    );
  }

  function nameOfEmp(id, S) {
    S = S || store();
    var e = (S.employees || {})[id];
    return e ? flipName(e.name) : id;
  }

  function ctxFromStore(S) {
    S = S || store();
    ensureHolidayCalendar(S.settings || (S.settings = {}));
    return {
      daily: S.daily || {},
      leaves: S.leaves || {},
      employees: S.employees || {},
      settings: S.settings || {},
      holidays: (S.settings && S.settings.holidays) || [],
      advances: S.advances || {},
      effectiveStatus:
        (root.hrAttendance && root.hrAttendance.effectiveStatus) ||
        (typeof root.effectiveStatus === "function" ? root.effectiveStatus : null),
    };
  }

  function empStatusIsSeparated(e) {
    var s = String((e && e.status) || "").trim();
    if (s === "Separated") return true;
    return /^(resigned|terminated|awol)$/i.test(s);
  }

  function peopleForKind(kind, S) {
    S = S || store();
    var list = [];
    Object.keys(S.employees || {}).forEach(function (id) {
      var e = S.employees[id];
      if (!e || empStatusIsSeparated(e)) return;
      if (payKindOf(e) !== kind) return;
      list.push(e);
    });
    list.sort(function (a, b) {
      return String(a.empNo || "").localeCompare(String(b.empNo || "")) ||
        String(a.name || "").localeCompare(String(b.name || ""));
    });
    return list;
  }

  function todayISO() {
    if (typeof root.TODAY === "string" && root.TODAY) return root.TODAY;
    if (root.hrAttendance && typeof root.hrAttendance.manilaToday === "function") {
      return root.hrAttendance.manilaToday();
    }
    return isoDate(new Date());
  }

  function liveAttendanceIndex(S) {
    S = S || store();
    if (root.hrAttendance && typeof root.hrAttendance.firstAttendanceIndex === "function") {
      return root.hrAttendance.firstAttendanceIndex({
        daily: S.daily || {},
        employees: S.employees || {},
      });
    }
    var map = {};
    Object.keys(S.daily || {}).forEach(function (id) {
      var rec = S.daily[id];
      if (!rec) return;
      Object.keys(rec.rows || {}).forEach(function (empId) {
        if (!map[empId] || (rec.date && rec.date < map[empId])) map[empId] = rec.date || "";
      });
      (rec.extra || []).forEach(function (empId) {
        if (!map[empId] || (rec.date && rec.date < map[empId])) map[empId] = rec.date || "";
      });
    });
    return map;
  }

  function ensureEmpRate(e, today) {
    if (!e) return e;
    today = today || todayISO();
    var rate = Number(e.dailyRate) || 0;
    if ((!e.rates || !e.rates.length) && rate) {
      e.rates = [{
        rate: rate,
        rateType: e.rateType || "Daily",
        allowance: Number(e.allowance) || 0,
        from: e.dateHired || today,
        source: "on the employee record",
        on: today,
      }];
    }
    return e;
  }

  function markOnPeoplePay(e, source) {
    if (!e || empStatusIsSeparated(e)) return e;
    var today = todayISO();
    if (!e.rosterConfirmed) e.rosterConfirmed = today;
    ensureEmpRate(e, today);
    if (source && !e.payIncludedFrom) e.payIncludedFrom = source;
    return e;
  }

  function mergePeoplePay(standing, S) {
    S = S || store();
    var first = liveAttendanceIndex(S);
    var have = {};
    var list = [];
    (standing || []).forEach(function (e) {
      if (!e || !e.id || have[e.id] || empStatusIsSeparated(e)) return;
      have[e.id] = true;
      ensureEmpRate(e);
      list.push(e);
    });
    Object.keys(S.employees || {}).forEach(function (id) {
      var e = S.employees[id];
      if (!e || have[id] || empStatusIsSeparated(e)) return;
      if (e.rosterConfirmed || first[id]) {
        ensureEmpRate(e);
        list.push(e);
      }
    });
    list.sort(function (a, b) {
      var an = String(a.empNo || "").replace(/[^0-9]/g, "");
      var bn = String(b.empNo || "").replace(/[^0-9]/g, "");
      if (!!an !== !!bn) return an ? -1 : 1;
      return an ? an.localeCompare(bn) : String(a.name || "").localeCompare(String(b.name || ""));
    });
    return list;
  }

  function peopleAndPayList(S) {
    S = S || store();
    var standing = [];
    var orig = typeof root.atWork === "function"
      ? (root.atWork.__hrPayOrig || (!root.atWork.__hrPayPeople && root.atWork))
      : null;
    if (orig) {
      try {
        standing = orig.call(root) || [];
      } catch (err) {
        standing = [];
      }
    }
    return mergePeoplePay(standing, S);
  }

  function adoptNewEmployee(obj, id) {
    if (!obj || empStatusIsSeparated(obj)) return obj;
    var key = id || obj.id || "";
    /* Seeded 201s are e1250; a hand-added 201 or hire is uid("e") → e_…. */
    if (!obj.rosterConfirmed && /^e_/.test(String(key))) markOnPeoplePay(obj, "201");
    else ensureEmpRate(obj);
    return obj;
  }

  function adoptDailyPeople(rec, putFn) {
    if (!rec) return;
    var S = store();
    var ids = (rec.extra || []).slice();
    Object.keys(rec.rows || {}).forEach(function (id) {
      if (ids.indexOf(id) < 0) ids.push(id);
    });
    ids.forEach(function (empId) {
      var e = S.employees && S.employees[empId];
      if (!e || empStatusIsSeparated(e) || e.rosterConfirmed) return;
      var parked = false;
      if (typeof root.parkedIds === "function") {
        try {
          var set = root.parkedIds();
          parked = !!(set && (set.has ? set.has(empId) : set[empId]));
        } catch (err) {
          parked = false;
        }
      }
      if (!parked && !(rec.extra || []).some(function (x) { return x === empId; })) return;
      var c = JSON.parse(JSON.stringify(e));
      markOnPeoplePay(c, "attendance");
      S.employees[c.id] = c;
      if (typeof putFn === "function") putFn.call(root, "employees", c.id, c);
    });
  }

  api.empStatusIsSeparated = empStatusIsSeparated;
  api.peopleForKind = peopleForKind;
  api.peopleAndPayList = peopleAndPayList;
  api.mergePeoplePay = mergePeoplePay;
  api.ensureEmpRate = ensureEmpRate;
  api.markOnPeoplePay = markOnPeoplePay;
  api.liveAttendanceIndex = liveAttendanceIndex;
  api.adoptNewEmployee = adoptNewEmployee;
  api.adoptDailyPeople = adoptDailyPeople;

  function buildLine(e, kind, from, to, saved, ctx, settings) {
    var rate = payRate(e, kind);
    var tally = tallyPersonPeriod(e.id, from, to, ctx);
    var stat = statutoryOf(e, kind, settings);
    var prev = (saved && saved.lines && saved.lines[e.id]) || {};
    var L = computeLine({
      empId: e.id,
      name: e.name,
      empNo: e.empNo,
      project: e.project || "ADMINS",
      days: tally.days,
      ot: tally.ot,
      hol: tally.hol,
      holFactor: tally.holFactor,
      hol30: tally.hol30,
      hol100: tally.hol100,
      daily: rate.daily,
      hourly: rate.hourly,
      otMultiplier: otMultiplier(settings),
      allowance: prev.allowance != null && prev.allowance !== "" ? Number(prev.allowance) : defaultAllowance(e),
      incentive: Number(prev.incentive) || 0,
      late: Number(prev.late) || 0,
      ca: prev.ca != null && prev.ca !== "" ? Number(prev.ca) : caDueForPeriod(ctx.advances, e.id),
      uniform: Number(prev.uniform) || 0,
      sssLoan: Number(prev.sssLoan) || 0,
      hdmfLoan: Number(prev.hdmfLoan) || 0,
      sss: prev.sss != null && prev.sss !== "" ? Number(prev.sss) : stat.sss,
      phic: prev.phic != null && prev.phic !== "" ? Number(prev.phic) : stat.phic,
      hdmf: prev.hdmf != null && prev.hdmf !== "" ? Number(prev.hdmf) : stat.hdmf,
    });
    L.hol30 = tally.hol30;
    L.hol100 = tally.hol100;
    L.eligDates = tally.eligDates;
    L.dayDates = tally.dayDates;
    L.otDates = tally.otDates;
    L.holDates = tally.holDates;
    L.eligible = tally.eligible;
    L.caRemaining = caDueForPeriod(ctx.advances, e.id) > 0
      ? Math.max(0, (function () {
          var left = 0;
          Object.keys(ctx.advances || {}).forEach(function (id) {
            var a = ctx.advances[id];
            if (a && a.empId === e.id && !CA_SKIP[a.status]) left += Math.max(0, caBalance(a) - (L.ca || 0));
          });
          return left;
        })())
      : 0;
    return L;
  }

  function buildRun(kind, from, to, S) {
    S = S || store();
    var ctx = ctxFromStore(S);
    var key = payRunKey(kind, from, to);
    var doc = payDoc(S);
    var saved = doc.runs[key] || {};
    var people = peopleForKind(kind, S);
    var lines = people.map(function (e) {
      return buildLine(e, kind, from, to, saved, ctx, S.settings);
    });
    return {
      key: key,
      kind: kind,
      from: from,
      to: to,
      release: payRelease(kind, { from: from, to: to }),
      custom: isCustomRange(kind, from, to),
      lines: lines,
      missing: missingReportDays(from, to, ctx.daily),
    };
  }

  api.buildRun = buildRun;
  api.buildLine = buildLine;
  api.ctxFromStore = ctxFromStore;
  api.editorName = editorName;

  /* ---------------- browser chrome ---------------- */

  function $(sel, node) {
    if (root.$ && !node) return root.$(sel);
    return (node || document).querySelector(sel);
  }

  function injectStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById("hr-payroll-styles")) return;
    var style = document.createElement("style");
    style.id = "hr-payroll-styles";
    style.textContent =
      ".hr-pay-wrap{overflow-x:auto}" +
      ".hr-pay-wrap table{min-width:1180px}" +
      ".hr-pay-money{min-width:64px;min-height:40px;width:72px}" +
      ".hr-pay-lock{cursor:default}" +
      ".hr-pay-banner{margin:10px 0;padding:10px 12px}" +
      ".hr-pay-nav .btn,.hr-pay-door .btn{min-height:40px}" +
      ".hr-pay-hol{min-height:40px;display:inline-flex;align-items:center;justify-content:center;gap:4px}" +
      ".hr-pay-hol input,.hr-att-hol input{width:20px;height:20px}" +
      ".hr-pay-hol select,.hr-att-hol select{min-height:40px;max-width:92px}" +
      ".hr-pay-ot{width:64px;min-height:40px}" +
      ".hr-pay-time{width:92px;min-height:40px}" +
      ".hr-pay-edited{margin-left:6px}" +
      ".hr-pay-log{font-size:12px;line-height:1.45}" +
      ".hr-pay-att-warn{background:var(--warn-soft,#fbf3e4)}" +
      ".hr-pay-att-bad{background:var(--crit-soft,#fbeceb);color:var(--crit)}" +
      ".hr-pay-need{outline:2px solid var(--warn,#c48a2a)}" +
      "@media (max-width:980px){.hr-pay-nav .btn,.hr-pay-hol,.hr-pay-ot,.hr-pay-money,.hr-pay-time,.hr-pay-door .btn{min-height:44px}}" +
      printStyles();
    (document.head || document.documentElement).appendChild(style);
  }

  function injectNav() {
    var nav = document.querySelector("nav") || document.getElementById("nav");
    if (!nav) return;
    if (nav.querySelector('[data-nav="paymaker"]')) return;
    var payroll = nav.querySelector('[data-nav="payroll"]');
    var host = payroll && payroll.parentNode;
    if (!host) return;
    function item(k, label) {
      var b = document.createElement("button");
      b.className = "nav-i";
      b.setAttribute("data-nav", k);
      b.type = "button";
      b.textContent = label;
      b.style.minHeight = "40px";
      return b;
    }
    host.insertBefore(item("paymaker", "Payroll Maker"), payroll);
    host.insertBefore(item("contrib", "Contributions"), payroll.nextSibling);
  }

  function highlightNav() {
    var S = store();
    var view = S.ui && S.ui.view;
    document.querySelectorAll("[data-nav]").forEach(function (el) {
      var on = el.getAttribute("data-nav") === view;
      el.className = String(el.className || "").replace(/\bon\b/g, "").trim() + (on ? " on" : "");
    });
  }

  function setCrumb(t, s) {
    if (typeof root.setCrumb === "function") root.setCrumb(t, s);
    else if (typeof document !== "undefined" && document.getElementById) {
      var c = document.getElementById("crumb");
      if (c) c.innerHTML = esc(t) + (s ? "<small>" + esc(s) + "</small>" : "");
    }
  }

  function goView(view) {
    var S = store();
    S.ui = S.ui || {};
    S.ui.view = view;
    if (typeof root.go === "function" && view !== "paymaker" && view !== "contrib") {
      root.go(view);
      return;
    }
    if (typeof root.render === "function") root.render();
  }

  function currentPayUi(S) {
    S = S || store();
    S.ui = S.ui || {};
    var kind = S.ui.payKind === "semi" ? "semi" : "weekly";
    var today = (typeof root.TODAY === "string" && root.TODAY) || isoDate(new Date());
    var std = payPeriod(kind, S.ui.payAnchor || today);
    var from = S.ui.payFrom || std.from;
    var to = S.ui.payTo || std.to;
    if (S.ui.payKind && S.ui.payCustomCleared) {
      from = std.from;
      to = std.to;
    }
    return { kind: kind, from: from, to: to, custom: isCustomRange(kind, from, to) };
  }

  function moneyInput(id, field, value) {
    return (
      '<input class="hr-pay-money" type="number" step="0.01" min="0" data-pay-emp="' +
      esc(id) +
      '" data-pay-k="' +
      esc(field) +
      '" value="' +
      esc(value == null ? "" : value) +
      '">'
    );
  }

  function hoverDays(dates) {
    return (dates || []).join(", ") || "no days in this window";
  }

  function holMixLabel(L) {
    if (L.hol30 && L.hol100) return L.hol30 + "×30% " + L.hol100 + "×100%";
    if (L.hol100) return L.hol100 + "×100%";
    if (L.hol30) return L.hol30 + "×30%";
    return String(L.hol || 0);
  }

  function personHolSelect(L) {
    var code = 0;
    if (L.hol100 && !L.hol30) code = 2;
    else if (L.hol30 && !L.hol100) code = 1;
    else if (L.hol30 && L.hol100) code = "";
    return (
      '<select data-hr-pay-hol="' +
      esc(L.empId) +
      '" title="' +
      esc(L.eligible ? "Eligible days: " + hoverDays(L.eligDates) : "Not eligible") +
      '"' +
      (L.eligible ? "" : " disabled") +
      ' style="min-height:40px;max-width:96px">' +
      (code === "" ? '<option value="" selected>Mixed</option>' : "") +
      '<option value="0"' + (code === 0 ? " selected" : "") + ">As is</option>" +
      '<option value="1"' + (code === 1 ? " selected" : "") + ">+30%</option>" +
      '<option value="2"' + (code === 2 ? " selected" : "") + ">+100%</option>" +
      "</select> " +
      holMixLabel(L)
    );
  }

  function periodAttendanceHTML(ui, S, run) {
    var ctx = ctxFromStore(S);
    var days = periodDaySummaries(ui.from, ui.to, ctx);
    var filed = days.filter(function (d) { return d.filed; }).length;
    var latest = latestFiledPeriod(ui.kind, S.daily || {});
    var imported = importedPeriodCount(S);
    var snapped = !!(S.ui && S.ui.paySnapped);
    var h = '<div class="card" id="hr-pay-att" style="margin:14px 0"><div class="card-h"><h3>Period attendance</h3>' +
      '<div class="sp"><span class="lbl">' +
      filed +
      " of " +
      days.length +
      ' days filed</span></div></div><div class="card-b stack">';
    if (snapped && latest && ui.from === latest.from && ui.to === latest.to) {
      h +=
        '<div class="note hr-pay-banner">Opened the <b>latest period with filed reports</b> (' +
        esc(latest.from) +
        " – " +
        esc(latest.to) +
        "). This week had none yet.</div>";
    }
    if (!filed) {
      h +=
        '<div class="empty" id="hr-pay-att-empty">No Daily Manpower report in this window — that is why Days and OT read as blank. ' +
        "Payroll Maker counts the daily reports (the same ones as the manpower attendance summary), not an Excel paste on Attendance.</div>" +
        '<div class="row hr-pay-door" style="margin-top:10px">' +
        '<button type="button" class="btn pri" id="hr-pay-paste">Paste Claude JSON</button>' +
        '<button type="button" class="btn" id="hr-pay-daily2">Open Daily Manpower</button>' +
        (latest
          ? '<button type="button" class="btn" id="hr-pay-latest">Jump to ' +
            esc(latest.from) +
            " – " +
            esc(latest.to) +
            "</button>"
          : "") +
        "</div>";
      if (imported) {
        h +=
          '<div class="note">There ' +
          (imported === 1 ? "is an imported payroll period" : "are " + imported + " imported payroll periods") +
          " on <b>Attendance / Payroll Data</b>. Those pasted sheets do not fill this grid — file or paste the daily reports.</div>";
      }
      h += "</div></div>";
      return h;
    }
    h +=
      '<div class="note">Each square is a filed day. P present · L late · U undertime · A absent. ' +
      "Open a day to edit status, time in/out, and holiday treatment. Days cannot be typed on the register below.</div>";
    h += '<div class="hr-pay-wrap"><div class="tw"><table class="hr-pay-att"><thead><tr><th>Date</th><th>Filed</th>' +
      '<th class="num">People</th><th class="num">Late</th><th class="num">UT</th><th class="num">Absent</th><th></th></tr></thead><tbody>';
    days.forEach(function (d) {
      h +=
        "<tr><td class=\"mono\">" +
        esc(d.date) +
        (d.sunday ? ' <span class="pill mut">Sun</span>' : "") +
        "</td><td>" +
        (d.filed
          ? '<span class="pill ok">filed</span>'
          : d.sunday
            ? '<span class="lbl">Sunday</span>'
            : '<span class="pill warn">No report filed</span>') +
        '</td><td class="num">' +
        (d.filed ? d.counts.people : "—") +
        '</td><td class="num">' +
        (d.counts.late || "0") +
        '</td><td class="num">' +
        (d.counts.undertime || "0") +
        '</td><td class="num">' +
        (d.counts.absent || "0") +
        '</td><td><button type="button" class="btn sm" data-hr-pay-openday="' +
        esc(d.date) +
        '">' +
        (d.filed ? "Open" : "File") +
        "</button></td></tr>";
    });
    h += "</tbody></table></div></div>";
    if (run.lines && run.lines.length) {
      h += '<div class="hr-pay-wrap" style="margin-top:12px"><div class="tw"><table class="hr-pay-att-grid"><thead><tr><th>Name</th>';
      days.forEach(function (d) {
        h += '<th class="num" title="' + esc(d.date) + '">' + esc(d.date.slice(8)) + "</th>";
      });
      h += "<th></th></tr></thead><tbody>";
      run.lines.forEach(function (L) {
        var cells = personPeriodDays(L.empId, ui.from, ui.to, ctx);
        h +=
          "<tr><td class=\"nm\"><b>" +
          esc(flipName(L.name)) +
          "</b></td>";
        cells.forEach(function (c) {
          var title = c.filed
            ? (c.status || "no row") +
              (c.in ? " in " + c.in : "") +
              (c.out ? " out " + c.out : "") +
              (c.hol ? " hol " + holLabel(c.hol) : "")
            : "No report filed";
          h +=
            '<td class="num' +
            (c.status === "Present/Late" || c.status === "Undertime" ? " hr-pay-att-warn" : "") +
            (c.status === "Absent" ? " hr-pay-att-bad" : "") +
            '" title="' +
            esc(title) +
            '">' +
            (c.filed ? esc(statusAbbr(c.status)) : "—") +
            "</td>";
        });
        h +=
          '<td><button type="button" class="btn sm" data-hr-pay-person="' +
          esc(L.empId) +
          '">Days</button></td></tr>';
      });
      h += "</tbody></table></div></div>";
    }
    h +=
      '<div class="row hr-pay-door" style="margin-top:10px">' +
      '<button type="button" class="btn" id="hr-pay-paste">Paste Claude JSON</button>' +
      '<button type="button" class="btn" id="hr-pay-daily2">Open Daily Manpower</button></div>';
    h += "</div></div>";
    return h;
  }

  function viewPayMaker() {
    var S = store();
    maybeSnapPayWindow(S);
    var ui = currentPayUi(S);
    var run = buildRun(ui.kind, ui.from, ui.to, S);
    var show = foldDeductionKeys(run.lines);
    var totG = run.lines.reduce(function (s, L) { return s + L.gross; }, 0);
    var totN = run.lines.reduce(function (s, L) { return s + L.net; }, 0);
    var elig = run.lines.filter(function (L) { return L.eligible; }).length;
    var granted = run.lines.filter(function (L) { return L.hol; }).length;
    setCrumb(
      "Payroll Maker",
      (ui.kind === "semi" ? "Semi-monthly" : "Weekly") +
        " · " +
        ui.from +
        " – " +
        ui.to +
        (ui.custom ? " · custom range" : "")
    );
    var h = '<div class="row hr-pay-nav" style="margin-bottom:14px">' +
      '<div class="seg">' +
      '<button type="button" class="' + (ui.kind === "weekly" ? "on" : "") + '" data-hr-pay-kind="weekly">Weekly</button>' +
      '<button type="button" class="' + (ui.kind === "semi" ? "on" : "") + '" data-hr-pay-kind="semi">Semi-monthly</button>' +
      "</div>" +
      '<button type="button" class="btn sm" id="hr-pay-prev" title="Previous period">◀</button>' +
      '<div class="f" style="margin:0"><label>From</label><input id="hr-pay-from" type="date" value="' + esc(ui.from) + '"></div>' +
      '<div class="f" style="margin:0"><label>To</label><input id="hr-pay-to" type="date" value="' + esc(ui.to) + '"></div>' +
      '<button type="button" class="btn sm" id="hr-pay-next" title="Next period">▶</button>' +
      (ui.custom
        ? '<span class="pill acc">Custom range</span><button type="button" class="btn sm" id="hr-pay-std">Standard window</button>'
        : "") +
      '<button type="button" class="btn" id="hr-pay-daily">Open Daily Manpower</button>' +
      '<button type="button" class="btn" id="hr-pay-paste-nav">Paste Claude JSON</button>' +
      '<button type="button" class="btn" id="hr-pay-print">Print register</button>' +
      '<button type="button" class="btn" id="hr-pay-slips">Payslips</button>' +
      '<button type="button" class="btn pri" id="hr-pay-save">Save run</button>' +
      "</div>";
    h +=
      '<div class="note">Kind follows the person\'s <b>rate type</b> (monthly → semi, otherwise weekly), not their department. ' +
      "Days, OT and premium are live from Daily Manpower — they cannot be typed here. " +
      "Holiday treatment is per day: <b>+30%</b>, <b>+100%</b>, or <b>As is</b>. " +
      "A range you pick by hand has its own save key and a blank release date.</div>";
    h += periodAttendanceHTML(ui, S, run);
    if (run.missing.length) {
      h +=
        '<div class="note hr-pay-banner" style="border-left-color:var(--warn)"><b>No report filed</b> on ' +
        esc(run.missing.map(function (d) { return d.slice(8); }).join(", ")) +
        " (Sundays out). Those days will default to Present if you open Daily Manpower and save without changing them.</div>";
    }
    if (elig) {
      h +=
        '<div class="note hr-pay-banner" id="hr-pay-hol-banner">Holiday premium is <b>eligible, not granted</b>. ' +
        elig +
        " people have an eligible day; " +
        granted +
        " have a premium. Pick <b>+30%</b> (special / Sunday) or <b>+100%</b> (regular holiday); <b>As is</b> pays the day with no increase. " +
        '<button type="button" class="btn sm" id="hr-pay-give">Give all +30%</button> ' +
        '<button type="button" class="btn sm" id="hr-pay-give100">Give all +100%</button> ' +
        '<button type="button" class="btn sm" id="hr-pay-clear">Clear all (as is)</button> ' +
        '<button type="button" class="btn sm" id="hr-pay-holcal">Holiday calendar</button>' +
        '<div class="lbl" style="margin-top:6px">Special non-working days arrive by proclamation — they are not shipped in the calendar.</div></div>';
    }
    h +=
      '<div class="strip">' +
      '<div class="tile acc"><div class="v">' +
      run.lines.length +
      '</div><div class="k">People on this kind</div></div>' +
      '<div class="tile acc"><div class="v">' +
      peso(totG) +
      '</div><div class="k">Gross</div></div>' +
      '<div class="tile acc"><div class="v">' +
      peso(totN) +
      '</div><div class="k">Net (peso ceiling)</div></div>' +
      '<div class="tile"><div class="v">' +
      esc(run.release || "—") +
      '</div><div class="k">Release date</div></div></div>';
    h += '<div class="card hr-pay-wrap"><div class="tw"><table><thead><tr>' +
      "<th>No.</th><th>ID</th><th>Name</th><th>Project</th>" +
      '<th class="num">Days</th><th class="num">OT</th><th class="num">Hol</th>' +
      '<th class="num">Daily</th><th class="num">Allow.</th><th class="num">Inc.</th>' +
      '<th class="num">Late</th><th class="num">CA</th>' +
      (show.uniform ? '<th class="num">Unif.</th>' : "") +
      (show.sssLoan ? '<th class="num">SSS ln</th>' : "") +
      (show.hdmfLoan ? '<th class="num">HDMF ln</th>' : "") +
      '<th class="num">SSS</th><th class="num">PHIC</th><th class="num">HDMF</th>' +
      '<th class="num">Gross</th><th class="num">Net</th><th></th></tr></thead><tbody>';
    run.lines.forEach(function (L, i) {
      h +=
        "<tr><td class=\"mono\">" +
        (i + 1) +
        '</td><td class="mono">' +
        esc(L.empNo || "") +
        "</td><td class=\"nm hr-pay-name\"><b>" +
        esc(flipName(L.name)) +
        "</b></td><td>" +
        esc(L.project || "—") +
        '</td><td class="num hr-pay-lock" title="' +
        esc(hoverDays(L.dayDates)) +
        '">' +
        L.days +
        '</td><td class="num hr-pay-lock" title="' +
        esc(hoverDays(L.otDates)) +
        '">' +
        L.ot +
        '</td><td class="num">' +
        personHolSelect(L) +
        "</td>" +
        '<td class="num">' +
        money(L.daily) +
        "</td><td>" +
        moneyInput(L.empId, "allowance", L.allowance) +
        "</td><td>" +
        moneyInput(L.empId, "incentive", L.incentive) +
        "</td><td>" +
        moneyInput(L.empId, "late", L.late) +
        "</td><td>" +
        moneyInput(L.empId, "ca", L.ca) +
        "</td>" +
        (show.uniform ? "<td>" + moneyInput(L.empId, "uniform", L.uniform) + "</td>" : "") +
        (show.sssLoan ? "<td>" + moneyInput(L.empId, "sssLoan", L.sssLoan) + "</td>" : "") +
        (show.hdmfLoan ? "<td>" + moneyInput(L.empId, "hdmfLoan", L.hdmfLoan) + "</td>" : "") +
        "<td>" +
        moneyInput(L.empId, "sss", L.sss) +
        "</td><td>" +
        moneyInput(L.empId, "phic", L.phic) +
        "</td><td>" +
        moneyInput(L.empId, "hdmf", L.hdmf) +
        '</td><td class="num">' +
        money(L.gross) +
        '</td><td class="num"><b>' +
        money(L.net) +
        "</b></td>" +
        '<td><button type="button" class="btn sm" data-hr-pay-open="' +
        esc(L.empId) +
        '">201</button></td></tr>';
    });
    h += "</tbody></table></div></div>";
    h +=
      '<div class="note">Overtime ships at 1.0× (Settings). Net pay is the peso ceiling. ' +
      "A late person is still paid the day; late is a peso deduction on this run. " +
      "Weekly statutory amounts drop the leftover centavo.</div>";
    return h;
  }

  function collectRunEdits(run) {
    var map = {};
    (run.lines || []).forEach(function (L) {
      map[L.empId] = {
        allowance: L.allowance,
        incentive: L.incentive,
        late: L.late,
        ca: L.ca,
        uniform: L.uniform,
        sssLoan: L.sssLoan,
        hdmfLoan: L.hdmfLoan,
        sss: L.sss,
        phic: L.phic,
        hdmf: L.hdmf,
      };
    });
    if (typeof document === "undefined") return map;
    document.querySelectorAll("[data-pay-emp]").forEach(function (inp) {
      var id = inp.getAttribute("data-pay-emp");
      var k = inp.getAttribute("data-pay-k");
      if (!id || !k) return;
      map[id] = map[id] || {};
      map[id][k] = inp.value === "" ? 0 : Number(inp.value) || 0;
    });
    return map;
  }

  async function saveCurrentRun() {
    var S = store();
    var ui = currentPayUi(S);
    var run = buildRun(ui.kind, ui.from, ui.to, S);
    var doc = payDoc(S);
    doc.runs[run.key] = {
      kind: run.kind,
      from: run.from,
      to: run.to,
      release: run.release,
      lines: collectRunEdits(run),
    };
    if (typeof root.put === "function") await root.put("periods", "paymaker", doc);
    if (root.toast) root.toast("Saved " + run.key, "ok");
  }

  async function setHolForPeople(empIds, code) {
    var S = store();
    var ui = currentPayUi(S);
    var ctx = ctxFromStore(S);
    var want = {};
    var nextCode = Number(code) || 0;
    if (nextCode !== 1 && nextCode !== 2) nextCode = 0;
    (empIds || []).forEach(function (id) { want[id] = 1; });
    var dates = eachDate(ui.from, ui.to);
    var i;
    for (i = 0; i < dates.length; i++) {
      var d = dates[i];
      var rec = (S.daily || {})[dailyId(d)];
      if (!rec) continue;
      var next = JSON.parse(JSON.stringify(rec));
      var changed = false;
      Object.keys(want).forEach(function (id) {
        var row = (next.rows || {})[id];
        if (!row) return;
        if (!holEligible(row, d, id, ctx)) return;
        if (holidayPremiumCode(row) === nextCode) return;
        row.hol = nextCode;
        changed = true;
      });
      if (changed && typeof root.put === "function") await root.put("daily", next.id, next);
    }
  }

  function openPrint(title, inner, landscape) {
    var body = printStyles() + inner;
    if (typeof root.openModal === "function") {
      root.openModal({
        title: title,
        wide: true,
        body: '<div id="hr-pay-printbox">' + body + "</div>",
        foot:
          '<button class="btn" id="hr-pay-print-go">Print / Save as PDF</button>' +
          '<button class="btn pri" id="hr-pay-print-close">Close</button>',
      });
      var go = $("#hr-pay-print-go");
      var close = $("#hr-pay-print-close");
      if (go) {
        go.onclick = function () {
          if (typeof root.printDoc === "function") root.printDoc("PAY", body);
          else window.print();
        };
      }
      if (close && root.closeModal) close.onclick = root.closeModal;
      return;
    }
    var w = window.open("", "_blank");
    if (w) {
      w.document.write("<!doctype html><title>" + esc(title) + "</title>" + body);
      w.document.close();
    }
    return landscape;
  }

  var PAY_STATUSES = [
    "Present",
    "Present/Late",
    "Undertime",
    "Absent",
    "Leave",
    "Leave with Pay",
    "Regular Holiday",
    "Special Holiday",
    "Half Day",
    "Rest Day",
  ];

  function validateTimes(row) {
    if (root.hrAttendance && typeof root.hrAttendance.validateDayRowTimes === "function") {
      return root.hrAttendance.validateDayRowTimes(row);
    }
    var st = (row && (row.s || row.status)) || "";
    var errors = [];
    if (st === "Present/Late" && !String((row && row.in) || "").trim()) {
      errors.push("Time In is required for Present/Late.");
    }
    if (st === "Undertime" && !String((row && row.out) || "").trim()) {
      errors.push("Time Out is required for Undertime.");
    }
    return errors;
  }

  function openPersonAttendance(empId) {
    var S = store();
    var ui = currentPayUi(S);
    var ctx = ctxFromStore(S);
    var e = (S.employees || {})[empId];
    if (!e || typeof root.openModal !== "function") return;
    var days = personPeriodDays(empId, ui.from, ui.to, ctx);
    var rows = days
      .map(function (c) {
        var st = (c.row && (c.row.s || c.row.status)) || c.status || (c.filed ? "Present" : "");
        return (
          "<tr><td class=\"mono\">" +
          esc(c.date) +
          "</td><td>" +
          (c.filed
            ? '<select data-hr-pd-s="' +
              esc(c.date) +
              '" style="min-height:40px">' +
              PAY_STATUSES.map(function (x) {
                return "<option" + (st === x ? " selected" : "") + ">" + x + "</option>";
              }).join("") +
              "</select>"
            : '<span class="lbl">No report filed</span>') +
          "</td><td>" +
          (c.filed
            ? '<input type="time" data-hr-pd-in="' +
              esc(c.date) +
              '" value="' +
              esc(c.in) +
              '" style="min-height:40px" title="Required when status is Present/Late">'
            : "—") +
          "</td><td>" +
          (c.filed
            ? '<input type="time" data-hr-pd-out="' +
              esc(c.date) +
              '" value="' +
              esc(c.out) +
              '" style="min-height:40px" title="Required when status is Undertime">'
            : "—") +
          "</td><td>" +
          (c.filed ? holSelectHTML(c.date, "data-hr-pd-hol", c.hol) : "—") +
          "</td></tr>"
        );
      })
      .join("");
    root.openModal({
      title: flipName(e.name) + " · " + ui.from + " – " + ui.to,
      wide: true,
      body:
        '<div class="stack"><div class="note">Present/Late needs <b>Time In</b>. Undertime needs <b>Time Out</b>. Holiday is per day: +30%, +100%, or as is.</div>' +
        '<div class="tw"><table><thead><tr><th>Date</th><th>Status</th><th>Time in</th><th>Time out</th><th>Holiday</th></tr></thead><tbody>' +
        rows +
        "</tbody></table></div><div id=\"hr-pd-err\" class=\"note\" style=\"display:none;border-left-color:var(--crit)\"></div></div>",
      foot:
        '<button class="btn" id="hr-pd-cancel">Cancel</button>' +
        '<button class="btn pri" id="hr-pd-save">Save days</button>',
    });
    var cancel = $("#hr-pd-cancel");
    if (cancel && root.closeModal) cancel.onclick = root.closeModal;
    var go = $("#hr-pd-save");
    if (!go) return;
    go.onclick = async function () {
      var errBox = $("#hr-pd-err");
      var byDate = {};
      document.querySelectorAll("[data-hr-pd-s]").forEach(function (sel) {
        var d = sel.getAttribute("data-hr-pd-s");
        byDate[d] = byDate[d] || {};
        byDate[d].s = sel.value;
      });
      document.querySelectorAll("[data-hr-pd-in]").forEach(function (inp) {
        var d = inp.getAttribute("data-hr-pd-in");
        byDate[d] = byDate[d] || {};
        byDate[d].in = inp.value;
      });
      document.querySelectorAll("[data-hr-pd-out]").forEach(function (inp) {
        var d = inp.getAttribute("data-hr-pd-out");
        byDate[d] = byDate[d] || {};
        byDate[d].out = inp.value;
      });
      document.querySelectorAll("[data-hr-pd-hol]").forEach(function (sel) {
        var d = sel.getAttribute("data-hr-pd-hol");
        byDate[d] = byDate[d] || {};
        byDate[d].hol = holValueFromInput(sel);
      });
      var dates = Object.keys(byDate);
      var problems = [];
      dates.forEach(function (d) {
        validateTimes(byDate[d]).forEach(function (msg) {
          problems.push(d.slice(8) + ": " + msg);
        });
      });
      if (problems.length) {
        if (errBox) {
          errBox.style.display = "block";
          errBox.textContent = problems.join(" ");
        }
        if (root.toast) root.toast(problems[0], "err");
        return;
      }
      var i;
      for (i = 0; i < dates.length; i++) {
        var d = dates[i];
        var rec = (S.daily || {})[dailyId(d)];
        if (!rec) continue;
        var next = JSON.parse(JSON.stringify(rec));
        next.rows = next.rows || {};
        next.rows[empId] = Object.assign({}, next.rows[empId] || { site: e.project || "ADMINS" }, byDate[d]);
        if (typeof root.put === "function") await root.put("daily", next.id, next);
      }
      if (root.closeModal) root.closeModal();
      if (root.toast) root.toast("Attendance saved for " + flipName(e.name), "ok");
      if (typeof root.render === "function") root.render();
    };
  }

  function wirePayMaker() {
    var S = store();
    function setKind(kind) {
      S.ui.payKind = kind;
      S.ui.payFrom = "";
      S.ui.payTo = "";
      S.ui.payAnchor = (typeof root.TODAY === "string" && root.TODAY) || isoDate(new Date());
      if (typeof root.render === "function") root.render();
    }
    document.querySelectorAll("[data-hr-pay-kind]").forEach(function (b) {
      b.onclick = function () { setKind(b.getAttribute("data-hr-pay-kind")); };
    });
    var from = $("#hr-pay-from");
    var to = $("#hr-pay-to");
    function applyDates() {
      if (!from || !to || !from.value || !to.value) return;
      S.ui.payFrom = from.value;
      S.ui.payTo = to.value;
      S.ui.payAnchor = from.value;
      S.ui.paySnapped = 0;
      if (typeof root.render === "function") root.render();
    }
    if (from) from.onchange = applyDates;
    if (to) to.onchange = applyDates;
    var prev = $("#hr-pay-prev");
    var next = $("#hr-pay-next");
    function step(dir) {
      var ui = currentPayUi(S);
      var n = ui.custom ? stepRange(ui.from, ui.to, dir) : (function () {
        var std = payPeriod(ui.kind, addDays(ui.from, dir === 1 ? daysBetween(ui.from, ui.to) + 1 : -1));
        return std;
      })();
      S.ui.payFrom = n.from;
      S.ui.payTo = n.to;
      S.ui.payAnchor = n.from;
      if (typeof root.render === "function") root.render();
    }
    if (prev) prev.onclick = function () { step(-1); };
    if (next) next.onclick = function () { step(1); };
    var std = $("#hr-pay-std");
    if (std) {
      std.onclick = function () {
        var ui = currentPayUi(S);
        var p = payPeriod(ui.kind, ui.from);
        S.ui.payFrom = p.from;
        S.ui.payTo = p.to;
        if (typeof root.render === "function") root.render();
      };
    }
    function openDaily(date) {
      var ui = currentPayUi(S);
      S.ui.dailyDate = date || ui.to;
      goView("daily");
    }
    function openPaste() {
      if (root.hrAttendance && typeof root.hrAttendance.openPasteDoor === "function") {
        root.hrAttendance.openPasteDoor();
        return;
      }
      if (root.toast) root.toast("Paste door is on Daily Manpower / Analytics.", "err");
      openDaily();
    }
    var daily = $("#hr-pay-daily");
    if (daily) daily.onclick = function () { openDaily(); };
    var daily2 = $("#hr-pay-daily2");
    if (daily2) daily2.onclick = function () { openDaily(); };
    var paste = $("#hr-pay-paste");
    if (paste) paste.onclick = openPaste;
    var pasteNav = $("#hr-pay-paste-nav");
    if (pasteNav) pasteNav.onclick = openPaste;
    var latestBtn = $("#hr-pay-latest");
    if (latestBtn) {
      latestBtn.onclick = function () {
        var latest = latestFiledPeriod(currentPayUi(S).kind, S.daily || {});
        if (!latest) return;
        S.ui.payFrom = latest.from;
        S.ui.payTo = latest.to;
        S.ui.payAnchor = latest.from;
        S.ui.paySnapped = 0;
        if (typeof root.render === "function") root.render();
      };
    }
    document.querySelectorAll("[data-hr-pay-openday]").forEach(function (b) {
      b.onclick = function () { openDaily(b.getAttribute("data-hr-pay-openday")); };
    });
    document.querySelectorAll("[data-hr-pay-person]").forEach(function (b) {
      b.onclick = function () { openPersonAttendance(b.getAttribute("data-hr-pay-person")); };
    });
    var save = $("#hr-pay-save");
    if (save) save.onclick = function () { saveCurrentRun(); };
    var pr = $("#hr-pay-print");
    if (pr) {
      pr.onclick = function () {
        var ui = currentPayUi(S);
        var run = buildRun(ui.kind, ui.from, ui.to, S);
        var saved = collectRunEdits(run);
        run.lines.forEach(function (L) {
          var e = saved[L.empId];
          if (!e) return;
          Object.keys(e).forEach(function (k) { L[k] = e[k]; });
          computeLine(L);
        });
        var letter = typeof root.pfHead === "function" ? root.pfHead() : "";
        openPrint("Payroll register", registerHTML(run, { letterhead: letter }), true);
      };
    }
    var sl = $("#hr-pay-slips");
    if (sl) {
      sl.onclick = function () {
        var ui = currentPayUi(S);
        var run = buildRun(ui.kind, ui.from, ui.to, S);
        var saved = collectRunEdits(run);
        run.lines.forEach(function (L) {
          var e = saved[L.empId];
          if (!e) return;
          Object.keys(e).forEach(function (k) { L[k] = e[k]; });
          computeLine(L);
        });
        openPrint("Payslips", payslipsSheetHTML(run.lines, run), false);
      };
    }
    var give = $("#hr-pay-give");
    if (give) {
      give.onclick = async function () {
        var ui = currentPayUi(S);
        var run = buildRun(ui.kind, ui.from, ui.to, S);
        await setHolForPeople(
          run.lines.filter(function (L) { return L.eligible; }).map(function (L) { return L.empId; }),
          1
        );
        if (typeof root.render === "function") root.render();
      };
    }
    var give100 = $("#hr-pay-give100");
    if (give100) {
      give100.onclick = async function () {
        var ui = currentPayUi(S);
        var run = buildRun(ui.kind, ui.from, ui.to, S);
        await setHolForPeople(
          run.lines.filter(function (L) { return L.eligible; }).map(function (L) { return L.empId; }),
          2
        );
        if (typeof root.render === "function") root.render();
      };
    }
    var clr = $("#hr-pay-clear");
    if (clr) {
      clr.onclick = async function () {
        var ui = currentPayUi(S);
        var run = buildRun(ui.kind, ui.from, ui.to, S);
        await setHolForPeople(
          run.lines.map(function (L) { return L.empId; }),
          0
        );
        if (typeof root.render === "function") root.render();
      };
    }
    var holcal = $("#hr-pay-holcal");
    if (holcal) {
      holcal.onclick = function () {
        S.ui.view = "settings";
        S.ui.hrPayHol = 1;
        if (typeof root.render === "function") root.render();
        setTimeout(function () {
          var card = document.getElementById("hr-pay-holidays");
          if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth" });
        }, 40);
      };
    }
    document.querySelectorAll("[data-hr-pay-hol]").forEach(function (box) {
      box.onchange = async function () {
        var code = holValueFromInput(box);
        await setHolForPeople([box.getAttribute("data-hr-pay-hol")], code);
        if (typeof root.render === "function") root.render();
      };
    });
    document.querySelectorAll("[data-hr-pay-open]").forEach(function (b) {
      b.onclick = function () {
        if (typeof root.go === "function") root.go("employees", b.getAttribute("data-hr-pay-open"), "info");
      };
    });
    document.querySelectorAll("[data-pay-emp]").forEach(function (inp) {
      inp.addEventListener("change", function () { saveCurrentRun(); });
    });
  }

  function viewContrib() {
    var S = store();
    var q = (S.ui && S.ui.contribQ) || "";
    var list = Object.values(S.employees || {}).filter(function (e) {
      return e && !empStatusIsSeparated(e) && nameMatches(e, q);
    });
    list.sort(function (a, b) {
      return String(a.empNo || "").localeCompare(String(b.empNo || ""));
    });
    setCrumb("Contributions", "Per person, stored as a semi-monthly amount");
    var h =
      '<div class="note">These are the amounts on the employee record. Weekly payroll takes half and drops the leftover centavo. ' +
      "Company defaults are SSS 325 / PhilHealth 131.25 / Pag-IBIG 100 per semi. " +
      "<b>Fill the blanks from each rate</b> only writes empty boxes — a starting point, not the circular.</div>" +
      '<div class="row" style="margin-bottom:10px"><input id="hr-pay-cq" class="hr-att-q" type="search" placeholder="Name or number" value="' +
      esc(q) +
      '" style="min-height:40px;min-width:200px">' +
      '<button type="button" class="btn" id="hr-pay-fill">Fill the blanks from each rate</button>' +
      '<button type="button" class="btn pri" id="hr-pay-csave">Save</button></div>' +
      '<div class="card"><div class="tw"><table><thead><tr><th>Employee</th><th>Kind</th>' +
      '<th class="num">SSS / semi</th><th class="num">PHIC / semi</th><th class="num">HDMF / semi</th></tr></thead><tbody>';
    list.forEach(function (e) {
      var d = e.ded || {};
      h +=
        "<tr><td><b>" +
        esc(flipName(e.name)) +
        '</b> <span class="mono lbl">' +
        esc(e.empNo || "") +
        "</span></td><td>" +
        esc(payKindOf(e)) +
        "</td><td>" +
        moneyInput(e.id, "sss", d.sss == null ? "" : d.sss) +
        "</td><td>" +
        moneyInput(e.id, "phic", d.phic == null ? "" : d.phic) +
        "</td><td>" +
        moneyInput(e.id, "hdmf", d.hdmf == null ? "" : d.hdmf) +
        "</td></tr>";
    });
    h += "</tbody></table></div></div>";
    return h;
  }

  function wireContrib() {
    var S = store();
    var q = $("#hr-pay-cq");
    if (q) {
      q.addEventListener("change", function () {
        S.ui.contribQ = q.value;
        if (typeof root.render === "function") root.render();
      });
    }
    var fill = $("#hr-pay-fill");
    if (fill) {
      fill.onclick = function () {
        var def = companyDed(S.settings);
        document.querySelectorAll("[data-pay-emp]").forEach(function (inp) {
          if (inp.value !== "") return;
          var k = inp.getAttribute("data-pay-k");
          if (def[k] != null) inp.value = def[k];
        });
        if (root.toast) root.toast("Empty boxes filled from the company starting point — check each bracket.", "ok");
      };
    }
    var save = $("#hr-pay-csave");
    if (save) {
      save.onclick = async function () {
        var by = {};
        document.querySelectorAll("[data-pay-emp]").forEach(function (inp) {
          var id = inp.getAttribute("data-pay-emp");
          var k = inp.getAttribute("data-pay-k");
          by[id] = by[id] || {};
          by[id][k] = inp.value === "" ? "" : Number(inp.value);
        });
        var ids = Object.keys(by);
        var i;
        for (i = 0; i < ids.length; i++) {
          var e = S.employees[ids[i]];
          if (!e) continue;
          var c = JSON.parse(JSON.stringify(e));
          c.ded = Object.assign({}, c.ded || {}, by[ids[i]]);
          if (typeof root.put === "function") await root.put("employees", c.id, c);
        }
        if (root.toast) root.toast("Contributions saved", "ok");
      };
    }
  }

  function holidayCardHTML(S) {
    ensureHolidayCalendar(S.settings);
    var rows = (S.settings.holidays || [])
      .map(function (h, i) {
        return (
          "<tr><td><input data-hr-hol-d=\"" +
          i +
          '" value="' +
          esc(h.d) +
          '" placeholder="MM-DD or YYYY-MM-DD" style="min-height:40px"></td>' +
          "<td><input data-hr-hol-n=\"" +
          i +
          '" value="' +
          esc(h.n) +
          '" style="min-height:40px"></td>' +
          "<td><select data-hr-hol-t=\"" +
          i +
          '" style="min-height:40px"><option' +
          (h.t === "Regular" ? " selected" : "") +
          ">Regular</option><option" +
          (h.t === "Special" ? " selected" : "") +
          ">Special</option></select></td>" +
          '<td><button type="button" class="btn sm danger" data-hr-hol-del="' +
          i +
          '">Remove</button></td></tr>'
        );
      })
      .join("");
    return (
      '<div class="card" id="hr-pay-holidays"><div class="card-h"><h3>Company holiday calendar</h3></div>' +
      '<div class="card-b stack"><div class="note">The seven <b>fixed regular holidays</b> ship with the portal. ' +
      "Movable specials (Maundy Thursday, Eid, EDSA, and the rest) arrive by proclamation — add them here when the year\'s list is out. " +
      "Holiday premium is never granted just because a date is on this list — pick <b>+30%</b>, <b>+100%</b>, or <b>As is</b> on the day.</div>" +
      '<div class="tw"><table><thead><tr><th>Date</th><th>Name</th><th>Type</th><th></th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<div class="row"><button type="button" class="btn sm" id="hr-hol-add">Add a holiday</button>' +
      '<button type="button" class="btn pri sm" id="hr-hol-save">Save calendar</button></div></div></div>'
    );
  }

  function refreshHolidayCard() {
    var S = store();
    var card = document.getElementById("hr-pay-holidays");
    if (card) card.outerHTML = holidayCardHTML(S);
    wireHolidayCard();
  }

  function wireHolidayCard() {
    var S = store();
    var add = $("#hr-hol-add");
    if (add) {
      add.onclick = function () {
        ensureHolidayCalendar(S.settings).push({ d: "", n: "", t: "Special" });
        refreshHolidayCard();
      };
    }
    var save = $("#hr-hol-save");
    if (save) {
      save.onclick = async function () {
        var next = [];
        document.querySelectorAll("[data-hr-hol-d]").forEach(function (inp) {
          var i = +inp.getAttribute("data-hr-hol-d");
          next[i] = next[i] || {};
          next[i].d = inp.value.trim();
        });
        document.querySelectorAll("[data-hr-hol-n]").forEach(function (inp) {
          var i = +inp.getAttribute("data-hr-hol-n");
          next[i] = next[i] || {};
          next[i].n = inp.value.trim();
        });
        document.querySelectorAll("[data-hr-hol-t]").forEach(function (inp) {
          var i = +inp.getAttribute("data-hr-hol-t");
          next[i] = next[i] || {};
          next[i].t = inp.value;
        });
        S.settings.holidays = next.filter(function (h) { return h && h.d; });
        if (typeof root.putSettings === "function") await root.putSettings();
        else if (typeof root.put === "function") await root.put("meta", "settings", S.settings);
        if (root.toast) root.toast("Holiday calendar saved", "ok");
      };
    }
    document.querySelectorAll("[data-hr-hol-del]").forEach(function (b) {
      b.onclick = function () {
        var i = +b.getAttribute("data-hr-hol-del");
        S.settings.holidays.splice(i, 1);
        refreshHolidayCard();
      };
    });
  }

  function injectSettingsHolidays() {
    var view = document.getElementById("view");
    if (!view || !document.querySelector("[data-set], [data-ded]")) return;
    var S = store();
    if (!document.getElementById("hr-pay-holidays")) {
      var host = document.createElement("div");
      host.innerHTML = holidayCardHTML(S);
      view.appendChild(host.firstChild);
    }
    if (!document.querySelector(".hr-pay-ded-note")) {
      var ded = document.querySelector("[data-ded]");
      var dedCard = ded && ded.closest ? ded.closest(".card") : null;
      var dedBody = dedCard && dedCard.querySelector(".card-b");
      if (dedBody) {
        var note = document.createElement("div");
        note.className = "note hr-pay-ded-note";
        note.innerHTML =
          "These company defaults are the <b>semi-monthly</b> starting point (SSS 325 / PhilHealth 131.25 / Pag-IBIG 100). " +
          "Weekly payroll takes half and drops the leftover centavo. A person can override them on Contributions or their 201.";
        dedBody.appendChild(note);
      }
    }
    wireHolidayCard();
  }

  function injectDailyExtras() {
    var date = $("#dm-date");
    if (!date) return;
    var row = date.closest ? date.closest(".row") : date.parentNode;
    if (row && !document.getElementById("hr-pay-dprev")) {
      var prev = document.createElement("button");
      prev.type = "button";
      prev.className = "btn sm";
      prev.id = "hr-pay-dprev";
      prev.textContent = "◀";
      prev.style.minHeight = "40px";
      var next = document.createElement("button");
      next.type = "button";
      next.className = "btn sm";
      next.id = "hr-pay-dnext";
      next.textContent = "▶";
      next.style.minHeight = "40px";
      date.parentNode.insertBefore(prev, date);
      if (date.nextSibling) date.parentNode.insertBefore(next, date.nextSibling);
      else date.parentNode.appendChild(next);
      prev.onclick = function () {
        var S = store();
        S.ui.dailyDate = addDays(S.ui.dailyDate || date.value, -1);
        if (typeof root.render === "function") root.render();
      };
      next.onclick = function () {
        var S = store();
        S.ui.dailyDate = addDays(S.ui.dailyDate || date.value, 1);
        if (typeof root.render === "function") root.render();
      };
    }
    if (row && !document.getElementById("hr-pay-declare")) {
      var dec = document.createElement("button");
      dec.type = "button";
      dec.className = "btn sm";
      dec.id = "hr-pay-declare";
      dec.textContent = "Declare holiday";
      dec.style.minHeight = "40px";
      row.appendChild(dec);
      dec.onclick = function () { declareHoliday(); };
    }
    if (row && !document.getElementById("hr-pay-editor")) {
      var wrap = document.createElement("div");
      wrap.className = "f";
      wrap.style.margin = "0";
      wrap.innerHTML =
        '<label>Edited by</label><input id="hr-pay-editor" value="' +
        esc(editorName()) +
        '" placeholder="Type your name" maxlength="40" style="min-height:40px;min-width:160px">' +
        '<span class="hint">Typed name, this device\'s clock — not a signature or server time</span>';
      row.appendChild(wrap);
      var inp = wrap.querySelector("#hr-pay-editor");
      if (inp) {
        inp.addEventListener("change", function () {
          var S = store();
          S.ui.dailyEditor = String(inp.value || "").slice(0, LOG_NAME_CAP);
          var doc = payDoc(S);
          doc.editorName = S.ui.dailyEditor;
        });
      }
    }
    enhanceDailyColumns();
    injectChangeHistory();
    injectEditedPills();
  }

  function declareHoliday() {
    var S = store();
    var d = (S.ui && S.ui.dailyDate) || (typeof root.TODAY === "string" ? root.TODAY : isoDate(new Date()));
    if (typeof root.openModal !== "function") return;
    root.openModal({
      title: "Declare a holiday on " + d,
      body:
        '<div class="stack"><div class="note">Adds this ordinary day to the company calendar. Premium is still decided per person with the Hol tick — eligible is not granted.</div>' +
        '<div class="f"><label>Name</label><input id="hr-hol-name" placeholder="e.g. Special non-working day" style="min-height:40px"></div>' +
        '<div class="f"><label>Type</label><select id="hr-hol-type" style="min-height:40px"><option>Special</option><option>Regular</option></select></div></div>',
      foot:
        '<button class="btn" id="hr-hol-cancel">Cancel</button>' +
        '<button class="btn pri" id="hr-hol-go">Add to calendar</button>',
    });
    var cancel = $("#hr-hol-cancel");
    if (cancel && root.closeModal) cancel.onclick = root.closeModal;
    var go = $("#hr-hol-go");
    if (go) {
      go.onclick = async function () {
        ensureHolidayCalendar(S.settings);
        S.settings.holidays.push({
          d: d,
          n: ($("#hr-hol-name") && $("#hr-hol-name").value.trim()) || "Holiday",
          t: ($("#hr-hol-type") && $("#hr-hol-type").value) || "Special",
        });
        if (typeof root.putSettings === "function") await root.putSettings();
        else if (typeof root.put === "function") await root.put("meta", "settings", S.settings);
        if (root.closeModal) root.closeModal();
        if (root.toast) root.toast("Holiday declared — tick Hol on anyone who should receive the premium.", "ok");
        if (typeof root.render === "function") root.render();
      };
    }
  }

  function enhanceDailyColumns() {
    var tables = document.querySelectorAll("#view [data-dms]");
    if (!tables.length) return;
    var S = store();
    var rec = typeof root.dailyGet === "function"
      ? root.dailyGet((S.ui && S.ui.dailyDate) || root.TODAY)
      : (S.daily || {})[dailyId((S.ui && S.ui.dailyDate) || "")];
    document.querySelectorAll("#view .tw table").forEach(function (table) {
      if (!table.querySelector("[data-dms]")) return;
      var head = table.querySelector("thead tr");
      if (head && !head.querySelector(".hr-att-hol-h") && !head.querySelector(".hr-pay-hol-h")) {
        var th = document.createElement("th");
        th.className = "hr-att-hol-h hr-pay-hol-h";
        th.style.width = "52px";
        th.textContent = "Hol";
        th.title = "Grant holiday premium for this day. Eligible is not the same as granted.";
        var reasonH = head.querySelector("th:nth-child(7)") || head.lastElementChild;
        if (reasonH && reasonH.parentNode) reasonH.parentNode.insertBefore(th, reasonH.nextSibling);
        else head.appendChild(th);
      }
      if (head && !head.querySelector(".hr-pay-ot-h")) {
        var tho = document.createElement("th");
        tho.className = "hr-pay-ot-h";
        tho.style.width = "72px";
        tho.textContent = "OT hrs";
        var holH = head.querySelector(".hr-att-hol-h") || head.querySelector(".hr-pay-hol-h") || head.lastElementChild;
        if (holH && holH.parentNode) holH.parentNode.insertBefore(tho, holH.nextSibling);
        else head.appendChild(tho);
      }
      if (head && !head.querySelector(".hr-pay-time-h")) {
        var thi = document.createElement("th");
        thi.className = "hr-pay-time-h";
        thi.style.width = "88px";
        thi.textContent = "Time in";
        thi.title = "Required when status is Present/Late.";
        var tho2 = document.createElement("th");
        tho2.className = "hr-pay-timeout-h";
        tho2.style.width = "88px";
        tho2.textContent = "Time out";
        tho2.title = "Required when status is Undertime.";
        var statusH = head.children[5] || head.querySelector("th:nth-child(6)");
        if (statusH && statusH.parentNode) {
          statusH.parentNode.insertBefore(thi, statusH.nextSibling);
          thi.parentNode.insertBefore(tho2, thi.nextSibling);
        } else {
          head.appendChild(thi);
          head.appendChild(tho2);
        }
      }
      table.querySelectorAll("[data-dms]").forEach(function (sel) {
        var id = sel.getAttribute("data-dms");
        var tr = sel.closest("tr");
        if (!tr) return;
        var row = rec && rec.rows && rec.rows[id];
        if (!tr.querySelector('[data-dmin="' + id + '"]')) {
          var tdin = document.createElement("td");
          tdin.innerHTML =
            '<input class="hr-pay-time" type="time" data-dmin="' +
            esc(id) +
            '" value="' +
            esc((row && row.in) || "") +
            '" title="Required when status is Present/Late">';
          var statusTd = sel.closest("td");
          if (statusTd && statusTd.parentNode) statusTd.parentNode.insertBefore(tdin, statusTd.nextSibling);
          else tr.appendChild(tdin);
        }
        if (!tr.querySelector('[data-dmout="' + id + '"]')) {
          var tdout = document.createElement("td");
          tdout.innerHTML =
            '<input class="hr-pay-time" type="time" data-dmout="' +
            esc(id) +
            '" value="' +
            esc((row && row.out) || "") +
            '" title="Required when status is Undertime">';
          var inTd = tr.querySelector('[data-dmin="' + id + '"]');
          inTd = inTd && inTd.closest ? inTd.closest("td") : null;
          if (inTd && inTd.parentNode) inTd.parentNode.insertBefore(tdout, inTd.nextSibling);
          else tr.appendChild(tdout);
        }
        if (!tr.querySelector('[data-dmhol="' + id + '"]')) {
          var td = document.createElement("td");
          td.className = "hr-att-hol hr-pay-hol";
          td.innerHTML = holSelectHTML(id, "data-dmhol", holidayPremiumCode(row));
          var reasonTd = tr.querySelector("[data-dmr]")
            ? tr.querySelector("[data-dmr]").closest("td")
            : null;
          if (reasonTd && reasonTd.parentNode) reasonTd.parentNode.insertBefore(td, reasonTd.nextSibling);
          else tr.appendChild(td);
        } else {
          var existingHol = tr.querySelector('[data-dmhol="' + id + '"]');
          if (existingHol && existingHol.tagName === "INPUT" && existingHol.type === "checkbox") {
            var wrap = existingHol.parentNode;
            if (wrap) wrap.innerHTML = holSelectHTML(id, "data-dmhol", holidayPremiumCode(row));
          }
        }
        if (!tr.querySelector('[data-dmot="' + id + '"]')) {
          var tdo = document.createElement("td");
          tdo.innerHTML =
            '<input class="hr-pay-ot" type="number" step="0.25" min="0" data-dmot="' +
            esc(id) +
            '" value="' +
            esc(row && row.ot != null ? row.ot : "") +
            '" title="Overtime hours for this day">';
          var holTd = tr.querySelector("[data-dmhol]")
            ? tr.querySelector("[data-dmhol]").closest("td")
            : null;
          if (holTd && holTd.parentNode) holTd.parentNode.insertBefore(tdo, holTd.nextSibling);
          else tr.appendChild(tdo);
        }
      });
    });
  }

  function injectChangeHistory() {
    var S = store();
    var d = (S.ui && S.ui.dailyDate) || "";
    var rec = typeof root.dailyGet === "function" ? root.dailyGet(d) : (S.daily || {})[dailyId(d)];
    if (!rec || !(rec.log || []).length) return;
    if (document.getElementById("hr-pay-history")) return;
    var view = document.getElementById("view");
    if (!view) return;
    var card = document.createElement("div");
    card.id = "hr-pay-history";
    card.className = "card";
    card.style.margin = "14px 0";
    var rows = (rec.log || [])
      .slice()
      .reverse()
      .map(function (e) {
        return (
          "<tr><td class=\"mono\">" +
          esc(e.at || "") +
          "</td><td>" +
          esc(e.by || "—") +
          "</td><td class=\"hr-pay-log\">" +
          (e.firstImport ? '<span class="pill acc">first import</span> ' : "") +
          esc(logSummary(e)) +
          "</td></tr>"
        );
      })
      .join("");
    card.innerHTML =
      '<div class="card-h"><h3>Change history</h3></div><div class="card-b">' +
      '<div class="note">The name is typed, not signed. The clock is this device\'s local time (shown in Asia/Manila when the browser knows it), not a server timestamp.</div>' +
      '<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>What changed</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div></div>";
    var firstCard = view.querySelector(".card");
    if (firstCard && firstCard.parentNode) firstCard.parentNode.insertBefore(card, firstCard);
    else view.appendChild(card);
  }

  function injectEditedPills() {
    document.querySelectorAll("[data-dmopen], [data-dmview]").forEach(function (b) {
      var d = b.getAttribute("data-dmopen") || b.getAttribute("data-dmview");
      var S = store();
      var rec = typeof root.dailyGet === "function" ? root.dailyGet(d) : (S.daily || {})[dailyId(d)];
      if (!editedAfterFiling(rec)) return;
      var tr = b.closest("tr");
      if (!tr || tr.querySelector(".hr-pay-edited")) return;
      var pill = document.createElement("span");
      pill.className = "pill warn hr-pay-edited";
      pill.textContent = "edited";
      pill.title = "Attendance edited after filing";
      b.parentNode.insertBefore(pill, b);
    });
  }

  function injectAnalyticsEdits() {
    var view = document.getElementById("view");
    if (!view) return;
    if (!document.getElementById("ia-start") && !view.querySelector("[data-imonths]")) return;
    var existingEdits = document.getElementById("hr-pay-edits");
    if (existingEdits) {
      var afterAtt = document.getElementById("hr-att-summary");
      if (afterAtt && afterAtt.parentNode && existingEdits.previousSibling !== afterAtt) {
        afterAtt.parentNode.insertBefore(existingEdits, afterAtt.nextSibling);
      }
      return;
    }
    var S = store();
    var edited = Object.keys(S.daily || {})
      .map(function (id) { return S.daily[id]; })
      .filter(editedAfterFiling)
      .sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
    var host = document.createElement("div");
    host.id = "hr-pay-edits";
    var h =
      '<div class="sect-h" style="margin-top:22px"><h2>Attendance edited after filing</h2><span class="rule"></span>' +
      '<span class="lbl">' +
      edited.length +
      " report" +
      (edited.length === 1 ? "" : "s") +
      "</span></div>" +
      '<div class="note">A filed or imported report whose rows were later changed. The name on the log is typed; the clock is this device\'s.</div>';
    if (!edited.length) {
      h += '<div class="card"><div class="empty">No filed report has been edited after it was imported or sent to Drive.</div></div>';
    } else {
      h +=
        '<div class="card"><div class="tw"><table><thead><tr><th>Date</th><th>Last edit</th><th>By</th><th></th></tr></thead><tbody>' +
        edited
          .map(function (r) {
            var last = (r.log || [])[(r.log || []).length - 1] || {};
            return (
              "<tr><td class=\"mono\">" +
              esc(r.date) +
              "</td><td class=\"mono\">" +
              esc(last.at || "") +
              "</td><td>" +
              esc(last.by || "—") +
              '</td><td><button type="button" class="btn sm" data-hr-pay-openday="' +
              esc(r.date) +
              '">Open</button></td></tr>'
            );
          })
          .join("") +
        "</tbody></table></div></div>";
    }
    host.innerHTML = h;
    var att = document.getElementById("hr-att-summary");
    if (att && att.parentNode) att.parentNode.insertBefore(host, att.nextSibling);
    else view.appendChild(host);
    host.querySelectorAll("[data-hr-pay-openday]").forEach(function (b) {
      b.onclick = function () {
        S.ui.dailyDate = b.getAttribute("data-hr-pay-openday");
        goView("daily");
      };
    });
  }

  function applyHolOtFromUi(rec, prev, query) {
    rec = rec || {};
    rec.rows = rec.rows || {};
    prev = prev || {};
    query = query || (typeof document !== "undefined" && document.querySelector
      ? function (sel) { return document.querySelector(sel); }
      : function () { return null; });
    Object.keys(rec.rows).forEach(function (id) {
      var hol = query('[data-dmhol="' + id + '"]');
      var ot = query('[data-dmot="' + id + '"]');
      var old = (prev.rows || {})[id] || {};
      if (hol) rec.rows[id].hol = holValueFromInput(hol);
      else if (old.hol != null) rec.rows[id].hol = old.hol;
      var tin = query('[data-dmin="' + id + '"]');
      var tout = query('[data-dmout="' + id + '"]');
      if (tin) rec.rows[id].in = tin.value;
      else if (old.in != null) rec.rows[id].in = old.in;
      if (tout) rec.rows[id].out = tout.value;
      else if (old.out != null) rec.rows[id].out = old.out;
      if (ot) {
        var otRaw = String(ot.value == null ? "" : ot.value).trim();
        var otNum = otRaw === "" ? null : Number(otRaw);
        rec.rows[id].ot = typeof otNum === "number" && !isNaN(otNum) ? otNum : null;
      }
      else if (old.ot != null) rec.rows[id].ot = old.ot;
    });
    return rec;
  }

  function wrapDailyCollect() {
    if (typeof root.dailyCollect !== "function" || root.dailyCollect.__hrPay) return;
    var orig = root.dailyCollect;
    root.dailyCollect = function () {
      var rec = orig.apply(this, arguments);
      var prev = null;
      if (typeof root.dailyGet === "function") prev = root.dailyGet(rec && rec.date);
      else {
        var S = store();
        prev = (S.daily || {})[dailyId((rec && rec.date) || (S.ui && S.ui.dailyDate) || "")];
      }
      return applyHolOtFromUi(rec, prev);
    };
    root.dailyCollect.__hrPay = true;
  }

  function stampDailyLog(obj, id) {
    if (!obj) return obj;
    var S = store();
    var prev = (S.daily && S.daily[obj.id || id]) || null;
    if (prev === obj) prev = JSON.parse(JSON.stringify(prev));
    attachDailyLog(prev, obj, {
      by: editorName(S),
      import: !!(obj.source || obj.fromImport || obj.fixed),
      nameOf: function (empId) { return nameOfEmp(empId, S); },
    });
    return obj;
  }

  function wrapPut() {
    if (typeof root.put === "function" && !root.put.__hrPay) {
      var orig = root.put;
      root.put = function (coll, id, obj) {
        if (coll === "employees" && obj) adoptNewEmployee(obj, id);
        if (coll === "daily" && obj) stampDailyLog(obj, id);
        var out = orig.apply(this, arguments);
        if (coll === "daily" && obj) adoptDailyPeople(obj, orig);
        return out;
      };
      root.put.__hrPay = true;
    }
    if (typeof root.putMany === "function" && !root.putMany.__hrPay) {
      var origMany = root.putMany;
      root.putMany = function (coll, entries, onProgress) {
        if (coll === "daily" && entries) {
          entries.forEach(function (pair) {
            if (pair && pair[1]) stampDailyLog(pair[1], pair[0]);
          });
        }
        return origMany.apply(this, arguments);
      };
      root.putMany.__hrPay = true;
    }
  }

  function wrapAtWork() {
    if (typeof root.atWork !== "function" || root.atWork.__hrPayPeople) return;
    var orig = root.atWork;
    root.atWork = function () {
      var list = orig.apply(this, arguments) || [];
      return mergePeoplePay(list, store());
    };
    root.atWork.__hrPayPeople = true;
    root.atWork.__hrPayOrig = orig;
  }

  function wrapViewSalaries() {
    if (typeof root.viewSalaries !== "function" || root.viewSalaries.__hrPayPeople) return;
    var orig = root.viewSalaries;
    root.viewSalaries = function () {
      wrapAtWork();
      return orig.apply(this, arguments);
    };
    root.viewSalaries.__hrPayPeople = true;
  }

  function wrapDailySaveWarn() {
    if (typeof document === "undefined") return;
    var btn = document.getElementById("dm-save");
    if (!btn || btn.__hrPayWarn) return;
    btn.__hrPayWarn = true;
    var orig = btn.onclick;
    btn.onclick = async function (ev) {
      var S = store();
      var d = (S.ui && S.ui.dailyDate) || "";
      var have = typeof root.dailyGet === "function" ? root.dailyGet(d) : (S.daily || {})[dailyId(d)];
      if (!have && typeof root.askConfirm === "function") {
        var ok = await root.askConfirm(
          "No report has been filed for this day yet. Everyone still reads as Present until you change the exceptions. Save it as-is?"
        );
        if (!ok) return;
      }
      var problems = [];
      document.querySelectorAll("[data-dms]").forEach(function (sel) {
        var id = sel.getAttribute("data-dms");
        var tin = document.querySelector('[data-dmin="' + id + '"]');
        var tout = document.querySelector('[data-dmout="' + id + '"]');
        var row = {
          s: sel.value,
          in: tin ? tin.value : "",
          out: tout ? tout.value : "",
        };
        validateTimes(row).forEach(function (msg) {
          problems.push(msg);
          if (sel.value === "Present/Late" && tin) tin.className += " hr-pay-need";
          if (sel.value === "Undertime" && tout) tout.className += " hr-pay-need";
        });
      });
      if (problems.length) {
        if (root.toast) root.toast(problems[0], "err");
        return;
      }
      if (typeof orig === "function") return orig.call(this, ev);
    };
  }

  function injectEmpDed() {
    if (typeof document === "undefined") return;
    if (document.getElementById("hr-pay-empded")) return;
    var rate = document.querySelector('[data-ef="dailyRate"], [data-ef="allowance"]');
    if (!rate) return;
    var S = store();
    var e = S.employees && S.ui && S.employees[S.ui.emp];
    if (!e) return;
    var d = e.ded || {};
    var box = document.createElement("div");
    box.id = "hr-pay-empded";
    box.className = "grid3";
    box.style.marginTop = "8px";
    box.innerHTML =
      '<div class="f"><label>SSS / semi</label><input data-emp-ded="sss" type="number" step="0.01" min="0" value="' +
      esc(d.sss == null ? "" : d.sss) +
      '" style="min-height:40px"><span class="hint">Starting point for Payroll Maker. Weekly takes half.</span></div>' +
      '<div class="f"><label>PhilHealth / semi</label><input data-emp-ded="phic" type="number" step="0.01" min="0" value="' +
      esc(d.phic == null ? "" : d.phic) +
      '" style="min-height:40px"></div>' +
      '<div class="f"><label>Pag-IBIG / semi</label><input data-emp-ded="hdmf" type="number" step="0.01" min="0" value="' +
      esc(d.hdmf == null ? "" : d.hdmf) +
      '" style="min-height:40px"></div>';
    var grid = rate.closest ? rate.closest(".grid2") : rate.parentNode;
    if (grid && grid.parentNode) grid.parentNode.insertBefore(box, grid.nextSibling);
    else (rate.parentNode || document.getElementById("view")).appendChild(box);
    box.querySelectorAll("[data-emp-ded]").forEach(function (inp) {
      inp.addEventListener("change", async function () {
        var emp = store().employees[store().ui.emp];
        if (!emp) return;
        var c = JSON.parse(JSON.stringify(emp));
        c.ded = Object.assign({}, c.ded || {});
        c.ded[inp.getAttribute("data-emp-ded")] = inp.value === "" ? "" : Number(inp.value);
        store().employees[c.id] = c;
        if (typeof root.put === "function") await root.put("employees", c.id, c);
        if (root.toast) root.toast("Contribution saved", "ok");
      });
    });
  }

  function injectChrome() {
    if (typeof document === "undefined") return;
    injectStyles();
    injectNav();
    highlightNav();
    injectSettingsHolidays();
    injectEmpDed();
    injectDailyExtras();
    injectAnalyticsEdits();
    wrapDailySaveWarn();
    wrapAtWork();
    wrapViewSalaries();
    var S = store();
    var view = S.ui && S.ui.view;
    if (view === "paymaker") wirePayMaker();
    if (view === "contrib") wireContrib();
  }

  function wrapRender() {
    if (typeof root.render !== "function" || root.render.__hrPay) return;
    var orig = root.render;
    root.render = function () {
      var S = store();
      var view = S.ui && S.ui.view;
      if (view === "paymaker" || view === "contrib") {
        if (typeof root.renderNav === "function") {
          var saved = S.ui.view;
          S.ui.view = "payroll";
          root.renderNav();
          S.ui.view = saved;
        }
        var box = document.getElementById("view");
        if (box) box.innerHTML = view === "paymaker" ? viewPayMaker() : viewContrib();
        if (typeof root.setCrumb === "function") {
          /* crumbs already set inside the view builders */
        }
        try {
          injectChrome();
        } catch (e) {}
        highlightNav();
        return;
      }
      var r = orig.apply(this, arguments);
      try {
        injectChrome();
      } catch (e) {}
      return r;
    };
    root.render.__hrPay = true;
  }

  function wrapNavClicks() {
    if (typeof document === "undefined" || document.__hrPayNav) return;
    document.__hrPayNav = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      while (t && t !== document && !(t.getAttribute && t.getAttribute("data-nav"))) {
        t = t.parentNode;
      }
      if (!t || !t.getAttribute) return;
      var k = t.getAttribute("data-nav");
      if (k !== "paymaker" && k !== "contrib") return;
      ev.preventDefault();
      ev.stopPropagation();
      var S = store();
      S.ui = S.ui || {};
      S.ui.view = k;
      if (typeof root.render === "function") root.render();
    }, true);
  }

  function attach() {
    if (api.attached) return api;
    bindStore();
    wrapDailyCollect();
    wrapPut();
    wrapAtWork();
    wrapViewSalaries();
    wrapRender();
    wrapNavClicks();
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", injectChrome);
      } else {
        injectChrome();
      }
    }
    api.attached = true;
    return api;
  }

  api.install = attach;
  api.viewPayMaker = viewPayMaker;
  api.viewContrib = viewContrib;
  root.hrPayroll = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
