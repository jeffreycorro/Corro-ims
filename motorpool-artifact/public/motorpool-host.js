/**
 * Host companion for the Claude Motorpool artifact.
 * Do not rewrite the artifact. The brief: prompt / confirm / alert / print
 * are blocked in the host and fail silently. The artifact already avoids
 * the first three; print still appears in a few leftover calls.
 *
 * Also registers the current BUILD in the allowed `builds` collection and
 * keeps the newer-version banner from showing blank labels.
 */
(function (global) {
  "use strict";

  function readPageBuild(root) {
    root = root || (typeof document !== "undefined" ? document : null);
    if (!root) return "";
    try {
      var meta = root.querySelector && root.querySelector('meta[name="mp-build"]');
      if (meta && meta.content) return String(meta.content).trim();
    } catch (e) {}
    var html = "";
    try {
      if (root.documentElement && root.documentElement.innerHTML) {
        html = root.documentElement.innerHTML;
      } else if (typeof root.innerHTML === "string") {
        html = root.innerHTML;
      }
    } catch (e2) {}
    var match = String(html).match(/var BUILD\s*=\s*"([^"]+)"/);
    return match ? String(match[1]).trim() : "";
  }

  function buildDocId(build) {
    return String(build || "")
      .trim()
      .replace(/[\\/]+/g, "-");
  }

  function shouldShowBuildBanner(mine, latest) {
    mine = String(mine == null ? "" : mine).trim();
    latest = String(latest == null ? "" : latest).trim();
    return Boolean(mine && latest && mine !== latest);
  }

  function bannerDisplayIsNone(banner) {
    try {
      return Boolean(banner && banner.style && banner.style.display === "none");
    } catch (e) {
      return false;
    }
  }

  function bannerAlreadyHidden(banner) {
    return Boolean(banner && banner.hidden && bannerDisplayIsNone(banner));
  }

  function forceHideBanner(banner) {
    if (!banner || bannerAlreadyHidden(banner)) return false;
    banner.hidden = true;
    try {
      if (banner.setAttribute) banner.setAttribute("hidden", "");
      if (banner.style && banner.style.setProperty) {
        banner.style.setProperty("display", "none", "important");
      }
    } catch (e) {}
    return true;
  }

  var applyingBanner = false;

  function hideEmptyBuildBanner(root) {
    if (applyingBanner) return false;
    root = root || (typeof document !== "undefined" ? document : null);
    if (!root || !root.getElementById) return false;
    var banner = root.getElementById("buildBanner");
    if (!banner) return false;
    applyingBanner = true;
    try {
      var mineEl = root.getElementById("buildMine");
      var latestEl = root.getElementById("buildLatest");
      var mine = mineEl ? String(mineEl.textContent || "").trim() : "";
      var latest = latestEl ? String(latestEl.textContent || "").trim() : "";
      if (!shouldShowBuildBanner(mine, latest)) {
        forceHideBanner(banner);
        return true;
      }
      try {
        if (banner.style && banner.style.display === "none" && banner.style.removeProperty) {
          banner.style.removeProperty("display");
        }
      } catch (e) {}
      return false;
    } finally {
      applyingBanner = false;
    }
  }

  function injectBuildBannerStyle(root) {
    var doc = root;
    try {
      if (root && root.ownerDocument) doc = root.ownerDocument;
      if (root && root.head) doc = root;
    } catch (e) {}
    if (!doc || !doc.createElement) return;
    try {
      if (doc.getElementById && doc.getElementById("mp-host-build-banner-style")) return;
      var style = doc.createElement("style");
      style.id = "mp-host-build-banner-style";
      style.textContent = "#buildBanner[hidden]{display:none!important}";
      (doc.head || doc.documentElement || doc.body).appendChild(style);
    } catch (e2) {}
  }

  var registerInFlight = null;

  function registerCurrentBuild() {
    if (registerInFlight) return registerInFlight;
    var build = readPageBuild();
    var id = buildDocId(build);
    if (!build || !id || !global.claude || typeof global.claude.use !== "function") {
      return Promise.resolve(null);
    }
    registerInFlight = global.claude
      .use("db")
      .then(function (db) {
        if (!db || !db.doc) return null;
        return db
          .doc("builds/" + id)
          .get()
          .then(function (snap) {
            if (snap && snap.exists) return snap;
            return db.doc("builds/" + id).set({ build: build, seq: Date.now() });
          });
      })
      .catch(function () {
        return null;
      })
      .then(function (result) {
        registerInFlight = null;
        return result;
      });
    return registerInFlight;
  }

  function watchBuildBanner(root) {
    root = root || (typeof document !== "undefined" ? document : null);
    if (!root) return;
    injectBuildBannerStyle(root);
    hideEmptyBuildBanner(root);
    // Watch the version labels only. Observing #buildBanner attributes/style
    // and then writing display/hidden in the callback is a MutationObserver
    // feedback loop — Chrome shows Page Unresponsive with the yard half-painted.
    try {
      if (typeof MutationObserver === "function") {
        var mineEl = root.getElementById && root.getElementById("buildMine");
        var latestEl = root.getElementById && root.getElementById("buildLatest");
        var targets = [mineEl, latestEl].filter(Boolean);
        if (targets.length) {
          var obs = new MutationObserver(function () {
            hideEmptyBuildBanner(root);
          });
          targets.forEach(function (el) {
            obs.observe(el, { childList: true, characterData: true, subtree: true });
          });
        }
      }
    } catch (e) {}
    if (typeof setInterval === "function") {
      var n = 0;
      var timer = setInterval(function () {
        hideEmptyBuildBanner(root);
        n += 1;
        if (n > 20 && typeof clearInterval === "function") clearInterval(timer);
      }, 250);
      if (timer && typeof timer.unref === "function") timer.unref();
    }
  }

  global.__mpHost = {
    readPageBuild: readPageBuild,
    buildDocId: buildDocId,
    shouldShowBuildBanner: shouldShowBuildBanner,
    hideEmptyBuildBanner: hideEmptyBuildBanner,
    bannerAlreadyHidden: bannerAlreadyHidden,
    injectBuildBannerStyle: injectBuildBannerStyle,
    registerCurrentBuild: registerCurrentBuild,
  };

  if (global.__mpHostBlocked) return;
  global.__mpHostBlocked = true;
  try {
    window.prompt = function () {
      return null;
    };
    window.confirm = function () {
      return false;
    };
    window.alert = function () {};
    window.print = function () {};
  } catch (e) {}

  function bootHost() {
    watchBuildBanner();
    // Do not contend with yard boot / ledger load on the first turn.
    var later = null;
    if (typeof requestIdleCallback === "function") {
      later = function (fn) {
        requestIdleCallback(fn, { timeout: 2500 });
      };
    } else if (typeof setTimeout === "function") {
      later = function (fn) {
        setTimeout(fn, 0);
      };
    }
    if (later) {
      later(function () {
        registerCurrentBuild();
      });
    } else {
      registerCurrentBuild();
    }
  }

  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootHost);
  } else {
    bootHost();
  }
})(typeof window !== "undefined" ? window : this);
