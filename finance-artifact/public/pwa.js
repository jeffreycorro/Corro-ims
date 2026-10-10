/**
 * CorConDev Finance PWA bootstrap.
 */
(function () {
  "use strict";

  var METAS = {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "Finance",
    "theme-color": "#102033",
  };

  function ensureMeta(name, content) {
    var el = document.querySelector('meta[name="' + name + '"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  function boot() {
    if (!document.head) return;
    var viewport = document.querySelector('meta[name="viewport"]');
    if (viewport && !/viewport-fit\s*=/i.test(viewport.getAttribute("content") || "")) {
      viewport.setAttribute("content", viewport.getAttribute("content") + ", viewport-fit=cover");
    }
    Object.keys(METAS).forEach(function (name) { ensureMeta(name, METAS[name]); });
  }

  if (document.head) boot();
  else document.addEventListener("DOMContentLoaded", boot);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
})();
