"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  normProjectLabel,
  normalizeIssueSpec,
  normalizeLedgerRows,
  normalizeProjectWrite,
  normalizeReserve,
} = require("../netlify/lib/project-name");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function loadProjectApi() {
  const alias = html.match(/var PROJ_ALIAS = \{[\s\S]*?\};/);
  const norm = html.match(/function normProj\(p\)\{[\s\S]*?\n\}/);
  const block = html.match(
    /\/\* --- project-match:start --- \*\/([\s\S]*?)\/\* --- project-match:end --- \*\//
  );
  assert.ok(alias && norm && block, "project match helpers are marked in index.html");
  const ctx = {};
  vm.runInNewContext(
    `${alias[0]}\n${norm[0]}\n${block[1]}\nresult = {normProjectLabel, projectFoldKey, projectNearMatches, projectNearMessage, planProjectAdd, applyProjectChange, projectDocBody, sameProjectList};`,
    ctx
  );
  return ctx.result;
}

const api = loadProjectApi();
function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

const master = [
  { code: "CORRO Office", name: "CORRO Office", status: "Active" },
  { code: "BARILI", name: "BARILI", status: "Active" },
  { code: "CTU-Barili Vet Med", name: "CTU-Barili Vet Med", status: "Active" },
  { code: "26HH0083 - Labangon", name: "26HH0083 - Labangon", status: "Active" },
];

describe("project near-duplicates", () => {
  it("folds case, spaces, hyphens, punctuation and doubled letters", () => {
    assert.equal(api.projectFoldKey("  CORRO-OFFICE "), api.projectFoldKey("corro office"));
    assert.equal(api.projectFoldKey("BARILI"), api.projectFoldKey("Barili"));
    assert.equal(api.projectFoldKey("Ctu Bariili Vet Med"), api.projectFoldKey("CTU-Barili Vet Med"));
    assert.equal(api.projectFoldKey("Office!!!"), api.projectFoldKey("office"));
    assert.equal(api.normProjectLabel("  Pardo   Wharf "), "Pardo Wharf");
  });

  it("blocks a typed variant and leaves the stored project unchanged", () => {
    const before = plain(master);
    const office = api.planProjectAdd(master, "corro-office");
    assert.equal(office.ok, false);
    assert.equal(office.reason, "near");
    assert.equal(office.match.code, "CORRO Office");
    assert.match(api.projectNearMessage(office), /CORRO Office/);
    assert.match(api.projectNearMessage(office), /Pick that one instead/);
    const officeWord = api.planProjectAdd(master, "Office");
    assert.equal(officeWord.ok, false);
    assert.equal(officeWord.match.code, "CORRO Office");
    assert.deepEqual(plain(master), before);
    assert.equal(office.projects.length, master.length);

    const barili = api.planProjectAdd(master, "Barili");
    assert.equal(barili.ok, false);
    assert.equal(barili.match.code, "BARILI");
    assert.equal(barili.match.name, "BARILI");

    const doubled = api.planProjectAdd(master, "Ctu Bariili Vet Med");
    assert.equal(doubled.ok, false);
    assert.equal(doubled.match.code, "CTU-Barili Vet Med");

    const contained = api.planProjectAdd(master, "Labangon");
    assert.equal(contained.ok, false);
    assert.equal(contained.match.code, "26HH0083 - Labangon");
    assert.match(api.projectNearMessage(contained), /26HH0083 - Labangon/);

    const alias = api.planProjectAdd(master, "CTU Ved Med");
    assert.equal(alias.ok, false);
    assert.equal(alias.match.code, "CTU-Barili Vet Med");
  });

  it("does not treat a short fragment as a container, and adds a real new name", () => {
    const short = api.planProjectAdd(master, "HH");
    assert.equal(short.ok, true);
    assert.equal(short.name, "HH");
    const added = api.planProjectAdd(master, "  Pardo   Wharf ");
    assert.equal(added.ok, true);
    assert.equal(added.existing, false);
    assert.equal(added.project.code, "Pardo Wharf");
    assert.equal(added.project.name, "Pardo Wharf");
    assert.equal(master.length, 4);
    const blank = api.planProjectAdd(master, " — ");
    assert.equal(blank.ok, false);
    assert.equal(blank.reason, "blank");
    assert.equal(blank.projects.length, 4);
  });

  it("merges a concurrent add and keeps the document keys already on file", () => {
    const remote = [{ code: "BARILI", name: "BARILI", status: "Active" }];
    const local = remote.concat([{ code: "Yard A", name: "Yard A", status: "Active" }]);
    const planned = api.applyProjectChange(remote, local, { op: "add", name: "Pardo Wharf" });
    assert.equal(planned.ok, true);
    assert.equal(planned.write, true);
    assert.deepEqual(
      planned.projects.map((p) => p.code),
      ["BARILI", "Pardo Wharf", "Yard A"]
    );
    const clash = api.applyProjectChange(remote, local, { op: "add", name: "barili" });
    assert.equal(clash.ok, false);
    assert.equal(clash.reason, "near");
    assert.equal(clash.write, false);
    assert.equal(remote[0].name, "BARILI");

    const rowsOnly = api.projectDocBody({ rows: [{ code: "Old" }], note: "keep" }, [{ code: "New" }]);
    assert.deepEqual(Object.keys(rowsOnly).sort(), ["note", "rows"]);
    assert.equal(rowsOnly.projects, undefined);
    assert.equal(rowsOnly.note, "keep");
    const both = api.projectDocBody(
      { rows: [{ code: "A" }], projects: [{ code: "A" }] },
      [{ code: "B", name: "B", status: "Active" }]
    );
    assert.deepEqual(both.rows, both.projects);
    const fresh = api.projectDocBody(null, [{ code: "B" }]);
    assert.ok(Array.isArray(fresh.rows) && Array.isArray(fresh.projects));
  });
});

describe("project dropdown on the page", () => {
  it("picks from the master list and adds only through the explicit action", () => {
    assert.match(html, /var BUILD = "2026-10-10 d"/);
    assert.match(html, /\+ Add new project…/);
    assert.match(html, /function bindProjectSelect/);
    assert.match(html, /function planProjectAdd/);
    assert.match(html, /select\[data-project-pick\]/);
    assert.match(html, /blankLabel:"— assigned site —"/);
    assert.match(html, /bindProjectSelect\(plsel/);
    assert.match(html, /bindProjectSelect\(apsel/);
    assert.match(html, /project:mproj\.getCode\(\)/);
    assert.match(html, /project:taskProj\.getCode\(\)/);
    assert.match(html, /project:taskEditProj\.getCode\(\)/);
    assert.match(html, /Pick that one instead/);
    assert.doesNotMatch(html, /type a project code or name/);
    assert.doesNotMatch(html, /harvestProjects\(true\)/);
    assert.equal(html.split("ensureProject(").length, 2);
    const picker = html.slice(html.indexOf("function projectPicker"), html.indexOf("function openProjectsManager"));
    assert.match(picker, /el\("select"\)/);
    assert.equal(picker.split('el("input")').length, 2);
    assert.match(picker, /cb\.type="checkbox"/);
    assert.doesNotMatch(picker, /ensureProject/);
  });
});

describe("server project labels", () => {
  it("trims and collapses spaces without renaming a different project", () => {
    assert.equal(normProjectLabel("  Danao   Guinacot "), "Danao Guinacot");
    assert.equal(normProjectLabel("CORRO Office"), "CORRO Office");
    assert.equal(normProjectLabel("Office"), "Office");

    const projects = {
      note: "keep",
      rows: [{ code: "CORRO Office", name: "CORRO Office", status: "Active" }],
      projects: [{ code: "  Yard   A ", name: "Yard A", status: "Active" }],
    };
    const next = normalizeProjectWrite("master", "projects", projects);
    assert.equal(next.note, "keep");
    assert.equal(next.rows[0].code, "CORRO Office");
    assert.equal(next.projects[0].code, "Yard A");
    assert.equal(normalizeProjectWrite("master", "projects", next.rows && {
      rows: [{ code: "CORRO Office", name: "CORRO Office", status: "Active" }],
      projects: [{ code: "CORRO Office", name: "CORRO Office", status: "Active" }],
    }).rows[0].name, "CORRO Office");

    const clean = { rows: [{ code: "BARILI", name: "BARILI", status: "Active" }] };
    assert.equal(normalizeProjectWrite("master", "projects", clean), clean);

    const vehicles = { rows: [{ code: "DT-03", site: "  Barili  Yard ", desc: "Dump" }] };
    const fleet = normalizeProjectWrite("master", "vehicles", vehicles);
    assert.equal(fleet.rows[0].code, "DT-03");
    assert.equal(fleet.rows[0].site, "Barili Yard");
    assert.equal(fleet.rows[0].desc, "Dump");

    const lines = [{ vrf: "6100", project: "  26HH0083   - Labangon ", total: 10 }];
    const normalized = normalizeLedgerRows(lines);
    assert.equal(normalized[0].project, "26HH0083 - Labangon");
    assert.equal(normalized[0].total, 10);
    assert.equal(lines[0].project, "  26HH0083   - Labangon ");

    const reserve = normalizeReserve({ no: "12", project: "BARILI  ", veh: "DT-03" });
    assert.equal(reserve.project, "BARILI");
    assert.equal(reserve.veh, "DT-03");
    const same = { no: "12", project: "BARILI" };
    assert.equal(normalizeReserve(same), same);

    const spec = { kind: "ledger", vrf: "6100", rows: lines, note: "keep" };
    const issued = normalizeIssueSpec(spec);
    assert.equal(issued.note, "keep");
    assert.equal(issued.rows[0].project, "26HH0083 - Labangon");
    assert.equal(spec.rows[0].project, "  26HH0083   - Labangon ");
    const specSame = { kind: "reserve", reserve: same };
    assert.equal(normalizeIssueSpec(specSame), specSame);
    const untouched = { kind: "ledger", vrf: "1", rows: [{ project: "BARILI" }] };
    assert.equal(normalizeIssueSpec(untouched), untouched);
  });
});
