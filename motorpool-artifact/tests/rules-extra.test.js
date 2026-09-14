"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  inferJob,
  fuelGates,
  missingJoCloseFields,
  missingTaskCloseFields,
  missingFuelApproveFields,
  isFuelBypass,
  bypassAttribution,
  fuelAskApprovalBlockedByPhoto,
  workRefStates,
  checkOfficeHash,
  sha256hexSync,
} = require("./lib/rules");
const { TYPES } = require("./lib/worktypes");

describe("infer job and gates", () => {
  it("labels the longest phrase as the key category (score 3) and labour as 0", () => {
    const result = inferJob(
      [
        { description: "labour helper overtime" },
        { description: "hydraulic hose burst on boom" },
        { description: "fasteners and rags" },
      ],
      TYPES
    );
    assert.equal(result.inferred, true);
    assert.equal(result.workType && result.workType.id, "hyd-hose");
  });

  it("fuel gates catch reverse meter and need an override reason", () => {
    const gates = fuelGates(
      { litres: 80, meter: 100, meterKind: "km" },
      [{ litres: 40, meter: 200 }],
      { meterReadingHardStop: false }
    );
    assert.ok(gates.issues.some((i) => i.code === "reverse"));
    assert.equal(gates.needsOverride, true);
    assert.equal(gates.blocked, false);
    const hard = fuelGates(
      { litres: 80, meter: 100, meterKind: "km" },
      [{ litres: 40, meter: 200 }],
      { meterReadingHardStop: true }
    );
    assert.equal(hard.blocked, true);
  });

  it("JO and task close lists are hard gates", () => {
    assert.ok(missingJoCloseFields({ checklist: [], proofs: [], resolution: "" }).length >= 3);
    assert.ok(missingTaskCloseFields({ closerName: "", photos: [], links: [] }).includes("Closer name"));
    assert.ok(missingTaskCloseFields({ closerName: "A", photos: [], links: [] }).includes("Photo or link"));
    assert.deepEqual(
      missingTaskCloseFields({ closerName: "A", photos: [{ id: "p1" }], links: [] }),
      []
    );
  });

  it("VRF work-ref default includes For verification", () => {
    assert.deepEqual(workRefStates({}), ["Open", "In progress", "For verification"]);
    assert.deepEqual(workRefStates({ joForVerificationInVrfDropdown: false }), [
      "Open",
      "In progress",
    ]);
  });

  it("fuel ask-approval is not blocked by a missing gauge photo", () => {
    assert.equal(fuelAskApprovalBlockedByPhoto(), false);
    assert.deepEqual(
      missingFuelApproveFields({
        kind: "fuel-issue",
        gauge: "1/4",
      }),
      []
    );
    assert.ok(
      !missingFuelApproveFields({
        kind: "fuel-issue",
        gauge: "1/4",
      }).includes("Gauge photo")
    );
    assert.ok(
      missingFuelApproveFields({ kind: "fuel-issue", gauge: "" }).includes("Gauge level")
    );
  });

  it("bypass override skips approval and names who / when / unit / litres / reason", () => {
    assert.equal(isFuelBypass(null), false);
    assert.equal(isFuelBypass({ reason: "Emergency dispatch", by: "Jun" }), false);
    const ov = {
      bypass: true,
      reason: "Emergency dispatch",
      by: "Jun Cruz",
      at: "2026-09-14",
      note: "night pour",
    };
    assert.equal(isFuelBypass(ov), true);
    const note = bypassAttribution(ov, { unit: "DT-12", litres: 40 });
    assert.match(note, /Bypass — no office approval/);
    assert.match(note, /Jun Cruz/);
    assert.match(note, /2026-09-14/);
    assert.match(note, /DT-12/);
    assert.match(note, /40 L/);
    assert.match(note, /Emergency dispatch/);
    assert.match(note, /night pour/);
  });

  it("office hash compare is hex-only and never stores plaintext", () => {
    const hex = sha256hexSync("alpha");
    assert.match(hex, /^[a-f0-9]{64}$/);
    assert.equal(checkOfficeHash(hex, hex), true);
    assert.equal(checkOfficeHash("not-a-hash", hex), false);
  });
});
