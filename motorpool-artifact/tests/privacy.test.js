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

describe("privacy and host rules", () => {
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

  it("host companion blocks prompt, confirm, alert, and print", () => {
    const host = fs.readFileSync(
      path.join(__dirname, "../public/motorpool-host.js"),
      "utf8"
    );
    assert.match(host, /window\.prompt\s*=/);
    assert.match(host, /window\.confirm\s*=/);
    assert.match(host, /window\.alert\s*=/);
    assert.match(host, /window\.print\s*=/);
  });

  it("artifact keeps the house teal token and is light-only", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "../public/index.html"),
      "utf8"
    );
    assert.match(html, /#2aa0c0/);
    assert.match(html, /light-only/);
  });
});
