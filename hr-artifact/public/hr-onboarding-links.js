/**
 * Company onboarding video Drive file remap.
 * Loaded by claude-shim.js.
 *
 * The artifact PROGRAMMES row is also updated, but a pasted Claude export
 * can bring an older Drive file back. This companion remaps those file ids
 * (retired MP4 and the interim Transitions_1 file) to Corcondev Onboarding
 * final 2026.mp4 on programme records, resource-library rows, and rendered
 * links. Other role orientation videos are left alone unless they literally
 * share one of those ids.
 *
 * Dynamically injected companions can run before function render / programme
 * exist. Poll until they do, then wrap render. Click capture rewrites leftover
 * old hrefs even if wrap lost the race.
 */
(function (root) {
  "use strict";

  if (root.hrOnboardingLinks && root.hrOnboardingLinks.install) {
    try {
      root.hrOnboardingLinks.install();
    } catch (e) {}
    return;
  }

  var OLD_ID = "11wX350zj31ybmtagU9P8TTA71gIX2i3Y";
  var INTERIM_ID = "1SaURmAToj3CiSpVYagFHXCtdq3A-z2_d";
  var NEW_ID = "1KjKPYMuDarowOeZauaVeronpXaMPTZV6";
  var LEGACY_IDS = [OLD_ID, INTERIM_ID];
  var NEW_URL = "https://drive.google.com/file/d/" + NEW_ID + "/view";
  var OLD_NAME = "CORCONDEV Onboarding";
  var NEW_NAME = "CORCONDEV Onboarding (2026)";
  var LINK_KEYS = ["url", "link", "href", "src"];
  var NAME_KEYS = ["n", "title", "name"];
  var MAX_POLLS = 80;
  var POLL_MS = 250;

  var polling = false;
  var observer = null;
  var pollTries = 0;

  function hasLegacy(s) {
    s = String(s == null ? "" : s);
    var i;
    for (i = 0; i < LEGACY_IDS.length; i += 1) {
      if (s.indexOf(LEGACY_IDS[i]) !== -1) return true;
    }
    return false;
  }

  function rewriteUrl(url) {
    var s = String(url == null ? "" : url);
    var i;
    for (i = 0; i < LEGACY_IDS.length; i += 1) {
      if (s.indexOf(LEGACY_IDS[i]) !== -1) s = s.split(LEGACY_IDS[i]).join(NEW_ID);
    }
    return s;
  }

  function looksLikeOldName(name) {
    var n = String(name || "").trim();
    if (!n || n.indexOf("(with audio)") !== -1) return false;
    if (n.indexOf("(2026)") !== -1) return false;
    return n === OLD_NAME;
  }

  function patchName(obj) {
    if (!obj || typeof obj !== "object") return;
    var i;
    for (i = 0; i < NAME_KEYS.length; i += 1) {
      var k = NAME_KEYS[i];
      if (looksLikeOldName(obj[k])) obj[k] = NEW_NAME;
    }
  }

  function patchRecord(obj) {
    if (!obj || typeof obj !== "object") return false;
    var changed = false;
    var i;
    for (i = 0; i < LINK_KEYS.length; i += 1) {
      var k = LINK_KEYS[i];
      if (typeof obj[k] !== "string" || !hasLegacy(obj[k])) continue;
      obj[k] = rewriteUrl(obj[k]);
      changed = true;
    }
    if (changed) patchName(obj);
    return changed;
  }

  function patchMaterial(m) {
    return patchRecord(m);
  }

  function patchProgramme(pg) {
    if (!pg || !pg.materials || !pg.materials.length) return 0;
    var n = 0;
    var i;
    for (i = 0; i < pg.materials.length; i += 1) {
      if (patchMaterial(pg.materials[i])) n += 1;
    }
    return n;
  }

  function asList(value) {
    if (!value) return [];
    if (value.length && typeof value !== "string") {
      try {
        return Array.prototype.slice.call(value);
      } catch (e) {
        return [];
      }
    }
    if (typeof value === "object") return Object.keys(value).map(function (k) { return value[k]; });
    return [];
  }

  function patchKnownProgrammes() {
    var n = 0;
    if (typeof root.programme === "function") {
      try {
        n += patchProgramme(root.programme("pg_onb"));
      } catch (e) {}
    }
    if (typeof root.everyoneProgrammes === "function") {
      try {
        var everyone = root.everyoneProgrammes() || [];
        var e;
        for (e = 0; e < everyone.length; e += 1) n += patchProgramme(everyone[e]);
      } catch (e2) {}
    }
    var list = root.PROGRAMMES;
    if (list && list.length) {
      var i;
      for (i = 0; i < list.length; i += 1) n += patchProgramme(list[i]);
    }
    return n;
  }

  function patchResources() {
    var n = 0;
    var lists = [];
    if (typeof root.resList === "function") {
      try {
        lists.push(root.resList() || []);
      } catch (e) {}
    }
    if (root.S && root.S.resources) lists.push(asList(root.S.resources));
    var i;
    var j;
    for (i = 0; i < lists.length; i += 1) {
      var rows = asList(lists[i]);
      for (j = 0; j < rows.length; j += 1) {
        if (patchRecord(rows[j])) n += 1;
      }
    }
    return n;
  }

  function rewriteName(el) {
    if (!el) return;
    var href = el.getAttribute ? String(el.getAttribute("href") || "") : "";
    if (!hasLegacy(href) && href.indexOf(NEW_ID) === -1) return;
    var nodes = el.childNodes;
    var i;
    if (nodes && nodes.length) {
      for (i = 0; i < nodes.length; i += 1) {
        var c = nodes[i];
        if (!c || c.nodeType !== 3) continue;
        var s = String(c.nodeValue || "");
        if (s.indexOf(OLD_NAME) === -1) continue;
        if (s.indexOf("(with audio)") !== -1) continue;
        if (s.indexOf("(2026)") !== -1) continue;
        c.nodeValue = s.split(OLD_NAME).join(NEW_NAME);
      }
      return;
    }
    if (el.textContent != null && looksLikeOldName(el.textContent)) {
      el.textContent = NEW_NAME;
    }
  }

  function rewriteElement(el) {
    if (!el || typeof el.getAttribute !== "function") return false;
    var changed = false;
    var names = ["href", "data-url", "data-trcopy"];
    var i;
    for (i = 0; i < names.length; i += 1) {
      var v = el.getAttribute(names[i]);
      if (!v || !hasLegacy(v)) continue;
      el.setAttribute(names[i], rewriteUrl(v));
      changed = true;
    }
    if (changed || (el.getAttribute("href") || "").indexOf(NEW_ID) !== -1) rewriteName(el);
    return changed;
  }

  function rewriteTree(doc) {
    doc = doc || root.document;
    if (!doc || typeof doc.querySelectorAll !== "function") return 0;
    var n = 0;
    var nodes;
    try {
      nodes = doc.querySelectorAll("a[href], [data-url], [data-trcopy]");
    } catch (err) {
      nodes = doc.querySelectorAll("a[href]");
    }
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      if (rewriteElement(nodes[i])) n += 1;
    }
    return n;
  }

  function closestAnchor(el) {
    var cur = el;
    while (cur && cur !== root.document) {
      var name = String(cur.tagName || cur.nodeName || "").toUpperCase();
      if (name === "A") return cur;
      cur = cur.parentNode || cur.parentElement;
    }
    return null;
  }

  function onClick(e) {
    var a = closestAnchor(e && e.target);
    if (a) rewriteElement(a);
  }

  function bindClicks() {
    var doc = root.document;
    if (!doc || typeof doc.addEventListener !== "function") return;
    if (doc.documentElement && doc.documentElement.getAttribute &&
        doc.documentElement.getAttribute("data-hr-onboarding-links") === "1") {
      return;
    }
    doc.addEventListener("click", onClick, true);
    if (doc.documentElement && doc.documentElement.setAttribute) {
      doc.documentElement.setAttribute("data-hr-onboarding-links", "1");
    }
  }

  function wrapRender() {
    if (typeof root.render !== "function") return false;
    if (root.render.__hrOnboardingLinks) return true;
    var orig = root.render;
    root.render = function () {
      try {
        patchKnownProgrammes();
        patchResources();
      } catch (e) {}
      var r = orig.apply(this, arguments);
      try {
        rewriteTree(root.document);
      } catch (e2) {}
      return r;
    };
    root.render.__hrOnboardingLinks = true;
    return true;
  }

  function observe() {
    var doc = root.document;
    if (!doc || !doc.documentElement) return;
    if (typeof root.MutationObserver !== "function") return;
    if (observer) return;
    observer = new root.MutationObserver(function () {
      try {
        rewriteTree(doc);
      } catch (e) {}
    });
    try {
      observer.observe(doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "data-url", "data-trcopy"],
      });
    } catch (e2) {
      observer = null;
    }
  }

  function tick() {
    var patched = 0;
    var wrapped = false;
    try {
      patched += patchKnownProgrammes();
    } catch (e) {}
    try {
      patched += patchResources();
    } catch (e2) {}
    try {
      wrapped = wrapRender();
    } catch (e3) {
      wrapped = false;
    }
    bindClicks();
    observe();
    try {
      patched += rewriteTree(root.document);
    } catch (e4) {}
    return { patched: patched, wrapped: wrapped };
  }

  function schedule(fn) {
    if (typeof root.setTimeout === "function") return root.setTimeout(fn, POLL_MS);
    return 0;
  }

  function startPoll() {
    if (polling) return;
    polling = true;
    pollTries = 0;
    function again() {
      var out = tick();
      pollTries += 1;
      if (out.wrapped || pollTries >= MAX_POLLS) {
        polling = false;
        return;
      }
      schedule(again);
    }
    schedule(again);
  }

  function attach() {
    var out = tick();
    if (!out.wrapped) startPoll();
    api.attached = true;
    return api;
  }

  var api = {
    attached: false,
    OLD_FILE_ID: OLD_ID,
    INTERIM_FILE_ID: INTERIM_ID,
    NEW_FILE_ID: NEW_ID,
    NEW_URL: NEW_URL,
    NEW_NAME: NEW_NAME,
    rewriteUrl: rewriteUrl,
    patchMaterial: patchMaterial,
    patchRecord: patchRecord,
    patchProgramme: patchProgramme,
    patchKnownProgrammes: patchKnownProgrammes,
    patchResources: patchResources,
    rewriteElement: rewriteElement,
    rewriteTree: rewriteTree,
    wrapRender: wrapRender,
    tick: tick,
    attach: attach,
    install: attach,
  };

  root.hrOnboardingLinks = api;

  if (typeof root.document !== "undefined" && root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
