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
    querySelector(sel) {
      const meta = /^meta\[name="([^"]+)"\]$/.exec(sel);
      if (meta) return metas.get(meta[1]) || null;
      const link = /^link\[rel="([^"]+)"\]\[href="([^"]+)"\]$/.exec(sel);
      if (link) {
        return (
          links.find((item) => item.rel === link[1] && item.href === link[2]) || null
        );
      }
      return null;
    },
    createElement(tag) {
      const el = {
        tagName: tag,
        attrs: {},
        setAttribute(name, value) {
          this.attrs[name] = String(value);
          if (tag === "meta" && name === "name") metas.set(value, el);
          if (tag === "link" && name === "rel") el.rel = value;
          if (tag === "link" && name === "href") el.href = value;
        },
        getAttribute(name) {
          return this.attrs[name] || null;
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
    navigator: {},
    addEventListener() {},
  };
  window.window = window;
  const src = fs.readFileSync(path.join(__dirname, "../public/pwa.js"), "utf8");
  vm.runInNewContext(src, window);
  return { document, created, metas, links, viewport };
}

describe("HR PWA bootstrap", () => {
  it("extends the existing viewport and injects iOS standalone tags", () => {
    const { viewport, metas, links } = loadPwa();
    assert.match(viewport.getAttribute("content"), /viewport-fit=cover/);
    assert.equal(metas.get("apple-mobile-web-app-capable").getAttribute("content"), "yes");
    assert.equal(metas.get("mobile-web-app-capable").getAttribute("content"), "yes");
    assert.equal(
      metas.get("apple-mobile-web-app-status-bar-style").getAttribute("content"),
      "black-translucent"
    );
    assert.equal(metas.get("apple-mobile-web-app-title").getAttribute("content"), "HR Portal");
    assert.equal(metas.get("theme-color").getAttribute("content"), "#1b2430");
    assert.ok(links.some((link) => link.rel === "manifest" && link.href === "/manifest.json"));
    assert.ok(
      links.some((link) => link.rel === "apple-touch-icon" && link.href === "/apple-touch-icon.png")
    );
  });

  it("ships a standalone manifest and branded icons", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../public/manifest.json"), "utf8")
    );
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.short_name, "HR Portal");
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
    assert.doesNotMatch(sw, /index\.html/);
    assert.doesNotMatch(sw, /claude-shim/);
    assert.match(sw, /\/\.netlify\//);
  });
});
