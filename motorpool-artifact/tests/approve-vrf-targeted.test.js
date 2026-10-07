"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { approvePendingVrf, createMemoryStore } = require("../netlify/lib/approve-from-hold");
const { approveReserveFilter, planCollectionWrites } = require("../netlify/lib/supabase");

function line(over) {
  return Object.assign(
    { cat: "FILTER — Oil", item: "Oil filter", qty: 1, price: 12500, unit: "pc", supplier: "315", work: "PM" },
    over || {}
  );
}

function hold(over) {
  return Object.assign(
    {
      no: "12",
      vrfNo: "5893",
      date: "2026-09-18",
      kind: "job",
      veh: "MC-01",
      work: "PM",
      project: "HH-STAFF-2026",
      budget: 12500,
      requestedBy: "Jun Cruz",
      status: "Requested",
      approvedBudget: null,
      approvedBy: "",
      approvedAt: "",
      vrfs: [],
      draftLines: [line(), line({ cat: "Fuel — Diesel", item: "Diesel", qty: 10, price: 60, unit: "L" })],
      draftPurpose: "service",
      draftOdo: "45210",
    },
    over || {}
  );
}

function reserveRecord(row, stamp) {
  return {
    id: "reserve:" + row.no,
    kind: "reserve",
    reserve_no: String(row.no),
    vrf_no: String(row.vrfNo || ""),
    live: String(row.status || "") !== "Rejected",
    year: String(row.date || "2026").slice(0, 4),
    month: null,
    data: JSON.parse(JSON.stringify(row)),
    updated_at: stamp || "t0",
  };
}

function ledgerRecord(vrf, month, rows, stamp) {
  return {
    id: "ledger:" + vrf,
    kind: "ledger",
    reserve_no: rows[0] ? String(rows[0].reserve || "") : null,
    vrf_no: String(vrf),
    live: false,
    year: String(month).slice(0, 4),
    month,
    data: { month, vrf: String(vrf), rows: rows || [] },
    updated_at: stamp || "t0",
  };
}

/**
 * In-memory motorpool_records. readApproveRecords returns only the rows the
 * key names. Writes are recorded so a test can see that the other ~200 rows
 * were not patched.
 */
function createRecordsStore(seed, options) {
  options = options || {};
  const records = {};
  (seed || []).forEach((rec) => {
    records[rec.id] = JSON.parse(JSON.stringify(rec));
  });
  const writes = [];
  const store = {
    writes,
    records,
    async readApproveRecords(key) {
      let reserves = Object.values(records).filter((rec) => rec.kind === "reserve");
      if (key.kind === "reserve") {
        reserves = reserves.filter((rec) => String(rec.reserve_no) === String(key.no));
      } else {
        const byVrf = reserves.filter((rec) => String(rec.vrf_no) === String(key.no));
        reserves = byVrf.length || !key.bareNumber ? byVrf : reserves.filter((rec) => String(rec.reserve_no) === String(key.no));
      }
      const vrf =
        key.kind === "vrf"
          ? String(key.no)
          : reserves[0]
            ? String(reserves[0].vrf_no || "")
            : "";
      if (vrf && key.kind === "reserve") {
        const claimants = Object.values(records).filter(
          (rec) => rec.kind === "reserve" && String(rec.vrf_no) === vrf
        );
        const seen = {};
        reserves.concat(claimants).forEach((rec) => {
          seen[rec.id] = rec;
        });
        reserves = Object.values(seen);
      }
      const ledger = vrf ? records["ledger:" + vrf] : null;
      const rows = ledger && ledger.data && Array.isArray(ledger.data.rows) ? ledger.data.rows : [];
      const month = (ledger && ledger.month) || (reserves[0] && String(reserves[0].data.date || "").slice(0, 7)) || null;
      return {
        reserves: reserves.map((rec) => JSON.parse(JSON.stringify(rec.data))),
        ledgerRows: JSON.parse(JSON.stringify(rows)),
        ledgerByMonth: month ? { [month]: JSON.parse(JSON.stringify(rows)) } : {},
        ledgerMonths: month ? [month] : [],
        ledgerIndexDirty: false,
        vehicles: { rows: [{ code: "MC-01", desc: "Hilux" }] },
        parts: { rows: [{ cat: "FILTER — Oil", sub: "Filters" }, { cat: "Fuel — Diesel", sub: "Fuel" }] },
        records: true,
      };
    },
    async approveAtomic(spec) {
      if (options.missingRpc) {
        const err = new Error("Could not find the function public.motorpool_approve_vrf");
        err.code = "missing_rpc";
        throw err;
      }
      return applySpec(records, writes, spec, "rpc");
    },
    async putLedgerRecord(spec) {
      writes.push("fallback-ledger:" + spec.vrf);
      const id = "ledger:" + spec.vrf;
      const existing = records[id];
      const have = existing && existing.data && existing.data.rows ? existing.data.rows : [];
      if (have.length) return { wrote: false, ledgerLines: have.length };
      records[id] = ledgerRecord(spec.vrf, spec.month, spec.rows, "t-ledger");
      if (spec.reserveNo) records[id].reserve_no = String(spec.reserveNo);
      return { wrote: true, ledgerLines: (spec.rows || []).length };
    },
    async putReserveRecord(spec) {
      writes.push("fallback-reserve:" + spec.reserveNo);
      const id = "reserve:" + spec.reserveNo;
      const existing = records[id];
      if (!existing) throw new Error("missing reserve " + id);
      existing.data = JSON.parse(JSON.stringify(spec.reserve));
      existing.updated_at = "t-reserve";
      return { wrote: true };
    },
    async sealIssued(entry) {
      const id = "issued:" + entry.no + "@" + entry.reserveNo;
      if (records[id]) return { wrote: false };
      writes.push(id);
      records[id] = { id, kind: "issued", updated_at: "t-issued", data: entry };
      return { wrote: true };
    },
  };
  return store;
}

function applySpec(records, writes, spec) {
  const ledgerId = "ledger:" + spec.vrf;
  const reserveId = "reserve:" + spec.reserveNo;
  let lines = 0;
  if (spec.writeLedger) {
    const existing = records[ledgerId];
    const have = existing && existing.data && Array.isArray(existing.data.rows) ? existing.data.rows : [];
    if (!have.length) {
      records[ledgerId] = ledgerRecord(spec.vrf, spec.month, spec.rows, "t-ledger");
      records[ledgerId].reserve_no = String(spec.reserveNo);
      writes.push(ledgerId);
      lines = (spec.rows || []).length;
    } else {
      lines = have.length;
    }
  } else if (records[ledgerId] && records[ledgerId].data && records[ledgerId].data.rows) {
    lines = records[ledgerId].data.rows.length;
  }
  if (spec.writeReserve) {
    const existing = records[reserveId];
    const next = JSON.stringify(spec.reserve);
    const prev = JSON.stringify(existing && existing.data);
    if (existing && next !== prev) {
      existing.data = JSON.parse(next);
      existing.updated_at = "t-reserve";
      writes.push(reserveId);
    }
  }
  return { ok: true, vrf: spec.vrf, reserve: spec.reserveNo, status: "Open", ledgerLines: lines };
}

function bigBook(target) {
  const records = [reserveRecord(target, "t-target")];
  for (let i = 0; i < 200; i++) {
    records.push(
      reserveRecord(
        {
          no: String(1000 + i),
          vrfNo: String(7000 + i),
          date: "2026-09-01",
          status: "Approved",
          vrfs: [String(7000 + i)],
          draftLines: [],
          approvedBy: "Office",
          approvedAt: "2026-09-01",
        },
        "t-neighbor"
      )
    );
  }
  for (let i = 0; i < 115; i++) {
    records.push(
      ledgerRecord(
        String(8000 + i),
        "2026-09",
        [{ vrf: String(8000 + i), vstatus: "Open", total: i, reserve: String(1000 + (i % 200)) }],
        "t-ledger-neighbor"
      )
    );
  }
  return records;
}

function neighborStamps(store) {
  return Object.values(store.records)
    .filter((rec) => rec.updated_at === "t-neighbor" || rec.updated_at === "t-ledger-neighbor")
    .map((rec) => rec.id + "@" + rec.updated_at)
    .sort();
}

describe("approve writes only the reserve and the ledger lines that change", () => {
  it("patches one reserve and inserts one ledger row when the RPC is installed", async () => {
    const target = hold();
    const store = createRecordsStore(bigBook(target));
    const before = neighborStamps(store);
    const out = await approvePendingVrf(store, { vrf: "5893", approvedBy: "Jeffrey" }, { now: "2026-09-18" });
    assert.equal(out.ok, true);
    assert.equal(out.vrf, "5893");
    assert.equal(out.status, "Open");
    assert.equal(out.ledgerLines, 2);
    assert.deepEqual(
      store.writes.filter((id) => id.startsWith("reserve:") || id.startsWith("ledger:")),
      ["ledger:5893", "reserve:12"]
    );
    assert.equal(store.records["reserve:12"].data.status, "Approved");
    assert.equal(store.records["reserve:12"].data.approvedBy, "Jeffrey");
    assert.ok(store.records["reserve:12"].data.approvedAt);
    assert.ok((store.records["reserve:12"].data.audit || []).some((note) => note.field === "status"));
    assert.equal(store.records["ledger:5893"].data.rows.length, 2);
    assert.equal(store.records["ledger:5893"].data.rows[0].vstatus, "Open");
    assert.deepEqual(neighborStamps(store), before);
    assert.equal(store.writes.filter((id) => id.startsWith("reserve:")).length, 1);
    assert.equal(store.writes.filter((id) => id.startsWith("ledger:") && id !== "ledger:5893").length, 0);
  });

  it("falls back ledger-first then reserve when the SQL function is not installed", async () => {
    const store = createRecordsStore(bigBook(hold()), { missingRpc: true });
    const before = neighborStamps(store);
    const out = await approvePendingVrf(store, { vrf: "5893" }, { now: "2026-09-18" });
    assert.equal(out.ok, true);
    assert.equal(out.ledgerLines, 2);
    const ledgerAt = store.writes.indexOf("fallback-ledger:5893");
    const reserveAt = store.writes.indexOf("fallback-reserve:12");
    assert.ok(ledgerAt >= 0 && reserveAt > ledgerAt);
    assert.equal(store.records["ledger:5893"].data.rows.length, 2);
    assert.equal(store.records["reserve:12"].data.status, "Approved");
    assert.deepEqual(neighborStamps(store), before);
  });
});

describe("approve heals an Approved reserve that has no ledger line", () => {
  it("posts the missing lines for VRF 5893 and does not refuse", async () => {
    const approved = hold({
      status: "Approved",
      approvedBy: "Jeffrey",
      approvedAt: "2026-09-18",
      approvedBudget: 12500,
      vrfs: ["5893"],
      approvedVia: "office",
    });
    const store = createRecordsStore(bigBook(approved));
    const out = await approvePendingVrf(store, { vrf: "5893" }, { now: "2026-09-18" });
    assert.equal(out.ok, true);
    assert.equal(out.healed, true);
    assert.equal(out.vrf, "5893");
    assert.equal(out.status, "Open");
    assert.equal(out.ledgerLines, 2);
    assert.equal(store.records["reserve:12"].data.status, "Approved");
    assert.equal(store.records["ledger:5893"].data.rows.length, 2);
    assert.equal(store.writes.includes("ledger:5893"), true);
    assert.equal(store.writes.filter((id) => id.startsWith("reserve:") && id !== "reserve:12").length, 0);
  });

  it("heals the same gap on the document store", async () => {
    const approved = hold({
      status: "Approved",
      approvedBy: "Jeffrey",
      approvedAt: "2026-09-18",
      approvedBudget: 12500,
      vrfs: ["5893"],
    });
    const store = createMemoryStore({
      "reserves/index": { years: ["2026"] },
      "reserves/2026": { year: "2026", rows: [approved] },
      "ledger/index": { months: ["2026-09"] },
      "ledger/2026-09": { month: "2026-09", rows: [] },
      "config/app": { nextVrf: 5894, nextReserve: 13, varianceTol: 0.1 },
      "master/vehicles": { rows: [{ code: "MC-01", desc: "Hilux" }] },
      "master/parts": { rows: [] },
    });
    const out = await approvePendingVrf(store, { vrf: "5893" }, { now: "2026-09-18" });
    assert.equal(out.ok, true);
    assert.equal(out.healed, true);
    assert.equal(out.ledgerLines, 2);
    const month = await store.get("ledger", "2026-09");
    assert.equal(month.rows.filter((row) => row.vrf === "5893").length, 2);
    const saved = (await store.get("reserves", "2026")).rows[0];
    assert.equal(saved.status, "Approved");
  });
});

describe("approve does not duplicate ledger lines", () => {
  it("a second call writes nothing and keeps the same lines", async () => {
    const store = createRecordsStore(bigBook(hold()));
    const first = await approvePendingVrf(store, { vrf: "5893", approvedBy: "Jeffrey" }, { now: "2026-09-18" });
    const writesAfterFirst = store.writes.slice();
    const second = await approvePendingVrf(store, { vrf: "5893", approvedBy: "Jeffrey" }, { now: "2026-09-18" });
    assert.equal(first.ledgerLines, 2);
    assert.equal(second.ok, true);
    assert.equal(second.already, true);
    assert.equal(second.ledgerLines, 2);
    assert.equal(store.records["ledger:5893"].data.rows.length, 2);
    assert.deepEqual(store.writes, writesAfterFirst);
  });

  it("marks the reserve Approved when the ledger line is already there", async () => {
    const target = hold();
    const records = bigBook(target);
    records.push(
      ledgerRecord(
        "5893",
        "2026-09",
        [
          { vrf: "5893", vstatus: "Open", total: 12500, reserve: "12" },
          { vrf: "5893", vstatus: "Open", total: 600, reserve: "12" },
        ],
        "t-existing"
      )
    );
    const store = createRecordsStore(records);
    const out = await approvePendingVrf(store, { vrf: "5893", approvedBy: "Jeffrey" }, { now: "2026-09-18" });
    assert.equal(out.ok, true);
    assert.equal(out.already, true);
    assert.equal(out.ledgerLines, 2);
    assert.equal(store.records["reserve:12"].data.status, "Approved");
    assert.equal(store.records["ledger:5893"].data.rows.length, 2);
    assert.equal(store.records["ledger:5893"].updated_at, "t-existing");
    assert.equal(store.writes.includes("ledger:5893"), false);
    assert.deepEqual(
      store.writes.filter((id) => String(id).indexOf("5893") >= 0 || id === "reserve:12"),
      ["reserve:12"]
    );
  });

  it("a repeat on the document store does not append the lines again", async () => {
    const store = createMemoryStore({
      "reserves/index": { years: ["2026"] },
      "reserves/2026": { year: "2026", rows: [hold({ vrfNo: "5812", no: "12" })] },
      "ledger/index": { months: ["2026-09"] },
      "ledger/2026-09": { month: "2026-09", rows: [] },
      "config/app": { nextVrf: 5813, nextReserve: 13, varianceTol: 0.1 },
      "master/vehicles": { rows: [{ code: "MC-01", desc: "Hilux" }] },
      "master/parts": { rows: [] },
    });
    await approvePendingVrf(store, { vrf: "5812" }, { now: "2026-09-18" });
    await approvePendingVrf(store, { vrf: "5812" }, { now: "2026-09-18" });
    const month = await store.get("ledger", "2026-09");
    assert.equal(month.rows.filter((row) => row.vrf === "5812").length, 2);
  });
});

describe("a year or month save skips unchanged records", () => {
  it("plans a write for the one reserve and the one VRF that changed", () => {
    const existingReserves = [];
    for (let i = 0; i < 200; i++) {
      const row = {
        no: String(i + 1),
        vrfNo: String(4000 + i),
        status: "Approved",
        date: "2026-09-01",
        vrfs: [String(4000 + i)],
      };
      existingReserves.push(reserveRecord(row));
    }
    const changed = JSON.parse(JSON.stringify(existingReserves[11].data));
    changed.status = "Requested";
    const incoming = existingReserves.map((rec) => JSON.parse(JSON.stringify(rec.data)));
    incoming[11] = changed;
    const reserveWrites = planCollectionWrites("reserves", "2026", { year: "2026", rows: incoming }, existingReserves);
    assert.deepEqual(
      reserveWrites.map((row) => row.id),
      ["reserve:12"]
    );

    const signed = reserveRecord(
      Object.assign({}, existingReserves[0].data, { preparedSig: "data:" + "x".repeat(120) })
    );
    signed.data.preparedSig = "data:" + "x".repeat(120);
    const signedWrites = planCollectionWrites(
      "reserves",
      "2026",
      { year: "2026", rows: [JSON.parse(JSON.stringify(signed.data))] },
      [signed]
    );
    assert.deepEqual(signedWrites, []);

    const ledgerExisting = [];
    const monthRows = [];
    for (let i = 0; i < 115; i++) {
      const vrf = String(8000 + i);
      const rows = [{ vrf, vstatus: "Open", total: i, month: "2026-09" }];
      ledgerExisting.push(ledgerRecord(vrf, "2026-09", rows));
      monthRows.push(rows[0]);
    }
    monthRows[4] = Object.assign({}, monthRows[4], { total: 999 });
    const ledgerWrites = planCollectionWrites(
      "ledger",
      "2026-09",
      { month: "2026-09", rows: monthRows },
      ledgerExisting
    );
    assert.deepEqual(
      ledgerWrites.map((row) => row.id),
      ["ledger:8004"]
    );
    const untouched = planCollectionWrites(
      "ledger",
      "2026-09",
      { month: "2026-09", rows: ledgerExisting.map((rec) => rec.data.rows[0]) },
      ledgerExisting
    );
    assert.deepEqual(untouched, []);
  });

  it("looks up one VRF instead of the whole year", () => {
    assert.equal(approveReserveFilter({ kind: "vrf", no: "5893" }), "kind=eq.reserve&vrf_no=eq.5893");
    assert.equal(approveReserveFilter({ kind: "reserve", no: "12" }), "kind=eq.reserve&reserve_no=eq.12");
    assert.doesNotMatch(approveReserveFilter({ kind: "vrf", no: "5893" }), /year=eq/);
  });
});

describe("approve migration and docs", () => {
  it("adds an additive SQL function and tells the caller what a missing function does", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/20261007000001_motorpool_approve_vrf.sql"),
      "utf8"
    );
    const docs = fs.readFileSync(path.join(__dirname, "../docs/approve-vrf-api.md"), "utf8");
    assert.match(sql, /create or replace function public\.motorpool_approve_vrf/);
    assert.match(sql, /security definer/i);
    assert.match(sql, /grant execute on function public\.motorpool_approve_vrf\(jsonb\) to service_role/);
    assert.doesNotMatch(sql, /\bdrop\b/i);
    assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
    const ledgerAt = sql.indexOf("'ledger:' || vrf");
    const reserveUpdate = sql.indexOf("set data = next_data");
    assert.ok(ledgerAt > 0 && reserveUpdate > ledgerAt);
    assert.match(sql, /is distinct from/);
    assert.match(docs, /20261007000001_motorpool_approve_vrf\.sql/);
    assert.match(docs, /ledgerLines/);
    assert.match(docs, /not installed/i);
    assert.match(docs, /ledger row first/i);
  });
});
