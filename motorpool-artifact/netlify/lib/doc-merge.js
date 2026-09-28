"use strict";

/**
 * Per-VRF ledger merge and per-reserve merge.
 * The browser sends only the VRF it is saving. This module folds those rows
 * into the latest document and leaves every other VRF untouched.
 * A version check (updated_at) retries on conflict. The last attempt writes
 * the freshly re-read merge if the version column cannot be matched.
 */

function mergeError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = code === "bad_request" ? 400 : 409;
  return err;
}

function thaw(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normNo(n) {
  return String(n == null ? "" : n).trim();
}

function rowsOf(rec) {
  const data = rec && rec.data;
  if (data && Array.isArray(data.rows)) return data.rows;
  return [];
}

function mergeLedgerRows(existing, vrfNo, incoming, mode) {
  const no = normNo(vrfNo);
  if (!no) throw mergeError("vrf_mismatch", "VRF number is required");
  (incoming || []).forEach((row) => {
    if (!row || String(row.vrf) !== no) {
      throw mergeError(
        "vrf_mismatch",
        `Refusing to write VRF ${row && row.vrf} while saving VRF ${no}`
      );
    }
  });
  const kept = (existing || []).filter((row) => !row || String(row.vrf) !== no);
  const mine = (existing || []).filter((row) => row && String(row.vrf) === no);
  const nextMine = mode === "replace" ? incoming || [] : mine.concat(incoming || []);
  return kept.concat(nextMine);
}

function reserveClaims(r) {
  const out = [];
  const seen = {};
  function add(n) {
    n = normNo(n);
    if (!n || seen[n]) return;
    seen[n] = 1;
    out.push(n);
  }
  if (r) {
    add(r.vrfNo);
    (r.vrfs || []).forEach(add);
  }
  return out;
}

function collisionsFor(rows, reserveNo) {
  const map = {};
  (rows || []).forEach((r) => {
    if (!r || String(r.status || "") === "Rejected") return;
    reserveClaims(r).forEach((no) => {
      (map[no] = map[no] || []).push(r);
    });
  });
  return Object.keys(map)
    .filter((no) => map[no].length > 1 && map[no].some((r) => String(r.no) === String(reserveNo)))
    .map((no) => ({ vrf: no, reserves: map[no] }));
}

function mergeReserveRows(existing, reserve) {
  if (!reserve || reserve.no == null || String(reserve.no) === "") {
    throw mergeError("vrf_mismatch", "Reserve number is required");
  }
  const cur = (existing || []).slice();
  const key = String(reserve.no);
  const idx = cur.findIndex((r) => r && String(r.no) === key);
  if (idx >= 0) cur[idx] = reserve;
  else cur.push(reserve);
  const clashes = collisionsFor(cur, reserve.no);
  if (clashes.length) {
    throw mergeError(
      "vrf_collision",
      `VRF ${clashes[0].vrf} is on ${clashes[0].reserves
        .map((r) => "RSV-" + r.no)
        .join(" and ")}. Not saving — a VRF number can belong to only one reserve.`
    );
  }
  return cur;
}

function bytesOf(value) {
  return Buffer.byteLength(JSON.stringify(value == null ? null : value));
}

/**
 * Browser round trips on Office → Approvals → Approve, before and after
 * the merge write. Photo copies are counted on the before path because
 * they were awaited; after, they are not on the critical path.
 */
function officeApproveTraffic(opts) {
  opts = opts || {};
  const monthRows = opts.monthRows || [];
  const yearReserves = opts.yearReserves || [];
  const newRows = opts.newRows || [];
  const reserve = opts.reserve || {};
  const month = opts.month || "2026-09";
  const year = opts.year || "2026";
  const vrf = opts.vrf || (newRows[0] && newRows[0].vrf) || "";
  const monthDoc = { month, rows: monthRows };
  const yearDoc = { year, rows: yearReserves };
  const indexDoc = { months: opts.months || [month] };
  const bundle = {
    kind: "bundle",
    month,
    vrf: String(vrf),
    rows: newRows,
    mode: "replace",
    year,
    reserve,
    ensureIndex: false,
  };
  const ack = { ok: true, kind: "bundle", vrf: String(vrf), reserveNo: String(reserve.no || ""), attempts: 1, wrote: newRows.length };
  const before = [
    { op: "GET", path: "ledger/" + month, request: 0, response: bytesOf(monthDoc) },
    { op: "SET", path: "ledger/" + month, request: bytesOf(monthDoc), response: bytesOf(monthDoc) },
    { op: "GET", path: "ledger/index", request: 0, response: bytesOf(indexDoc) },
    { op: "LIST", path: "photos", request: 0, response: 2 },
    { op: "GET", path: "reserves/" + year, request: 0, response: bytesOf(yearDoc) },
    { op: "SET", path: "reserves/" + year, request: bytesOf(yearDoc), response: bytesOf(yearDoc) },
  ];
  const after = [{ op: "POST", path: "db/merge", request: bytesOf(bundle), response: bytesOf(ack) }];
  function sum(trips) {
    return {
      roundTrips: trips.length,
      trips,
      requestBytes: trips.reduce((a, t) => a + t.request, 0),
      responseBytes: trips.reduce((a, t) => a + t.response, 0),
    };
  }
  return { before: sum(before), after: sum(after), bundle };
}

async function casWrite(io, collection, id, data, updatedAt, attempt, limit) {
  if (updatedAt && attempt < limit - 1 && io.cas) {
    await io.cas(collection, id, data, updatedAt);
    return;
  }
  await io.set(collection, id, data);
}

async function ensureMonthIndexed(io, month) {
  const rec = await io.getRecord("ledger", "index");
  const data = (rec && rec.data) || { months: [] };
  const months = Array.isArray(data.months) ? data.months.slice() : [];
  if (months.indexOf(month) >= 0) return;
  months.push(month);
  months.sort();
  await io.set("ledger", "index", { months });
}

async function withRetry(readMergeWrite) {
  const limit = 3;
  let lastErr = null;
  for (let attempt = 0; attempt < limit; attempt++) {
    try {
      return await readMergeWrite(attempt, limit);
    } catch (err) {
      if (!err || err.code !== "conflict" || attempt === limit - 1) throw err;
      lastErr = err;
    }
  }
  throw lastErr || mergeError("conflict", "The workbook changed while this VRF was saving. Try again.");
}

async function mergeLedgerDoc(spec, io) {
  const month = String(spec.month || "").trim();
  const vrf = normNo(spec.vrf);
  const mode = spec.mode === "replace" ? "replace" : "append";
  if (!month || !vrf) throw mergeError("vrf_mismatch", "VRF number and month are required");
  mergeLedgerRows([], vrf, spec.rows || [], mode);
  return withRetry(async (attempt, limit) => {
    const rec = await io.getRecord("ledger", month);
    const rows = mergeLedgerRows(rowsOf(rec), vrf, spec.rows || [], mode);
    await casWrite(io, "ledger", month, { month, rows }, rec && rec.updated_at, attempt, limit);
    if (spec.ensureIndex) await ensureMonthIndexed(io, month);
    return { ok: true, kind: "ledger", vrf, attempts: attempt + 1, wrote: (spec.rows || []).length };
  });
}

async function mergeReserveDoc(spec, io) {
  const year = String(spec.year || "").trim();
  const reserve = spec.reserve;
  if (!year) throw mergeError("vrf_mismatch", "Reserve year is required");
  return withRetry(async (attempt, limit) => {
    const rec = await io.getRecord("reserves", year);
    const rows = mergeReserveRows(rowsOf(rec), thaw(reserve));
    await casWrite(io, "reserves", year, { year, rows }, rec && rec.updated_at, attempt, limit);
    return {
      ok: true,
      kind: "reserve",
      reserveNo: String(reserve.no),
      attempts: attempt + 1,
    };
  });
}

async function mergeBundle(spec, io) {
  const month = String(spec.month || "").trim();
  const year = String(spec.year || "").trim();
  const vrf = normNo(spec.vrf);
  const mode = spec.mode === "append" ? "append" : "replace";
  if (!month || !year || !vrf) throw mergeError("vrf_mismatch", "VRF number, month, and reserve year are required");
  mergeLedgerRows([], vrf, spec.rows || [], mode);
  return withRetry(async (attempt, limit) => {
    const [monthRec, yearRec] = await Promise.all([
      io.getRecord("ledger", month),
      io.getRecord("reserves", year),
    ]);
    const ledgerRows = mergeLedgerRows(rowsOf(monthRec), vrf, spec.rows || [], mode);
    const reserveRows = mergeReserveRows(rowsOf(yearRec), thaw(spec.reserve));
    await Promise.all([
      casWrite(io, "ledger", month, { month, rows: ledgerRows }, monthRec && monthRec.updated_at, attempt, limit),
      casWrite(io, "reserves", year, { year, rows: reserveRows }, yearRec && yearRec.updated_at, attempt, limit),
    ]);
    if (spec.ensureIndex) await ensureMonthIndexed(io, month);
    return {
      ok: true,
      kind: "bundle",
      vrf,
      reserveNo: String(spec.reserve.no),
      attempts: attempt + 1,
      wrote: (spec.rows || []).length,
    };
  });
}

async function applyClientMerge(spec, io) {
  spec = spec || {};
  if (spec.kind === "ledger") return mergeLedgerDoc(spec, io);
  if (spec.kind === "reserve") return mergeReserveDoc(spec, io);
  if (spec.kind === "bundle") return mergeBundle(spec, io);
  throw mergeError("bad_request", "Merge spec kind must be ledger, reserve, or bundle");
}

module.exports = {
  applyClientMerge,
  bytesOf,
  mergeBundle,
  mergeLedgerRows,
  mergeReserveRows,
  officeApproveTraffic,
};
