/**
 * Company payroll sheet for the CorConDev HR portal.
 * Extends the in-page engine (payLine / payTotals). Does not replace it.
 *
 * Weekly: Thursday–Wednesday. Semi-monthly: cut off on the 12th and the 27th.
 * OT pay is 100% of daily/8. The approved-form gate stays in otPaidHours
 * and is skipped while settings.otFormGateWaived is on. Late is ₱1 per minute after the 8:15 / 1:15
 * grace, counted from 8:00 or 1:00. Undertime over an hour on a full day is
 * the hourly rate times the nearest hour. Net is ROUNDUP to the peso.
 */
(function (root) {
  "use strict";

  if (root.hrPaySheet && root.hrPaySheet.version) return;

  var WEEKLY_SITES = [
    "CTU BARILI (VET MED)",
    "CTU BARILI DORM P2",
    "CTU DUMANJUG P3",
    "24HH0142 Labangon Chapel (Package B)",
    "26HH0078 Tagbao FMR P3",
    "UP SHE SHELTER",
    "TAWASON",
    "DANAO GUINACOT RD."
  ];
  var DOW = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];
  var SIGN_PREP = "Catherine A. Largo";
  var SIGN_PREP_ROLE = "SAFETY OFFICER";
  var SIGN_APPR = "Jeffrey James M. Corro";
  var SIGN_APPR_ROLE = "CEO";
  var SITE_PAIRS = 16;

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function isoDate(v) {
    if (v == null || v === "") return "";
    var s = String(v);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    return "";
  }

  function addDays(d, n) {
    var t = new Date(isoDate(d) + "T00:00:00");
    if (isNaN(t.getTime())) return "";
    t.setDate(t.getDate() + n);
    return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate());
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

  function weekday(iso) {
    return new Date(isoDate(iso) + "T00:00:00").getDay();
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100 + 1e-9) / 100;
  }

  function pesoCeil(n) {
    return Math.ceil((Number(n) || 0) - 1e-9);
  }

  function weeklyHalf(full) {
    return Math.floor((Number(full) || 0) / 2 * 100) / 100;
  }

  function num(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function xml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Minutes from midnight, seconds dropped. "8:23 am", "13:25:00", datetimes. */
  function clockMinutes(raw) {
    if (raw == null || raw === "") return null;
    if (raw instanceof Date && !isNaN(raw.getTime())) return raw.getHours() * 60 + raw.getMinutes();
    var s = String(raw).trim().toLowerCase().replace(/\./g, "");
    if (!s || s === "leave" || s === "absent" || s === "leave with pay" || s === "rest day") return null;
    var m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (!m) return null;
    var h = Number(m[1]);
    var mi = Number(m[2]);
    var ap = "";
    if (/\bpm\b/.test(s)) ap = "pm";
    else if (/\bam\b/.test(s)) ap = "am";
    if (ap === "am" && h === 12) h = 0;
    else if (ap === "pm" && h < 12) h += 12;
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  /* A written reason that is not marked "(not excused)" is an excuse.
     A blank reason is not an excuse — the time itself is what the sheet uses. */
  function lateExcused(row) {
    var r = String((row && (row.r || row.reason)) || "").trim();
    if (!r) return false;
    return !/\(not excused\)/i.test(r);
  }

  function rowCredit(row) {
    if (!row) return 0;
    if (row.day != null && String(row.day).trim() !== "" && !isNaN(Number(row.day))) return Number(row.day);
    return 0;
  }

  /**
   * Late and undertime for one day.
   * Morning: time in after 8:15 counts minutes from 8:00 at ₱1.
   * Afternoon: time in after 1:15 counts minutes from 1:00 at ₱1.
   * Undertime: a full day (credit >= 1) leaving before 5:00.
   *   60 minutes or less at ₱1; more than that, nearest hour × hourly rounded to centavos.
   */
  function lateForRow(row, daily) {
    var out = { minutes: 0, amount: 0, parts: [] };
    if (!row || lateExcused(row)) return out;
    var inn = clockMinutes(row.in != null ? row.in : row.timeIn);
    var tout = clockMinutes(row.out != null ? row.out : row.timeOut);
    var credit = rowCredit(row);
    var hourly = round2((Number(daily) || 0) / 8);
    if (inn != null && inn > 8 * 60 + 15 && inn < 12 * 60) {
      var m = inn - 8 * 60;
      out.minutes += m;
      out.amount += m;
      out.parts.push({ kind: "late", minutes: m, amount: m });
    }
    if (inn != null && inn > 13 * 60 + 15) {
      var pm = inn - 13 * 60;
      out.minutes += pm;
      out.amount += pm;
      out.parts.push({ kind: "late-pm", minutes: pm, amount: pm });
    }
    if (tout != null && credit >= 1 && tout > 12 * 60 && tout < 17 * 60) {
      var um = 17 * 60 - tout;
      if (um <= 60) {
        out.minutes += um;
        out.amount += um;
        out.parts.push({ kind: "undertime", minutes: um, amount: um });
      } else {
        var hrs = Math.round(um / 60);
        var peso = hrs ? round2(hourly * hrs) : 0;
        out.amount += peso;
        out.parts.push({ kind: "undertime-hour", minutes: um, hours: hrs, amount: peso });
      }
    }
    out.amount = round2(out.amount);
    return out;
  }

  function lateForRows(rows, daily) {
    var minutes = 0;
    var amount = 0;
    var parts = [];
    (rows || []).forEach(function (row) {
      var one = lateForRow(row, daily);
      minutes += one.minutes;
      amount += one.amount;
      one.parts.forEach(function (p) {
        p.date = row.date || "";
        parts.push(p);
      });
    });
    return { minutes: minutes, amount: round2(amount), parts: parts };
  }

  function weekSkipsGov(kind, period) {
    if (kind !== "weekly" || !period) return false;
    return eachDate(period.from, period.to).some(function (d) {
      return Number(d.slice(8, 10)) === 27;
    });
  }

  function explicitDed(emp, key) {
    var d = emp && emp.ded;
    if (!d || d[key] == null || d[key] === "") return null;
    var n = Number(d[key]);
    return isNaN(n) ? 0 : n;
  }

  /* Full semi-monthly figure, then half on a weekly run. A week that contains
     the 27th pays none (the week of that cutoff). Explicit 0 stays 0.
     govEnroll false stays 0. A blank 201 falls back to settings when enroll
     was never set — the same fallback the 201 screen already uses. */
  /* Contributions start at 3 months of service (HR 2026-10-27):
     dateHired + 3 months on or before the cutoff end. */
  function tenureOk(emp, period) {
    var h = String((emp && emp.dateHired) || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h) || !period || !period.to) return true;
    var t = new Date(h + "T00:00:00");
    var day = t.getDate();
    t.setMonth(t.getMonth() + 3);
    if (t.getDate() < day) t.setDate(0);
    var start = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    return String(period.to).slice(0, 10) >= start;
  }

  function statutoryOf(emp, kind, period, settings) {
    if (weekSkipsGov(kind, period)) {
      return { sss: 0, phic: 0, hdmf: 0, rule: "skip-week-27" };
    }
    if (!tenureOk(emp, period)) {
      return { sss: 0, phic: 0, hdmf: 0, rule: "under-3-months" };
    }
    var def = (settings && settings.ded) || { sss: 325, phic: 131.25, hdmf: 100 };
    var enroll = emp && emp.govEnroll;
    function one(key) {
      if (enroll && typeof enroll === "object" && Object.prototype.hasOwnProperty.call(enroll, key) && !enroll[key]) {
        return 0;
      }
      var own = explicitDed(emp, key);
      if (own != null) return own;
      if (emp && emp.govDeductionRefused) return 0;
      var n = Number(def[key]);
      return isNaN(n) ? 0 : n;
    }
    var full = { sss: one("sss"), phic: one("phic"), hdmf: one("hdmf") };
    if (kind === "weekly") {
      return {
        sss: weeklyHalf(full.sss),
        phic: weeklyHalf(full.phic),
        hdmf: weeklyHalf(full.hdmf),
        rule: "weekly-half"
      };
    }
    return { sss: full.sss, phic: full.phic, hdmf: full.hdmf, rule: "semi" };
  }

  function periodAllowance(emp) {
    var monthly = String((emp && emp.rateType) || "").toLowerCase() === "monthly"
      || String((emp && emp.payType) || "").toLowerCase().indexOf("semi") === 0;
    var a = Number(emp && emp.allowance) || 0;
    return monthly ? a / 2 : 0;
  }

  function priceLine(input) {
    var L = input || {};
    var daily = Number(L.daily) || 0;
    var hourly = L.hourly != null ? Number(L.hourly) : daily / 8;
    var otX = L.otMultiplier != null ? Number(L.otMultiplier) : 1;
    var days = Number(L.days) || 0;
    var ot = Number(L.ot) || 0;
    var hol = Number(L.hol) || 0;
    var basic = L.basic != null ? Number(L.basic) : days * daily;
    var otPay = L.otPay != null ? Number(L.otPay) : ot * hourly * otX;
    var holPay = L.holPay != null ? Number(L.holPay) : hol * daily;
    var allowance = Number(L.allowance) || 0;
    var addl = Number(L.addl != null ? L.addl : L.incentive) || 0;
    var late = Number(L.late) || 0;
    var ca = Number(L.ca) || 0;
    var uniform = Number(L.uniform) || 0;
    var sssLoan = Number(L.sssLoan) || 0;
    var hdmfLoan = Number(L.hdmfLoan) || 0;
    var sss = Number(L.sss) || 0;
    var phic = Number(L.phic) || 0;
    var hdmf = Number(L.hdmf) || 0;
    var gross = basic + otPay + holPay + allowance + addl;
    var ded = late + ca + uniform + sssLoan + hdmfLoan + sss + phic + hdmf;
    return {
      daily: daily,
      hourly: hourly,
      days: days,
      ot: ot,
      hol: hol,
      basic: basic,
      otPay: otPay,
      holPay: holPay,
      allowance: allowance,
      addl: addl,
      gross: gross,
      late: late,
      ca: ca,
      uniform: uniform,
      sssLoan: sssLoan,
      hdmfLoan: hdmfLoan,
      sss: sss,
      phic: phic,
      hdmf: hdmf,
      ded: ded,
      net: pesoCeil(gross - ded)
    };
  }

  function ccdId(emp) {
    if (!emp) return "";
    var own = String(emp.employeeId || "").trim();
    if (own) return own;
    var no = String(emp.empNo || "").replace(/\D/g, "");
    return no ? "CCD" + no : "";
  }

  function payKindOf(emp) {
    var p = String((emp && emp.payType) || "").toLowerCase();
    if (p === "weekly" || p === "week") return "weekly";
    if (p === "semi" || p === "semi-monthly" || p === "semimonthly") return "semi";
    return String((emp && emp.rateType) || "").toLowerCase() === "monthly" ? "semi" : "weekly";
  }

  function rateOn(emp, date) {
    var monthly = String((emp && emp.rateType) || "").toLowerCase() === "monthly";
    var list = (emp && emp.rates) || [];
    var best = null;
    var day = isoDate(date);
    list.forEach(function (r) {
      if (!r) return;
      var from = isoDate(r.from) || "0000-00-00";
      if (day && from > day) return;
      if (!best || from >= (isoDate(best.from) || "0000-00-00")) best = r;
    });
    var amount = best ? Number(best.rate) || 0 : Number(emp && emp.dailyRate) || 0;
    var type = best && best.rateType ? String(best.rateType) : (emp && emp.rateType) || "";
    var isMonthly = String(type).toLowerCase() === "monthly" || (!best && monthly);
    var daily = isMonthly ? amount / 26 : amount;
    return {
      daily: daily,
      hourly: daily / 8,
      monthly: isMonthly,
      amount: amount,
      from: best ? (isoDate(best.from) || "") : "",
      entry: best || null
    };
  }

  function recurTake(emp, key) {
    var bag = emp && emp.recur && emp.recur[key];
    if (!bag) return { amount: 0, balanceBefore: 0, balanceAfter: 0 };
    var amount = Number(bag.amount) || 0;
    var bal = bag.balance == null || bag.balance === "" ? amount : Number(bag.balance);
    if (!(bal > 0) || !(amount > 0)) return { amount: 0, balanceBefore: bal || 0, balanceAfter: bal || 0 };
    var take = Math.min(amount, bal);
    return {
      amount: round2(take),
      balanceBefore: round2(bal),
      balanceAfter: round2(bal - take)
    };
  }

  function leaveDayCredit(empId, date) {
    var S = root.S;
    if (!S || !S.leaves) return 1;
    if (typeof root.dailyLeaveCovering !== "function") return 1;
    var l = root.dailyLeaveCovering(empId, date);
    if (!l) return 0;
    if (typeof root.leaveRecordPays === "function" && !root.leaveRecordPays(l)) return 0;
    var st = String(l.status || "");
    if (st !== "Approved" && st !== "Availed") return 0;
    return 1;
  }

  function dailyId(date) {
    return "d" + String(isoDate(date) || "").replace(/-/g, "");
  }

  function pushSrc(list, row) {
    list.push({
      run: row.run || "",
      empId: row.empId || "",
      name: row.name || "",
      date: row.date || "",
      item: row.item || "",
      qty: row.qty != null ? row.qty : "",
      amount: row.amount != null ? round2(row.amount) : "",
      source_collection: row.source_collection || "",
      source_id: row.source_id || "",
      form_url: row.form_url || "",
      balance_after: row.balance_after != null && row.balance_after !== "" ? row.balance_after : "",
      exception: row.exception || ""
    });
  }

  function knownSite(ctx, name) {
    var site = String(name || "").trim();
    if (!site) return true;
    if (/^admins?$/i.test(site)) return true;
    var projects = ctx && ctx.projects;
    if (!projects || !Object.keys(projects).length) return true;
    var key = site.toLowerCase();
    var ok = false;
    Object.keys(projects).forEach(function (id) {
      var p = projects[id];
      if (p && String(p.name || "").trim().toLowerCase() === key) ok = true;
    });
    return ok;
  }

  /**
   * Adjust a payLine result and attach src[] / exceptions[].
   * Saved overrides (lateTouched, caTouched, statTouched, *Touched) win.
   */
  function decorateLine(L, ctx) {
    if (!L) return L;
    ctx = ctx || {};
    var emp = ctx.emp || {};
    var kind = ctx.kind || "weekly";
    var per = ctx.per || {};
    var saved = ctx.saved || {};
    var runId = ctx.runId || (kind + "|" + (per.from || ""));
    L.employeeId = ccdId(emp);
    L.payType = emp.payType || (payKindOf(emp) === "semi" ? "Semi-monthly" : "Weekly");
    L.bankAcct = emp.bankAcct || L.bankAcct || "";

    var rates = emp.rates || [];
    if (rates.length && (L.rows || []).length) {
      var dailies = {};
      var basic = 0;
      var otPay = 0;
      var holPay = 0;
      (L.rows || []).forEach(function (row) {
        var rate = rateOn(emp, row.date);
        row.daily = rate.daily;
        row.hourly = rate.hourly;
        row.rateFrom = rate.from;
        dailies[String(rate.daily)] = 1;
        basic += (Number(row.day) || 0) * rate.daily;
        var otX = ctx.otMultiplier != null ? Number(ctx.otMultiplier) : 1;
        otPay += (Number(row.ot) || 0) * rate.hourly * otX;
        holPay += (Number(row.holRate) || 0) * rate.daily;
      });
      if (Object.keys(dailies).length > 1) {
        L.rateSplit = true;
        L.basic = basic;
        L.otPay = otPay;
        L.holPay = holPay;
      }
      var last = rateOn(emp, (L.rows[L.rows.length - 1] || {}).date || per.to);
      L.daily = last.daily;
      L.hourly = last.hourly;
      L.monthly = !!last.monthly;
      if (last.monthly) L.monthlyAmount = last.amount;
      L.basis = last.monthly ? "monthly " + last.amount + " ÷ 26" : "daily rate";
    }

    if (!saved.lateTouched) {
      var keepSavedLate = saved.late != null && saved.late !== "" && Number(saved.late) !== 0;
      if (!keepSavedLate) {
        var late = lateForRows(L.rows || [], L.daily);
        L.late = late.amount;
        L.lateMin = late.minutes;
        L.lateParts = late.parts;
      }
    }

    if (kind === "semi" && (saved.allowance == null || saved.allowance === "")) {
      L.allowance = periodAllowance(emp);
    }

    if (!saved.statTouched && weekSkipsGov(kind, per)) {
      L.sss = 0;
      L.phic = 0;
      L.hdmf = 0;
      L.govSkip = "skip-week-27";
    }
    if (!saved.statTouched && emp.govEnroll && typeof emp.govEnroll === "object") {
      ["sss", "phic", "hdmf"].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(emp.govEnroll, k) && !emp.govEnroll[k]) L[k] = 0;
      });
    }

    if (!saved.uniformTouched) {
      var uni = recurTake(emp, "uniform");
      if (uni.amount) L.uniform = uni.amount;
      L.uniformRecur = uni;
    }
    if (!saved.sssLoanTouched) {
      var sl = recurTake(emp, "sssLoan");
      if (sl.amount) L.sssLoan = sl.amount;
      L.sssLoanRecur = sl;
    }
    if (!saved.hdmfLoanTouched) {
      var hl = recurTake(emp, "hdmfLoan");
      if (hl.amount) L.hdmfLoan = hl.amount;
      L.hdmfLoanRecur = hl;
    }

    var src = [];
    var exceptions = [];
    function ex(code, text, date) {
      exceptions.push({ code: code, text: text, date: date || "", empId: L.empId || emp.id || "" });
    }

    (L.rows || []).forEach(function (row) {
      var date = row.date || "";
      var dailyRate = row.daily != null ? Number(row.daily) : Number(L.daily) || 0;
      var hourly = dailyRate / 8;
      if ((Number(row.day) || 0) > 0 || row.s) {
        pushSrc(src, {
          run: runId, empId: L.empId, name: L.name, date: date, item: "day",
          qty: Number(row.day) || 0, amount: (Number(row.day) || 0) * dailyRate,
          source_collection: "daily", source_id: dailyId(date)
        });
      }
      if (String(row.s || "") === "Absent" || String(row.s || "") === "Present/Late") {
        pushSrc(src, {
          run: runId, empId: L.empId, name: L.name, date: date,
          item: String(row.s) === "Absent" ? "absence" : "late",
          qty: row.lateMin || "", amount: "",
          source_collection: "daily", source_id: dailyId(date)
        });
      }
      if (String(row.s || "") === "Leave with Pay") {
        var leave = typeof ctx.leaveCover === "function" ? ctx.leaveCover(L.empId, date) : null;
        var pays = !leave ? false : (typeof ctx.leavePays !== "function" || ctx.leavePays(leave));
        var approved = leave && (leave.status === "Approved" || leave.status === "Availed") && pays;
        pushSrc(src, {
          run: runId, empId: L.empId, name: L.name, date: date, item: "leave",
          qty: approved ? 1 : 0, amount: approved ? dailyRate : 0,
          source_collection: "leaves", source_id: leave ? (leave.id || "") : "",
          exception: approved ? "" : "Leave with Pay with no approved leave"
        });
        if (!approved) ex("leave-unapproved", "Leave with Pay on " + date + " has no approved leave.", date);
      }
      var ot = Number(row.ot) || 0;
      var logged = Number(row.otLogged != null ? row.otLogged : row.otRaw != null ? row.otRaw : ot) || ot;
      if (logged > 0 || ot > 0) {
        var rep = null;
        if (ctx && typeof ctx.reportFor === "function") {
          try { rep = ctx.reportFor(L.empId, date, row.site || ""); } catch (eRep) { rep = null; }
        }
        var confirmed = !!(rep && rep.confirmed);
        pushSrc(src, {
          run: runId, empId: L.empId, name: L.name, date: date, item: "OT",
          qty: ot > 0 ? ot : logged, amount: ot > 0 ? ot * hourly : 0,
          source_collection: confirmed ? "otreps" : "daily",
          source_id: confirmed && rep.id ? rep.id : dailyId(date),
          form_url: (rep && rep.proofUrl) || "",
          exception: ot > 0 && !confirmed ? "OT with no Morning Report" : ""
        });
        if (ot > 0 && !confirmed) ex("ot-no-report", "OT on " + date + " has no Morning Report confirming the hours. Payroll still pays Daily Manpower OT.", date);
        var signedPeriod = ctx && ctx.per && typeof otSignedCopyApplies === "function" && otSignedCopyApplies(ctx.per.to);
        if (signedPeriod && rep && rep.needsSignedCopy && (ot > 0 || logged > 0)) {
          ex("ot-signed-copy", "OT on " + date + " is on a Morning Report. It counts for this payroll period after the signed copy is uploaded.", date);
        }
      }
      if (row.site && !knownSite(ctx, row.site)) {
        ex("unknown-site", "Site “" + row.site + "” is not on the project list.", date);
        pushSrc(src, {
          run: runId, empId: L.empId, name: L.name, date: date, item: "site",
          qty: "", amount: "", source_collection: "projects", source_id: "",
          exception: "Unknown site"
        });
      }
      var sep = isoDate(ctx.separatedOn || emp.separatedOn || "");
      if (sep && date && date > sep && ((Number(row.day) || 0) > 0 || ot > 0)) {
        ex("separated", "Pay on " + date + " is after the last day " + sep + ".", date);
      }
    });

    if (!(Number(L.daily) > 0) && ((Number(L.days) || 0) > 0 || (Number(L.ot) || 0) > 0)) {
      ex("rate-missing", "No rate in force, so this attendance cannot be priced.");
    }
    if ((emp.status && /separat|resign/i.test(String(emp.status))) && ((Number(L.days) || 0) > 0 || (Number(L.ot) || 0) > 0)) {
      var sepStatusOn = isoDate(ctx.separatedOn || emp.separatedOn || "");
      if (sepStatusOn && sepStatusOn < (per.from || "")) {
        ex("separated", "This run pays " + (L.name || "this person") + " and the last day was " + sepStatusOn + ".");
      } else if (!sepStatusOn) {
        ex("separated", "This run pays " + (L.name || "this person") + " and the 201 status is " + emp.status + " with no last day.");
      }
    }
    if (L.refusedContrib && ((Number(L.sss) || 0) > 0 || (Number(L.phic) || 0) > 0 || (Number(L.hdmf) || 0) > 0)) {
      ex("gov-refused", "Government deduction on a 201 that refused contributions.");
    }

    var caItems = (ctx.caItems || (L.caDetail && L.caDetail.items) || []);
    var caBal = 0;
    caItems.forEach(function (it) { caBal += Number(it.balanceBefore) || 0; });
    if ((Number(L.ca) || 0) > caBal + 0.009) {
      ex("ca-over-balance", "Cash advance deduction is above the remaining balance.");
    }
    var caDue = ctx.caDue != null ? Number(ctx.caDue) : (L.caDetail ? Number(L.caDetail.amount) || 0 : 0);
    if (caDue > 0.009 && !(Number(L.ca) > 0.009)) {
      ex("ca-not-deducted", "An open cash advance is due this period and nothing was deducted.");
    }
    caItems.forEach(function (it) {
      pushSrc(src, {
        run: runId, empId: L.empId, name: L.name, date: per.from || "", item: "CA",
        qty: it.installment || 1, amount: it.amount,
        source_collection: "advances", source_id: it.id || "",
        balance_after: it.balanceAfter
      });
    });

    ["sss", "phic", "hdmf"].forEach(function (k) {
      if (!(Number(L[k]) > 0) && !L.govSkip) return;
      pushSrc(src, {
        run: runId, empId: L.empId, name: L.name, date: per.from || "", item: "gov",
        qty: L.govSkip || (kind === "weekly" ? "weekly-half" : "semi"),
        amount: L[k],
        source_collection: "rule", source_id: L.govSkip || (kind === "weekly" ? "weekly-half" : "semi")
      });
    });
    if (L.govSkip) {
      pushSrc(src, {
        run: runId, empId: L.empId, name: L.name, date: per.from || "", item: "gov",
        qty: "skip-week-27", amount: 0, source_collection: "rule", source_id: "skip-week-27"
      });
    }
    pushSrc(src, {
      run: runId, empId: L.empId, name: L.name, date: per.to || "", item: "rate",
      qty: L.daily, amount: L.daily, source_collection: "employees",
      source_id: (emp.id || L.empId || "") + (L.basis ? "#" + L.basis : "")
    });

    (ctx.missingDates || []).forEach(function (d) {
      ex("missing-day", "No daily manpower record for " + d + ".", d);
      pushSrc(src, {
        run: runId, empId: L.empId, name: L.name, date: d, item: "day",
        qty: 0, amount: 0, source_collection: "daily", source_id: "",
        exception: "Absence or missing day with no daily record"
      });
    });

    L.src = src;
    L.exceptions = exceptions;
    return L;
  }

  function openExceptions(lines, ack) {
    var map = ack || {};
    var out = [];
    (lines || []).forEach(function (L) {
      (L.exceptions || []).forEach(function (ex) {
        var id = (L.empId || "") + "|" + ex.code + "|" + (ex.date || "") + "|" + ex.text;
        if (map[id]) return;
        out.push({ id: id, empId: L.empId, name: L.name, code: ex.code, text: ex.text, date: ex.date || "" });
      });
    });
    return out;
  }

  function auditRows(lines, runId) {
    var rows = [];
    (lines || []).forEach(function (L) {
      (L.src || []).forEach(function (s) {
        rows.push([
          s.run || runId || "",
          s.empId || L.empId || "",
          s.name || L.name || "",
          s.date || "",
          s.item || "",
          s.qty,
          s.amount,
          s.source_collection || "",
          s.source_id || "",
          s.form_url || "",
          s.balance_after,
          s.exception || ""
        ]);
      });
      (L.exceptions || []).forEach(function (ex) {
        if ((L.src || []).some(function (s) { return s.exception && s.date === ex.date && s.exception.indexOf(ex.code) < 0; })) return;
        rows.push([
          runId || "", L.empId || "", L.name || "", ex.date || "", "exception",
          "", "", "", "", "", "", ex.code + ": " + ex.text
        ]);
      });
    });
    return rows;
  }

  function colLetter(n) {
    var s = "";
    var x = n;
    while (x > 0) {
      var m = (x - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  }

  function dayLabel(iso) {
    var d = isoDate(iso);
    if (!d) return "";
    var t = new Date(d + "T00:00:00");
    return (t.getMonth() + 1) + "/" + t.getDate() + "-" + DOW[t.getDay()];
  }

  function periodLabel(from, to, kind) {
    var a = new Date(isoDate(from) + "T00:00:00");
    var b = new Date(isoDate(to) + "T00:00:00");
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return "";
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    var short = months.slice();
    short[8] = "Sept.";
    short[9] = "Oct.";
    function mon(dt, semi) { return (semi ? short : months)[dt.getMonth()]; }
    if (kind === "semi") {
      return mon(a, true) + " " + a.getDate() + "-" + mon(b, true) + " " + b.getDate() + ", " + b.getFullYear();
    }
    if (a.getMonth() === b.getMonth()) {
      return mon(a, false) + " " + a.getDate() + "-" + b.getDate() + ", " + b.getFullYear();
    }
    return mon(a, false) + " " + a.getDate() + "-" + mon(b, false) + " " + b.getDate() + ", " + b.getFullYear();
  }

  function siteOrder(lines) {
    var seen = {};
    (lines || []).forEach(function (L) {
      (L.rows || []).forEach(function (r) {
        var s = String(r.site || "").trim();
        if (s) seen[s] = 1;
      });
      var home = String(L.site || "").trim();
      if (home) seen[home] = 1;
    });
    var names = Object.keys(seen);
    names.sort(function (a, b) {
      var ia = WEEKLY_SITES.indexOf(a);
      var ib = WEEKLY_SITES.indexOf(b);
      if (ia < 0 && ib < 0) return a.localeCompare(b);
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
    return names;
  }

  function splitName(name) {
    var s = String(name || "").trim();
    var c = s.indexOf(",");
    if (c >= 0) return { last: s.slice(0, c).trim(), first: s.slice(c + 1).trim() };
    var p = s.split(/\s+/);
    if (p.length < 2) return { last: s, first: "" };
    return { last: p[p.length - 1], first: p.slice(0, -1).join(" ") };
  }

  function cell(v, f) {
    var c = { v: v == null ? "" : v };
    if (f) c.f = f;
    return c;
  }

  function blankRow(n) {
    var r = [];
    for (var i = 0; i < n; i++) r.push(cell(""));
    return r;
  }

  function put(row, col, value, formula, extra) {
    while (row.length < col) row.push(cell(""));
    var c = cell(value, formula);
    if (extra) Object.keys(extra).forEach(function (k) { c[k] = extra[k]; });
    row[col - 1] = c;
  }

  function blankMoney(n) {
    var x = Number(n) || 0;
    return x ? round2(x) : "";
  }

  function shownBoxNet(b) {
    if (!b) return 0;
    return round2(round2(b.gross) - round2(b.stat) - round2(b.loanP) - round2(b.loanS) - round2(b.ca) - round2(b.uni) - round2(b.late));
  }

  function payField(empId, field) {
    return { input: { empId: empId, field: field } };
  }

  function buildWeeklySheet(run) {
    var lines = run.lines || [];
    var sites = siteOrder(lines);
    var pairs = Math.max(SITE_PAIRS, sites.length);
    var firstSite = 9;
    var totalDaysCol = firstSite + pairs * 2;
    /* 16 site pairs land Total Days on AO and NET PAY on BB, matching the workbook. */
    var cols = totalDaysCol + 14;
    var rows = [];
    function add(arr) { rows.push(arr); return rows.length; }

    var head = blankRow(cols);
    put(head, totalDaysCol + 7, "PERIOD DATE:");
    put(head, totalDaysCol + 12, periodLabel(run.from, run.to, "weekly"));
    add(head);
    add(blankRow(cols));
    add(blankRow(cols));
    var rel = blankRow(cols);
    put(rel, totalDaysCol + 7, "RELEASE DATE:");
    put(rel, totalDaysCol + 12, run.release || "");
    add(rel);
    add(blankRow(cols));
    add(blankRow(cols));

    var h1 = blankRow(cols);
    ["No.", "Name", "Date", "Time In", "Time out", "OT In", "OT Out", "Overtime Activity"].forEach(function (n, i) {
      put(h1, i + 1, n);
    });
    put(h1, firstSite, "PROJECT SITES");
    ["Total Days", "Total OT", "Additional Pay", "Gross Pay", "Late/Undertime Deduction", "DEDUCTIONS"].forEach(function (n, i) {
      put(h1, totalDaysCol + i, n);
    });
    put(h1, totalDaysCol + 12, "Total Deductions");
    put(h1, totalDaysCol + 13, "NET PAY");
    put(h1, totalDaysCol + 14, "SIGNATURE");
    add(h1);

    var h2 = blankRow(cols);
    sites.forEach(function (name, i) { put(h2, firstSite + i * 2, name); });
    ["C.A.  PERSONAL", "Uniform/Shoes", "Pag-ibig Loan", "SSS Loan", "SSS", "Pag-IBIG", "Phil health"].forEach(function (n, i) {
      put(h2, totalDaysCol + 5 + i, n);
    });
    add(h2);

    var h3 = blankRow(cols);
    for (var p = 0; p < pairs; p++) {
      put(h3, firstSite + p * 2, "DAYS");
      put(h3, firstSite + p * 2 + 1, "HRS");
    }
    add(h3);

    lines.forEach(function (L, idx) {
      var dates = eachDate(run.from, run.to);
      var start = rows.length + 1;
      var hay = (String(L.name || "") + " " + String(L.empNo || "") + " " + String(L.employeeId || "")).toLowerCase();
      var mark = { payrow: 1, hay: hay, empId: L.empId || "" };
      var siteDays = [];
      var siteHrs = [];
      for (var pre = 0; pre < pairs; pre++) {
        var siteName = sites[pre] || "";
        var dsum = 0;
        var hsum = 0;
        if (siteName) {
          (L.rows || []).forEach(function (r) {
            if (String(r.site || "").trim() !== siteName) return;
            dsum += Number(r.day) || 0;
            hsum += Number(r.ot) || 0;
          });
        }
        siteDays.push(dsum);
        siteHrs.push(hsum);
      }
      dates.forEach(function (d, di) {
        var row = blankRow(cols);
        var hit = (L.rows || []).filter(function (r) { return isoDate(r.date) === d; })[0];
        put(row, 1, di === 0 ? idx + 1 : "", null, mark);
        if (di === 0) put(row, 2, L.name || "", null, { nameBreak: L.empId || "", payName: L.name || "" });
        put(row, 3, dayLabel(d));
        if (hit) {
          put(row, 4, hit.in || "");
          put(row, 5, hit.out || "");
          put(row, 6, hit.otIn || "");
          put(row, 7, hit.otOut || "");
          put(row, 8, hit.otActivity || hit.reason || "");
          var si = sites.indexOf(String(hit.site || "").trim());
          if (si >= 0) {
            if (Number(hit.day)) put(row, firstSite + si * 2, Number(hit.day));
            if (Number(hit.ot)) put(row, firstSite + si * 2 + 1, Number(hit.ot));
          }
        }
        var daySum = [];
        var hrSum = [];
        for (var s = 0; s < pairs; s++) {
          daySum.push(colLetter(firstSite + s * 2) + (start + di));
          hrSum.push(colLetter(firstSite + s * 2 + 1) + (start + di));
        }
        var dayQty = hit ? (Number(hit.day) || 0) : 0;
        var hrQty = hit ? (Number(hit.ot) || 0) : 0;
        put(row, totalDaysCol, dayQty || "", "SUM(" + daySum.join(",") + ")");
        put(row, totalDaysCol + 1, hrQty || "", "SUM(" + hrSum.join(",") + ")");
        if (di === 0) {
          var pesoRow = start + dates.length + 1;
          var blockEnd = start + dates.length + 1;
          var addl = blankMoney(L.incentive || L.addl);
          put(row, totalDaysCol + 2, addl, null, payField(L.empId, "incentive"));
          put(row, totalDaysCol + 3, round2(L.gross) || 0,
            "SUM(" + colLetter(firstSite) + pesoRow + ":" + colLetter(firstSite + pairs * 2 - 1) + pesoRow + "," + colLetter(totalDaysCol + 2) + start + ")",
            { paybreak: "earn", empId: L.empId || "", payName: L.name || "" });
          put(row, totalDaysCol + 4, blankMoney(L.late), null, payField(L.empId, "late"));
          put(row, totalDaysCol + 5, blankMoney(L.ca), null, payField(L.empId, "ca"));
          put(row, totalDaysCol + 6, blankMoney(L.uniform), null, payField(L.empId, "uniform"));
          put(row, totalDaysCol + 7, blankMoney(L.hdmfLoan), null, payField(L.empId, "hdmfLoan"));
          put(row, totalDaysCol + 8, blankMoney(L.sssLoan), null, payField(L.empId, "sssLoan"));
          put(row, totalDaysCol + 9, blankMoney(L.sss), null, payField(L.empId, "sss"));
          put(row, totalDaysCol + 10, blankMoney(L.hdmf), null, payField(L.empId, "hdmf"));
          put(row, totalDaysCol + 11, blankMoney(L.phic), null, payField(L.empId, "phic"));
          put(row, totalDaysCol + 12, round2(L.ded) || 0,
            "SUM(" + colLetter(totalDaysCol + 4) + start + ":" + colLetter(totalDaysCol + 11) + blockEnd + ")",
            { paybreak: "ded", empId: L.empId || "", payName: L.name || "" });
          put(row, totalDaysCol + 13, Number(L.net) || 0,
            "ROUNDUP((" + colLetter(totalDaysCol + 3) + start + "-" + colLetter(totalDaysCol + 12) + start + "),0)");
          put(row, totalDaysCol + 14, "", null, { actions: L.empId || "" });
        }
        add(row);
      });
      var rateRow = blankRow(cols);
      put(rateRow, 1, "", null, mark);
      put(rateRow, 3, "Rate");
      put(rateRow, 4, "Day");
      put(rateRow, 5, "Hour");
      for (var rs = 0; rs < pairs; rs++) {
        var letter = colLetter(firstSite + rs * 2);
        put(rateRow, firstSite + rs * 2, siteDays[rs] || "", "SUM(" + letter + start + ":" + letter + (start + dates.length - 1) + ")");
        var hletter = colLetter(firstSite + rs * 2 + 1);
        put(rateRow, firstSite + rs * 2 + 1, siteHrs[rs] || "", "SUM(" + hletter + start + ":" + hletter + (start + dates.length - 1) + ")");
      }
      put(rateRow, totalDaysCol, Number(L.days) || "", "SUM(" + colLetter(totalDaysCol) + start + ":" + colLetter(totalDaysCol) + (start + dates.length - 1) + ")");
      put(rateRow, totalDaysCol + 1, Number(L.ot) || "", "SUM(" + colLetter(totalDaysCol + 1) + start + ":" + colLetter(totalDaysCol + 1) + (start + dates.length - 1) + ")");
      var rateNo = add(rateRow);
      var peso = blankRow(cols);
      var daily = Number(L.daily) || 0;
      var hourly = L.hourly != null ? Number(L.hourly) : daily / 8;
      put(peso, 1, "", null, mark);
      put(peso, 2, L.position || "");
      put(peso, 4, daily);
      put(peso, 5, hourly, colLetter(4) + (rateNo + 1) + "/8");
      for (var ps = 0; ps < pairs; ps++) {
        var dcol = colLetter(firstSite + ps * 2);
        var hcol = colLetter(firstSite + ps * 2 + 1);
        put(peso, firstSite + ps * 2, siteDays[ps] ? round2(siteDays[ps] * daily) : "", dcol + rateNo + "*" + colLetter(4) + (rateNo + 1));
        put(peso, firstSite + ps * 2 + 1, siteHrs[ps] ? round2(siteHrs[ps] * hourly) : "", hcol + rateNo + "*" + colLetter(5) + (rateNo + 1));
      }
      put(peso, totalDaysCol, (Number(L.days) || 0) ? round2((Number(L.days) || 0) * daily) : "", colLetter(totalDaysCol) + rateNo + "*" + colLetter(4) + (rateNo + 1));
      put(peso, totalDaysCol + 1, (Number(L.ot) || 0) ? round2((Number(L.ot) || 0) * hourly) : "", colLetter(totalDaysCol + 1) + rateNo + "*" + colLetter(5) + (rateNo + 1));
      add(peso);
    });

    return { name: "All", rows: rows, cols: cols };
  }

  function summaryBoxes(lines, kind) {
    var groups = {};
    (lines || []).forEach(function (L) {
      var site = String(L.site || "(no area)");
      var g = groups[site] || (groups[site] = { site: site, gross: 0, stat: 0, loanP: 0, loanS: 0, ca: 0, uni: 0, late: 0, net: 0 });
      g.gross += Number(L.gross) || 0;
      g.stat += (Number(L.sss) || 0) + (Number(L.phic) || 0) + (Number(L.hdmf) || 0);
      g.loanP += Number(L.hdmfLoan) || 0;
      g.loanS += Number(L.sssLoan) || 0;
      g.ca += Number(L.ca) || 0;
      g.uni += Number(L.uniform) || 0;
      g.late += Number(L.late) || 0;
      g.net += Number(L.net) || 0;
    });
    return Object.keys(groups).sort().map(function (k) { return groups[k]; });
  }

  function buildWeeklySummary(run) {
    var boxes = summaryBoxes(run.lines, "weekly");
    var rows = [];
    function add(a) { rows.push(a); }
    var title = blankRow(6);
    put(title, 2, "Weekly Total Payroll Summary");
    add(title);
    var per = blankRow(6);
    put(per, 2, periodLabel(run.from, run.to, "weekly"));
    add(per);
    add(blankRow(6));
    for (var i = 0; i < boxes.length; i += 2) {
      var left = boxes[i];
      var right = boxes[i + 1];
      var labels = [
        ["Gross Pay", "gross"],
        ["SSS/Pag-ibig/Philhealth", "stat"],
        ["Pag-ibig Loan", "loanP"],
        ["SSS Loan", "loanS"],
        ["Cash Advance", "ca"],
        ["Uniform/Others", "uni"],
        ["Late/undertime", "late"]
      ];
      var name = blankRow(6);
      put(name, 2, left.site);
      if (right) put(name, 5, right.site);
      add(name);
      var base = rows.length + 1;
      labels.forEach(function (lb, n) {
        var row = blankRow(6);
        put(row, 2, lb[0]);
        put(row, 3, round2(left[lb[1]]));
        if (right) {
          put(row, 5, lb[0]);
          put(row, 6, round2(right[lb[1]]));
        }
        add(row);
      });
      var net = blankRow(6);
      put(net, 2, "Net Pay");
      put(net, 3, shownBoxNet(left), "C" + base + "-C" + (base + 1) + "-C" + (base + 2) + "-C" + (base + 3) + "-C" + (base + 4) + "-C" + (base + 5) + "-C" + (base + 6));
      if (right) {
        put(net, 5, "Net Pay");
        put(net, 6, shownBoxNet(right), "F" + base + "-F" + (base + 1) + "-F" + (base + 2) + "-F" + (base + 3) + "-F" + (base + 4) + "-F" + (base + 5) + "-F" + (base + 6));
      }
      add(net);
      add(blankRow(6));
    }
    return { name: "Total Summary", rows: rows, cols: 6 };
  }

  function buildSemiSheet(run) {
    var lines = run.lines || [];
    var dates = eachDate(run.from, run.to);
    var cols = 33;
    var rows = [];
    function add(a) { rows.push(a); return rows.length; }
    for (var i = 0; i < 9; i++) add(blankRow(cols));
    var title = blankRow(cols);
    put(title, 2, periodLabel(run.from, run.to, "semi"));
    add(title);
    var pay = blankRow(cols);
    put(pay, 2, "Payout Date: " + (run.releaseLabel || payoutLabel(run.release) || ""));
    add(pay);
    add(blankRow(cols));
    var h1 = blankRow(cols);
    put(h1, 2, "NO.");
    put(h1, 4, "TIME RECORD");
    ["TOTAL DAYS", "TOTAL OT HRS", "DAILY RATE", "HOURLY RATE", "TOTAL OT", "HOLIDAY", "HOLIDAY PAY/Sun.", "ALLOWANCE", "Additional/Lacking", "GROSS PAY", "Late/Undertime/Absent", "DEDUCTION"].forEach(function (n, i) {
      put(h1, 13 + i, n);
    });
    put(h1, 32, "NET PAY");
    put(h1, 33, "SIGNATURE");
    add(h1);
    var h2 = blankRow(cols);
    put(h2, 3, "NAME");
    ["DATE", "TIME IN", "TIME OUT", "OT IN", "OUT", "OT Activity", "DAYS", "OT", "HOLIDAY"].forEach(function (n, i) {
      put(h2, 4 + i, n);
    });
    ["CA LOAN", "Uniform/Others", "SSS LOAN", "PAG-IBIG LOAN", "SSS", "PHILHEALTH", "HMIC", "TOTAL"].forEach(function (n, i) {
      put(h2, 24 + i, n);
    });
    add(h2);

    lines.forEach(function (L, idx) {
      var start = rows.length + 1;
      var semiMark = {
        payrow: 1,
        hay: (String(L.name || "") + " " + String(L.empNo || "") + " " + String(L.employeeId || "")).toLowerCase(),
        empId: L.empId || ""
      };
      dates.forEach(function (d, di) {
        var row = blankRow(cols);
        var hit = (L.rows || []).filter(function (r) { return isoDate(r.date) === d; })[0];
        put(row, 1, "", null, semiMark);
        if (di === 0) {
          put(row, 2, idx + 1);
          put(row, 3, L.name || "", null, { nameBreak: L.empId || "", payName: L.name || "" });
          put(row, 13, Number(L.days) || 0, "SUM(J" + start + ":J" + (start + dates.length - 1) + ")");
          put(row, 14, Number(L.ot) || 0, "SUM(K" + start + ":K" + (start + dates.length - 1) + ")");
          if (L.monthlyAmount) put(row, 15, Number(L.daily) || 0, L.monthlyAmount + "/26");
          else put(row, 15, Number(L.daily) || 0);
          put(row, 16, L.hourly != null ? Number(L.hourly) : (Number(L.daily) || 0) / 8, "O" + start + "/8");
          put(row, 17, round2(L.otPay) || 0, "P" + start + "*N" + start);
          put(row, 18, Number(L.hol) || 0, "SUM(L" + start + ":L" + (start + dates.length - 1) + ")");
          put(row, 19, round2(L.holPay) || 0, "R" + start + "*O" + start);
          put(row, 20, blankMoney(L.allowance), null, payField(L.empId, "allowance"));
          put(row, 21, blankMoney(L.incentive || L.addl), null, payField(L.empId, "incentive"));
          put(row, 22, round2(L.gross) || 0, "M" + start + "*O" + start + "+Q" + start + "+S" + start + "+T" + start + "+U" + start,
            { paybreak: "earn", empId: L.empId || "", payName: L.name || "" });
          put(row, 23, blankMoney(L.late), null, payField(L.empId, "late"));
          put(row, 24, blankMoney(L.ca), null, payField(L.empId, "ca"));
          put(row, 25, blankMoney(L.uniform), null, payField(L.empId, "uniform"));
          put(row, 26, blankMoney(L.sssLoan), null, payField(L.empId, "sssLoan"));
          put(row, 27, blankMoney(L.hdmfLoan), null, payField(L.empId, "hdmfLoan"));
          put(row, 28, blankMoney(L.sss), null, payField(L.empId, "sss"));
          put(row, 29, blankMoney(L.phic), null, payField(L.empId, "phic"));
          put(row, 30, blankMoney(L.hdmf), null, payField(L.empId, "hdmf"));
          put(row, 31, round2(L.ded) || 0, "SUM(W" + start + ":AD" + (start + dates.length) + ")",
            { paybreak: "ded", empId: L.empId || "", payName: L.name || "" });
          put(row, 32, Number(L.net) || 0, "ROUNDUP((V" + start + "-AE" + start + "),0)");
          put(row, 33, "", null, { actions: L.empId || "" });
        }
        put(row, 4, dayLabel(d));
        if (hit) {
          var note = hit.s && hit.s !== "Present" && hit.s !== "Present/Late" ? hit.s : "";
          put(row, 5, note && !hit.in ? note : (hit.in || ""));
          put(row, 6, hit.out || "");
          put(row, 7, hit.otIn || "");
          put(row, 8, hit.otOut || "");
          put(row, 9, hit.otActivity || "");
          if (Number(hit.day)) put(row, 10, Number(hit.day));
          if (Number(hit.ot)) put(row, 11, Number(hit.ot));
          if (Number(hit.hol)) put(row, 12, Number(hit.hol));
        }
        if (di === dates.length - 2) put(row, 3, "Acc. No.");
        if (di === dates.length - 1 && L.bankAcct) put(row, 3, L.bankAcct);
        add(row);
      });
      var idRow = blankRow(cols);
      put(idRow, 1, "", null, semiMark);
      put(idRow, 3, "ID No. " + (L.empNo || ""));
      add(idRow);
    });

    var total = blankRow(cols);
    put(total, 3, "TOTAL");
    ["W", "X", "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF", "V", "T", "U"].forEach(function (letter) {
      /* filled after we know the span */
    });
    if (lines.length) {
      var first = 15;
      var last = rows.length;
      function sumCol(col) {
        return "SUM(" + colLetter(col) + first + ":" + colLetter(col) + last + ")";
      }
      [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].forEach(function (c) {
        put(total, c, "", sumCol(c));
      });
    }
    add(total);
    add(blankRow(cols));
    add(blankRow(cols));
    var prep = blankRow(cols);
    put(prep, 2, "Prepared by:");
    put(prep, 4, SIGN_PREP);
    add(prep);
    var role = blankRow(cols);
    put(role, 4, SIGN_PREP_ROLE);
    add(role);
    var ap = blankRow(cols);
    put(ap, 2, "Approved by:");
    put(ap, 4, SIGN_APPR);
    add(ap);
    var ar = blankRow(cols);
    put(ar, 4, SIGN_APPR_ROLE);
    add(ar);
    return { name: "Admins", rows: rows, cols: cols };
  }

  function buildSemiSummary(run) {
    var boxes = summaryBoxes(run.lines, "semi");
    var rows = [];
    function add(a) { rows.push(a); }
    for (var i = 0; i < 4; i++) add(blankRow(7));
    var t = blankRow(7); put(t, 2, "ADMIN PAYROLL TOTAL SUMMARY"); add(t);
    var p = blankRow(7); put(p, 2, periodLabel(run.from, run.to, "semi")); add(p);
    add(blankRow(7));
    var grossCells = [];
    var netCells = [];
    for (var b = 0; b < boxes.length; b += 2) {
      var left = boxes[b];
      var right = boxes[b + 1];
      var name = blankRow(7);
      put(name, 2, left.site);
      if (right) put(name, 6, right.site);
      add(name);
      var labels = [
        ["Gross Pay", "gross"],
        ["SSS/Pag-ibig/Philhealth", "stat"],
        ["Late/undertime", "late"],
        ["Cash Advance", "ca"],
        ["Uniform/Others", "uni"],
        ["SSS  LOAN", "loanS"],
        ["Pag-ibig  LOAN", "loanP"]
      ];
      var base = rows.length + 1;
      labels.forEach(function (lb) {
        var row = blankRow(7);
        put(row, 2, lb[0]);
        put(row, 3, round2(left[lb[1]]));
        if (right) {
          put(row, 6, lb[0]);
          put(row, 7, round2(right[lb[1]]));
        }
        add(row);
      });
      var net = blankRow(7);
      put(net, 2, "Net Pay");
      put(net, 3, shownBoxNet(left), "C" + base + "-C" + (base + 1) + "-C" + (base + 2) + "-C" + (base + 3) + "-C" + (base + 4) + "-C" + (base + 5) + "-C" + (base + 6));
      grossCells.push("C" + base);
      netCells.push("C" + rows.length);
      if (right) {
        put(net, 6, "Net Pay");
        put(net, 7, shownBoxNet(right), "G" + base + "-G" + (base + 1) + "-G" + (base + 2) + "-G" + (base + 3) + "-G" + (base + 4) + "-G" + (base + 5) + "-G" + (base + 6));
        grossCells.push("G" + base);
        netCells.push("G" + rows.length);
      }
      add(net);
      add(blankRow(7));
    }
    var g = blankRow(7);
    put(g, 2, "Gross Pay");
    if (grossCells.length) put(g, 3, "", "SUM(" + grossCells.join(",") + ")");
    put(g, 6, "Cash");
    add(g);
    var n = blankRow(7);
    put(n, 2, "Net Pay");
    if (netCells.length) put(n, 3, "", "SUM(" + netCells.join(",") + ")");
    put(n, 6, "ATM");
    add(n);
    var cash = 0;
    var atm = 0;
    (run.lines || []).forEach(function (L) {
      if (String(L.bankAcct || "").trim()) atm += Number(L.net) || 0;
      else cash += Number(L.net) || 0;
    });
    rows[rows.length - 2][6] = cell(cash);
    rows[rows.length - 1][6] = cell(atm);
    var tot = blankRow(7);
    put(tot, 6, "Total");
    put(tot, 7, "", "SUM(G" + (rows.length - 1) + ":G" + rows.length + ")");
    add(tot);
    add(blankRow(7));
    var prep = blankRow(7);
    put(prep, 2, "Prepared by:");
    put(prep, 6, "Approved by:");
    add(prep);
    var names = blankRow(7);
    put(names, 2, SIGN_PREP);
    put(names, 6, SIGN_APPR);
    add(names);
    var roles = blankRow(7);
    put(roles, 2, "Safety Officer");
    put(roles, 6, "CEO");
    add(roles);
    return { name: "Total Summary", rows: rows, cols: 7 };
  }

  function buildManpower(run) {
    var boxes = {};
    (run.lines || []).forEach(function (L) {
      var site = String(L.site || "(no area)");
      (boxes[site] = boxes[site] || []).push(L);
    });
    var rows = [];
    function add(a) { rows.push(a); return rows.length; }
    add(blankRow(14));
    Object.keys(boxes).sort().forEach(function (site) {
      var band = blankRow(14);
      put(band, 2, site);
      put(band, 5, "L");
      ["UNIFORM", "CA", "SS L", "P L", "SSS", "PHILHEALTH", "PAG-IBIG", "GP", "NET"].forEach(function (n, i) {
        put(band, 6 + i, n);
      });
      add(band);
      var head = blankRow(14);
      put(head, 2, "No.");
      put(head, 3, "Last Names");
      put(head, 4, "First Name");
      add(head);
      var start = rows.length + 1;
      boxes[site].forEach(function (L, i) {
        var nm = splitName(L.name);
        var row = blankRow(14);
        put(row, 2, i + 1);
        put(row, 3, nm.last);
        put(row, 4, nm.first);
        put(row, 5, Number(L.late) || 0);
        put(row, 6, Number(L.uniform) || 0);
        put(row, 7, Number(L.ca) || 0);
        put(row, 8, Number(L.sssLoan) || 0);
        put(row, 9, Number(L.hdmfLoan) || 0);
        put(row, 10, Number(L.sss) || 0);
        put(row, 11, Number(L.phic) || 0);
        put(row, 12, Number(L.hdmf) || 0);
        put(row, 13, round2(L.gross));
        var r = start + i;
        put(row, 14, Number(L.net) || 0, "ROUNDUP((M" + r + "-E" + r + "-G" + r + "-H" + r + "-I" + r + "-J" + r + "-K" + r + "-L" + r + "-F" + r + "),0)");
        add(row);
      });
      var end = rows.length;
      var sub = blankRow(14);
      [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].forEach(function (c) {
        put(sub, c, "", "SUM(" + colLetter(c) + start + ":" + colLetter(c) + end + ")");
      });
      var subNo = add(sub);
      var gov = blankRow(14);
      put(gov, 10, "", "SUM(J" + subNo + ":L" + subNo + ")");
      add(gov);
    });
    return { name: "Project Site Manpower", rows: rows, cols: 14 };
  }

  function buildAuditSheet(run) {
    var rows = [];
    var head = ["run", "empId", "name", "date", "item", "qty", "amount", "source_collection", "source_id", "form_url", "balance_after", "exception"].map(function (h) {
      return cell(h);
    });
    rows.push(head);
    auditRows(run.lines, run.runId).forEach(function (r) {
      rows.push(r.map(function (v) { return cell(v); }));
    });
    return { name: "Audit", rows: rows, cols: 12 };
  }

  function workbook(run) {
    run = run || {};
    run.runId = run.runId || ((run.kind || "weekly") + "|" + (run.from || ""));
    if (run.kind === "semi") {
      return {
        sheets: [buildSemiSheet(run), buildSemiSummary(run), buildManpower(run), buildAuditSheet(run)]
      };
    }
    return { sheets: [buildWeeklySheet(run), buildWeeklySummary(run), buildAuditSheet(run)] };
  }

  function sheetXml(sheet) {
    var cols = sheet.cols || 1;
    var xmls = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      "<sheetData>"];
    (sheet.rows || []).forEach(function (row, ri) {
      var cells = "";
      for (var c = 0; c < row.length; c++) {
        var item = row[c] || {};
        var ref = colLetter(c + 1) + (ri + 1);
        if (item.f) {
          var cached = typeof item.v === "number" ? "<v>" + item.v + "</v>" : "";
          cells += '<c r="' + ref + '"><f>' + xml(item.f) + "</f>" + cached + "</c>";
        } else if (typeof item.v === "number" && isFinite(item.v)) {
          cells += '<c r="' + ref + '"><v>' + item.v + "</v></c>";
        } else if (item.v !== "" && item.v != null) {
          cells += '<c r="' + ref + '" t="inlineStr"><is><t>' + xml(item.v) + "</t></is></c>";
        }
      }
      if (cells) xmls.push('<row r="' + (ri + 1) + '">' + cells + "</row>");
    });
    xmls.push("</sheetData></worksheet>");
    return xmls.join("");
  }

  function crc32(bytes) {
    var table = crc32.table;
    if (!table) {
      table = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
      crc32.table = table;
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(n) { return [n & 255, (n >> 8) & 255]; }
  function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }
  function concat(parts) {
    var len = 0;
    parts.forEach(function (p) { len += p.length; });
    var out = new Uint8Array(len);
    var o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }

  function zipStore(files) {
    var locals = [];
    var centrals = [];
    var offset = 0;
    files.forEach(function (f) {
      var name = new TextEncoder().encode(f.name);
      var data = f.data;
      var crc = crc32(data);
      var local = concat([
        new Uint8Array(u32(0x04034b50)),
        new Uint8Array(u16(20)),
        new Uint8Array(u16(0)),
        new Uint8Array(u16(0)),
        new Uint8Array(u16(0)),
        new Uint8Array(u16(0)),
        new Uint8Array(u32(crc)),
        new Uint8Array(u32(data.length)),
        new Uint8Array(u32(data.length)),
        new Uint8Array(u16(name.length)),
        new Uint8Array(u16(0)),
        name,
        data
      ]);
      var central = concat([
        new Uint8Array(u32(0x02014b50)),
        new Uint8Array(u16(20)),
        new Uint8Array(u16(20)),
        new Uint8Array(u16(0)),
        new Uint8Array(u16(0)),
        new Uint8Array(u16(0)),
        new Uint8Array(u16(0)),
        new Uint8Array(u32(crc)),
        new Uint8Array(u32(data.length)),
        new Uint8Array(u32(data.length)),
        new Uint8Array(u16(name.length)),
        new Uint8Array(u16(0)),
        new Uint8Array(u16(0)),
        new Uint8Array(u16(0)),
        new Uint8Array(u16(0)),
        new Uint8Array(u32(0)),
        new Uint8Array(u32(offset)),
        name
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });
    var centralBlob = concat(centrals);
    var end = concat([
      new Uint8Array(u32(0x06054b50)),
      new Uint8Array(u16(0)),
      new Uint8Array(u16(0)),
      new Uint8Array(u16(files.length)),
      new Uint8Array(u16(files.length)),
      new Uint8Array(u32(centralBlob.length)),
      new Uint8Array(u32(offset)),
      new Uint8Array(u16(0))
    ]);
    return concat(locals.concat([centralBlob, end]));
  }

  function toXlsx(book) {
    var sheets = book.sheets || [];
    var enc = new TextEncoder();
    var files = [];
    var overrides = sheets.map(function (s, i) {
      return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }).join("");
    files.push({
      name: "[Content_Types].xml",
      data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        overrides + "</Types>")
    });
    files.push({
      name: "_rels/.rels",
      data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>")
    });
    var sheetTags = sheets.map(function (s, i) {
      return '<sheet name="' + xml(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    }).join("");
    files.push({
      name: "xl/workbook.xml",
      data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        "<sheets>" + sheetTags + "</sheets></workbook>")
    });
    var rels = sheets.map(function (s, i) {
      return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    }).join("");
    files.push({
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>")
    });
    sheets.forEach(function (s, i) {
      files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: enc.encode(sheetXml(s)) });
    });
    return zipStore(files);
  }

  function linkOpen(kind, id, date) {
    if (kind === "daily") return '<button type="button" class="btn sm" data-payaudit="daily|' + esc(date || id) + '">attendance</button>';
    if (kind === "otreqs") return '<button type="button" class="btn sm" data-payaudit="otreqs|' + esc(id) + '">OT request</button>';
    if (kind === "leaves") return '<button type="button" class="btn sm" data-payaudit="leaves|' + esc(id) + '">leave</button>';
    if (kind === "advances") return '<button type="button" class="btn sm" data-payaudit="advances|' + esc(id) + '">cash advance</button>';
    return "";
  }

  function payoutLabel(iso) {
    var d = isoDate(iso);
    if (!d) return String(iso || "");
    var t = new Date(d + "T00:00:00");
    var months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
    return months[t.getMonth()] + " " + t.getDate() + ", " + t.getFullYear();
  }

  function screenHTML(run) {
    var book = workbook(run);
    var main = book.sheets[0];
    var open = openExceptions(run.lines, run.ack);
    var h = "";
    if (open.length) {
      h += '<div class="note" id="pay-exceptions" style="border-left-color:var(--crit);margin-bottom:12px">'
        + "<b>" + open.length + " payroll exception" + (open.length === 1 ? "" : "s") + " — finalize stays off until they are acknowledged.</b>"
        + "<ul style=\"margin:6px 0 0 18px\">";
      open.slice(0, 40).forEach(function (ex) {
        h += "<li><b>" + esc(ex.name || ex.empId) + "</b> — " + esc(ex.text) + "</li>";
      });
      if (open.length > 40) h += "<li>… " + (open.length - 40) + " more on the audit list.</li>";
      h += '</ul><div class="row" style="margin-top:8px">'
        + '<button type="button" class="btn sm" id="pay-ack">Acknowledge and allow finalize</button>'
        + '<button type="button" class="btn sm" id="pay-audit">Audit drill-down</button></div></div>';
    } else {
      h += '<div class="note" style="margin-bottom:12px">No open exceptions on this run. '
        + '<button type="button" class="btn sm" id="pay-audit">Audit drill-down</button></div>';
    }
    h += '<div class="tw" id="pay-sheet" style="max-height:68vh;overflow:auto;margin-bottom:12px"><table style="min-width:1400px"><tbody>';
    (main.rows || []).forEach(function (row) {
      var hay = "";
      var payrow = false;
      row.forEach(function (c) {
        if (!c) return;
        if (c.hay) hay = c.hay;
        if (c.payrow) payrow = true;
      });
      h += "<tr" + (payrow ? ' data-payrow="1" data-hay="' + esc(hay) + '"' : "") + ">";
      row.forEach(function (c) {
        if (c && c.input) {
          var shown = c.v === "" || c.v == null ? "" : c.v;
          h += '<td><input data-payf="' + esc(c.input.empId) + "|" + esc(c.input.field)
            + '" type="number" step="0.01" value="' + esc(shown)
            + '" style="width:78px;text-align:right;font-family:var(--f-mono);font-size:12px"></td>';
          return;
        }
        if (c && c.actions) {
          h += '<td style="white-space:nowrap"><button type="button" class="btn sm" data-payperson="' + esc(c.actions) + '">Days</button> '
            + '<button type="button" class="btn sm" data-payslip="' + esc(c.actions) + '">Payslip</button> '
            + '<button type="button" class="pay-break-btn" data-paybreak="ded" data-payemp="' + esc(c.actions) + '">Deductions</button></td>';
          return;
        }
        if (c && c.paybreak) {
          var amt = c.v === "" || c.v == null ? 0 : c.v;
          var sideName = c.paybreak === "earn" ? "earnings" : "deduction";
          h += '<td class="num mono"><button type="button" class="pay-break-btn" data-paybreak="' + esc(c.paybreak)
            + '" data-payemp="' + esc(c.empId || "") + '" aria-label="Show the ' + sideName + ' breakdown'
            + (c.payName ? " for " + esc(c.payName) : "") + '">' + esc(amt) + "</button></td>";
          return;
        }
        if (c && c.nameBreak) {
          h += "<td><b>" + esc(c.v || "") + "</b>"
            + '<div class="pay-break-name">'
            + '<button type="button" class="pay-break-btn" data-paybreak="ded" data-payemp="' + esc(c.nameBreak)
            + '" aria-label="Show the deduction breakdown' + (c.payName ? " for " + esc(c.payName) : "") + '">Deductions</button>'
            + '<button type="button" class="pay-break-btn" data-paybreak="earn" data-payemp="' + esc(c.nameBreak)
            + '" aria-label="Show the earnings breakdown' + (c.payName ? " for " + esc(c.payName) : "") + '">Earnings</button>'
            + "</div></td>";
          return;
        }
        var text = c && c.v != null && c.v !== "" ? c.v : "";
        h += "<td" + (typeof text === "number" ? ' class="num mono"' : "") + ">" + (text === "" || text == null ? "" : esc(text)) + "</td>";
      });
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    h += auditHTML(run);
    return h;
  }

  function auditHTML(run) {
    var lines = (run.lines || []).slice().sort(function (a, b) {
      return ((b.exceptions || []).length - (a.exceptions || []).length);
    });
    var h = '<div class="card" id="pay-audit-card"><div class="card-h"><h3>Audit — every figure and its source</h3>'
      + '<span class="lbl">OT → request and form · absence and late → attendance · leave → leave record · cash advance → balance</span></div>'
      + '<div class="card-b" style="padding-top:0">';
    lines.forEach(function (L) {
      var ex = L.exceptions || [];
      h += '<details' + (ex.length ? " open" : "") + ' style="margin:8px 0"><summary><b>' + esc(L.name || "") + "</b>"
        + (L.employeeId ? " · " + esc(L.employeeId) : "")
        + (L.empNo ? " · ID No. " + esc(L.empNo) : "")
        + (ex.length ? ' <span class="pill warn">' + ex.length + " exception" + (ex.length === 1 ? "" : "s") + "</span>" : "")
        + "</summary>";
      if (L.empId) {
        h += '<div class="pay-break-name"><button type="button" class="pay-break-btn" data-paybreak="ded" data-payemp="'
          + esc(L.empId) + '" aria-label="Show the deduction breakdown for ' + esc(L.name || "") + '">Deduction breakdown</button>'
          + '<button type="button" class="pay-break-btn" data-paybreak="earn" data-payemp="' + esc(L.empId)
          + '" aria-label="Show the earnings breakdown for ' + esc(L.name || "") + '">Earnings breakdown</button></div>';
      }
      if (ex.length) {
        h += '<ul style="margin:6px 0 6px 18px">';
        ex.forEach(function (e) { h += "<li>" + esc(e.text) + "</li>"; });
        h += "</ul>";
      }
      h += '<div class="tw"><table><thead><tr><th>Date</th><th>Item</th><th class="num">Qty</th><th class="num">Amount</th><th>Source</th><th>Balance after</th><th>Exception</th></tr></thead><tbody>';
      (L.src || []).forEach(function (s) {
        h += "<tr><td class=\"mono\">" + esc(s.date || "—") + "</td><td>" + esc(s.item) + "</td>"
          + '<td class="num mono">' + esc(s.qty) + "</td>"
          + '<td class="num mono">' + (s.amount === "" ? "" : esc(s.amount)) + "</td><td>"
          + esc(s.source_collection) + (s.source_id ? " / " + esc(s.source_id) : "")
          + " " + linkOpen(s.source_collection, s.source_id, s.date)
          + (s.form_url ? ' <a href="' + esc(s.form_url) + '" target="_blank" rel="noopener noreferrer">form</a>' : "")
          + "</td><td class=\"num mono\">" + esc(s.balance_after) + "</td><td>" + esc(s.exception || "") + "</td></tr>";
      });
      h += "</tbody></table></div></details>";
    });
    h += "</div></div>";
    return h;
  }

  function payRunApproved(run) {
    return String(run && run.status || "").trim().toLowerCase() === "approved";
  }

  function isPlainApprovalText(text) {
    var t = String(text || "").trim();
    return t === "Approved by:" || t === SIGN_APPR || t === SIGN_APPR_ROLE;
  }

  function cellText(c) {
    return c && c.v != null && c.v !== "" ? String(c.v) : "";
  }

  /* approvedAt with a zone is converted to Asia/Manila. A wall clock with no
     zone is already Manila time — Approve stores nowStamp() that way. */
  function manilaApprovalWhen(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    var zoned = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s);
    var wall = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    var y;
    var mo;
    var d;
    var h;
    var mi;
    var se;
    if (wall && !zoned) {
      y = wall[1];
      mo = wall[2];
      d = wall[3];
      h = wall[4] || "00";
      mi = wall[5] || "00";
      se = wall[6] || "00";
    } else {
      var t = new Date(s);
      if (isNaN(t.getTime())) return null;
      var fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      });
      var parts = {};
      fmt.formatToParts(t).forEach(function (p) {
        if (p.type !== "literal") parts[p.type] = p.value;
      });
      if (!parts.year || !parts.month || !parts.day) return null;
      y = parts.year;
      mo = parts.month;
      d = parts.day;
      h = parts.hour || "00";
      mi = parts.minute || "00";
      se = parts.second || "00";
      if (h === "24") h = "00";
    }
    h = pad2(Number(h));
    mi = pad2(Number(mi));
    se = pad2(Number(se));
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var monthName = months[Number(mo) - 1] || mo;
    var dayLabel = String(Number(d)) + " " + monthName + " " + y;
    var hour = Number(h);
    var ap = hour >= 12 ? "PM" : "AM";
    var h12 = hour % 12;
    if (!h12) h12 = 12;
    var clock = h12 + ":" + mi + ":" + se + " " + ap;
    var clockShort = h12 + ":" + mi + " " + ap;
    return {
      iso: y + "-" + mo + "-" + d + "T" + h + ":" + mi + ":" + se + "+08:00",
      text: dayLabel + ", " + clock + " Asia/Manila",
      day: dayLabel,
      clock: clock,
      clockShort: clockShort
    };
  }

  /* Official stamp for an approved pay run. The image is the stored
     signatory e-signature (hrSigs.signatory / jeffrey.png). A missing image
     still prints the stamp, the name, and the Manila time. */
  function approvalStampHtml(run) {
    if (!payRunApproved(run)) return "";
    var name = String(run.signatoryName || run.signatory || SIGN_APPR).trim() || SIGN_APPR;
    var title = String(run.signatoryTitle || "CEO / President").trim() || "CEO / President";
    var label = name + ", " + title;
    var src = String(run.signatorySrc || run.signatureSrc || "").trim();
    var when = manilaApprovalWhen(run.approvedAt);
    var img = src
      ? '<img class="pay-approval-sig" src="' + esc(src) + '" alt="E-signature of ' + esc(name) + '" style="max-height:36px;max-width:140px;display:block;margin:4px auto 2px;background:#fff">'
      : "";
    return '<div class="pay-approval-stamp" data-pay-approval="approved"'
      + (when ? ' data-approved-pht="' + esc(when.iso) + '"' : "")
      + ' style="margin:0;display:block;width:100%;box-sizing:border-box;border:3px double #1b4d2e;color:#1b4d2e;padding:4px 6px 6px;text-align:center;background:#fff">'
      + '<div class="pay-approval-mark" style="font-weight:800;letter-spacing:.04em;font-size:9px;line-height:1.25">APPROVED BY JEFFREY JAMES CORRO</div>'
      + img
      + '<div class="pay-approval-who" style="font-weight:700;font-size:12px;margin-top:2px">' + esc(label) + "</div>"
      + (when ? '<div class="pay-approval-when" style="font-size:11px;margin-top:2px">' + esc(when.text) + "</div>" : "")
      + "</div>";
  }

  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var REPORT_HEADS = ["Name", "Site", "Rate", "Days", "OT hours", "OT pay", "Other earnings", "Gross", "SSS", "PhilHealth", "Pag-IBIG", "Cash advance", "Uniform", "Late / undertime", "Net"];
  var NOTE_TITLES = {
    note: "Note",
    notes: "Note",
    caNote: "Cash advance",
    uniformNote: "Uniform",
    lateNote: "Late / undertime",
    sssNote: "SSS",
    phicNote: "PhilHealth",
    hdmfNote: "Pag-IBIG",
    govNote: "Government contributions",
    govtNote: "Government contributions",
    govtNotes: "Government contributions",
    allowanceNote: "Allowance",
    incentiveNote: "Other earnings",
    otNote: "Overtime",
    holNote: "Holiday pay",
    otherNote: "Other earnings"
  };

  function ymdParts(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function shortRange(from, to) {
    var a = ymdParts(from);
    var b = ymdParts(to);
    if (!a || !b) return "";
    var as = MONTHS_SHORT[a.m - 1] || "";
    var bs = MONTHS_SHORT[b.m - 1] || "";
    if (a.y === b.y && a.m === b.m) return as + " " + a.d + "–" + b.d + ", " + b.y;
    if (a.y === b.y) return as + " " + a.d + "–" + bs + " " + b.d + ", " + b.y;
    return as + " " + a.d + ", " + a.y + "–" + bs + " " + b.d + ", " + b.y;
  }

  function longRange(from, to) {
    var a = ymdParts(from);
    var b = ymdParts(to);
    if (!a || !b) return "";
    var al = MONTHS_LONG[a.m - 1] || "";
    var bl = MONTHS_LONG[b.m - 1] || "";
    if (a.y === b.y && a.m === b.m) return a.d + "–" + b.d + " " + al + " " + a.y;
    if (a.y === b.y) return a.d + " " + al + "–" + b.d + " " + bl + " " + a.y;
    return a.d + " " + al + " " + a.y + "–" + b.d + " " + bl + " " + b.y;
  }

  function longDay(iso) {
    var a = ymdParts(iso);
    if (!a) return "";
    return a.d + " " + (MONTHS_LONG[a.m - 1] || "") + " " + a.y;
  }

  function reportStatus(run) {
    var s = String(run && run.status || "").trim().toLowerCase();
    if (s === "approved") return "approved";
    if (s === "submitted" || s === "submitted for approval") return "submitted";
    return "draft";
  }

  function reportKindWord(run) {
    return (run && run.kind) === "semi" ? "semi-monthly" : "weekly";
  }

  function moneyCents(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return Math.round(x * 100);
  }

  function moneyAmount(cents) {
    var neg = cents < 0;
    var s = (Math.abs(cents) / 100).toFixed(2);
    var parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + parts[0] + "." + parts[1];
  }

  function pesoCell(n) {
    var c = moneyCents(n);
    if (!c) return "—";
    return "₱" + moneyAmount(c);
  }

  function qtyCell(n) {
    var x = Number(n);
    if (!isFinite(x) || moneyCents(x) === 0) return "—";
    var rounded = Math.round(x * 100) / 100;
    if (Math.abs(rounded - Math.round(rounded)) < 0.001) return String(Math.round(rounded));
    return String(rounded);
  }

  function otherEarnings(L) {
    if (L && L.otherEarnings != null && L.otherEarnings !== "") return Number(L.otherEarnings) || 0;
    return (Number(L && L.allowance) || 0) + (Number(L && L.incentive) || 0) + (Number(L && L.holPay) || 0) + (Number(L && L.addl) || 0);
  }

  function shownDeductions(L) {
    return (Number(L.sss) || 0) + (Number(L.phic) || 0) + (Number(L.hdmf) || 0)
      + (Number(L.ca) || 0) + (Number(L.uniform) || 0) + (Number(L.late) || 0);
  }

  function reportName(name) {
    var s = String(name || "").trim();
    var p = s.split(",");
    if (p.length > 1 && p[0].trim() && p[1].trim()) return (p.slice(1).join(",").trim() + " " + p[0].trim()).replace(/\s+/g, " ");
    return s;
  }

  function includedLines(run) {
    return (run.lines || []).filter(function (L) {
      return moneyCents(L && L.net) !== 0;
    });
  }

  function noteTitle(key) {
    if (NOTE_TITLES[key]) return NOTE_TITLES[key];
    var raw = String(key || "").replace(/Notes?$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
    raw = raw.replace(/[_-]+/g, " ").trim();
    if (!raw) return "Note";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  function lineNotes(L) {
    var found = [];
    var seen = {};
    function take(key) {
      if (!key || seen[key] || !L || !Object.prototype.hasOwnProperty.call(L, key)) return;
      seen[key] = true;
      var v = L[key];
      if (v == null) return;
      if (typeof v !== "string" && typeof v !== "number") return;
      var text = String(v).trim();
      if (!text) return;
      if (typeof v === "number") return;
      found.push({ key: key, title: noteTitle(key), text: text });
    }
    ["caNote", "uniformNote", "lateNote", "sssNote", "phicNote", "hdmfNote", "govNote", "govtNote", "govtNotes", "allowanceNote", "incentiveNote", "otNote", "holNote", "otherNote", "note", "notes"].forEach(take);
    Object.keys(L || {}).forEach(function (k) {
      if (/Note$/.test(k) || k === "govtNotes") take(k);
    });
    return found;
  }

  function decisionItems(run, lines) {
    var items = [];
    var runNote = String((run && (run.note || run.notes)) || "").trim();
    if (runNote) items.push({ who: "", title: "Payrun note", text: runNote });
    (lines || []).forEach(function (L) {
      var who = reportName(L.name) || "Employee";
      lineNotes(L).forEach(function (n) {
        if (n.key === "note" || n.key === "notes") items.push({ who: who, title: who, text: n.text });
        else items.push({ who: who, title: who + " — " + n.title, text: n.text });
      });
    });
    return items;
  }

  function paginateReport(rows) {
    if (rows.length <= 5) return [rows];
    var pages = [];
    var i = 0;
    var first = Math.min(8, rows.length - 1);
    pages.push(rows.slice(0, first));
    i = first;
    while (i < rows.length) {
      var remain = rows.length - i;
      if (remain <= 5) {
        pages.push(rows.slice(i));
        break;
      }
      var take = Math.min(12, remain - 5);
      if (take < 1) take = remain;
      pages.push(rows.slice(i, i + take));
      i += take;
    }
    return pages;
  }

  function reportCss() {
    return "<style>"
      + "@page{size:A4 landscape;margin:10mm 12mm 12mm}"
      + ".pay-rpt,.pay-rpt *{font-family:\"Segoe UI\",Calibri,Arial,sans-serif;box-sizing:border-box}"
      + ".pay-rpt{color:#1c1c1c}"
      + ".pay-rpt-page{position:relative;background:#fff;min-height:170mm;page-break-after:always;break-after:page;overflow:hidden}"
      + ".pay-rpt-page:last-child{page-break-after:auto;break-after:auto}"
      + ".pay-rpt-watermark{position:absolute;left:12%;top:34%;font-size:78px;font-weight:800;letter-spacing:.18em;color:rgba(196,107,42,.16);transform:rotate(-28deg);pointer-events:none;z-index:0}"
      + ".pay-rpt-head,.pay-rpt-foot,.pay-rpt-body{position:relative;z-index:1}"
      + ".pay-rpt-head{display:flex;gap:12px;align-items:flex-start;padding-bottom:6px;border-bottom:2px solid #1f3a5f;margin-bottom:8px}"
      + ".pay-rpt-logo{height:36px;width:auto;max-width:150px;object-fit:contain;display:block}"
      + ".pay-rpt-head-main{flex:1;min-width:0}"
      + ".pay-rpt-title{font-size:16px;font-weight:800;color:#1f3a5f;line-height:1.2}"
      + ".pay-rpt-sub{font-size:10px;margin-top:2px;color:#243044}"
      + ".pay-rpt-meta{font-size:9px;color:#6b7280;margin-top:2px}"
      + ".pay-rpt-pill{display:inline-block;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700;color:#fff;background:#1e6b4f;white-space:nowrap}"
      + ".pay-rpt-pill.draft{background:#c46b2a}"
      + ".pay-rpt-pill.other{background:#6e6a64}"
      + ".pay-rpt-kpis{display:flex;gap:4px;margin:0 0 8px}"
      + ".pay-rpt-kpi{flex:1;border:1px solid #d5dbe3;min-width:0;background:#fff}"
      + ".pay-rpt-kpi-l{background:#1f3a5f;color:#fff;font-size:8px;letter-spacing:.04em;text-transform:uppercase;padding:3px 4px;text-align:center}"
      + ".pay-rpt-kpi-v{padding:6px 3px;text-align:center;font-size:12px}"
      + ".pay-rpt-kpi[data-kpi='gross']{background:#e7f2fb}"
      + ".pay-rpt-kpi[data-kpi='net']{background:#eaf7ef}"
      + ".pay-rpt-kpi[data-kpi='gross'] .pay-rpt-kpi-v,.pay-rpt-kpi[data-kpi='net'] .pay-rpt-kpi-v{font-weight:800}"
      + ".pay-rpt-intro{font-size:11px;line-height:1.4;margin:0 0 8px}"
      + ".pay-rpt-table{width:100%;border-collapse:collapse;font-size:8.5px}"
      + ".pay-rpt-table th{background:#1f3a5f;color:#fff;font-weight:700;text-align:right;padding:4px 3px;border:1px solid #1f3a5f}"
      + ".pay-rpt-table th:first-child,.pay-rpt-table td:first-child{text-align:left}"
      + ".pay-rpt-table td{padding:3px;border:1px solid #e1e6ee;vertical-align:top}"
      + ".pay-rpt-table tbody tr:nth-child(even) td{background:#f6f8fb}"
      + ".pay-rpt-table td.pay-rpt-net,.pay-rpt-table tr.pay-rpt-total td.pay-rpt-net{background:#eaf7ef;font-weight:700}"
      + ".pay-rpt-name{font-weight:700}"
      + ".pay-rpt-subname{display:block;color:#6b7280;font-weight:400;font-size:8px}"
      + ".pay-rpt-total td{font-weight:800;background:#eef2f7;border-top:2px solid #1f3a5f}"
      + ".pay-rpt-row{break-inside:avoid;page-break-inside:avoid}"
      + ".pay-rpt-decisions{margin-top:10px;background:#eaf7ef;border:1.5px solid #1e6b4f;padding:8px 10px}"
      + ".pay-rpt-decisions h3{margin:0 0 6px;color:#1e6b4f;font-size:12px}"
      + ".pay-rpt-decisions ol{margin:0;padding-left:18px}"
      + ".pay-rpt-decisions li{margin:0 0 6px}"
      + ".pay-rpt-sign{display:flex;gap:12px;margin-top:12px;align-items:stretch}"
      + ".pay-rpt-sign-col{flex:1;min-width:0}"
      + ".pay-rpt-sign-who{font-weight:700;font-size:11px;margin-bottom:4px}"
      + ".pay-rpt-sign-line{border-bottom:1px solid #1f3a5f;height:36px;margin-bottom:3px}"
      + ".pay-rpt-sign-cap{font-size:9px;color:#6b7280}"
      + ".pay-rpt-stamp-slot{flex:0 1 210px;width:210px;max-width:28%;box-sizing:border-box;border:1.5px solid #1f3a5f;background:#fff;display:flex;align-items:center;justify-content:center;padding:6px;min-height:78px}"
      + ".pay-rpt-paid{font-size:9px;color:#6b7280;margin-top:8px}"
      + ".pay-rpt-foot{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:8px;padding-top:4px;border-top:1px solid #d5dbe3;font-size:9px;color:#6b7280}"
      + ".pay-rpt-foot-ok{color:#1e6b4f;font-weight:800}"
      + "</style>";
  }

  function reportHeader(run, approved, status, when, printed) {
    var kindWord = reportKindWord(run);
    var titleKind = kindWord === "semi-monthly" ? "Semi-monthly Payroll Report" : "Weekly Payroll Report";
    var range = shortRange(run.from, run.to);
    var period = longRange(run.from, run.to);
    var release = longDay(run.release);
    var id = run.runId || ((run.kind || "weekly") + "|" + (run.from || ""));
    var logo = String(run.logo || "").trim();
    var statusWord = status.toUpperCase();
    var meta = "Payrun " + id + " · Status: " + statusWord;
    if (approved && when) meta += " · Approved " + when.text;
    if (printed) meta += " · Printed " + printed.day + ", " + printed.clockShort + " Asia/Manila";
    var pill;
    if (approved) {
      pill = '<span class="pay-rpt-pill" data-pay-pill="approved">APPROVED by Jeffrey James Corro'
        + (when ? ", " + esc(when.day) : "") + "</span>";
    } else if (status === "draft") {
      pill = '<span class="pay-rpt-pill draft" data-pay-pill="draft">DRAFT</span>';
    } else {
      pill = '<span class="pay-rpt-pill other" data-pay-pill="' + esc(status) + '">' + esc(statusWord) + "</span>";
    }
    return '<header class="pay-rpt-head">'
      + (logo ? '<img class="pay-rpt-logo" src="' + esc(logo) + '" alt="CorConDev">' : '<div class="pay-rpt-logo" aria-hidden="true"></div>')
      + '<div class="pay-rpt-head-main">'
      + '<div class="pay-rpt-title">' + esc(titleKind + (range ? ", " + range : "")) + "</div>"
      + '<div class="pay-rpt-sub">Corcondev · Corro Const. Development and Trade Corporation · Period '
      + esc(period || "—") + " · Release " + esc(release || "—") + "</div>"
      + '<div class="pay-rpt-meta">' + esc(meta) + "</div>"
      + "</div>"
      + "<div>" + pill + "</div>"
      + "</header>";
  }

  function reportFooter(run, approved, status, when, pageNo, pageCount) {
    var kindWord = reportKindWord(run);
    var left = (approved ? "Approved " : status === "submitted" ? "Submitted " : "Draft ")
      + kindWord + " payroll report · Confidential";
    var mid = approved
      ? '<span class="pay-rpt-foot-ok">APPROVED by Jeffrey James Corro' + (when ? ", " + esc(when.day) : "") + "</span>"
      : "<span></span>";
    return '<footer class="pay-rpt-foot"><span>' + esc(left) + "</span>" + mid
      + "<span>Page " + pageNo + " of " + pageCount + "</span></footer>";
  }

  function sumCents(lines, pick) {
    var c = 0;
    lines.forEach(function (L) { c += moneyCents(pick(L)); });
    return c;
  }

  function kpiStrip(lines) {
    var people = lines.length;
    var days = sumCents(lines, function (L) { return L.days; });
    var ot = sumCents(lines, function (L) { return L.ot; });
    var otPay = sumCents(lines, function (L) { return L.otPay; });
    var other = sumCents(lines, otherEarnings);
    var gross = sumCents(lines, function (L) { return L.gross; });
    var ded = sumCents(lines, function (L) { return L.sss; })
      + sumCents(lines, function (L) { return L.phic; })
      + sumCents(lines, function (L) { return L.hdmf; })
      + sumCents(lines, function (L) { return L.ca; })
      + sumCents(lines, function (L) { return L.uniform; })
      + sumCents(lines, function (L) { return L.late; });
    var net = sumCents(lines, function (L) { return L.net; });
    var boxes = [
      ["people", "People", String(people), String(people)],
      ["days", "Days", qtyCell(days / 100), moneyAmount(days)],
      ["ot", "OT hours", qtyCell(ot / 100), moneyAmount(ot)],
      ["otPay", "OT pay", pesoCell(otPay / 100), moneyAmount(otPay)],
      ["other", "Other earnings", pesoCell(other / 100), moneyAmount(other)],
      ["gross", "GROSS", pesoCell(gross / 100), moneyAmount(gross)],
      ["deductions", "Deductions", pesoCell(ded / 100), moneyAmount(ded)],
      ["net", "NET", pesoCell(net / 100), moneyAmount(net)]
    ];
    return '<div class="pay-rpt-kpis">' + boxes.map(function (b) {
      return '<div class="pay-rpt-kpi" data-kpi="' + b[0] + '" data-amount="' + esc(b[3]) + '">'
        + '<div class="pay-rpt-kpi-l">' + esc(b[1]) + "</div>"
        + '<div class="pay-rpt-kpi-v">' + esc(b[2]) + "</div></div>";
    }).join("") + "</div>";
  }

  function introHtml(run, status) {
    var id = run.runId || ((run.kind || "weekly") + "|" + (run.from || ""));
    var kindWord = reportKindWord(run);
    var text = "This is the " + status + " " + kindWord + " payroll report. Figures come from the live HR portal payrun "
      + id + " (status " + status + ").";
    var note = String(run.note || run.notes || "").trim();
    if (note) text += " " + note;
    return '<p class="pay-rpt-intro">' + esc(text) + "</p>";
  }

  function tableHead() {
    return "<thead><tr>" + REPORT_HEADS.map(function (name) {
      return "<th>" + esc(name) + "</th>";
    }).join("") + "</tr></thead>";
  }

  function moneyTd(key, n, net, total) {
    var amount = moneyAmount(moneyCents(n));
    var shown = key === "days" || key === "ot" ? qtyCell(n) : pesoCell(n);
    return '<td class="' + (net ? "pay-rpt-net" : "num") + '"'
      + (total ? ' data-total="' + key + '" data-amount="' + esc(amount) + '"' : "")
      + ">" + esc(shown) + "</td>";
  }

  function rowHtml(L) {
    var subBits = [];
    if (L.empNo) subBits.push("#" + L.empNo);
    if (L.position) subBits.push(L.position);
    var sub = subBits.join(" · ");
    var other = otherEarnings(L);
    return '<tr class="pay-rpt-row">'
      + "<td><span class=\"pay-rpt-name\">" + esc(reportName(L.name) || "—") + "</span>"
      + (sub ? '<span class="pay-rpt-subname">' + esc(sub) + "</span>" : "") + "</td>"
      + "<td>" + esc(L.site || "—") + "</td>"
      + moneyTd("rate", L.daily)
      + moneyTd("days", L.days)
      + moneyTd("ot", L.ot)
      + moneyTd("otPay", L.otPay)
      + moneyTd("other", other)
      + moneyTd("gross", L.gross)
      + moneyTd("sss", L.sss)
      + moneyTd("phic", L.phic)
      + moneyTd("hdmf", L.hdmf)
      + moneyTd("ca", L.ca)
      + moneyTd("uniform", L.uniform)
      + moneyTd("late", L.late)
      + moneyTd("net", L.net, true, false)
      + "</tr>";
  }

  function totalRow(lines) {
    function sum(pick) {
      var c = 0;
      lines.forEach(function (L) { c += moneyCents(pick(L)); });
      return c / 100;
    }
    return '<tr class="pay-rpt-total"><td>TOTAL</td><td></td>'
      + moneyTd("rate", 0, false, true)
      + moneyTd("days", sum(function (L) { return L.days; }), false, true)
      + moneyTd("ot", sum(function (L) { return L.ot; }), false, true)
      + moneyTd("otPay", sum(function (L) { return L.otPay; }), false, true)
      + moneyTd("other", sum(otherEarnings), false, true)
      + moneyTd("gross", sum(function (L) { return L.gross; }), false, true)
      + moneyTd("sss", sum(function (L) { return L.sss; }), false, true)
      + moneyTd("phic", sum(function (L) { return L.phic; }), false, true)
      + moneyTd("hdmf", sum(function (L) { return L.hdmf; }), false, true)
      + moneyTd("ca", sum(function (L) { return L.ca; }), false, true)
      + moneyTd("uniform", sum(function (L) { return L.uniform; }), false, true)
      + moneyTd("late", sum(function (L) { return L.late; }), false, true)
      + moneyTd("net", sum(function (L) { return L.net; }), true, true)
      + "</tr>";
  }

  function decisionsHtml(run, lines, status) {
    var items = decisionItems(run, lines);
    if (!items.length) return "";
    var title = status === "approved" ? "Decisions on this approved run" : "Notes on this draft run";
    if (status === "submitted") title = "Notes on this submitted run";
    return '<section class="pay-rpt-decisions"><h3>' + esc(title) + "</h3><ol>"
      + items.map(function (item) {
        return "<li><div class=\"pay-rpt-dec-title\"><b>" + esc(item.title) + "</b></div><div>" + esc(item.text) + "</div></li>";
      }).join("")
      + "</ol></section>";
  }

  function signOffHtml(run, approved, when) {
    var name = String(run.signatoryName || run.signatory || SIGN_APPR).trim() || SIGN_APPR;
    var title = String(run.signatoryTitle || "CEO / President").trim() || "CEO / President";
    var label = name + ", " + title;
    var src = approved ? String(run.signatorySrc || run.signatureSrc || "").trim() : "";
    var img = src
      ? '<img class="pay-approval-sig" src="' + esc(src) + '" alt="E-signature of ' + esc(name) + '" style="max-height:48px;max-width:168px;display:block;margin:0 auto 4px;background:#fff">'
      : "";
    var approvedCol = '<div class="pay-rpt-sign-col"><div class="pay-rpt-sign-who">Approved by</div>'
      + img
      + '<div class="pay-rpt-sign-line"></div>'
      + (approved
        ? '<div class="pay-rpt-sign-cap">' + esc(label) + (when ? "<br>" + esc(when.text) : "") + "</div>"
        : '<div class="pay-rpt-sign-cap">Name and date</div>')
      + "</div>";
    var blank = function (who) {
      return '<div class="pay-rpt-sign-col"><div class="pay-rpt-sign-who">' + esc(who) + "</div>"
        + '<div class="pay-rpt-sign-line"></div><div class="pay-rpt-sign-cap">Name and date</div></div>';
    };
    var stamp = approved ? approvalStampHtml(run) : "";
    var kindWord = reportKindWord(run);
    var paid = "";
    if (approved && when) {
      paid = '<p class="pay-rpt-paid">This ' + esc(kindWord) + " payroll has been approved by Jeffrey James Corro on "
        + esc(when.day) + " and may be paid. Amounts were not changed at approval.</p>";
    }
    /* The slot is the rectangle beside the signature block. The stamp sits
       inside it. A draft has no slot, so the page does not keep an empty box. */
    var slot = stamp
      ? '<div class="pay-rpt-stamp-slot" data-pay-stamp-slot="approved">' + stamp + "</div>"
      : "";
    return '<section class="pay-rpt-signoff"><div class="pay-rpt-sign">'
      + blank("Prepared by") + blank("Checked by") + approvedCol
      + slot
      + "</div>" + paid + "</section>";
  }

  function printHTML(run) {
    run = run || {};
    var approved = payRunApproved(run);
    var status = reportStatus(run);
    var when = approved ? manilaApprovalWhen(run.approvedAt) : null;
    var printed = manilaApprovalWhen(run.printedAt || new Date().toISOString());
    var lines = includedLines(run);
    var pages = paginateReport(lines);
    if (!pages.length) pages = [[]];
    var pageCount = pages.length;
    var h = reportCss() + '<div class="pay-rpt" data-pay-report="1">';
    pages.forEach(function (chunk, idx) {
      var last = idx === pageCount - 1;
      h += '<section class="pay-rpt-page" data-page="' + (idx + 1) + '">';
      if (status === "draft") h += '<div class="pay-rpt-watermark" aria-hidden="true">DRAFT</div>';
      h += reportHeader(run, approved, status, when, printed);
      h += '<div class="pay-rpt-body">';
      if (idx === 0) {
        h += kpiStrip(lines);
        h += introHtml(run, status);
      }
      h += '<table class="pay-rpt-table">' + tableHead() + "<tbody>";
      chunk.forEach(function (L) { h += rowHtml(L); });
      if (last) h += totalRow(lines);
      h += "</tbody></table>";
      if (last) {
        h += decisionsHtml(run, lines, status);
        h += signOffHtml(run, approved, when);
      }
      h += "</div>";
      h += reportFooter(run, approved, status, when, idx + 1, pageCount);
      h += "</section>";
    });
    h += "</div>";
    return h;
  }

  /**
   * Read-only explanation of a payroll line. Does not reprice the line.
   * Counted rows are the figures already on the line. Their centavo sum is
   * compared with the gross or deduction total the screen shows.
   */
  function cents(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return Math.round(x * 100);
  }
  function fromCents(c) { return c / 100; }

  function pesoText(n) {
    var c = cents(n);
    var neg = c < 0;
    var s = (Math.abs(c) / 100).toFixed(2);
    var parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + "₱" + parts.join(".");
  }

  function flagOn(saved, line, key) {
    return !!((saved && saved[key]) || (line && line[key]));
  }

  function payBreakdown(line, ctx) {
    line = line || {};
    ctx = ctx || {};
    var saved = ctx.saved || {};
    var kind = ctx.kind || "weekly";
    var dedRows = [];
    var earnRows = [];
    var dedAside = [];
    var earnAside = [];

    function push(list, row) {
      row.amount = fromCents(cents(row.amount));
      if (row.computed != null && row.computed !== "") row.computed = fromCents(cents(row.computed));
      else row.computed = null;
      if (row.counts == null) row.counts = true;
      row.override = !!row.override;
      row.marker = row.override ? "Touched" : "computed";
      if (row.caf == null) row.caf = "";
      list.push(row);
    }

    var daysN = Number(line.days) || 0;
    var daily = Number(line.daily) || 0;
    var otHours = Number(line.ot) || 0;
    var hourly = line.hourly != null ? Number(line.hourly) : (daily / 8);
    var otX = ctx.otMultiplier != null ? Number(ctx.otMultiplier) : (line.otMultiplier != null ? Number(line.otMultiplier) : 1);
    if (!isFinite(otX)) otX = 1;

    push(earnRows, {
      key: "basic",
      label: "Basic pay",
      amount: line.basic,
      source: "Daily Manpower",
      detail: daysN + " day" + (daysN === 1 ? "" : "s") + " × " + pesoText(daily)
    });
    (line.rows || []).forEach(function (r) {
      var qty = Number(r && r.day) || 0;
      if (!(qty > 0)) return;
      var rate = r.daily != null ? Number(r.daily) : daily;
      push(earnRows, {
        key: "day:" + (r.date || ""),
        label: "Basic day",
        amount: fromCents(cents(qty * rate)),
        source: "Daily Manpower",
        detail: (r.date || "day") + " · " + qty + " day" + (r.site ? " · " + r.site : "") + " · part of basic pay, not added again",
        counts: false,
        parent: "basic"
      });
    });
    push(earnRows, {
      key: "ot",
      label: "Overtime",
      amount: line.otPay,
      source: "Daily Manpower",
      detail: otHours + " hr × " + pesoText(hourly) + (otX !== 1 ? " × " + otX : "")
    });
    (line.rows || []).forEach(function (r) {
      var hrs = Number(r && r.ot) || 0;
      if (!(hrs > 0)) return;
      var rate = r.hourly != null ? Number(r.hourly) : hourly;
      push(earnRows, {
        key: "ot:" + (r.date || ""),
        label: "Overtime hours",
        amount: fromCents(cents(hrs * rate * otX)),
        source: "Daily Manpower",
        detail: (r.date || "day") + " · " + hrs + " hr" + (r.site ? " · " + r.site : "") + " · part of overtime, not added again",
        counts: false,
        parent: "ot"
      });
    });
    var holBits = [];
    if (Number(line.hol30)) holBits.push(line.hol30 + " × 30%");
    if (Number(line.hol100)) holBits.push(line.hol100 + " × 100%");
    push(earnRows, {
      key: "hol",
      label: "Holiday / rest-day premium",
      amount: line.holPay,
      source: "Daily Manpower",
      detail: holBits.join(" + ") || "no premium day"
    });
    var allowanceTyped = saved.allowance != null && saved.allowance !== "";
    push(earnRows, {
      key: "allowance",
      label: "Allowance",
      amount: line.allowance,
      source: allowanceTyped ? "typed on this run" : "employee allowance",
      detail: allowanceTyped ? "kept with this run" : "from the 201 allowance"
    });
    push(earnRows, {
      key: "incentive",
      label: "Additional pay",
      amount: line.incentive != null ? line.incentive : line.addl,
      source: "typed on this run",
      detail: "additional or incentive on this run"
    });
    var pending = Number(line.otPending || line.otNoForm) || 0;
    if (pending > 0) {
      earnAside.push({
        key: "ot-pending",
        label: "Overtime not in pay",
        amount: 0,
        counts: false,
        source: "Daily Manpower",
        detail: pending + " hr on Daily Manpower not included in overtime pay",
        override: false,
        marker: "computed",
        caf: ""
      });
    }

    function statRow(key, label) {
      var touched = flagOn(saved, line, "statTouched");
      push(dedRows, {
        key: key,
        label: label,
        amount: line[key],
        source: "contribution table",
        override: touched,
        detail: touched
          ? "Touched override on this run. The amount is what this payroll uses."
          : (line.govSkip ? String(line.govSkip) : (line.refusedContrib ? "refused on the 201 — contribution table" : "contribution table"))
      });
    }
    statRow("sss", "SSS");
    statRow("phic", "PhilHealth");
    statRow("hdmf", kind === "semi" ? "HMIC" : "Pag-IBIG");
    var taxTouched = flagOn(saved, line, "taxTouched");
    push(dedRows, {
      key: "tax",
      label: "Withholding tax",
      amount: line.tax,
      source: taxTouched ? "manual override" : "contribution table",
      override: taxTouched,
      detail: (Number(line.tax) || 0) ? "withholding tax on this line" : "no withholding tax on this run"
    });

    var items = (line.caDetail && line.caDetail.items) || ctx.caItems || [];
    if (!Array.isArray(items)) items = [];
    var caTouch = flagOn(saved, line, "caTouched");
    var caCents = cents(line.ca);
    var itemCents = 0;
    items.forEach(function (it) { itemCents += cents(it && it.amount); });
    function cafLabel(caf) {
      var s = String(caf || "").trim();
      if (!s) return "CAF number not on this record";
      return /^caf/i.test(s) ? s : ("CAF " + s);
    }
    function caDetailText(it) {
      var caf = String((it && (it.no || it.caf || it.cafNo)) || "").trim();
      var hits = Number(it && it.installment) || 0;
      var bits = [];
      bits.push(cafLabel(caf));
      if (it && it.id) bits.push(String(it.id));
      if (hits > 0) bits.push(hits + " installment" + (hits === 1 ? "" : "s") + " this period");
      if (it && it.balanceBefore != null && it.balanceBefore !== "") bits.push("before " + pesoText(it.balanceBefore));
      if (it && it.balanceAfter != null && it.balanceAfter !== "") bits.push("remaining " + pesoText(it.balanceAfter));
      return bits.join(" · ");
    }
    function caChild(it, counts, idx) {
      var caf = String((it && (it.no || it.caf || it.cafNo)) || "").trim();
      push(dedRows, {
        key: "ca:" + (it && it.id ? it.id : (caf || "row")) + ":" + idx,
        label: "Cash advance",
        amount: it ? it.amount : 0,
        source: "CA record",
        sourceId: (it && it.id) || "",
        caf: caf,
        balance: it ? it.balanceAfter : null,
        balanceBefore: it ? it.balanceBefore : null,
        override: caTouch,
        computed: caTouch ? (it ? it.amount : 0) : null,
        counts: counts,
        detail: caDetailText(it) + (counts ? "" : " · schedule for this record, not added again")
      });
    }
    if (items.length && itemCents === caCents) {
      items.forEach(function (it, i) { caChild(it, true, i); });
    } else if (items.length) {
      var cafList = items.map(function (it) { return String((it && (it.no || it.caf || it.cafNo)) || "").trim(); }).filter(Boolean);
      push(dedRows, {
        key: "ca",
        label: "Cash advance",
        amount: line.ca,
        source: "CA record",
        override: caTouch,
        computed: fromCents(itemCents),
        caf: cafList.join(", "),
        detail: (caTouch ? "Touched override. " : "") + "Cash advance records add up to " + pesoText(fromCents(itemCents)) + "."
      });
      items.forEach(function (it, i) { caChild(it, false, i); });
    } else {
      push(dedRows, {
        key: "ca",
        label: "Cash advance",
        amount: line.ca,
        source: caTouch ? "manual override" : "CA record",
        override: caTouch,
        computed: caTouch ? 0 : null,
        detail: caTouch ? "Touched override. No cash advance record on this line." : "no cash advance this period"
      });
    }

    function loanRow(key, label) {
      var touched = flagOn(saved, line, key + "Touched");
      var rec = line[key + "Recur"] || null;
      var bag = ctx.emp && ctx.emp.recur && ctx.emp.recur[key];
      var scheduled = null;
      if (touched) {
        var srcBag = rec || bag;
        if (srcBag) {
          var amt = Number(srcBag.amount) || 0;
          var bal = srcBag.balanceBefore != null ? Number(srcBag.balanceBefore)
            : (srcBag.balance == null || srcBag.balance === "" ? amt : Number(srcBag.balance));
          scheduled = (!(bal > 0) || !(amt > 0)) ? 0 : Math.min(amt, bal);
        }
      }
      var left = rec && rec.balanceAfter != null ? rec.balanceAfter
        : (bag && bag.balance != null && bag.balance !== "" ? bag.balance : null);
      push(dedRows, {
        key: key,
        label: label,
        amount: line[key],
        source: "recurring deduction record",
        override: touched,
        computed: scheduled,
        balance: left,
        detail: left != null && left !== "" ? ("remaining " + pesoText(left)) : "recurring loan"
      });
    }
    loanRow("sssLoan", "SSS loan");
    loanRow("hdmfLoan", "Pag-IBIG loan");

    var uniTouch = flagOn(saved, line, "uniformTouched");
    var uni = line.uniformRecur || (ctx.emp && ctx.emp.recur && ctx.emp.recur.uniform) || null;
    var uniLeft = uni && (uni.balanceAfter != null ? uni.balanceAfter : uni.balance);
    var uniScheduled = null;
    if (uniTouch && uni) {
      var uAmt = Number(uni.amount) || 0;
      var uBal = uni.balanceBefore != null ? Number(uni.balanceBefore)
        : (uni.balance == null || uni.balance === "" ? uAmt : Number(uni.balance));
      uniScheduled = (!(uBal > 0) || !(uAmt > 0)) ? 0 : Math.min(uAmt, uBal);
    }
    push(dedRows, {
      key: "uniform",
      label: "Uniform",
      amount: line.uniform,
      source: "recurring deduction record",
      override: uniTouch,
      computed: uniScheduled,
      balance: uniLeft,
      detail: uniLeft != null && uniLeft !== "" ? ("remaining " + pesoText(uniLeft)) : "uniform or shoes"
    });

    var recur = (ctx.emp && ctx.emp.recur) || {};
    Object.keys(recur).forEach(function (key) {
      if (key === "uniform" || key === "sssLoan" || key === "hdmfLoan") return;
      var bag = recur[key];
      if (!bag || typeof bag !== "object") return;
      var amount = Number(bag.amount) || 0;
      if (!(amount > 0)) return;
      dedAside.push({
        key: "recur:" + key,
        label: key,
        amount: fromCents(cents(amount)),
        counts: false,
        source: "recurring deduction record",
        detail: "other recurring deduction · not in this deduction total"
          + (bag.balance != null && bag.balance !== "" ? " · balance " + pesoText(bag.balance) : ""),
        override: false,
        marker: "computed",
        caf: ""
      });
    });

    var lateTouch = flagOn(saved, line, "lateTouched");
    var parts = Array.isArray(line.lateParts) ? line.lateParts : [];
    var mins = line.lateMin != null && line.lateMin !== "" ? Number(line.lateMin) || 0 : 0;
    if (!mins) parts.forEach(function (p) { mins += Number(p && p.minutes) || 0; });
    var partCents = 0;
    var hasParts = parts.length > 0;
    parts.forEach(function (p) { partCents += cents(p && p.amount); });
    push(dedRows, {
      key: "late",
      label: "Late / undertime",
      amount: line.late,
      minutes: mins,
      source: "attendance",
      override: lateTouch,
      computed: hasParts ? fromCents(partCents) : (lateTouch ? null : null),
      detail: mins + " min from attendance"
        + (lateTouch ? " · Touched override. The amount is what this payroll uses." : "")
    });
    parts.forEach(function (p, i) {
      var under = p && String(p.kind || "").indexOf("under") === 0;
      push(dedRows, {
        key: "late:" + (p && p.date ? p.date : i) + ":" + (p && p.kind || ""),
        label: under ? "Undertime" : "Late",
        amount: p ? p.amount : 0,
        minutes: p ? p.minutes : 0,
        source: "attendance",
        counts: false,
        parent: "late",
        detail: ((p && p.date) || "day") + " · " + (Number(p && p.minutes) || 0) + " min · part of late / undertime, not added again"
      });
    });

    (line.rows || []).forEach(function (r) {
      if (!r || String(r.s || "") !== "Absent") return;
      dedAside.push({
        key: "absent:" + (r.date || ""),
        label: "Absence",
        amount: 0,
        counts: false,
        source: "attendance",
        detail: (r.date || "day")
          + (r.reason ? " · " + r.reason : "")
          + " · day not credited · not a peso deduction on this total",
        override: false,
        marker: "computed",
        caf: ""
      });
    });

    function rollup(rows, aside, displayed) {
      var sumC = 0;
      rows.forEach(function (r) { if (r.counts !== false) sumC += cents(r.amount); });
      var totalC = cents(displayed);
      var diffC = totalC - sumC;
      return {
        total: fromCents(totalC),
        sum: fromCents(sumC),
        ok: diffC === 0,
        diff: fromCents(diffC),
        rows: rows,
        aside: aside
      };
    }

    return {
      empId: line.empId || "",
      name: line.name || "",
      deductions: rollup(dedRows, dedAside, line.ded),
      earnings: rollup(earnRows, earnAside, line.gross)
    };
  }

  function breakRowHtml(r) {
    var marker = r.override
      ? '<span class="pill warn">Touched</span>'
      : '<span class="pill mut">computed</span>';
    var differ = r.computed != null && cents(r.computed) !== cents(r.amount);
    var detail = esc(r.detail || "");
    if (differ) detail += (detail ? "<br>" : "") + "Computed " + esc(pesoText(r.computed));
    var item = (r.counts === false ? '<span class="lbl">↳ </span>' : "") + esc(r.label || "");
    if (r.caf) {
      var cafShown = /^caf/i.test(r.caf) ? r.caf : ("CAF " + r.caf);
      item += '<div class="mono">' + esc(cafShown) + "</div>";
    }
    var src = esc(r.source || "");
    if (r.sourceId) src += '<div class="mono">' + esc(r.sourceId) + "</div>";
    var amount = r.counts === false && !cents(r.amount) ? "—" : esc(pesoText(r.amount));
    return '<tr class="' + (r.counts === false ? "pay-break-part" : "pay-break-count") + (differ ? " pay-break-diff" : "") + '">'
      + "<td>" + item + "</td>"
      + "<td>" + detail + "</td>"
      + "<td>" + src + "</td>"
      + "<td>" + marker + (differ ? ' <span class="pill warn">check</span>' : "") + "</td>"
      + '<td class="num mono">' + amount + "</td></tr>";
  }

  function payBreakdownHtml(pack, opts) {
    pack = pack || {};
    opts = opts || {};
    var dedOpen = opts.dedOpen !== false;
    var earnOpen = !!opts.earnOpen;
    function section(block, id, title, open) {
      block = block || { total: 0, sum: 0, ok: true, diff: 0, rows: [], aside: [] };
      var h = '<details class="pay-break-live" id="pay-break-' + id + '"' + (open ? " open" : "") + ">"
        + "<summary><b>" + esc(title) + "</b> <span class=\"mono\">" + esc(pesoText(block.total)) + "</span>"
        + (block.ok ? "" : ' <span class="pill crit">Does not add up</span>')
        + "</summary>";
      if (!block.ok) {
        h += '<div class="pay-break-warn" role="alert"><b>These lines do not add up to the total on the payroll.</b> '
          + "The lines that count add up to " + esc(pesoText(block.sum))
          + ". The payroll shows " + esc(pesoText(block.total))
          + ". Difference " + esc(pesoText(block.diff)) + ".</div>";
      }
      h += '<p class="lbl" style="text-transform:none;letter-spacing:0;margin:6px 0">Indented lines explain the total above them. They are not added a second time. '
        + "Touched means a manual override on this run. Computed means the payroll filled it.</p>";
      h += '<div class="tw pay-break-table"><table><thead><tr>'
        + "<th>Item</th><th>Detail</th><th>Source</th><th>Marker</th><th class=\"num\">Amount</th>"
        + "</tr></thead><tbody>";
      (block.rows || []).forEach(function (r) { h += breakRowHtml(r); });
      (block.aside || []).forEach(function (r) { h += breakRowHtml(r); });
      if (!(block.rows || []).length && !(block.aside || []).length) {
        h += '<tr><td colspan="5">Nothing on this line.</td></tr>';
      }
      h += '</tbody><tfoot><tr><td colspan="4"><b>Lines that count</b></td><td class="num mono"><b>'
        + esc(pesoText(block.sum)) + "</b></td></tr>"
        + '<tr><td colspan="4"><b>Total on the payroll</b></td><td class="num mono"><b>'
        + esc(pesoText(block.total)) + "</b></td></tr></tfoot></table></div></details>";
      return h;
    }
    return section(pack.deductions, "ded", "Deductions", dedOpen)
      + section(pack.earnings, "earn", "Earnings", earnOpen);
  }

  root.hrPaySheet = {
    version: "2026-10-29a",
    WEEKLY_SITES: WEEKLY_SITES,
    SIGN_PREP: SIGN_PREP,
    SIGN_PREP_ROLE: SIGN_PREP_ROLE,
    SIGN_APPR: SIGN_APPR,
    SIGN_APPR_ROLE: SIGN_APPR_ROLE,
    clockMinutes: clockMinutes,
    lateExcused: lateExcused,
    lateForRow: lateForRow,
    lateForRows: lateForRows,
    weekSkipsGov: weekSkipsGov,
    weeklyHalf: weeklyHalf,
    statutoryOf: statutoryOf,
    periodAllowance: periodAllowance,
    priceLine: priceLine,
    pesoCeil: pesoCeil,
    ccdId: ccdId,
    payKindOf: payKindOf,
    rateOn: rateOn,
    recurTake: recurTake,
    leaveDayCredit: leaveDayCredit,
    decorateLine: decorateLine,
    payBreakdown: payBreakdown,
    payBreakdownHtml: payBreakdownHtml,
    openExceptions: openExceptions,
    auditRows: auditRows,
    workbook: workbook,
    toXlsx: toXlsx,
    screenHTML: screenHTML,
    auditHTML: auditHTML,
    printHTML: printHTML,
    payRunApproved: payRunApproved,
    manilaApprovalWhen: manilaApprovalWhen,
    approvalStampHtml: approvalStampHtml,
    periodLabel: periodLabel,
    dayLabel: dayLabel,
    siteOrder: siteOrder
  };
})(typeof window !== "undefined" ? window : globalThis);
