"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRecruit(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-recruit.js"), "utf8");
  vm.runInNewContext(src, windowLike);
  return windowLike.hrRecruit;
}

function fakeWindow() {
  const created = [];
  const byId = {};
  const parent = {
    insertBefore(el, _ref) {
      created.push(el);
      if (el.id) byId[el.id] = el;
      return el;
    },
  };
  const newApp = {
    id: "new-app",
    parentNode: parent,
    nextSibling: null,
  };
  byId["new-app"] = newApp;
  const document = {
    getElementById(id) {
      return byId[id] || null;
    },
    createElement(tag) {
      const el = {
        tagName: tag,
        className: "",
        id: "",
        type: "",
        textContent: "",
        onclick: null,
      };
      return el;
    },
    addEventListener() {},
    readyState: "complete",
  };
  const window = {
    document,
    fetch() {
      return Promise.reject(new Error("no fetch in this test"));
    },
  };
  window.window = window;
  window.created = created;
  return window;
}

describe("hr-recruit companion wiring", () => {
  it("is loaded by the shim and not referenced from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-recruit\.js/);
    assert.match(shim, /data-hr-recruit/);
    assert.doesNotMatch(html, /hr-recruit\.js/);
  });
});

describe("hr-recruit paste door", () => {
  it("accepts a wrapped object or a bare array", () => {
    const hr = loadRecruit(fakeWindow());
    const wrapped = hr.parsePaste('{"applicants":[{"name":"Ada"}]}');
    assert.equal(wrapped.applicants.length, 1);
    assert.equal(wrapped.applicants[0].name, "Ada");
    const bare = hr.parsePaste('[{"name":"Ada"}]');
    assert.equal(bare.applicants.length, 1);
    assert.equal(bare.applicants[0].name, "Ada");
    assert.throws(() => hr.parsePaste(""), /Paste/);
    assert.throws(() => hr.parsePaste("{"), /not valid JSON/);
    assert.throws(() => hr.parsePaste("{}"), /applicants/);
  });

  it("injects Bulk import JSON next to Log an applicant", () => {
    const w = fakeWindow();
    const hr = loadRecruit(w);
    const btn = hr.injectButton();
    assert.equal(btn.id, "hr-recruit-bulk");
    assert.match(btn.textContent, /Bulk import JSON/);
    assert.equal(hr.injectButton(), btn);
  });
});
