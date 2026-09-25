/**
 * 201 checklist categories and completion rules.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * Cassie / Maria 2026-09-18:
 *   - extra categories (COE CCD, COE from employee, requirement checklist,
 *     NBI Clearance)
 *   - N/A counts toward the 201 percentage
 *   - Separations are N/A (and counted) while the person is not Separated
 *   - a refusal attachment completes SSS / Pag-IBIG / PhilHealth / TIN
 *
 * Cassie 2026-09-25: "Refusal of Government-mandated Deductions" and
 * "KASABUTAN sa dili pagperma…" are the same paper. One checklist row
 * (govrefuse). A file, date, or status on either old key is kept on that
 * row. The 201 % counts it once. The refusal attachment still completes
 * SSS / Pag-IBIG / PhilHealth / TIN.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.hr201Checklist = api;
  if (typeof window !== "undefined" && window) window.hr201Checklist = api;
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

  var EXTRA_DOCS = [
    { k: "coeccd", n: "COE (CCD)", g: "Employment" },
    { k: "coeemp", n: "COE (from employee)", g: "Recruitment" },
    { k: "reqcheck", n: "Employee requirement checklist", g: "Recruitment" },
    { k: "nbi", n: "NBI Clearance", g: "Clearances", exp: 1 },
  ];

  var MERGED_KEY = "govrefuse";
  var LEGACY_KEY = "kasabutan";
  var MERGED_NAME = "Refusal of Government-mandated Deductions (Kasabutan)";
  var STATUTORY_KEYS = ["sss", "hdmf", "phic", "tin"];
  var REFUSAL_KEYS = ["govrefuse", "kasabutan"];
  var SEPARATION_GROUP = "Separation";
  var NA_RE = /^(n\/?a|n\.a\.?|not\s*applicable|na)$/i;

  function str(v) {
    return v == null ? "" : String(v);
  }

  function isNaStatus(s) {
    return NA_RE.test(str(s).trim());
  }

  function isOnStatus(s) {
    return str(s).trim().toLowerCase() === "on";
  }

  function isSeparated(e) {
    return /separated/i.test(str(e && e.status));
  }

  function hasAttachment(v) {
    if (!v || typeof v !== "object") return false;
    if (str(v.link).trim()) return true;
    if (str(v.url).trim()) return true;
    var links = v.links;
    if (!Array.isArray(links)) return false;
    var i;
    for (i = 0; i < links.length; i += 1) {
      var x = links[i];
      if (!x) continue;
      if (typeof x === "string" && x.trim()) return true;
      if (str(x.url || x.link).trim()) return true;
    }
    return false;
  }

  function docOf(e, key) {
    var d = (e && e.docs) || {};
    return d[key] || { s: "miss", link: "", links: [], filed: "", expiry: "" };
  }

  function ensureDocSlot(e, key) {
    if (!e || !key) return null;
    if (!e.docs || typeof e.docs !== "object") e.docs = {};
    if (!e.docs[key] || typeof e.docs[key] !== "object") {
      e.docs[key] = { s: "miss", link: "", links: [], filed: "", expiry: "" };
    }
    return e.docs[key];
  }

  function fileEntries(v) {
    var out = [];
    var seen = {};
    function push(url, title, on) {
      url = str(url).trim();
      if (!url || seen[url]) return;
      seen[url] = true;
      out.push({ url: url, title: str(title).trim(), on: str(on).trim() });
    }
    if (!v || typeof v !== "object") return out;
    push(v.link, v.title, v.filed);
    if (str(v.url).trim()) push(v.url, v.title, v.filed);
    var links = v.links;
    if (Array.isArray(links)) {
      var i;
      for (i = 0; i < links.length; i += 1) {
        var x = links[i];
        if (!x) continue;
        if (typeof x === "string") push(x, "", "");
        else push(x.url || x.link, x.title, x.on || x.filed);
      }
    }
    return out;
  }

  function statusRank(s) {
    var t = str(s).trim().toLowerCase();
    if (!t) return 0;
    if (t === "on") return 5;
    if (t === "exp") return 4;
    if (isNaStatus(t)) return 3;
    if (t === "miss") return 1;
    return 2;
  }

  function completenessScore(v) {
    if (!v || typeof v !== "object") return -1;
    return (
      fileEntries(v).length * 1000 +
      statusRank(v.s) * 10 +
      (str(v.filed).trim() ? 2 : 0) +
      (str(v.expiry).trim() ? 1 : 0)
    );
  }

  function mergeGovRefusal(e) {
    if (!e || typeof e !== "object" || !e.docs || typeof e.docs !== "object") return e;
    var legacy = e.docs[LEGACY_KEY];
    if (!legacy || typeof legacy !== "object") return e;
    var current = e.docs[MERGED_KEY];
    var hasCurrent = current && typeof current === "object";
    var primary = hasCurrent && completenessScore(current) >= completenessScore(legacy) ? current : legacy;
    var secondary = primary === current ? legacy : hasCurrent ? current : null;
    var files = [];
    var seen = {};
    function add(v) {
      fileEntries(v).forEach(function (f) {
        if (seen[f.url]) return;
        seen[f.url] = true;
        files.push(f);
      });
    }
    add(primary);
    add(secondary);
    var primaryRank = statusRank(primary && primary.s);
    var secondaryRank = statusRank(secondary && secondary.s);
    var status = primaryRank >= secondaryRank ? str(primary && primary.s).trim() : str(secondary && secondary.s).trim();
    if (!status) status = "miss";
    var filed = str(primary && primary.filed).trim() || str(secondary && secondary.filed).trim();
    var expiry = str(primary && primary.expiry).trim() || str(secondary && secondary.expiry).trim();
    var title = str(primary && primary.title).trim() || str(secondary && secondary.title).trim();
    if (!title && files.length) title = files[0].title || "";
    e.docs[MERGED_KEY] = {
      s: status,
      link: files.length ? files[0].url : "",
      links: files.map(function (f) {
        return { url: f.url, title: f.title || "", on: f.on || "" };
      }),
      filed: filed,
      expiry: expiry,
      title: title,
    };
    delete e.docs[LEGACY_KEY];
    return e;
  }

  function catalogHas(docs, key) {
    var i;
    for (i = 0; i < docs.length; i += 1) {
      if (docs[i] && docs[i].k === key) return true;
    }
    return false;
  }

  function ensureCatalog(docs) {
    docs = Array.isArray(docs) ? docs : [];
    var i;
    for (i = docs.length - 1; i >= 0; i -= 1) {
      if (docs[i] && docs[i].k === LEGACY_KEY) docs.splice(i, 1);
    }
    EXTRA_DOCS.forEach(function (row) {
      if (!catalogHas(docs, row.k)) docs.push(row);
    });
    var kept = -1;
    for (i = 0; i < docs.length; i += 1) {
      if (!docs[i] || docs[i].k !== MERGED_KEY) continue;
      if (kept >= 0) {
        docs.splice(i, 1);
        i -= 1;
        continue;
      }
      kept = i;
      docs[i] = { k: MERGED_KEY, n: MERGED_NAME, g: "Statutory" };
    }
    if (kept < 0) docs.push({ k: MERGED_KEY, n: MERGED_NAME, g: "Statutory" });
    return docs;
  }

  function isCountable(doc) {
    if (!doc) return false;
    if (doc.g === SEPARATION_GROUP) return true;
    return !doc.opt;
  }

  function isSatisfied(v) {
    var s = v && v.s;
    return isOnStatus(s) || isNaStatus(s);
  }

  function applyActiveSeparations(e, docs) {
    if (!e || isSeparated(e)) return e;
    docs = docs || [];
    docs.forEach(function (doc) {
      if (!doc || doc.g !== SEPARATION_GROUP) return;
      var slot = ensureDocSlot(e, doc.k);
      if (!slot) return;
      if (hasAttachment(slot) || isOnStatus(slot.s)) return;
      if (!isNaStatus(slot.s)) slot.s = "na";
    });
    return e;
  }

  function applyRefusalToStatutory(e, today) {
    if (!e) return e;
    mergeGovRefusal(e);
    var refused = REFUSAL_KEYS.some(function (k) {
      return hasAttachment(docOf(e, k));
    });
    if (!refused) return e;
    var slot = ensureDocSlot(e, MERGED_KEY);
    if (slot && !isOnStatus(slot.s) && slot.s !== "exp") slot.s = "on";
    if (slot && !slot.filed) slot.filed = today || slot.filed || "";
    var benefack = ensureDocSlot(e, "benefack");
    if (benefack && !isOnStatus(benefack.s) && benefack.s !== "exp") benefack.s = "on";
    if (benefack && !benefack.filed) benefack.filed = today || benefack.filed || "";
    STATUTORY_KEYS.forEach(function (k) {
      var slot = ensureDocSlot(e, k);
      if (!slot) return;
      if (isOnStatus(slot.s)) return;
      slot.s = "on";
      if (!slot.filed) slot.filed = today || "";
    });
    return e;
  }

  function applyEmployee(e, docs, today) {
    if (!e || typeof e !== "object") return e;
    mergeGovRefusal(e);
    applyActiveSeparations(e, docs);
    applyRefusalToStatutory(e, today);
    return e;
  }

  function cloneDocs(src) {
    var out = {};
    Object.keys(src || {}).forEach(function (k) {
      var v = src[k];
      out[k] = v && typeof v === "object" ? Object.assign({}, v, { links: (v.links || []).slice() }) : v;
    });
    return out;
  }

  function complianceOf(e, docs) {
    docs = Array.isArray(docs) ? docs : [];
    var copy = e ? Object.assign({}, e, { docs: cloneDocs(e.docs) }) : { docs: {} };
    applyEmployee(copy, docs);
    var d = copy.docs || {};
    var need = 0;
    var have = 0;
    var onFile = 0;
    var na = 0;
    var missing = [];
    var refusalCounted = false;
    docs.forEach(function (x) {
      if (!x) return;
      var key = x.k;
      var row = x;
      if (key === LEGACY_KEY || key === MERGED_KEY) {
        if (refusalCounted) return;
        var countable = isCountable(x);
        if (!countable) {
          var otherKey = key === LEGACY_KEY ? MERGED_KEY : LEGACY_KEY;
          var other = null;
          var j;
          for (j = 0; j < docs.length; j += 1) {
            if (docs[j] && docs[j].k === otherKey) other = docs[j];
          }
          if (!isCountable(other)) return;
        }
        refusalCounted = true;
        key = MERGED_KEY;
        row = { k: MERGED_KEY, n: MERGED_NAME, g: "Statutory" };
      } else if (!isCountable(x)) return;
      var v = d[key] || { s: "miss" };
      need += 1;
      if (isNaStatus(v.s)) {
        have += 1;
        na += 1;
        return;
      }
      if (isOnStatus(v.s)) {
        have += 1;
        onFile += 1;
        return;
      }
      missing.push(row);
    });
    return {
      need: need,
      have: have,
      onFile: onFile,
      na: na,
      missing: missing,
      pct: need ? Math.round((have / need) * 100) : 100,
    };
  }

  var GUESS_EXTRAS = [
    [/certificate\s*of\s*employment|\bcoe\b/i, "coeccd"],
    [/requirement\s*checklist|\br39\b|employee\s*requirement/i, "reqcheck"],
    [/coe\s*\(?\s*ccd|certificate\s*of\s*employment.*ccd|ccd.*coe/i, "coeccd"],
    [/coe\s*\(?\s*from\s*employee|previous\s*employer.*coe|coe.*previous/i, "coeemp"],
    [/\bnbi\b|nbi\s*clearance/i, "nbi"],
    [/kasabutan|dili\s*pagperma|refusal.*(?:gov|benefit|deduct)|gov(?:ernment)?[\s-]*man(?:dated)?/i, "govrefuse"],
  ];

  function ensureGuess(guess) {
    guess = Array.isArray(guess) ? guess : [];
    var i;
    for (i = 0; i < guess.length; i += 1) {
      if (guess[i] && guess[i][1] === LEGACY_KEY) guess[i][1] = MERGED_KEY;
    }
    GUESS_EXTRAS.forEach(function (pair) {
      var already = guess.some(function (row) {
        return row && row[1] === pair[1] && String(row[0]) === String(pair[0]);
      });
      if (!already) guess.unshift(pair);
    });
    for (i = 0; i < guess.length; i += 1) {
      var row = guess[i];
      if (!row || row[1] !== "brgy") continue;
      if (/\bnbi\b/i.test(String(row[0]))) {
        guess[i] = [/barangay|police\s*clearance/i, "brgy"];
      }
    }
    return guess;
  }

  function bindArtifact(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host || typeof document === "undefined" || !document.createElement) return host;
    try {
      var s = document.createElement("script");
      s.textContent =
        "try{window.__hrDOCS=DOCS;window.__hrGUESS=GUESS;window.DOCS=DOCS;" +
        "if(typeof compliance==='function')window.compliance=compliance;" +
        "if(typeof put==='function')window.put=put;" +
        "if(typeof printChecklist==='function')window.printChecklist=printChecklist;" +
        "if(typeof render==='function')window.render=render;}catch(e){}";
      (document.documentElement || document.head || document.body).appendChild(s);
      if (s.parentNode) s.parentNode.removeChild(s);
    } catch (err) {}
    if (host.__hrDOCS) host.DOCS = host.__hrDOCS;
    if (host.__hrGUESS) host.GUESS = host.__hrGUESS;
    return host;
  }

  function wrapCompliance(host) {
    if (!host) return false;
    var docs = host.DOCS || host.__hrDOCS;
    function next(e) {
      return complianceOf(e, ensureCatalog(docs || host.DOCS));
    }
    host.compliance = next;
    try {
      var s = document.createElement("script");
      s.textContent = "try{compliance=window.compliance;}catch(e){}";
      (document.documentElement || document.head || document.body).appendChild(s);
      if (s.parentNode) s.parentNode.removeChild(s);
    } catch (err) {}
    return true;
  }

  function wrapPut(host) {
    var orig = host.put;
    if (typeof orig !== "function" || orig._hr201Checklist) return orig;
    host.put = function (coll, id, obj) {
      if (coll === "employees" && obj) {
        applyEmployee(obj, host.DOCS || host.__hrDOCS, host.TODAY);
      }
      return orig.apply(this, arguments);
    };
    host.put._hr201Checklist = true;
    return host.put;
  }

  function wrapPrintChecklist(host) {
    var orig = host.printChecklist;
    if (typeof orig !== "function" || orig._hr201Checklist) return orig;
    host.printChecklist = function (e, no, opt) {
      if (e) applyEmployee(e, host.DOCS || host.__hrDOCS, host.TODAY);
      return orig.apply(this, arguments);
    };
    host.printChecklist._hr201Checklist = true;
    return host.printChecklist;
  }

  function wrapRender(host) {
    var orig = host.render;
    if (typeof orig !== "function" || orig._hr201Checklist) return orig;
    host.render = function () {
      try {
        patchGlobals(host);
        migrateRoster(host);
        var S = host.S || host.__hrS;
        var empId = S && S.ui && (S.ui.emp || S.ui.openEmp);
        var emp = empId && S.employees && S.employees[empId];
        if (emp) applyEmployee(emp, host.DOCS || host.__hrDOCS, host.TODAY);
      } catch (err) {}
      return orig.apply(this, arguments);
    };
    host.render._hr201Checklist = true;
    return host.render;
  }

  function migrateRoster(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return;
    var S = host.S || host.__hrS;
    var employees = S && S.employees;
    if (!employees || typeof employees !== "object") return;
    Object.keys(employees).forEach(function (id) {
      mergeGovRefusal(employees[id]);
    });
  }

  function patchGlobals(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return {};
    bindArtifact(host);
    if (host.DOCS || host.__hrDOCS) ensureCatalog(host.DOCS || host.__hrDOCS);
    if (host.GUESS || host.__hrGUESS) ensureGuess(host.GUESS || host.__hrGUESS);
    wrapCompliance(host);
    return {
      put: wrapPut(host),
      printChecklist: wrapPrintChecklist(host),
      render: wrapRender(host),
    };
  }

  function attach(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return api;
    if (api.attached && host.hr201Checklist === api && host.put && host.put._hr201Checklist) {
      patchGlobals(host);
      return api;
    }
    patchGlobals(host);
    if (typeof document !== "undefined" && document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        patchGlobals(host);
      });
    }
    api.attached = true;
    return api;
  }

  var api = {
    attached: false,
    attach: attach,
    install: attach,
    patchGlobals: patchGlobals,
    EXTRA_DOCS: EXTRA_DOCS,
    STATUTORY_KEYS: STATUTORY_KEYS,
    REFUSAL_KEYS: REFUSAL_KEYS,
    MERGED_KEY: MERGED_KEY,
    MERGED_NAME: MERGED_NAME,
    mergeGovRefusal: mergeGovRefusal,
    ensureCatalog: ensureCatalog,
    ensureGuess: ensureGuess,
    hasAttachment: hasAttachment,
    isNaStatus: isNaStatus,
    isSeparated: isSeparated,
    isCountable: isCountable,
    applyActiveSeparations: applyActiveSeparations,
    applyRefusalToStatutory: applyRefusalToStatutory,
    applyEmployee: applyEmployee,
    complianceOf: complianceOf,
  };

  return api;
});
