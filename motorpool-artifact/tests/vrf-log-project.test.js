"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  let start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  if (src.slice(start - 6, start) === "async ") start -= 6;
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

function loadApi() {
  const names = [
    "normProj",
    "projectStatusOf",
    "asProject",
    "projectOptionLabel",
    "vrfBilledProjectCodes",
    "vrfLogProjectIndex",
    "vrfLogProjects",
    "vrfLogProjectText",
    "vrfLogTextHit",
  ];
  const ctx = {
    PROJ_ALIAS: {
      "Labangon - LP Balaga": "26HH0083 - Labangon",
      "CTU Ved Med": "CTU-Barili Vet Med",
      "UP She Shelter": "UP- She Shelter",
    },
    S: { projects: [], reserves: [] },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

const api = loadApi();

describe("VRF log project label", () => {
  it("shows a dash when the form, its lines, and its reserve have no project", () => {
    const idx = { labels: {}, reserves: {} };
    assert.equal(api.vrfLogProjectText({ vrf: "6101", project: "", rows: [{}] }, idx), "—");
    assert.equal(api.vrfLogProjectText({ vrf: "6102", project: "   ", rows: [{ project: "" }] }, idx), "—");
    assert.equal(api.vrfLogProjectText(null, idx), "—");
  });

  it("folds a stored nickname onto the pick-list name", () => {
    const idx = { labels: { "CTU-Barili Vet Med": "CTU-Barili Vet Med" }, reserves: {} };
    assert.equal(
      api.vrfLogProjectText({ project: "CTU Ved Med", rows: [] }, idx),
      "CTU-Barili Vet Med"
    );
    assert.equal(
      api.vrfLogProjectText({ project: "Labangon - LP Balaga", rows: [{ project: "26HH0083 - Labangon" }] }, idx),
      "26HH0083 - Labangon"
    );
  });

  it("uses the pick-list label when the name differs from the code", () => {
    api.S.projects = [{ code: "HH-STAFF-2026", name: "Staff housing", status: "Active" }];
    api.S.reserves = [];
    const idx = api.vrfLogProjectIndex();
    assert.equal(
      api.vrfLogProjectText({ project: "HH-STAFF-2026", rows: [] }, idx),
      "HH-STAFF-2026 — Staff housing"
    );
  });

  it("lists each billed project already on the form, without a second read", () => {
    const idx = { labels: {}, reserves: { "4": "Pardo Wharf" } };
    assert.equal(
      api.vrfLogProjectText(
        {
          project: "",
          rows: [{ project: "Danao Guinacot" }, { project: "Pardo Wharf" }, { project: "Danao Guinacot" }],
        },
        idx
      ),
      "Danao Guinacot · Pardo Wharf"
    );
  });

  it("uses the reserve project only when the form itself has none", () => {
    const idx = { labels: {}, reserves: { "9": "Pardo Wharf" } };
    assert.equal(
      api.vrfLogProjectText({ project: "", reserve: "9", rows: [{ project: "" }] }, idx),
      "Pardo Wharf"
    );
    assert.equal(
      api.vrfLogProjectText({ project: "Yard", reserve: "9", rows: [] }, idx),
      "Yard"
    );
  });

  it("matches a project search against the pick-list label and a line project", () => {
    const idx = {
      labels: { "HH-STAFF-2026": "HH-STAFF-2026 — Staff housing" },
      reserves: {},
    };
    const housed = { project: "HH-STAFF-2026", units: ["DT-03"], rows: [{ item: "bolt" }] };
    assert.equal(api.vrfLogTextHit(housed, "staff housing", idx), true);
    assert.equal(api.vrfLogTextHit(housed, "dt-03", idx), true);
    const lined = { project: "", units: ["SV-19"], rows: [{ project: "Danao Guinacot", item: "hose" }] };
    assert.equal(api.vrfLogTextHit(lined, "danao", idx), true);
    assert.equal(api.vrfLogTextHit(lined, "battery", idx), false);
  });
});

describe("artifact HTML — VRF log shows the billed project", () => {
  const logStart = html.indexOf("function vrfLogView");
  const logEnd = html.indexOf("/* ---- job & parts history", logStart);
  const log = html.slice(logStart, logEnd);

  it("adds Project on the log table and keeps the other columns and print", () => {
    assert.ok(logStart > 0 && logEnd > logStart);
    assert.match(log, /h:"Project"/);
    assert.match(log, /vrf-log-project/);
    assert.match(log, /vrfLogProjectText/);
    ["VRF", "Date", "Unit", "Odometer", "Jobs", "Lines", "Total", "Files"].forEach((col) => {
      assert.match(log, new RegExp('h:"' + col + '"'));
    });
    assert.match(log, /get:vrfLogStatus/);
    assert.match(log, /printVrfNo\(v\)/);
    assert.match(log, /el\("button","btn sm","Print"\)/);
    assert.match(html, /\.vrf-log-project\{display:block;max-width:14rem/);
    assert.match(html, /@media\(max-width:900px\)\{[\s\S]*\.vrf-log-project\{max-width:9\.5rem\}/);
    assert.match(html, /\["Project",entry\.project\|\|"—"\]/);
  });

  it("does not fetch a project per row", () => {
    assert.doesNotMatch(log, /await /);
    assert.doesNotMatch(log, /readDoc\(/);
    assert.doesNotMatch(log, /fetch\(/);
    const labelFn = extractFunction(html, "vrfLogProjectText");
    assert.doesNotMatch(labelFn, /readDoc|fetch|S\.db/);
    const indexFn = extractFunction(html, "vrfLogProjectIndex");
    assert.match(indexFn, /S\.projects/);
    assert.match(indexFn, /S\.reserves/);
    assert.doesNotMatch(indexFn, /readDoc|fetch|for\s*\(/);
  });
});
