"use strict";

function supabaseUrl() {
  return (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
}

function serviceRole() {
  return (
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

function anonKey() {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  );
}

function requireServiceConfig() {
  const url = supabaseUrl();
  const key = serviceRole();
  if (!url || !key) {
    const err = new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set on this Netlify site"
    );
    err.statusCode = 500;
    throw err;
  }
  return { url, key };
}

async function rest({ method, path, query, body, prefer }) {
  const { url, key } = requireServiceConfig();
  const qs = query ? `?${query}` : "";
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  if (prefer) headers.prefer = prefer;
  const res = await fetch(`${url}${path}${qs}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  if (!res.ok) {
    const err = new Error(
      (json && (json.message || json.error_description || json.error)) ||
        `Supabase ${res.status}`
    );
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.details = json;
    throw err;
  }
  return json;
}

const LIST_BYTE_CAP = 450000;
let recordsPrimaryCache = false;

function isMissingRelation(err) {
  const details = err && err.details;
  const code = details && (details.code || "");
  const msg = String((err && err.message) || "") + " " + String((details && details.message) || "");
  return code === "42P01" || code === "PGRST205" || /could not find the table|could not find the relation|schema cache/i.test(msg);
}

function isMissingRpc(err) {
  const details = err && err.details;
  const code = details && (details.code || "");
  const msg = String((err && err.message) || "");
  return code === "PGRST202" || (err && err.statusCode === 404) || /could not find the function|schema cache/i.test(msg);
}

function isReloadPage(err) {
  return /Reload the page/i.test(String((err && err.message) || ""));
}

function isYearOrMonth(collection, id) {
  if (collection === "reserves" && /^\d{4}$/.test(String(id))) return true;
  if (collection === "ledger" && /^\d{4}-\d{2}$/.test(String(id))) return true;
  return false;
}

function stripSigObject(row) {
  if (!row || typeof row !== "object") return row;
  const copy = Object.assign({}, row);
  ["preparedSig", "checkedSig", "approvedSig"].forEach((key) => {
    if (typeof copy[key] === "string" && copy[key].length > 80) {
      if (!copy[key + "Ref"]) copy[key + "Ref"] = copy[key + "Name"] || key;
      delete copy[key];
    }
  });
  return copy;
}

function stripLongStrings(value) {
  if (Array.isArray(value)) return value.map(stripLongStrings);
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 2000) return "";
    return value;
  }
  const out = {};
  Object.keys(value).forEach((key) => {
    out[key] = stripLongStrings(value[key]);
  });
  return out;
}

function slimDocData(collection, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (collection === "photos") return data;
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(data));
  } catch (e) {
    return data;
  }
  if (Array.isArray(copy.rows)) copy.rows = copy.rows.map(stripSigObject);
  if (Buffer.byteLength(JSON.stringify(copy)) > LIST_BYTE_CAP) {
    copy = stripLongStrings(copy);
    copy.slimmed = true;
  }
  return copy;
}

async function fetchDoc(collection, id) {
  const rows = await rest({
    method: "GET",
    path: "/rest/v1/motorpool_docs",
    query: `collection=eq.${encodeURIComponent(collection)}&id=eq.${encodeURIComponent(id)}&select=collection,id,data,updated_at`,
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function recordsProbe(query) {
  return rest({
    method: "GET",
    path: "/rest/v1/motorpool_records",
    query,
  });
}

async function recordsAvailable() {
  if (recordsPrimaryCache) return true;
  try {
    await recordsProbe("select=id&limit=1");
    return true;
  } catch (err) {
    if (isMissingRelation(err)) return false;
    throw err;
  }
}

async function recordsPrimary() {
  if (recordsPrimaryCache) return true;
  try {
    const rows = await recordsProbe("kind=eq.reserve&select=id&limit=1");
    if (Array.isArray(rows) && rows.length) {
      recordsPrimaryCache = true;
      return true;
    }
    return false;
  } catch (err) {
    if (isMissingRelation(err)) return false;
    throw err;
  }
}

async function listRecordPage(filter) {
  const rows = [];
  const page = 200;
  for (let offset = 0; offset < 20000; offset += page) {
    const batch = await rest({
      method: "GET",
      path: "/rest/v1/motorpool_records",
      query: `${filter}&select=id,kind,reserve_no,vrf_no,live,year,month,data,updated_at&order=id.asc&limit=${page}&offset=${offset}`,
    });
    const list = Array.isArray(batch) ? batch : [];
    list.forEach((row) => rows.push(row));
    if (list.length < page) break;
  }
  return rows;
}

function maxUpdated(rows) {
  let max = null;
  (rows || []).forEach((row) => {
    const at = row && row.updated_at;
    if (at && (!max || String(at) > String(max))) max = at;
  });
  return max;
}

function issuedIdentity(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (entry.reserveNo) return String(entry.reserveNo);
  const snap = entry.snapshot;
  if (snap && snap.reserve && snap.reserve.no != null && String(snap.reserve.no) !== "") {
    return String(snap.reserve.no);
  }
  return "";
}

async function docFromRecords(collection, id) {
  if (collection === "reserves" && /^\d{4}$/.test(String(id))) {
    const recs = await listRecordPage("kind=eq.reserve&year=eq." + encodeURIComponent(id));
    return {
      collection,
      id,
      data: { year: String(id), rows: recs.map((rec) => rec.data).filter(Boolean) },
      updated_at: maxUpdated(recs),
    };
  }
  if (collection === "ledger" && /^\d{4}-\d{2}$/.test(String(id))) {
    const recs = await listRecordPage("kind=eq.ledger&month=eq." + encodeURIComponent(id));
    const rows = [];
    recs.forEach((rec) => {
      const data = rec && rec.data;
      (data && data.rows ? data.rows : []).forEach((row) => rows.push(row));
    });
    return { collection, id, data: { month: String(id), rows }, updated_at: maxUpdated(recs) };
  }
  if (collection === "config" && String(id) === "issued") {
    const blob = await fetchDoc("config", "issued");
    const recs = await listRecordPage("kind=eq.issued");
    const numbers = Object.assign({}, (blob && blob.data && blob.data.numbers) || {});
    recs.forEach((rec) => {
      const entry = (rec && rec.data) || {};
      const no = String(entry.no || rec.vrf_no || "").trim();
      const reserveNo = String(entry.reserveNo || rec.reserve_no || "").trim();
      if (!no) return;
      const compound = reserveNo ? no + "@" + reserveNo : no;
      const current = numbers[no];
      const currentReserve = issuedIdentity(current);
      if (current && currentReserve && reserveNo && currentReserve !== reserveNo) {
        if (!numbers[compound]) numbers[compound] = entry;
        return;
      }
      if (!numbers[compound]) numbers[compound] = entry;
      if (!numbers[no]) numbers[no] = entry;
    });
    return {
      collection: "config",
      id: "issued",
      data: { numbers },
      updated_at: maxUpdated(recs) || (blob && blob.updated_at) || null,
    };
  }
  return null;
}

async function getDoc(collection, id) {
  if (await recordsPrimary()) {
    const made = await docFromRecords(collection, id);
    if (made) return made;
  }
  const row = await fetchDoc(collection, id);
  if (!row) return null;
  if (collection === "reserves" || collection === "ledger") {
    return Object.assign({}, row, { data: slimDocData(collection, row.data) });
  }
  return row;
}

const PATCH_KEEP = {
  no: true,
  vrfNo: true,
  preparedSig: true,
  checkedSig: true,
  approvedSig: true,
  renumberNote: true,
  printedAs: true,
};

async function readRecord(id) {
  const rows = await rest({
    method: "GET",
    path: "/rest/v1/motorpool_records",
    query: `id=eq.${encodeURIComponent(id)}&select=id,kind,reserve_no,vrf_no,live,year,month,data,updated_at`,
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        if (value[key] !== undefined) out[key] = canon(value[key]);
      });
    return out;
  }
  return value;
}

function comparableData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const copy = Object.assign({}, data);
  ["preparedSig", "checkedSig", "approvedSig"].forEach((key) => {
    if (typeof copy[key] === "string" && copy[key].length > 80) delete copy[key];
  });
  return copy;
}

function sameJson(a, b) {
  return JSON.stringify(canon(comparableData(a))) === JSON.stringify(canon(comparableData(b)));
}

function col(value) {
  return value == null ? "" : String(value);
}

function sameStoredRecord(existing, next) {
  if (!existing || !next) return false;
  if (col(existing.vrf_no) !== col(next.vrf_no)) return false;
  if (Boolean(existing.live) !== Boolean(next.live)) return false;
  if (col(existing.year) !== col(next.year)) return false;
  if (col(existing.month) !== col(next.month)) return false;
  if (col(existing.reserve_no) !== col(next.reserve_no)) return false;
  return sameJson(existing.data, next.data);
}

function isDuplicate(err) {
  const details = err && err.details;
  const code = details && details.code;
  return code === "23505" || (err && err.statusCode === 409);
}

function reserveIsLive(row) {
  const status = String((row && row.status) || "");
  return !(status === "Rejected" || status === "Archived" || (row && row.archived === true));
}

/**
 * The row that would be stored for one reserve. Long signatures are left off
 * the write. An existing vrf number, audit trail, and renumber note are kept
 * when the incoming copy is thinner.
 */
function nextReserveWrite(row, year, existing) {
  if (!row || row.no == null || String(row.no) === "") return null;
  const id = "reserve:" + row.no;
  if (existing) {
    const prev = existing.data || {};
    const next = Object.assign({}, prev);
    Object.keys(row).forEach((key) => {
      if (PATCH_KEEP[key]) return;
      next[key] = row[key];
    });
    next.no = prev.no != null ? prev.no : row.no;
    next.vrfNo =
      prev.vrfNo != null && String(prev.vrfNo) !== "" ? prev.vrfNo : existing.vrf_no || row.vrfNo || "";
    if ((prev.audit || []).length > (next.audit || []).length) next.audit = prev.audit;
    if (prev.renumberNote) next.renumberNote = prev.renumberNote;
    if (prev.printedAs) next.printedAs = prev.printedAs;
    ["preparedSig", "checkedSig", "approvedSig"].forEach((key) => {
      if (typeof next[key] === "string" && next[key].length > 80) delete next[key];
    });
    return {
      id,
      kind: "reserve",
      reserve_no: String(existing.reserve_no || next.no),
      vrf_no: String(next.vrfNo || existing.vrf_no || ""),
      live: reserveIsLive(next),
      year: String(year || existing.year || ""),
      month: existing.month == null ? null : existing.month,
      data: next,
    };
  }
  const fresh = stripSigObject(Object.assign({}, row));
  return {
    id,
    kind: "reserve",
    reserve_no: String(fresh.no),
    vrf_no: String(fresh.vrfNo || ""),
    live: reserveIsLive(fresh),
    year: String(year || ""),
    month: null,
    data: fresh,
  };
}

function nextLedgerWrite(vrf, month, rows, existing, reserveNo) {
  const data = { month: String(month), vrf: String(vrf), rows: rows || [] };
  const linked = reserveNo || (existing && existing.reserve_no) || null;
  return {
    id: "ledger:" + vrf,
    kind: "ledger",
    reserve_no: linked == null || linked === "" ? null : String(linked),
    vrf_no: String(vrf),
    live: false,
    year: String(month).slice(0, 4),
    month: String(month),
    data,
  };
}

function ledgerUnchanged(existing, next) {
  if (!existing || !next) return false;
  if (col(existing.month) !== col(next.month)) return false;
  if (col(existing.vrf_no) !== col(next.vrf_no)) return false;
  return sameJson(existing.data, next.data);
}

/**
 * Which per-record rows a year or month document would actually change.
 * Callers that still save a whole document use this so an untouched VRF
 * is not patched and its updated_at stays put.
 */
function planCollectionWrites(collection, id, data, existingRecs) {
  const payload = data && typeof data === "object" ? data : {};
  const existing = existingRecs || [];
  const writes = [];
  if (collection === "reserves") {
    const byNo = {};
    existing.forEach((rec) => {
      if (rec && rec.reserve_no != null && String(rec.reserve_no) !== "") byNo[String(rec.reserve_no)] = rec;
    });
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    rows.forEach((row) => {
      const prev = byNo[String(row && row.no)];
      const next = nextReserveWrite(row, id, prev);
      if (!next) return;
      if (prev && sameStoredRecord(prev, next)) return;
      writes.push(next);
    });
    return writes;
  }
  if (collection === "ledger") {
    const byVrf = {};
    existing.forEach((rec) => {
      const vrf = String((rec && (rec.vrf_no || (rec.data && rec.data.vrf))) || "").trim();
      if (vrf) byVrf[vrf] = rec;
    });
    const groups = {};
    (Array.isArray(payload.rows) ? payload.rows : []).forEach((row) => {
      const vrf = String((row && row.vrf) || "").trim();
      if (!vrf) return;
      (groups[vrf] = groups[vrf] || []).push(row);
    });
    Object.keys(groups).forEach((vrf) => {
      const prev = byVrf[vrf];
      const reserveNo = (groups[vrf][0] && groups[vrf][0].reserve) || (prev && prev.reserve_no) || null;
      const next = nextLedgerWrite(vrf, id, groups[vrf], prev, reserveNo);
      if (ledgerUnchanged(prev, next)) return;
      writes.push(next);
    });
  }
  return writes;
}

async function writeRecord(row, exists) {
  if (exists) {
    await rest({
      method: "PATCH",
      path: "/rest/v1/motorpool_records",
      query: `id=eq.${encodeURIComponent(row.id)}`,
      prefer: "return=minimal",
      body: {
        data: row.data,
        live: row.live,
        vrf_no: row.vrf_no,
        reserve_no: row.reserve_no,
        year: row.year,
        month: row.month,
      },
    });
    return;
  }
  await rest({
    method: "POST",
    path: "/rest/v1/motorpool_records",
    prefer: "return=minimal",
    body: row,
  });
}

async function upsertReserveRecord(row, year) {
  if (!row || row.no == null || String(row.no) === "") return { wrote: false };
  const existing = await readRecord("reserve:" + row.no);
  const next = nextReserveWrite(row, year, existing);
  if (!next) return { wrote: false };
  if (existing && sameStoredRecord(existing, next)) {
    return {
      wrote: false,
      id: next.id,
      data: next.data,
      reserveNo: next.reserve_no,
      vrfNo: next.vrf_no,
    };
  }
  await writeRecord(next, !!existing);
  return { wrote: true, id: next.id, data: next.data, reserveNo: next.reserve_no, vrfNo: next.vrf_no };
}

async function upsertLedgerRecord(vrf, month, rows, reserveNo) {
  const existing = await readRecord("ledger:" + vrf);
  const have = existing && existing.data && Array.isArray(existing.data.rows) ? existing.data.rows : [];
  /* Lines already stored for this VRF stay as they are. Approve must not
     append a second copy, and it must not bump updated_at on a repeat call. */
  if (have.length) return { wrote: false, ledgerLines: have.length };
  const next = nextLedgerWrite(vrf, month, rows, existing, reserveNo);
  if (ledgerUnchanged(existing, next)) return { wrote: false, ledgerLines: have.length };
  try {
    await writeRecord(next, !!existing);
  } catch (err) {
    if (!existing && isDuplicate(err)) return { wrote: false, ledgerLines: (rows || []).length };
    throw err;
  }
  return { wrote: true, ledgerLines: (rows || []).length, id: next.id };
}

async function upsertBlobRows(collection, id, data) {
  if (collection !== "reserves" && collection !== "ledger") return;
  const filter =
    collection === "reserves"
      ? "kind=eq.reserve&year=eq." + encodeURIComponent(id)
      : "kind=eq.ledger&month=eq." + encodeURIComponent(id);
  const existing = await listRecordPage(filter);
  const writes = planCollectionWrites(collection, id, data, existing);
  for (let i = 0; i < writes.length; i++) {
    const row = writes[i];
    const exists = existing.some((rec) => rec && rec.id === row.id);
    await writeRecord(row, exists);
  }
}

function approveReserveFilter(key) {
  const no = encodeURIComponent(String(key.no));
  if (key.kind === "reserve") return "kind=eq.reserve&reserve_no=eq." + no;
  return "kind=eq.reserve&vrf_no=eq." + no;
}

function unionRecords(left, right) {
  const byId = {};
  (left || []).concat(right || []).forEach((rec) => {
    if (rec && rec.id) byId[rec.id] = rec;
  });
  return Object.keys(byId).map((id) => byId[id]);
}

async function queryReserves(key) {
  if (!key) return [];
  if (key.kind === "reserve") return listRecordPage(approveReserveFilter(key));
  const byVrf = await listRecordPage(approveReserveFilter(key));
  if (byVrf.length || !key.bareNumber) return byVrf;
  return listRecordPage("kind=eq.reserve&reserve_no=eq." + encodeURIComponent(String(key.no)));
}

function monthFromReserve(rec) {
  const date = rec && rec.data && rec.data.date;
  const match = /^(\d{4})-(\d{2})/.exec(String(date || ""));
  return match ? match[1] + "-" + match[2] : null;
}

/**
 * The one reserve (plus any other reserve that claims the same VRF) and the
 * one ledger row. Approving must not download the rest of the year.
 */
async function readApproveSlice(key) {
  if (!key) return null;
  let primary = false;
  try {
    primary = await recordsPrimary();
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
  if (!primary) return null;

  let reserveRecs = await queryReserves(key);
  let vrf = key.kind === "vrf" ? String(key.no) : "";
  if (!vrf && reserveRecs.length === 1) {
    vrf = String(reserveRecs[0].vrf_no || (reserveRecs[0].data && reserveRecs[0].data.vrfNo) || "");
  }
  if (vrf && key.kind === "reserve") {
    const claimants = await queryReserves({ kind: "vrf", no: vrf, bareNumber: false });
    reserveRecs = unionRecords(reserveRecs, claimants);
  }
  const ledgerRec = vrf ? await readRecord("ledger:" + vrf) : null;
  const ledgerRows =
    ledgerRec && ledgerRec.data && Array.isArray(ledgerRec.data.rows) ? ledgerRec.data.rows : [];
  const month = (ledgerRec && ledgerRec.month) || monthFromReserve(reserveRecs[0]);
  const [vehiclesRec, partsRec] = await Promise.all([
    fetchDoc("master", "vehicles"),
    fetchDoc("master", "parts"),
  ]);
  const ledgerByMonth = {};
  if (month) ledgerByMonth[month] = ledgerRows.slice();
  return {
    reserves: reserveRecs.map((rec) => rec && rec.data).filter(Boolean),
    ledgerRows: ledgerRows.slice(),
    ledgerByMonth,
    ledgerMonths: month ? [month] : [],
    ledgerIndexDirty: false,
    vehicles: (vehiclesRec && vehiclesRec.data) || { rows: [] },
    parts: (partsRec && partsRec.data) || { rows: [] },
    records: true,
  };
}

async function approveVrfRecord(spec) {
  try {
    return await rest({
      method: "POST",
      path: "/rest/v1/rpc/motorpool_approve_vrf",
      body: { p_spec: spec || {} },
    });
  } catch (err) {
    if (isMissingRpc(err)) {
      const missing = new Error((err && err.message) || "motorpool_approve_vrf is not installed");
      missing.code = "missing_rpc";
      missing.statusCode = err.statusCode || 404;
      throw missing;
    }
    throw err;
  }
}

async function putLedgerRecord(spec) {
  const vrf = String((spec && spec.vrf) || "").trim();
  const month = String((spec && spec.month) || "").trim();
  const rows = (spec && spec.rows) || [];
  if (!vrf || !month) {
    const err = new Error("VRF number and month are required");
    err.statusCode = 409;
    err.code = "vrf_mismatch";
    throw err;
  }
  return upsertLedgerRecord(vrf, month, rows, spec.reserveNo || null);
}

function ledgerWriteError(message) {
  const err = new Error(message);
  err.statusCode = 409;
  err.code = "vrf_mismatch";
  return err;
}

/**
 * One ledger row, addressed by VRF number. Replace writes the lines this save
 * carries. Append adds them to the lines already stored for that VRF. An empty
 * replace clears a month only while the stored row still says that month, so
 * a header move cannot wipe the lines it just wrote.
 */
async function saveLedgerVrf(spec) {
  const vrf = String((spec && spec.vrf) || "").trim();
  const month = String((spec && spec.month) || "").trim();
  const mode = spec && spec.mode === "append" ? "append" : "replace";
  const incoming = Array.isArray(spec && spec.rows) ? spec.rows : [];
  if (!vrf || !/^\d{4}-\d{2}$/.test(month)) throw ledgerWriteError("VRF number and month are required");
  incoming.forEach((row) => {
    if (!row || String(row.vrf) !== vrf) {
      throw ledgerWriteError(
        `Refusing to write VRF ${row && row.vrf} while saving VRF ${vrf}`
      );
    }
  });
  const existing = await readRecord("ledger:" + vrf);
  if (!incoming.length && mode === "replace") {
    if (!existing || String(existing.month || "") !== month) {
      return { ok: true, kind: "ledger", vrf, store: "records", wrote: false };
    }
    const cleared = nextLedgerWrite(vrf, month, [], existing, existing.reserve_no);
    await rest({
      method: "PATCH",
      path: "/rest/v1/motorpool_records",
      query:
        `id=eq.${encodeURIComponent(cleared.id)}` +
        `&month=eq.${encodeURIComponent(month)}`,
      prefer: "return=minimal",
      body: {
        data: cleared.data,
        live: cleared.live,
        vrf_no: cleared.vrf_no,
        reserve_no: cleared.reserve_no,
        year: cleared.year,
        month: cleared.month,
      },
    });
    return { ok: true, kind: "ledger", vrf, store: "records", wrote: true };
  }
  const have = existing && existing.data && Array.isArray(existing.data.rows) ? existing.data.rows : [];
  const rows = mode === "append" ? have.concat(incoming) : incoming.slice();
  const reserveNo =
    (incoming[0] && incoming[0].reserve) || (existing && existing.reserve_no) || null;
  const next = nextLedgerWrite(vrf, month, rows, existing, reserveNo);
  if (ledgerUnchanged(existing, next)) {
    return { ok: true, kind: "ledger", vrf, store: "records", wrote: false };
  }
  await writeRecord(next, !!existing);
  if (spec && spec.ensureIndex) await ensureLedgerMonthIndexed(month);
  return { ok: true, kind: "ledger", vrf, store: "records", wrote: true };
}

async function ensureLedgerMonthIndexed(month) {
  const row = await fetchDoc("ledger", "index");
  const data = (row && row.data) || { months: [] };
  const months = Array.isArray(data.months) ? data.months.slice() : [];
  if (months.indexOf(month) >= 0) return;
  months.push(month);
  months.sort();
  await setDoc("ledger", "index", { months });
}

async function putReserveRecord(spec) {
  if (!spec || !spec.reserve) return { wrote: false };
  const out = await upsertReserveRecord(spec.reserve, spec.year);
  if (!out || out.reserveNo == null || String(out.reserveNo) === "") return out || { wrote: false };
  return Object.assign(
    {
      ok: true,
      kind: "reserve",
      store: "records",
      reserve: out.data,
      reserveNo: String(out.reserveNo),
      vrfNo: out.vrfNo == null ? "" : String(out.vrfNo),
    },
    out
  );
}

async function putIssuedOnce(entry) {
  if (!entry || typeof entry !== "object") return { wrote: false };
  const no = String(entry.no || entry.vrf || "").trim();
  if (!no) return { wrote: false };
  const reserveNo = String(entry.reserveNo || "").trim();
  const id = "issued:" + no + "@" + (reserveNo || "number");
  const existing = await readRecord(id);
  if (existing) return { wrote: false };
  try {
    await writeRecord(
      {
        id,
        kind: "issued",
        reserve_no: reserveNo || null,
        vrf_no: no,
        live: false,
        year: null,
        month: null,
        data: entry,
      },
      false
    );
  } catch (err) {
    if (isDuplicate(err)) return { wrote: false };
    throw err;
  }
  return { wrote: true, id };
}

async function issueRecord(spec, build) {
  return rest({
    method: "POST",
    path: "/rest/v1/rpc/motorpool_issue_record",
    body: { p_spec: spec || {}, p_build: build == null ? "" : String(build) },
  });
}

async function listIds(collection) {
  const rows = await rest({
    method: "GET",
    path: "/rest/v1/motorpool_docs",
    query: `collection=eq.${encodeURIComponent(collection)}&select=id&order=id.asc`,
  });
  return (Array.isArray(rows) ? rows : [])
    .map((row) => String((row && row.id) || ""))
    .filter(Boolean);
}

/**
 * Names and sizes of pictures for one VRF or reserve.
 * The image itself is the JSON key `data` (a base64 data URL). This select
 * reads the other keys only, so the Approvals screen can list pictures
 * without downloading them.
 */
function photoMetaSelect() {
  return [
    "id",
    "vrf:data->>vrf",
    "idx:data->>idx",
    "caption:data->>caption",
    "kind:data->>kind",
    "linkKind:data->>linkKind",
    "url:data->>url",
    "w:data->>w",
    "h:data->>h",
    "bytes:data->>bytes",
    "mime:data->>mime",
    "by:data->>by",
    "at:data->>at",
    "link:data->>link",
    "thumb:data->>thumb",
  ].join(",");
}

function photoMetaQuery(owner) {
  const select = photoMetaSelect();
  return (
    "collection=eq.photos" +
    "&data->>vrf=eq." +
    encodeURIComponent(String(owner)) +
    "&select=" +
    encodeURIComponent(select) +
    "&order=id.asc"
  );
}

function photoMetaRow(row) {
  if (!row || typeof row !== "object") return null;
  const out = {};
  ["id", "vrf", "idx", "caption", "kind", "linkKind", "url", "w", "h", "bytes", "mime", "by", "at", "link", "thumb"].forEach(
    (key) => {
      if (row[key] != null && row[key] !== "") out[key] = row[key];
    }
  );
  return out.id ? out : null;
}

async function listPhotoMeta(owner) {
  const select = photoMetaSelect();
  if (select.split(",").indexOf("data") !== -1) {
    const err = new Error("photo meta must not select the image blob");
    err.statusCode = 500;
    throw err;
  }
  const rows = await rest({
    method: "GET",
    path: "/rest/v1/motorpool_docs",
    query: photoMetaQuery(owner),
  });
  return (Array.isArray(rows) ? rows : []).map(photoMetaRow).filter(Boolean);
}

/**
 * Write only when updated_at is still the value we just read.
 * The response is the new timestamp, not the document, so a large month
 * is not echoed back over the wire.
 */
async function setDocIfUpdatedAt(collection, id, data, updatedAt) {
  if ((await recordsPrimary()) && isYearOrMonth(collection, id)) {
    await upsertBlobRows(collection, id, data);
    return { updated_at: new Date().toISOString() };
  }
  const rows = await rest({
    method: "PATCH",
    path: "/rest/v1/motorpool_docs",
    query:
      `collection=eq.${encodeURIComponent(collection)}` +
      `&id=eq.${encodeURIComponent(id)}` +
      `&updated_at=eq.${encodeURIComponent(updatedAt)}` +
      "&select=updated_at",
    prefer: "return=representation",
    body: { data },
  });
  if (!Array.isArray(rows) || !rows.length) {
    const err = new Error("The workbook changed while this VRF was saving.");
    err.code = "conflict";
    err.statusCode = 409;
    throw err;
  }
  return rows[0];
}

async function setDoc(collection, id, data, { merge = false } = {}) {
  if ((await recordsPrimary()) && isYearOrMonth(collection, id)) {
    await upsertBlobRows(collection, id, data);
    const made = await docFromRecords(collection, id);
    return made || { collection, id, data, updated_at: new Date().toISOString() };
  }
  let payload = data;
  if (merge) {
    const existing = await getDoc(collection, id);
    payload = {
      ...(existing && existing.data && typeof existing.data === "object"
        ? existing.data
        : {}),
      ...data,
    };
  }
  const rows = await rest({
    method: "POST",
    path: "/rest/v1/motorpool_docs",
    query: "on_conflict=collection,id",
    prefer: "resolution=merge-duplicates,return=representation",
    body: {
      collection,
      id,
      data: payload,
    },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function deleteDoc(collection, id) {
  await rest({
    method: "DELETE",
    path: "/rest/v1/motorpool_docs",
    query: `collection=eq.${encodeURIComponent(collection)}&id=eq.${encodeURIComponent(id)}`,
  });
  return { ok: true };
}

async function listCollection(collection, filters) {
  const { listFilterQuery, rowMatchesFilters } = require("./collections");
  const extra = listFilterQuery(filters);
  const rows = await rest({
    method: "GET",
    path: "/rest/v1/motorpool_docs",
    query: `collection=eq.${encodeURIComponent(collection)}&select=collection,id,data,updated_at&order=id.asc${extra}`,
  });
  const list = Array.isArray(rows) ? rows : [];
  const matched = extra ? list.filter((row) => rowMatchesFilters(row, filters)) : list;
  if (collection === "photos") return matched;
  return matched.map((row) => {
    if (!row || row.data == null) return row;
    return Object.assign({}, row, { data: slimDocData(collection, row.data) });
  });
}

async function acquireLock(collection, id, holder, ttlSeconds) {
  const json = await rest({
    method: "POST",
    path: "/rest/v1/rpc/acquire_motorpool_doc_lock",
    body: {
      p_collection: collection,
      p_id: id,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds || 20,
    },
  });
  return json;
}

async function verifySupabasePassword(email, password) {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key) {
    const err = new Error("Supabase Auth is not configured");
    err.statusCode = 500;
    throw err;
  }
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: key,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.msg || "Invalid credentials");
    err.statusCode = 401;
    throw err;
  }
  return json;
}

async function verifySupabaseJwt(accessToken) {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key || !accessToken) return null;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: key,
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchProfileWithUserJwt(userId, accessToken) {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key || !userId || !accessToken) return null;
  const res = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,department,role`,
    {
      headers: {
        apikey: key,
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getProfile(userId, accessToken) {
  if (!userId) return null;
  try {
    const rows = await rest({
      method: "GET",
      path: "/rest/v1/profiles",
      query: `id=eq.${encodeURIComponent(userId)}&select=id,full_name,department,role`,
    });
    if (Array.isArray(rows) && rows[0]) return rows[0];
  } catch {
    // Service role may be missing in Auth-only local tests; fall back to the user JWT.
  }
  return fetchProfileWithUserJwt(userId, accessToken);
}

module.exports = {
  acquireLock,
  anonKey,
  approveReserveFilter,
  approveVrfRecord,
  deleteDoc,
  fetchProfileWithUserJwt,
  getDoc,
  getProfile,
  isMissingRpc,
  isReloadPage,
  issueRecord,
  listCollection,
  listIds,
  listPhotoMeta,
  photoMetaQuery,
  photoMetaRow,
  photoMetaSelect,
  planCollectionWrites,
  putIssuedOnce,
  putLedgerRecord,
  putReserveRecord,
  readApproveSlice,
  saveLedgerVrf,
  recordsAvailable,
  recordsPrimary,
  rest,
  serviceRole,
  setDoc,
  setDocIfUpdatedAt,
  slimDocData,
  supabaseUrl,
  verifySupabaseJwt,
  verifySupabasePassword,
};
