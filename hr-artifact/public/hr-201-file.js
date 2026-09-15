/**
 * Person-tagged paperwork on the 201 file.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * Indexes collections already keyed by empId / employee refs and injects
 * an "On file for this person" list on the open 201 profile. No blobs are
 * copied — new tagged records appear after the next save/render.
 *
 * Also appends the Collectibles / GovMan rows Cassie asked for (refusal,
 * clearance, last-salary and 13th-month quitclaims) and an attach-via-link
 * door that still works when Drive upload is offline.
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

  /* Appended — never inserted — so the imported masterlist bit string
     still lines up with the first 33 columns. */
  var EXTRA_DOCS = [
    { k: "benref", n: "Refusal for GovMan Deduction", g: "Statutory", opt: 1 },
    { k: "clrform", n: "Employee Clearance Form", g: "Separation", opt: 1, code: "R50" },
    { k: "qclast", n: "Quitclaim — Last Salary", g: "Quitclaim", opt: 1 },
    { k: "qcprorata", n: "Quitclaim — Pro-Rated 13th Month", g: "Quitclaim", opt: 1 },
    { k: "qc13th", n: "Quitclaim — 13th Month Pay", g: "Quitclaim", opt: 1 },
  ];

  /* More specific than the artifact's general quitclaim / benefit rules.
     Unshifted so "Quitclaim - Last Salary.pdf" does not land on qcrel. */
  var EXTRA_GUESSES = [
    [/quitclaim.{0,48}last\s*salar|last\s*salar.{0,48}quitclaim/i, "qclast"],
    [/quitclaim.{0,48}pro[\s-]*rated|pro[\s-]*rated.{0,40}13/i, "qcprorata"],
    [/quitclaim.{0,48}13th\s*month\s*pay|13th\s*month\s*pay.{0,48}quitclaim/i, "qc13th"],
    [/employee\s*clearance|clearance\s*form|\br50\b/i, "clrform"],
    [/refusal.{0,32}(gov|benefit|deduct)|decline.{0,32}government|gov.?man.{0,24}refus/i, "benref"],
  ];

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

  function decodeDocName(n) {
    return str(n)
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function fallbackFiles(v) {
    if (!v) return [];
    var out = [];
    var seen = {};
    function pushFile(url, title, on) {
      url = str(url).trim();
      if (!url || seen[url]) return;
      seen[url] = true;
      out.push({ url: url, title: title || "", on: on || "" });
    }
    pushFile(v.link, v.title, v.filed);
    (v.links || []).forEach(function (x) {
      if (typeof x === "string") pushFile(x, "", "");
      else if (x) pushFile(x.url, x.title, x.on);
    });
    return out;
  }

  function filesOf(v) {
    if (typeof root.docFiles === "function") return root.docFiles(v);
    return fallbackFiles(v);
  }

  function collectChecklist(S, empId, existing) {
    var out = [];
    var e = (S.employees || {})[empId] || {};
    var docs = e.docs || {};
    (root.DOCS || []).forEach(function (d) {
      if (!d || !d.k) return;
      filesOf(docs[d.k]).forEach(function (f, i) {
        if (!f || !f.url) return;
        if (alreadyHasLink(existing, f.url) || alreadyHasLink(out, f.url)) return;
        push(out, {
          date: f.on || (docs[d.k] && docs[d.k].filed) || "",
          type: decodeDocName(d.n),
          typeKey: d.k,
          no: d.code || "",
          title: f.title || decodeDocName(d.n),
          status: docs[d.k] && docs[d.k].s === "on" ? "On file" : "Linked",
          source: "docs",
          sourceId: d.k + ":" + i,
          link: f.url,
          canOpen: true,
          canPrint: false,
        });
      });
    });
    return out;
  }

  function recordsFor(empId, S) {
    S = store(S);
    if (!empId) return [];
    var source = collectSource(S, empId);
    var extra = collectRegister(S, empId, source).concat(collectFiled(S, empId, source));
    var checks = collectChecklist(S, empId, source.concat(extra));
    var all = source.concat(extra).concat(checks);
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
        "register entries appear here once they name this employee — including after they separate. " +
        "Paste a Drive share link on the 201 checklist to attach a scan (GovMan refusal, resignation, " +
        "clearance, quitclaims).</div>" +
        '<div class="row" style="margin-top:8px"><button type="button" class="btn sm pri" data-hr201-attach-any="1">' +
        "Attach a Drive link to the 201</button></div>";
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
    if (rec.link && (rec.source === "filed" || rec.source === "genfiles" || rec.source === "linked" || rec.source === "docs")) {
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
      ".hr-201-attach-note{margin:0 0 10px}" +
      ".hr-201-attach-note .btn{margin-top:6px}" +
      "input[data-addlink]{min-width:180px;width:min(100%,280px)!important}" +
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
    while (t && t !== root.document) {
      if (t.getAttribute) {
        if (t.id === "hr-201-attach-any" || t.getAttribute("data-hr201-attach-any")) {
          if (ev.preventDefault) ev.preventDefault();
          var empAny = currentEmp();
          openAttachModal(empAny && empAny.id, "");
          return;
        }
        var attachKey = t.getAttribute("data-hr201-attach");
        if (attachKey) {
          if (ev.preventDefault) ev.preventDefault();
          var empAtt = currentEmp();
          openAttachModal(empAtt && empAtt.id, attachKey);
          return;
        }
        if (t.getAttribute("data-hr201-open") || t.getAttribute("data-hr201-print")) break;
      }
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

  function registerChecklist(Sroot) {
    Sroot = Sroot || root;
    var docs = Sroot.DOCS;
    var added = [];
    if (Array.isArray(docs)) {
      EXTRA_DOCS.forEach(function (d) {
        if (docs.some(function (x) { return x && x.k === d.k; })) return;
        var row = { k: d.k, n: d.n, g: d.g, opt: 1 };
        if (d.code) row.code = d.code;
        docs.push(row);
        added.push(d.k);
      });
      docs.forEach(function (d) {
        if (!d) return;
        if (d.k === "benefack") {
          d.n = "GovMan Deduction — acknowledged";
          d.g = "Statutory";
        }
        if (d.k === "qcrel") d.n = "Release & Quitclaim";
        if (d.n) d.n = decodeDocName(d.n);
      });
    }
    var guess = Sroot.GUESS;
    if (Array.isArray(guess)) {
      var i;
      for (i = 0; i < guess.length; i += 1) {
        var re = guess[i] && guess[i][0];
        var src = re && (re.source || String(re));
        if (src && /benefit.*deduction|refusal.*benefit/i.test(src)) {
          guess[i] = [/benefit.*deduction|gov.?man.*deduct|acknowledged.*benefit/i, "benefack"];
        }
      }
      EXTRA_GUESSES.slice()
        .reverse()
        .forEach(function (pair) {
          if (guess.some(function (x) { return x && x[1] === pair[1]; })) return;
          guess.unshift(pair);
        });
    }
    return { added: added };
  }

  function normalizeDriveUrl(raw) {
    var s = str(raw).trim();
    if (!s) return "";
    var m = s.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return "https://drive.google.com/file/d/" + m[1] + "/view";
    m = s.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
    if (m) return "https://drive.google.com/file/d/" + m[1] + "/view";
    m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m && /google\.com/i.test(s)) return "https://drive.google.com/file/d/" + m[1] + "/view";
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return "https://drive.google.com/file/d/" + s + "/view";
    return "";
  }

  function applyAttach(emp, docKey, url, title, today) {
    url = normalizeDriveUrl(url);
    if (!emp || !docKey) return { ok: false, error: "Choose a checklist row." };
    if (!url) return { ok: false, error: "Paste a Drive share link or file id." };
    emp.docs = emp.docs || {};
    emp.docs[docKey] = emp.docs[docKey] || { s: "miss", link: "", links: [], filed: "", expiry: "" };
    var added;
    if (typeof root.docAddLink === "function") {
      added = root.docAddLink(emp.docs[docKey], url, title || "");
    } else {
      var have = filesOf(emp.docs[docKey]).some(function (x) { return x.url === url; });
      if (have) added = false;
      else {
        var v = emp.docs[docKey];
        v.links = (v.links || []).concat([{ url: url, title: title || "", on: today || "" }]);
        if (!v.link) {
          v.link = url;
          v.title = title || "";
        }
        added = true;
      }
    }
    if (!added) return { ok: false, error: "That file is already on this row." };
    if (emp.docs[docKey].s === "miss" || emp.docs[docKey].s === "na") emp.docs[docKey].s = "on";
    if (!emp.docs[docKey].filed) emp.docs[docKey].filed = today || root.TODAY || "";
    return { ok: true, url: url, docKey: docKey, empId: emp.id };
  }

  function attachLink(empId, docKey, url, title) {
    var S = store();
    var emp = (S.employees || {})[empId];
    if (!emp) return Promise.resolve({ ok: false, error: "No employee is open." });
    var c = typeof root.clone === "function" ? root.clone(emp) : JSON.parse(JSON.stringify(emp));
    var res = applyAttach(c, docKey, url, title, root.TODAY);
    if (!res.ok) return Promise.resolve(res);
    if (typeof root.put === "function") {
      return Promise.resolve(root.put("employees", c.id, c)).then(function () {
        return res;
      });
    }
    S.employees[empId] = c;
    return Promise.resolve(res);
  }

  function guessDocKey(name) {
    if (typeof root.guessDoc === "function") return root.guessDoc(name);
    var t = str(name).replace(/[_\-.]+/g, " ");
    var guess = root.GUESS || [];
    var i;
    for (i = 0; i < guess.length; i += 1) {
      if (guess[i] && guess[i][0] && guess[i][0].test(t)) return guess[i][1];
    }
    return "";
  }

  function attachBanner(S) {
    S = store(S);
    var offline = !!(S && S.mcpChecked && !S.mcpReady);
    var h = '<div class="note hr-201-attach-note" id="hr-201-attach-note">';
    if (offline) {
      h += "<b>Drive upload and folder match are offline on this site.</b> ";
    }
    h += "Attach a 201 scan by pasting a Drive share link on the row, or use <b>Attach link</b>. ";
    h += "Open the file in Drive → Share → Copy link. ";
    h += "GovMan refusal, resignation, employee clearance and quitclaims each have their own row.";
    h += ' <button type="button" class="btn sm pri" id="hr-201-attach-any">Attach a Drive link</button></div>';
    return h;
  }

  function enhanceDocsHtml(html, S) {
    var h = str(html);
    if (!/hr-201-attach-note/.test(h)) {
      h = h.replace('<div class="stack">', '<div class="stack">' + attachBanner(S));
    }
    h = h.replace(
      /placeholder="paste a Drive link to add" style="width:124px"/g,
      'placeholder="Paste a Drive URL" style="width:min(100%,280px);min-width:180px"'
    );
    h = h.replace(
      /(<button class="btn sm" data-upload="([^"]+)"[^>]*>Upload<\/button>)/g,
      '$1<button type="button" class="btn sm" data-hr201-attach="$2" title="Paste a Drive share link — works when upload is offline">Attach link</button>'
    );
    return h;
  }

  function wrapEmpDocs() {
    if (typeof root.empDocs !== "function" || root.empDocs.__hr201) return;
    var orig = root.empDocs;
    root.empDocs = function (e, c) {
      registerChecklist();
      return enhanceDocsHtml(orig.call(this, e, c), store());
    };
    root.empDocs.__hr201 = true;
  }

  function driveOffline(S) {
    S = store(S);
    return !!(S && S.mcpChecked && !S.mcpReady);
  }

  function wrapPickFor() {
    if (typeof root.pickFor !== "function" || root.pickFor.__hr201) return;
    var orig = root.pickFor;
    root.pickFor = function (empId, docKey) {
      if (driveOffline()) {
        openAttachModal(empId, docKey);
        return;
      }
      return orig.apply(this, arguments);
    };
    root.pickFor.__hr201 = true;
  }

  function wrapMatchFiles() {
    if (typeof root.matchFilesToRows !== "function" || root.matchFilesToRows.__hr201) return;
    var orig = root.matchFilesToRows;
    root.matchFilesToRows = function () {
      if (driveOffline()) {
        if (typeof root.toast === "function") {
          root.toast("Drive match is offline. Paste a Drive share link instead.", "err");
        }
        var emp = currentEmp();
        openAttachModal(emp && emp.id, "");
        return;
      }
      return orig.apply(this, arguments);
    };
    root.matchFilesToRows.__hr201 = true;
  }

  function openAttachModal(empId, presetKey) {
    var S = store();
    var emp = (S.employees || {})[empId] || currentEmp(S);
    if (!emp) {
      if (typeof root.toast === "function") root.toast("Open a 201 file first.", "err");
      return false;
    }
    if (typeof root.openModal !== "function") return false;
    registerChecklist();
    var groups = {};
    (root.DOCS || []).forEach(function (d) {
      if (!d) return;
      groups[d.g] = groups[d.g] || [];
      groups[d.g].push(d);
    });
    var opts = Object.keys(groups).map(function (g) {
      return (
        '<optgroup label="' +
        esc(g) +
        '">' +
        groups[g]
          .map(function (d) {
            return (
              '<option value="' +
              esc(d.k) +
              '"' +
              (d.k === presetKey ? " selected" : "") +
              ">" +
              esc(decodeDocName(d.n)) +
              "</option>"
            );
          })
          .join("") +
        "</optgroup>"
      );
    }).join("");
    root.openModal({
      title: "Attach a Drive file — " + (emp.name || ""),
      body:
        '<div class="stack">' +
        '<div class="note">Paste a Google Drive share link. The file stays in Drive; this only records it on the 201. ' +
        "Works when Drive upload is offline.</div>" +
        '<div class="f"><label>Checklist row</label><select id="hr201-att-key">' +
        opts +
        "</select></div>" +
        '<div class="f"><label>Drive link or file id</label>' +
        '<input id="hr201-att-url" type="url" placeholder="https://drive.google.com/file/d/…"></div>' +
        '<div class="f"><label>File name (optional)</label>' +
        '<input id="hr201-att-title" placeholder="e.g. Quitclaim — Last Salary"></div></div>',
      foot:
        '<button class="btn" type="button" id="hr201-att-cancel">Cancel</button>' +
        '<button class="btn pri" type="button" id="hr201-att-save">Attach</button>',
    });
    var doc = root.document;
    var cancel = doc && doc.getElementById && doc.getElementById("hr201-att-cancel");
    var save = doc && doc.getElementById && doc.getElementById("hr201-att-save");
    if (cancel) {
      cancel.onclick = function () {
        if (typeof root.closeModal === "function") root.closeModal();
      };
    }
    if (save) {
      save.onclick = function () {
        var keyEl = doc.getElementById("hr201-att-key");
        var urlEl = doc.getElementById("hr201-att-url");
        var titleEl = doc.getElementById("hr201-att-title");
        attachLink(emp.id, keyEl && keyEl.value, urlEl && urlEl.value, titleEl && titleEl.value).then(function (res) {
          if (!res.ok) {
            if (typeof root.toast === "function") root.toast(res.error, "err");
            return;
          }
          if (typeof root.closeModal === "function") root.closeModal();
          if (typeof root.toast === "function") root.toast("Attached to the 201 checklist", "ok");
          if (typeof root.render === "function") root.render();
        });
      };
    }
    return true;
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
    registerChecklist();
    wrapPaperTrail();
    wrapEmpDocs();
    wrapPickFor();
    wrapMatchFiles();
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
  api.EXTRA_DOCS = EXTRA_DOCS;
  api.registerChecklist = registerChecklist;
  api.normalizeDriveUrl = normalizeDriveUrl;
  api.applyAttach = applyAttach;
  api.attachLink = attachLink;
  api.guessDocKey = guessDocKey;
  api.enhanceDocsHtml = enhanceDocsHtml;
  api.openAttachModal = openAttachModal;
  api.collectChecklist = collectChecklist;
  root.hr201File = api;

  if (typeof root.document !== "undefined") {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
