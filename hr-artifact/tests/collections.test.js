"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePath,
  assertCollection,
  isAllowedCollection,
  ALLOWED_COLLECTIONS,
} = require("../netlify/lib/collections");

describe("collections", () => {
  it("parses collection/id including meta/settings", () => {
    assert.deepEqual(parsePath("meta/settings"), {
      collection: "meta",
      id: "settings",
    });
    assert.deepEqual(parsePath("employees/E-1001"), {
      collection: "employees",
      id: "E-1001",
    });
  });

  it("accepts two-argument form", () => {
    assert.deepEqual(parsePath("tasks", "t1"), { collection: "tasks", id: "t1" });
  });

  it("keeps extra slashes in the id", () => {
    assert.deepEqual(parsePath("resources/folder/file"), {
      collection: "resources",
      id: "folder/file",
    });
  });

  it("rejects unknown collections and malformed paths", () => {
    assert.throws(() => parsePath("nope/id"), /not allowed/);
    assert.throws(() => parsePath("employees"), /collection\/id/);
    assert.throws(() => assertCollection("anon"), /not allowed/);
    assert.equal(isAllowedCollection("employees"), true);
    assert.equal(isAllowedCollection("public"), false);
  });

  it("includes the documented collection list plus meta", () => {
    const expected = [
      "employees",
      "nte",
      "writeups",
      "tasks",
      "templates",
      "reminders",
      "memos",
      "resources",
      "onboarding",
      "series",
      "docreg",
      "applicants",
      "exams",
      "roles",
      "advances",
      "leaves",
      "projects",
      "incidents",
      "genfiles",
      "decisions",
      "daily",
      "filed",
      "compliance",
      "forms",
      "periods",
      "meta",
    ];
    assert.deepEqual([...ALLOWED_COLLECTIONS], expected);
  });
});
