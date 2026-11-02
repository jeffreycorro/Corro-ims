"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const V = require("../public/vrf-liquidation");
const G = require("../netlify/lib/liquidation-guard");
const D = require("../scripts/liquidation-dry-run");

const TODAY = "2026-11-02";
const receipt = { receipts: 1, afterFuel: 0 };
const base = { actual: 1500, date: TODAY, by: "Ana Cruz", counts: receipt };
const ctx = { approved: 1500, fuelReserve: false, today: TODAY };
const fields = (r) => r.errors.map((e) => e.field).sort();

describe("checkLiquidation", () => {
  it("passes an exact spend with a receipt, date and name", () => {
    assert.deepEqual(V.checkLiquidation(base, ctx), { ok: true, errors: [] });
  });
  it("needs amount, date, name and a receipt", () => {
    const r = V.checkLiquidation({ counts: {} }, ctx);
    assert.equal(r.ok, false);
    assert.deepEqual(fields(r), ["actual", "by", "date", "receipt"]);
  });
  it("refuses a future liquidation date", () => {
    assert.deepEqual(fields(V.checkLiquidation({ ...base, date: "2026-11-03" }, ctx)), ["date"]);
  });
  it("under budget needs the change amount, how and when", () => {
    const under = { ...base, actual: 1400 };
    assert.deepEqual(fields(V.checkLiquidation(under, ctx)), ["changeAmount", "changeDate", "changeHow"]);
    const wrong = V.checkLiquidation({ ...under, change: { amount: 50, how: "Cash returned to Finance", date: TODAY } }, ctx);
    assert.deepEqual(fields(wrong), ["changeAmount"]);
    assert.match(wrong.errors[0].msg, /100\.00/);
    assert.equal(V.checkLiquidation({ ...under, change: { amount: 100, how: "Cash returned to Finance", date: TODAY } }, ctx).ok, true);
  });
  it("over budget needs a reason", () => {
    const over = { ...base, actual: 1600 };
    assert.deepEqual(fields(V.checkLiquidation(over, ctx)), ["overReason"]);
    assert.equal(V.checkLiquidation({ ...over, overReason: "price went up at the supplier" }, ctx).ok, true);
  });
  it("fuel reserve: after-fueling photo and a withdrawal row with matching liters; slip optional", () => {
    const fctx = { approved: 2000, fuelReserve: true, litres: 40, today: TODAY };
    const fin = { actual: 2000, date: TODAY, by: "Ana", counts: { receipts: 0, afterFuel: 0, slips: 0 } };
    assert.deepEqual(fields(V.checkLiquidation(fin, fctx)), ["afterFuel", "withdrawal"]);
    const withPhoto = { ...fin, counts: { afterFuel: 1, slips: 0 } };
    const mism = V.checkLiquidation({ ...withPhoto, withdrawal: { ref: "x", liters: 35 } }, fctx);
    assert.deepEqual(fields(mism), ["withdrawal"]);
    assert.match(mism.errors[0].msg, /35 L.*40 L/);
    assert.equal(V.checkLiquidation({ ...withPhoto, withdrawal: { ref: "x", liters: 40 } }, fctx).ok, true);
  });
  it("cancelled / not bought / duplicate are exempt", () => {
    ["cancelled", "not-bought", "duplicate"].forEach((o) => assert.equal(V.checkLiquidation({}, { ...ctx, outcome: o }).ok, true));
  });
});

describe("photo roles and proof counts", () => {
  it("reads after-fueling gauge photos from role or caption", () => {
    assert.equal(V.photoRoleOf({ role: "fuel-gauge-after" }), "gauge-after");
    assert.equal(V.photoRoleOf({ caption: "Gauge after fill" }), "gauge-after");
    assert.equal(V.photoRoleOf({ caption: "Fuel gauge — before" }), "gauge");
    assert.equal(V.photoRoleOf({ caption: "IMG_2231.jpg" }), "");
    assert.equal(V.photoRoleOf({ caption: "Receipt — Petron" }), "receipt");
  });
  it("counts LIQ uploads as receipts and VRF photos by role", () => {
    const c = V.proofCounts(
      [{ caption: "Gauge after fill" }, { caption: "IMG.jpg" }, { kind: "link", caption: "receipt" }],
      [{ caption: "OR 1234" }, { caption: "Withdrawal slip — 12", role: "withdrawal-slip" }]
    );
    assert.deepEqual([c.receipts, c.afterFuel, c.untagged, c.slips], [1, 1, 1, 1]);
  });
});

const closedRow = (extra) => Object.assign({ vrf: "7001", vstatus: "Closed", qty: 1, price: 1500, total: 1500, liq: { at: "2026-11-02T08:00:00+08:00", by: "Ana", outcome: "bought" } }, extra);
const fuelRow = (extra) => closedRow(Object.assign({ work: "FUEL-RES", supplier: "FUEL RESERVE", qty: 40, unit: "L", price: 50, total: 2000 }, extra));

describe("Liquidated – no receipt flag", () => {
  it("flags a closed bought VRF with no proof, not a cancelled one or an open one", () => {
    assert.equal(V.noReceiptFlag({ vrf: "1", status: "Closed", rows: [closedRow()] }, null).flag, true);
    assert.equal(V.noReceiptFlag({ vrf: "1", status: "Closed", rows: [closedRow({ liq: { at: "x", outcome: "cancelled" } })] }, null).flag, false);
    assert.equal(V.noReceiptFlag({ vrf: "1", status: "Open", rows: [{ vstatus: "Open" }] }, null).flag, false);
    assert.equal(V.noReceiptFlag({ vrf: "1", status: "Closed", rows: [closedRow()] }, { receipts: 1 }).flag, false);
  });
  it("a fuel reserve VRF with a gauge / after-fueling photo is not flagged", () => {
    const e = { vrf: "2", status: "Closed", rows: [fuelRow()] };
    assert.equal(V.noReceiptFlag(e, {}).flag, true);
    assert.equal(V.noReceiptFlag(e, { afterFuel: 1 }).clearedBy, "after-fuel photo");
    assert.equal(V.noReceiptFlag(e, { gauge: 1 }).clearedBy, "gauge photo");
    assert.equal(V.noReceiptFlag(e, { untagged: 2 }).flag, false);
    assert.equal(V.noReceiptFlag(e, { untagged: 2 }, { untaggedClearsFuel: false }).flag, true);
  });
  it("a stamped proof clears it, and liquidationOf exposes the flag", () => {
    const p = { v: 1, actual: 1500, date: TODAY, by: "Ana" };
    assert.equal(V.noReceiptFlag({ vrf: "1", status: "Closed", rows: [closedRow({ liq: { at: "x", outcome: "bought", proof: p } })] }).flag, false);
    assert.equal(V.liquidationOf({ vrf: "1", status: "Closed", rows: [closedRow()] }, null, 0).noReceipt, true);
    assert.equal(V.NO_RECEIPT_LABEL, "Liquidated – no receipt");
  });
});

function io(opts) {
  return {
    readRecord: async (id) => (opts.records || {})[id] || null,
    listPhotoMeta: async (owner) => (opts.photos || {})[owner] || [],
    getDoc: async (c, id) => (opts.docs || {})[c + "/" + id] || null,
  };
}
const proofFor = (extra) => Object.assign({ v: 1, actual: 1500, approved: 1500, date: TODAY, by: "Ana" }, extra);

describe("server guard", () => {
  it("refuses a new liquidation without a proof stamp (409)", async () => {
    const next = { id: "ledger:7001", kind: "ledger", vrf_no: "7001", data: { rows: [closedRow()] } };
    await assert.rejects(() => G.guardRecordWrite(next, io({})), (e) => e.statusCode === 409 && e.code === "liquidation_proof_required");
  });
  it("lets a VRF that was already Liquidated save again (exempt)", async () => {
    const next = { id: "ledger:7001", kind: "ledger", vrf_no: "7001", data: { rows: [closedRow({ item: "renamed" })] } };
    await G.guardRecordWrite(next, io({ records: { "ledger:7001": { data: { rows: [closedRow()] } } } }));
  });
  it("needs a receipt on file even with a proof stamp, then passes", async () => {
    const next = { id: "ledger:7001", kind: "ledger", vrf_no: "7001", reserve_no: "9", data: { rows: [closedRow({ liq: { at: "x", by: "Ana", outcome: "bought", proof: proofFor() } })] } };
    const recs = { "reserve:9": { data: { vrfs: ["7001"], approvedBudget: 1500 } } };
    await assert.rejects(() => G.guardRecordWrite(next, io({ records: recs })), /receipt/);
    await G.guardRecordWrite(next, io({ records: recs, photos: { "LIQ-7001": [{ caption: "OR 1" }] } }));
  });
  it("uses the reserve's approved budget, not the client's, for change returned", async () => {
    const next = { id: "ledger:7001", kind: "ledger", vrf_no: "7001", reserve_no: "9", data: { rows: [closedRow({ liq: { at: "x", by: "Ana", outcome: "bought", proof: proofFor({ approved: 1500 }) } })] } };
    const recs = { "reserve:9": { data: { vrfs: ["7001"], approvedBudget: 2000 } } };
    await assert.rejects(() => G.guardRecordWrite(next, io({ records: recs, photos: { "LIQ-7001": [{}] } })), /change returned/);
  });
  it("fuel reserve: checks the after-fueling photo and the withdrawal row liters", async () => {
    const wd = { date: "2026-11-02", vehicle: "DT-12", liters: 40, vrf: "7002" };
    const ref = V.withdrawalRef(wd, 0);
    const proof = proofFor({ actual: 2000, approved: 2000, fuel: { withdrawal: { ref, liters: 40 } } });
    const next = { id: "ledger:7002", kind: "ledger", vrf_no: "7002", data: { rows: [fuelRow({ vrf: "7002", liq: { at: "x", by: "Ana", outcome: "bought", proof } })] } };
    const docs = { "fuel/withdrawals": { data: { rows: [wd] } } };
    await assert.rejects(() => G.guardRecordWrite(next, io({ docs })), /after-fueling/);
    await G.guardRecordWrite(next, io({ docs, photos: { "7002": [{ caption: "Gauge after fill" }] } }));
    const docs35 = { "fuel/withdrawals": { data: { rows: [Object.assign({}, wd, { liters: 35 })] } } };
    await assert.rejects(() => G.guardRecordWrite(next, io({ docs: docs35, photos: { "7002": [{ role: "fuel-gauge-after" }] } })), /withdrawal/);
  });
  it("a reserve closes only after its VRFs are closed; an already-closed reserve is exempt", async () => {
    const next = { id: "reserve:9", kind: "reserve", data: { no: 9, status: "Closed", liquidatedAt: "x", vrfs: ["7001"] } };
    await assert.rejects(() => G.guardRecordWrite(next, io({ records: { "ledger:7001": { data: { rows: [{ vstatus: "Open" }] } } } })), /Liquidate the VRF/);
    await G.guardRecordWrite(next, io({ records: { "ledger:7001": { data: { rows: [closedRow()] } } } }));
    await G.guardRecordWrite(next, io({ records: { "reserve:9": { data: { status: "Closed" } } } }));
  });
  it("ignores unrelated writes", async () => {
    await G.guardRecordWrite({ id: "ledger:1", kind: "ledger", data: { rows: [{ vstatus: "Open" }] } }, io({}));
    await G.guardRecordWrite({ id: "issued:1", kind: "issued", data: {} }, io({}));
  });
});

describe("dry run flag report", () => {
  it("counts flagged VRFs, today's, and fuel reserve VRFs cleared by a photo", () => {
    const entries = D.buildEntries({ ledger: [
      { vrf: "1", rows: [closedRow({ vrf: "1" })] },
      { vrf: "2", rows: [fuelRow({ vrf: "2" })] },
      { vrf: "3", rows: [fuelRow({ vrf: "3" })] },
      { vrf: "4", rows: [closedRow({ vrf: "4" })] },
    ] });
    const r = D.noReceiptReport(entries, { "2": [{ caption: "Gauge after fill" }], "3": [{ caption: "IMG_1.jpg" }], "LIQ-4": [{}] }, TODAY);
    assert.equal(r.flagged.count, 1);
    assert.equal(r.flagged.today, 1);
    assert.equal(r.flagged.php, 1500);
    assert.equal(r.fuelReserve.closed, 2);
    assert.equal(r.fuelReserve.clearedByAfterFuelPhoto, 1);
    assert.equal(r.fuelReserve.clearedByUntaggedPhoto, 1);
    assert.equal(r.strictFlagged.count, 2);
  });
});

describe("wiring", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261102000001_motorpool_liquidation_proof.sql"), "utf8");
  it("the Liquidate dialog checks the rules and passes the proof", () => {
    assert.match(html, /closeBtn\.disabled=!hasName\|\|!pres\.ok/);
    assert.match(html, /LQ\.buildProof\(proofInput\(\), proofCtx\(\)\)/);
    assert.match(html, /lnt\.value\.trim\(\),outcome,proof\)/);
    assert.match(html, /role:"fuel-gauge-after"/);
    assert.match(html, /VL\.NO_RECEIPT_LABEL/);
  });
  it("db writes go through the guard and photo meta carries role", () => {
    const sb = fs.readFileSync(path.join(__dirname, "../netlify/lib/supabase.js"), "utf8");
    assert.match(sb, /await guardRecordWrite\(row/);
    assert.match(sb, /"role:data->>role"/);
  });
  it("the migration carries the rollback, bypass and an idempotent trigger", () => {
    assert.match(sql, /Rollback:[\s\S]*drop trigger if exists motorpool_records_liquidation_proof/);
    assert.match(sql, /motorpool\.allow_liquidate_without_proof/);
    assert.match(sql, /before insert or update on public\.motorpool_records/);
    assert.match(sql, /if not exists \(\s*select 1 from pg_trigger/);
  });
});
