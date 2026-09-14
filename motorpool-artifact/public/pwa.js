/**
 * CorConDev Motorpool PWA bootstrap. Load after /claude-shim.js.
 * Extends the existing viewport meta and adds iOS standalone tags.
 */
(function () {
  "use strict";

  var METAS = {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "Motorpool",
    "theme-color": "#2aa0c0",
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

  function syncView() {
    var btn = document.querySelector('.nav button[aria-current="true"]');
    var text = btn ? btn.textContent || "" : "";
    var view = /ask the log/i.test(text) ? "ask" : "other";
    if (document.documentElement.getAttribute("data-mp-view") !== view) {
      document.documentElement.setAttribute("data-mp-view", view);
    }
  }

  function watchView() {
    if (!document.documentElement || typeof MutationObserver !== "function") {
      syncView();
      return;
    }
    var observer = new MutationObserver(syncView);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-current"],
    });
    syncView();
  }

  function isStandalone() {
    try {
      if (window.navigator && window.navigator.standalone) return true;
      return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    } catch (e) {
      return false;
    }
  }

  function isIosSafari() {
    try {
      var ua = navigator.userAgent || "";
      var iOS =
        /iPhone|iPad|iPod/.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (!iOS) return false;
      return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    } catch (e) {
      return false;
    }
  }

  function showInstallTip() {
    try {
      if (isStandalone()) return;
      if (!isIosSafari()) return;
      if (window.localStorage && localStorage.getItem("mp-a2hs-dismissed") === "1") return;
      if (document.getElementById("mp-a2hs")) return;
      var tip = document.createElement("div");
      tip.id = "mp-a2hs";
      tip.className = "mp-a2hs";
      tip.setAttribute("role", "note");
      tip.innerHTML =
        "<p><strong>Add to Home Screen</strong>Safari → Share → Add to Home Screen. Opens as a full-screen Motorpool app.</p>" +
        '<button type="button" aria-label="Dismiss">×</button>';
      var btn = tip.querySelector("button");
      btn.addEventListener("click", function () {
        try {
          localStorage.setItem("mp-a2hs-dismissed", "1");
        } catch (e) {}
        tip.remove();
      });
      (document.body || document.documentElement).appendChild(tip);
    } catch (e) {}
  }

  function boot() {
    if (!document.head) return;
    patchViewport();
    Object.keys(METAS).forEach(function (name) {
      ensureMeta(name, METAS[name]);
    });
    ensureLink("manifest", "/manifest.json");
    ensureLink("icon", "/favicon.svg", { type: "image/svg+xml" });
    ensureLink("apple-touch-icon", "/apple-touch-icon.png", { sizes: "180x180" });
    watchView();
    showInstallTip();
  }

  if (document.head) boot();
  else document.addEventListener("DOMContentLoaded", boot);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
})();
