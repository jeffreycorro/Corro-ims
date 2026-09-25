"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const attendance = fs.readFileSync(path.join(__dirname, "../public/hr-attendance.js"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

function loadOtFns() {
  const ctx = { S: { settings: {}, daily: {} } };
  const src = ["parseOtHours", "dailySigWeight", "sigBlobSame", "slimDailyRecord"]
    .map((name) => extractFunction(html, name))
    .join("\n");
  vm.runInNewContext(src, ctx);
  return ctx;
}

describe("Daily Manpower OT save", () => {
  it("parses OT without turning a blank cell into zero", () => {
    const ctx = loadOtFns();
    assert.equal(ctx.parseOtHours(""), null);
    assert.equal(ctx.parseOtHours("   "), null);
    assert.equal(ctx.parseOtHours(null), null);
    assert.equal(ctx.parseOtHours("0"), 0);
    assert.equal(ctx.parseOtHours("2.5"), 2.5);
    assert.equal(ctx.parseOtHours("nope"), null);
  });

  it("drops duplicate e-signature blobs and keeps the OT row", () => {
    const ctx = loadOtFns();
    ctx.S.settings = {
      hrSigData: "data:image/png;base64,AAA",
      hrSigLink: "https://drive.example/prepared",
      hrSigs: {
        prepared: { data: "data:image/png;base64,BBB", link: "" },
      },
    };
    const rec = {
      id: "d20260925",
      date: "2026-09-25",
      hrSigData: "data:image/png;base64,AAA",
      hrSigs: {
        prepared: { data: "data:image/png;base64,BBB", link: "" },
        dayonly: { data: "data:image/png;base64,CCC", link: "https://drive.example/day" },
      },
      rows: { e1: { s: "Present", ot: 1.5 } },
    };
    assert.equal(ctx.slimDailyRecord(rec), true);
    assert.equal(rec.hrSigData, undefined);
    assert.equal(rec.hrSigs.prepared, undefined);
    assert.equal(rec.hrSigs.dayonly.link, "https://drive.example/day");
    assert.equal(rec.hrSigs.dayonly.data, undefined);
    assert.equal(rec.rows.e1.ot, 1.5);
    assert.equal(ctx.slimDailyRecord(rec), false);
  });

  it("saves OT from the cell without rebuilding the sheet", () => {
    assert.match(html, /function queueDailyAutosave\(/);
    assert.match(html, /on\("\[data-dmot\]","input", queueDailyAutosave\)/);
    assert.match(html, /id="dm-savestate"/);
    assert.match(html, /OT hours save on their own/);
    const saveAt = html.indexOf('const dms=$("#dm-save"');
    const saveEnd = html.indexOf('const dmp=$("#dm-print"', saveAt);
    assert.ok(saveAt > 0 && saveEnd > saveAt);
    const saveBlock = html.slice(saveAt, saveEnd);
    assert.match(saveBlock, /enqueueDailySave/);
    assert.doesNotMatch(saveBlock, /render\(\)/);
    assert.match(html, /kept\._dmDirty=true/);
    assert.match(html, /if\(local\._dmDirty\) next\._dmDirty=true/);
    assert.match(attendance, /otRaw === "" \? null/);
  });

  it("offers On Hold and Shortlisted on the applicant stage list", () => {
    assert.match(
      html,
      /const STAGES=\["Applied","Screening","Shortlisted","On Hold","Written Exam","Interview","Final Interview","Offer","Hired","Rejected"\]/
    );
  });
});
