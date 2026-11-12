/**
 * Afternoon OT Plan and Morning OT Report.
 * Loaded before the in-page engine. Does not rewrite payroll, attendance,
 * *Touched overrides, or old OT requests.
 *
 * Planned hours are not reported OT. Only Morning Report rows that are not
 * marked No OT count. Daily Manpower OT remains the number payroll pays.
 * Old OT requests are not read here.
 */
"use strict";

var HR_OT_CANCEL_REASONS = ["Weather", "Materials/Equipment", "Other"];

function hrOtState(ctx) {
  if (ctx && ctx.S) return ctx.S;
  if (typeof S !== "undefined" && S) return S;
  return { employees: {}, daily: {}, otplans: {}, otreps: {}, settings: {} };
}

function hrOtClone(v) {
  return JSON.parse(JSON.stringify(v == null ? null : v));
}

function hrOtPlans(ctx) {
  var S = hrOtState(ctx);
  return Object.keys(S.otplans || {}).map(function (id) {
    var p = S.otplans[id];
    if (!p || typeof p !== "object") return null;
    return p.id ? p : Object.assign({ id: id }, p);
  }).filter(Boolean);
}

function hrOtReports(ctx) {
  var S = hrOtState(ctx);
  return Object.keys(S.otreps || {}).map(function (id) {
    var p = S.otreps[id];
    if (!p || typeof p !== "object") return null;
    return p.id ? p : Object.assign({ id: id }, p);
  }).filter(Boolean);
}

function hrOtDay(v) {
  return String(v || "").slice(0, 10);
}

function hrOtInWindow(date, ctx) {
  var d = hrOtDay(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  if (typeof payAuditInWindow === "function") return payAuditInWindow(d, ctx || {});
  if (ctx && ctx.from && d < hrOtDay(ctx.from)) return false;
  if (ctx && ctx.to && d > hrOtDay(ctx.to)) return false;
  return true;
}

function hrOtDates(from, to) {
  var a = hrOtDay(from), b = hrOtDay(to || from);
  if (typeof otEachDate === "function") return otEachDate(a, b);
  var out = [];
  if (!a || !b || a > b) return out;
  var d = a, guard = 0;
  while (d <= b && guard < 400) {
    out.push(d);
    var t = new Date(d + "T00:00:00");
    t.setDate(t.getDate() + 1);
    d = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    guard++;
  }
  return out;
}

function hrOtSiteList(sites) {
  var names = [], seen = {};
  (sites || []).forEach(function (s) {
    var name = String(s || "").trim();
    if (!name || seen[name]) return;
    seen[name] = 1;
    names.push(name);
  });
  if (!seen.Banawa) names.push("Banawa");
  names.sort(function (a, b) {
    return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "variant" });
  });
  return names;
}

function hrOtClockMinutes(v) {
  if (typeof clockMinutes === "function") {
    var got = clockMinutes(v);
    if (got != null) return got;
  }
  var s = String(v || "").trim();
  if (!s) return null;
  var ampm = /am|pm/i.exec(s);
  var hm = /(\d{1,2})(?::(\d{2}))?/.exec(s);
  if (!hm) return null;
  var h = Number(hm[1]), mi = Number(hm[2] || 0);
  if (ampm) {
    var ap = ampm[0].toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
  }
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function hrOtClockHours(from, to) {
  if (typeof otHoursFromClock === "function") {
    var n = otHoursFromClock(from, to);
    if (n != null && n > 0) return n;
  }
  var a = hrOtClockMinutes(from), b = hrOtClockMinutes(to);
  if (a == null || b == null || a === b) return 0;
  var mins = b - a;
  if (mins < 0) mins += 1440;
  return Math.round((mins / 60) * 100) / 100;
}

function hrOtNum(v) {
  if (v == null || String(v).trim() === "") return null;
  var n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/* Typed hours win. Otherwise the clock span, including overnight. */
function hrOtHoursOf(row) {
  if (!row) return 0;
  var typed = row.hours != null && String(row.hours).trim() !== "" ? row.hours : row.expectedHours;
  var n = hrOtNum(typed);
  if (n != null && n > 0) return n;
  var c = hrOtClockHours(row.timeFrom, row.timeTo);
  return c > 0 ? c : 0;
}

function hrOtFindPlan(id, ctx) {
  if (!id) return null;
  var S = hrOtState(ctx);
  var p = (S.otplans || {})[id];
  if (p) return p.id ? p : Object.assign({ id: id }, p);
  var hit = null;
  hrOtPlans(ctx).forEach(function (plan) { if (!hit && plan.id === id) hit = plan; });
  return hit;
}

function hrOtEmpOnPlan(plan, empId) {
  if (!plan || !empId) return false;
  return (plan.rows || []).some(function (r) { return r && r.empId === empId; });
}

function hrOtPersonNotOnPlan(report, empId, ctx) {
  if (!report || !empId) return false;
  if (report.noPlan || !report.planId) return true;
  var plan = hrOtFindPlan(report.planId, ctx);
  if (!plan) return true;
  return !hrOtEmpOnPlan(plan, empId);
}

function hrOtOnRoster(empId, ctx) {
  var S = hrOtState(ctx);
  return !!(empId && S.employees && S.employees[empId]);
}

function hrOtActiveRoster(ctx) {
  if (typeof atWork === "function" && !(ctx && ctx.roster)) {
    try {
      var live = atWork();
      if (Array.isArray(live)) return live.filter(Boolean);
    } catch (e) {}
  }
  if (ctx && Array.isArray(ctx.roster)) return ctx.roster.filter(Boolean);
  var S = hrOtState(ctx);
  return Object.keys(S.employees || {}).map(function (id) { return S.employees[id]; }).filter(Boolean);
}

function hrOtPrepareReport(report, ctx) {
  var next = hrOtClone(report || {});
  next.rows = (next.rows || []).map(function (r) { return Object.assign({}, r); });
  if (next.noOt) {
    next.rows.forEach(function (r) {
      r.noOt = true;
      r.noOtReason = r.noOtReason || next.noOtReason || "";
      r.noOtNote = r.noOtNote || next.noOtNote || "";
    });
  }
  next.rows.forEach(function (r) {
    r.notInPlan = hrOtPersonNotOnPlan(next, r.empId, ctx);
  });
  return next;
}

function hrOtReasonOk(reason, note) {
  if (HR_OT_CANCEL_REASONS.indexOf(reason) < 0) return "Choose Weather, Materials/Equipment, or Other.";
  if (reason === "Other" && !String(note || "").trim()) return "Other needs a note.";
  return "";
}

function hrOtValidatePlan(plan, ctx) {
  var errors = [];
  plan = plan || {};
  if (!hrOtDay(plan.otDate)) errors.push("Choose the OT date.");
  if (!String(plan.site || "").trim()) errors.push("Choose the site.");
  if (!String(plan.deptHead || "").trim()) errors.push("Name the department head.");
  if (!(plan.rows || []).length) errors.push("Add at least one employee from the roster.");
  var seen = {};
  (plan.rows || []).forEach(function (r, i) {
    var n = i + 1;
    if (!r || !r.empId) { errors.push("Row " + n + " needs an employee from the roster."); return; }
    if (seen[r.empId]) errors.push("Row " + n + " repeats an employee. One row each.");
    seen[r.empId] = 1;
    if (!hrOtOnRoster(r.empId, ctx)) errors.push("Row " + n + " is not on the roster.");
    if (!String(r.task || "").trim()) errors.push("Row " + n + " needs the task.");
    if (!String(r.reason || "").trim()) errors.push("Row " + n + " needs the reason.");
    if (!r.noOt && !(hrOtHoursOf(r) > 0)) errors.push("Row " + n + " needs expected hours or a time range.");
  });
  return { ok: errors.length === 0, errors: errors, plan: plan };
}

function hrOtValidateReport(report, ctx) {
  var next = hrOtPrepareReport(report, ctx);
  var errors = [];
  if (!hrOtDay(next.otDate)) errors.push("Choose the OT date.");
  if (!hrOtDay(next.reportDate)) errors.push("Choose the report date.");
  if (!next.noPlan && !next.planId) errors.push("Link an Afternoon Plan, or mark this report as no plan.");
  if (next.noOt) {
    var whole = hrOtReasonOk(next.noOtReason, next.noOtNote);
    if (whole) errors.push("No OT for the whole plan: " + whole);
  }
  if (!(next.rows || []).length) errors.push("Add at least one employee from the roster.");
  var seen = {};
  (next.rows || []).forEach(function (r, i) {
    var n = i + 1;
    if (!r || !r.empId) { errors.push("Row " + n + " needs an employee from the roster."); return; }
    if (seen[r.empId]) errors.push("Row " + n + " repeats an employee. One row each.");
    seen[r.empId] = 1;
    if (!hrOtOnRoster(r.empId, ctx)) errors.push("Row " + n + " is not on the roster.");
    if (r.notInPlan && !String(r.notInPlanReason || "").trim()) {
      errors.push("Row " + n + " is not on the Afternoon Plan. A reason is required.");
    }
    if (r.noOt || next.noOt) {
      var why = hrOtReasonOk(r.noOtReason || next.noOtReason, r.noOtNote || next.noOtNote);
      if (why) errors.push("Row " + n + " No OT: " + why);
    } else {
      if (!(hrOtHoursOf(r) > 0)) errors.push("Row " + n + " needs actual hours or a time range, or No OT.");
      if (!String(r.description || "").trim()) errors.push("Row " + n + " needs a description of what happened.");
    }
  });
  return { ok: errors.length === 0, errors: errors, report: next };
}

function hrOtDescribeChange(before, after) {
  before = before || {};
  after = after || {};
  var bits = [];
  function ch(label, a, b) {
    if (String(a || "") === String(b || "")) return;
    bits.push(label + ": " + (a || "—") + " → " + (b || "—"));
  }
  ch("OT date", before.otDate, after.otDate);
  ch("Report date", before.reportDate, after.reportDate);
  ch("Site", before.site, after.site);
  ch("Department", before.department, after.department);
  ch("Department head", before.deptHead, after.deptHead);
  ch("Plan", before.planId, after.planId);
  if (!!before.noPlan !== !!after.noPlan) bits.push(after.noPlan ? "Marked no plan" : "Linked to a plan");
  if (!!before.noOt !== !!after.noOt) bits.push(after.noOt ? "Marked whole plan No OT" : "Cleared whole plan No OT");
  ch("No OT reason", before.noOtReason, after.noOtReason);
  ch("No OT note", before.noOtNote, after.noOtNote);
  var bmap = {}, amap = {};
  (before.rows || []).forEach(function (r) { if (r && r.empId) bmap[r.empId] = r; });
  (after.rows || []).forEach(function (r) { if (r && r.empId) amap[r.empId] = r; });
  Object.keys(amap).forEach(function (id) {
    if (!bmap[id]) bits.push("Added " + (amap[id].name || id));
  });
  Object.keys(bmap).forEach(function (id) {
    if (!amap[id]) bits.push("Removed " + (bmap[id].name || id));
  });
  Object.keys(amap).forEach(function (id) {
    if (!bmap[id]) return;
    var a = amap[id], b = bmap[id], who = a.name || b.name || id;
    if (String(b.expectedHours == null ? "" : b.expectedHours) !== String(a.expectedHours == null ? "" : a.expectedHours)) {
      bits.push("Expected hours for " + who + ": " + (b.expectedHours || "—") + " → " + (a.expectedHours || "—"));
    }
    if (String(b.hours == null ? "" : b.hours) !== String(a.hours == null ? "" : a.hours)) {
      bits.push("Hours for " + who + ": " + (b.hours || "—") + " → " + (a.hours || "—"));
    }
    if ((b.timeFrom || "") !== (a.timeFrom || "") || (b.timeTo || "") !== (a.timeTo || "")) {
      bits.push("Time for " + who + ": " + (b.timeFrom || "—") + "–" + (b.timeTo || "—") + " → " + (a.timeFrom || "—") + "–" + (a.timeTo || "—"));
    }
    if ((b.task || "") !== (a.task || "")) bits.push("Task for " + who + " changed");
    if ((b.reason || "") !== (a.reason || "")) bits.push("Reason for " + who + " changed");
    if ((b.description || "") !== (a.description || "")) bits.push("Description for " + who + " changed");
    if (!!b.noOt !== !!a.noOt) bits.push(a.noOt ? ("No OT for " + who) : ("Cleared No OT for " + who));
    if ((b.noOtReason || "") !== (a.noOtReason || "")) bits.push("No OT reason for " + who + ": " + (a.noOtReason || "—"));
    if ((b.notInPlanReason || "") !== (a.notInPlanReason || "")) bits.push("Not-in-plan reason for " + who + " changed");
  });
  var bs = before.deptSign && before.deptSign.signed, asg = after.deptSign && after.deptSign.signed;
  if (!!bs !== !!asg) bits.push(asg ? "Department head signed" : "Department head signature cleared");
  var bh = before.hrSign && before.hrSign.signed, ah = after.hrSign && after.hrSign.signed;
  if (!!bh !== !!ah) bits.push(ah ? "HR signed" : "HR signature cleared");
  return bits;
}

function hrOtWithAmendment(after, before, who, when) {
  var next = hrOtClone(after || {});
  next.amendments = ((before && before.amendments) || []).map(function (a) { return Object.assign({}, a); });
  if (!before) return next;
  var what = hrOtDescribeChange(before, next);
  if (!what.length) return next;
  next.amendments.push({ at: String(when || ""), by: String(who || ""), what: what.join("; ") });
  return next;
}

function hrOtReportRowsFor(empId, date, ctx) {
  var d = hrOtDay(date), out = [];
  hrOtReports(ctx).forEach(function (rep) {
    if (hrOtDay(rep.otDate) !== d) return;
    (rep.rows || []).forEach(function (row) {
      if (row && row.empId === empId) out.push({ report: rep, row: row });
    });
  });
  return out;
}

function hrOtPlanRowsFor(empId, date, ctx) {
  var d = hrOtDay(date), out = [];
  hrOtPlans(ctx).forEach(function (plan) {
    if (hrOtDay(plan.otDate) !== d) return;
    (plan.rows || []).forEach(function (row) {
      if (row && row.empId === empId) out.push({ plan: plan, row: row });
    });
  });
  return out;
}

function hrOtRowIsNoOt(report, row) {
  return !!(report && row && (report.noOt || row.noOt));
}

function hrOtRowReason(report, row) {
  return String((row && row.noOtReason) || (report && report.noOtReason) || "");
}

function hrOtRowNote(report, row) {
  return String((row && row.noOtNote) || (report && report.noOtNote) || "");
}

function hrOtRowConfirmedHours(report, row) {
  if (!report || !row || hrOtRowIsNoOt(report, row)) return 0;
  return hrOtHoursOf(row);
}

/* Morning Report hours that were not cancelled. Plan hours are ignored. */
function hrOtReportedHours(empId, date, ctx) {
  var n = 0;
  hrOtReportRowsFor(empId, date, ctx).forEach(function (hit) {
    n += hrOtRowConfirmedHours(hit.report, hit.row);
  });
  return Math.round(n * 100) / 100;
}

function hrOtReportConfirms(empId, date, site, ctx) {
  return hrOtReportedHours(empId, date, ctx) > 0;
}

function hrOtPaySource(empId, date, site) {
  var id = "", proof = "", hours = hrOtReportedHours(empId, date);
  if (!(hours > 0)) return null;
  hrOtReportRowsFor(empId, date).forEach(function (hit) {
    if (!(hrOtRowConfirmedHours(hit.report, hit.row) > 0)) return;
    if (!id) id = hit.report.id || "";
    var list = (hit.row.proof && hit.row.proof.length) ? hit.row.proof : (hit.report.proofs || []);
    if (!proof && list[0] && list[0].url) proof = list[0].url;
  });
  return { id: id, confirmed: true, proofUrl: proof, hours: hours };
}

function hrOtDailyRec(date, ctx) {
  var S = hrOtState(ctx);
  var id = "d" + hrOtDay(date).replace(/-/g, "");
  var rec = (S.daily || {})[id];
  if (rec) return rec;
  var found = null;
  Object.keys(S.daily || {}).forEach(function (k) {
    var r = S.daily[k];
    if (!found && r && hrOtDay(r.date) === hrOtDay(date)) found = r;
  });
  return found;
}

function hrOtDmPeople(date, ctx) {
  var rec = hrOtDailyRec(date, ctx);
  if (!rec || !rec.rows) return [];
  var out = [], seen = {};
  Object.keys(rec.rows).forEach(function (k) {
    var row = rec.rows[k];
    if (!row || typeof row !== "object") return;
    var empId = k;
    if (typeof payAuditEmpId === "function") empId = payAuditEmpId(k, row) || k;
    if (!empId || seen[empId]) return;
    seen[empId] = 1;
    var hours = 0;
    if (typeof payrollOtParts === "function") {
      hours = Number(payrollOtParts(Object.assign({ date: hrOtDay(date) }, rec), empId, row).hours) || 0;
    } else {
      var raw = row.ot != null && String(row.ot).trim() !== "" ? row.ot : row.otHours;
      var n = Number(raw);
      hours = Number.isFinite(n) && n > 0 ? n : 0;
    }
    out.push({ empId: empId, hours: hours, row: row, site: (row && row.site) || "" });
  });
  return out;
}

function hrOtDmHours(empId, date, ctx) {
  var hit = null;
  hrOtDmPeople(date, ctx).forEach(function (p) { if (p.empId === empId) hit = p; });
  return hit ? hit.hours : 0;
}

function hrOtPerson(empId, fallback, ctx) {
  var S = hrOtState(ctx);
  var e = (S.employees && S.employees[empId]) || {};
  return {
    empId: empId || "",
    empNo: e.empNo || (fallback && fallback.empNo) || "",
    name: e.name || (fallback && (fallback.name || fallback.empName)) || empId || ""
  };
}

function hrOtPush(out, seen, check, who, date, details) {
  var key = check + "|" + (who.empId || "") + "|" + date;
  if (seen[key]) return;
  seen[key] = 1;
  out.push(Object.assign({}, who, { date: date, details: details }));
}

function hrOtAuditDmDiffers(ctx) {
  var out = [], seen = {};
  hrOtReports(ctx).forEach(function (rep) {
    var date = hrOtDay(rep.otDate);
    if (!hrOtInWindow(date, ctx)) return;
    (rep.rows || []).forEach(function (row) {
      if (!row || !row.empId || hrOtRowIsNoOt(rep, row)) return;
      var reported = hrOtReportedHours(row.empId, date, ctx);
      if (!(reported > 0)) return;
      var dm = hrOtDmHours(row.empId, date, ctx);
      if (Math.abs(dm - reported) <= 0.009) return;
      hrOtPush(out, seen, "diff", hrOtPerson(row.empId, row, ctx), date,
        "Daily Manpower " + dm + " h, Morning Report " + reported + " h. Payroll pays the Daily Manpower number.");
    });
  });
  return out;
}

function hrOtAuditPlanNoReport(ctx) {
  var out = [], seen = {};
  hrOtPlans(ctx).forEach(function (plan) {
    var date = hrOtDay(plan.otDate);
    if (!hrOtInWindow(date, ctx)) return;
    (plan.rows || []).forEach(function (row) {
      if (!row || !row.empId) return;
      if (hrOtReportRowsFor(row.empId, date, ctx).length) return;
      hrOtPush(out, seen, "miss", hrOtPerson(row.empId, row, ctx), date,
        "Report missing. Afternoon Plan is on file and this person has no Morning Report.");
    });
  });
  return out;
}

function hrOtAuditReportNoPlan(ctx) {
  var out = [], seen = {};
  hrOtReports(ctx).forEach(function (rep) {
    var date = hrOtDay(rep.otDate);
    if (!hrOtInWindow(date, ctx)) return;
    if (!(rep.noPlan || !rep.planId)) return;
    (rep.rows || []).forEach(function (row) {
      if (!row || !row.empId) return;
      hrOtPush(out, seen, "noplan", hrOtPerson(row.empId, row, ctx), date,
        "Morning Report filed with no Afternoon Plan.");
    });
  });
  return out;
}

function hrOtAuditHoursAfterNoOt(ctx) {
  var out = [], seen = {};
  hrOtReports(ctx).forEach(function (rep) {
    var date = hrOtDay(rep.otDate);
    if (!hrOtInWindow(date, ctx)) return;
    (rep.rows || []).forEach(function (row) {
      if (!row || !row.empId || !hrOtRowIsNoOt(rep, row)) return;
      var dm = hrOtDmHours(row.empId, date, ctx);
      if (!(dm > 0)) return;
      var reason = hrOtRowReason(rep, row) || "no reason recorded";
      var note = hrOtRowNote(rep, row);
      hrOtPush(out, seen, "after", hrOtPerson(row.empId, row, ctx), date,
        "No OT (" + reason + (note ? "; " + note : "") + "). Daily Manpower still has " + dm + " h.");
    });
  });
  return out;
}

function hrOtAuditDmNoForm(ctx) {
  var out = [], seen = {};
  var dates = {};
  hrOtDmDates(ctx).forEach(function (d) { dates[d] = 1; });
  Object.keys(dates).forEach(function (date) {
    if (!hrOtInWindow(date, ctx)) return;
    hrOtDmPeople(date, ctx).forEach(function (p) {
      if (!(p.hours > 0)) return;
      if (hrOtPlanRowsFor(p.empId, date, ctx).length) return;
      if (hrOtReportRowsFor(p.empId, date, ctx).length) return;
      hrOtPush(out, seen, "dmnone", hrOtPerson(p.empId, p.row, ctx), date,
        "Paid " + p.hours + " h on Daily Manpower. No Afternoon Plan and no Morning Report.");
    });
  });
  return out;
}

function hrOtDmDates(ctx) {
  var S = hrOtState(ctx);
  var out = [], seen = {};
  Object.keys(S.daily || {}).forEach(function (k) {
    var rec = S.daily[k];
    var d = "";
    if (typeof payAuditDayOf === "function") d = payAuditDayOf(rec, k);
    else if (rec && rec.date) d = hrOtDay(rec.date);
    else {
      var m = String(k).match(/^d(\d{4})(\d{2})(\d{2})$/);
      if (m) d = m[1] + "-" + m[2] + "-" + m[3];
    }
    if (d && !seen[d]) { seen[d] = 1; out.push(d); }
  });
  return out;
}

function hrOtAuditNotRoster(ctx) {
  var out = [], seen = {};
  function consider(empId, row, date, where) {
    if (!empId || !hrOtInWindow(date, ctx)) return;
    if (hrOtOnRoster(empId, ctx)) return;
    hrOtPush(out, seen, "roster", hrOtPerson(empId, row, ctx), date,
      "Named on the " + where + " but not on the roster.");
  }
  hrOtPlans(ctx).forEach(function (plan) {
    (plan.rows || []).forEach(function (row) {
      if (row) consider(row.empId, row, hrOtDay(plan.otDate), "Afternoon Plan");
    });
  });
  hrOtReports(ctx).forEach(function (rep) {
    (rep.rows || []).forEach(function (row) {
      if (row) consider(row.empId, row, hrOtDay(rep.otDate), "Morning Report");
    });
  });
  return out;
}

function hrOtHoliday(date, ctx) {
  if (ctx && typeof ctx.holidayOn === "function") return ctx.holidayOn(date);
  if (typeof holidayOn === "function") {
    try { return holidayOn(date); } catch (e) { return null; }
  }
  return null;
}

function hrOtHolCode(row) {
  if (typeof holCode === "function") return holCode(row);
  var h = row && row.hol;
  if (h === 2 || h === "2" || h === 100 || h === "100") return 2;
  if (h === 1 || h === true || h === "1" || h === 0.3 || h === "0.3" || h === "30") return 1;
  return 0;
}

function hrOtAuditRestDay(ctx) {
  var out = [], seen = {}, dates = {};
  hrOtDmDates(ctx).forEach(function (d) { dates[d] = 1; });
  hrOtPlans(ctx).forEach(function (p) { dates[hrOtDay(p.otDate)] = 1; });
  hrOtReports(ctx).forEach(function (r) { dates[hrOtDay(r.otDate)] = 1; });
  Object.keys(dates).forEach(function (date) {
    if (!hrOtInWindow(date, ctx)) return;
    var dow = new Date(date + "T00:00:00").getDay();
    var hol = hrOtHoliday(date, ctx);
    if (dow !== 0 && !hol) return;
    var why = dow === 0 ? "Sunday" : (hol.n || "Holiday");
    var people = {};
    hrOtDmPeople(date, ctx).forEach(function (p) { if (p.hours > 0) people[p.empId] = p; });
    hrOtReports(ctx).forEach(function (rep) {
      if (hrOtDay(rep.otDate) !== date) return;
      (rep.rows || []).forEach(function (row) {
        if (!row || !row.empId) return;
        if (hrOtReportedHours(row.empId, date, ctx) > 0) people[row.empId] = people[row.empId] || { empId: row.empId, row: row, hours: 0 };
      });
    });
    Object.keys(people).forEach(function (empId) {
      var rec = hrOtDailyRec(date, ctx);
      var row = null;
      if (rec && rec.rows) {
        if (rec.rows[empId]) row = rec.rows[empId];
        else {
          Object.keys(rec.rows).forEach(function (k) {
            if (row) return;
            var id = typeof payAuditEmpId === "function" ? (payAuditEmpId(k, rec.rows[k]) || k) : k;
            if (id === empId) row = rec.rows[k];
          });
        }
      }
      if (hrOtHolCode(row) > 0) return;
      var dm = hrOtDmHours(empId, date, ctx);
      var reported = hrOtReportedHours(empId, date, ctx);
      if (!(dm > 0) && !(reported > 0)) return;
      hrOtPush(out, seen, "rest", hrOtPerson(empId, people[empId].row, ctx), date,
        why + " overtime. Rest-day premium is still As is. This does not change the premium.");
    });
  });
  return out;
}

function hrOtAuditCancelled(ctx) {
  var out = [], seen = {};
  hrOtReports(ctx).forEach(function (rep) {
    var date = hrOtDay(rep.otDate);
    if (!hrOtInWindow(date, ctx)) return;
    (rep.rows || []).forEach(function (row) {
      if (!row || !row.empId || !hrOtRowIsNoOt(rep, row)) return;
      var reason = hrOtRowReason(rep, row) || "no reason recorded";
      var note = hrOtRowNote(rep, row);
      hrOtPush(out, seen, "cancel", hrOtPerson(row.empId, row, ctx), date,
        "Plan cancelled (" + reason + ")." + (note ? " " + note : ""));
    });
  });
  return out;
}

function hrOtAuditNotInPlan(ctx) {
  var out = [], seen = {};
  hrOtReports(ctx).forEach(function (rep) {
    var date = hrOtDay(rep.otDate);
    if (!hrOtInWindow(date, ctx)) return;
    if (rep.noPlan || !rep.planId) return;
    (rep.rows || []).forEach(function (row) {
      if (!row || !row.empId) return;
      if (!hrOtPersonNotOnPlan(rep, row.empId, ctx)) return;
      hrOtPush(out, seen, "extra", hrOtPerson(row.empId, row, ctx), date,
        "Not on the Afternoon Plan. Reason: " + (row.notInPlanReason || "—") + ". This does not block pay.");
    });
  });
  return out;
}

function hrOtAuditChecks() {
  return [
    { id: "ot_dm_differs_report", severity: "review",
      description: "Daily Manpower OT hours are not the hours confirmed on the Morning Report.",
      run: hrOtAuditDmDiffers },
    { id: "ot_plan_no_report", severity: "review",
      description: "Afternoon Plan has no Morning Report.",
      run: hrOtAuditPlanNoReport },
    { id: "ot_report_no_plan", severity: "review",
      description: "Morning Report was filed with no Afternoon Plan.",
      run: hrOtAuditReportNoPlan },
    { id: "ot_hours_after_no_ot", severity: "review",
      description: "Daily Manpower OT was entered after No OT.",
      run: hrOtAuditHoursAfterNoOt },
    { id: "ot_dm_no_plan_or_report", severity: "review",
      description: "Daily Manpower OT has no Afternoon Plan and no Morning Report.",
      run: hrOtAuditDmNoForm },
    { id: "ot_employee_not_roster", severity: "review",
      description: "A name on an overtime form is not on the roster.",
      run: hrOtAuditNotRoster },
    { id: "ot_rest_day_premium", severity: "review",
      description: "Sunday or holiday overtime needs a rest-day premium check.",
      run: hrOtAuditRestDay },
    { id: "ot_plan_cancelled", severity: "info",
      description: "Plan cancelled (reason).",
      run: hrOtAuditCancelled },
    { id: "ot_not_in_plan", severity: "review",
      description: "Morning Report includes someone who was not on the Afternoon Plan.",
      run: hrOtAuditNotInPlan }
  ];
}

function hrOtAuditRun(ctx) {
  ctx = ctx || {};
  return hrOtAuditChecks().map(function (c) {
    var rows = (c.run(ctx) || []).map(function (r) {
      var key = (typeof payAuditItemKey === "function")
        ? payAuditItemKey(c.id, r.empId, r.date)
        : c.id + "|" + (r.empId || "") + "|" + hrOtDay(r.date);
      var rev = (ctx.reviews || {})[key] || null;
      return Object.assign({}, r, { key: key, review: rev });
    });
    return { id: c.id, description: c.description, severity: c.severity, count: rows.length, rows: rows };
  });
}

function hrOtFormHoursOn(date, ctx) {
  var d = hrOtDay(date), seen = {}, n = 0;
  hrOtReports(ctx).forEach(function (rep) {
    if (hrOtDay(rep.otDate) !== d) return;
    (rep.rows || []).forEach(function (row) {
      if (!row || !row.empId) return;
      seen[row.empId] = 1;
      n += hrOtRowConfirmedHours(rep, row);
    });
  });
  hrOtPlans(ctx).forEach(function (plan) {
    if (hrOtDay(plan.otDate) !== d || plan.noOt) return;
    (plan.rows || []).forEach(function (row) {
      if (!row || !row.empId || row.noOt || seen[row.empId]) return;
      n += hrOtHoursOf(row);
    });
  });
  return Math.round(n * 100) / 100;
}

function hrOtZeroDmDays(from, to, ctx) {
  var out = [];
  hrOtDates(from, to).forEach(function (date) {
    var formHours = hrOtFormHoursOn(date, ctx);
    var dm = 0;
    hrOtDmPeople(date, ctx).forEach(function (p) { dm += Number(p.hours) || 0; });
    dm = Math.round(dm * 100) / 100;
    if (formHours > 0 && !(dm > 0)) out.push({ date: date, formHours: formHours, dmOt: dm });
  });
  return out;
}

function hrOtEsc(s) {
  if (typeof esc === "function") return esc(s);
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function hrOtZeroDmWarningHtml(from, to, ctx) {
  var days = hrOtZeroDmDays(from, to, ctx);
  if (!days.length) return "";
  var bits = days.map(function (d) {
    return hrOtEsc(d.date) + " (" + hrOtEsc(String(d.formHours)) + " h on the forms, Daily Manpower OT 0)";
  });
  return '<div class="note" id="pay-ot-zero-dm" style="border-left:4px solid var(--crit);background:#fde8e8;margin:0 0 12px;padding:10px 12px">'
    + "<b>Overtime on the forms, zero Daily Manpower OT.</b> "
    + "Payroll pays the Daily Manpower OT number. "
    + bits.join("; ")
    + ". Approval is not blocked."
    + "</div>";
}

function hrOtAddProof(list, file) {
  var out = (list || []).slice();
  if (!file || !file.url) return out;
  if (out.some(function (f) { return f && f.url === file.url; })) return out;
  out.push({ url: file.url, title: file.title || "", on: file.on || "" });
  return out;
}

function hrOtPlansForDate(date, ctx) {
  var d = hrOtDay(date);
  return hrOtPlans(ctx).filter(function (p) { return hrOtDay(p.otDate) === d; });
}
