"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "../public");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const src = fs.readFileSync(path.join(root, "hr-project-pay.js"), "utf8");
const fix = require("../public/hr-forms-fix");

/* Sites on live daily docs dYYYYMMDD rows[].site, 2026-11-10. */
const DAILY_SITES = [
  "ADMINS",
  "UP She Shelter",
  "CTU Barili",
  "Tagba-o",
  "Labangon Chapel",
  "Tawason",
  "Admins 2",
  "CTU Dumanjug (HM P2)",
  "Danao SPLPA",
  "Tawason Yard 2",
  "Banawa",
  "Danlag",
  "Balaga"
];

function load() {
  const ctx = { console: console };
  vm.runInNewContext(src, ctx);
  return ctx;
}

function sorted(names) {
  return names.slice().sort((a, b) => String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "variant" }));
}

describe("2026-11-10a site list includes Admins 2", () => {
  it("is build 2026-11-10b and the area dropdown still allows a new area", () => {
    assert.match(html, /const BUILD = "2026-11-10b"/);
    assert.match(html, /function dailySites\(\)/);
    assert.match(html, /paySiteChoices\(/);
    assert.match(html, /dailyProjectSelectHtml\(dailySiteOf\(rec,e\)\)/);
    assert.match(html, /sel\.value==="__new"/);
    assert.match(src, /<option value="__new">\+ new area…<\/option>/);
    assert.match(src, /employeeSites/);
  });

  it("the canonical project list from PR #167 omits Admins 2 and Tawason Yard 2", () => {
    const ctx = load();
    const canonical = ctx.PAY_CANONICAL_PROJECTS.slice();
    assert.ok(canonical.includes("ADMINS"));
    assert.ok(canonical.includes("Tawason"));
    assert.equal(canonical.includes("Admins 2"), false);
    assert.equal(canonical.includes("Tawason Yard 2"), false);
    const missing = DAILY_SITES.filter((name) => !canonical.includes(name));
    assert.deepEqual(missing.sort(), ["Admins 2", "Tawason Yard 2"]);
  });

  it("builds the union of configured projects, daily sites, and the 201 area, exactly", () => {
    const ctx = load();
    const names = ctx.paySiteChoices({
      projects: [
        { name: "CTU Dumanjug P3", status: "Active" },
        { name: "Danao Guinacot", status: "Closed" },
        { name: "ADMINS", status: "Active" }
      ],
      dailySites: DAILY_SITES.concat(["Admins 2", "CTU BARILI"]),
      employeeSites: ["Admins 2", "Admins", "Virgelio Site"],
      confirmed: {}
    });
    DAILY_SITES.forEach((name) => assert.ok(names.includes(name), name));
    assert.ok(names.includes("CTU Dumanjug P3"));
    assert.ok(names.includes("Danao Guinacot"));
    assert.ok(names.includes("CTU BARILI"));
    assert.ok(names.includes("Admins"));
    assert.ok(names.includes("Virgelio Site"));
    assert.equal(names.filter((n) => n === "Admins 2").length, 1);
    assert.equal(names.filter((n) => n === "ADMINS").length, 1);
    assert.deepEqual(names, sorted(names));
    assert.equal(ctx.payResolveSite("Admins 2", {}), "Admins 2");
    assert.equal(ctx.payResolveSite("Tawason Yard 2", {}), "Tawason Yard 2");
    assert.equal(ctx.payResolveSite("CTU BARILI", {}), "CTU BARILI");
    assert.equal(ctx.payResolveSite("Admins", {}), "Admins");
    assert.equal(ctx.payResolveSite("  ", {}), "Unassigned");
  });

  it("merges a site only when that alias is ticked, and does not rewrite the row", () => {
    const ctx = load();
    const off = ctx.paySiteChoices({
      dailySites: ["Admins 2", "Tawason Yard 2", "ADMINS", "Tawason"],
      confirmed: {}
    });
    assert.ok(off.includes("Admins 2"));
    assert.ok(off.includes("Tawason Yard 2"));
    const on = ctx.paySiteChoices({
      dailySites: ["Admins 2", "Tawason Yard 2", "ADMINS", "Tawason"],
      confirmed: { "admins 2": true }
    });
    assert.equal(on.includes("Admins 2"), false);
    assert.ok(on.includes("ADMINS"));
    assert.ok(on.includes("Tawason Yard 2"));
    assert.ok(on.includes("Tawason"));
    const row = { site: "Admins 2", s: "Present" };
    assert.equal(ctx.payResolveSite(row.site, { confirmed: { "admins 2": true } }), "ADMINS");
    assert.equal(ctx.payResolveSite("Tawason Yard 2", { confirmed: { "admins 2": true } }), "Tawason Yard 2");
    assert.equal(row.site, "Admins 2");
    const line = {
      empId: "eVir", days: 2, ot: 0, otPay: 0, basic: 1000, gross: 1000, late: 0, ded: 0, net: 1000, daily: 500,
      rows: [
        { date: "2026-11-09", site: "Tawason", day: 1, ot: 0 },
        { date: "2026-11-10", site: "Admins 2", day: 1, ot: 0 }
      ]
    };
    const summary = ctx.payProjectSummary([line], {});
    assert.equal(summary.sites.find((s) => s.site === "Admins 2").days, 1);
    assert.equal(summary.sites.find((s) => s.site === "Tawason").days, 1);
    assert.equal(line.rows[1].site, "Admins 2");
  });

  it("offers Admins 2 on the daily area dropdown and the bulk assign list, with a way to type a new area", () => {
    const ctx = load();
    const opts = {
      projects: [{ name: "Tawason", status: "Active" }],
      dailySites: DAILY_SITES,
      employeeSites: ["Tawason", "Admins 2"],
      confirmed: {}
    };
    const htmlOpts = ctx.dailyProjectSelectHtml("Tawason", opts);
    assert.match(htmlOpts, /<option selected>Tawason<\/option>/);
    assert.match(htmlOpts, /<option>Admins 2<\/option>/);
    assert.match(htmlOpts, /<option>Tawason Yard 2<\/option>/);
    DAILY_SITES.forEach((name) => {
      assert.match(htmlOpts, new RegExp("<option(?: selected)?>" + name.replace(/[()]/g, "\\$&") + "</option>"));
    });
    assert.match(htmlOpts, /value="__new"/);
    const current = ctx.dailyProjectSelectHtml("Admins 2", opts);
    assert.match(current, /<option selected>Admins 2<\/option>/);
    const kept = ctx.dailyProjectSelectHtml("Admins 2", Object.assign({}, opts, { confirmed: { "admins 2": true } }));
    assert.match(kept, /value="Admins 2"/);
    assert.match(kept, /<option>ADMINS<\/option>/);
    ctx.dailySites = function () {
      return ctx.paySiteChoices(opts);
    };
    let shown = [];
    ctx.openDailyBulkAssign({
      people: [{ id: "e1", empNo: "1001", name: "Virgelio" }],
      projects: opts.projects,
      date: "2026-11-10",
      openModal: function (modal) { shown = modal.body.match(/<option>[^<]+<\/option>/g) || []; }
    });
    const labels = shown.map((s) => s.replace(/<\/?option>/g, ""));
    assert.ok(labels.includes("Admins 2"));
    assert.ok(labels.includes("Tawason Yard 2"));
    assert.deepEqual(labels, sorted(labels));
  });

  it("reads daily rows and the 201 project and site when those stores are in scope", () => {
    const ctx = load();
    ctx.S = {
      settings: {},
      projects: { p1: { id: "p1", name: "Tagba-o", status: "Active" } },
      employees: {
        e1: { id: "e1", project: "Admins 2", site: "Office Annex" }
      },
      daily: {
        d20261109: { id: "d20261109", date: "2026-11-09", rows: { e1: { site: "Tawason Yard 2" } } }
      }
    };
    const names = ctx.paySiteChoices(ctx.payChoiceOpts({}));
    assert.ok(names.includes("Admins 2"));
    assert.ok(names.includes("Tawason Yard 2"));
    assert.ok(names.includes("Office Annex"));
    assert.ok(names.includes("Tagba-o"));
    assert.ok(names.includes("ADMINS"));
    const picked = ctx.dailyProjectSelectHtml("Tawason Yard 2");
    assert.match(picked, /<option selected>Tawason Yard 2<\/option>/);
    assert.match(picked, /<option>Admins 2<\/option>/);
    assert.match(picked, /<option>Office Annex<\/option>/);
  });

  it("does not let the forms-fix picker drop Admins 2 or fold it into ADMINS", () => {
    const host = {
      S: {
        projects: { p1: { name: "ADMINS" } },
        employees: { e1: { project: "Admins 2" }, e2: { project: "Tawason" } },
        daily: { d1: { date: "2026-11-10", rows: { e2: { site: "Tawason Yard 2" } } } },
        advances: {},
        leaves: {},
        settings: {}
      },
      paySiteChoices: load().paySiteChoices,
      payAliasConfirmedMap: load().payAliasConfirmedMap,
      dailySites: function () {
        return ["ADMINS", "Admins 2", "Tawason", "Tawason Yard 2"];
      },
      projOpts: function () { return "<option>Tawason</option>"; },
      projectNames: function () { return ["Tawason"]; },
      document: { readyState: "complete", addEventListener() {}, getElementById() { return null; }, createElement() { return {}; } }
    };
    fix.patchGlobals(host);
    const sites = host.dailySites();
    assert.ok(sites.includes("Admins 2"));
    assert.ok(sites.includes("ADMINS"));
    assert.ok(sites.includes("Tawason Yard 2"));
    const opts = host.projOpts("Tawason");
    assert.match(opts, />Admins 2</);
    assert.match(opts, />Tawason Yard 2</);
    assert.match(opts, />ADMINS</);
    const names = host.projectNames();
    assert.ok(names.includes("Admins 2"));
    assert.ok(names.includes("Tawason Yard 2"));
    assert.equal(names.filter((n) => n === "Admins 2").length, 1);
  });
});
