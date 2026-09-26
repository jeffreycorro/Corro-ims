"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const {
  applyVehicleProjectDefault,
  markProjectOverride,
  projectFieldLocked,
  fuelSpendKind,
  vrfLogVisible,
  vrfLogSortNewestFirst,
  blankVrfDraft,
} = require("./lib/rules");

describe("9/19 14:08 — project stays editable after vehicle-code autofill", () => {
  it("auto-fills the unit site as a default and never locks the field", () => {
    const draft = blankVrfDraft("2026-09-19", "Yard");
    const first = applyVehicleProjectDefault(draft, { code: "DT-03", site: "26HH0083 - Labangon" });
    assert.equal(first.project, "26HH0083 - Labangon");
    assert.equal(first.applied, true);
    assert.equal(first.locked, false);
    assert.equal(first.overridden, false);
    assert.equal(projectFieldLocked(), false);
  });

  it("keeps a staff override after the vehicle code already filled the project", () => {
    const draft = blankVrfDraft("2026-09-19", "Yard");
    Object.assign(draft, applyVehicleProjectDefault(draft, { code: "DT-03", site: "26HH0083 - Labangon" }));
    Object.assign(draft, markProjectOverride(draft, "Yard A", { code: "DT-03", site: "26HH0083 - Labangon" }));
    assert.equal(draft.project, "Yard A");
    assert.equal(draft.overridden, true);
    const again = applyVehicleProjectDefault(draft, { code: "DT-03", site: "26HH0083 - Labangon" });
    assert.equal(again.project, "Yard A");
    assert.equal(again.applied, false);
    assert.equal(again.locked, false);
    assert.equal(again.overridden, true);
  });

  it("does not refill the project when staff clear it to type another code", () => {
    const draft = blankVrfDraft("2026-09-19", "Yard");
    Object.assign(draft, applyVehicleProjectDefault(draft, { code: "SV-19", site: "CTU-Barili Vet Med" }));
    Object.assign(draft, markProjectOverride(draft, "", { code: "SV-19", site: "CTU-Barili Vet Med" }));
    const again = applyVehicleProjectDefault(draft, { code: "SV-19", site: "CTU-Barili Vet Med" });
    assert.equal(again.project, "");
    assert.equal(again.applied, false);
    assert.equal(again.locked, false);
  });
});

describe("9/19 14:08 — Fuel Reserve vs Fuel Purchase", () => {
  it("classifies a station supplier as a Fuel Purchase, not a drum reserve", () => {
    assert.equal(
      fuelSpendKind({
        work: "FUEL-STN",
        lines: [{ cat: "Fuel — Diesel", supplier: "JVP Fuel" }],
      }),
      "fuel-bulk"
    );
    assert.equal(
      fuelSpendKind({
        work: "",
        lines: [{ cat: "Fuel — Diesel", supplier: "Shell" }],
      }),
      "fuel-bulk"
    );
  });

  it("classifies FUEL RESERVE / FUEL-RES as a drum reserve only", () => {
    assert.equal(
      fuelSpendKind({
        work: "FUEL-RES",
        lines: [{ cat: "Fuel — Diesel", supplier: "FUEL RESERVE" }],
      }),
      "fuel-issue"
    );
    assert.equal(
      fuelSpendKind({
        work: "FUEL-STN",
        lines: [{ cat: "Fuel — Diesel", supplier: "FUEL RESERVE" }],
      }),
      "fuel-bulk"
    );
  });
});

describe("9/19 14:17 — VRF log newest-first", () => {
  it("puts the latest VRF at the top by date, then by number", () => {
    const list = [
      { vrf: "5601", date: "2026-09-01" },
      { vrf: "5794", date: "2026-09-18" },
      { vrf: "5795", date: "2026-09-19" },
      { vrf: "5793", date: "2026-09-19" },
    ];
    const sorted = vrfLogSortNewestFirst(list);
    assert.deepEqual(
      sorted.map((v) => v.vrf),
      ["5795", "5793", "5794", "5601"]
    );
    const visible = vrfLogVisible(list, 5796);
    assert.equal(visible[0].vrf, "5795");
    assert.ok(visible.findIndex((v) => v.vrf === "5601") > visible.findIndex((v) => v.vrf === "5795"));
  });

  it("still keeps a held recent number on the list", () => {
    const visible = vrfLogVisible(
      [
        { vrf: "1001", date: "2024-01-01" },
        { vrf: "5795", held: true, date: "2026-09-19" },
        ...Array.from({ length: 260 }, (_, i) => ({ vrf: String(4000 + i), date: "2025-01-01" })),
      ],
      5796
    );
    assert.ok(visible.some((v) => v.vrf === "5795"));
    assert.equal(visible[0].vrf, "5795");
  });
});

describe("artifact HTML carries the 9/19 afternoon concern fixes", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("keeps the project picker editable after vehicle autofill", () => {
    assert.match(html, /function applyVehicleProjectDefault/);
    assert.match(html, /function markProjectOverride/);
    assert.match(html, /function projectFieldLocked/);
    assert.match(html, /wrap\.isLocked=function\(\)\{ return false; \}/);
    assert.match(html, /Filled from the unit when you type a code — you can still change it/);
    assert.match(html, /inp\.disabled=false;\s*inp\.readOnly=false/);
    assert.doesNotMatch(html, /pSel\.input\.disabled\s*=\s*true/);
    assert.doesNotMatch(html, /if\(v&&v\.site&&!d\.project\)/);
  });

  it("sorts the VRF log newest-first", () => {
    assert.match(html, /function vrfLogSortNewestFirst/);
    assert.match(html, /Newest first/);
    assert.match(html, /Latest VRF is at the top/);
    assert.match(html, /_vrfs=vrfLogSortNewestFirst\(_vrfs\)/);
    assert.doesNotMatch(html, /Every form, by number/);
    assert.doesNotMatch(html, /var out=pinned\.concat\(rest\.slice\(0,250\)\)/);
  });

  it("labels Fuel Reserve vs Fuel Purchase and classifies spend kind", () => {
    assert.match(html, /function fuelSpendKind/);
    assert.match(html, /kind:fuelSpendKind\(\{work:d\.work,lines:rows\}\)/);
    assert.match(html, /FUEL RESERVE — drum dispense \(not a purchase\)/);
    assert.match(html, /Fuel Purchase — record a bulk delivery/);
    assert.match(html, /Fuel Reserve — dispense from the drums/);
    assert.match(html, /var BUILD = "2026-09-26 a"/);
  });
});
