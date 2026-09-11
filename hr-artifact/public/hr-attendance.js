/**
 * Manpower Attendance Summary for the CorConDev HR artifact.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * One path for every count, chart and Notice to Explain: effectiveStatus /
 * absenceExcuse. Approved leave on file beats a timekeeper Absent; an LRF
 * citation on the report (including a wrapped "0123)" line, employee-scoped)
 * is the next best evidence; otherwise the absence is unexcused.
 *
 * §9 JSON paste/upload uses the same post-parse commit as a Drive scan.
 */
(function (root) {
  "use strict";

  if (root.hrAttendance && root.hrAttendance.attached) return;

  var CLOSED_STATUSES = [
    "Present",
    "Present/Late",
    "Absent",
    "Leave",
    "Leave with Pay",
    "Regular Holiday",
    "Special Holiday",
    "Half Day",
    "Rest Day",
  ];

  var DAY_STATUS_RX =
    /(Present\s*\/\s*Late|Present|Absent|Regular\s+Holiday|Special\s+Holiday|Half\s*Day|Rest\s*Day|Leave\s+with\s+Pay|Leave)/i;

  var LRF_FULL = /LRF\s*[-–]?\s*(20\d\d)\s*[-–]?\s*(\d{3,4})/i;
  var LRF_TAIL = /(?:^|[^\d-])(\d{3,4})\s*\\?\)/;

  var MONTHS_SHORT = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /* Never Date.toISOString for a day id — Cebu is UTC+8; UTC midnight names yesterday. */
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

  function manilaToday(now) {
    now = now || new Date();
    try {
      var fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      var parts = {};
      fmt.formatToParts(now).forEach(function (p) {
        if (p.type !== "literal") parts[p.type] = p.value;
      });
      if (parts.year && parts.month && parts.day) {
        return parts.year + "-" + parts.month + "-" + parts.day;
      }
    } catch (e) {}
    return isoDate(now);
  }

  function dailyId(d) {
    return "d" + String(isoDate(d) || d || "").replace(/-/g, "");
  }

  function weekdayLocal(iso) {
    var t = new Date(String(iso).slice(0, 10) + "T00:00:00");
    return t.getDay();
  }

  function normNo(v) {
    return String(v == null ? "" : v).replace(/[^0-9]/g, "");
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

  function normStatus(t) {
    var x = String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!x) return "";
    if (/present\s*\/\s*late/.test(x) || x === "late" || x === "tardy") return "Present/Late";
    if (/leave\s+with\s+pay|lw\/?p\b|paid leave/.test(x)) return "Leave with Pay";
    if (/^present/.test(x)) return "Present";
    if (/^absent/.test(x)) return "Absent";
    if (/special holiday/.test(x)) return "Special Holiday";
    if (/regular holiday|legal holiday/.test(x)) return "Regular Holiday";
    if (/half\s*day/.test(x)) return "Half Day";
    if (/rest\s*day/.test(x)) return "Rest Day";
    if (/leave/.test(x)) return "Leave";
    return "";
  }

  function dateFromReport(title, text) {
    var src = String(title || "").replace(/_/g, ".");
    var f = src.match(/(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
    if (f) return f[3] + "-" + pad2(f[1]) + "-" + pad2(f[2]);
    var h = String(text || title || "").match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
    if (h) {
      var m = MONTHS_SHORT.indexOf(h[2].toLowerCase()) + 1;
      if (m) {
        var y = h[3].length === 2 ? "20" + h[3] : h[3];
        return y + "-" + pad2(m) + "-" + pad2(h[1]);
      }
    }
    return "";
  }

  function cleanReason(t, hadStatus) {
    var x = String(t || "").replace(/\s*(Prepared by|Approved by)[\s\S]*$/i, "").trim();
    var i;
    for (i = 0; i < 6; i++) {
      var y = x
        .replace(
          /(?:\s|^)(?:[A-Z][A-Z0-9&.'\-]*(?:\s*\([^)]*\))?)(?:\s+[A-Z][A-Z0-9&.'\-]*)*\s*$/,
          ""
        )
        .trim();
      if (y === x) break;
      x = y;
    }
    if (!hadStatus) {
      var m = x.match(/(?:^|\s)([a-z][^]*)$/);
      if (m) x = m[1].trim();
    }
    return x.trim();
  }

  function parseManpower(text) {
    var flat = String(text || "").replace(/\s+/g, " ");
    var starts = [];
    var rx = /(?:^|\s)(\d{1,3})\s+(\d{4})(?=\s)/g;
    var m;
    while ((m = rx.exec(flat)) !== null) {
      starts.push({ i: m.index, no: m[2], end: rx.lastIndex });
    }
    var rows = [];
    starts.forEach(function (st, k) {
      var chunk = flat.slice(st.end, k + 1 < starts.length ? starts[k + 1].i : flat.length);
      var hit = chunk.match(DAY_STATUS_RX);
      if (hit) {
        rows.push({
          empNo: st.no,
          status: normStatus(hit[0]),
          reason: cleanReason(chunk.slice(hit.index + hit[0].length), true),
        });
      } else {
        rows.push({ empNo: st.no, status: "", reason: cleanReason(chunk, false) });
      }
    });
    return rows;
  }

  /* Artifact state is `const S` — a global lexical binding, not window.S. */
  function bindArtifactStore() {
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

  function employeesMap(S) {
    if (S && S.employees && Object.keys(S.employees).length) return S.employees;
    if (typeof root.empList === "function") {
      var map = {};
      root.empList().forEach(function (e) {
        if (e && e.id) map[e.id] = e;
      });
      if (Object.keys(map).length) return map;
    }
    return (S && S.employees) || {};
  }

  function defaultCtx(extra) {
    var S = bindArtifactStore();
    var ctx = {
      daily: (S && S.daily) || {},
      leaves: (S && S.leaves) || {},
      employees: employeesMap(S),
      today: (typeof root.TODAY === "string" && root.TODAY) || manilaToday(),
      put: typeof root.put === "function" ? root.put : null,
    };
    if (extra) Object.keys(extra).forEach(function (k) { ctx[k] = extra[k]; });
    return ctx;
  }

  function leaveCovers(empId, date, ctx) {
    if (!empId || !date) return null;
    ctx = ctx || defaultCtx();
    var ls = ctx.leaves || {};
    var k;
    for (k in ls) {
      if (!Object.prototype.hasOwnProperty.call(ls, k)) continue;
      var l = ls[k];
      if (!l || l.empId !== empId) continue;
      if (l.status !== "Approved" && l.status !== "Availed") continue;
      if (!l.from) continue;
      if (date >= l.from && date <= (l.to || l.from)) return l;
    }
    return null;
  }

  function reportSaysApproved(text) {
    return /approved\s*leave/i.test(String(text || ""));
  }

  function reportSaysNotFiled(text) {
    return /\(\s*not\s+filed\s*\)/i.test(String(text || ""));
  }

  function dailyFingerprint(daily) {
    var keys = Object.keys(daily || {});
    var bits = 0;
    keys.forEach(function (id) {
      var rec = daily[id] || {};
      var rows = rec.rows || {};
      Object.keys(rows).forEach(function (empId) {
        bits += 1 + String((rows[empId] || {}).r || "").length;
      });
    });
    return keys.length + ":" + bits;
  }

  function buildLrfIndex(ctx) {
    ctx = ctx || defaultCtx();
    var years = {};
    var approved = {};
    Object.keys(ctx.daily || {}).forEach(function (id) {
      var rec = ctx.daily[id];
      Object.keys((rec && rec.rows) || {}).forEach(function (empId) {
        var txt = String(((rec.rows || {})[empId] || {}).r || "");
        var m = LRF_FULL.exec(txt);
        if (!m) return;
        var seq = String(parseInt(m[2], 10));
        years[seq] = m[1];
        if (reportSaysApproved(txt)) approved[empId + "|" + seq] = m[1] + "-" + m[2];
      });
    });
    return { years: years, approved: approved, fp: dailyFingerprint(ctx.daily) };
  }

  var LRF_CACHE = null;
  function lrfIndex(ctx) {
    ctx = ctx || defaultCtx();
    var fp = dailyFingerprint(ctx.daily);
    if (LRF_CACHE && LRF_CACHE.fp === fp) return LRF_CACHE;
    LRF_CACHE = buildLrfIndex(ctx);
    return LRF_CACHE;
  }

  function invalidateLrf() {
    LRF_CACHE = null;
  }

  function citedLeaveRef(text, ctx) {
    var t = String(text || "");
    var m = LRF_FULL.exec(t);
    if (m) return { year: m[1], seq: m[2], no: "LRF" + m[1] + "-" + m[2], exact: true };
    m = LRF_TAIL.exec(t);
    if (m) {
      var seq = m[1];
      var y = lrfIndex(ctx).years[String(parseInt(seq, 10))];
      return { year: y || "", seq: seq, no: y ? "LRF" + y + "-" + seq : "LRF????-" + seq, exact: false };
    }
    return null;
  }

  function sameLeaveNo(a, b) {
    var norm = function (x) {
      return String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    };
    return norm(a) === norm(b);
  }

  function leaveIsPaid(leave, ctx) {
    if (!leave) return false;
    if (leave.pay === 1 || leave.pay === true) return true;
    var types = (root.LEAVE_TYPES || []);
    var hit = types.find ? types.find(function (t) { return t.k === leave.type; }) : null;
    if (hit) return !!hit.pay;
    if (leave.type === "LWOP") return false;
    if (leave.type) return true;
    return false;
  }

  function absenceExcuse(empId, date, reason, ctx) {
    ctx = ctx || defaultCtx();
    var l = leaveCovers(empId, date, ctx);
    if (l) {
      return {
        kind: "register",
        leave: l,
        no: l.no || "",
        label: "approved leave on file",
        paid: leaveIsPaid(l, ctx),
      };
    }
    var ref = citedLeaveRef(reason, ctx);
    if (!ref) return null;
    var saysSo =
      reportSaysApproved(reason) ||
      !!lrfIndex(ctx).approved[empId + "|" + String(parseInt(ref.seq, 10))];
    if (!saysSo) return null;
    var rec = null;
    Object.keys(ctx.leaves || {}).some(function (k) {
      var x = ctx.leaves[k];
      if (x && x.no && sameLeaveNo(x.no, ref.no)) {
        rec = x;
        return true;
      }
      return false;
    });
    if (rec && (rec.status === "Approved" || rec.status === "Availed")) {
      return {
        kind: "register",
        leave: rec,
        no: rec.no,
        label: "approved leave on file",
        paid: leaveIsPaid(rec, ctx),
      };
    }
    return {
      kind: "report",
      ref: ref,
      no: ref.no,
      record: rec || null,
      wrapped: !reportSaysApproved(reason),
      paid: false,
      label: rec
        ? "the report cites " + ref.no + ", and that leave is still " + (rec.status || "unapproved")
        : "the report says approved leave " + ref.no + " — not yet in the leave register",
    };
  }

  function effectiveStatus(empId, date, raw, reason, ctx) {
    ctx = ctx || defaultCtx();
    if (raw === "Leave with Pay") return "Leave with Pay";
    if (raw !== "Absent") return raw;
    var excuse = absenceExcuse(empId, date, reason, ctx);
    if (!excuse) return raw;
    if (excuse.kind === "register" && excuse.paid) return "Leave with Pay";
    return "Leave";
  }

  function dayCredit(status, row, empId, date, ctx) {
    var st = status;
    if (row && (empId || date)) {
      st = effectiveStatus(empId, date, row.s || row.status || status, row.r || row.reason, ctx);
    }
    if (st === "Present" || st === "Present/Late") return 1;
    if (st === "Leave with Pay") return 1;
    if (st === "Regular Holiday") return 1;
    if (st === "Half Day") return 0.5;
    if (st === "Leave" || st === "Absent" || st === "Rest Day" || st === "Special Holiday") return 0;
    return 0;
  }

  function holEligible(status) {
    return status === "Regular Holiday" || status === "Special Holiday";
  }

  /* Attendance day field wins. Payroll must not write this. */
  function dayVal(row, empId, date, ctx) {
    if (row && row.day != null && row.day !== "") {
      var n = Number(row.day);
      if (!isNaN(n)) return n;
    }
    return dayCredit(row && (row.s || row.status), row, empId, date, ctx);
  }

  function holidayGranted(row) {
    return !!(row && row.hol);
  }

  function dailyCoverage(year, ctx) {
    ctx = ctx || defaultCtx();
    var y = Number(year) || Number(String(ctx.today || manilaToday()).slice(0, 4));
    var have = {};
    Object.keys(ctx.daily || {}).forEach(function (id) {
      var d = isoDate((ctx.daily[id] || {}).date);
      if (d) have[d] = true;
    });
    var today = isoDate(ctx.today || manilaToday());
    var out = [];
    var m;
    for (m = 1; m <= 12; m++) {
      var last = new Date(y, m, 0).getDate();
      var days = [];
      var missing = [];
      var filed = 0;
      var d;
      for (d = 1; d <= last; d++) {
        var iso = y + "-" + pad2(m) + "-" + pad2(d);
        if (today && iso > today) break;
        if (weekdayLocal(iso) === 0) continue;
        days.push(iso);
        if (have[iso]) filed++;
        else missing.push(iso);
      }
      if (!days.length) continue;
      var pct = Math.round((filed / days.length) * 100);
      out.push({
        month: y + "-" + pad2(m),
        workdays: days.length,
        filed: filed,
        missing: missing,
        pct: pct,
        thin: pct < 80,
      });
    }
    return out;
  }

  function coverageForMonths(months, ctx) {
    ctx = ctx || defaultCtx();
    months = months || [];
    var years = {};
    months.forEach(function (k) {
      years[String(k).slice(0, 4)] = true;
    });
    var cov = {};
    Object.keys(years).forEach(function (y) {
      dailyCoverage(y, ctx).forEach(function (c) {
        cov[c.month] = c;
      });
    });
    var workdays = 0;
    var filed = 0;
    months.forEach(function (k) {
      var c = cov[k];
      if (!c) return;
      workdays += c.workdays;
      filed += c.filed;
    });
    var pct = workdays ? Math.round((filed / workdays) * 100) : 0;
    return { workdays: workdays, filed: filed, pct: pct, thin: workdays > 0 && pct < 80, byMonth: cov };
  }

  function monthKey(d) {
    return String(d || "").slice(0, 7);
  }

  function blankPerson() {
    return {
      present: 0,
      late: 0,
      absent: 0,
      leave: 0,
      holiday: 0,
      restDay: 0,
      halfDay: 0,
      other: 0,
      excused: 0,
      otHours: 0,
      premiumDays: 0,
      dayCredit: 0,
      holEligible: 0,
      dates: { present: [], late: [], absent: [], leave: [], holiday: [], premium: [] },
    };
  }

  function tallyRow(empId, rec, row, ctx, t) {
    t = t || blankPerson();
    var raw = (row && (row.s || row.status)) || "";
    var reason = (row && (row.r || row.reason)) || "";
    var st = effectiveStatus(empId, rec.date, raw, reason, ctx);
    var excuse = raw === "Absent" ? absenceExcuse(empId, rec.date, reason, ctx) : null;
    if (st === "Present") {
      t.present++;
      t.dates.present.push(rec.date);
    } else if (st === "Present/Late") {
      t.present++;
      t.late++;
      t.dates.present.push(rec.date);
      t.dates.late.push(rec.date);
    } else if (st === "Absent") {
      t.absent++;
      t.dates.absent.push(rec.date);
    } else if (st === "Leave" || st === "Leave with Pay") {
      t.leave++;
      t.dates.leave.push(rec.date);
      if (raw === "Absent") t.excused++;
    } else if (st === "Regular Holiday" || st === "Special Holiday") {
      t.holiday++;
      t.dates.holiday.push(rec.date);
    } else if (st === "Rest Day") t.restDay++;
    else if (st === "Half Day") {
      t.halfDay++;
      t.present++;
    } else if (st) t.other++;
    t.otHours += Number((row && row.ot) || 0) || 0;
    t.dayCredit += dayVal(row, empId, rec.date, ctx);
    if (holEligible(st) || holEligible(raw)) t.holEligible++;
    if (holidayGranted(row)) {
      t.premiumDays++;
      t.dates.premium.push(rec.date);
    }
    return t;
  }

  function personSummaries(months, ctx) {
    ctx = ctx || defaultCtx();
    var keep = months && months.length ? (function () {
      var s = {};
      months.forEach(function (k) { s[k] = true; });
      return s;
    })() : null;
    var tally = {};
    Object.keys(ctx.daily || {}).forEach(function (id) {
      var rec = ctx.daily[id];
      if (!rec || !rec.date) return;
      if (keep && !keep[monthKey(rec.date)]) return;
      Object.keys(rec.rows || {}).forEach(function (empId) {
        var t = (tally[empId] = tally[empId] || blankPerson());
        tallyRow(empId, rec, rec.rows[empId], ctx, t);
      });
    });
    return Object.keys(tally)
      .map(function (empId) {
        var e = (ctx.employees || {})[empId] || { id: empId, name: empId, empNo: "" };
        return Object.assign({ e: e, empId: empId }, tally[empId]);
      })
      .sort(function (a, b) {
        var an = normNo(a.e.empNo);
        var bn = normNo(b.e.empNo);
        if (an && bn && an !== bn) return an.localeCompare(bn);
        return String(a.e.name || "").localeCompare(String(b.e.name || ""));
      });
  }

  function dailyTallyFromEffective(rec, ctx) {
    ctx = ctx || defaultCtx();
    var t = { present: 0, late: 0, absent: 0, leave: 0, holiday: 0, other: 0 };
    Object.keys((rec && rec.rows) || {}).forEach(function (empId) {
      var row = rec.rows[empId] || {};
      var st = effectiveStatus(empId, rec.date, row.s, row.r, ctx);
      if (st === "Present") t.present++;
      else if (st === "Present/Late") {
        t.present++;
        t.late++;
      } else if (st === "Absent") t.absent++;
      else if (st === "Leave" || st === "Leave with Pay") t.leave++;
      else if (st === "Regular Holiday" || st === "Special Holiday") t.holiday++;
      else t.other++;
    });
    return t;
  }

  var ATT_RULES_DEFAULT = {
    lateReminder: 3,
    lateNTE: 5,
    absentNTE: 1,
    absentSerious: 3,
    awolRun: 3,
    companyShare: 0.3,
  };

  function longestRun(dates, allDates) {
    var set = {};
    (dates || []).forEach(function (d) { set[d] = 1; });
    var best = 0;
    var run = 0;
    var bestEnd = "";
    (allDates || []).forEach(function (d) {
      if (set[d]) {
        run++;
        if (run > best) {
          best = run;
          bestEnd = d;
        }
      } else run = 0;
    });
    return { len: best, endedOn: bestEnd };
  }

  function noticeStrands(empId, months, ctx, rules) {
    ctx = ctx || defaultCtx();
    rules = Object.assign({}, ATT_RULES_DEFAULT, rules || {});
    var keep = months && months.length ? (function () {
      var s = {};
      months.forEach(function (k) { s[k] = true; });
      return s;
    })() : null;
    var lates = [];
    var absents = [];
    var allDates = [];
    Object.keys(ctx.daily || {}).forEach(function (id) {
      var rec = ctx.daily[id];
      if (!rec || !rec.date) return;
      if (keep && !keep[monthKey(rec.date)]) return;
      var row = (rec.rows || {})[empId];
      if (!row) return;
      allDates.push(rec.date);
      var st = effectiveStatus(empId, rec.date, row.s, row.r, ctx);
      if (st === "Present/Late") lates.push(rec.date);
      if (st === "Absent") absents.push(rec.date);
    });
    allDates.sort();
    absents.sort();
    lates.sort();
    var run = longestRun(absents, allDates);
    var acts = [];
    if (run.len >= rules.awolRun) {
      acts.push({ key: "awol", doc: "NTE", cat: "awol", strand: "absence" });
    } else if (absents.length >= rules.absentSerious) {
      acts.push({ key: "absent-many", doc: "NTE", cat: "awol", strand: "absence" });
    } else if (absents.length >= rules.absentNTE) {
      acts.push({ key: "absent", doc: "NTE", cat: "awol", strand: "absence" });
    }
    if (lates.length >= rules.lateNTE) {
      acts.push({ key: "late-many", doc: "NTE", cat: "tardy", strand: "lateness" });
    } else if (lates.length >= rules.lateReminder) {
      acts.push({ key: "late", doc: "MEMO", cat: "tardy", strand: "lateness" });
    }
    return { lates: lates, absents: absents, run: run, acts: acts };
  }

  function dailyBlank(d, ctx) {
    ctx = ctx || defaultCtx();
    if (typeof root.dailyBlank === "function") return root.dailyBlank(d);
    return {
      id: dailyId(d),
      date: isoDate(d),
      rows: {},
      omit: [],
      extra: [],
      preparedBy: "",
      approvedBy: "",
      source: "",
      driveLink: "",
    };
  }

  function employeeByNo(ctx) {
    var byNo = {};
    Object.keys(ctx.employees || {}).forEach(function (id) {
      var e = ctx.employees[id];
      var n = normNo(e && e.empNo);
      if (n) byNo[n] = e;
    });
    return byNo;
  }

  function mergeDayRow(prev, incoming, emp) {
    prev = prev || {};
    incoming = incoming || {};
    var next = {
      s: incoming.status || incoming.s || prev.s || "Present",
      r: incoming.reason != null ? incoming.reason : incoming.r != null ? incoming.r : prev.r || "",
      site: incoming.site || prev.site || (emp && emp.project) || "ADMINS",
    };
    if (incoming.in != null) next.in = incoming.in;
    else if (prev.in != null) next.in = prev.in;
    if (incoming.out != null) next.out = incoming.out;
    else if (prev.out != null) next.out = prev.out;
    if (incoming.ot != null) next.ot = incoming.ot;
    else if (prev.ot != null) next.ot = prev.ot;
    /* Payroll must not invent a day credit. Keep the attendance field. */
    if (incoming.day != null && incoming.day !== "" && incoming.fromPayroll !== true) {
      next.day = incoming.day;
    } else if (prev.day != null) next.day = prev.day;
    if (incoming.hol != null) next.hol = !!incoming.hol;
    else if (prev.hol != null) next.hol = prev.hol;
    return next;
  }

  function commitDailyFromParsed(day, ctx) {
    ctx = ctx || defaultCtx();
    var date = isoDate(day.date || dateFromReport(day.source || "", ""));
    if (!date) return { rec: null, used: 0, unknown: {}, merged: false, error: "no date" };
    var id = dailyId(date);
    var existing = (ctx.daily || {})[id] || null;
    var rec = existing
      ? JSON.parse(JSON.stringify(existing))
      : dailyBlank(date, ctx);
    rec.id = id;
    rec.date = date;
    rec.fixed = true;
    rec.rows = rec.rows || {};
    if (day.preparedBy) rec.preparedBy = day.preparedBy;
    if (day.approvedBy) rec.approvedBy = day.approvedBy;
    if (day.source) rec.source = day.source;
    if (day.driveLink != null) rec.driveLink = day.driveLink;
    var byNo = employeeByNo(ctx);
    var used = 0;
    var unknown = {};
    var warnings = [];
    (day.rows || []).forEach(function (r) {
      var no = normNo(r.empNo);
      var e = byNo[no];
      if (!e) {
        unknown[r.empNo || no || "?"] = (unknown[r.empNo || no || "?"] || 0) + 1;
        return;
      }
      var status = normStatus(r.status || r.s);
      if ((r.status || r.s) && !status) {
        warnings.push(no + ": status “" + (r.status || r.s) + "” is not on the closed list");
      }
      rec.rows[e.id] = mergeDayRow(rec.rows[e.id], {
        status: status || (r.status ? "" : "Present"),
        reason: r.reason != null ? r.reason : r.r,
        site: r.site,
        in: r.in,
        out: r.out,
        ot: r.ot,
        day: r.day,
        hol: r.hol,
        fromPayroll: r.fromPayroll,
      }, e);
      used++;
    });
    if (ctx.daily) ctx.daily[id] = rec;
    return { rec: rec, used: used, unknown: unknown, merged: !!existing, warnings: warnings };
  }

  function normalizeImportPayload(payload) {
    var data = payload;
    if (typeof data === "string") {
      var trimmed = data.replace(/^\uFEFF/, "").trim();
      if (!trimmed) throw new Error("Nothing to import.");
      try {
        data = JSON.parse(trimmed);
      } catch (e) {
        throw new Error("That is not valid JSON.");
      }
    }
    if (data && !Array.isArray(data) && Array.isArray(data.days)) data = data.days;
    if (data && !Array.isArray(data) && data.date && data.rows) data = [data];
    if (!Array.isArray(data)) throw new Error("Paste an array of daily reports.");
    return data.map(function (day, i) {
      if (!day || typeof day !== "object") throw new Error("Item " + (i + 1) + " is not a report object.");
      var date = isoDate(day.date) || dateFromReport(day.source || "", "");
      if (!date) throw new Error("Item " + (i + 1) + " has no date.");
      var rows = Array.isArray(day.rows) ? day.rows : [];
      return {
        date: date,
        preparedBy: day.preparedBy || "",
        approvedBy: day.approvedBy || "",
        source: day.source || "",
        driveLink: day.driveLink || "",
        rows: rows.map(function (r) {
          return {
            empNo: String((r && r.empNo) || ""),
            status: (r && (r.status || r.s)) || "",
            reason: (r && (r.reason != null ? r.reason : r.r)) || "",
            site: (r && r.site) || "",
            in: r && r.in,
            out: r && r.out,
            ot: r && r.ot,
            day: r && r.day,
            hol: r && r.hol,
          };
        }),
      };
    });
  }

  async function importAttendanceJson(payload, ctx) {
    ctx = ctx || defaultCtx();
    var days = normalizeImportPayload(payload);
    var stats = {
      days: 0,
      rows: 0,
      unknown: {},
      errors: [],
      warnings: [],
      merged: 0,
    };
    var i;
    for (i = 0; i < days.length; i++) {
      var result = commitDailyFromParsed(days[i], ctx);
      if (result.error) {
        stats.errors.push(days[i].date + " (" + result.error + ")");
        continue;
      }
      if (result.warnings && result.warnings.length) {
        stats.warnings = stats.warnings.concat(result.warnings);
      }
      if (!result.used) {
        stats.errors.push(days[i].date + " (no employee matched — check the 201 numbers)");
        Object.keys(result.unknown).forEach(function (n) {
          stats.unknown[n] = (stats.unknown[n] || 0) + result.unknown[n];
        });
        continue;
      }
      if (ctx.put) await ctx.put("daily", result.rec.id, result.rec);
      else ctx.daily[result.rec.id] = result.rec;
      stats.days++;
      stats.rows += result.used;
      if (result.merged) stats.merged++;
      Object.keys(result.unknown).forEach(function (n) {
        stats.unknown[n] = (stats.unknown[n] || 0) + result.unknown[n];
      });
    }
    invalidateLrf();
    return stats;
  }

  /* Payroll period rows live in `periods`. They must never write DayRow.day. */
  function applyPayrollDaysToAttendance() {
    return { written: 0, blocked: true };
  }

  function payrollMustNotOverride(row, payrollDays) {
    var before = row && row.day;
    var next = mergeDayRow(row, { day: payrollDays, fromPayroll: true });
    return next.day === before;
  }

  var api = {
    CLOSED_STATUSES: CLOSED_STATUSES,
    DAY_STATUS_RX: DAY_STATUS_RX,
    isoDate: isoDate,
    manilaToday: manilaToday,
    dailyId: dailyId,
    normNo: normNo,
    normStatus: normStatus,
    dateFromReport: dateFromReport,
    cleanReason: cleanReason,
    parseManpower: parseManpower,
    leaveCovers: leaveCovers,
    citedLeaveRef: citedLeaveRef,
    reportSaysApproved: reportSaysApproved,
    reportSaysNotFiled: reportSaysNotFiled,
    absenceExcuse: absenceExcuse,
    effectiveStatus: effectiveStatus,
    dayCredit: dayCredit,
    holEligible: holEligible,
    dayVal: dayVal,
    holidayGranted: holidayGranted,
    dailyCoverage: dailyCoverage,
    coverageForMonths: coverageForMonths,
    personSummaries: personSummaries,
    dailyTallyFromEffective: dailyTallyFromEffective,
    noticeStrands: noticeStrands,
    commitDailyFromParsed: commitDailyFromParsed,
    normalizeImportPayload: normalizeImportPayload,
    importAttendanceJson: importAttendanceJson,
    applyPayrollDaysToAttendance: applyPayrollDaysToAttendance,
    payrollMustNotOverride: payrollMustNotOverride,
    nameMatches: nameMatches,
    flipName: flipName,
    invalidateLrf: invalidateLrf,
    lrfIndex: lrfIndex,
    attached: false,
  };

  /* ---------- browser chrome ---------- */

  function $(sel, rootEl) {
    if (root.$ && !rootEl) return root.$(sel);
    return (rootEl || document).querySelector(sel);
  }

  function esc(s) {
    if (root.esc) return root.esc(s);
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function injectStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById("hr-attendance-styles")) return;
    var style = document.createElement("style");
    style.id = "hr-attendance-styles";
    style.textContent =
      ".hr-att-hol{width:44px;min-height:40px;display:inline-flex;align-items:center;justify-content:center}" +
      ".hr-att-hol input{width:20px;height:20px}" +
      ".hr-att-paste textarea{min-height:220px;font-family:var(--f-mono,ui-monospace,monospace);font-size:12px}" +
      ".hr-att-q{min-height:40px;min-width:180px}" +
      ".hr-att-door .btn{min-height:40px}" +
      "@media (max-width:980px){.hr-att-door .btn,.hr-att-hol{min-height:44px}}";
    (document.head || document.documentElement).appendChild(style);
  }

  function monthLabel(k) {
    if (root.monthLabel) return root.monthLabel(k);
    if (!k) return "";
    var parts = String(k).split("-");
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return (names[(+parts[1]) - 1] || parts[1]) + " " + parts[0];
  }

  function insightMonths() {
    var S = root.S || {};
    var ui = S.ui || {};
    if (ui.insightMonth) return [ui.insightMonth];
    if (typeof root.lastMonths === "function") return root.lastMonths(ui.insightMonths || 6);
    return [];
  }

  function openPasteDoor() {
    if (typeof root.openModal !== "function") return;
    var sample =
      '[\n  { "date": "2026-08-29",\n    "preparedBy": "Timekeeper", "approvedBy": "PIC", "source": "08.29.2026.pdf",\n    "rows": [\n      { "empNo": "1250", "status": "Present", "reason": "", "site": "CTU BARILI" },\n      { "empNo": "1348", "status": "Absent", "reason": "Approved Leave (LRF2026 - 0123)", "site": "ADMINS" },\n      { "empNo": "1353", "status": "Present/Late", "reason": "traffic", "site": "TAWASON" }\n    ] }\n]';
    root.openModal({
      title: "Paste manpower rows from Claude",
      wide: true,
      body:
        '<div class="stack hr-att-paste">' +
        '<div class="note">Claude reads the daily PDF more accurately than Drive OCR. Paste the JSON array here, or upload the file. ' +
        "Rows match on the <b>four-digit employee number</b> only. Status is normalised to the closed list. " +
        "Days already in the portal are <b>merged</b> — existing in/out/OT/day/hol ticks are kept unless the JSON sets them. " +
        "Payroll figures never overwrite an attendance day field.</div>" +
        '<div class="f"><label>JSON array</label>' +
        '<textarea id="hr-att-json" placeholder="' +
        esc(sample).replace(/"/g, "&quot;") +
        '"></textarea>' +
        '<span class="hint">Same shape the Drive importer produces after it parses a scan.</span></div>' +
        '<div class="row hr-att-door">' +
        '<label class="btn sm" style="cursor:pointer">Upload a .json file' +
        '<input id="hr-att-file" type="file" accept=".json,application/json" hidden></label>' +
        '<span class="lbl" id="hr-att-fname"></span></div>' +
        '<div id="hr-att-prev"></div></div>',
      foot:
        '<button class="btn" id="hr-att-cancel">Cancel</button>' +
        '<button class="btn" id="hr-att-check">Check</button>' +
        '<button class="btn pri" id="hr-att-go">Import</button>',
    });
    var ta = $("#hr-att-json");
    var file = $("#hr-att-file");
    var prev = $("#hr-att-prev");
    var preview = function () {
      try {
        var days = normalizeImportPayload(ta.value);
        var ctx = defaultCtx();
        var byNo = employeeByNo(ctx);
        var rows = 0;
        var matched = 0;
        var unknown = {};
        days.forEach(function (d) {
          (d.rows || []).forEach(function (r) {
            rows++;
            if (byNo[normNo(r.empNo)]) matched++;
            else unknown[r.empNo || "?"] = (unknown[r.empNo || "?"] || 0) + 1;
          });
        });
        var unk = Object.keys(unknown);
        prev.innerHTML =
          '<div class="note"><b>' +
          days.length +
          " day(s)</b> · " +
          rows +
          " row(s) · " +
          matched +
          " matched to a 201" +
          (unk.length
            ? ' · <span style="color:var(--crit)">' +
              unk.length +
              " unmatched: " +
              esc(unk.slice(0, 12).join(", ")) +
              "</span>"
            : "") +
          "</div>";
        return days;
      } catch (e) {
        prev.innerHTML =
          '<div class="note" style="border-left-color:var(--crit)"><b>' +
          esc(e.message || e) +
          "</b></div>";
        return null;
      }
    };
    $("#hr-att-cancel").onclick = root.closeModal;
    $("#hr-att-check").onclick = preview;
    if (ta) ta.addEventListener("blur", preview);
    if (file) {
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        if (!f) return;
        var name = $("#hr-att-fname");
        if (name) name.textContent = f.name;
        var reader = new FileReader();
        reader.onload = function () {
          ta.value = String(reader.result || "");
          preview();
        };
        reader.readAsText(f);
      });
    }
    $("#hr-att-go").onclick = async function () {
      var days = preview();
      if (!days) {
        if (root.toast) root.toast("Nothing to import.", "err");
        return;
      }
      try {
        var stats = await importAttendanceJson(days, defaultCtx());
        if (root.closeModal) root.closeModal();
        if (typeof root.attendanceImportReport === "function") {
          root.attendanceImportReport(
            {
              days: stats.days,
              rows: stats.rows,
              unknown: stats.unknown,
              unread: stats.errors,
              skipped: 0,
              files: stats.days,
            },
            false
          );
        } else {
          if (root.toast) {
            root.toast(
              stats.days + " day(s) imported · " + stats.rows + " row(s)",
              "ok"
            );
          }
          if (root.render) root.render();
        }
      } catch (e) {
        if (root.toast) root.toast(e.message || String(e), "err");
      }
    };
  }

  function addButton(host, id, label, primary) {
    if (!host || host.querySelector("#" + id)) return null;
    var b = document.createElement("button");
    b.className = "btn" + (primary ? " pri" : "") + " sm";
    b.id = id;
    b.type = "button";
    b.textContent = label;
    host.appendChild(b);
    b.onclick = function (ev) {
      ev.preventDefault();
      openPasteDoor();
    };
    return b;
  }

  function injectDailyButton() {
    var date = $("#dm-date");
    if (!date) return;
    var row = date.closest ? date.closest(".row") : date.parentNode;
    if (!row) return;
    addButton(row, "hr-att-paste-daily", "Paste Claude JSON");
  }

  function injectInsightsButton() {
    var start = $("#ia-start");
    if (start && start.parentNode) {
      addButton(start.parentNode, "hr-att-paste-insights", "Paste Claude JSON");
    }
    var attImp = $("#imp-period");
    if (attImp && attImp.parentNode) {
      addButton(attImp.parentNode, "hr-att-paste-period", "Paste manpower JSON");
    }
  }

  function drillKind(kind, empId, months) {
    var o = { kind: kind, empId: empId, months: months };
    if (typeof root.attendanceDrill === "function" && (kind === "late" || kind === "absent" || kind === "leave")) {
      root.attendanceDrill(o);
      return;
    }
    openCountDrill(o);
  }

  function openCountDrill(o) {
    var ctx = defaultCtx();
    var rows = [];
    Object.keys(ctx.daily || {}).forEach(function (id) {
      var rec = ctx.daily[id];
      if (!rec || !rec.date) return;
      if (o.months && o.months.indexOf(monthKey(rec.date)) < 0) return;
      Object.keys(rec.rows || {}).forEach(function (empId) {
        if (o.empId && empId !== o.empId) return;
        var r = rec.rows[empId];
        var st = effectiveStatus(empId, rec.date, r.s, r.r, ctx);
        var want = o.kind;
        var keep =
          (want === "present" && (st === "Present" || st === "Present/Late" || st === "Half Day")) ||
          (want === "late" && st === "Present/Late") ||
          (want === "absent" && st === "Absent") ||
          (want === "leave" && (st === "Leave" || st === "Leave with Pay")) ||
          (want === "holiday" && (st === "Regular Holiday" || st === "Special Holiday")) ||
          (want === "premium" && holidayGranted(r)) ||
          (want === "ot" && Number(r.ot) > 0);
        if (!keep) return;
        var e = ctx.employees[empId] || {};
        rows.push({
          date: rec.date,
          name: e.name || "",
          empNo: e.empNo || "",
          status: st,
          reason: r.r || "",
          site: r.site || e.project || "",
          link: rec.driveLink || "",
          source: rec.source || "",
          hol: holidayGranted(r),
          ot: r.ot,
        });
      });
    });
    rows.sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });
    var titles = {
      present: "Present days",
      late: "Lates",
      absent: "Absences",
      leave: "Days on leave",
      holiday: "Holiday days",
      premium: "Holiday premium granted",
      ot: "Overtime",
    };
    var e = o.empId ? (ctx.employees[o.empId] || null) : null;
    var h =
      '<div class="stack"><div class="note">Counted through the same leave rule as the tally. Open the scan to check the sheet.</div>';
    if (rows.length) {
      h +=
        '<div class="tw" style="max-height:56vh;overflow:auto"><table><thead><tr>' +
        '<th style="width:104px">Date</th>' +
        (e ? "" : "<th>Employee</th>") +
        '<th style="width:110px">Status</th><th>Reason</th><th style="width:118px">Area</th>' +
        '<th style="width:44px"></th></tr></thead><tbody>' +
        rows
          .map(function (r) {
            return (
              "<tr><td class=\"mono\">" +
              esc(r.date) +
              "</td>" +
              (e
                ? ""
                : '<td class="nm">' +
                  esc(flipName(r.name)) +
                  ' <span class="mono lbl">' +
                  esc(r.empNo) +
                  "</span></td>") +
              "<td>" +
              esc(r.status) +
              (r.hol ? ' <span class="pill acc">hol</span>' : "") +
              "</td>" +
              '<td style="font-size:11.5px;color:var(--ink2)">' +
              (r.reason ? esc(r.reason) : '<span class="lbl">none written</span>') +
              "</td>" +
              "<td>" +
              esc(r.site || "—") +
              "</td>" +
              "<td>" +
              (r.link
                ? '<a class="btn sm" href="' +
                  esc(r.link) +
                  '" target="_blank" rel="noopener noreferrer" title="' +
                  esc(r.source || "Open the report") +
                  '">Scan</a>'
                : '<span class="lbl">—</span>') +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>";
    } else {
      h += '<div class="empty">Nothing recorded for this yet.</div>';
    }
    h += "</div>";
    if (typeof root.openModal === "function") {
      root.openModal({
        title: (titles[o.kind] || "Days") + (e ? " — " + flipName(e.name) : ""),
        wide: true,
        body: h,
        foot: '<button class="btn pri" id="hr-att-drill-close">Close</button>',
      });
      var c = $("#hr-att-drill-close");
      if (c) c.onclick = root.closeModal;
    }
  }

  function countBtn(n, sev, kind, empId, months) {
    if (!n) return "0";
    return (
      '<button type="button" class="pill ' +
      sev +
      ' drill hr-att-count" data-hr-att-kind="' +
      esc(kind) +
      '" data-hr-att-emp="' +
      esc(empId) +
      '" data-hr-att-months="' +
      esc(JSON.stringify(months || [])) +
      '" title="Show the days behind this figure">' +
      n +
      "</button>"
    );
  }

  function injectInsightsSummary() {
    var view = document.getElementById("view");
    if (!view) return;
    if (!document.getElementById("ia-start") && !view.querySelector("[data-imonths]")) return;
    if (document.getElementById("hr-att-summary")) return;
    var months = insightMonths();
    var ctx = defaultCtx();
    var people = personSummaries(months, ctx);
    var cov = coverageForMonths(months, ctx);
    var host = document.createElement("div");
    host.id = "hr-att-summary";
    var q = ((root.S && root.S.ui && root.S.ui.attQ) || "");
    var shown = people.filter(function (x) { return nameMatches(x.e, q); });
    var h =
      '<div class="sect-h" style="margin-top:22px"><h2>Manpower attendance summary</h2><span class="rule"></span>' +
      '<span class="lbl">' +
      people.length +
      " people on the reports</span></div>";
    h +=
      '<div class="note" style="margin-bottom:10px' +
      (cov.thin ? ";border-left-color:var(--warn)" : "") +
      '">Days filed <b>' +
      cov.filed +
      " of " +
      cov.workdays +
      "</b> working days (Sundays out)" +
      (cov.thin
        ? " — <b>under 80%</b>, so treat a low late or absence count as thin filing, not a good month."
        : ".") +
      " Late is a full day of credit. Holiday premium is <b>eligible, not granted</b> until HR ticks Hol on the daily report. " +
      "Approved leave beats a timekeeper Absent in every figure below.</div>";
    h +=
      '<div class="row" style="margin-bottom:8px"><input class="hr-att-q" id="hr-att-q" type="search" placeholder="Name or number — either order" value="' +
      esc(q) +
      '">' +
      (shown.length !== people.length
        ? '<span class="lbl">' + shown.length + " shown</span>"
        : "") +
      "</div>";
    if (!people.length) {
      h +=
        '<div class="card"><div class="empty">No daily manpower reports in this window yet. Paste Claude JSON or read the filed scans.</div></div>';
    } else {
      h +=
        '<div class="card"><div class="tw"><table><thead><tr>' +
        "<th>Employee</th><th style=\"width:120px\">Area</th>" +
        '<th style="width:72px">Present</th><th style="width:64px">Late</th>' +
        '<th style="width:80px">Absent</th><th style="width:80px">Leave</th>' +
        '<th style="width:80px">Holiday</th><th style="width:64px">OT hrs</th>' +
        '<th style="width:72px">Premium</th><th style="width:64px">Days</th>' +
        "</tr></thead><tbody>" +
        shown
          .map(function (x) {
            return (
              "<tr><td><b>" +
              esc(flipName(x.e.name)) +
              '</b> <span class="mono lbl">' +
              esc(x.e.empNo || "") +
              "</span></td>" +
              '<td style="font-size:11.5px">' +
              esc(x.e.project || "—") +
              "</td>" +
              '<td class="mono">' +
              countBtn(x.present, "ok", "present", x.empId, months) +
              "</td>" +
              '<td class="mono">' +
              countBtn(x.late, "warn", "late", x.empId, months) +
              "</td>" +
              '<td class="mono">' +
              countBtn(x.absent, "crit", "absent", x.empId, months) +
              "</td>" +
              '<td class="mono">' +
              countBtn(x.leave, "mut", "leave", x.empId, months) +
              "</td>" +
              '<td class="mono">' +
              countBtn(x.holiday, "acc", "holiday", x.empId, months) +
              "</td>" +
              '<td class="mono">' +
              (x.otHours ? countBtn(x.otHours, "acc", "ot", x.empId, months) : "0") +
              "</td>" +
              '<td class="mono">' +
              countBtn(x.premiumDays, "acc", "premium", x.empId, months) +
              "</td>" +
              '<td class="mono">' +
              (Math.round(x.dayCredit * 10) / 10) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div></div>";
    }
    host.innerHTML = h;
    var monthHead = null;
    view.querySelectorAll(".sect-h h2").forEach(function (el) {
      if (/Month by month/i.test(el.textContent || "")) monthHead = el.closest(".sect-h");
    });
    var afterMonth = monthHead && monthHead.nextElementSibling;
    if (afterMonth && afterMonth.parentNode) {
      afterMonth.insertAdjacentElement("afterend", host);
    } else if (monthHead && monthHead.parentNode) {
      monthHead.parentNode.insertBefore(host, monthHead.nextSibling);
    } else {
      view.appendChild(host);
    }
    var qEl = host.querySelector("#hr-att-q");
    if (qEl) {
      qEl.addEventListener("input", function () {
        if (root.S && root.S.ui) root.S.ui.attQ = qEl.value;
        var wrap = document.getElementById("hr-att-summary");
        if (wrap) wrap.remove();
        injectInsightsSummary();
        var again = document.getElementById("hr-att-q");
        if (again) {
          again.focus();
          var len = again.value.length;
          if (again.setSelectionRange) again.setSelectionRange(len, len);
        }
      });
    }
    host.querySelectorAll("[data-hr-att-kind]").forEach(function (b) {
      b.addEventListener("click", function () {
        var months2 = [];
        try {
          months2 = JSON.parse(b.getAttribute("data-hr-att-months") || "[]");
        } catch (e) {}
        drillKind(b.getAttribute("data-hr-att-kind"), b.getAttribute("data-hr-att-emp"), months2);
      });
    });
  }

  function injectAttendanceNote() {
    var imp = $("#imp-period");
    if (!imp) return;
    var view = document.getElementById("view");
    if (!view || view.querySelector("#hr-att-pay-note")) return;
    var crumb = document.getElementById("crumb");
    var label = crumb ? crumb.textContent || "" : "";
    if (!/Attendance|Payroll/i.test(label) && !(root.S && root.S.ui && (root.S.ui.view === "attendance" || root.S.ui.view === "payroll"))) {
      return;
    }
    var note = document.createElement("div");
    note.id = "hr-att-pay-note";
    note.className = "note";
    note.style.margin = "0 0 14px";
    note.innerHTML =
      "The <b>manpower attendance summary</b> is counted from the daily reports (HR Analytics), not from this payroll paste. " +
      "Importing a period never overwrites a day credit or holiday tick on those reports. " +
      '<button type="button" class="btn sm" id="hr-att-goto-insights">Open the summary</button>';
    var row = imp.closest ? imp.closest(".row") : imp.parentNode;
    if (row && row.parentNode) row.parentNode.insertBefore(note, row.nextSibling);
    else view.insertBefore(note, view.firstChild);
    var go = note.querySelector("#hr-att-goto-insights");
    if (go) {
      go.onclick = function () {
        if (typeof root.go === "function") root.go("insights");
        else if (root.S && root.S.ui) {
          root.S.ui.view = "insights";
          if (root.render) root.render();
        }
      };
    }
  }

  function enhanceDailyHolColumn() {
    var tables = document.querySelectorAll("#view [data-dms]");
    if (!tables.length) return;
    var firstTable = tables[0].closest("table");
    if (!firstTable) return;
    document.querySelectorAll("#view .tw table").forEach(function (table) {
      if (!table.querySelector("[data-dms]")) return;
      var head = table.querySelector("thead tr");
      if (head && !head.querySelector(".hr-att-hol-h")) {
        var th = document.createElement("th");
        th.className = "hr-att-hol-h";
        th.style.width = "52px";
        th.textContent = "Hol";
        th.title = "Grant holiday premium for this day. Eligible is not the same as granted.";
        var reasonH = head.querySelector("th:nth-child(7)") || head.lastElementChild;
        if (reasonH && reasonH.parentNode) reasonH.parentNode.insertBefore(th, reasonH.nextSibling);
        else head.appendChild(th);
      }
      table.querySelectorAll("[data-dms]").forEach(function (sel) {
        var id = sel.getAttribute("data-dms");
        var tr = sel.closest("tr");
        if (!tr || tr.querySelector('[data-dmhol="' + id + '"]')) return;
        CLOSED_STATUSES.forEach(function (st) {
          var exists = false;
          var i;
          for (i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === st || sel.options[i].text === st) exists = true;
          }
          if (!exists) {
            var opt = document.createElement("option");
            opt.value = st;
            opt.textContent = st;
            sel.appendChild(opt);
          }
        });
        var rec = typeof root.dailyGet === "function" ? root.dailyGet((root.S && root.S.ui && root.S.ui.dailyDate) || root.TODAY) : null;
        var row = rec && rec.rows && rec.rows[id];
        var td = document.createElement("td");
        td.className = "hr-att-hol";
        td.innerHTML =
          '<input type="checkbox" data-dmhol="' +
          esc(id) +
          '" title="Grant holiday premium"' +
          (row && row.hol ? " checked" : "") +
          ">";
        var reasonTd = tr.querySelector("[data-dmr]") ? tr.querySelector("[data-dmr]").closest("td") : null;
        if (reasonTd && reasonTd.parentNode) reasonTd.parentNode.insertBefore(td, reasonTd.nextSibling);
        else tr.appendChild(td);
      });
    });
  }

  function wrapDailyCollect() {
    if (typeof root.dailyCollect !== "function" || root.dailyCollect.__hrAtt) return;
    var orig = root.dailyCollect;
    root.dailyCollect = function () {
      var rec = orig.apply(this, arguments);
      rec.rows = rec.rows || {};
      var prev = null;
      if (typeof root.dailyGet === "function") {
        prev = root.dailyGet(rec.date);
      }
      Object.keys(rec.rows).forEach(function (id) {
        var old = (prev && prev.rows && prev.rows[id]) || {};
        rec.rows[id] = mergeDayRow(old, {
          status: rec.rows[id].s,
          reason: rec.rows[id].r,
          site: rec.rows[id].site,
        });
        var hol = document.querySelector('[data-dmhol="' + id + '"]');
        if (hol) rec.rows[id].hol = !!hol.checked;
      });
      return rec;
    };
    root.dailyCollect.__hrAtt = true;
  }

  function wrapArtifact() {
    if (typeof root.normStatus === "function") {
      root.normStatus = function (t) {
        return normStatus(t);
      };
    }
    if (typeof root.dateFromReport === "function") {
      root.dateFromReport = function (title, text) {
        return dateFromReport(title, text);
      };
    }
    if (typeof root.effectiveStatus === "function") {
      root.effectiveStatus = function (empId, date, raw, reason) {
        return effectiveStatus(empId, date, raw, reason, defaultCtx());
      };
    }
    if (typeof root.absenceExcuse === "function") {
      root.absenceExcuse = function (empId, date, reason) {
        return absenceExcuse(empId, date, reason, defaultCtx());
      };
    }
    if (typeof root.lrfIndex === "function") {
      root.lrfIndex = function () {
        return lrfIndex(defaultCtx());
      };
    }
    if (typeof root.parseManpower === "function") {
      root.parseManpower = function (text) {
        return parseManpower(text);
      };
    }
    if (typeof root.dailyTally === "function") {
      var origTally = root.dailyTally;
      root.dailyTally = function (rec) {
        if (rec && rec.fixed) return dailyTallyFromEffective(rec, defaultCtx());
        return origTally(rec);
      };
    }
    wrapDailyCollect();
    if (typeof root.put === "function" && !root.put.__hrAtt) {
      var origPut = root.put;
      root.put = function (coll, id, obj) {
        if (coll === "daily") invalidateLrf();
        if (coll === "daily" && obj && obj.rows) {
          Object.keys(obj.rows).forEach(function (empId) {
            var row = obj.rows[empId];
            if (row && row.fromPayroll) delete row.day;
          });
        }
        return origPut.apply(this, arguments);
      };
      root.put.__hrAtt = true;
    }
  }

  function injectChrome() {
    if (typeof document === "undefined") return;
    injectStyles();
    injectDailyButton();
    injectInsightsButton();
    injectInsightsSummary();
    injectAttendanceNote();
    enhanceDailyHolColumn();
  }

  function attach() {
    if (api.attached) return api;
    bindArtifactStore();
    wrapArtifact();
    if (typeof root.render === "function" && !root.render.__hrAtt) {
      var origRender = root.render;
      root.render = function () {
        var r = origRender.apply(this, arguments);
        try {
          injectChrome();
        } catch (e) {}
        return r;
      };
      root.render.__hrAtt = true;
    }
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", injectChrome);
      } else {
        injectChrome();
      }
    }
    api.attached = true;
    api.openPasteDoor = openPasteDoor;
    return api;
  }

  api.install = attach;
  api.openPasteDoor = openPasteDoor;
  root.hrAttendance = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
