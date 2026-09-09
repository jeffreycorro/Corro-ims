"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { formatManilaIso } = require("../netlify/lib/manila");

describe("placeholder and privacy", () => {
  it("injects the shim before the artifact scripts and does not add host seed data", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "../public/index.html"),
      "utf8"
    );
    assert.match(html, /<script src="\/claude-shim\.js"><\/script>/);
    assert.match(html, /<script src="\/pwa\.js"><\/script>/);
    assert.match(html, /<link rel="manifest" href="\/manifest\.json">/);
    assert.match(html, /<link rel="stylesheet" href="\/pwa\.css">/);
    const shimIndex = html.indexOf("/claude-shim.js");
    const pwaIndex = html.indexOf("/pwa.js");
    assert.ok(shimIndex > -1 && pwaIndex > shimIndex, "pwa.js must load after the shim");
    assert.doesNotMatch(html, /hr-dictation\.js/);
    assert.doesNotMatch(html, /hr-memo\.js/);
    const hostFiles = [
      "../public/claude-shim.js",
      "../.env.example",
    ].map((rel) => fs.readFileSync(path.join(__dirname, rel), "utf8"));
    for (const src of hostFiles) {
      assert.doesNotMatch(src, /Juan Dela Cruz|fake employee/i);
    }
  });

  it("README tells the operator to inject the shim script tag", () => {
    const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
    assert.match(readme, /<script src="\/claude-shim\.js"><\/script>/);
    assert.match(readme, /SEPARATE Netlify site/);
    assert.match(readme, /Disable Deploy Previews/);
    assert.match(readme, /never commit backup/i);
    assert.match(readme, /ANTHROPIC_API_KEY/);
    assert.match(readme, /GOOGLE_SERVICE_ACCOUNT_JSON/);
    assert.match(readme, /GOOGLE_DRIVE_DELEGATED_USER/);
    assert.match(readme, /Add to Home Screen/);
    assert.match(readme, /<script src="\/pwa\.js"><\/script>/);
    assert.match(readme, /OPENAI_API_KEY/);
    assert.match(readme, /hr-dictation\.js/);
    assert.match(readme, /hr-memo\.js/);
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
