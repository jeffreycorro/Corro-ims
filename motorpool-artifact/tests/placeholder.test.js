"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { formatManilaIso } = require("../netlify/lib/manila");

describe("placeholder and host", () => {
  it("hosts the Claude artifact with the shim first and no parallel app.js", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "../public/index.html"),
      "utf8"
    );
    assert.match(html, /<script src="\/claude-shim\.js"><\/script>/);
    assert.match(html, /<script src="\/pwa\.js"><\/script>/);
    assert.match(html, /<title>Corcondev Motorpool<\/title>/);
    const shimIndex = html.indexOf("/claude-shim.js");
    const titleIndex = html.indexOf("Corcondev Motorpool");
    const pwaIndex = html.indexOf("/pwa.js");
    assert.ok(shimIndex > -1 && shimIndex < titleIndex, "shim must load before the artifact");
    assert.ok(pwaIndex > shimIndex);
    assert.doesNotMatch(html, /\/js\/app\.js/);
    assert.doesNotMatch(html, /motorpool-host\.js/);
    const shim = fs.readFileSync(
      path.join(__dirname, "../public/claude-shim.js"),
      "utf8"
    );
    assert.match(shim, /motorpool-host\.js/);
  });

  it("README tells the operator how to replace the Claude export and redeploy", () => {
    const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
    assert.match(readme, /<script src="\/claude-shim\.js"><\/script>/);
    assert.match(readme, /SEPARATE Netlify site/);
    assert.match(readme, /Disable Deploy Previews/);
    assert.match(readme, /public\/index\.html/);
    assert.match(readme, /MOTORPOOL_OFFICE_PASS_HASH/);
    assert.match(readme, /corcondev-motorpool/);
    assert.match(readme, /Do not rewrite/);
    assert.match(readme, /Redeploy when the artifact HTML is updated/);
    assert.match(readme, /move it to public\/index\.html/);
    assert.match(readme, /publish directory is `public`/);
  });

  it("public/ has no parallel from-scratch Motorpool UI", () => {
    const pub = path.join(__dirname, "../public");
    assert.equal(fs.existsSync(path.join(pub, "js/app.js")), false);
    assert.equal(fs.existsSync(path.join(pub, "js/db.js")), false);
    assert.equal(fs.existsSync(path.join(pub, "css/app.css")), false);
    assert.equal(fs.existsSync(path.join(__dirname, "../index.html")), false);
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
