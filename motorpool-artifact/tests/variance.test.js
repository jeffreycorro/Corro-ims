"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { varianceFlag, varianceNotice } = require("../public/js/rules.js");

describe("variance flag (>10% over approved)", () => {
  it("is a notice, not a block, when spent is more than 10% over", () => {
    assert.equal(varianceFlag(1000, 1100), false);
    assert.equal(varianceFlag(1000, 1100.01), true);
    assert.equal(varianceFlag(1000, 1500), true);
    const notice = varianceNotice(1000, 1500);
    assert.equal(notice.kind, "Flagged");
    assert.equal(notice.notice, true);
    assert.equal(notice.block, false);
    assert.equal(notice.overPct, 50);
  });

  it("does not flag missing or zero approved amounts", () => {
    assert.equal(varianceFlag(0, 500), false);
    assert.equal(varianceFlag(null, 500), false);
    assert.equal(varianceNotice(0, 500), null);
  });
});
