#!/usr/bin/env node
"use strict";

/**
 * Keep the live-site head companions when swapping in a Claude HTML export.
 * Usage: node scripts/inject-index-companions.js [source.html] [dest.html]
 */

const fs = require("fs");
const path = require("path");

const COMPANIONS = [
  '<script src="/claude-shim.js"></script>',
  '<link rel="manifest" href="/manifest.json">',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<link rel="stylesheet" href="/pwa.css">',
  '<script src="/pwa.js"></script>',
];

const STRIP = [
  /<script[^>]+src=["']\/claude-shim\.js["'][^>]*>\s*<\/script>\s*/gi,
  /<link[^>]+href=["']\/manifest\.json["'][^>]*>\s*/gi,
  /<link[^>]+href=["']\/favicon\.svg["'][^>]*>\s*/gi,
  /<link[^>]+rel=["']icon["'][^>]*>\s*/gi,
  /<link[^>]+href=["']\/apple-touch-icon\.png["'][^>]*>\s*/gi,
  /<link[^>]+href=["']\/pwa\.css["'][^>]*>\s*/gi,
  /<script[^>]+src=["']\/pwa\.js["'][^>]*>\s*<\/script>\s*/gi,
];

function injectHeadCompanions(html) {
  let out = String(html || "");
  for (const re of STRIP) out = out.replace(re, "");
  const block = COMPANIONS.join("");
  if (/<head\b[^>]*>/i.test(out)) {
    return out.replace(/<head\b[^>]*>/i, (open) => `${open}${block}`);
  }
  return `<!doctype html><html><head>${block}</head><body>${out}</body></html>`;
}

function main() {
  const src = process.argv[2];
  const dest = process.argv[3] || path.join(__dirname, "../public/index.html");
  if (!src) {
    console.error("Usage: node scripts/inject-index-companions.js <source.html> [dest.html]");
    process.exit(1);
  }
  const html = fs.readFileSync(src, "utf8");
  const next = injectHeadCompanions(html);
  fs.writeFileSync(dest, next);
  console.log(`Wrote ${dest} (${next.length} bytes) with head companions.`);
}

if (require.main === module) main();

module.exports = { COMPANIONS, injectHeadCompanions };
