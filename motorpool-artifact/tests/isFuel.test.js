"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isFuel } = require("./lib/rules");

describe("isFuel requires a dash (artifact rule)", () => {
  it("rejects fuel-ish words without a dash after fuel", () => {
    assert.equal(isFuel("fuel"), false);
    assert.equal(isFuel("fuel filter"), false);
    assert.equal(isFuel("Fuel Filter"), false);
    assert.equal(isFuel("diesel"), false);
    assert.equal(isFuel("DIESEL-BULK"), false);
  });

  it("accepts Fuel — Diesel style commodity names", () => {
    assert.equal(isFuel("Fuel — Diesel"), true);
    assert.equal(isFuel("fuel – diesel"), true);
    assert.equal(isFuel("Fuel - Diesel"), true);
    assert.equal(isFuel("  FUEL—DIESEL"), true);
  });
});
