import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_DOCUMENT_SERIES } from "./demo-data.ts";
import { formatDocumentNo } from "./series.ts";

function series(key: string) {
  const row = DEMO_DOCUMENT_SERIES.find((item) => item.key === key);
  assert.ok(row, key);
  return row;
}

describe("document series paper formats", () => {
  it("prints each series the way the filing cabinet already does", () => {
    assert.equal(formatDocumentNo(series("CON"), 2026, 3), "2026 - 03");
    assert.equal(formatDocumentNo(series("NTE"), 2026, 17), "NTE2026 - 17");
    assert.equal(formatDocumentNo(series("NOD"), 2026, 1), "NOD2026-0001");
    assert.equal(formatDocumentNo(series("WW"), 2026, 1), "WW2026-0001");
    assert.equal(formatDocumentNo(series("CA"), 2026, 42), "CAF2026-0042");
    assert.equal(formatDocumentNo(series("LV"), 2026, 157), "LRF2026-0157");
    assert.equal(formatDocumentNo(series("COE"), 2026, 1), "COE2026 - 01");
    assert.equal(formatDocumentNo(series("CLR"), 2026, 2), "CLR2026-0002");
    assert.equal(formatDocumentNo(series("CM"), 2026, 13), "C.M. 2026 - 13");
    assert.equal(formatDocumentNo(series("DM"), 2026, 1), "DM2026 - 01");
    assert.equal(formatDocumentNo(series("NCR"), 2026, 1), "NCR 2026 - 001");
    assert.equal(formatDocumentNo(series("ALR"), 2026, 1), "ALR2026-01");
    assert.equal(formatDocumentNo(series("RM"), 2026, 1), "RM2026-001");
    assert.equal(formatDocumentNo(series("RFFI"), 2026, 1), "RFFI2026 - 01");
    assert.equal(formatDocumentNo(series("IR"), 2026, 1), "IR2026 - 01");
    assert.equal(formatDocumentNo(series("PE"), 2026, 1), "PE2026-0001");
    assert.equal(formatDocumentNo(series("OFR"), 2026, 1), "OFR2026-0001");
    assert.equal(formatDocumentNo(series("PAF"), 2026, 1), "PAF2026-0001");
    assert.equal(formatDocumentNo(series("MEMO"), 2026, 1), "MEMO2026-0001");
  });
});
