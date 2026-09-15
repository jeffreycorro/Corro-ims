/**
 * Person-tagged paperwork on the 201 file.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * Indexes collections already keyed by empId / employee refs and injects
 * an "On file for this person" list on the open 201 profile. No blobs are
 * copied — new tagged records appear after the next save/render.
 */
(function (root) {
  "use strict";

  if (root.hr201File && root.hr201File.attached) return;

  var api = { attached: false };

  var NTE_STATUS = {
    draft: "Draft",
    issued: "Issued — awaiting explanation",
    explained: "Explanation received",
    hearing: "Hearing set",
    decided: "Decided — NOD issued",
    closed: "Closed",
  };

  var SERIES_TYPE = {
    NTE: "NTE",
    NOD: "Notice of Decision",
    WW: "Write-up",
    CM: "Memo",
    MEMO: "Memo",
    IR: "Incident",
    LV: "Leave",
    CA: "Cash advance",
    RM: "Reminder",
    COE: "Certificate",
    CON: "Contract",
    CLR: "Clearance",
    PE: "Evaluation",
    DM: "Disciplinary memo",
    NCR: "Non-conformance",
    PAF: "Personnel action",
    OFR: "Job offer",
  };

  /* docreg.module → source collection already listed as its own row */
  var REG_MODULE_SOURCE = {
    nte: "nte",
    leave: "leaves",
    ca: "advances",
    memo: "memos",
    incident: "incidents",
    reminder: "reminders",
    wu: "writeups",
  };

  function store(S) {
    if (S && typeof S === "object") return S;
    return root.S || {};
  }

  function values(map) {
    if (!map || typeof map !== "object") return [];
    if (Array.isArray(map)) return map.filter(Boolean);
    return Object.keys(map).map(function (k) {
      return map[k];
    }).filter(Boolean);
  }

  function str(v) {
    return v == null ? "" : String(v);
  }

  function esc(s) {
    return str(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normNo(s) {
    return str(s).replace(/\s+/g, "").toUpperCase();
  }

  function normUrl(s) {
    return str(s).trim();
  }

  function sameId(a, b) {
    return a && b && str(a) === str(b);
  }

  function offenseName(cat, S) {
    var list = (root.OFFENSES || (S && S.OFFENSES) || []);
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].k === cat) return list[i].n || cat;
    }
    return cat || "";
  }

  function nteStatusLabel(n) {
    var flow = root.NTE_FLOW;
    var k = n && n.status;
    var i;
    if (flow && flow.length) {
      for (i = 0; i < flow.length; i += 1) {
        if (flow[i] && flow[i].k === k) return flow[i].n;
      }
    }
    return NTE_STATUS[k] || k || "—";
  }

  function statusSev(status) {
    var s = str(status).toLowerCase();
    if (!s || s === "—") return "mut";
    if (/void|cancel/.test(s)) return "mut";
    if (/overdue/.test(s)) return "crit";
    if (/draft|await|unsigned|requested|for signature|filed$|open\b|explanation received|hearing/.test(s)) {
      return /open\b/.test(s) ? "crit" : "warn";
    }
    if (/issued|approved|availed|closed|decided|signed|complete|ok/.test(s)) return "ok";
    return "mut";
  }

  function pill(sev, text) {
    return '<span class="pill ' + esc(sev) + '">' + esc(text) + "</span>";
  }

  function item(partial) {
    var it = {
      key: "",
      date: "",
      type: "",
      typeKey: "",
      no: "",
      title: "",
      status: "",
      source: "",
      sourceId: "",
      link: "",
      canOpen: true,
      canPrint: false,
      unlinkIndex: null,
    };
    var k;
    for (k in partial) {
      if (Object.prototype.hasOwnProperty.call(partial, k)) it[k] = partial[k];
    }
    it.key = it.key || (it.source + ":" + it.sourceId);
    it.statusSev = statusSev(it.status);
    return it;
  }

  function push(out, it) {
    if (!it) return;
    out.push(item(it));
  }

  function memoTagsEmp(m, empId) {
    if (!m || !empId) return false;
    if (sameId(m.empId, empId)) return true;
    return m.audience === "Individual" && sameId(m.audienceDetail, empId);
  }

  function reminderTagsEmp(r, empId) {
    if (!r || !empId) return false;
    if (sameId(r.empId, empId)) return true;
    var ids = r.empIds || [];
    var i;
    for (i = 0; i < ids.length; i += 1) {
      if (sameId(ids[i], empId)) return true;
    }
    return false;
  }

  function incidentTagsEmp(i, empId) {
    if (!i || !empId) return false;
    if (sameId(i.empId, empId)) return true;
    var people = i.persons || [];
    var n;
    for (n = 0; n < people.length; n += 1) {
      if (sameId(people[n], empId)) return true;
    }
    return false;
  }

  function collectSource(S, empId) {
    var out = [];
    var e = (S.employees || {})[empId] || {};

    values(S.nte).forEach(function (n) {
      if (!sameId(n.empId, empId)) return;
      push(out, {
        date: n.issued || n.date || "",
        type: "NTE",
        typeKey: "nte",
        no: n.no || "",
        title: offenseName(n.cat, S) || n.incident || "Notice to Explain",
        status: nteStatusLabel(n),
        source: "nte",
        sourceId: n.id,
        link: n.link || "",
        canPrint: true,
      });
    });

    values(S.writeups).forEach(function (w) {
      if (!sameId(w.empId, empId)) return;
      push(out, {
        date: w.date || "",
        type: "Write-up",
        typeKey: "writeup",
        no: w.no || "",
        title: offenseName(w.cat, S) || w.sanction || "Write-up",
        status: w.acked ? "Signed" : "Unsigned",
        source: "writeups",
        sourceId: w.id,
        canPrint: true,
      });
    });

    values(S.memos).forEach(function (m) {
      if (!memoTagsEmp(m, empId)) return;
      push(out, {
        date: m.date || m.effectivity || "",
        type: "Memo",
        typeKey: "memo",
        no: m.no || "",
        title: m.subject || m.fileTitle || "Memorandum",
        status: m.status || (m.fromDrive ? "Filed" : ""),
        source: "memos",
        sourceId: m.id,
        link: m.link || "",
        canPrint: true,
      });
    });

    values(S.incidents).forEach(function (inc) {
      if (!incidentTagsEmp(inc, empId)) return;
      push(out, {
        date: inc.date || "",
        type: "Incident",
        typeKey: "incident",
        no: inc.no || "",
        title: inc.type || inc.location || "Incident report",
        status: inc.stage || "",
        source: "incidents",
        sourceId: inc.id,
        link: inc.evidenceLink || "",
        canPrint: true,
      });
    });

    values(S.leaves).forEach(function (l) {
      if (!sameId(l.empId, empId)) return;
      push(out, {
        date: l.filedOn || l.from || l.date || "",
        type: "Leave",
        typeKey: "leave",
        no: l.no || "",
        title: (l.type || "Leave") + (l.from ? " · " + l.from + (l.to && l.to !== l.from ? "–" + l.to : "") : ""),
        status: l.status || "",
        source: "leaves",
        sourceId: l.id,
        link: l.link || "",
        canPrint: true,
      });
    });

    values(S.advances).forEach(function (a) {
      if (!sameId(a.empId, empId)) return;
      push(out, {
        date: a.date || "",
        type: "Cash advance",
        typeKey: "advance",
        no: a.no || "",
        title: a.particulars || a.purpose || "Cash advance",
        status: a.status || "",
        source: "advances",
        sourceId: a.id,
        link: a.link || "",
        canPrint: true,
      });
    });

    values(S.reminders).forEach(function (r) {
      if (!reminderTagsEmp(r, empId)) return;
      push(out, {
        date: r.date || "",
        type: "Reminder",
        typeKey: "reminder",
        no: r.no || "",
        title: r.subject || r.brief || "Written reminder",
        status: r.status || "",
        source: "reminders",
        sourceId: r.id,
        canPrint: false,
      });
    });

    values(S.genfiles).forEach(function (g) {
      if (!sameId(g.empId, empId)) return;
      push(out, {
        date: g.on || "",
        type: "General file",
        typeKey: "genfile",
        no: "",
        title: g.title || "General file",
        status: "Tagged",
        source: "genfiles",
        sourceId: g.id,
        link: g.url || "",
        canPrint: false,
      });
    });

    (e.linkedDocs || []).forEach(function (l, idx) {
      if (!l) return;
      push(out, {
        date: l.added || "",
        type: "Linked file",
        typeKey: "linked",
        no: "",
        title: l.title || "(untitled)",
        status: "Linked",
        source: "linked",
        sourceId: String(idx),
        link: l.url || "",
        canOpen: !!l.url,
        canPrint: false,
        unlinkIndex: idx,
      });
    });

    return out;
  }

  function alreadyHasNo(items, no) {
    var n = normNo(no);
    if (!n) return false;
    var i;
    for (i = 0; i < items.length; i += 1) {
      if (normNo(items[i].no) === n) return true;
    }
    return false;
  }

  function alreadyHasLink(items, url) {
    var u = normUrl(url);
    if (!u) return false;
    var i;
    for (i = 0; i < items.length; i += 1) {
      if (normUrl(items[i].link) === u) return true;
    }
    return false;
  }

  function alreadyHasSource(items, source, id) {
    var i;
    if (!source || !id) return false;
    for (i = 0; i < items.length; i += 1) {
      if (items[i].source === source && sameId(items[i].sourceId, id)) return true;
    }
    return false;
  }

  function collectRegister(S, empId, existing) {
    var out = [];
    values(S.docreg).forEach(function (d) {
      if (!sameId(d.empId, empId)) return;
      var src = REG_MODULE_SOURCE[d.module];
      if (src && alreadyHasSource(existing, src, d.refId)) return;
      if (alreadyHasNo(existing, d.no) || alreadyHasNo(out, d.no)) return;
      push(out, {
        date: d.date || "",
        type: SERIES_TYPE[d.seriesKey] || d.title || "Register",
        typeKey: (d.seriesKey || "reg").toLowerCase(),
        no: d.no || "",
        title: d.title || SERIES_TYPE[d.seriesKey] || d.seriesKey || "Register entry",
        status: d.status || "",
        source: "docreg",
        sourceId: d.id,
        link: d.link || "",
        canPrint: true,
      });
    });
    return out;
  }

  function collectFiled(S, empId, existing) {
    var out = [];
    var kinds = root.FILED_KINDS || [];
    values(S.filed).forEach(function (f) {
      if (!sameId(f.empId, empId)) return;
      if (alreadyHasNo(existing, f.no) || alreadyHasLink(existing, f.link)) return;
      if (alreadyHasNo(out, f.no) || alreadyHasLink(out, f.link)) return;
      var kind = null;
      var i;
      for (i = 0; i < kinds.length; i += 1) {
        if (kinds[i] && kinds[i].k === f.kind) kind = kinds[i];
      }
      push(out, {
        date: f.date || f.modified || "",
        type: kind ? String(kind.n || f.kind).replace(/s$/, "") : (f.kind || "Filed"),
        typeKey: "filed",
        no: f.no || "",
        title: f.title || "Filed form",
        status: "Filed",
        source: "filed",
        sourceId: f.id,
        link: f.link || "",
        canOpen: !!f.link,
        canPrint: false,
      });
    });
    return out;
  }

  function recordsFor(empId, S) {
    S = store(S);
    if (!empId) return [];
    var source = collectSource(S, empId);
    var extra = collectRegister(S, empId, source).concat(collectFiled(S, empId, source));
    var all = source.concat(extra);
    all.sort(function (a, b) {
      var ad = str(a.date);
      var bd = str(b.date);
      if (ad !== bd) return bd.localeCompare(ad);
      if (a.type !== b.type) return str(a.type).localeCompare(str(b.type));
      return str(b.no).localeCompare(str(a.no));
    });
    return all;
  }

  function sectionHtml(emp, records) {
    var n = records.length;
    var h =
      '<section id="hr-201-onfile" class="hr-201-onfile" data-emp="' +
      esc(emp && emp.id) +
      '">' +
      '<div class="sect-h" style="margin:6px 0 0"><h2 style="font-size:13px">On file for this person</h2>' +
      '<span class="rule"></span><span class="lbl">' +
      n +
      " on record</span></div>";
    if (!n) {
      h +=
        '<div class="lbl" style="padding:4px 0">Nothing tagged to this record yet. NTEs, notices of ' +
        "decision, write-ups, memos, incidents, leave, cash advances, certificates and other " +
        "register entries appear here once they name this employee — including after they separate.</div>";
    } else {
      h +=
        '<div class="tw hr-201-table"><table><thead><tr>' +
        '<th style="width:96px">Date</th><th style="width:130px">Type</th>' +
        "<th>Number / title</th><th style=\"width:150px\">Status</th>" +
        '<th style="width:140px"></th></tr></thead><tbody>';
      records.forEach(function (r) {
        h +=
          "<tr>" +
          '<td class="mono" data-col="Date">' +
          esc(r.date || "—") +
          "</td>" +
          "<td data-col=\"Type\">" +
          esc(r.type) +
          "</td>" +
          "<td data-col=\"Number / title\">" +
          (r.no ? '<b class="mono">' + esc(r.no) + "</b> " : "") +
          esc(r.title || "—") +
          "</td>" +
          '<td data-col="Status">' +
          pill(r.statusSev, r.status || "—") +
          "</td>" +
          "<td><div class=\"row hr-201-actions\">";
        if (r.canOpen) {
          h +=
            '<button type="button" class="btn sm pri" data-hr201-open="' +
            esc(r.source) +
            ":" +
            esc(r.sourceId) +
            '">Open</button>';
        }
        if (r.canPrint) {
          h +=
            '<button type="button" class="btn sm" data-hr201-print="' +
            esc(r.source) +
            ":" +
            esc(r.sourceId) +
            '">Print</button>';
        }
        if (r.link) {
          h +=
            '<a class="btn sm" href="' +
            esc(r.link) +
            '" target="_blank" rel="noopener noreferrer" title="Open the file">Scan</a>';
        }
        h += "</div></td></tr>";
      });
      h += "</tbody></table></div>";
    }
    h +=
      '<p class="lbl" style="margin:8px 0 0">This list is built from records already tagged to ' +
      "this employee. It does not copy files, and it still shows after they separate.</p></section>";
    return h;
  }

  function findRecord(empId, token, S) {
    var parts = str(token).split(":");
    var source = parts.shift();
    var id = parts.join(":");
    var list = recordsFor(empId, S);
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (list[i].source === source && sameId(list[i].sourceId, id)) return list[i];
    }
    return null;
  }

  function recOf(source, id, S) {
    S = store(S);
    var maps = {
      nte: S.nte,
      writeups: S.writeups,
      memos: S.memos,
      incidents: S.incidents,
      leaves: S.leaves,
      advances: S.advances,
      reminders: S.reminders,
      docreg: S.docreg,
      filed: S.filed,
      genfiles: S.genfiles,
    };
    return (maps[source] || {})[id] || null;
  }

  function call(name, a, b, c) {
    var fn = root[name];
    if (typeof fn === "function") return fn(a, b, c);
    return undefined;
  }

  function openRecord(rec, S) {
    if (!rec) return false;
    if (rec.source === "nte") {
      call("nteEditor", rec.sourceId);
      return true;
    }
    if (rec.source === "writeups") {
      call("wuEditor", rec.sourceId);
      return true;
    }
    if (rec.source === "memos") {
      call("memoEditor", rec.sourceId);
      return true;
    }
    if (rec.source === "incidents") {
      call("incEditor", rec.sourceId);
      return true;
    }
    if (rec.source === "leaves") {
      call("lvEditor", rec.sourceId);
      return true;
    }
    if (rec.source === "advances") {
      call("caEditor", rec.sourceId);
      return true;
    }
    if (rec.source === "reminders") {
      call("remEditor", rec.sourceId);
      return true;
    }
    if (rec.source === "docreg") {
      if (typeof root.reopenDoc === "function") call("reopenDoc", rec.sourceId);
      else call("regEditor", rec.sourceId);
      return true;
    }
    if (rec.link && (rec.source === "filed" || rec.source === "genfiles" || rec.source === "linked")) {
      if (root.open) root.open(rec.link, "_blank", "noopener");
      return true;
    }
    return false;
  }

  function printRecord(rec, S) {
    if (!rec) return false;
    var raw = recOf(rec.source, rec.sourceId, S);
    if (rec.source === "nte") {
      call("previewNTE", rec.sourceId);
      return true;
    }
    if (rec.source === "writeups") {
      call("wuEditor", rec.sourceId);
      return true;
    }
    if (rec.source === "memos") {
      if (raw) call("previewMemo", raw);
      else call("memoEditor", rec.sourceId);
      return true;
    }
    if (rec.source === "incidents" && raw) {
      call("printIncident", raw);
      return true;
    }
    if (rec.source === "leaves" && raw) {
      call("printLeave", raw);
      return true;
    }
    if (rec.source === "advances" && raw) {
      call("printCA", raw);
      return true;
    }
    if (rec.source === "docreg") {
      if (typeof root.reopenDoc === "function") call("reopenDoc", rec.sourceId);
      else call("regEditor", rec.sourceId);
      return true;
    }
    return openRecord(rec, S);
  }

  function currentEmp(S) {
    S = store(S);
    var ui = S.ui || {};
    var id = ui.emp || ui.openEmp;
    if (!id || !S.employees) return null;
    return S.employees[id] || null;
  }

  function takeOpenEmp(S) {
    S = store(S);
    if (!S.ui) return false;
    var id = S.ui.openEmp;
    if (!id || !S.employees || !S.employees[id]) return false;
    S.ui.emp = id;
    S.ui.openEmp = "";
    return true;
  }

  function folderRoot(doc) {
    doc = doc || root.document;
    if (!doc || !doc.querySelector) return null;
    var view = doc.getElementById ? doc.getElementById("view") : null;
    return (view && view.querySelector && view.querySelector(".folder")) || doc.querySelector(".folder");
  }

  function ensureStyles(doc) {
    doc = doc || root.document;
    if (!doc || !doc.createElement || (doc.getElementById && doc.getElementById("hr-201-file-styles"))) {
      return;
    }
    var style = doc.createElement("style");
    style.id = "hr-201-file-styles";
    style.textContent =
      ".hr-201-onfile{margin:10px 0 4px}" +
      ".hr-201-onfile .hr-201-actions{flex-wrap:wrap;gap:6px}" +
      ".hr-201-onfile .btn{min-height:40px}" +
      "@media (max-width:700px){" +
      ".hr-201-onfile .hr-201-table thead{display:none}" +
      ".hr-201-onfile .hr-201-table table,.hr-201-onfile .hr-201-table tbody," +
      ".hr-201-onfile .hr-201-table tr,.hr-201-onfile .hr-201-table td{display:block;width:100%}" +
      ".hr-201-onfile .hr-201-table tr{padding:10px 0;border-bottom:1px solid var(--line,#e6e1d5)}" +
      ".hr-201-onfile .hr-201-table td{padding:2px 0}" +
      ".hr-201-onfile .hr-201-table td::before{content:attr(data-col);display:block;font-size:10px;" +
      "letter-spacing:.04em;text-transform:uppercase;color:var(--ink3,#8a8478);margin-bottom:1px}" +
      ".hr-201-onfile .hr-201-table td:last-child::before{display:none}" +
      "}";
    var parent = (doc.head || doc.documentElement || doc.body);
    if (parent && parent.appendChild) parent.appendChild(style);
  }

  function linkGeneralRow() {
    return (
      '<div class="row" style="margin-top:9px"><button class="btn sm" id="link-general">' +
      '<svg><use href="#i-link"/></svg> Link a general file to this employee</button>' +
      '<span class="lbl">for a document that lives in GENERAL FILES but applies to this person</span></div>'
    );
  }

  function wrapPaperTrail() {
    if (typeof root.empPaperTrail !== "function" || root.empPaperTrail.__hr201) return;
    root.empPaperTrail = function () {
      return linkGeneralRow();
    };
    root.empPaperTrail.__hr201 = true;
  }

  function inject(doc, S) {
    doc = doc || root.document;
    S = store(S);
    if (!doc) return null;
    ensureStyles(doc);
    wrapPaperTrail();
    var folder = folderRoot(doc);
    var existing = doc.getElementById ? doc.getElementById("hr-201-onfile") : null;
    if (!S.ui || S.ui.view !== "employees" || !folder) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return null;
    }
    var emp = currentEmp(S);
    if (!emp) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return null;
    }
    var html = sectionHtml(emp, recordsFor(emp.id, S));
    var wrap = doc.createElement ? doc.createElement("div") : null;
    var node;
    if (wrap) {
      wrap.innerHTML = html;
      node = wrap.firstChild || (wrap.children && wrap.children[0]) || null;
    }
    if (!node) return existing;
    if (existing && existing.parentNode) {
      existing.parentNode.replaceChild(node, existing);
    } else {
      var tabs = folder.querySelector && folder.querySelector(".tabs");
      var cardB = folder.querySelector && folder.querySelector(".card-b");
      if (cardB && cardB.parentNode) cardB.parentNode.insertBefore(node, cardB);
      else if (tabs && tabs.parentNode) {
        if (tabs.nextSibling) tabs.parentNode.insertBefore(node, tabs.nextSibling);
        else tabs.parentNode.appendChild(node);
      } else folder.appendChild(node);
    }
    return node;
  }

  function onAction(ev) {
    var t = ev && ev.target;
    while (t && t !== root.document && !(t.getAttribute && (t.getAttribute("data-hr201-open") || t.getAttribute("data-hr201-print")))) {
      t = t.parentNode;
    }
    if (!t || !t.getAttribute) return;
    var openTok = t.getAttribute("data-hr201-open");
    var printTok = t.getAttribute("data-hr201-print");
    var tok = openTok || printTok;
    if (!tok) return;
    if (ev.preventDefault) ev.preventDefault();
    var S = store();
    var emp = currentEmp(S);
    var rec = findRecord(emp && emp.id, tok, S);
    if (!rec) return;
    if (printTok) printRecord(rec, S);
    else openRecord(rec, S);
  }

  function bindClicks(doc) {
    doc = doc || root.document;
    if (!doc || doc.__hr201Clicks) return;
    doc.__hr201Clicks = true;
    if (doc.addEventListener) doc.addEventListener("click", onAction, false);
  }

  function wrapRender() {
    if (typeof root.render !== "function" || root.render.__hr201) return;
    var orig = root.render;
    root.render = function () {
      takeOpenEmp();
      var r = orig.apply(this, arguments);
      try {
        inject();
      } catch (err) {}
      return r;
    };
    root.render.__hr201 = true;
  }

  function attach() {
    if (api.attached) return api;
    wrapPaperTrail();
    wrapRender();
    bindClicks();
    if (typeof root.document !== "undefined") {
      if (root.document.readyState === "loading") {
        root.document.addEventListener("DOMContentLoaded", function () {
          inject();
        });
      } else {
        inject();
      }
    }
    api.attached = true;
    return api;
  }

  api.recordsFor = recordsFor;
  api.sectionHtml = sectionHtml;
  api.openRecord = openRecord;
  api.printRecord = printRecord;
  api.findRecord = findRecord;
  api.inject = inject;
  api.takeOpenEmp = takeOpenEmp;
  api.install = attach;
  root.hr201File = api;

  if (typeof root.document !== "undefined") {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
