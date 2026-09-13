"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isFuel } = require("../public/js/rules.js");

describe("isFuel requires a dash", () => {
  it("rejects fuel-ish words without a dash", () => {
    assert.equal(isFuel("fuel"), false);
    assert.equal(isFuel("fuel filter"), false);
    assert.equal(isFuel("diesel"), false);
    assert.equal(isFuel("Gasoline 91"), false);
  });

  it("accepts commodity names that include a dash", () => {
    assert.equal(isFuel("DIESEL-BULK"), true);
    assert.equal(isFuel("DIESEL-ISSUE"), true);
    assert.equal(isFuel("Gasoline - 91"), true);
    assert.equal(isFuel("FUEL-DIESEL"), true);
  });

  it("does not treat fuel-system parts as commodity fuel", () => {
    assert.equal(isFuel("fuel-filter"), false);
    assert.equal(isFuel("fuel-pump"), false);
    assert.equal(isFuel("Fuel line / tank"), false);
  });
});
