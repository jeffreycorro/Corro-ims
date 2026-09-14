"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadPwa(documentHead) {
  const created = [];
  const head = {
    appendChild(el) {
      created.push(el);
      if (documentHead && typeof documentHead.appendChild === "function") {
        documentHead.appendChild(el);
      }
    },
  };
  const metas = new Map();
  const links = [];
  const document = {
    head,
    documentElement: {
      getAttribute() {
        return null;
      },
      setAttribute() {},
    },
    body: { appendChild() {} },
    querySelector(sel) {
      const meta = /^meta\[name="([^"]+)"\]$/.exec(sel);
      if (meta) return metas.get(meta[1]) || null;
      const link = /^link\[rel="([^"]+)"\]\[href="([^"]+)"\]$/.exec(sel);
      if (link) {
        return links.find((item) => item.rel === link[1] && item.href === link[2]) || null;
      }
      if (sel === '.nav button[aria-current="true"]') return null;
      return null;
    },
    getElementById() {
      return null;
    },
    createElement(tag) {
      const el = {
        tagName: tag,
        attrs: {},
        className: "",
        innerHTML: "",
        setAttribute(name, value) {
          this.attrs[name] = String(value);
          if (tag === "meta" && name === "name") metas.set(value, el);
          if (tag === "link" && name === "rel") el.rel = value;
          if (tag === "link" && name === "href") el.href = value;
        },
        getAttribute(name) {
          return this.attrs[name] || null;
        },
        querySelector() {
          return { addEventListener() {} };
        },
      };
      if (tag === "link") links.push(el);
      return el;
    },
    addEventListener() {},
  };

  const viewport = document.createElement("meta");
  viewport.setAttribute("name", "viewport");
  viewport.setAttribute("content", "width=device-width,initial-scale=1");
  metas.set("viewport", viewport);

  const window = {
    document,
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    matchMedia() {
      return { matches: false };
    },
    addEventListener() {},
    MutationObserver: class {
      observe() {}
    },
  };
  window.window = window;
  const src = fs.readFileSync(path.join(__dirname, "../public/pwa.js"), "utf8");
  vm.runInNewContext(src, window);
  return { document, created, metas, links, viewport };
}

describe("Motorpool PWA bootstrap", () => {
  it("extends the existing viewport and injects iOS standalone tags", () => {
    const { viewport, metas, links } = loadPwa();
    assert.match(viewport.getAttribute("content"), /viewport-fit=cover/);
    assert.equal(metas.get("apple-mobile-web-app-capable").getAttribute("content"), "yes");
    assert.equal(metas.get("mobile-web-app-capable").getAttribute("content"), "yes");
    assert.equal(
      metas.get("apple-mobile-web-app-status-bar-style").getAttribute("content"),
      "black-translucent"
    );
    assert.equal(metas.get("apple-mobile-web-app-title").getAttribute("content"), "Motorpool");
    assert.equal(metas.get("theme-color").getAttribute("content"), "#2aa0c0");
    assert.ok(links.some((link) => link.rel === "manifest" && link.href === "/manifest.json"));
    assert.ok(
      links.some((link) => link.rel === "apple-touch-icon" && link.href === "/apple-touch-icon.png")
    );
  });

  it("ships a standalone manifest and branded PNG icons", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../public/manifest.json"), "utf8")
    );
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.short_name, "Motorpool");
    assert.equal(manifest.theme_color, "#2aa0c0");
    assert.ok(manifest.icons.every((icon) => icon.src.endsWith(".png")));
    for (const file of [
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "icon-512-maskable.png",
      "pwa.css",
      "sw.js",
    ]) {
      const full = path.join(__dirname, "../public", file);
      assert.ok(fs.existsSync(full), file);
      assert.ok(fs.statSync(full).size > 200, file + " should not be empty");
    }
  });

  it("service worker only lists static shell paths", () => {
    const sw = fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8");
    assert.match(sw, /\/manifest\.json/);
    assert.match(sw, /\/pwa\.css/);
    assert.match(sw, /\/icon-192\.png/);
    assert.match(sw, /\/apple-touch-icon\.png/);
    assert.doesNotMatch(sw, /index\.html/);
    assert.doesNotMatch(sw, /claude-shim/);
    assert.doesNotMatch(sw, /motorpool-host/);
    assert.doesNotMatch(sw, /motorpool-tts/);
    assert.match(sw, /\/\.netlify\//);
  });

  it("host overlay keeps Ask the Log and Sign out usable on a phone", () => {
    const css = fs.readFileSync(path.join(__dirname, "../public/pwa.css"), "utf8");
    assert.match(css, /safe-area-inset-top/);
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /font-size:\s*16px/);
    assert.match(css, /data-mp-view="ask"/);
    assert.match(css, /mp-shim-session-host|Sign out/);
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  });
});
