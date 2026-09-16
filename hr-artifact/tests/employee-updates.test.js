"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  applyDedPatch,
  applySeparatedPatch,
  matchRows,
  planUpdates,
  uniqueByEmpNo,
} = require("../scripts/lib/employee-updates");
const { injectHeadCompanions } = require("../scripts/inject-index-companions");

function loadData(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "../scripts/data", name), "utf8")
  );
}

describe("employee update planner", () => {
  const roster = loadData("separated-roster-2026-09-16.json");
  const contrib = loadData("contributions-2026-09-16.json");

  it("lists 67 roster rows, unique 66, with 1351 twice", () => {
    assert.equal(roster.count, 67);
    assert.equal(roster.employees.length, 67);
    assert.equal(roster.status, "Separated");
    const ones = roster.employees.filter((e) => e.empNo === "1351");
    assert.equal(ones.length, 2);
    assert.equal(uniqueByEmpNo(roster.employees).length, 66);
    assert.equal(contrib.count, 33);
    assert.equal(contrib.employees.length, 33);
    assert.deepEqual(contrib.employees.find((e) => e.empNo === "1242").ded, {
      sss: 0,
      phic: 0,
      hdmf: 0,
    });
  });

  it("updates every matching empNo row and never invents a delete", () => {
    const rows = [
      { id: "a", data: { empNo: "1351", name: "Pasion, Ben", status: "Regular" } },
      { id: "b", data: { empNo: "1351", name: "Pasion, Ben", status: "Probationary" } },
      { id: "c", data: { empNo: "1242", name: "Abapo, Jean C.", status: "Regular" } },
    ];
    assert.equal(matchRows(rows, "1351").length, 2);
    const plan = planUpdates(rows, roster.employees, contrib.employees);
    const pasion = plan.updates.filter((u) => u.empNo === "1351");
    assert.equal(pasion.length, 2);
    assert.ok(pasion.every((u) => u.after.status === "Separated"));
    assert.ok(pasion.every((u) => u.after.separatedOn === "2026-09-02"));
    const jean = plan.updates.find((u) => u.id === "c");
    assert.deepEqual(jean.after.ded, { sss: 0, phic: 0, hdmf: 0 });
    assert.equal(jean.after.status, "Regular");
    assert.ok(!JSON.stringify(plan).includes("delete"));
  });

  it("writes explicit zero deductions and the exact Separated status", () => {
    const next = applyDedPatch({ empNo: "1", ded: { sss: 325, phic: 131.25, hdmf: 100 } }, {
      sss: 0,
      phic: 0,
      hdmf: 0,
    });
    assert.deepEqual(next.ded, { sss: 0, phic: 0, hdmf: 0 });
    const sep = applySeparatedPatch({ empNo: "1", status: "Regular" }, {
      separatedOn: "2026-08-31",
      separationReason: "confirmed",
    });
    assert.equal(sep.status, "Separated");
    assert.equal(sep.separatedOn, "2026-08-31");
  });

  it("reports missing empNo without creating rows", () => {
    const plan = planUpdates(
      [{ id: "only", data: { empNo: "9999", name: "Nobody" } }],
      [{ empNo: "1243", name: "Adolfo, Jomarie E." }],
      [{ empNo: "1242", name: "Abapo, Jean C.", ded: { sss: 0, phic: 0, hdmf: 0 } }]
    );
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.missingSeparated[0].empNo, "1243");
    assert.equal(plan.missingContrib[0].empNo, "1242");
  });
});

describe("index companion injector", () => {
  it("puts shim, manifest, icons, pwa.css, and pwa.js first in head", () => {
    const html = injectHeadCompanions(
      "<!doctype html><html><head><meta charset=utf8></head><body>hi</body></html>"
    );
    assert.match(html, /<head><script src="\/claude-shim\.js"><\/script>/);
    assert.match(html, /\/manifest\.json/);
    assert.match(html, /\/favicon\.svg/);
    assert.match(html, /\/apple-touch-icon\.png/);
    assert.match(html, /\/pwa\.css/);
    assert.match(html, /\/pwa\.js/);
    assert.ok(html.indexOf("/claude-shim.js") < html.indexOf("/pwa.js"));
    assert.equal((html.match(/claude-shim\.js/g) || []).length, 1);
  });
});
