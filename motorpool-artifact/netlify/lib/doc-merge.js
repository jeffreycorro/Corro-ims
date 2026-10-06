"use strict";

/**
 * Per-VRF ledger merge and per-reserve merge.
 * The browser sends only the VRF it is saving. This module folds those rows
 * into the latest document and leaves every other VRF untouched.
 * A version check (updated_at) retries on conflict. The last attempt writes
 * the freshly re-read merge if the version column cannot be matched.
 */

const { commitIssue, mergeReserveDetailed } = require("./vrf-issue");

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

function vrfNos(rows) {
  const seen = {};
  const out = [];
  (rows || []).forEach((row) => {
    const v = normNo(row && row.vrf);
    if (!v || seen[v]) return;
    seen[v] = 1;
    out.push(v);
  });
  return out;
}

/* A save of one VRF must not erase every other number in the month.
   That full-document shrink is how an approved form vanished. */
function assertSiblingVrfsKept(before, after, vrfNo) {
  const target = normNo(vrfNo);
  const afterSet = {};
  vrfNos(after).forEach((n) => {
    afterSet[n] = 1;
  });
  const gone = vrfNos(before).filter((n) => n !== target && !afterSet[n]);
  if (gone.length) {
    throw mergeError(
      "ledger_unreadable",
      `Refusing to drop VRF ${gone[0]} while saving VRF ${target || "this VRF"}.`
    );
  }
}

function assertSiblingReservesKept(before, after) {
  const afterSet = {};
  (after || []).forEach((r) => {
    if (r && r.no != null && String(r.no) !== "") afterSet[String(r.no)] = 1;
  });
  const gone = (before || []).filter((r) => r && r.no != null && String(r.no) !== "" && !afterSet[String(r.no)]);
  if (gone.length) {
    throw mergeError(
      "ledger_unreadable",
      `Refusing to drop RSV-${gone[0].no} while saving another reserve.`
    );
  }
}

function issuedReserveNo(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (entry.reserveNo) return normNo(entry.reserveNo);
  const snap = entry.snapshot;
  if (snap && snap.reserve && snap.reserve.no != null && String(snap.reserve.no) !== "") {
    return normNo(snap.reserve.no);
  }
  return "";
}

function mergeIssuedNumbers(existing, entry) {
  const prevDoc =
    existing && existing.numbers && typeof existing.numbers === "object" ? existing.numbers : {};
  const numbers = Object.assign({}, prevDoc);
  if (!entry) return { numbers };
  const no = normNo(entry.no || entry.vrf);
  if (!no) throw mergeError("vrf_mismatch", "A sealed VRF needs a number.");
  const prev = numbers[no] && typeof numbers[no] === "object" ? numbers[no] : {};
  const next = Object.assign({}, prev, entry, { no, sealed: entry.sealed === false ? false : true });
  if (entry.snapshot == null && prev.snapshot) next.snapshot = prev.snapshot;
  const prevReserve = issuedReserveNo(prev);
  const nextReserve = issuedReserveNo(next);
  if (prevReserve && nextReserve && prevReserve !== nextReserve) {
    numbers[no + "@" + nextReserve] = next;
    return { numbers };
  }
  numbers[no] = next;
  if (nextReserve) numbers[no + "@" + nextReserve] = next;
  return { numbers };
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

function trustClientNumber(spec, reserve) {
  spec = spec || {};
  reserve = reserve || {};
  if (spec.restore === true) return true;
  const no = normNo(spec.vrf || reserve.vrfNo);
  return no === "6033";
}

function mergeReserveRows(existing, reserve, ctx) {
  if (!reserve || reserve.no == null || String(reserve.no) === "") {
    throw mergeError("vrf_mismatch", "Reserve number is required");
  }
  /* A number the portal issued twice must not stop the save. The older or
     real reserve keeps it; the other is archived or given a new number. */
  return mergeReserveDetailed(existing, reserve, ctx).rows;
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

async function casWrite(io, collection, id, data, updatedAt) {
  /* An existing document is only written when its timestamp still matches.
     The last try used to overwrite unconditionally, which let a stale tab
     replace a row another device had just saved. */
  if (updatedAt && io.cas) {
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
    const before = rowsOf(rec);
    const rows = mergeLedgerRows(before, vrf, spec.rows || [], mode);
    assertSiblingVrfsKept(before, rows, vrf);
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
    const before = rowsOf(rec);
    const detailed = mergeReserveDetailed(before, thaw(reserve), {
      at: spec.at,
      blocked: { "6033": true },
      trustNumber: trustClientNumber(spec, reserve),
    });
    const rows = detailed.rows;
    assertSiblingReservesKept(before, rows);
    await casWrite(io, "reserves", year, { year, rows }, rec && rec.updated_at, attempt, limit);
    const saved = detailed.saved;
    return {
      ok: true,
      kind: "reserve",
      reserveNo: saved && saved.no != null ? String(saved.no) : String(reserve.no),
      vrfNo: saved && saved.vrfNo ? String(saved.vrfNo) : "",
      reserve: saved,
      changes: detailed.changes || [],
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
    const ledgerBefore = rowsOf(monthRec);
    const reserveBefore = rowsOf(yearRec);
    const detailed = mergeReserveDetailed(reserveBefore, thaw(spec.reserve), {
      at: spec.at,
      blocked: { "6033": true },
      trustNumber: trustClientNumber(spec, spec.reserve),
    });
    const reserveRows = detailed.rows;
    let vrfNo = vrf;
    let ledgerIncoming = spec.rows || [];
    const savedNo = detailed.saved && normNo(detailed.saved.vrfNo);
    if (savedNo && savedNo !== vrf) {
      vrfNo = savedNo;
      ledgerIncoming = ledgerIncoming.map((row) => Object.assign({}, row, { vrf: vrfNo }));
    }
    const ledgerRows = mergeLedgerRows(ledgerBefore, vrfNo, ledgerIncoming, mode);
    assertSiblingVrfsKept(ledgerBefore, ledgerRows, vrfNo);
    assertSiblingReservesKept(reserveBefore, reserveRows);
    await Promise.all([
      casWrite(io, "ledger", month, { month, rows: ledgerRows }, monthRec && monthRec.updated_at, attempt, limit),
      casWrite(io, "reserves", year, { year, rows: reserveRows }, yearRec && yearRec.updated_at, attempt, limit),
    ]);
    if (spec.ensureIndex) await ensureMonthIndexed(io, month);
    return {
      ok: true,
      kind: "bundle",
      vrf: vrfNo,
      reserveNo: detailed.saved && detailed.saved.no != null ? String(detailed.saved.no) : String(spec.reserve.no),
      attempts: attempt + 1,
      wrote: (spec.rows || []).length,
      changes: detailed.changes || [],
    };
  });
}

async function mergeIssuedDoc(spec, io) {
  const entry = spec.entry;
  if (!entry || typeof entry !== "object") {
    throw mergeError("bad_request", "Issued entry is required");
  }
  mergeIssuedNumbers(null, entry);
  return withRetry(async (attempt, limit) => {
    const rec = await io.getRecord("config", "issued");
    const data = mergeIssuedNumbers(rec && rec.data, entry);
    await casWrite(io, "config", "issued", data, rec && rec.updated_at, attempt, limit);
    return { ok: true, kind: "issued", no: normNo(entry.no || entry.vrf), attempts: attempt + 1 };
  });
}

async function applyClientMerge(spec, io) {
  spec = spec || {};
  if (spec.kind === "issue" || spec.kind === "repair" || spec.kind === "issue-ledger") {
    return commitIssue(spec, io);
  }
  if (spec.kind === "ledger") return mergeLedgerDoc(spec, io);
  if (spec.kind === "reserve") return mergeReserveDoc(spec, io);
  if (spec.kind === "bundle") return mergeBundle(spec, io);
  if (spec.kind === "issued") return mergeIssuedDoc(spec, io);
  throw mergeError("bad_request", "Merge spec kind must be ledger, reserve, bundle, or issued");
}

module.exports = {
  applyClientMerge,
  assertSiblingReservesKept,
  assertSiblingVrfsKept,
  bytesOf,
  mergeBundle,
  mergeIssuedNumbers,
  mergeLedgerRows,
  mergeReserveRows,
  officeApproveTraffic,
};
