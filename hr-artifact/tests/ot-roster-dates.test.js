"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

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

function sheetContext() {
  const status = { value: "Present", dataset: { dms: "e1" } };
  const ot = { value: "6", dataset: { dmot: "e1" } };
  const marker = { getAttribute: (n) => (n === "data-dmdate" ? "2026-09-12" : null) };
  const byAttr = {
    "data-dmr": { value: "" },
    "data-dmin": { value: "8:00 AM" },
    "data-dmout": { value: "5:00 PM" },
    "data-dmot": ot,
    "data-dmday": { value: "" },
  };
  const document = {
    querySelector(sel) {
      if (sel === "#view [data-dmdate]") return marker;
      if (sel === "#view [data-dms]") return status;
      const m = String(sel).match(/\[(data-[\w]+)="([^"]+)"\]/);
      if (!m || m[2] !== "e1") return null;
      return byAttr[m[1]] || null;
    },
    getElementById() { return null; },
  };
  const ctx = {
    S: {
      settings: {},
      ui: { dailyDate: "2026-09-13", view: "daily" },
      daily: {
        d20260912: {
          id: "d20260912",
          date: "2026-09-12",
          rows: { e1: { s: "Present", ot: null, site: "Danlag" } },
        },
        d20260913: {
          id: "d20260913",
          date: "2026-09-13",
          rows: { e1: { s: "Present", ot: null, site: "Tagba-o" } },
        },
      },
    },
    TODAY: "2026-09-26",
    document,
    $$(sel) {
      if (sel === "[data-dms]") return [status];
      return [];
    },
    clone(o) { return JSON.parse(JSON.stringify(o)); },
    slimDailyRecord() { return false; },
    statusNeedsReason() { return false; },
    reasonByKey() { return null; },
    holCode() { return 0; },
    persistRosterOnDay(rec) { return rec; },
    dailyDiff(before, after) {
      const same = JSON.stringify((before && before.rows) || {}) === JSON.stringify((after && after.rows) || {});
      return same ? [] : [{ id: "e1", f: "ot" }];
    },
  };
  ctx.dailyGet = (d) => ctx.S.daily["d" + String(d).replace(/-/g, "")] || null;
  const src = ["dailyId", "dailyBlank", "parseOtHours", "dailySheetDate", "dailyCollect", "captureDailyForm"]
    .map((name) => extractFunction(html, name))
    .join("\n");
  vm.runInNewContext(src, ctx);
  return ctx;
}

describe("OT stays on the day it was typed", () => {
  it("stamps the build and wires the sheet date ahead of the picker", () => {
    assert.match(html, /const BUILD = "2026-09-26c"/);
    assert.match(html, /id="dm-sheet" data-dmdate="/);
    assert.match(extractFunction(html, "dailyCollect"), /const d=dailySheetDate\(\)/);
    const open = extractFunction(html, "openDailyDate");
    assert.ok(open.indexOf("captureDailyForm") < open.indexOf("S.ui.dailyDate=next"));
    assert.match(html, /function openDailyDate\(/);
    assert.match(html, /if\(!existed\) next\.ot=null/);
    assert.match(html, /dd\.onchange=\(\)=>\{ openDailyDate\(dd\.value\)/);
  });

  it("writes the open grid's OT onto the stamped day when the picker has already moved", () => {
    const ctx = sheetContext();
    const rec = ctx.dailyCollect();
    assert.equal(rec.date, "2026-09-12");
    assert.equal(rec.id, "d20260912");
    assert.equal(rec.rows.e1.ot, 6);
    assert.equal(rec.rows.e1.in, "8:00 AM");
    assert.equal(ctx.S.daily.d20260913.rows.e1.ot, null, "Sept 13 is not given Sept 12's OT");
    assert.equal(ctx.S.ui.dailyDate, "2026-09-13");

    ctx.captureDailyForm();
    assert.equal(ctx.S.daily.d20260912.rows.e1.ot, 6);
    assert.equal(ctx.S.daily.d20260912._dmDirty, true);
    assert.equal(ctx.S.daily.d20260913.rows.e1.ot, null);
    assert.equal(ctx.S.daily.d20260913.rows.e1.site, "Tagba-o");
  });

  it("leaves a blank OT cell blank and keeps a typed zero", () => {
    const ctx = sheetContext();
    assert.equal(ctx.parseOtHours(""), null);
    assert.equal(ctx.parseOtHours("0"), 0);
    const marker = ctx.document.querySelector("#view [data-dmdate]");
    assert.equal(marker.getAttribute("data-dmdate"), "2026-09-12");
    assert.equal(ctx.dailySheetDate(), "2026-09-12");
  });
});
