"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  asProject,
  harvestProjectCodes,
  isProjectArchived,
  mergeProjectStore,
  pickerProjectList,
  projectCodeOf,
  projectStamp,
  recordProjectLabel,
  upsertManagedProject,
} = require("./lib/rules");

describe("managed projects", () => {
  it("reads archived from status, archived flag, or inactive", () => {
    assert.equal(asProject("CTU Barili").status, "Active");
    assert.equal(asProject({ code: "Pardo", archived: true }).status, "Archived");
    assert.equal(asProject({ name: "Old Site", status: "inactive" }).status, "Archived");
    assert.equal(asProject({ code: "Live", status: "Active" }).status, "Active");
    assert.equal(isProjectArchived({ code: "X", status: "Archived" }), true);
    assert.equal(isProjectArchived("X"), false);
    assert.equal(projectCodeOf({ name: "BFP San Remigio" }), "BFP San Remigio");
  });

  it("harvests codes from units, reserves, withdrawals and the VRF ledger", () => {
    const codes = harvestProjectCodes({
      vehicles: [{ site: "Yard A" }, { site: "" }, { code: "DT-01" }],
      reserves: [{ project: "26HH0083 - Labangon" }],
      withdrawals: [{ project: "Yard A" }, { project: "Drum fill" }],
      purchases: [{ project: "" }],
      ledger: {
        "2026-09": [{ project: "VRF Site" }, { item: "oil" }],
      },
    });
    assert.deepEqual(codes, ["Yard A", "26HH0083 - Labangon", "Drum fill", "VRF Site"]);
  });

  it("keeps archived status when the same code is harvested again", () => {
    const merged = mergeProjectStore(
      [
        { code: "Yard A", name: "Yard A", status: "Archived" },
        { code: "Live", name: "Live job", status: "Active" },
      ],
      ["Yard A", "New Job", "Live"]
    );
    assert.deepEqual(
      merged.map((p) => p.code + ":" + p.status),
      ["Live:Active", "New Job:Active", "Yard A:Archived"]
    );
    assert.equal(merged.find((p) => p.code === "Live").name, "Live job");
  });

  it("hides archived from pickers unless shown or already on the record", () => {
    const list = [
      { code: "Active One", status: "Active" },
      { code: "Old One", status: "Archived" },
    ];
    assert.deepEqual(
      pickerProjectList(list).map((p) => p.code),
      ["Active One"]
    );
    assert.deepEqual(
      pickerProjectList(list, { includeArchived: true }).map((p) => p.code),
      ["Active One", "Old One"]
    );
    assert.deepEqual(
      pickerProjectList(list, { current: "Old One" }).map((p) => p.code),
      ["Active One", "Old One"]
    );
    assert.equal(recordProjectLabel("Old One"), "Old One");
    assert.equal(recordProjectLabel(""), "");
  });

  it("adds, edits, and archives without dropping the managed list", () => {
    let store = [];
    let res = upsertManagedProject(store, { code: "HH-STAFF-2026", name: "Staff housing" });
    assert.equal(res.ok, true);
    store = res.projects;
    res = upsertManagedProject(store, {
      prevCode: "HH-STAFF-2026",
      code: "HH-STAFF-2026",
      name: "Staff housing 2026",
      archived: true,
    });
    assert.equal(res.ok, true);
    assert.equal(res.project.status, "Archived");
    assert.equal(res.project.name, "Staff housing 2026");
    store = res.projects;
    res = upsertManagedProject(store, { code: "Pardo" });
    store = res.projects;
    assert.equal(store.length, 2);
    assert.equal(isProjectArchived(store.find((p) => p.code === "HH-STAFF-2026")), true);
    const stamp = projectStamp(store);
    assert.match(stamp, /HH-STAFF-2026/);
    assert.match(stamp, /Archived/);
  });

  it("rejects a rename onto a code already on file", () => {
    const res = upsertManagedProject(
      [
        { code: "A", name: "A", status: "Active" },
        { code: "B", name: "B", status: "Active" },
      ],
      { prevCode: "A", code: "B", name: "A" }
    );
    assert.equal(res.ok, false);
    assert.match(res.reason, /already on file/);
    assert.equal(res.projects.length, 2);
  });
});
