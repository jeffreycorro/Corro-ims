/**
 * Concern-sheet fixes that sit on the existing HR artifact stack.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * 1. Cash Advance requester identity — lock empId / name on first save so an
 *    approval view cannot rewrite Domingo Monte into Catherine Largo
 *    (logged-in / payrollBy / hrHead / empty picker).
 * 2. Leave + CA project pickers — same live names attendance/manpower uses
 *    (master list + employee.project + daily sites + advances), newest first.
 * 3. Project-based employment contract — company paper template
 *    (PROJECT-BASED WITH A DEFINITE PERIOD OF EMPLOYMENT), Generate checkbox,
 *    ISO 9001:2015 mark + controlled footer on paperDoc letterhead.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.hrFormsFix = api;
  if (typeof window !== "undefined" && window) window.hrFormsFix = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        api.attach(typeof window !== "undefined" ? window : root);
      });
    } else {
      api.attach(typeof window !== "undefined" ? window : root);
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var TPL_ID = "t_proj_ccd";
  var REQUIRED_PHRASE = "PROJECT-BASED WITH A DEFINITE PERIOD OF EMPLOYMENT";

  function str(v) {
    return v == null ? "" : String(v);
  }

  function foldName(s) {
    return str(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function samePersonName(a, b) {
    var fa = foldName(a);
    var fb = foldName(b);
    if (!fa || !fb) return false;
    return fa === fb || fa.indexOf(fb) >= 0 || fb.indexOf(fa) >= 0;
  }

  function values(map) {
    if (!map || typeof map !== "object") return [];
    if (Array.isArray(map)) return map.filter(Boolean);
    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .filter(Boolean);
  }

  function bindStore(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return {};
    if (host.__hrS && (host.__hrS.employees || host.__hrS.advances || host.__hrS.projects)) {
      host.S = host.__hrS;
      return host.__hrS;
    }
    if (host.S && (host.S.employees || host.S.advances || host.S.projects || host.S.templates)) {
      return host.S;
    }
    try {
      if (typeof document !== "undefined" && document.createElement) {
        var s = document.createElement("script");
        s.textContent = "window.__hrS=S;window.S=S;";
        (document.documentElement || document.head || document.body).appendChild(s);
        if (s.parentNode) s.parentNode.removeChild(s);
      }
    } catch (e) {}
    if (host.__hrS) {
      host.S = host.__hrS;
      return host.__hrS;
    }
    return host.S || {};
  }

  function storeOf(host) {
    if (host && host.S && typeof host.S === "object" && (host.S.employees || host.S.advances || host.S.projects)) {
      return host.S;
    }
    return bindStore(host);
  }

  function empName(S, empId) {
    var e = S && S.employees && empId ? S.employees[empId] : null;
    return (e && e.name) || "";
  }

  function settingsNames(S) {
    var st = (S && S.settings) || {};
    return [st.hrHead, st.payrollBy, st.hrStaff, st.financeHead, st.signatory].filter(Boolean);
  }

  function looksLikeSessionIdentity(S, name, empId) {
    var n = name || empName(S, empId);
    if (!n) return false;
    return settingsNames(S).some(function (who) {
      return samePersonName(n, who);
    });
  }

  function snapshotAdvanceIdentity(rec, S) {
    var e = S && S.employees && rec.empId ? S.employees[rec.empId] : null;
    var name = (e && e.name) || rec.receivedBy || rec.employeeName || "";
    return {
      filedEmpId: rec.empId || rec.filedEmpId || "",
      employeeName: name,
      receivedBy: rec.receivedBy || name,
    };
  }

  /**
   * First save snapshots the requester. Later saves restore that identity when
   * empId is emptied or swapped for HR/payroll/session names while the filed
   * "received by" text is still the original person.
   */
  function lockAdvanceIdentity(obj, S, prev) {
    if (!obj || typeof obj !== "object") return obj;
    var prior = prev || {};
    var filedId = obj.filedEmpId || prior.filedEmpId || "";
    var filedName = obj.employeeName || prior.employeeName || "";
    if (!filedId && !filedName) {
      var snap = snapshotAdvanceIdentity(obj, S);
      obj.filedEmpId = snap.filedEmpId;
      obj.employeeName = snap.employeeName;
      if (!obj.receivedBy) obj.receivedBy = snap.receivedBy;
      return obj;
    }
    var currentName = empName(S, obj.empId) || obj.receivedBy || "";
    var emptied = filedId && !obj.empId;
    var swapped = filedId && obj.empId && str(obj.empId) !== str(filedId);
    var sessionSwap = swapped && looksLikeSessionIdentity(S, currentName, obj.empId) && !looksLikeSessionIdentity(S, filedName, filedId);
    var receivedStillFiled =
      swapped &&
      filedName &&
      obj.receivedBy &&
      samePersonName(obj.receivedBy, filedName) &&
      !samePersonName(currentName, filedName);
    if (emptied || sessionSwap || receivedStillFiled) {
      obj.empId = filedId;
      if (filedName) {
        obj.employeeName = filedName;
        if (!obj.receivedBy || samePersonName(obj.receivedBy, currentName)) {
          obj.receivedBy = filedName;
        }
      }
    }
    obj.filedEmpId = filedId || obj.empId || obj.filedEmpId || "";
    obj.employeeName = filedName || obj.employeeName || empName(S, obj.empId) || obj.receivedBy || "";
    return obj;
  }

  function advanceDisplayName(S, a) {
    if (!a) return "";
    var id = a.filedEmpId || a.empId;
    return empName(S, id) || a.employeeName || a.receivedBy || "";
  }

  function addProject(out, seen, name, recency) {
    name = str(name).trim();
    if (!name || /^admins?$/i.test(name)) return;
    var k = name.toLowerCase();
    recency = str(recency);
    if (!seen.has(k)) {
      out.push({ name: name, recency: recency });
      seen.add(k);
      return;
    }
    var i;
    for (i = 0; i < out.length; i += 1) {
      if (out[i].name.toLowerCase() === k && recency && recency > (out[i].recency || "")) {
        out[i].recency = recency;
      }
    }
  }

  function liveProjectNames(S, extras) {
    var out = [];
    var seen = new Set();
    values(S && S.projects).forEach(function (p) {
      if (!p) return;
      addProject(out, seen, p.name, p.updatedOn || p.addedOn || p.createdOn || p.date || "");
    });
    values(S && S.employees).forEach(function (e) {
      addProject(out, seen, e && e.project, e && (e.updatedOn || e.contractStart || e.dateHired || ""));
    });
    values(S && S.daily).forEach(function (r) {
      values(r && r.rows).forEach(function (row) {
        addProject(out, seen, row && row.site, r && r.date);
      });
    });
    values(S && S.advances).forEach(function (a) {
      addProject(out, seen, a && a.project, a && (a.date || a.releasedOn || ""));
    });
    values(S && S.leaves).forEach(function (l) {
      addProject(out, seen, l && l.project, l && (l.filedOn || l.from || ""));
    });
    (extras || []).forEach(function (n) {
      addProject(out, seen, n, "");
    });
    out.sort(function (a, b) {
      if ((b.recency || "") !== (a.recency || "")) return str(b.recency).localeCompare(str(a.recency));
      return a.name.localeCompare(b.name);
    });
    return out.map(function (x) {
      return x.name;
    });
  }

  function esc(s) {
    return str(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function projOptsHtml(sel, names) {
    var list = names || [];
    var html =
      '<option value="">— none —</option>' +
      list
        .map(function (n) {
          return "<option" + (sel === n ? " selected" : "") + ">" + esc(n) + "</option>";
        })
        .join("");
    if (sel && !list.some(function (n) {
      return n === sel;
    })) {
      html += "<option selected>" + esc(sel) + "</option>";
    }
    return html;
  }

  function projectBasedBody(renewalBody) {
    var body = str(renewalBody);
    if (body) {
      body = body
        .replace(/## \(RENEWAL\)\s*/g, "")
        .replace(/PROJECT-BASED EMPLOYMENT CONTRACT — RENEWAL/g, REQUIRED_PHRASE)
        .replace(/This Renewal Employment Contract/g, "This Project-Based Employment Contract")
        .replace(
          /WHEREAS, this Contract constitutes a RENEWAL[\s\S]*?under Contract No\. \{\{DOC_NO\}\};\s*/g,
          ""
        );
      if (body.indexOf(REQUIRED_PHRASE) < 0) {
        body = "### " + REQUIRED_PHRASE + " CONTRACT\n\n" + body;
      }
      return body;
    }
    return (
      "### " +
      REQUIRED_PHRASE +
      " CONTRACT\n\n" +
      "## KNOW ALL MEN BY THESE PRESENTS:\n\n" +
      "This Project-Based Employment Contract (Contract No. {{DOC_NO}}) made and entered into this {{DAY_ORD}} day of {{MONTH_NAME}}, {{YEAR}} in Cebu City, by and between the following:\n\n" +
      "CORRO CONSTRUCTION DEVELOPMENT & TRADE CORP., a corporation duly organized and existing under and by virtue of Philippine laws and with office and postal address at 15 First Street La Guardia, Lahug, Cebu City, Cebu, Philippines, herein represented by its President, {{PRESIDENT}}, hereinafter referred to as the COMPANY;\n\n" +
      "and\n\n" +
      "{{FULL_NAME}}, Employee No. {{EMP_NO}}, Filipino, of legal age, with permanent address at {{HOME_ADDRESS}}, hereinafter referred to as the PROJECT EMPLOYEE.\n\n" +
      "## WITNESSETH, that:\n\n" +
      "WHEREAS, the COMPANY is in need of a {{POSITION}} for the construction of {{PROJECT}}, hereinafter referred to as the PROJECT;\n\n" +
      "WHEREAS, the PROJECT EMPLOYEE has signified their willingness and warranted their qualification for the job;\n\n" +
      "WHEREAS, the COMPANY warrants that this Employment Contract is compliant with the minimum requirements of the Labor Code and stands in deference to, and is superseded by, the laws as stated in the Labor Code of the Philippines, as renumbered;\n\n" +
      "NOW THEREFORE, for and in consideration of the foregoing, the COMPANY and the PROJECT EMPLOYEE agree to the terms set forth below:\n\n" +
      "# COMMENCEMENT OF PROJECT EMPLOYMENT\n\n" +
      "The PROJECT EMPLOYEE is engaged for a particular project:\n\n" +
      "@TABLE Name of Project|Location|Description|Project Duration ;; {{PROJECT}}|{{PROJECT_LOCATION}}|{{POSITION}} for the construction of {{PROJECT}}|{{CONTRACT_START}} – {{CONTRACT_END}}\n\n" +
      "This contract shall commence on {{CONTRACT_START}} and shall remain effective for the duration of the PROJECT, or phase thereof, or until {{CONTRACT_END}}.\n\n" +
      "The PROJECT EMPLOYEE is not a regular employee and shall not be entitled to benefits given only to regular employees.\n\n" +
      "The PROJECT EMPLOYEE shall be entitled to a daily basic wage in the amount of {{RATE_WORDS}} ({{DAILY_RATE}}) per day, with an additional allowance of {{ALLOWANCE_WORDS}} ({{ALLOWANCE}}), to be released and paid every Saturday of the week.\n\n" +
      "# CAUSES FOR END OF EMPLOYMENT / TERMINATION OF THIS PROJECT-BASED CONTRACT WITH A DEFINITE PERIOD\n\n" +
      "a) Voluntary resignation (30 days written notice).\n" +
      "b) Expiration of contract as indicated in this document.\n" +
      "c) Completion of the PROJECT or phase thereof.\n\n" +
      "IN WITNESS WHEREOF, the parties herein affixed their signatures on the date and place above written.\n\n" +
      "@SIGN {{PRESIDENT}}|For CORRO CONST. DEVELOPMENT & TRADE CORP. ;; {{FULL_NAME}}|Project Employee"
    );
  }

  function projectBasedTemplate(S) {
    var renewal = S && S.templates && S.templates.t_projrenew_ccd;
    return {
      id: TPL_ID,
      kind: "contract",
      paper: 1,
      formKey: "contract",
      name: "Project-Based Contract — Definite Period (company form)",
      formTitle: REQUIRED_PHRASE,
      body: projectBasedBody(renewal && renewal.body),
    };
  }

  function templateNeedsUpsert(cur) {
    if (!cur) return true;
    var hay = str(cur.formTitle) + "\n" + str(cur.body) + "\n" + str(cur.name);
    return hay.indexOf(REQUIRED_PHRASE) < 0;
  }

  function ensureProjectBasedTemplate(host) {
    var S = storeOf(host);
    if (!S || typeof S !== "object") return null;
    S.templates = S.templates || {};
    var tpl = projectBasedTemplate(S);
    if (!templateNeedsUpsert(S.templates[TPL_ID])) return S.templates[TPL_ID];
    S.templates[TPL_ID] = tpl;
    if (typeof host.put === "function") {
      try {
        host.put("templates", TPL_ID, tpl);
      } catch (e) {}
    }
    return tpl;
  }

  function isoMarkHtml() {
    return (
      '<div class="pf-iso-mark" title="ISO 9001:2015">' +
      '<span class="pf-iso-badge">ISO</span>' +
      '<span class="pf-iso-txt">9001:2015<br>Certified</span></div>'
    );
  }

  function ensureIsoStyles(doc) {
    if (!doc || !doc.createElement || (doc.getElementById && doc.getElementById("hr-forms-fix-styles"))) {
      return;
    }
    var style = doc.createElement("style");
    style.id = "hr-forms-fix-styles";
    style.textContent =
      ".pf-head{position:relative}" +
      ".pf-iso-mark{display:flex;align-items:center;gap:6px;margin-left:10px;flex:0 0 auto;" +
      "border:1.4px solid #000;padding:3px 6px 3px 4px;background:#fff}" +
      ".pf-iso-badge{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;" +
      "border:2px solid #000;border-radius:50%;font:700 9px/1 Times,serif;letter-spacing:.04em}" +
      ".pf-iso-txt{font:700 8px/1.2 Times,serif;letter-spacing:.04em;text-transform:uppercase;text-align:left}" +
      ".hr-proj-based{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px}";
    (doc.head || doc.documentElement).appendChild(style);
  }

  function decoratePaperHtml(html, host, tpl) {
    html = str(html);
    if (!html) return html;
    if (html.indexOf("pf-iso-mark") < 0 && html.indexOf("pf-head") >= 0) {
      html = html.replace(
        /(<div class="pf-head">)([\s\S]*?)(<div class="addr">)/,
        function (_m, a, mid, addr) {
          return a + mid + isoMarkHtml() + addr;
        }
      );
    }
    if (html.indexOf("pf-iso") < 0 && host && typeof host.pfISO === "function") {
      var key = (tpl && (tpl.formKey || (tpl.kind === "contract" ? "contract" : ""))) || "contract";
      try {
        html += host.pfISO(key, {});
      } catch (e) {}
    }
    return html;
  }

  function wrapPaperDoc(host) {
    var orig = host.paperDoc;
    if (typeof orig !== "function" || orig._hrFormsFix) return false;
    host.paperDoc = function (tpl, body, ctx, no, draft) {
      var html = orig.apply(this, arguments);
      return decoratePaperHtml(html, host, tpl);
    };
    host.paperDoc._hrFormsFix = true;
    return true;
  }

  function wrapPfHead(host) {
    var orig = host.pfHead;
    if (typeof orig !== "function" || orig._hrFormsFix) return false;
    host.pfHead = function () {
      var html = orig.apply(this, arguments);
      if (str(html).indexOf("pf-iso-mark") >= 0) return html;
      return str(html).replace(
        /(<div class="pf-head">)([\s\S]*?)(<div class="addr">)/,
        function (_m, a, mid, addr) {
          return a + mid + isoMarkHtml() + addr;
        }
      );
    };
    host.pfHead._hrFormsFix = true;
    return true;
  }

  function wrapPrintCA(host) {
    var orig = host.printCA;
    if (typeof orig !== "function" || orig._hrFormsFix) return false;
    host.printCA = function (a, opt) {
      var S = storeOf(host);
      var copy = Object.assign({}, a || {});
      if (copy.filedEmpId) copy.empId = copy.filedEmpId;
      var name = advanceDisplayName(S, copy);
      if (name && !copy.receivedBy) copy.receivedBy = name;
      return orig.call(this, copy, opt);
    };
    host.printCA._hrFormsFix = true;
    return true;
  }

  function wrapProjOpts(host) {
    var orig = host.projOpts;
    if (typeof orig !== "function" || orig._hrFormsFix) return false;
    host.projOpts = function (sel) {
      var extras = [];
      try {
        extras = orig.apply(this, arguments)
          ? []
          : [];
      } catch (e) {
        extras = [];
      }
      if (typeof orig === "function") {
        try {
          var raw = orig.call(this, sel);
          var matches = String(raw || "").match(/>([^<]+)</g) || [];
          matches.forEach(function (m) {
            var n = m.slice(1, -1).replace(/&amp;/g, "&");
            if (n && n !== "— none —") extras.push(n);
          });
        } catch (e2) {}
      }
      return projOptsHtml(sel, liveProjectNames(storeOf(host), extras));
    };
    host.projOpts._hrFormsFix = true;
    return true;
  }

  function wrapProjectNames(host) {
    var orig = host.projectNames;
    if (typeof orig !== "function" || orig._hrFormsFix) return false;
    host.projectNames = function () {
      var extras = [];
      try {
        extras = orig.apply(this, arguments) || [];
      } catch (e) {
        extras = [];
      }
      return liveProjectNames(storeOf(host), extras);
    };
    host.projectNames._hrFormsFix = true;
    return true;
  }

  function wrapDailySites(host) {
    var orig = host.dailySites;
    if (typeof orig !== "function" || orig._hrFormsFix) return false;
    host.dailySites = function () {
      var fromOrig = [];
      try {
        fromOrig = orig.apply(this, arguments) || [];
      } catch (e) {
        fromOrig = [];
      }
      var live = liveProjectNames(storeOf(host), fromOrig);
      if (fromOrig.indexOf("ADMINS") >= 0 && live.indexOf("ADMINS") < 0) live.push("ADMINS");
      return live;
    };
    host.dailySites._hrFormsFix = true;
    return true;
  }

  function wrapPut(host) {
    var orig = host.put;
    if (typeof orig !== "function" || orig._hrFormsFix) return false;
    host.put = function (coll, id, obj) {
      var S = storeOf(host);
      if (coll === "advances" && obj) {
        var prev = S && S.advances ? S.advances[id] : undefined;
        obj = lockAdvanceIdentity(obj, S, prev);
      }
      return orig.apply(this, arguments);
    };
    host.put._hrFormsFix = true;
    return true;
  }

  function injectProjectBasedOption(host) {
    var doc = host.document;
    if (!doc || !doc.getElementById) return null;
    var sel = doc.getElementById("gen-tpl");
    if (!sel) return null;
    ensureProjectBasedTemplate(host);
    var S = storeOf(host);
    if (S && S.templates && S.templates[TPL_ID] && !sel.querySelector('option[value="' + TPL_ID + '"]')) {
      var opt = doc.createElement("option");
      opt.value = TPL_ID;
      opt.textContent = S.templates[TPL_ID].name;
      sel.appendChild(opt);
    }
    if (doc.getElementById("hr-proj-based")) return doc.getElementById("hr-proj-based");
    var wrap = doc.createElement("label");
    wrap.className = "hr-proj-based";
    wrap.id = "hr-proj-based-wrap";
    wrap.innerHTML =
      '<input type="checkbox" id="hr-proj-based"> Project-based with a definite period of employment';
    (sel.parentNode || sel).appendChild(wrap);
    var box = doc.getElementById("hr-proj-based");
    var empId = (doc.getElementById("gen-emp") || {}).value;
    var emp = S && S.employees && empId ? S.employees[empId] : null;
    if (emp && /project/i.test(emp.status || "")) {
      box.checked = true;
      sel.value = TPL_ID;
    }
    box.onchange = function () {
      if (box.checked) sel.value = TPL_ID;
    };
    return box;
  }

  function refreshProjectSelects(host) {
    var doc = host.document;
    if (!doc || !doc.querySelectorAll) return;
    var S = storeOf(host);
    var names = liveProjectNames(S);
    ["c-proj", "l-proj"].forEach(function (id) {
      var el = doc.getElementById(id);
      if (!el || el.tagName !== "SELECT") return;
      var cur = el.value;
      el.innerHTML = projOptsHtml(cur, names);
    });
  }

  function injectChrome(host) {
    var doc = host.document;
    if (doc) ensureIsoStyles(doc);
    try {
      ensureProjectBasedTemplate(host);
    } catch (e) {}
    try {
      injectProjectBasedOption(host);
    } catch (e2) {}
    try {
      refreshProjectSelects(host);
    } catch (e3) {}
  }

  function wrapOpenModal(host) {
    var orig = host.openModal;
    if (typeof orig !== "function" || orig._hrFormsFix) return false;
    host.openModal = function (opts) {
      var out = orig.apply(this, arguments);
      try {
        refreshProjectSelects(host);
        var title = str(opts && opts.title);
        if (/^cash advance/i.test(title)) {
          var S = storeOf(host);
          var no = title.replace(/^cash advance\s+/i, "").trim();
          var rec = values(S && S.advances).find(function (a) {
            return a && a.no === no;
          });
          if (rec && rec.filedEmpId) {
            var hid = host.document && host.document.getElementById("c-emp");
            if (hid && !hid.value) hid.value = rec.filedEmpId;
          }
        }
      } catch (e) {}
      return out;
    };
    host.openModal._hrFormsFix = true;
    return true;
  }

  function wrapRender(host) {
    if (typeof host.render !== "function" || host.render._hrFormsFix) return false;
    var orig = host.render;
    host.render = function () {
      var r = orig.apply(this, arguments);
      try {
        patchGlobals(host);
        injectChrome(host);
      } catch (e) {}
      return r;
    };
    host.render._hrFormsFix = true;
    return true;
  }

  function patchGlobals(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return {};
    bindStore(host);
    return {
      put: wrapPut(host),
      projOpts: wrapProjOpts(host),
      projectNames: wrapProjectNames(host),
      dailySites: wrapDailySites(host),
      paperDoc: wrapPaperDoc(host),
      pfHead: wrapPfHead(host),
      printCA: wrapPrintCA(host),
      openModal: wrapOpenModal(host),
      render: wrapRender(host),
    };
  }

  function attach(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return api;
    if (api.attached && host.hrFormsFix === api && host.put && host.put._hrFormsFix) {
      injectChrome(host);
      return api;
    }
    patchGlobals(host);
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
          patchGlobals(host);
          injectChrome(host);
        });
      } else {
        injectChrome(host);
      }
    }
    api.attached = true;
    return api;
  }

  var api = {
    attached: false,
    attach: attach,
    install: attach,
    patchGlobals: patchGlobals,
    injectChrome: injectChrome,
    storeOf: storeOf,
    bindStore: bindStore,
    lockAdvanceIdentity: lockAdvanceIdentity,
    advanceDisplayName: advanceDisplayName,
    liveProjectNames: liveProjectNames,
    projOptsHtml: projOptsHtml,
    projectBasedTemplate: projectBasedTemplate,
    projectBasedBody: projectBasedBody,
    ensureProjectBasedTemplate: ensureProjectBasedTemplate,
    decoratePaperHtml: decoratePaperHtml,
    isoMarkHtml: isoMarkHtml,
    looksLikeSessionIdentity: looksLikeSessionIdentity,
    TPL_ID: TPL_ID,
    REQUIRED_PHRASE: REQUIRED_PHRASE,
  };

  return api;
});
