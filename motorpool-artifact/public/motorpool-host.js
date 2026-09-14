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

  function hideEmptyBuildBanner(root) {
    root = root || (typeof document !== "undefined" ? document : null);
    if (!root || !root.getElementById) return false;
    var banner = root.getElementById("buildBanner");
    if (!banner || banner.hidden) return false;
    var mineEl = root.getElementById("buildMine");
    var latestEl = root.getElementById("buildLatest");
    var mine = mineEl ? String(mineEl.textContent || "").trim() : "";
    var latest = latestEl ? String(latestEl.textContent || "").trim() : "";
    if (!shouldShowBuildBanner(mine, latest)) {
      banner.hidden = true;
      return true;
    }
    return false;
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
    hideEmptyBuildBanner(root);
    try {
      if (typeof MutationObserver === "function") {
        var banner = root.getElementById && root.getElementById("buildBanner");
        var target = banner || root.documentElement || root.body;
        if (target) {
          var obs = new MutationObserver(function () {
            hideEmptyBuildBanner(root);
          });
          obs.observe(target, {
            attributes: true,
            childList: true,
            subtree: true,
            characterData: true,
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
    registerCurrentBuild();
  }

  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootHost);
  } else {
    bootHost();
  }
})(typeof window !== "undefined" ? window : this);
