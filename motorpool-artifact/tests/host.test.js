"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHost(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/motorpool-host.js"), "utf8");
  vm.runInNewContext(src, windowLike);
  return windowLike.__mpHost;
}

function hostWindow(html) {
  const banner = {
    id: "buildBanner",
    hidden: true,
    style: {
      display: "",
      setProperty(name, value) {
        this[name] = value;
      },
      removeProperty(name) {
        this[name] = "";
      },
    },
    setAttribute() {},
  };
  const mine = { id: "buildMine", textContent: "" };
  const latest = { id: "buildLatest", textContent: "" };
  const byId = { buildBanner: banner, buildMine: mine, buildLatest: latest };
  const window = {
    document: {
      documentElement: { innerHTML: html || 'var BUILD = "2026-09-14 g";' },
      readyState: "complete",
      querySelector(sel) {
        if (sel === 'meta[name="mp-build"]') return null;
        return null;
      },
      getElementById(id) {
        return byId[id] || null;
      },
      addEventListener() {},
    },
    prompt() {
      return "nope";
    },
    confirm() {
      return true;
    },
    alert() {},
    print() {},
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  window.window = window;
  window.banner = banner;
  window.mine = mine;
  window.latest = latest;
  return window;
}

describe("motorpool host companion", () => {
  it("blocks prompt, confirm, alert, and print", () => {
    const w = hostWindow();
    loadHost(w);
    assert.equal(w.prompt(), null);
    assert.equal(w.confirm(), false);
    assert.equal(w.alert(), undefined);
    assert.equal(w.print(), undefined);
  });

  it("reads BUILD from the page and only shows the banner when both labels differ", () => {
    const w = hostWindow('<script>var BUILD = "2026-09-14 g";</script>');
    const host = loadHost(w);
    assert.equal(host.readPageBuild(w.document), "2026-09-14 g");
    assert.equal(host.buildDocId("2026-09-14 g"), "2026-09-14 g");
    assert.equal(host.shouldShowBuildBanner("", "2026-09-14 h"), false);
    assert.equal(host.shouldShowBuildBanner("2026-09-14 g", ""), false);
    assert.equal(host.shouldShowBuildBanner("2026-09-14 g", "2026-09-14 g"), false);
    assert.equal(host.shouldShowBuildBanner("2026-09-14 g", "2026-09-14 h"), true);
  });

  it("hides a visible banner that has blank version labels", () => {
    const w = hostWindow();
    const host = loadHost(w);
    w.banner.hidden = false;
    w.mine.textContent = "";
    w.latest.textContent = "";
    assert.equal(host.hideEmptyBuildBanner(w.document), true);
    assert.equal(w.banner.hidden, true);
    assert.equal(w.banner.style.display, "none");

    w.banner.hidden = true;
    w.banner.style.display = "flex";
    w.mine.textContent = "";
    w.latest.textContent = "";
    assert.equal(host.hideEmptyBuildBanner(w.document), true);
    assert.equal(w.banner.style.display, "none");

    w.banner.hidden = false;
    w.mine.textContent = "2026-09-14 g";
    w.latest.textContent = "2026-09-14 h";
    assert.equal(host.hideEmptyBuildBanner(w.document), false);
    assert.equal(w.banner.hidden, false);
  });

  it("hardens checkBuild so empty labels cannot unhide the banner", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /var mine=String\(BUILD\|\|""\)\.trim\(\)/);
    assert.match(html, /mine&&latest&&latest!==mine/);
    assert.match(html, /function hide\(\)/);
    assert.match(html, /setTimeout\(checkBuild, 0\)/);
    assert.match(html, /Keep the VRF index across chrome re-renders/);
  });

  it("does not keep writing banner style once the banner is already hidden", () => {
    const w = hostWindow();
    const host = loadHost(w);
    w.banner.hidden = false;
    w.banner.style.display = "flex";
    let writes = 0;
    const orig = w.banner.style.setProperty;
    w.banner.style.setProperty = function (name, value, prio) {
      writes += 1;
      this[name] = value;
      return orig.call(this, name, value, prio);
    };
    assert.equal(host.hideEmptyBuildBanner(w.document), true);
    const afterFirst = writes;
    assert.ok(afterFirst >= 1);
    assert.equal(host.bannerAlreadyHidden(w.banner), true);
    host.hideEmptyBuildBanner(w.document);
    host.hideEmptyBuildBanner(w.document);
    assert.equal(writes, afterFirst);
  });

  it("banner hide is safe under attribute MutationObserver re-delivery", () => {
    const w = hostWindow();
    const host = loadHost(w);
    let deliveries = 0;
    w.banner.hidden = false;
    w.banner.style.display = "";
    const orig = w.banner.style.setProperty;
    w.banner.style.setProperty = function (name, value, prio) {
      this[name] = value;
      if (orig) orig.call(this, name, value, prio);
      if (deliveries < 100) {
        deliveries += 1;
        host.hideEmptyBuildBanner(w.document);
      }
    };
    host.hideEmptyBuildBanner(w.document);
    assert.ok(deliveries < 5, "must not re-enter on every style write");
    assert.equal(w.banner.hidden, true);
  });

  it("fuel VRF is unblocked and Reserves is a log of approved VRFs only", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.doesNotMatch(html, /Attach the photo of the gauge\. Fuel is not approved without it/);
    assert.doesNotMatch(html, /if\(!photoCount\(rsvOwner\(r\.no\)\)\) miss\.push\("no photo of the gauge"\)/);
    assert.doesNotMatch(html, /Fuel needs an approved reserve behind it/);
    assert.doesNotMatch(html, /The fuel check has stopped this request/);
    assert.doesNotMatch(html, /The fuel check has stopped this dispense/);
    assert.doesNotMatch(html, /h3",null,"Raise a reserve"/);
    assert.doesNotMatch(html, /Bypass — log VRF now/);
    assert.doesNotMatch(html, /Read the gauge before asking for fuel/);
    assert.doesNotMatch(
      html,
      /Fuel is raised on the Reserves screen — pick the litres and the gauge reading there/
    );
    assert.match(html, /function isFuelBypass/);
    assert.match(html, /function bypassAttribution/);
    assert.match(html, /function logBypassFuelVrf/);
    assert.match(html, /var BUILD = "2026-09-17 b"/);
    assert.match(html, /Approved VRFs waiting to be liquidated/);
    assert.match(html, /Reserves is a log, not a maker/);
    assert.match(html, /Raise the VRF here/);
    assert.match(html, /this screen does not invent a reserve/);
    assert.match(html, /function photoFingerprint/);
    assert.match(html, /function projectPicker/);
    assert.match(html, /function listPhotosMany/);
    assert.match(html, /function harvestProjects/);
    assert.match(html, /function openProjectsManager/);
    assert.match(html, /function pickerProjectList/);
    assert.match(html, /function upsertManagedProject/);
    assert.match(html, /Show archived/);
    assert.match(html, /Manage projects/);
  });

  it("host overlay strips a leftover Raise-a-reserve card and will not re-gate fuel VRF", () => {
    const w = hostWindow();
    const host = loadHost(w);
    assert.equal(host.fuelVrfGatesEnabled(), false);
    assert.equal(host.fuelVrfRequiresApprovedReserve(), false);
    assert.equal(host.fuelVrfRequiresBypass(), false);
    assert.equal(host.reserveCreatePathAllowed(), false);
    assert.equal(host.reservesAreLogOnly(), true);

    const card = {
      className: "card",
      parentNode: { removeChild(el) { this.removed = el; } },
    };
    const h3 = { textContent: "Raise a reserve", className: "", parentNode: card };
    card.parentNode.removeChild = function (el) {
      this.removed = el;
    };
    const root = {
      querySelectorAll(sel) {
        if (sel === "h3, h2, .hd h3") return [h3];
        if (sel === "h3") return [h3];
        if (sel === ".page-head h2, .page-head p, .page-head .eyebrow") return [];
        return [];
      },
    };
    assert.equal(host.stripReserveCreateForm(root), 1);
    assert.equal(card.parentNode.removed, card);

    let called = 0;
    w.postVrf = function postVrf(d, btn) {
      // Fuel needs an approved reserve behind it
      called += 1;
      return d && d.gateOverride;
    };
    assert.equal(host.wrapPostVrfIfGated(w), true);
    const ov = w.postVrf({ requestedBy: "Jun" }, null);
    assert.equal(called, 1);
    assert.equal(ov.bypass, true);
    assert.match(ov.reason, /VRF maker/);
  });

  it("registers the current BUILD once when the doc is missing", async () => {
    const w = hostWindow('var BUILD = "2026-09-14 g";');
    const calls = [];
    const store = {};
    w.claude = {
      use(name) {
        assert.equal(name, "db");
        return Promise.resolve({
          doc(path) {
            return {
              get() {
                calls.push(["get", path]);
                const row = store[path];
                return Promise.resolve({
                  exists: Boolean(row),
                  data() {
                    return row;
                  },
                });
              },
              set(data) {
                calls.push(["set", path, data]);
                store[path] = data;
                return Promise.resolve({ exists: true, data: () => data });
              },
            };
          },
        });
      },
    };
    const host = loadHost(w);
    await host.registerCurrentBuild();
    await host.registerCurrentBuild();
    const sets = calls.filter((c) => c[0] === "set");
    assert.equal(sets.length, 1);
    assert.equal(sets[0][1], "builds/2026-09-14 g");
    assert.equal(sets[0][2].build, "2026-09-14 g");
    assert.equal(typeof sets[0][2].seq, "number");
  });
});
