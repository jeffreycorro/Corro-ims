"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePath,
  assertCollection,
  isAllowedCollection,
  requiresFullWrite,
  ALLOWED_COLLECTIONS,
  listFilterQuery,
  normalizeListFilters,
  rowMatchesFilters,
} = require("../netlify/lib/collections");

describe("motorpool collections", () => {
  it("parses documented paths", () => {
    assert.deepEqual(parsePath("config/app"), { collection: "config", id: "app" });
    assert.deepEqual(parsePath("master/vehicles"), { collection: "master", id: "vehicles" });
    assert.deepEqual(parsePath("ledger/2026-09"), {
      collection: "ledger",
      id: "2026-09",
    });
    assert.deepEqual(parsePath("ops/mechanic"), { collection: "ops", id: "mechanic" });
  });

  it("keeps extra slashes in the id", () => {
    assert.deepEqual(parsePath("photos/folder/file"), {
      collection: "photos",
      id: "folder/file",
    });
  });

  it("rejects unknown collections", () => {
    assert.throws(() => parsePath("employees/x"), /not allowed/);
    assert.equal(isAllowedCollection("reserves"), true);
    assert.equal(isAllowedCollection("builds"), true);
    assert.equal(isAllowedCollection("meta"), false);
    assert.throws(() => assertCollection("anon"), /not allowed/);
  });

  it("requires a full-field write for config/app", () => {
    assert.equal(requiresFullWrite("config", "app"), true);
    assert.equal(requiresFullWrite("master", "vehicles"), false);
  });

  it("lists the documented collections", () => {
    assert.deepEqual([...ALLOWED_COLLECTIONS], [
      "master",
      "ledger",
      "ops",
      "reserves",
      "fuel",
      "photos",
      "config",
      "builds",
    ]);
    assert.deepEqual(parsePath("builds/2026-09-14 g"), {
      collection: "builds",
      id: "2026-09-14 g",
    });
  });

  it("filters photo lists by the vrf field the artifact writes", () => {
    const filters = normalizeListFilters([
      { field: "vrf", op: "==", value: "RSV-3" },
    ]);
    assert.deepEqual(filters, [{ field: "vrf", op: "eq", value: "RSV-3" }]);
    assert.match(listFilterQuery(filters), /data->>vrf=eq\.RSV-3/);
    assert.equal(
      rowMatchesFilters({ id: "vrf-RSV-3__1", data: { vrf: "RSV-3" } }, filters),
      true
    );
    assert.equal(
      rowMatchesFilters({ id: "vrf-5795__1", data: { vrf: "5795" } }, filters),
      false
    );
  });
});
