"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");
const tomb = require("../netlify/lib/employee-tombstones");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const db = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  let start = src.indexOf(needle);
  if (name === "drop") start = src.indexOf("async function drop(");
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

const REMA = {
  id: "e_rema1",
  empNo: "",
  name: "Olandag, Rema",
  status: "",
  rosterConfirmed: "2026-11-04",
};
const REMART = {
  id: "e_remart",
  empNo: "1402",
  name: "Olandag, Remart",
  status: "Project-based",
};
const ARMENIO = {
  id: "e1250",
  empNo: "1250",
  name: "Armenio, Toribio D.",
  status: "Regular",
};

describe("deleted employee tombstones", () => {
  it("records the deleted id and refuses to write that document back", () => {
    const at = "2026-11-04T08:39:00+08:00";
    const stored = tomb.tombstoneAfterDelete({}, REMA.id, REMA, at);
    assert.equal(stored.record.name, "Olandag, Rema");
    assert.equal(stored.byId[REMA.id].at, at);

    const again = tomb.tombstoneAfterDelete(
      stored.byId,
      REMART.id,
      REMART,
      at
    );
    assert.ok(again.byId[REMA.id]);
    assert.ok(again.byId[REMART.id]);

    const blocked = tomb.prepareEmployeeSet(stored.byId, REMA.id, REMA);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "employee_deleted");

    const other = tomb.prepareEmployeeSet(stored.byId, ARMENIO.id, ARMENIO);
    assert.equal(other.ok, true);

    const sameNameNewId = tomb.prepareEmployeeSet(stored.byId, "e_new", {
      id: "e_new",
      name: "Olandag, Rema",
    });
    assert.equal(sameNameNewId.ok, true);

    const keeper = tomb.prepareEmployeeSet(stored.byId, REMART.id, REMART);
    assert.equal(keeper.ok, true);
  });

  it("does not let a stale browser copy become a roster retry", () => {
    const byId = tomb.tombstoneAfterDelete({}, REMA.id, REMA, "2026-11-04").byId;
    const employees = { [REMA.id]: REMA, [ARMENIO.id]: ARMENIO, [REMART.id]: REMART };
    const pruned = tomb.pruneEmployeeMap(employees, byId);
    assert.equal(pruned[REMA.id], undefined);
    assert.equal(pruned[ARMENIO.id].name, ARMENIO.name);
    assert.equal(pruned[REMART.id].name, REMART.name);

    const serverIds = [ARMENIO.id, REMART.id];
    assert.deepEqual(
      tomb.rosterRetryIds(Object.keys(employees), serverIds, employees, byId),
      []
    );
    assert.deepEqual(
      tomb.rosterRetryIds(Object.keys(employees), serverIds, employees, {}),
      [REMA.id]
    );

    const listed = tomb.filterEmployeeRows(
      [
        { id: REMA.id, data: REMA },
        { id: ARMENIO.id, data: ARMENIO },
        { id: REMART.id, data: REMART },
      ],
      byId
    );
    assert.deepEqual(listed.map((row) => row.id), [ARMENIO.id, REMART.id]);
  });

  it("merges tombstone documents without dropping an earlier delete", () => {
    const prev = tomb.tombstoneAfterDelete({}, REMA.id, REMA, "2026-11-04").byId;
    const incoming = { [ARMENIO.id]: tomb.tombstoneFromEmployee(ARMENIO.id, ARMENIO, "2026-11-05") };
    const merged = tomb.prepareTombstoneDoc(prev, incoming);
    assert.equal(merged.byId[REMA.id].name, "Olandag, Rema");
    assert.equal(merged.byId[ARMENIO.id].empNo, "1250");
  });

  it("wires the shared store to record a delete and hide the row", () => {
    assert.match(db, /tombstoneAfterDelete/);
    assert.match(db, /prepareEmployeeSet/);
    assert.match(db, /filterEmployeeRows/);
    assert.match(db, /TOMBSTONE_DOC_ID/);
    assert.match(html, /function rememberDeletedEmployee/);
    assert.match(html, /await loadEmployeeTombstones\(\)/);
    assert.match(html, /rosterRetryIds\(Object\.keys\(S\.employees\)/);
    assert.match(extractFunction(html, "drop"), /rememberDeletedEmployee/);
    assert.match(extractFunction(html, "put"), /employee_deleted/);
    assert.match(extractFunction(html, "empList"), /employeeIsDeleted/);
    assert.match(extractFunction(html, "dailyPeople"), /employeeIsDeleted/);
  });

  it("keeps a deleted profile off the attendance list after reload", () => {
    const names = [
      "tombstoneFromEmployee",
      "mergeTombstoneMaps",
      "employeeMatchesTombstone",
      "employeeIsDeleted",
      "rememberDeletedEmployee",
      "pruneDeletedEmployees",
      "rosterRetryIds",
      "empList",
      "nameLastFirst",
      "cmpEmpAlpha",
    ];
    const ctx = {
      S: {
        employees: {
          [REMA.id]: Object.assign({}, REMA),
          [ARMENIO.id]: Object.assign({}, ARMENIO),
          [REMART.id]: Object.assign({}, REMART),
        },
        tombstones: {},
        daily: {
          d20261104: {
            id: "d20261104",
            date: "2026-11-04",
            rows: { [REMA.id]: { s: "Present", r: "", site: "ADMINS" } },
            extra: [REMA.id, ARMENIO.id, REMART.id],
          },
        },
      },
    };
    vm.runInNewContext(names.map((name) => extractFunction(html, name)).join("\n"), ctx);

    const before = ctx.empList().map((e) => e.name);
    assert.ok(before.includes("Olandag, Rema"));
    assert.ok(before.includes("Olandag, Remart"));

    ctx.rememberDeletedEmployee(ctx.S.employees[REMA.id]);
    const retry = ctx.rosterRetryIds(
      Object.keys(ctx.S.employees),
      [ARMENIO.id, REMART.id],
      ctx.S.employees,
      ctx.S.tombstones
    );
    assert.deepEqual(retry, []);
    ctx.pruneDeletedEmployees();

    const roster = ctx.empList();
    assert.equal(roster.some((e) => e.name === "Olandag, Rema"), false);
    assert.equal(roster.some((e) => e.name === "Olandag, Remart"), true);
    assert.equal(roster.some((e) => e.empNo === "1250"), true);
    assert.equal(ctx.S.daily.d20261104.rows[REMA.id].s, "Present");

    ctx.S.employees[REMA.id] = Object.assign({}, REMA);
    const standing = Object.values(ctx.S.employees).filter((e) => !ctx.employeeIsDeleted(e));
    assert.equal(standing.some((e) => e.id === REMA.id), false);
    assert.equal(standing.some((e) => e.name === "Olandag, Remart"), true);
  });
});
