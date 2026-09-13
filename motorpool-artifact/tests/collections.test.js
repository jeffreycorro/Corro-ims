"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePath,
  assertCollection,
  isAllowedCollection,
  requiresFullWrite,
  ALLOWED_COLLECTIONS,
} = require("../netlify/lib/collections");

describe("motorpool collections", () => {
  it("parses documented paths", () => {
    assert.deepEqual(parsePath("config/app"), { collection: "config", id: "app" });
    assert.deepEqual(parsePath("master/units"), { collection: "master", id: "units" });
    assert.deepEqual(parsePath("ledger/VRF-2026-0001"), {
      collection: "ledger",
      id: "VRF-2026-0001",
    });
    assert.deepEqual(parsePath("ops/jo-abc"), { collection: "ops", id: "jo-abc" });
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
    assert.equal(isAllowedCollection("meta"), false);
    assert.throws(() => assertCollection("anon"), /not allowed/);
  });

  it("requires a full-field write for config/app", () => {
    assert.equal(requiresFullWrite("config", "app"), true);
    assert.equal(requiresFullWrite("master", "units"), false);
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
    ]);
  });
});
