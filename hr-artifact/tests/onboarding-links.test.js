"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const OLD_ID = "11wX350zj31ybmtagU9P8TTA71gIX2i3Y";
const INTERIM_ID = "1SaURmAToj3CiSpVYagFHXCtdq3A-z2_d";
const NEW_ID = "1KjKPYMuDarowOeZauaVeronpXaMPTZV6";
const NEW_URL = "https://drive.google.com/file/d/" + NEW_ID + "/view";
const PURCHASER_ID = "1CN_GDRrLeF8ufXUncv4Qn4S227UMMXA5";
const OE_ID = "1Pzt5aFR9seylgY_rLAmRkQpyYeFx2Bsi";

function loadLinks(windowLike) {
  const src = fs.readFileSync(
    path.join(__dirname, "../public/hr-onboarding-links.js"),
    "utf8"
  );
  vm.runInNewContext(src, windowLike);
  return windowLike.hrOnboardingLinks;
}

function bareWindow() {
  const w = { window: null, document: undefined };
  w.window = w;
  return w;
}

function material(extra) {
  return Object.assign(
    {
      k: "Onboarding video",
      n: "CORCONDEV Onboarding",
      url: "https://drive.google.com/file/d/" + OLD_ID + "/view",
      kind: "video",
    },
    extra || {}
  );
}

describe("hr-onboarding-links companion wiring", () => {
  it("is loaded by the shim and not referenced from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-onboarding-links\.js/);
    assert.match(shim, /data-hr-onboarding-links/);
    assert.ok(shim.indexOf("hr-leave-numbers.js") < shim.indexOf("hr-onboarding-links.js"));
    assert.doesNotMatch(html, /hr-onboarding-links\.js/);
  });

  it("leaves Claude 16b pg_onb on the retired file; the companion remaps it", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    const companion = fs.readFileSync(path.join(__dirname, "../public/hr-onboarding-links.js"), "utf8");
    assert.match(html, /id:"pg_onb"/);
    assert.match(html, new RegExp('D_FILE\\("' + OLD_ID + '"\\)'));
    assert.match(html, /CORCONDEV Onboarding/);
    assert.match(companion, new RegExp(NEW_ID));
    assert.doesNotMatch(html, new RegExp('D_FILE\\("' + INTERIM_ID + '"\\)'));
    assert.match(html, new RegExp('D_FILE\\("' + PURCHASER_ID + '"\\)'));
    assert.match(html, new RegExp('D_FILE\\("' + OE_ID + '"\\)'));
  });
});

describe("hr-onboarding-links rewriteUrl", () => {
  it("replaces the retired and interim company onboarding Drive file ids", () => {
    const hr = loadLinks(bareWindow());
    assert.equal(hr.rewriteUrl("https://drive.google.com/file/d/" + OLD_ID + "/view"), NEW_URL);
    assert.equal(hr.rewriteUrl("https://drive.google.com/file/d/" + INTERIM_ID + "/view"), NEW_URL);
    assert.equal(hr.rewriteUrl("https://drive.google.com/file/d/" + OLD_ID + "/preview"),
      "https://drive.google.com/file/d/" + NEW_ID + "/preview");
    assert.equal(hr.NEW_URL, NEW_URL);
    assert.equal(hr.NEW_FILE_ID, NEW_ID);
    assert.equal(hr.INTERIM_FILE_ID, INTERIM_ID);
  });

  it("leaves Purchaser and Office Engineer orientation videos alone", () => {
    const hr = loadLinks(bareWindow());
    const purch = "https://drive.google.com/file/d/" + PURCHASER_ID + "/view";
    const oe = "https://drive.google.com/file/d/" + OE_ID + "/view";
    assert.equal(hr.rewriteUrl(purch), purch);
    assert.equal(hr.rewriteUrl(oe), oe);
    assert.equal(hr.rewriteUrl(""), "");
    assert.equal(hr.rewriteUrl(null), "");
  });
});

describe("hr-onboarding-links programme patch", () => {
  it("rewrites the pg_onb onboarding video and leaves other materials", () => {
    const pg = {
      id: "pg_onb",
      materials: [
        material(),
        {
          k: "Narrated deck",
          n: "CORCONDEV Onboarding (with audio)",
          url: "https://docs.google.com/presentation/d/1sUCeZ8J4bFg36G9nE3o-vUntq3Q-8NRcN54WpZi8tO0/edit",
          kind: "slides",
        },
        {
          k: "Orientation video",
          n: "Corro Purchaser Orientation",
          url: "https://drive.google.com/file/d/" + PURCHASER_ID + "/view",
          kind: "video",
        },
      ],
    };
    const hr = loadLinks(bareWindow());
    assert.equal(hr.patchProgramme(pg), 1);
    assert.equal(pg.materials[0].url, NEW_URL);
    assert.equal(pg.materials[0].n, "CORCONDEV Onboarding (2026)");
    assert.equal(pg.materials[1].n, "CORCONDEV Onboarding (with audio)");
    assert.match(pg.materials[2].url, new RegExp(PURCHASER_ID));
  });

  it("patches via programme() before render so the generated href is new", () => {
    const pg = { id: "pg_onb", materials: [material()] };
    let rendered = "";
    const w = bareWindow();
    w.programme = function (id) {
      return id === "pg_onb" ? pg : null;
    };
    w.render = function () {
      rendered = pg.materials[0].url;
      return rendered;
    };
    const hr = loadLinks(w);
    hr.install();
    w.render();
    assert.equal(rendered, NEW_URL);
    assert.equal(pg.materials[0].n, "CORCONDEV Onboarding (2026)");
    assert.equal(hr.attached, true);
  });

  it("retries wrapRender after render/programme appear later", () => {
    const pg = { id: "pg_onb", materials: [material()] };
    let rendered = "";
    const timers = [];
    const w = bareWindow();
    w.setTimeout = function (fn) {
      timers.push(fn);
      return timers.length;
    };
    const hr = loadLinks(w);
    hr.install();
    assert.equal(typeof w.render, "undefined");
    assert.ok(timers.length > 0, "should poll until the artifact globals exist");

    w.programme = function (id) {
      return id === "pg_onb" ? pg : null;
    };
    w.render = function () {
      rendered = pg.materials[0].url;
      return rendered;
    };
    timers.shift()();
    w.render();
    assert.equal(rendered, NEW_URL);
    assert.equal(pg.materials[0].n, "CORCONDEV Onboarding (2026)");
    assert.equal(w.render.__hrOnboardingLinks, true);
  });

  it("patches resource-library rows that still hold a legacy Drive id", () => {
    const rec = {
      id: "r1",
      title: "CORCONDEV Onboarding",
      link: "https://drive.google.com/file/d/" + INTERIM_ID + "/view",
    };
    const other = {
      id: "r2",
      title: "Corro Purchaser Orientation",
      link: "https://drive.google.com/file/d/" + PURCHASER_ID + "/view",
    };
    const w = bareWindow();
    w.resList = function () {
      return [rec, other];
    };
    const hr = loadLinks(w);
    assert.equal(hr.patchResources(), 1);
    assert.equal(rec.link, NEW_URL);
    assert.equal(rec.title, "CORCONDEV Onboarding (2026)");
    assert.match(other.link, new RegExp(PURCHASER_ID));
  });
});

describe("hr-onboarding-links DOM rewrite", () => {
  function el(tag, attrs, children) {
    const node = {
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      attrs: Object.assign({}, attrs),
      children: children || [],
      childNodes: children || [],
      parentNode: null,
      nodeType: 1,
      textContent: "",
      getAttribute(name) {
        return this.attrs[name] == null ? null : this.attrs[name];
      },
      setAttribute(name, value) {
        this.attrs[name] = String(value);
      },
    };
    (children || []).forEach((c) => {
      if (c && typeof c === "object") c.parentNode = node;
    });
    return node;
  }

  function text(value) {
    return { nodeType: 3, nodeValue: value };
  }

  it("rewrites an orientation-material anchor and its label", () => {
    const hr = loadLinks(bareWindow());
    const a = el("a", { href: "https://drive.google.com/file/d/" + OLD_ID + "/view" }, [
      el("span", { class: "pill" }, [text("video")]),
      text("CORCONDEV Onboarding"),
    ]);
    assert.equal(hr.rewriteElement(a), true);
    assert.equal(a.getAttribute("href"), NEW_URL);
    assert.equal(a.childNodes[1].nodeValue, "CORCONDEV Onboarding (2026)");
  });

  it("does not rename the narrated deck", () => {
    const hr = loadLinks(bareWindow());
    const a = el(
      "a",
      { href: "https://docs.google.com/presentation/d/1sUCeZ8J4bFg36G9nE3o-vUntq3Q-8NRcN54WpZi8tO0/edit" },
      [text("CORCONDEV Onboarding (with audio)")]
    );
    assert.equal(hr.rewriteElement(a), false);
    assert.equal(a.childNodes[0].nodeValue, "CORCONDEV Onboarding (with audio)");
  });

  it("rewrites the href on click capture so a leftover old link still opens the new file", () => {
    const a = el("a", { href: "https://drive.google.com/file/d/" + OLD_ID + "/view" }, [
      text("CORCONDEV Onboarding"),
    ]);
    const listeners = [];
    const w = bareWindow();
    w.document = {
      readyState: "complete",
      documentElement: {
        getAttribute() {
          return null;
        },
        setAttribute() {},
      },
      addEventListener(type, fn, capture) {
        listeners.push({ type, fn, capture });
      },
    };
    const hr = loadLinks(w);
    hr.install();
    const click = listeners.find((x) => x.type === "click" && x.capture);
    assert.ok(click, "capture-phase click listener");
    click.fn({ target: a });
    assert.equal(a.getAttribute("href"), NEW_URL);
    assert.equal(a.childNodes[0].nodeValue, "CORCONDEV Onboarding (2026)");
  });

  it("rewrites matching anchors found in a tree", () => {
    const hr = loadLinks(bareWindow());
    const oldA = el("a", { href: "https://drive.google.com/file/d/" + OLD_ID + "/view" });
    const purchA = el("a", { href: "https://drive.google.com/file/d/" + PURCHASER_ID + "/view" });
    const nodes = [oldA, purchA];
    const doc = {
      querySelectorAll(sel) {
        if (String(sel).indexOf("a[href]") === -1) return [];
        return nodes;
      },
    };
    assert.equal(hr.rewriteTree(doc), 1);
    assert.equal(oldA.getAttribute("href"), NEW_URL);
    assert.match(purchA.getAttribute("href"), new RegExp(PURCHASER_ID));
  });
});
