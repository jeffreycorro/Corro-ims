"use strict";
/* HR 2026-10-27: (1) benefack = agreed; only KASABUTAN (govrefuse/kasabutan) is a refusal.
   (2) SSS / PhilHealth / Pag-IBIG start at 3 months of service; before that 0. */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
function extractFunction(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("missing " + name);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unclosed " + name);
}
function loadIndex() {
  const ctx = { S: { settings: { ded: { sss: 325, phic: 131.25, hdmf: 100 } } }, Number, String, Object, Array, Date, Math, isNaN };
  const names = ["docSlotRefused", "govDeductionRefused", "empStatSet", "empStat",
    "payStatKept", "statServiceStart", "statTenureOk", "payStat", "payStatForLine", "contribSource"];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}
const X = loadIndex();
const agreedDoc = { s: "on", link: "https://drive.example/benefack.pdf" };
const kasabutanDoc = { s: "on", link: "https://drive.example/kasabutan.pdf" };

describe("rule 1: benefack is agreement, KASABUTAN is refusal (index.html)", () => {
  it("benefack alone keeps company defaults", () => {
    const e = { dateHired: "2024-01-16", docs: { benefack: agreedDoc, govrefuse: { s: "na" } } };
    assert.equal(X.govDeductionRefused(e), false);
    assert.equal(X.contribSource(e), "company");
    const per = { from: "2026-09-13", to: "2026-09-27" };
    assert.equal(X.payStatForLine("semi", "sss", e, {}, per), 325);
    assert.equal(X.payStatForLine("semi", "phic", e, {}, per), 131.25);
    assert.equal(X.payStatForLine("weekly", "phic", e, {}, per), 65.62);
    assert.equal(X.payStatForLine("weekly", "hdmf", e, {}, per), 50);
  });
  it("benefack plus a KASABUTAN on file is still a refusal", () => {
    for (const k of ["govrefuse", "kasabutan"]) {
      const e = { docs: { benefack: agreedDoc, [k]: kasabutanDoc } };
      assert.equal(X.govDeductionRefused(e), true);
      assert.equal(X.payStatForLine("semi", "sss", e, {}, { from: "2026-09-13", to: "2026-09-27" }), 0);
    }
  });
});

describe("rule 2: contributions start at 3 months of service (index.html)", () => {
  const e = { dateHired: "2026-09-08", ded: { sss: 325, phic: 131.25, hdmf: 100 } };
  it("hired Sep 8: 0 on every cutoff before Dec 8, even with 201 figures", () => {
    assert.equal(X.statServiceStart(e), "2026-12-08");
    for (const per of [{ from: "2026-08-28", to: "2026-09-12" }, { from: "2026-09-13", to: "2026-09-27" },
      { from: "2026-09-28", to: "2026-10-12" }, { from: "2026-11-28", to: "2026-12-07" }]) {
      for (const k of ["sss", "phic", "hdmf"]) assert.equal(X.payStatForLine("semi", k, e, {}, per), 0);
    }
  });
  it("deducts from the cutoff that contains the 3-month date", () => {
    assert.equal(X.payStatForLine("semi", "sss", e, {}, { from: "2026-11-28", to: "2026-12-12" }), 325);
    assert.equal(X.payStatForLine("weekly", "hdmf", e, {}, { from: "2026-12-03", to: "2026-12-09" }), 50);
  });
  it("month-end hire clamps (Nov 30 -> Feb 28)", () => {
    assert.equal(X.statServiceStart({ dateHired: "2026-11-30" }), "2027-02-28");
  });
  it("no hire date on file keeps the old behaviour", () => {
    assert.equal(X.payStatForLine("semi", "sss", {}, {}, { from: "2026-09-13", to: "2026-09-27" }), 325);
  });
  it("a figure HR typed on the run (statTouched) is kept", () => {
    assert.equal(X.payStatForLine("semi", "sss", e, { statTouched: true, sss: 100 }, { from: "2026-09-13", to: "2026-09-27" }), 100);
  });
});

describe("hr-payroll.js and hr-payroll-sheet.js follow the same rules", () => {
  const root = { console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-payroll.js"), "utf8"),
    { window: root, globalThis: root, console, Date, Math, JSON, Intl, Number, String, Object, Array, isNaN });
  const P = root.hrPayroll;
  const settings = { ded: { sss: 325, phic: 131.25, hdmf: 100 } };
  it("hr-payroll.js", () => {
    assert.equal(P.statutoryOf({ docs: { benefack: agreedDoc } }, "semi", settings).sss, 325);
    assert.equal(P.statutoryOf({ dateHired: "2026-09-08" }, "semi", settings, "2026-10-12").sss, 0);
    assert.equal(P.statutoryOf({ dateHired: "2026-09-08" }, "semi", settings, "2026-12-12").sss, 325);
  });
  it("hr-payroll-sheet.js", () => {
    const r2 = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-payroll-sheet.js"), "utf8"),
      { window: r2, globalThis: r2, self: r2, console, Date, Math, JSON, Intl, Number, String, Object, Array, isNaN, RegExp });
    const sheet = r2.hrPaySheet;
    const s = sheet.statutoryOf({ dateHired: "2026-09-08", ded: { sss: 325 } }, "semi", { from: "2026-09-28", to: "2026-10-12" }, settings);
    assert.equal(s.sss, 0);
    assert.equal(s.rule, "under-3-months");
    assert.equal(sheet.statutoryOf({ dateHired: "2026-09-08" }, "semi", { from: "2026-11-28", to: "2026-12-12" }, settings).sss, 325);
  });
});
