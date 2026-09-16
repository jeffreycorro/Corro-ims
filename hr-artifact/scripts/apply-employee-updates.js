#!/usr/bin/env node
"use strict";

/**
 * One-shot HR employee patches. NEVER deletes a row.
 *
 *   node scripts/apply-employee-updates.js            # dry-run
 *   node scripts/apply-employee-updates.js --apply    # write
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE (same as the HR Netlify site).
 */

const fs = require("fs");
const path = require("path");
const { listCollection, setDoc } = require("../netlify/lib/supabase");
const { planUpdates } = require("./lib/employee-updates");

const ROOT = path.join(__dirname);
const DATA = path.join(ROOT, "data");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function listEmployees() {
  // Prefer the shared helper. If the project has more than the default
  // PostgREST page size, fall back to ranged GETs.
  const first = await listCollection("employees");
  if (!Array.isArray(first) || first.length < 1000) return first || [];
  const { rest } = require("../netlify/lib/supabase");
  const all = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = await rest({
      method: "GET",
      path: "/rest/v1/docs",
      query:
        `collection=eq.employees&select=collection,id,data,updated_at` +
        `&order=id.asc&offset=${from}&limit=${page}`,
    });
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < page) break;
  }
  return all;
}

function printPlan(plan, apply) {
  console.log(
    apply
      ? "APPLY mode — writing status/ded only. No deletes."
      : "DRY RUN — no writes. Pass --apply to update Supabase."
  );
  console.log(
    `Roster listed ${plan.rosterListed} (unique empNo ${plan.rosterUnique}); ` +
      `matched ${plan.separatedRowHits} employee row(s).`
  );
  console.log(
    `Contributions listed ${plan.contribListed}; matched ${plan.contribRowHits} employee row(s).`
  );
  console.log(`Rows that would change: ${plan.updates.length}`);
  for (const u of plan.updates) {
    const bits = [];
    if (u.fields.status) bits.push(`status=${u.fields.status}`);
    if (u.fields.separatedOn) bits.push(`separatedOn=${u.fields.separatedOn}`);
    if ("ded" in u.fields) bits.push(`ded=${JSON.stringify(u.fields.ded)}`);
    console.log(`  ${u.empNo} ${u.id} ${u.name} → ${bits.join(", ")}`);
  }
  if (plan.missingSeparated.length) {
    console.log(`Roster empNo not found (${plan.missingSeparated.length}):`);
    for (const m of plan.missingSeparated) console.log(`  ${m.empNo} ${m.name}`);
  }
  if (plan.missingContrib.length) {
    console.log(`Contribution empNo not found (${plan.missingContrib.length}):`);
    for (const m of plan.missingContrib) console.log(`  ${m.empNo} ${m.name}`);
  }
}

async function main() {
  const apply = hasFlag("--apply");
  const roster = loadJson("separated-roster-2026-09-16.json");
  const contrib = loadJson("contributions-2026-09-16.json");
  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE are not set in this environment.\n" +
        "Dry-run against production is not possible here. Jeffrey: copy those\n" +
        "from corcondev-hr Netlify env (or the Supabase project) and rerun:\n" +
        "  cd hr-artifact && node scripts/apply-employee-updates.js --apply"
    );
    if (!apply) {
      const emptyPlan = planUpdates(
        [],
        roster.employees || [],
        contrib.employees || []
      );
      console.log(
        `Payload ready: ${emptyPlan.rosterListed} roster rows ` +
          `(${emptyPlan.rosterUnique} unique empNo, including both 1351 listings) ` +
          `and ${emptyPlan.contribListed} contribution rows. No employee table to match.`
      );
    }
    process.exitCode = 2;
    return;
  }

  const rows = await listEmployees();
  const plan = planUpdates(rows, roster.employees || [], contrib.employees || []);
  printPlan(plan, apply);
  if (!apply) return;

  let written = 0;
  for (const u of plan.updates) {
    await setDoc("employees", u.id, u.fields, { merge: true });
    written += 1;
  }
  console.log(`Wrote ${written} employee row(s). None deleted.`);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
