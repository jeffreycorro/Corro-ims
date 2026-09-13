"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

describe("privacy and interface rules", () => {
  it("never stores an office pass plaintext and documents only the hash env", () => {
    const root = path.join(__dirname, "..");
    const files = walk(root, []).filter((p) => {
      if (p.includes(`${path.sep}tests${path.sep}`)) return false;
      return /\.(js|md|html|css|toml|example|sql|json)$/.test(p);
    });
    const forbidden = new RegExp("office pass" + "code is", "i");
    const forbiddenPw = new RegExp("the office password" + " is", "i");
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(
        src,
        /MOTORPOOL_OFFICE_PASS\s*=\s*['\"][^'\"]+['\"]/
      );
      assert.doesNotMatch(src, forbidden);
      assert.doesNotMatch(src, forbiddenPw);
    }
    const env = fs.readFileSync(path.join(root, ".env.example"), "utf8");
    assert.match(env, /MOTORPOOL_OFFICE_PASS_HASH=/);
    assert.doesNotMatch(env, /MOTORPOOL_OFFICE_PASS=/);
  });

  it("does not use prompt, confirm, alert, or window.print", () => {
    const app = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
    assert.doesNotMatch(app, /\bprompt\s*\(/);
    assert.doesNotMatch(app, /\bconfirm\s*\(/);
    assert.doesNotMatch(app, /\balert\s*\(/);
    assert.doesNotMatch(app, /window\.print\s*\(/);
  });

  it("is light-only house style with teal brand tokens", () => {
    const css = fs.readFileSync(path.join(__dirname, "../public/css/app.css"), "utf8");
    assert.match(css, /--accent:#2aa0c0/);
    assert.match(css, /--ok:#2f7d55/);
    assert.match(css, /--warn:#9a6b1a/);
    assert.match(css, /--crit:#9c3131/);
    assert.match(css, /--r:4px/);
    assert.doesNotMatch(css, /prefers-color-scheme:dark/);
  });

  it("injects the shim first and publishes with privacy headers", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /<script src="\/claude-shim\.js"><\/script>/);
    const shimIndex = html.indexOf("/claude-shim.js");
    const appIndex = html.indexOf("/js/app.js");
    assert.ok(shimIndex > -1 && appIndex > shimIndex);
    const toml = fs.readFileSync(path.join(__dirname, "../netlify.toml"), "utf8");
    assert.match(toml, /publish = "public"/);
    assert.match(toml, /X-Robots-Tag = "noindex, nofollow"/);
    assert.match(toml, /corcondev-motorpool/);
  });

  it("seeds 39 work types / 10 families", () => {
    const wt = require("../public/js/worktypes.js");
    assert.equal(wt.FAMILIES.length, 10);
    assert.equal(wt.TYPES.length, 39);
  });
});
