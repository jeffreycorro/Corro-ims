/**
 * CorConDev HR PWA bootstrap.
 * Load after /claude-shim.js. Does not replace artifact logic.
 * Extends the existing viewport meta and adds iOS standalone tags.
 */
(function () {
  "use strict";

  var METAS = {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "HR Portal",
    "theme-color": "#1b2430",
  };

  function ensureMeta(name, content) {
    var el = document.querySelector('meta[name="' + name + '"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
    return el;
  }

  function ensureLink(rel, href, extra) {
    var el = document.querySelector('link[rel="' + rel + '"][href="' + href + '"]');
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", rel);
      el.setAttribute("href", href);
      document.head.appendChild(el);
    }
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        el.setAttribute(key, extra[key]);
      });
    }
    return el;
  }

  function patchViewport() {
    var el = document.querySelector('meta[name="viewport"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", "viewport");
      document.head.appendChild(el);
    }
    var content = el.getAttribute("content") || "width=device-width, initial-scale=1";
    if (!/viewport-fit\s*=/i.test(content)) {
      content = content.replace(/\s+$/, "") + ", viewport-fit=cover";
    }
    el.setAttribute("content", content);
  }

  function boot() {
    if (!document.head) return;
    patchViewport();
    Object.keys(METAS).forEach(function (name) {
      ensureMeta(name, METAS[name]);
    });
    ensureLink("manifest", "/manifest.json");
    ensureLink("apple-touch-icon", "/apple-touch-icon.png", { sizes: "180x180" });
  }

  if (document.head) boot();
  else document.addEventListener("DOMContentLoaded", boot);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
})();
