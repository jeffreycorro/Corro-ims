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

  /* Product rules (Jeffrey, 2026-09-15): staff raise spend on the VRF maker.
     Fuel gauge / fuel-check walls must not block a VRF. Reserves is a log of
     approved, not-yet-liquidated VRFs — not a place to invent a reserve. */
  function fuelVrfGatesEnabled() {
    return false;
  }
  function fuelVrfRequiresApprovedReserve() {
    return false;
  }
  function fuelVrfRequiresBypass() {
    return false;
  }
  function reserveCreatePathAllowed() {
    return false;
  }
  function reservesAreLogOnly() {
    return true;
  }
  function textOf(el) {
    try {
      return String((el && (el.textContent || el.innerText)) || "").replace(/\s+/g, " ").trim();
    } catch (e) {
      return "";
    }
  }
  function closestCard(el) {
    var n = el;
    var doc = el && el.ownerDocument;
    var stop = doc && doc.documentElement;
    while (n && n !== doc && n !== stop) {
      var cls = "";
      try {
        cls = String(n.className || "");
      } catch (e) {}
      if (/(^|\s)card(\s|$)/.test(cls) || (n.getAttribute && n.getAttribute("data-mp-raise-reserve"))) {
        return n;
      }
      n = n.parentNode;
    }
    return el && el.parentNode;
  }
  function isRaiseReserveHeading(el) {
    var t = textOf(el);
    return (
      t === "Raise a reserve" ||
      t === "Ask for a reserve" ||
      t === "New reserve" ||
      /^Raise a (fuel )?reserve/i.test(t) ||
      /^Ask approval to create/i.test(t)
    );
  }
  function isCreateReserveButton(el) {
    var t = textOf(el);
    return (
      t === "Send for approval" ||
      t === "Bypass — log VRF now" ||
      t === "New reserve" ||
      t === "Ask approval to create reserve" ||
      /^Create reserve/i.test(t)
    );
  }
  function stripReserveCreateForm(root) {
    root = root || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelectorAll) return 0;
    var removed = 0;
    var heads = root.querySelectorAll("h3, h2, .hd h3");
    for (var i = 0; i < heads.length; i++) {
      if (!isRaiseReserveHeading(heads[i])) continue;
      var card = closestCard(heads[i]);
      if (card && card.parentNode) {
        card.parentNode.removeChild(card);
        removed += 1;
      }
    }
    return removed;
  }
  function relabelReservesAsLog(root) {
    root = root || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelectorAll) return false;
    var changed = false;
    var heads = root.querySelectorAll(".page-head h2, .page-head p, .page-head .eyebrow");
    for (var i = 0; i < heads.length; i++) {
      var t = textOf(heads[i]);
      if (t === "Ask before the money is spent") {
        heads[i].textContent = "Approved VRFs waiting to be liquidated";
        changed = true;
      } else if (/A reserve is the request:/.test(t) || /Ask before the money is spent/.test(t)) {
        heads[i].textContent =
          "This is the reserve log — approved VRFs that are not yet liquidated. Raise new spend on New VRF. There is no form here to invent a reserve.";
        changed = true;
      } else if (t === "Reserves" && heads[i].className && /eyebrow/.test(String(heads[i].className))) {
        heads[i].textContent = "Reserve log";
        changed = true;
      }
    }
    return changed;
  }
  function hideFuelCheckGateway(root) {
    root = root || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelectorAll) return 0;
    var hidden = 0;
    var heads = root.querySelectorAll("h3");
    for (var i = 0; i < heads.length; i++) {
      var t = textOf(heads[i]);
      if (t !== "Fuel check" && t !== "Fuel-check" && t !== "Fuel gate") continue;
      var card = closestCard(heads[i]);
      if (card && card.style) {
        card.style.display = "none";
        hidden += 1;
      }
    }
    return hidden;
  }
  function wrapView(global, name, after) {
    if (!global || typeof global[name] !== "function" || global[name].__mpWrapped) return false;
    var orig = global[name];
    var wrapped = function () {
      var w = orig.apply(this, arguments);
      try {
        after(w, global);
      } catch (e) {}
      return w;
    };
    wrapped.__mpWrapped = true;
    global[name] = wrapped;
    return true;
  }
  function wrapPostVrfIfGated(global) {
    if (!global || typeof global.postVrf !== "function" || global.postVrf.__mpNoFuelGates) return false;
    var src = "";
    try {
      src = Function.prototype.toString.call(global.postVrf);
    } catch (e) {}
    if (!/Fuel needs an approved reserve|fuel check has stopped this request/.test(src)) {
      global.postVrf.__mpNoFuelGates = true;
      return false;
    }
    var orig = global.postVrf;
    global.postVrf = function (d, btn) {
      if (d) {
        var who = String((d.requestedBy || "staff").trim() || "staff");
        var when = typeof global.iso === "function" ? global.iso() : "";
        d.gateOverride = Object.assign(
          { bypass: true, reason: "Posted from VRF maker", by: who, at: when },
          d.gateOverride || {}
        );
      }
      return orig.apply(this, arguments);
    };
    global.postVrf.__mpNoFuelGates = true;
    return true;
  }
  function decorateReservesView(w) {
    stripReserveCreateForm(w);
    relabelReservesAsLog(w);
  }
  function decorateVrfView(w) {
    hideFuelCheckGateway(w);
    if (!w || !w.querySelectorAll) return;
    var banners = w.querySelectorAll(".banner");
    for (var i = 0; i < banners.length; i++) {
      var t = textOf(banners[i]);
      if (/Two ways out of this form/.test(t) || /gauge photo is optional/i.test(t)) {
        banners[i].innerHTML =
          "<div><b>Raise the VRF here.</b> Fuel does not need a gauge reading, a gauge photo, or a fuel check. " +
          "<b>Send for approval</b> holds the number until the office approves it — then it appears on the reserve log. " +
          "<b>Post VRF</b> records it now. Reserves is only that log; do not invent a reserve there.</div>";
      }
    }
  }
  function applyYardOverlays(root) {
    root = root || (typeof document !== "undefined" ? document : null);
    if (!root) return;
    stripReserveCreateForm(root);
    relabelReservesAsLog(root);
    hideFuelCheckGateway(root);
  }
  function installProductOverlays(global) {
    global = global || (typeof window !== "undefined" ? window : this);
    if (!global) return false;
    wrapPostVrfIfGated(global);
    wrapView(global, "rsvView", function (w) {
      decorateReservesView(w);
    });
    wrapView(global, "vrfView", function (w) {
      decorateVrfView(w);
    });
    if (typeof global.render === "function" && !global.render.__mpProduct) {
      var origRender = global.render;
      global.render = function () {
        var out = origRender.apply(this, arguments);
        try {
          applyYardOverlays(global.document);
        } catch (e) {}
        return out;
      };
      global.render.__mpProduct = true;
    }
    try {
      applyYardOverlays(global.document);
    } catch (e2) {}
    return true;
  }
  function watchProductOverlays(global) {
    global = global || (typeof window !== "undefined" ? window : this);
    installProductOverlays(global);
    var n = 0;
    if (typeof setInterval === "function") {
      var timer = setInterval(function () {
        installProductOverlays(global);
        n += 1;
        if (n > 40 && typeof clearInterval === "function") clearInterval(timer);
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
    fuelVrfGatesEnabled: fuelVrfGatesEnabled,
    fuelVrfRequiresApprovedReserve: fuelVrfRequiresApprovedReserve,
    fuelVrfRequiresBypass: fuelVrfRequiresBypass,
    reserveCreatePathAllowed: reserveCreatePathAllowed,
    reservesAreLogOnly: reservesAreLogOnly,
    stripReserveCreateForm: stripReserveCreateForm,
    relabelReservesAsLog: relabelReservesAsLog,
    hideFuelCheckGateway: hideFuelCheckGateway,
    wrapPostVrfIfGated: wrapPostVrfIfGated,
    installProductOverlays: installProductOverlays,
    applyYardOverlays: applyYardOverlays,
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
    watchProductOverlays(global);
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
