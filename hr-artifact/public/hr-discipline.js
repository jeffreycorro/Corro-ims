/**
 * Yearly disciplinary-action counts for the CorConDev HR artifact.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * A written reprimand, suspension, or termination is one row in the
 * "discipline" collection. Write-ups already on file, and a notice to
 * explain that already carries a sanction, are counted in the same year
 * so the dashboard is not empty until HR re-types history. A notice that
 * this screen already turned into a saved action is not counted twice.
 *
 * The signed scan is not stored here. fileOntoChecklist adds it to the
 * existing 201 checklist row (DAR / Memo, key darmemo) — the same links
 * list a checklist upload already uses.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.hrDiscipline = api;
  if (typeof window !== "undefined" && window) window.hrDiscipline = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DOC_KEY = "darmemo";
  var ACTIONS = ["Written Reprimand", "Suspension", "Termination"];
  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  function str(v) {
    return v == null ? "" : String(v);
  }

  function values(map) {
    if (!map || typeof map !== "object") return [];
    if (Array.isArray(map)) return map.filter(Boolean);
    return Object.keys(map).map(function (k) { return map[k]; }).filter(Boolean);
  }

  function normNo(v) {
    return str(v).replace(/\s+/g, "").toUpperCase();
  }

  function yearOf(date) {
    var y = str(date).slice(0, 4);
    return /^\d{4}$/.test(y) ? y : "";
  }

  function canonicalAction(action) {
    var s = str(action).trim();
    var i;
    for (i = 0; i < ACTIONS.length; i += 1) {
      if (ACTIONS[i].toLowerCase() === s.toLowerCase()) return ACTIONS[i];
    }
    return s;
  }

  function classifySanction(text, fallback) {
    var s = str(text);
    if (/terminat/i.test(s)) return "Termination";
    if (/suspens/i.test(s)) return "Suspension";
    if (/reprimand|written warning/i.test(s)) return "Written Reprimand";
    return fallback;
  }

  function inclusiveDays(from, to) {
    from = str(from).slice(0, 10);
    to = str(to).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return 0;
    var a = new Date(from + "T00:00:00");
    var b = new Date(to + "T00:00:00");
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  }

  function suspensionDays(rec) {
    rec = rec || {};
    var n = parseInt(rec.days, 10);
    if (n > 0) return n;
    return inclusiveDays(rec.from, rec.to);
  }

  function employee(S, id) {
    return (S && S.employees && S.employees[id]) || null;
  }

  function siteOf(emp) {
    if (!emp) return "Unassigned";
    var site = str(emp.project || emp.dept).trim();
    return site || "Unassigned";
  }

  function nameOf(emp) {
    if (!emp) return "(deleted record)";
    return str(emp.name).trim() || "(deleted record)";
  }

  function bucket() {
    return { reprimands: 0, suspensions: 0, other: 0, total: 0 };
  }

  function addCount(b, type) {
    b.total += 1;
    if (type === "Written Reprimand") b.reprimands += 1;
    else if (type === "Suspension") b.suspensions += 1;
    else b.other += 1;
  }

  function nteImplemented(n) {
    if (!n) return false;
    var status = str(n.status);
    if (!status || status === "draft") return false;
    if (status === "decided" || status === "closed") return true;
    return !!str(n.sanction).trim();
  }

  function nteOpen(n) {
    if (!n || nteImplemented(n)) return false;
    var status = str(n.status);
    return !!status && status !== "draft";
  }

  function rowsFor(S, year) {
    var rows = [];
    var linkedNte = {};
    var linkedWu = {};
    values(S.discipline).forEach(function (d) {
      if (!d) return;
      if (d.nteId) linkedNte[str(d.nteId)] = true;
      if (d.nteNo) linkedNte["no:" + normNo(d.nteNo)] = true;
      if (d.writeupId) linkedWu[str(d.writeupId)] = true;
    });

    values(S.discipline).forEach(function (d) {
      if (!d || yearOf(d.date) !== year) return;
      var emp = employee(S, d.empId);
      var type = canonicalAction(d.action) || "Disciplinary action";
      rows.push({
        id: "discipline:" + str(d.id),
        source: "discipline",
        sourceId: str(d.id),
        date: str(d.date).slice(0, 10),
        type: type,
        empId: str(d.empId),
        name: nameOf(emp),
        empNo: emp ? str(emp.empNo) : "",
        site: siteOf(emp),
        detail: str(d.offense || d.details).trim(),
        days: type === "Suspension" ? suspensionDays(d) : 0,
        from: str(d.from).slice(0, 10),
        to: str(d.to).slice(0, 10),
        no: str(d.no),
        signed: !!str(d.signedLink).trim(),
      });
    });

    values(S.writeups).forEach(function (w) {
      if (!w || yearOf(w.date) !== year) return;
      if (w.id && linkedWu[str(w.id)]) return;
      var emp = employee(S, w.empId);
      var type = classifySanction(w.sanction, "Write-up");
      rows.push({
        id: "writeups:" + str(w.id),
        source: "writeups",
        sourceId: str(w.id),
        date: str(w.date).slice(0, 10),
        type: type,
        empId: str(w.empId),
        name: nameOf(emp),
        empNo: emp ? str(emp.empNo) : "",
        site: siteOf(emp),
        detail: str(w.acts || w.sanction).trim(),
        days: type === "Suspension" ? suspensionDays(w) : 0,
        from: "",
        to: "",
        no: str(w.no),
        signed: !!w.acked || !!str(w.signedLink).trim(),
      });
    });

    values(S.nte).forEach(function (n) {
      if (!nteImplemented(n)) return;
      var when = str(n.nodOn || n.issued || n.date).slice(0, 10);
      if (yearOf(when) !== year) return;
      if (n.id && linkedNte[str(n.id)]) return;
      if (n.no && linkedNte["no:" + normNo(n.no)]) return;
      var emp = employee(S, n.empId);
      var type = classifySanction(n.sanction, "Notice of decision");
      rows.push({
        id: "nte:" + str(n.id),
        source: "nte",
        sourceId: str(n.id),
        date: when,
        type: type,
        empId: str(n.empId),
        name: nameOf(emp),
        empNo: emp ? str(emp.empNo) : "",
        site: siteOf(emp),
        detail: str(n.sanction || n.decision || n.acts).trim(),
        days: type === "Suspension" ? suspensionDays(n) : 0,
        from: "",
        to: "",
        no: str(n.nodNo || n.no),
        signed: !!str(n.signedLink).trim(),
      });
    });

    rows.sort(function (a, b) {
      if (a.date !== b.date) return str(b.date).localeCompare(str(a.date));
      return str(a.name).localeCompare(str(b.name));
    });
    return rows;
  }

  function yearsIn(S, year, today) {
    var seen = {};
    function add(date) {
      var y = yearOf(date);
      if (y) seen[y] = true;
    }
    values(S && S.discipline).forEach(function (d) { if (d) add(d.date); });
    values(S && S.writeups).forEach(function (w) { if (w) add(w.date); });
    values(S && S.nte).forEach(function (n) {
      if (!n) return;
      add(n.nodOn || n.issued || n.date);
    });
    add(year + "-01-01");
    add(today);
    return Object.keys(seen).sort(function (a, b) { return b.localeCompare(a); });
  }

  function summarize(S, year, today) {
    S = S || {};
    year = yearOf(year) || yearOf(today) || String(new Date().getFullYear());
    var rows = rowsFor(S, year);
    var totals = bucket();
    var byTypeMap = {};
    var byMonth = MONTHS.map(function (label, i) {
      var b = bucket();
      b.key = String(i + 1).padStart(2, "0");
      b.label = label;
      return b;
    });
    var siteMap = {};
    var empMap = {};

    rows.forEach(function (r) {
      addCount(totals, r.type);
      byTypeMap[r.type] = (byTypeMap[r.type] || 0) + 1;
      var mi = parseInt(str(r.date).slice(5, 7), 10) - 1;
      if (mi >= 0 && mi < 12) addCount(byMonth[mi], r.type);
      var site = r.site || "Unassigned";
      if (!siteMap[site]) {
        siteMap[site] = bucket();
        siteMap[site].site = site;
      }
      addCount(siteMap[site], r.type);
      var ek = r.empId || r.name;
      if (!empMap[ek]) {
        empMap[ek] = bucket();
        empMap[ek].empId = r.empId;
        empMap[ek].name = r.name;
        empMap[ek].empNo = r.empNo;
        empMap[ek].site = site;
      }
      addCount(empMap[ek], r.type);
    });

    var byType = Object.keys(byTypeMap).map(function (type) {
      return { type: type, count: byTypeMap[type] };
    });
    var order = ACTIONS.concat(["Write-up", "Notice of decision"]);
    byType.sort(function (a, b) {
      var ia = order.indexOf(a.type);
      var ib = order.indexOf(b.type);
      if (ia < 0) ia = 99;
      if (ib < 0) ib = 99;
      if (ia !== ib) return ia - ib;
      return b.count - a.count;
    });

    function byTotal(a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return str(a.site || a.name).localeCompare(str(b.site || b.name));
    }

    var openNotices = 0;
    values(S.nte).forEach(function (n) {
      if (!nteOpen(n)) return;
      if (yearOf(n.issued || n.date) === year) openNotices += 1;
    });

    return {
      year: year,
      years: yearsIn(S, year, today),
      implemented: totals.total,
      reprimands: totals.reprimands,
      suspensions: totals.suspensions,
      other: totals.other,
      openNotices: openNotices,
      byType: byType,
      byMonth: byMonth,
      bySite: Object.keys(siteMap).map(function (k) { return siteMap[k]; }).sort(byTotal),
      byEmployee: Object.keys(empMap).map(function (k) { return empMap[k]; }).sort(byTotal),
      rows: rows,
    };
  }

  /**
   * Add one scan to a 201 checklist row. Same shape as the portal's
   * docFiles / docAddLink list: `link` is the first file, `links` is all
   * of them. A second file is appended. The same URL is not stored twice.
   * A row marked "exp" (for renewal) stays that way.
   */
  function fileOntoChecklist(docs, docKey, url, title, filedOn) {
    docs = docs && typeof docs === "object" && !Array.isArray(docs) ? docs : {};
    docKey = str(docKey || DOC_KEY);
    url = str(url).trim();
    var prev = docs[docKey] && typeof docs[docKey] === "object" ? docs[docKey] : {};
    var slot = {
      s: prev.s || "miss",
      link: str(prev.link),
      title: str(prev.title),
      links: [],
      filed: str(prev.filed).slice(0, 10),
      expiry: str(prev.expiry),
    };
    var list = [];
    var seen = {};
    function push(u, t, on) {
      u = str(u).trim();
      if (!u) return;
      if (seen[u]) {
        if (!seen[u].title && t) seen[u].title = t;
        if (!seen[u].on && on) seen[u].on = on;
        return;
      }
      var row = { url: u, title: str(t), on: str(on).slice(0, 10) };
      seen[u] = row;
      list.push(row);
    }
    push(prev.link, prev.title, prev.filed);
    (Array.isArray(prev.links) ? prev.links : []).forEach(function (x) {
      if (typeof x === "string") push(x, "", "");
      else if (x) push(x.url, x.title, x.on);
    });
    if (url) push(url, title, filedOn);
    slot.links = list.map(function (x) {
      return { url: x.url, title: x.title || "", on: x.on || "" };
    });
    slot.link = list.length ? list[0].url : "";
    slot.title = list.length ? (list[0].title || "") : "";
    if (url) {
      if (slot.s !== "exp") slot.s = "on";
      if (!slot.filed) slot.filed = str(filedOn).slice(0, 10);
    }
    var next = {};
    Object.keys(docs).forEach(function (k) { next[k] = docs[k]; });
    next[docKey] = slot;
    return next;
  }

  return {
    attached: true,
    DOC_KEY: DOC_KEY,
    ACTIONS: ACTIONS.slice(),
    canonicalAction: canonicalAction,
    inclusiveDays: inclusiveDays,
    suspensionDays: suspensionDays,
    summarize: summarize,
    fileOntoChecklist: fileOntoChecklist,
  };
});
