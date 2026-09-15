/**
 * Company onboarding video Drive file remap.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * New Employee Orientation (pg_onb) "Onboarding video" still points at an
 * older Drive file. Patch that file id on the programme record and on any
 * rendered link that still uses it. Other role orientation videos are left
 * alone unless they literally share the same id.
 */
(function (root) {
  "use strict";

  if (root.hrOnboardingLinks && root.hrOnboardingLinks.attached) return;

  var OLD_ID = "11wX350zj31ybmtagU9P8TTA71gIX2i3Y";
  var NEW_ID = "1SaURmAToj3CiSpVYagFHXCtdq3A-z2_d";
  var NEW_URL = "https://drive.google.com/file/d/" + NEW_ID + "/view";
  var OLD_NAME = "CORCONDEV Onboarding";
  var NEW_NAME = "CORCONDEV Onboarding (2026)";

  function rewriteUrl(url) {
    var s = String(url == null ? "" : url);
    if (s.indexOf(OLD_ID) === -1) return s;
    return s.split(OLD_ID).join(NEW_ID);
  }

  function patchMaterial(m) {
    if (!m || typeof m !== "object") return false;
    var url = String(m.url || "");
    if (url.indexOf(OLD_ID) === -1) return false;
    m.url = rewriteUrl(url);
    if (String(m.n || "").trim() === OLD_NAME) m.n = NEW_NAME;
    return true;
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

  function patchKnownProgrammes() {
    var n = 0;
    if (typeof root.programme === "function") {
      n += patchProgramme(root.programme("pg_onb"));
    }
    if (typeof root.everyoneProgrammes === "function") {
      var everyone = root.everyoneProgrammes() || [];
      var e;
      for (e = 0; e < everyone.length; e += 1) n += patchProgramme(everyone[e]);
    }
    var list = root.PROGRAMMES;
    if (list && list.length) {
      var i;
      for (i = 0; i < list.length; i += 1) n += patchProgramme(list[i]);
    }
    return n;
  }

  function rewriteName(el) {
    if (!el) return;
    var href = el.getAttribute ? String(el.getAttribute("href") || "") : "";
    if (href.indexOf(OLD_ID) === -1 && href.indexOf(NEW_ID) === -1) return;
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
    if (el.textContent != null && String(el.textContent).trim() === OLD_NAME) {
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
      if (!v || String(v).indexOf(OLD_ID) === -1) continue;
      el.setAttribute(names[i], rewriteUrl(v));
      changed = true;
    }
    if (changed) rewriteName(el);
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
      cur = cur.parentNode;
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
    if (typeof root.render !== "function" || root.render.__hrOnboardingLinks) return;
    var orig = root.render;
    root.render = function () {
      try {
        patchKnownProgrammes();
      } catch (e) {}
      var r = orig.apply(this, arguments);
      try {
        rewriteTree(root.document);
      } catch (e2) {}
      return r;
    };
    root.render.__hrOnboardingLinks = true;
  }

  function attach() {
    if (api.attached) return api;
    patchKnownProgrammes();
    wrapRender();
    bindClicks();
    rewriteTree(root.document);
    api.attached = true;
    return api;
  }

  var api = {
    attached: false,
    OLD_FILE_ID: OLD_ID,
    NEW_FILE_ID: NEW_ID,
    NEW_URL: NEW_URL,
    rewriteUrl: rewriteUrl,
    patchMaterial: patchMaterial,
    patchProgramme: patchProgramme,
    patchKnownProgrammes: patchKnownProgrammes,
    rewriteElement: rewriteElement,
    rewriteTree: rewriteTree,
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
