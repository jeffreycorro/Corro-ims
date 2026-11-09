/**
 * Project assignment on Daily Manpower and the per-project payroll summary.
 * Loaded before the in-page engine. Does not rewrite stored site strings.
 *
 * Canonical names are the dropdown. Suspected aliases stay off until
 * Settings → project aliases is ticked. Ticking a pair does not rewrite
 * daily rows or the 201 project. A blank site, or a name that is not
 * canonical and not a confirmed alias, is Unassigned.
 *
 * Pay runs: no status field means draft. Reading a run does not write one.
 * The live draft weekly|2026-10-29 is left as it was stored.
 */
"use strict";

var PAY_CANONICAL_PROJECTS = [
  "ADMINS",
  "UP She Shelter",
  "CTU Barili",
  "CTU Dumanjug (HM P2)",
  "CTU Dumanjug P3",
  "Tagba-o",
  "Labangon Chapel",
  "Tawason",
  "Danao SPLPA",
  "Danao Guinacot",
  "Banawa",
  "Danlag",
  "Balaga"
];

/* Suspected pairs only. confirmed stays false until HR ticks the setting.
   Nothing here is written back onto daily rows or employee.project. */
var PAY_PROJECT_ALIASES = [
  { alias: "Admins 2", to: "ADMINS", note: "Second admin label on daily rows (333). Same cost center as ADMINS only if HR confirms." },
  { alias: "Admins", to: "ADMINS", note: "Capitalization of ADMINS." },
  { alias: "UP SHE SHELTER", to: "UP She Shelter", note: "Company weekly sheet spells the shelter in capitals." },
  { alias: "UP- She Shelter", to: "UP She Shelter", note: "Motorpool project alias target." },
  { alias: "CTU BARILI", to: "CTU Barili", note: "Paste sample and attendance notes use capitals." },
  { alias: "CTU BARILI (VET MED)", to: "CTU Barili", note: "Company weekly sheet. May be the vet-med package, not the whole Barili site." },
  { alias: "CTU Barili Vet Med", to: "CTU Barili", note: "Settings seed project. May be a different package from CTU Barili." },
  { alias: "CTU Barili Dormitory", to: "CTU Barili", note: "Settings seed project. May be the dorm, not the same package." },
  { alias: "CTU BARILI DORM P2", to: "CTU Barili", note: "Company weekly sheet dorm package." },
  { alias: "CTU DUMANJUG P3", to: "CTU Dumanjug P3", note: "Company weekly sheet capitals for the P3 name." },
  { alias: "CTU Dumanjug HM Bldg.", to: "CTU Dumanjug (HM P2)", note: "Settings seed. HM building vs the daily HM P2 label — may be a different phase." },
  { alias: "CTU Dumanjug", to: "CTU Dumanjug P3", note: "Motorpool short name, mapped there to CTU-Dumanjug HM3." },
  { alias: "CTU-Dumanjug HM3", to: "CTU Dumanjug P3", note: "Motorpool project name. P3 and HM3 may be different phases." },
  { alias: "TAWASON", to: "Tawason", note: "Company weekly sheet capitals." },
  { alias: "Tawason Yard 2", to: "Tawason", note: "Daily rows (192). Yard versus the Tawason site." },
  { alias: "DANAO GUINACOT RD.", to: "Danao Guinacot", note: "Company weekly sheet. Danao Guinacot itself is already on the project list." },
  { alias: "Danao-SPLPA", to: "Danao SPLPA", note: "OT matching already treats the hyphen as the same area. Stored text is not rewritten." },
  { alias: "DANAO  SPLPA", to: "Danao SPLPA", note: "OT matching already folds the extra space and capitals." },
  { alias: "24HH0142 Labangon Chapel (Package B)", to: "Labangon Chapel", note: "Official project code versus the short name on daily rows." },
  { alias: "24HH0147 Labangon Road", to: "Labangon Chapel", note: "Settings seed. A different Labangon package — confirm before charging it to the chapel." },
  { alias: "Labangon - LP Balaga", to: "Labangon Chapel", note: "Motorpool fuel nickname. May belong to Balaga instead of the chapel." },
  { alias: "26HH0083 - Labangon", to: "Labangon Chapel", note: "Motorpool ledger name for the Labangon nickname." },
  { alias: "26HH0078 Tagbao FMR P3", to: "Tagba-o", note: "Company weekly sheet. Tagbao FMR P3 may not be the Tagba-o daily site." },
  { alias: "Tagbao FMR P3", to: "Tagba-o", note: "Motorpool short name for 26HH0078." },
  { alias: "25HH0023 Tagbao 3", to: "Tagba-o", note: "Settings seed. An earlier Tagbao package." }
];

var PAY_PROJECT_RULE = "Basic pay, overtime pay, holiday premium, and late or undertime follow the site on that day’s Daily Manpower row. Cash advance, uniform, loans, and government deductions (SSS, PhilHealth, Pag-IBIG) are split across the sites that person worked, in proportion to man-days. If they have no paid day, the split follows overtime hours. A blank site, or a name that is not on the project list and not a confirmed alias, is Unassigned. Confirming an alias does not rewrite stored rows or the 201 project. Net is each person’s rounded net, split by the same weights, so the project totals match the payroll totals.";

var PAY_PERIOD_DEDS = ["ca", "uniform", "sss", "phic", "hdmf", "sssLoan", "hdmfLoan"];

function payHtmlEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function payCanonKey(s) {
  return String(s == null ? "" : s)
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function payRound2(n) {
  return Math.round((Number(n) || 0) * 100 + (Number(n) < 0 ? -1e-9 : 1e-9)) / 100;
}

function payCanonicalProjects(extra) {
  var out = PAY_CANONICAL_PROJECTS.slice();
  var seen = {};
  out.forEach(function (n) { seen[payCanonKey(n)] = 1; });
  (extra || []).forEach(function (n) {
    var name = String(n || "").trim();
    var key = payCanonKey(name);
    if (!key || seen[key] || key === "unassigned") return;
    seen[key] = 1;
    out.push(name);
  });
  return out;
}

function payAliasConfirmedMap(settings) {
  var src = settings || null;
  if (src && src.projectAliasOn) src = src.projectAliasOn;
  var out = {};
  if (!src || typeof src !== "object") return out;
  Object.keys(src).forEach(function (k) {
    if (src[k]) out[payCanonKey(k)] = 1;
  });
  return out;
}

function payResolveSite(raw, opts) {
  opts = opts || {};
  var list = opts.canonical || PAY_CANONICAL_PROJECTS;
  var text = String(raw == null ? "" : raw).replace(/[\u00A0\u2007\u202F]/g, " ").trim();
  if (!text) return "Unassigned";
  var key = payCanonKey(text);
  var i;
  for (i = 0; i < list.length; i++) {
    if (payCanonKey(list[i]) === key) return list[i];
  }
  var aliases = opts.aliases || PAY_PROJECT_ALIASES;
  var confirmed = opts.confirmed || {};
  for (i = 0; i < aliases.length; i++) {
    var a = aliases[i];
    if (!a || payCanonKey(a.alias) !== key) continue;
    if (payCanonKey(a.alias) === payCanonKey(a.to)) continue;
    if (confirmed === true || confirmed[key] || confirmed[payCanonKey(a.alias)]) return a.to;
  }
  return "Unassigned";
}

function dailyProjectSelectHtml(current) {
  var extra = [];
  if (typeof projectList === "function") {
    projectList().forEach(function (p) {
      if (p && p.status !== "Closed" && p.name) extra.push(p.name);
    });
  }
  var names = payCanonicalProjects(extra);
  var cur = String(current == null ? "" : current);
  var html = names.map(function (n) {
    return "<option" + (n === cur ? " selected" : "") + ">" + payHtmlEsc(n) + "</option>";
  }).join("");
  if (cur && !names.some(function (n) { return n === cur; })) {
    html = '<option selected value="' + payHtmlEsc(cur) + '">' + payHtmlEsc(cur) + " (not on the project list)</option>" + html;
  }
  return html;
}

function assignDaySite(rec, empId, site, stamp) {
  var next = {};
  Object.keys(rec || {}).forEach(function (k) { next[k] = rec[k]; });
  var rows = {};
  Object.keys((rec && rec.rows) || {}).forEach(function (id) {
    var row = rec.rows[id];
    rows[id] = row && typeof row === "object" ? Object.assign({}, row) : row;
  });
  var prev = rows[empId] && typeof rows[empId] === "object" ? rows[empId] : { s: "Present", r: "" };
  var row = Object.assign({}, prev);
  row.site = site;
  if (stamp) {
    if (stamp.by) row.siteBy = stamp.by;
    if (stamp.at) row.siteAt = stamp.at;
  }
  rows[empId] = row;
  next.rows = rows;
  return next;
}

/* Updates site on rows that already exist. Does not create a day, a row, or a
   payable status, and does not read or write employee.project. */
function bulkAssignSites(days, empIds, site, stamp) {
  var want = {};
  (empIds || []).forEach(function (id) { if (id) want[id] = 1; });
  var changed = 0;
  var skipped = [];
  var out = (days || []).map(function (rec) {
    if (!rec) return rec;
    var copy = {};
    Object.keys(rec).forEach(function (k) { copy[k] = rec[k]; });
    var rows = {};
    Object.keys(rec.rows || {}).forEach(function (id) {
      var row = rec.rows[id];
      rows[id] = row && typeof row === "object" ? Object.assign({}, row) : row;
    });
    Object.keys(want).forEach(function (id) {
      if (!rows[id] || typeof rows[id] !== "object") {
        skipped.push({ date: rec.date || "", empId: id, why: "not on this day" });
        return;
      }
      if (rows[id].site === site && (!stamp || (rows[id].siteBy === stamp.by && rows[id].siteAt === stamp.at))) return;
      rows[id].site = site;
      if (stamp && stamp.by) rows[id].siteBy = stamp.by;
      if (stamp && stamp.at) rows[id].siteAt = stamp.at;
      changed++;
    });
    copy.rows = rows;
    return copy;
  });
  return { days: out, changed: changed, skipped: skipped };
}

function splitMoney(total, weights) {
  var w = (weights || []).map(function (n) { return Math.max(0, Number(n) || 0); });
  var out = w.map(function () { return 0; });
  var sign = (Number(total) || 0) < 0 ? -1 : 1;
  var cents = Math.round(Math.abs(Number(total) || 0) * 100);
  if (!w.length || !cents) return out;
  var sum = w.reduce(function (a, b) { return a + b; }, 0);
  if (!(sum > 0)) {
    out[0] = sign * cents / 100;
    return out;
  }
  var raw = w.map(function (x) { return (cents * x) / sum; });
  var base = raw.map(function (x) { return Math.floor(x + 1e-9); });
  var used = base.reduce(function (a, b) { return a + b; }, 0);
  var left = cents - used;
  var order = raw.map(function (x, i) {
    return { i: i, frac: x - Math.floor(x + 1e-9) };
  }).sort(function (a, b) { return b.frac - a.frac || a.i - b.i; });
  var k;
  for (k = 0; k < left; k++) base[order[k].i] += 1;
  return base.map(function (n) { return sign * n / 100; });
}

function payPositive(weights) {
  return (weights || []).some(function (n) { return Number(n) > 0; });
}

function payDayLateRaw(row, daily, opts) {
  if (opts && typeof opts.lateForRow === "function") {
    var hit = opts.lateForRow(row, daily) || {};
    return Number(hit.amount) || 0;
  }
  if (row && row.lateAmount != null && row.lateAmount !== "") return Number(row.lateAmount) || 0;
  return Number(row && row.lateMin) || 0;
}

function payProjectSummary(lines, opts) {
  opts = opts || {};
  var resolveOpts = {
    canonical: opts.canonical || payCanonicalProjects(opts.extraProjects || []),
    aliases: opts.aliases || PAY_PROJECT_ALIASES,
    confirmed: opts.confirmed || {}
  };
  var sites = {};
  function bucket(name) {
    if (!sites[name]) {
      sites[name] = {
        site: name, headcount: 0, emp: {}, days: 0, basic: 0, ot: 0, otPay: 0,
        gross: 0, late: 0, other: 0, ded: 0, net: 0, holPay: 0
      };
    }
    return sites[name];
  }
  (lines || []).forEach(function (L) {
    if (!L) return;
    var rows = L.rows || [];
    var acc = {};
    function touch(name) {
      if (!acc[name]) acc[name] = { days: 0, ot: 0, late: 0, hol: 0 };
      return acc[name];
    }
    if (!rows.length) {
      var only = payResolveSite(L.site, resolveOpts);
      var one = touch(only);
      one.days += Number(L.days) || 0;
      one.ot += Number(L.ot) || 0;
      one.late += Number(L.late) || 0;
      one.hol += Number(L.holPay) || 0;
    } else {
      rows.forEach(function (row) {
        var name = payResolveSite(row && row.site, resolveOpts);
        var bag = touch(name);
        bag.days += Number(row && row.day) || 0;
        bag.ot += Number(row && row.ot) || 0;
        bag.late += payDayLateRaw(row, L.daily, opts);
        bag.hol += (Number(row && row.holRate) || 0) * (Number(L.daily) || 0);
      });
    }
    var names = Object.keys(acc);
    if (!names.length) {
      names = ["Unassigned"];
      acc["Unassigned"] = { days: 0, ot: 0, late: 0, hol: 0 };
    }
    var dayW = names.map(function (n) { return acc[n].days; });
    var otW = names.map(function (n) { return acc[n].ot; });
    var lateW = names.map(function (n) { return acc[n].late; });
    var holW = names.map(function (n) { return acc[n].hol; });
    var periodW = payPositive(dayW) ? dayW : (payPositive(otW) ? otW : names.map(function () { return 1; }));
    var basicTarget = L.basic != null ? Number(L.basic) : (Number(L.days) || 0) * (Number(L.daily) || 0);
    var otPayTarget = L.otPay != null ? Number(L.otPay) : (Number(L.ot) || 0) * (Number(L.hourly) || 0) * (Number(opts.otPolicy != null ? opts.otPolicy : 1) || 0);
    var holTarget = L.holPay != null ? Number(L.holPay) : holW.reduce(function (a, b) { return a + b; }, 0);
    var basicParts = splitMoney(basicTarget, payPositive(dayW) ? dayW : periodW);
    var otParts = splitMoney(Number(L.ot) || 0, payPositive(otW) ? otW : periodW);
    var otPayParts = splitMoney(otPayTarget, payPositive(otW) ? otW : periodW);
    var holParts = splitMoney(holTarget, payPositive(holW) ? holW : periodW);
    var allowParts = splitMoney(Number(L.allowance) || 0, periodW);
    var incentParts = splitMoney(Number(L.incentive) || 0, periodW);
    var lateTarget = Number(L.late) || 0;
    var lateParts = splitMoney(lateTarget, payPositive(lateW) ? lateW : periodW);
    var otherParts = names.map(function () { return 0; });
    PAY_PERIOD_DEDS.forEach(function (key) {
      splitMoney(Number(L[key]) || 0, periodW).forEach(function (n, i) {
        otherParts[i] = payRound2(otherParts[i] + n);
      });
    });
    var otherTarget = payRound2((Number(L.ded) || 0) - lateTarget);
    var otherSum = payRound2(otherParts.reduce(function (a, b) { return a + b; }, 0));
    if (names.length && payRound2(otherTarget - otherSum) !== 0) {
      var gap = payRound2(otherTarget - otherSum);
      var bi = 0;
      otherParts.forEach(function (n, i) { if (Math.abs(n) >= Math.abs(otherParts[bi])) bi = i; });
      otherParts[bi] = payRound2(otherParts[bi] + gap);
    }
    var grossParts = names.map(function (_, i) {
      return payRound2(basicParts[i] + otPayParts[i] + holParts[i] + allowParts[i] + incentParts[i]);
    });
    if (L.gross != null) {
      var gSum = payRound2(grossParts.reduce(function (a, b) { return a + b; }, 0));
      var gDiff = payRound2(Number(L.gross) - gSum);
      if (gDiff && names.length) {
        var gi = 0;
        grossParts.forEach(function (n, i) { if (Math.abs(n) >= Math.abs(grossParts[gi])) gi = i; });
        grossParts[gi] = payRound2(grossParts[gi] + gDiff);
      }
    }
    var dedParts = names.map(function (_, i) { return payRound2(lateParts[i] + otherParts[i]); });
    var netW = grossParts.map(function (g, i) { return g - dedParts[i]; });
    var netWeights = netW.some(function (n) { return Math.abs(n) > 0.0001; })
      ? netW.map(function (n) { return Math.abs(n); })
      : periodW;
    var dayTarget = L.days != null ? Number(L.days) : dayW.reduce(function (a, b) { return a + b; }, 0);
    var dayParts = splitMoney(dayTarget, payPositive(dayW) ? dayW : periodW);
    var netTarget = L.net != null ? Number(L.net) : 0;
    var netParts = splitMoney(netTarget, netWeights);
    var counted = false;
    names.forEach(function (name, i) {
      var b = bucket(name);
      var active = Math.abs(dayW[i]) > 0.0001 || Math.abs(otParts[i]) > 0.0001
        || Math.abs(grossParts[i]) > 0.0001 || Math.abs(lateParts[i]) > 0.0001
        || Math.abs(otherParts[i]) > 0.0001 || Math.abs(netParts[i]) > 0.0001;
      if (active && L.empId && !b.emp[L.empId]) {
        b.emp[L.empId] = 1;
        b.headcount++;
        counted = true;
      }
      b.days = payRound2(b.days + dayParts[i]);
      b.basic = payRound2(b.basic + basicParts[i]);
      b.ot = payRound2(b.ot + otParts[i]);
      b.otPay = payRound2(b.otPay + otPayParts[i]);
      b.holPay = payRound2(b.holPay + holParts[i]);
      b.gross = payRound2(b.gross + grossParts[i]);
      b.late = payRound2(b.late + lateParts[i]);
      b.other = payRound2(b.other + otherParts[i]);
      b.ded = payRound2(b.ded + dedParts[i]);
      b.net = payRound2(b.net + netParts[i]);
    });
    if (!counted && L.empId) {
      var idle = bucket(names[0] || "Unassigned");
      if (!idle.emp[L.empId]) { idle.emp[L.empId] = 1; idle.headcount++; }
    }
  });
  var list = Object.keys(sites).map(function (k) { return sites[k]; }).filter(function (s) {
    return s.headcount || Math.abs(s.days) > 0.0001 || Math.abs(s.gross) > 0.0001
      || Math.abs(s.late) > 0.0001 || Math.abs(s.other) > 0.0001 || Math.abs(s.net) > 0.0001
      || Math.abs(s.ot) > 0.0001;
  });
  list.sort(function (a, b) {
    if (a.site === "Unassigned") return 1;
    if (b.site === "Unassigned") return -1;
    return a.site.localeCompare(b.site);
  });
  var people = {};
  list.forEach(function (s) { Object.keys(s.emp).forEach(function (id) { people[id] = 1; }); });
  var totals = {
    site: "Total",
    headcount: Object.keys(people).length,
    days: 0, basic: 0, ot: 0, otPay: 0, gross: 0, late: 0, other: 0, ded: 0, net: 0, holPay: 0
  };
  list.forEach(function (s) {
    ["days", "basic", "ot", "otPay", "gross", "late", "other", "ded", "net", "holPay"].forEach(function (k) {
      totals[k] = payRound2(totals[k] + (Number(s[k]) || 0));
    });
  });
  list.forEach(function (s) { delete s.emp; });
  return { sites: list, totals: totals, rule: PAY_PROJECT_RULE };
}

function payProjectSummaryCsv(summary) {
  var head = ["Site", "Headcount", "Man-days", "Basic", "OT hours", "OT pay", "Gross", "Late/UT", "Other deductions", "Net"];
  function row(s) {
    return [s.site, s.headcount, s.days, payRound2(s.basic).toFixed(2), payRound2(s.ot).toFixed(2),
      payRound2(s.otPay).toFixed(2), payRound2(s.gross).toFixed(2), payRound2(s.late).toFixed(2),
      payRound2(s.other).toFixed(2), payRound2(s.net).toFixed(2)];
  }
  var rows = [head];
  (summary.sites || []).forEach(function (s) { rows.push(row(s)); });
  if (summary.totals) rows.push(row(summary.totals));
  rows.push([]);
  rows.push(["Rule", summary.rule || PAY_PROJECT_RULE]);
  return rows;
}

function payProjectSummaryBook(summary) {
  var csv = payProjectSummaryCsv(summary);
  var rows = csv.map(function (r) {
    return r.map(function (v) {
      if (typeof v === "number") return { v: v };
      var n = typeof v === "string" && v !== "" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
      return n == null || !isFinite(n) ? { v: v } : { v: n };
    });
  });
  return { sheets: [{ name: "By project", rows: rows, cols: 10 }] };
}

function payAuditRowOpen(row) {
  return !(row && row.review && row.review.reviewed);
}

/* Open means not marked Reviewed on the pay run. ctx.report is the array
   from payAuditRun. A missing report falls back to hrPayAudit.openFlags
   when that hook exists, and otherwise stays hidden. */
function payOpenAuditFlags(run, lines, ctx) {
  ctx = ctx || {};
  var report = ctx.report;
  if (!report && typeof payAuditRun === "function") {
    report = payAuditRun({
      from: ctx.from || (run && run.from) || "",
      to: ctx.to || (run && run.to) || "",
      periodEnd: ctx.periodEnd || ctx.to || (run && run.to) || "",
      reviews: (run && run.auditReviews) || {}
    });
  }
  if (Array.isArray(report)) {
    var checks = report.map(function (c) {
      var rows = (c && c.rows) || [];
      var openRows = rows.filter(payAuditRowOpen);
      return {
        id: c.id || "",
        description: c.description || c.id || "",
        severity: c.severity || "",
        count: openRows.length,
        total: c.count != null ? c.count : rows.length,
        items: openRows.map(function (r) {
          var who = r.name || r.empId || "";
          var text = who + (r.date ? " · " + r.date : "") + (r.details ? " — " + r.details : "");
          return { key: r.key || "", checkId: c.id || "", text: text };
        })
      };
    });
    var items = [];
    checks.forEach(function (c) { items = items.concat(c.items); });
    var count = checks.reduce(function (n, c) { return n + c.count; }, 0);
    return { count: count, items: items, checks: checks, source: "payAuditRun" };
  }
  var api = null;
  try {
    if (typeof hrPayAudit !== "undefined" && hrPayAudit) api = hrPayAudit;
    else if (typeof window !== "undefined" && window.hrPayAudit) api = window.hrPayAudit;
  } catch (e) { api = null; }
  if (!api || typeof api.openFlags !== "function") return null;
  try {
    var out = api.openFlags(run, lines) || {};
    var hookItems = Array.isArray(out.items) ? out.items : (Array.isArray(out) ? out : []);
    var hookCount = out.count != null ? Number(out.count) : hookItems.length;
    if (!isFinite(hookCount) || hookCount < 0) hookCount = hookItems.length;
    return { count: hookCount, items: hookItems, checks: out.checks || [] };
  } catch (e2) {
    return { count: 0, items: [], checks: [] };
  }
}

/* Reads status only. A saved run with no status — including the live draft
   weekly|2026-10-29 — stays draft. This does not write status onto it.
   An older finalizedOn without status is still a draft: that button did not lock. */
function payRunStatusOf(run) {
  var s = String(run && run.status || "").trim().toLowerCase();
  if (s === "submitted" || s === "submitted for approval") return "submitted";
  if (s === "approved" || s === "finalized" || s === "approved/finalized") return "approved";
  if (s === "returned") return "draft";
  return "draft";
}

function payRunLocked(run) {
  return payRunStatusOf(run) === "approved";
}

function payRunAllowsEdit(run) {
  return payRunStatusOf(run) === "draft";
}

function payActorRole(actor) {
  return String(actor && actor.role || "").trim().toLowerCase();
}

function payCanApprove(actor, approverUnlocked) {
  if (approverUnlocked === true) return true;
  return payActorRole(actor) === "admin";
}

function payCanSubmit(actor) {
  if (payCanApprove(actor, false)) return true;
  if (!actor || typeof actor !== "object") return true;
  var method = String(actor.method || "").trim().toLowerCase();
  var sub = String(actor.sub || actor.uid || actor.id || "").trim().toLowerCase();
  if (method === "password" || sub === "gate") return true;
  var role = payActorRole(actor);
  var dept = String(actor.department || "").trim().toLowerCase();
  if (!role && !String(actor.email || "").trim() && !sub) return true;
  return role === "hr" || dept === "hr";
}

function payActorName(actor, fallback) {
  if (actor && actor.email) return String(actor.email);
  if (actor && actor.name) return String(actor.name);
  return fallback || "HR";
}

function payCloneRun(run) {
  var next = {};
  Object.keys(run || {}).forEach(function (k) { next[k] = run[k]; });
  next.lines = run && run.lines ? run.lines : {};
  next.history = (run && run.history || []).map(function (h) { return Object.assign({}, h); });
  return next;
}

function payTransition(run, action, ctx) {
  ctx = ctx || {};
  var current = payRunStatusOf(run);
  var actor = ctx.actor || null;
  var who = ctx.who || payActorName(actor, "HR");
  var now = ctx.now || "";
  var next = payCloneRun(run || {});
  function history(entry) {
    next.history = (next.history || []).concat([entry]);
  }
  if (action === "submit") {
    if (!payCanSubmit(actor)) return { ok: false, error: "This sign-in cannot submit a payroll.", run: run || null };
    if (current !== "draft") return { ok: false, error: "Only a draft can be submitted.", run: run || null };
    next.status = "submitted";
    next.submittedBy = who;
    next.submittedAt = now;
    history({ action: "submit", from: "draft", to: "submitted", by: who, at: now, note: "" });
    return { ok: true, error: "", run: next };
  }
  if (action === "approve") {
    if (!payCanApprove(actor, ctx.approverUnlocked === true))
      return { ok: false, error: "Only an admin can approve a payroll.", run: run || null };
    if (current !== "submitted") return { ok: false, error: "Submit the run before it can be approved.", run: run || null };
    next.status = "approved";
    next.approvedBy = who;
    next.approvedAt = now;
    next.finalizedOn = String(now || "").slice(0, 10);
    if (ctx.snapshot) next.approvedSnapshot = ctx.snapshot;
    history({ action: "approve", from: "submitted", to: "approved", by: who, at: now, note: "" });
    return { ok: true, error: "", run: next };
  }
  if (action === "return") {
    if (!payCanApprove(actor, ctx.approverUnlocked === true))
      return { ok: false, error: "Only an admin can return a payroll.", run: run || null };
    if (current !== "submitted") return { ok: false, error: "Only a submitted run can be returned.", run: run || null };
    var note = String(ctx.note || "").trim();
    if (!note) return { ok: false, error: "A return needs a note.", run: run || null };
    next.status = "draft";
    next.returnedBy = who;
    next.returnedAt = now;
    next.returnNote = note;
    history({ action: "return", from: "submitted", to: "draft", by: who, at: now, note: note });
    return { ok: true, error: "", run: next };
  }
  return { ok: false, error: "Unknown payroll action.", run: run || null };
}

function payDateLockedByPayroll(date, runs) {
  var day = String(date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  var map = runs || {};
  return Object.keys(map).some(function (k) {
    var run = map[k];
    if (!run || payRunStatusOf(run) !== "approved") return false;
    var from = String(run.from || "").slice(0, 10);
    var to = String(run.to || "").slice(0, 10);
    return from && to && day >= from && day <= to;
  });
}

function payRunFlowHtml(run, flags) {
  var status = payRunStatusOf(run);
  var label = status === "submitted" ? "Submitted for approval" : status === "approved" ? "Approved" : "Draft";
  var pill = status === "approved" ? "ok" : status === "submitted" ? "warn" : "mut";
  var h = '<div class="card" id="pay-approval" style="margin:0 0 12px"><div class="card-h"><h3>Payroll approval</h3>'
    + '<span class="pill ' + pill + '" id="pay-status">' + payHtmlEsc(label) + "</span></div><div class=\"card-b\">";
  if (status === "draft") {
    h += '<div class="note" style="margin:0 0 8px">This is a draft. HR can still change times, overtime, the day’s site, and deductions. '
      + "Submit sends it for approval. Approving locks those edits on this screen.</div>";
  } else if (status === "submitted") {
    h += '<div class="note" style="margin:0 0 8px">Submitted'
      + (run && run.submittedBy ? " by " + payHtmlEsc(run.submittedBy) : "")
      + (run && run.submittedAt ? " · " + payHtmlEsc(run.submittedAt) : "")
      + ". An admin approves it or returns it to draft with a note.</div>";
  } else {
    h += '<div class="note" style="margin:0 0 8px">Approved'
      + (run && run.approvedBy ? " by " + payHtmlEsc(run.approvedBy) : "")
      + (run && run.approvedAt ? " · " + payHtmlEsc(run.approvedAt) : "")
      + ". Payroll edits and the day rows opened from this screen stay locked.</div>";
  }
  if (run && run.returnNote) {
    h += '<div class="note" style="border-left-color:var(--warn);margin:0 0 8px">Returned'
      + (run.returnedBy ? " by " + payHtmlEsc(run.returnedBy) : "")
      + (run.returnedAt ? " · " + payHtmlEsc(run.returnedAt) : "")
      + ": " + payHtmlEsc(run.returnNote) + "</div>";
  }
  if (flags) {
    var openN = Number(flags.count) || 0;
    h += '<div id="pay-audit-flags"><b>' + openN + " open</b>"
      + " — a row stays open until it is marked Reviewed.";
    if (flags.checks && flags.checks.length) {
      h += '<ul id="pay-audit-flag-counts" style="margin:6px 0 0 18px">';
      flags.checks.forEach(function (c) {
        h += '<li data-payaudit-check="' + payHtmlEsc(c.id) + '"><b>' + (Number(c.count) || 0) + "</b> open"
          + " · " + payHtmlEsc(c.description || c.id) + "</li>";
      });
      h += "</ul>";
    }
    if (flags.items && flags.items.length) {
      h += '<ul id="pay-audit-flag-list" style="margin:6px 0 0 18px">';
      flags.items.slice(0, 40).forEach(function (item) {
        var text = item && (item.text || item.label) || "";
        h += "<li>" + payHtmlEsc(text) + "</li>";
      });
      if (flags.items.length > 40) h += "<li>… " + (flags.items.length - 40) + " more on the review list.</li>";
      h += "</ul>";
    } else if (!openN) {
      h += '<div class="lbl" style="margin-top:6px">No open checks.</div>';
    }
    h += "</div>";
  }
  var hist = (run && run.history) || [];
  if (hist.length) {
    h += '<div class="lbl" style="margin-top:8px">Status history</div><ul id="pay-status-history" style="margin:4px 0 0 18px">';
    hist.forEach(function (ev) {
      h += "<li>" + payHtmlEsc(ev.at || "") + " · " + payHtmlEsc(ev.by || "")
        + " · " + payHtmlEsc(ev.action || "")
        + (ev.note ? " — " + payHtmlEsc(ev.note) : "") + "</li>";
    });
    h += "</ul>";
  }
  h += "</div></div>";
  return h;
}

function payAliasSettingsHtml(settings) {
  var on = payAliasConfirmedMap(settings);
  var h = '<div class="card" id="pay-alias-card"><div class="card-h"><h3>Project aliases</h3>'
    + '<span class="lbl">summary only — stored rows stay as written</span></div><div class="card-b">';
  h += '<div class="note">These are suspected spellings of the same project. Nothing is merged until the box is ticked, and ticking it does not rewrite Daily Manpower or the 201 project. '
    + "Unticked names, and a blank site, show as <b>Unassigned</b> on the payroll summary. The area dropdown uses the project list.</div>";
  h += '<div class="tw"><table><thead><tr><th>Name in use</th><th>Treat as</th><th>Why it is listed</th><th>Use in the summary</th></tr></thead><tbody>';
  PAY_PROJECT_ALIASES.forEach(function (a) {
    if (payCanonKey(a.alias) === payCanonKey(a.to)) return;
    var key = payCanonKey(a.alias);
    h += "<tr><td>" + payHtmlEsc(a.alias) + "</td><td>" + payHtmlEsc(a.to) + "</td><td>" + payHtmlEsc(a.note || "") + "</td>"
      + '<td><input type="checkbox" data-alias-on="' + payHtmlEsc(key) + '"' + (on[key] ? " checked" : "") + "></td></tr>";
  });
  h += "</tbody></table></div></div></div>";
  return h;
}

function payProjectSummaryCard(lines, kind, run, deps) {
  deps = deps || {};
  var settings = deps.settings || {};
  var confirmed = payAliasConfirmedMap(settings.projectAliasOn || settings);
  var extra = [];
  (deps.projects || []).forEach(function (p) {
    if (p && p.name) extra.push(p.name);
    else if (typeof p === "string") extra.push(p);
  });
  var otPolicy = Number(settings.otPolicy != null ? settings.otPolicy : 1) || 1;
  var lateForRow = null;
  if (typeof deps.lateForRow === "function") lateForRow = deps.lateForRow;
  else {
    try {
      if (typeof hrPaySheet !== "undefined" && hrPaySheet && typeof hrPaySheet.lateForRow === "function")
        lateForRow = function (row, daily) { return hrPaySheet.lateForRow(row, daily); };
    } catch (e2) { lateForRow = null; }
  }
  var summary = payProjectSummary(lines || [], {
    confirmed: confirmed, extraProjects: extra, otPolicy: otPolicy, lateForRow: lateForRow
  });
  var num = typeof deps.num === "function" ? deps.num : function (n, d) {
    var x = Number(n) || 0;
    var p = d == null ? 2 : d;
    return x.toFixed(p);
  };
  var h = "";
  h += '<div class="card" id="pay-by-project" style="margin:0 0 12px"><div class="card-h"><h3>Summary by project</h3>'
    + '<span class="lbl">' + summary.sites.length + " project" + (summary.sites.length === 1 ? "" : "s")
    + " · labor follows each day’s site</span>"
    + '<button type="button" class="btn sm" id="pay-proj-csv">Project CSV</button>'
    + '<button type="button" class="btn sm" id="pay-proj-xlsx">Project Excel</button>'
    + "</div><div class=\"card-b\" style=\"padding-top:0\">";
  h += '<div class="note" id="pay-project-rule">' + payHtmlEsc(summary.rule) + "</div>";
  h += '<div class="tw"><table><thead><tr>'
    + "<th>Project</th><th class=\"num\">Headcount</th><th class=\"num\">Man-days</th><th class=\"num\">Basic</th>"
    + "<th class=\"num\">OT hours</th><th class=\"num\">OT pay</th><th class=\"num\">Gross</th>"
    + "<th class=\"num\">Late/UT</th><th class=\"num\">Other deductions</th><th class=\"num\">Net</th>"
    + "</tr></thead><tbody>";
  if (!summary.sites.length) h += '<tr><td colspan="10"><span class="lbl">No project on this run.</span></td></tr>';
  summary.sites.forEach(function (s) {
    h += '<tr data-payproject="' + payHtmlEsc(s.site) + '">'
      + "<td><b>" + payHtmlEsc(s.site) + "</b></td>"
      + '<td class="num mono">' + s.headcount + "</td>"
      + '<td class="num mono">' + num(s.days, 1) + "</td>"
      + '<td class="num mono">' + num(s.basic, 2) + "</td>"
      + '<td class="num mono">' + num(s.ot, 1) + "</td>"
      + '<td class="num mono">' + num(s.otPay, 2) + "</td>"
      + '<td class="num mono">' + num(s.gross, 2) + "</td>"
      + '<td class="num mono">' + num(s.late, 2) + "</td>"
      + '<td class="num mono">' + num(s.other, 2) + "</td>"
      + '<td class="num mono"><b>' + num(s.net, 2) + "</b></td></tr>";
  });
  var t = summary.totals;
  h += '</tbody><tfoot><tr data-payproject="Total" style="font-weight:700;background:var(--surface2)">'
    + "<td>Total</td>"
    + '<td class="num mono">' + t.headcount + "</td>"
    + '<td class="num mono">' + num(t.days, 1) + "</td>"
    + '<td class="num mono">' + num(t.basic, 2) + "</td>"
    + '<td class="num mono">' + num(t.ot, 1) + "</td>"
    + '<td class="num mono">' + num(t.otPay, 2) + "</td>"
    + '<td class="num mono">' + num(t.gross, 2) + "</td>"
    + '<td class="num mono">' + num(t.late, 2) + "</td>"
    + '<td class="num mono">' + num(t.other, 2) + "</td>"
    + '<td class="num mono">' + num(t.net, 2) + "</td></tr></tfoot></table></div></div></div>";
  return h;
}

function openDailyBulkAssign(deps) {
  deps = deps || {};
  var people = deps.people || [];
  var extra = [];
  (deps.projects || []).forEach(function (p) {
    if (p && p.status !== "Closed" && p.name) extra.push(p.name);
    else if (typeof p === "string") extra.push(p);
  });
  var names = payCanonicalProjects(extra);
  var day = deps.date || "";
  var body = '<div class="stack"><div class="note">Sets the area on Daily Manpower for the people and dates you pick. '
    + "The 201 project is not changed. A day with no report, or a person who is not on that day, is skipped. "
    + "The change is stored on the row and in that day’s change history.</div>"
    + '<div class="row"><div class="f" style="width:160px"><label>From</label><input id="ba-from" type="date" value="' + payHtmlEsc(day) + '"></div>'
    + '<div class="f" style="width:160px"><label>To</label><input id="ba-to" type="date" value="' + payHtmlEsc(day) + '"></div>'
    + '<div class="f" style="width:240px"><label>Project</label><select id="ba-site">'
    + names.map(function (n) { return "<option>" + payHtmlEsc(n) + "</option>"; }).join("")
    + "</select></div></div>"
    + '<div class="f"><label>People</label><input id="ba-q" placeholder="Find a name"></div>'
    + '<div id="ba-people" style="max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:8px">'
    + people.map(function (e) {
      var name = deps.flipName ? deps.flipName(e.name) : (e.name || "");
      return '<label style="display:flex;gap:8px;align-items:center;padding:3px 0" data-balabel="' + payHtmlEsc(((e.empNo || "") + " " + (e.name || "")).toLowerCase()) + '">'
        + '<input type="checkbox" data-baemp="' + payHtmlEsc(e.id) + '">'
        + "<span>" + payHtmlEsc((e.empNo ? e.empNo + " · " : "") + name) + "</span></label>";
    }).join("")
    + "</div></div>";
  if (typeof deps.openModal !== "function") return;
  deps.openModal({
    title: "Assign a project",
    wide: true,
    body: body,
    foot: '<button class="btn" id="ba-cancel">Cancel</button><button class="btn pri" id="ba-go">Set the area</button>'
  });
  var root = deps.doc || (typeof document !== "undefined" ? document : null);
  if (!root) return;
  var q = root.getElementById("ba-q");
  if (q) q.oninput = function () {
    var needle = String(q.value || "").trim().toLowerCase();
    Array.prototype.forEach.call(root.querySelectorAll("[data-balabel]"), function (el) {
      el.style.display = !needle || el.getAttribute("data-balabel").indexOf(needle) >= 0 ? "" : "none";
    });
  };
  root.getElementById("ba-cancel").onclick = function () { if (typeof deps.closeModal === "function") deps.closeModal(); };
  root.getElementById("ba-go").onclick = async function () {
    var from = root.getElementById("ba-from").value;
    var to = root.getElementById("ba-to").value || from;
    var site = root.getElementById("ba-site").value;
    if (!from || !to || to < from) { if (typeof deps.toast === "function") deps.toast("Choose a date range.", "err"); return; }
    if (!site) { if (typeof deps.toast === "function") deps.toast("Choose the project.", "err"); return; }
    var ids = [];
    Array.prototype.forEach.call(root.querySelectorAll("[data-baemp]"), function (el) {
      if (el.checked) ids.push(el.getAttribute("data-baemp"));
    });
    if (!ids.length) { if (typeof deps.toast === "function") deps.toast("Choose at least one person.", "err"); return; }
    var dates = typeof deps.payDates === "function" ? deps.payDates(from, to) : [from];
    var stamp = {
      by: typeof deps.whoEdits === "function" ? deps.whoEdits() : "HR",
      at: typeof deps.nowStamp === "function" ? deps.nowStamp() : ""
    };
    var changed = 0;
    var missing = 0;
    var skipped = 0;
    for (var i = 0; i < dates.length; i++) {
      var date = dates[i];
      var live = typeof deps.dailyGet === "function" ? deps.dailyGet(date) : null;
      if (!live) { missing++; continue; }
      var applied = bulkAssignSites([live], ids, site, stamp);
      skipped += applied.skipped.length;
      if (!applied.changed) continue;
      changed += applied.changed;
      var rec = applied.days[0];
      if (typeof deps.dailySave === "function") await deps.dailySave(rec, "area set to " + site + " for " + applied.changed + " people");
    }
    if (typeof deps.closeModal === "function") deps.closeModal();
    var msg = changed ? changed + " area" + (changed === 1 ? "" : "s") + " set to " + site : "No row on those days was changed";
    if (missing) msg += ". " + missing + " day" + (missing === 1 ? "" : "s") + " had no report";
    if (skipped && !changed) msg += ". Those people are not on the filed days";
    if (typeof deps.toast === "function") deps.toast(msg, changed ? "ok" : undefined);
    if (typeof deps.render === "function") deps.render();
  };
}
