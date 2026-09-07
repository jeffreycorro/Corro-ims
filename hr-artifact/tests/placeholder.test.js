"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { formatManilaIso } = require("../netlify/lib/manila");

describe("placeholder and privacy", () => {
  it("does not invent an HR app or employee seed data", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "../public/index.html"),
      "utf8"
    );
    assert.match(html, /Replace this entire file with the Claude artifact HTML export/);
    assert.match(html, /<script src="\/claude-shim\.js"><\/script>/);
    assert.doesNotMatch(html, /employee seed|Juan Dela Cruz|fake employee/i);
    assert.ok(html.length < 2000);
  });

  it("README tells the operator to inject the shim script tag", () => {
    const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
    assert.match(readme, /<script src="\/claude-shim\.js"><\/script>/);
    assert.match(readme, /SEPARATE Netlify site/);
    assert.match(readme, /Disable Deploy Previews/);
    assert.match(readme, /never commit backup/i);
  });

  it("netlify.toml publishes public with privacy headers", () => {
    const toml = fs.readFileSync(path.join(__dirname, "../netlify.toml"), "utf8");
    assert.match(toml, /publish = "public"/);
    assert.match(toml, /X-Robots-Tag = "noindex, nofollow"/);
    assert.match(toml, /X-Frame-Options = "DENY"/);
    assert.match(toml, /Referrer-Policy = "no-referrer"/);
    assert.match(toml, /\[context\.deploy-preview\]/);
    assert.match(toml, /ignore = "exit 0"/);
  });

  it("formats timestamps in Asia/Manila", () => {
    const iso = formatManilaIso(new Date("2026-09-07T00:00:00Z"));
    assert.match(iso, /2026-09-07T08:00:00\+08:00/);
  });
});
