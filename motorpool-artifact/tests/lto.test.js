"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  addCalendarYear,
  enrichLtoWorktype,
  findLtoWorktype,
  isLtoRenewalLine,
  ltoDetailsStale,
  ltoProposalFromLine,
  ltoWorkCode,
  vrfIndexStale,
  vrfSearchHits,
} = require("./lib/rules");
const { TYPES } = require("./lib/worktypes");

const ST02_LINE = {
  date: "2026-08-03",
  vrf: "5604",
  veh: "ST-02",
  name: "MITSUBISHI CANTER DROPSIDE (YELLOW)",
  cat: "LTO Processing / Delivery F",
  sub: "Registration",
  item: "LTO Renewal",
  total: 10016,
  supplier: "LTO (LAND TRANSPORTATION OFFICE)",
};

describe("LTO renewal line matching (workbook wording)", () => {
  it("recognises the ST-02 VRF 5604 workbook row as an LTO renewal", () => {
    assert.equal(isLtoRenewalLine(ST02_LINE), true);
  });

  it("does not treat a change-oil or fuel-filter line as LTO", () => {
    assert.equal(
      isLtoRenewalLine({ cat: "Engine / Gear Oil", item: "DELO 18L", veh: "ST-02" }),
      false
    );
    assert.equal(
      isLtoRenewalLine({ cat: "Fuel Filter", item: "Fuel Filter", veh: "ST-02" }),
      false
    );
  });

  it("accepts synonym wording: job name, processing category, registration sub", () => {
    assert.equal(isLtoRenewalLine({ item: "LTO registration renewal" }), true);
    assert.equal(isLtoRenewalLine({ cat: "LTO Processing", item: "Plate / sticker" }), true);
    assert.equal(isLtoRenewalLine({ cat: "Documents", sub: "Registration", item: "LTO" }), true);
  });

  it("finds the LTO job type even when master keywords omit 'LTO Renewal'", () => {
    const types = TYPES.map((t) => Object.assign({}, t));
    const wt = findLtoWorktype(types);
    assert.ok(wt);
    assert.equal(wt.id, "lto-ren");
    assert.equal(ltoWorkCode(types), "lto-ren");
    const artifactShape = [
      {
        code: "LTO-REN",
        name: "LTO registration renewal",
        family: "Registration / LTO",
        key: [],
        words: ["registration renewal"],
      },
    ];
    assert.equal(ltoWorkCode(artifactShape), "LTO-REN");
    const enriched = enrichLtoWorktype(artifactShape);
    assert.ok(enriched.words.some((w) => w.toLowerCase() === "lto renewal"));
    assert.ok(enriched.key.some((k) => /LTO Processing/i.test(k)));
  });
});

describe("LTO details proposal from spend", () => {
  it("sets registration date from the log date and expiry +1 year", () => {
    assert.equal(addCalendarYear("2026-08-03"), "2027-08-03");
    assert.equal(addCalendarYear("2024-02-29"), "2025-02-28");
    const p = ltoProposalFromLine(ST02_LINE);
    assert.ok(p);
    assert.equal(p.regDate, "2026-08-03");
    assert.equal(p.regExpiry, "2027-08-03");
    assert.equal(p.regMonth, "August");
    assert.equal(p.vrf, "5604");
    assert.match(p.assumption, /1 year/i);
  });

  it("treats blank OR / dates as stale when a renewal spend exists", () => {
    const p = ltoProposalFromLine(ST02_LINE);
    assert.equal(ltoDetailsStale({ orno: "", regDate: "", regExpiry: "" }, p), true);
    assert.equal(
      ltoDetailsStale({ orno: "", regDate: "2026-08-03", regExpiry: "2027-08-03" }, p),
      false
    );
    assert.equal(
      ltoDetailsStale({ orno: "123", regDate: "2025-08-01", regExpiry: "2026-08-01" }, p),
      true
    );
  });
});

describe("job-history classification (artifact short-circuit)", () => {
  it("scopes the ST-02 line to LTO registration renewal, not UNCLASS", () => {
    const worktypes = [
      {
        code: "LTO-REN",
        name: "LTO registration renewal",
        family: "Registration / LTO",
        key: [],
        words: ["registration renewal"],
      },
      { code: "OIL", name: "Change oil", family: "Preventive", key: ["Engine / Gear Oil"], words: [] },
    ];
    const code = ltoWorkCode(worktypes);
    assert.equal(code, "LTO-REN");
    assert.equal(isLtoRenewalLine(ST02_LINE), true);
    const works = isLtoRenewalLine(ST02_LINE) ? [code] : ["UNCLASS"];
    assert.deepEqual(works, ["LTO-REN"]);
  });
});

describe("VRF index cache", () => {
  it("rebuilds when first paint froze an empty index and the ledger later has rows", () => {
    assert.equal(vrfIndexStale(null, 1), true);
    assert.equal(vrfIndexStale([], 1), true);
    assert.equal(vrfIndexStale([], 0), false);
    assert.equal(vrfIndexStale([{ vrf: "5604" }], 1), false);
  });
});

describe("VRF number search", () => {
  it("matches 5604 and the padded typo 56004", () => {
    assert.equal(vrfSearchHits("5604", "5604"), true);
    assert.equal(vrfSearchHits("5604", "56004"), true);
    assert.equal(vrfSearchHits("5604", "05604"), true);
    assert.equal(vrfSearchHits("5604", "9999"), false);
    assert.equal(vrfSearchHits("5604", "ST-02"), false);
  });
});
