"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isPlantUnit,
  papersNeeded,
  papersToChase,
  excludeFromPapersChase,
} = require("./lib/rules");
const { DEMO_UNITS } = require("./lib/seed");

describe("plant papers rule", () => {
  it("BH- / RR- code or blank / NA plate are plant → deed only", () => {
    assert.equal(isPlantUnit({ code: "BH-07", plate: "XYZ 1" }), true);
    assert.equal(isPlantUnit({ code: "RR-02", plate: "XYZ 2" }), true);
    assert.equal(isPlantUnit({ plate: "BH-07" }), true);
    assert.equal(isPlantUnit({ plate: "RR-02" }), true);
    assert.equal(isPlantUnit({ plate: "NA" }), true);
    assert.equal(isPlantUnit({ plate: "" }), true);
    assert.deepEqual(papersNeeded({ plate: "BH-07", status: "active" }), ["deed"]);
    assert.deepEqual(papersNeeded({ plate: "GAB 1402", status: "active" }), [
      "cr",
      "or",
      "insurance",
    ]);
  });

  it("excludes sold, AV, and Equipment n from chase", () => {
    assert.equal(excludeFromPapersChase({ status: "sold", plate: "OLD 1" }), true);
    assert.equal(excludeFromPapersChase({ status: "av", plate: "AV 0101" }), true);
    assert.equal(excludeFromPapersChase({ status: "active", name: "Equipment 1" }), true);
    assert.deepEqual(papersNeeded({ status: "sold", plate: "OLD 1" }), []);
  });

  it("demo fleet chase matches the plant / registered split", () => {
    const chase = papersToChase(DEMO_UNITS);
    const byCode = Object.fromEntries(chase.map((c) => [c.code, c]));
    assert.ok(byCode["BH-07"]);
    assert.deepEqual(byCode["BH-07"].missing, ["deed"]);
    assert.equal(byCode["BH-07"].plant, true);
    assert.ok(byCode["DT-12"]);
    assert.deepEqual(byCode["DT-12"].missing, ["insurance"]);
    assert.equal(
      chase.some((c) => c.code === "SV-99" || c.code === "AV-01" || c.code === "EQ-N1"),
      false
    );
    assert.equal(
      chase.some((c) => c.code === "RR-02" || c.code === "EQ-01" || c.code === "SV-01"),
      false
    );
  });

  it("combined OR+CR satisfies both CR and OR", () => {
    const missing = papersToChase([
      {
        id: "TM-03",
        code: "TM-03",
        plate: "CBQ 2201",
        status: "active",
        papers: { orCrCombined: true },
      },
    ]);
    assert.deepEqual(missing[0].missing, ["insurance"]);
  });
});
