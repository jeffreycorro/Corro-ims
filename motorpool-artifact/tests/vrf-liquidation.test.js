"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../public/vrf-liquidation");
const { financeLiquidationForVrf } = require("../netlify/lib/finance-link");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
const dbFn = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");

const openVrf = { vrf: "6100", status: "Open", total: 5000, approvedBudget: 5000, approvedAt: "2026-10-05", requestedBy: "Sophie", veh: "DT-06", rows: [{ total: 5000, work: "PMS" }] };

describe("VRF liquidation status", () => {
  it("is Unliquidated with nothing recorded", () => {
    const s = L.liquidationOf(openVrf, null, 0);
    assert.equal(s.status, "Unliquidated");
    assert.equal(s.outstanding, 5000);
    assert.equal(s.proofKind, "receipt / OR");
  });
  it("is Partially liquidated below the approved amount, even with proof", () => {
    const s = L.liquidationOf(openVrf, { amount: 3000, date: "2026-10-20", by: "Brinneshiel" }, 2);
    assert.equal(s.status, "Partially liquidated");
    assert.equal(s.outstanding, 2000);
    assert.match(s.needs, /below approved/);
  });
  it("is Partially liquidated at full amount without proof", () => {
    const s = L.liquidationOf(openVrf, { amount: 5000, date: "2026-10-20", by: "B" }, 0);
    assert.equal(s.status, "Partially liquidated");
    assert.match(s.needs, /no receipt/);
  });
  it("is Liquidated with full amount and proof", () => {
    const s = L.liquidationOf(openVrf, { amount: 5200, date: "2026-10-20", by: "B" }, 1);
    assert.equal(s.status, "Liquidated");
    assert.equal(s.by, "B");
  });
  it("reads amount, date and who from the existing Liquidate stamp", () => {
    const closed = { vrf: "5823", status: "Closed", approvedBudget: 7627.2, actual: 8611.2,
      liq: { at: "2026-09-24", by: "Brinneshiel" }, rows: [{ total: 8611.2 }] };
    const noProof = L.liquidationOf(closed, null, 0);
    assert.equal(noProof.status, "Partially liquidated");
    assert.equal(noProof.liquidated, 8611.2);
    assert.equal(noProof.by, "Brinneshiel");
    assert.equal(noProof.date, "2026-09-24");
    assert.equal(noProof.source, "liquidate-button");
    assert.equal(L.liquidationOf(closed, null, 1).status, "Liquidated");
    assert.equal(L.liquidationOf(Object.assign({}, closed, { fuelPhotos: { receipt: true } }), null, 0).status, "Liquidated");
  });
  it("excludes cancelled, duplicate and not-yet-approved VRFs", () => {
    for (const st of ["Cancelled", "Duplicate", "Requested", "Draft", "Rejected"]) {
      assert.equal(L.liquidationOf({ vrf: "1", status: st, total: 10 }, null, 0).status, "Excluded", st);
    }
    assert.equal(L.liquidationOf({ vrf: "1", status: "Closed", liq: { at: "2026-09-01", outcome: "cancelled" } }, null, 0).status, "Excluded");
  });
  it("treats an old-workbook ledger VRF as liquidated on paper", () => {
    const s = L.liquidationOf({ vrf: "4000", status: "Legacy", legacy: true, rows: [{ total: 100 }] }, null, 0);
    assert.equal(s.status, "Liquidated");
    assert.equal(s.legacy, true);
  });
  it("asks for a withdrawal slip on fuel drawn from the reserve", () => {
    assert.equal(L.proofLabel({ kind: "fuel-issue" }), "withdrawal slip");
    assert.equal(L.proofLabel({ rows: [{ work: "FUEL-RES" }] }), "withdrawal slip");
    assert.equal(L.proofLabel({ rows: [{ supplier: "FUEL RESERVE" }] }), "withdrawal slip");
    assert.equal(L.proofLabel({ rows: [{ work: "FUEL-STN" }] }), "receipt / OR");
    assert.equal(L.proofLabel({ kind: "fuel-issue", rows: [{ work: "FUEL-STN", supplier: "Kapitan" }] }), "receipt / OR");
  });
});

describe("Unliquidated view", () => {
  const entries = [
    openVrf,
    { vrf: "6050", status: "Open", total: 1200, approvedAt: "2026-09-28", requestedBy: "Ana", veh: "BH-09", rows: [{ total: 1200 }] },
    { vrf: "6060", status: "Cancelled", total: 900, approvedAt: "2026-09-01" },
    { vrf: "6070", status: "Closed", total: 400, approvedAt: "2026-10-02", liq: { at: "2026-10-03", by: "B" }, rows: [{ total: 400 }] },
  ];
  const rows = L.unliquidatedRows(entries, {}, { "6070": 1 }, { today: "2026-11-01" });
  it("lists only non-excluded, not fully liquidated VRFs, overdue first", () => {
    assert.deepEqual(rows.map((r) => r.vrf), ["6050", "6100"]);
    assert.equal(rows[0].overdue, true);
    assert.equal(rows[0].due, "2026-09-30");
    assert.equal(rows[0].age, 34);
    assert.equal(rows[1].overdue, true);
  });
  it("is not overdue inside the approval month and counts days to month-end", () => {
    const r = L.unliquidatedRows([Object.assign({}, openVrf, { approvedAt: "2026-11-01" })], {}, {}, { today: "2026-11-01" });
    assert.equal(r[0].overdue, false);
    assert.equal(r[0].daysToDue, 29);
  });
  it("filters by age, requester, unit and month and totals", () => {
    assert.deepEqual(L.filterRows(rows, { requester: "Ana" }).map((r) => r.vrf), ["6050"]);
    assert.deepEqual(L.filterRows(rows, { unit: "DT-06" }).map((r) => r.vrf), ["6100"]);
    assert.deepEqual(L.filterRows(rows, { month: "2026-10" }).map((r) => r.vrf), ["6100"]);
    assert.deepEqual(L.filterRows(rows, { age: "16-30" }).map((r) => r.vrf), ["6100"]);
    assert.deepEqual(L.filterRows(rows, { age: "31+" }).map((r) => r.vrf), ["6050"]);
    const t = L.totals(rows);
    assert.equal(t.count, 2);
    assert.equal(t.outstanding, 6200);
    assert.equal(t.overdueOutstanding, 6200);
  });
  it("counts per status for the backfill dry run", () => {
    const c = L.countByStatus(entries.concat([{ vrf: "1", status: "Legacy", legacy: true, rows: [{ total: 5 }] }]), {}, { "6070": 1 });
    assert.deepEqual(c, { Unliquidated: 2, "Partially liquidated": 0, Liquidated: 1, "Liquidated (legacy)": 1, Excluded: 1 });
  });
});

describe("liquidation record", () => {
  it("validates and keeps history", () => {
    assert.throws(() => L.buildLiqRecord({}, { amount: "", by: "B", date: "2026-10-01" }), /amount/);
    assert.throws(() => L.buildLiqRecord({}, { amount: 5, by: "", date: "2026-10-01" }), /name/);
    assert.throws(() => L.buildLiqRecord({}, { amount: 5, by: "B", date: "" }), /date/);
    const a = L.buildLiqRecord({}, { vrf: "6100", amount: "₱1,250.50", by: " B ", date: "2026-10-20", financeRefs: ["CA-2026-0001", " "] });
    assert.equal(a.amount, 1250.5);
    assert.equal(a.by, "B");
    assert.deepEqual(a.financeRefs, ["CA-2026-0001"]);
    const b = L.buildLiqRecord(a, { amount: 1300, by: "C", date: "2026-10-21" });
    assert.equal(b.history.length, 1);
    assert.deepEqual(b.financeRefs, ["CA-2026-0001"]);
    assert.equal(L.liqDocId("61/00"), "liq-61_00");
    assert.equal(L.liqOwner("6100"), "LIQ-6100");
  });
  it("accepts PDFs up to 3 MB", () => {
    assert.equal(L.isPdfFile({ type: "application/pdf", name: "x" }), true);
    assert.equal(L.isPdfFile({ type: "", name: "OR.PDF" }), true);
    assert.equal(L.pdfTooLarge({ size: 2 * 1048576 }), "");
    assert.match(L.pdfTooLarge({ size: 5 * 1048576 }), /5 MB/);
  });
});

describe("Finance link", () => {
  it("finds receipts through cash advances and typed references, read-only", async () => {
    const calls = [];
    const io = { get: async (a) => {
      calls.push(a);
      if (a.path.endsWith("finance_cash_advances")) return [{ id: "ca1", ca_no: "CA-2026-0001", motorpool_source_id: "6100" }];
      if (a.path.endsWith("finance_liquidation_receipts") && /advance_id/.test(a.query)) return [{ id: "r1", advance_id: "ca1", amount: 1000 }, { id: "r2", advance_id: "ca1", amount: "250.5" }];
      if (a.path.endsWith("finance_liquidation_receipts")) return [{ id: "r2", advance_id: "ca1", amount: 250.5 }];
      return [];
    } };
    const r = await financeLiquidationForVrf("6100", ["r2", "bad'ref;"], io);
    assert.equal(r.available, true);
    assert.equal(r.receipts.length, 2);
    assert.equal(r.receiptTotal, 1250.5);
    assert.deepEqual(r.refs, ["r2"]);
    assert.ok(calls.every((c) => !c.method || c.method === "GET"));
    assert.match(decodeURIComponent(calls[0].query), /motorpool_source_id\.in\.\("6100","VRF-6100"/);
  });
  it("answers available:false when Finance tables are missing", async () => {
    const io = { get: async () => { const e = new Error("x"); e.missing = true; throw e; } };
    const r = await financeLiquidationForVrf("6100", ["CA-1"], io);
    assert.equal(r.available, false);
    assert.deepEqual(r.refs, ["CA-1"]);
  });
  it("rejects a bad VRF number", async () => {
    const r = await financeLiquidationForVrf("1;drop", [], { get: async () => { throw new Error("should not query"); } });
    assert.equal(r.available, false);
  });
});

describe("portal wiring", () => {
  it("adds the proof tab, Unliquidated view, script and db op", () => {
    assert.match(html, /<script src="\/vrf-liquidation.js"><\/script>/);
    assert.match(html, /\{id:"unliq",\s+ic:"[^"]+", label:"Unliquidated"\}/);
    assert.match(html, /unliq:unliqView/);
    assert.match(html, /tabDefs\.push\(\["proof","Receipts & proof"/);
    assert.match(html, /tab==="proof"\)\{\s*liqProofPanel\(entry, body/);
    assert.match(html, /addPhoto\(owner,\{caption/);
    assert.match(html, /S\.db\.doc\("ops\/"\+VL\.liqDocId\(no\)\)\.set\(rec\)/);
    assert.match(shim, /financeLiq: function \(vrf, refs\)/);
    assert.match(dbFn, /op === "financeLiq"/);
  });
  it("does not change the existing Liquidate tab", () => {
    assert.match(html, /tabDefs\.push\(\["liq","Liquidate"\+\(vrfCanLiquidate\(entry\)\?" ●":""\)\]\)/);
  });
});
