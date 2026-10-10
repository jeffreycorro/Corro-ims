#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { createMemoryStore } = require("../../netlify/lib/memory-store");
const { sheetsToDoc } = require("./doc");
const { applyImport } = require("./load");
const { reconciliation } = require("./reconcile");
const { readWorkbook } = require("./xlsx");

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  return process.argv[index + 1] || "";
}

function sheetsOf(file) {
  if (!file) return null;
  if (!fs.existsSync(file)) {
    console.error(`Missing workbook: ${file}`);
    process.exitCode = 1;
    return null;
  }
  return readWorkbook(path.resolve(file));
}

async function main() {
  const pettyFile = arg("--petty");
  const checksFile = arg("--checks");
  const gcashFile = arg("--gcash");
  const billsFile = arg("--bills");
  if (!pettyFile && !checksFile && !gcashFile && !billsFile) {
    console.log("No workbooks passed. Usage: node scripts/import/run.js --petty CCD-03.xlsx --checks CCD-04.xlsx --gcash gcash.xlsx --bills bills.xlsx");
    console.log("Reconciliation targets stay in scripts/import/reconcile.js and the test suite. A missing export does not fail the import.");
    return;
  }
  const pettySheets = pettyFile ? sheetsOf(pettyFile) : null;
  const checkSheets = checksFile ? sheetsOf(checksFile) : null;
  const gcashSheets = gcashFile ? sheetsOf(gcashFile) : null;
  const billSheets = billsFile ? sheetsOf(billsFile) : null;
  if (process.exitCode) return;
  const doc = sheetsToDoc({
    petty: pettySheets,
    checks: checkSheets,
    gcash: gcashSheets,
    bills: billSheets,
    defaultYear: Number(arg("--year")) || 2026,
  });
  const store = createMemoryStore();
  const loaded = await applyImport(store, doc);
  const report = await reconciliation(store);
  console.log(JSON.stringify({ loaded: { petty: loaded.petty, checks: loaded.checks, gcash: loaded.gcash, bills: loaded.bills }, issues: (loaded.issues || []).length, report }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
