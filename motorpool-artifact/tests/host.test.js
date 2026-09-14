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
  const banner = { id: "buildBanner", hidden: true };
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
