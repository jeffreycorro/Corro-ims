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
    assert.match(html, /const BUILD = "2026-09-16b"/);
    assert.doesNotMatch(html, /hr-dictation\.js/);
    assert.doesNotMatch(html, /hr-memo\.js/);
    assert.doesNotMatch(html, /<script[^>]+hr-attendance\.js/);
    assert.doesNotMatch(html, /<script[^>]+hr-payroll\.js/);
    assert.doesNotMatch(html, /hr-tts\.js/);
    assert.doesNotMatch(html, /hr-recruit\.js/);
    assert.doesNotMatch(html, /hr-applicant-dedupe\.js/);
    assert.doesNotMatch(html, /hr-201-file\.js/);
    assert.doesNotMatch(html, /hr-leave-numbers\.js/);
    assert.doesNotMatch(html, /hr-onboarding-links\.js/);
    const shim = fs.readFileSync(
      path.join(__dirname, "../public/claude-shim.js"),
      "utf8"
    );
    assert.doesNotMatch(shim, /hr-attendance\.js/);
    assert.doesNotMatch(shim, /hr-payroll\.js/);
    assert.match(shim, /hr-tts\.js/);
    assert.match(shim, /hr-applicant-dedupe\.js/);
    assert.match(shim, /hr-recruit\.js/);
    assert.match(shim, /hr-201-file\.js/);
    assert.match(shim, /hr-leave-numbers\.js/);
    assert.match(shim, /hr-onboarding-links\.js/);
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
    assert.match(readme, /4KB/);
    assert.match(readme, /hr-secrets/);
    assert.match(readme, /Builds only/);
    assert.match(readme, /HR_SESSION_SECRET/);
    assert.match(readme, /GOOGLE_DRIVE_DELEGATED_USER/);
    assert.match(readme, /Add to Home Screen/);
    assert.match(readme, /<script src="\/pwa\.js"><\/script>/);
    assert.match(readme, /OPENAI_API_KEY/);
    assert.match(readme, /hr-dictation\.js/);
    assert.match(readme, /hr-memo\.js/);
    assert.match(readme, /hr-attendance\.js/);
    assert.match(readme, /hr-payroll\.js/);
    assert.match(readme, /hr-tts\.js/);
    assert.match(readme, /hr-applicant-dedupe\.js/);
    assert.match(readme, /hr-recruit\.js/);
    assert.match(readme, /hr-201-file\.js/);
    assert.match(readme, /hr-leave-numbers\.js/);
    assert.match(readme, /hr-onboarding-links\.js/);
    assert.match(readme, /2026-09-16b/);
    assert.match(readme, /Renumber leave/);
    assert.match(readme, /20260915000001_lv_unique_leave_numbers/);
    assert.match(readme, /fixLiveDuplicate169/);
    assert.match(readme, /HR_APPLICANTS_INGEST_KEY/);
    assert.match(readme, /ELEVENLABS_API_KEY/);
    assert.match(readme, /same Supabase email \+ password/);
    assert.match(readme, /HR_GATE_REQUIRED/);
    const envDoc = fs.readFileSync(path.join(__dirname, "../docs/netlify-functions-env.md"), "utf8");
    assert.match(envDoc, /4KB/);
    assert.match(envDoc, /HR_APPLICANTS_INGEST_KEY/);
    assert.match(envDoc, /Functions-scoped vs Builds-only/);
    assert.match(envDoc, /HR_GATE_SECRET/);
  });

  it("netlify.toml publishes public with privacy headers", () => {
    const toml = fs.readFileSync(path.join(__dirname, "../netlify.toml"), "utf8");
    assert.match(toml, /prepare-google-sa\.js/);
    assert.match(toml, /@netlify\/blobs/);
    assert.match(toml, /GOOGLE_SERVICE_ACCOUNT_BLOB/);
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
