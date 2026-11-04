#!/usr/bin/env node
"use strict";

/**
 * Read-only. Lists liquidated VRFs whose peso variance is above 50%.
 *
 *   node scripts/liquidation-variance-report.js snapshot.json
 *
 * snapshot.json:
 *   { "issued": { "numbers": {} }, "reserves": [], "vrfs": [] }
 *
 * Does not connect to Supabase and does not write. The same list is
 * GET /.netlify/functions/liquidation-variance-report with the approve secret.
 */

const fs = require("fs");
const path = require("path");
const { liquidationVarianceReport } = require("../netlify/lib/liquidation-variance");

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/liquidation-variance-report.js snapshot.json");
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const report = liquidationVarianceReport(spec);
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
