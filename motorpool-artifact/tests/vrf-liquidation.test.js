"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
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

describe("approved under-variance", () => {
  const { mayPrint } = require("../public/fuel-audit");
  const { variancePrintBlocked, VARIANCE_PRINT_MAX } = require("../public/liquidation-print");
  const approvedBy = "Jeffrey James M. Corro";
  function row(liq) {
    return { total: 3000, work: "PMS", liq: liq };
  }
  function liq(extra) {
    return Object.assign({
      at: "2026-10-20T08:00:00",
      by: "Casey Santos",
      outcome: "bought",
      variancePending: false,
      varianceApprovedBy: approvedBy,
      varianceApprovedAt: "2026-10-21T09:00:00",
    }, extra || {});
  }
  function entry(rows, extra) {
    return Object.assign({
      vrf: "9001",
      status: "Closed",
      total: 3000,
      approvedBudget: 5000,
      approvedAt: "2026-10-05",
      requestedBy: "Casey Santos",
      veh: "DT-06",
      rows: rows,
    }, extra || {});
  }
  const record = { amount: 3000, date: "2026-10-20", by: "Casey Santos" };

  it("is Liquidated when the under-variance is approved and a receipt is on file", () => {
    const s = L.liquidationOf(entry([row(liq())]), record, 1);
    assert.equal(s.status, "Liquidated");
    assert.equal(s.approved, 5000);
    assert.equal(s.liquidated, 3000);
    assert.equal(s.outstanding, 2000);
    assert.equal(s.needs, "");
    assert.equal(s.underApproved, true);
    assert.equal(s.label, "Liquidated (₱3,000.00, under approved by ₱2,000.00, approved by Jeffrey James M. Corro)");
    assert.equal(s.title, s.label);
    const alias = L.liquidationOf(entry([row(liq({ varianceApprovedBy: "Jeffrey" }))]), record, 1);
    assert.equal(alias.status, "Liquidated");
    assert.match(alias.label, /approved by Jeffrey James M\. Corro\)/);
    const carmel = L.liquidationOf(entry([row(liq({ varianceApprovedBy: "Carmel" }))]), record, 1);
    assert.equal(carmel.status, "Liquidated");
    assert.match(carmel.label, /approved by Carmel\)/);
    const stamped = liq({
      proof: { v: 1, actual: 3000, approved: 5000, date: "2026-10-20", by: "Casey Santos" },
    });
    assert.equal(L.liquidationOf(entry([row(stamped)]), null, 0).status, "Liquidated");
    const flagged = entry([row(liq())], { fuelPhotos: { receipt: true } });
    assert.equal(L.liquidationOf(flagged, record, 0).status, "Liquidated");
    const both = L.liquidationOf(entry([
      { total: 1000, liq: liq() },
      { total: 2000, liq: liq({ varianceApprovedBy: "Carmel" }) },
    ]), record, 1);
    assert.equal(both.status, "Liquidated");
    assert.match(both.label, /approved by Jeffrey James M\. Corro, Carmel\)/);
    const listed = L.unliquidatedRows(
      [entry([row(liq())])],
      { "9001": record },
      { "9001": 1 },
      { today: "2026-11-01" }
    );
    assert.deepEqual(listed.map((r) => r.vrf), []);
    const printed = L.spendVariancePrintLines({
      approved: 5000,
      actual: 3000,
      liq: liq({ varianceExplanation: "The supplier priced it lower." }),
    });
    assert.equal(printed.approved, 5000);
    assert.equal(printed.actual, 3000);
    assert.match(printed.lines[0], /Actual spent ₱3,000\.00/);
  });

  it("stays Partially liquidated when the under-variance is not approved", () => {
    const pending = L.liquidationOf(
      entry([row(liq({ variancePending: true, varianceApprovedBy: "" }))]),
      record,
      2
    );
    assert.equal(pending.status, "Partially liquidated");
    assert.equal(pending.underApproved, false);
    assert.equal(pending.label, "");
    assert.match(pending.needs, /below approved/);
    assert.equal(pending.approved, 5000);
    const oneShort = L.liquidationOf(entry([
      { total: 1000, liq: liq() },
      { total: 2000, liq: { at: "2026-10-20", by: "Casey Santos", outcome: "bought", variancePending: true } },
    ]), record, 1);
    assert.equal(oneShort.status, "Partially liquidated");
    assert.match(oneShort.needs, /below approved/);
  });

  it("stays Partially liquidated when the approver is a bare api", () => {
    const api = L.liquidationOf(entry([row(liq({ varianceApprovedBy: "api" }))]), record, 1);
    assert.equal(api.status, "Partially liquidated");
    assert.equal(api.underApproved, false);
    assert.match(api.needs, /below approved/);
    const blank = L.liquidationOf(entry([row(liq({ varianceApprovedBy: "  " }))]), record, 1);
    assert.equal(blank.status, "Partially liquidated");
    assert.match(blank.needs, /below approved/);
  });

  it("stays Partially liquidated when the under-variance is approved but no receipt is on file", () => {
    const s = L.liquidationOf(entry([row(liq())]), record, 0);
    assert.equal(s.status, "Partially liquidated");
    assert.equal(s.underApproved, false);
    assert.equal(s.label, "");
    assert.match(s.needs, /no receipt/);
    assert.equal(s.approved, 5000);
    assert.equal(s.liquidated, 3000);
  });

  it("does not change over-variance liquidation or the print gates", () => {
    const over = L.liquidationOf(
      entry(
        [{ total: 5600, liq: { at: "2026-10-20", by: "Casey Santos", outcome: "bought", variancePending: true } }],
        { total: 5600 }
      ),
      { amount: 5600, date: "2026-10-20", by: "Casey Santos" },
      1
    );
    assert.equal(over.status, "Liquidated");
    assert.equal(over.underApproved, false);
    assert.equal(over.label, "");
    assert.equal(over.approved, 5000);
    assert.equal(VARIANCE_PRINT_MAX, 0.5);
    assert.equal(variancePrintBlocked(1000, 1600), true);
    assert.deepEqual(mayPrint({ vrf: "1", status: "Requested" }), { ok: false, message: "Not approved — cannot print" });
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
  it("shows an approved under-variance on the status label", () => {
    assert.match(html, /liqView\.underApproved&&liqView\.label/);
    assert.match(html, /L\.underApproved&&L\.label/);
    assert.match(html, /closedLiq\.underApproved&&closedLiq\.label/);
    assert.match(html, /uc\.title=liqView\.title\|\|liqView\.label/);
  });
  it("paints that label and tooltip on the status chip", () => {
    function extractFunction(src, name) {
      const needle = "function " + name + "(";
      const start = src.indexOf(needle);
      if (start < 0) throw new Error("missing " + name);
      let i = src.indexOf("{", start);
      let depth = 0;
      for (; i < src.length; i += 1) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") {
          depth -= 1;
          if (depth === 0) return src.slice(start, i + 1);
        }
      }
      throw new Error("unclosed " + name);
    }
    const approved = {
      vrf: "9001",
      status: "Closed",
      approvedBudget: 5000,
      total: 3000,
      proofCount: 1,
      rows: [{
        total: 3000,
        liq: {
          at: "2026-10-20",
          by: "Casey Santos",
          outcome: "bought",
          variancePending: false,
          varianceApprovedBy: "Jeffrey James M. Corro",
        },
      }],
    };
    const ctx = {
      VL: L,
      duplicateOfNumber() { return ""; },
      liqStatusOf(entry) {
        return L.liquidationOf(entry, { amount: entry.total, date: "2026-10-20", by: "Casey Santos" }, entry.proofCount || 0);
      },
      el(tag, className, text) {
        return { tag: tag, className: className || "", textContent: text == null ? "" : String(text), title: "" };
      },
    };
    vm.runInNewContext(
      extractFunction(html, "liqChip") + "\n" + extractFunction(html, "vrfChip") + "\nthis.liqChip=liqChip; this.vrfChip=vrfChip;",
      ctx
    );
    const view = ctx.liqStatusOf(approved);
    const chip = ctx.liqChip(view);
    assert.equal(chip.textContent, "Liquidated (₱3,000.00, under approved by ₱2,000.00, approved by Jeffrey James M. Corro)");
    assert.equal(chip.title, chip.textContent);
    assert.match(chip.className, /\bok\b/);
    const log = ctx.vrfChip(approved);
    assert.equal(log.textContent, chip.textContent);
    assert.equal(log.title, chip.textContent);
    const full = {
      status: "Closed",
      approvedBudget: 5000,
      total: 5000,
      proofCount: 1,
      rows: [{ total: 5000, liq: { at: "2026-10-20", by: "Casey Santos", outcome: "bought" } }],
    };
    const plain = ctx.vrfChip(full);
    assert.equal(plain.textContent, "Liquidated");
    assert.equal(plain.title, "");
    const missing = Object.assign({}, approved, { proofCount: 0 });
    assert.equal(ctx.vrfChip(missing).textContent, L.NO_RECEIPT_LABEL);
  });
});
