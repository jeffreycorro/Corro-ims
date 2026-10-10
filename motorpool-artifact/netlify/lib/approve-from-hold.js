"use strict";

/**
 * Office → Approvals → Approve, as a reusable hold → ledger write.
 * The artifact UI does the same in-page: mark the Requested reserve Approved,
 * then post its draft lines with vstatus Open. This module is the server copy
 * so Noah/Builder can call it without a browser session.
 *
 * Does not invent a VRF number. If that number is already on the ledger,
 * approval finishes the same hold or refuses. It does not mint a second VRF.
 * A hold already marked Approved with no ledger line is healed: the missing
 * lines are inserted and the reserve is left Approved. A repeat call writes
 * nothing when both the reserve and the ledger line are already in place.
 */

const { manilaDate, manilaYear } = require("./manila");
const { mergeIssuedNumbers, mergeLedgerRows, mergeReserveRows } = require("./doc-merge");
const { normProjectLabel } = require("./project-name");

function approveError(statusCode, code, error) {
  const err = new Error(error);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function thaw(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function moneyNum(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[₱,\s]/g, "").trim());
  return isFinite(n) ? n : 0;
}

function parseOdo(v) {
  if (v == null || String(v).trim() === "") return null;
  const n = parseFloat(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** draftOdo is what New VRF saves. odoAtRequest is the older meter field. */
function holdOdo(hold) {
  const fromDraft = parseOdo(hold && hold.draftOdo);
  if (fromDraft != null) return fromDraft;
  return parseOdo(hold && hold.odoAtRequest);
}

function isFuel(text) {
  return /^\s*fuel\s*[—–-]/i.test(text == null ? "" : text);
}

function normNo(n) {
  return String(n == null ? "" : n).trim();
}

function parseDateParts(s) {
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s));
  if (m) return { y: +m[3], mo: +m[1], d: +m[2] };
  return null;
}

function monthKey(s) {
  const p = parseDateParts(s);
  return p ? `${p.y}-${String(p.mo).padStart(2, "0")}` : null;
}

function yearOf(s, fallbackYear) {
  const p = parseDateParts(s);
  if (p) return String(p.y);
  return String(fallbackYear || manilaYear());
}

function liveReserveStatus(status) {
  return String(status || "") !== "Rejected";
}

function isPostedVrfRow(v) {
  if (!v) return false;
  if (v.held || v.src === "reserve-hold") return false;
  return Boolean(normNo(v.vrf || v));
}

function usedVrfNumbers(vrfs, reserves, opts) {
  opts = opts || {};
  const used = {};
  function add(n) {
    n = normNo(n);
    if (n) used[n] = 1;
  }
  (vrfs || []).forEach((v) => add(v && (v.vrf || v)));
  (reserves || []).forEach((r) => {
    if (!r) return;
    if (opts.exceptReserve != null && String(r.no) === String(opts.exceptReserve)) return;
    if (!liveReserveStatus(r.status) && !opts.includeRejected) return;
    add(r.vrfNo);
    (r.vrfs || []).forEach(add);
  });
  return used;
}

function postedVrfNumbers(vrfs) {
  const used = {};
  (vrfs || []).forEach((v) => {
    if (!isPostedVrfRow(v)) return;
    used[normNo(v.vrf || v)] = 1;
  });
  return used;
}

function reserveOwnsPostedVrf(r) {
  const no = normNo(r && r.vrfNo);
  if (!no) return false;
  return (r.vrfs || []).some((x) => String(x) === no);
}

function holdIsSealed(r) {
  if (!r) return false;
  const st = String(r.status || "");
  if (
    st === "Closed" ||
    st === "Cancelled" ||
    st === "Rejected" ||
    st === "Approved" ||
    st === "Flagged"
  )
    return true;
  if (r.liquidatedAt || r.printedAt || r.approvedAt) return true;
  if (normNo(r.vrfNo) === "6033") return true;
  if (reserveOwnsPostedVrf(r)) return true;
  return false;
}

function shouldRemintHeldVrf(r, vrfs, reserves) {
  if (!r || !normNo(r.vrfNo)) return false;
  if (holdIsSealed(r)) return false;
  const no = normNo(r.vrfNo);
  const posted = !!postedVrfNumbers(vrfs)[no];
  const others = (reserves || []).filter((o) => {
    if (!o || String(o.no) === String(r.no)) return false;
    if (!liveReserveStatus(o.status)) return false;
    if (normNo(o.vrfNo) === no) return true;
    return (o.vrfs || []).some((x) => String(x) === no);
  });
  if (posted) return true;
  if (!others.length) return false;
  return others.some((o) => holdIsSealed(o));
}

function otherReservesClaiming(reserves, hold, vrfNo) {
  const no = normNo(vrfNo);
  return (reserves || []).filter((o) => {
    if (!o || String(o.no) === String(hold && hold.no)) return false;
    if (!liveReserveStatus(o.status)) return false;
    if (normNo(o.vrfNo) === no) return true;
    return (o.vrfs || []).some((x) => String(x) === no);
  });
}

function nextFreeVrf(from, used) {
  let n = parseInt(from, 10);
  if (!isFinite(n) || n < 1) n = 1;
  used = used || {};
  while (used[String(n)]) n += 1;
  return n;
}

function approvedState(status) {
  const st = String(status || "");
  return st === "Approved" || st === "Closed" || st === "Flagged";
}

function pendingHolds(reserves) {
  return (reserves || []).filter((r) => r && String(r.status) === "Requested");
}

/**
 * Accept { vrf: "5812" } | { vrfNumber: 5812 } | RSV-12 / VRF-5812 spellings.
 */
function normalizeVrfRequest(body) {
  const raw =
    body && body.vrf != null && String(body.vrf).trim() !== ""
      ? body.vrf
      : body && body.vrfNumber != null
        ? body.vrfNumber
        : "";
  const text = String(raw == null ? "" : raw).trim();
  if (!text) {
    throw approveError(400, "bad_request", 'Body must include "vrf" or "vrfNumber"');
  }

  let m = /^rsv[-–—\s]*(\d+)$/i.exec(text);
  if (m) return { kind: "reserve", no: m[1], raw: text, bareNumber: false };

  m = /^vrf[-–—\s]*(\d+)$/i.exec(text);
  if (m) return { kind: "vrf", no: m[1], raw: text, bareNumber: false };

  m = /^(\d+)$/.exec(text);
  if (m) return { kind: "vrf", no: m[1], raw: text, bareNumber: true };

  throw approveError(
    400,
    "bad_request",
    `Could not normalize VRF key ${JSON.stringify(text)} — use a number or RSV-12 / VRF-5812`
  );
}

function isPostedNumber(snapshot, no) {
  const key = normNo(no);
  if (!key) return false;
  if (postedVrfNumbers(snapshot.ledgerRows)[key]) return true;
  return (snapshot.reserves || []).some((r) => {
    if (!r || !approvedState(r.status)) return false;
    if (normNo(r.vrfNo) === key) return true;
    return (r.vrfs || []).some((x) => String(x) === key);
  });
}

function isClosedOut(status) {
  const st = String(status || "");
  return st === "Rejected" || st === "Cancelled" || st === "Archived";
}

/** Reserves this approve key can act on. Rejected and cancelled rows are ignored. */
function matchingReserves(reserves, key) {
  const pool = (reserves || []).filter((r) => r && !isClosedOut(r.status) && r.archived !== true);
  if (!key) return [];
  if (key.kind === "reserve") return pool.filter((r) => normNo(r.no) === key.no);
  const byVrf = pool.filter(
    (r) => normNo(r.vrfNo) === key.no || (r.vrfs || []).some((x) => String(x) === key.no)
  );
  if (byVrf.length || !key.bareNumber) return byVrf;
  return pool.filter((r) => normNo(r.no) === key.no);
}

function resolveHold(snapshot, key) {
  const matches = matchingReserves(snapshot.reserves, key);

  if (key.kind === "reserve") {
    if (matches.length > 1) {
      throw approveError(
        409,
        "ambiguous",
        `RSV-${key.no} matches ${matches.length} holds — refusing to guess`
      );
    }
    if (matches.length === 1) return matches[0];
    throw approveError(404, "not_found", `RSV-${key.no} is not waiting for approval`);
  }

  if (matches.length > 1) {
    const pending = matches.filter((r) => String(r.status) === "Requested");
    if (pending.length > 1) {
      throw approveError(
        409,
        "ambiguous",
        `VRF ${key.no} matches ${pending.length} pending holds — refusing to guess`
      );
    }
    throw approveError(
      409,
      "already_posted",
      `VRF ${key.no} is already on another reserve. Not creating another number.`
    );
  }
  if (matches.length === 1) return matches[0];
  throw approveError(404, "not_found", `VRF ${key.no} is not waiting for approval`);
}

function masterRows(doc) {
  if (!doc) return [];
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc.rows)) return doc.rows;
  return [];
}

function vehicleOf(vehicles, code) {
  const want = String(code || "");
  return masterRows(vehicles).find((v) => v && v.code === want) || null;
}

function partSpecOf(parts, cat) {
  const want = String(cat || "").trim();
  return masterRows(parts).find((p) => p && String(p.cat || "").trim() === want) || null;
}

function bypassAttribution(override, extra) {
  extra = extra || {};
  const who = (override && override.by) || extra.by || "";
  const when = (override && override.at) || extra.at || "";
  const reason = (override && override.reason) || extra.reason || "";
  const note = (override && override.note) || extra.note || "";
  const unit = extra.unit || extra.veh || "";
  const litres = extra.litres != null ? extra.litres : extra.liters;
  const parts = ["Bypass — no office approval"];
  if (who) parts.push("by " + who);
  if (when) parts.push("on " + when);
  if (unit) parts.push("unit " + unit);
  if (litres != null && litres !== "" && isFinite(Number(litres))) {
    parts.push(Number(litres) + " L");
  }
  if (reason) parts.push(reason);
  if (note) parts.push(note);
  return parts.join(" · ");
}

function buildLedgerRows(hold, vrfNo, snapshot, today) {
  const lines = (hold.draftLines || []).filter((l) => l && l.cat);
  const mk = monthKey(hold.date) || String(today || manilaDate()).slice(0, 7);
  const veh = vehicleOf(snapshot.vehicles, hold.veh);
  return lines.map((l) => {
    const sp = partSpecOf(snapshot.parts, l.cat);
    const qty = moneyNum(l.qty);
    const price = moneyNum(l.price);
    let note = hold.draftPurpose || hold.scope || "";
    if (hold.bypass || hold.fuelOverride) {
      const extra = bypassAttribution(hold.fuelOverride, {
        unit: hold.veh,
        litres: hold.litres,
        by: hold.approvedBy || hold.requestedBy,
      });
      note = note ? note + " — " + extra : extra;
    }
    return {
      month: mk,
      date: hold.date || today,
      vrf: String(vrfNo),
      veh: hold.veh,
      name: veh ? veh.desc : "",
      cat: l.cat,
      sub: sp ? sp.sub : isFuel(l.cat) ? "Fuel" : "",
      grp: isFuel(l.cat) ? "Fuel" : "Maintenance",
      work: l.work || hold.work || "",
      item: l.item || "",
      qty,
      price,
      total: qty * price,
      supplier: l.supplier || "",
      unit: l.unit || "pc",
      project: normProjectLabel(hold.project || ""),
      liters: parseFloat(l.liters) || null,
      odo: holdOdo(hold),
      reserve: String(hold.no),
      vstatus: "Open",
      requestedBy: hold.requestedBy || "",
      override: hold.bypass || hold.fuelOverride ? hold.fuelOverride || null : null,
      bypass: !!hold.bypass,
      notes: note,
    };
  });
}

function ledgerLinesFor(snapshot, vrfNo) {
  const no = normNo(vrfNo);
  return (snapshot.ledgerRows || []).filter((row) => isPostedVrfRow(row) && normNo(row.vrf) === no);
}

function appendAudit(hold, entry) {
  const audit = Array.isArray(hold.audit) ? hold.audit.slice() : [];
  const dup = audit.some(
    (note) =>
      note &&
      note.field === entry.field &&
      String(note.from || "") === String(entry.from || "") &&
      String(note.to || "") === String(entry.to || "") &&
      String(note.note || "") === String(entry.note || "")
  );
  if (!dup) audit.push(entry);
  hold.audit = audit;
}

function approvePayload(hold, vrfNo, extra) {
  extra = extra || {};
  const payload = {
    ok: true,
    vrf: String(vrfNo),
    reserve: String(hold.no),
    status: extra.status || "Open",
    ledgerLines: extra.ledgerLines || 0,
    approvedVia: hold.approvedVia || "api",
    approvedAt: hold.approvedAt,
    approvedBudget: hold.approvedBudget,
  };
  if (extra.already) payload.already = true;
  if (extra.healed) payload.healed = true;
  if (extra.approverNote) payload.approverNote = extra.approverNote;
  return payload;
}

function rememberLedgerRows(snapshot, month, rows) {
  snapshot.ledgerByMonth = snapshot.ledgerByMonth || {};
  snapshot.ledgerByMonth[month] = (snapshot.ledgerByMonth[month] || []).concat(rows);
  snapshot.ledgerRows = (snapshot.ledgerRows || []).concat(rows);
  if ((snapshot.ledgerMonths || []).indexOf(month) < 0) {
    snapshot.ledgerMonths = (snapshot.ledgerMonths || []).concat([month]).sort();
    snapshot.ledgerIndexDirty = true;
  }
}

function linkApprovedHold(hold, vrfNo, today, opts) {
  const before = JSON.stringify(hold);
  if ((hold.vrfs || []).indexOf(String(vrfNo)) < 0) {
    hold.vrfs = (hold.vrfs || []).concat([String(vrfNo)]);
  }
  appendAudit(hold, {
    at: hold.approvedAt || (opts && opts.now) || today,
    by: hold.approvedBy || (opts && opts.approvedBy) || "api",
    field: "ledger",
    from: "",
    to: String(vrfNo),
    note: "Posted missing ledger lines",
  });
  return JSON.stringify(hold) !== before;
}

function applyApproveFromHold(snapshot, hold, opts) {
  opts = opts || {};
  if (!hold) {
    throw approveError(409, "not_pending", "That VRF is not waiting for approval");
  }

  const st = String(hold.status || "");
  const vrfNo = normNo(hold.vrfNo);
  if (!vrfNo) {
    throw approveError(
      409,
      "missing_vrf_number",
      "Pending hold has no VRF number — refusing to invent one"
    );
  }

  const lines = (hold.draftLines || []).filter((l) => l && l.cat);
  const posted = !!postedVrfNumbers(snapshot.ledgerRows)[String(vrfNo)];
  const others = otherReservesClaiming(snapshot.reserves, hold, vrfNo);
  if (others.length) {
    throw approveError(
      409,
      posted ? "already_posted" : "ambiguous",
      posted
        ? `VRF ${vrfNo} is already on the ledger. Not creating another number.`
        : `VRF ${vrfNo} is also on RSV-${others.map((o) => o.no).join(", RSV-")} — refusing to guess`
    );
  }

  const today = opts.now || manilaDate();
  const note = String(opts.approverNote || "").trim();
  const month = monthKey(hold.date) || String(today).slice(0, 7);
  const existingLines = ledgerLinesFor(snapshot, vrfNo);
  const lineStatus = existingLines.length && existingLines[0].vstatus ? String(existingLines[0].vstatus) : "Open";

  if ((st === "Approved" || st === "Closed" || st === "Flagged") && posted) {
    return {
      noop: true,
      already: true,
      writeReserve: false,
      writeLedger: false,
      month,
      rows: [],
      hold,
      payload: approvePayload(hold, vrfNo, {
        already: true,
        ledgerLines: existingLines.length,
        status: lineStatus,
        approverNote: note,
      }),
    };
  }

  if (st === "Approved" && !posted) {
    if (!lines.length) {
      throw approveError(
        409,
        "no_draft_lines",
        "Pending hold has no draft lines to post — refusing to invent a VRF"
      );
    }
    if (typeof hold.project === "string") hold.project = normProjectLabel(hold.project);
    const changed = linkApprovedHold(hold, vrfNo, today, opts);
    const rows = buildLedgerRows(hold, vrfNo, snapshot, today);
    const mk = rows[0] ? rows[0].month : month;
    rememberLedgerRows(snapshot, mk, rows);
    return {
      heal: true,
      writeReserve: changed,
      writeLedger: true,
      month: mk,
      rows,
      hold,
      payload: approvePayload(hold, vrfNo, {
        healed: true,
        ledgerLines: rows.length,
        status: "Open",
        approverNote: note,
      }),
    };
  }

  if (st !== "Requested") {
    throw approveError(409, "not_pending", "That VRF is not waiting for approval");
  }

  if (!posted && !lines.length) {
    throw approveError(
      409,
      "no_draft_lines",
      "Pending hold has no draft lines to post — refusing to invent a VRF"
    );
  }

  if (typeof hold.project === "string") hold.project = normProjectLabel(hold.project);
  hold.status = "Approved";
  hold.approvedBudget = hold.approvedBudget != null ? hold.approvedBudget : hold.budget;
  hold.approvedBy = String(opts.approvedBy || "").trim() || hold.approvedBy || "api";
  hold.approvedAt = posted ? hold.approvedAt || today : today;
  hold.decisionNote = note || hold.decisionNote || "";
  hold.approvedVia = hold.approvedVia || "api";
  if (note) hold.approverNote = note;
  if ((hold.vrfs || []).indexOf(String(vrfNo)) < 0) {
    hold.vrfs = (hold.vrfs || []).concat([String(vrfNo)]);
  }
  appendAudit(hold, {
    at: hold.approvedAt || today,
    by: hold.approvedBy || "api",
    field: "status",
    from: "Requested",
    to: "Approved",
    note: note || "approved",
  });

  if (posted) {
    return {
      already: true,
      writeReserve: true,
      writeLedger: false,
      month,
      rows: [],
      hold,
      payload: approvePayload(hold, vrfNo, {
        already: true,
        ledgerLines: existingLines.length,
        status: lineStatus,
        approverNote: note,
      }),
    };
  }

  const rows = buildLedgerRows(hold, vrfNo, snapshot, today);
  const mk = rows[0] ? rows[0].month : month;
  rememberLedgerRows(snapshot, mk, rows);
  return {
    writeReserve: true,
    writeLedger: true,
    month: mk,
    rows,
    hold,
    payload: approvePayload(hold, vrfNo, {
      ledgerLines: rows.length,
      status: "Open",
      approverNote: note,
    }),
  };
}

function mergeIds(listed, extra, re) {
  const out = [];
  const seen = {};
  function add(id) {
    const s = String(id || "");
    if (!s || seen[s]) return;
    if (re && !re.test(s)) return;
    seen[s] = 1;
    out.push(s);
  }
  (listed || []).forEach((row) => add(row && (row.id != null ? row.id : row)));
  (extra || []).forEach(add);
  return out;
}

function configFromDoc(doc) {
  const cfg = doc && typeof doc === "object" ? doc : {};
  return {
    nextVrf: cfg.nextVrf || 1,
    pass: cfg.pass || null,
    fuel: cfg.fuel || null,
    varianceTol: typeof cfg.varianceTol === "number" ? cfg.varianceTol : 0.1,
    nextReserve: cfg.nextReserve || 1,
    driveFolder: cfg.driveFolder || "",
  };
}

async function readRec(store, collection, id) {
  if (store.getRecord) {
    const rec = await store.getRecord(collection, id);
    if (!rec || rec.data == null) return { data: null, updated_at: null };
    return { data: rec.data, updated_at: rec.updated_at || null };
  }
  const data = await store.get(collection, id);
  return { data: data == null ? null : data, updated_at: null };
}

async function listIdsOf(store, collection) {
  if (store.listIds) return store.listIds(collection);
  const rows = await store.list(collection);
  return (rows || []).map((row) => String(row && row.id != null ? row.id : ""));
}

/**
 * Load the reserve year and the one ledger month this VRF belongs to.
 * Other months stay on the server — approving must not download the workbook.
 */
async function loadSnapshot(store, key) {
  const [reserveIds, ledgerIds, reservesIndexRec, ledgerIndexRec, cfgRec, vehiclesRec, partsRec] =
    await Promise.all([
      listIdsOf(store, "reserves"),
      listIdsOf(store, "ledger"),
      readRec(store, "reserves", "index"),
      readRec(store, "ledger", "index"),
      readRec(store, "config", "app"),
      readRec(store, "master", "vehicles"),
      readRec(store, "master", "parts"),
    ]);

  const reservesIndex = reservesIndexRec.data;
  const ledgerIndex = ledgerIndexRec.data;
  const years = mergeIds(reserveIds, (reservesIndex && reservesIndex.years) || [], /^\d{4}$/);
  if (!years.length) years.push(String(manilaYear()));

  const yearRecs = await Promise.all(years.map((y) => readRec(store, "reserves", y)));
  const reserveDocs = {};
  const reserves = [];
  years.forEach((y, i) => {
    const rec = yearRecs[i];
    const rows =
      rec && rec.data && Array.isArray(rec.data.rows) ? rec.data.rows.map(thaw) : [];
    reserveDocs[y] = { rows, updated_at: rec && rec.updated_at };
    rows.forEach((row) => {
      if (row) reserves.push(row);
    });
  });

  const peek = matchingReserves(reserves, key)[0] || null;
  const targetMonth = peek ? monthKey(peek.date) || String(manilaDate()).slice(0, 7) : null;
  const monthRec = targetMonth ? await readRec(store, "ledger", targetMonth) : { data: null, updated_at: null };
  const months = mergeIds(ledgerIds, (ledgerIndex && ledgerIndex.months) || [], /^\d{4}-\d{2}$/);
  let ledgerIndexDirty = false;
  const ledgerByMonth = {};
  const ledgerRows = [];
  if (targetMonth) {
    const rows =
      monthRec && monthRec.data && Array.isArray(monthRec.data.rows)
        ? monthRec.data.rows.map(thaw)
        : [];
    ledgerByMonth[targetMonth] = rows;
    rows.forEach((row) => ledgerRows.push(row));
    if (months.indexOf(targetMonth) < 0) {
      months.push(targetMonth);
      ledgerIndexDirty = true;
    }
  }
  months.sort();

  return {
    reserves,
    reserveDocs,
    reserveYears: years,
    ledgerRows,
    ledgerByMonth,
    ledgerMonths: months.slice(),
    ledgerIndexDirty,
    ledgerStamp: targetMonth ? monthRec && monthRec.updated_at : null,
    targetMonth,
    cfg: configFromDoc(cfgRec.data),
    cfgDirty: false,
    vehicles: thaw(vehiclesRec.data) || { rows: [] },
    parts: thaw(partsRec.data) || { rows: [] },
  };
}

function configPayload(cfg) {
  return {
    nextVrf: cfg.nextVrf,
    pass: cfg.pass,
    fuel: cfg.fuel || null,
    varianceTol: cfg.varianceTol,
    nextReserve: cfg.nextReserve,
    driveFolder: cfg.driveFolder || "",
  };
}

async function writeVersioned(store, collection, id, data, updatedAt, remix) {
  const limit = 3;
  let stamp = updatedAt || null;
  let payload = data;
  for (let attempt = 0; attempt < limit; attempt++) {
    if (attempt > 0) {
      const rec = await readRec(store, collection, id);
      stamp = rec.updated_at;
      payload = remix(rec.data);
    }
    if (stamp && store.cas && attempt < limit - 1) {
      try {
        await store.cas(collection, id, payload, stamp);
        return;
      } catch (err) {
        if (err && err.code === "conflict") continue;
        throw err;
      }
    }
    await store.set(collection, id, payload);
    return;
  }
  throw approveError(409, "conflict", "The workbook changed while approving. Try again.");
}

function publicReserve(hold) {
  const copy = thaw(hold) || {};
  ["preparedSig", "checkedSig", "approvedSig"].forEach((key) => {
    if (typeof copy[key] === "string" && copy[key].length > 80) delete copy[key];
  });
  return copy;
}

function approveSpec(result) {
  const hold = result.hold;
  return {
    vrf: String(result.payload.vrf),
    reserveNo: String(hold.no),
    month: result.month,
    year: yearOf(hold.date),
    writeLedger: !!result.writeLedger,
    writeReserve: !!result.writeReserve,
    reserve: publicReserve(hold),
    rows: result.rows || [],
  };
}

function missingApproveRpc(err) {
  if (!err) return false;
  if (err.code === "missing_rpc" || err.code === "PGRST202") return true;
  const msg = String(err.message || "");
  return /could not find the function|schema cache/i.test(msg);
}

function issuedEntry(hold, rows, month) {
  const no = normNo(hold.vrfNo);
  return {
    no,
    reserveNo: String(hold.no),
    sealed: true,
    reason: hold.printedAt ? "printed" : "approved",
    at: hold.printedAt || hold.approvedAt || "",
    snapshot: {
      month: month || "",
      rows: rows || [],
      reserve: {
        no: hold.no,
        vrfNo: no,
        vrfs: hold.vrfs || [],
        date: hold.date,
        status: hold.status,
        veh: hold.veh,
        project: hold.project,
        work: hold.work,
        requestedBy: hold.requestedBy,
        approvedBy: hold.approvedBy,
        approvedAt: hold.approvedAt,
        printedAt: hold.printedAt || "",
        draftPurpose: hold.draftPurpose || "",
        draftLines: hold.draftLines || [],
        budget: hold.budget,
        approvedBudget: hold.approvedBudget,
      },
    },
  };
}

/**
 * Per-record approve. The SQL function writes the ledger line and the reserve
 * in one transaction. If that function is not installed yet, the ledger row
 * is written first and the reserve second, so a timeout cannot leave the
 * reserve Approved with no ledger line.
 */
async function persistRecordApprove(store, result) {
  const payload = result.payload;
  if (!result.writeLedger && !result.writeReserve) return payload;
  const spec = approveSpec(result);
  (spec.rows || []).forEach((row) => {
    if (!row || String(row.vrf) !== spec.vrf) {
      throw approveError(
        409,
        "vrf_mismatch",
        `Refusing to write VRF ${row && row.vrf} while saving VRF ${spec.vrf}`
      );
    }
  });
  let usedRpc = false;
  if (store.approveAtomic) {
    try {
      const rpc = await store.approveAtomic(spec);
      usedRpc = true;
      if (rpc && rpc.ledgerLines != null) payload.ledgerLines = rpc.ledgerLines;
      if (rpc && rpc.status && !result.payload.status) payload.status = rpc.status;
    } catch (err) {
      if (!missingApproveRpc(err)) throw err;
    }
  }
  if (!usedRpc) {
    if (spec.writeLedger) {
      if (!store.putLedgerRecord) {
        throw approveError(500, "not_configured", "Approve store cannot write a ledger row");
      }
      const ledger = await store.putLedgerRecord(spec);
      if (ledger && ledger.ledgerLines != null) payload.ledgerLines = ledger.ledgerLines;
    }
    if (spec.writeReserve) {
      if (!store.putReserveRecord) {
        throw approveError(500, "not_configured", "Approve store cannot write a reserve row");
      }
      await store.putReserveRecord(spec);
    }
  }
  if (result.writeLedger && store.sealIssued) {
    try {
      await store.sealIssued(issuedEntry(result.hold, result.rows, result.month));
    } catch (err) {
      /* The VRF is already on the ledger. A missed seal must not undo the approval. */
    }
  }
  return payload;
}

async function persistApprove(store, snapshot, result) {
  if (!result.writeReserve && !result.writeLedger) return;
  const year = yearOf(result.hold.date);
  const vrfNo = String(result.payload.vrf);
  (result.rows || []).forEach((row) => {
    if (!row || String(row.vrf) !== vrfNo) {
      throw approveError(
        409,
        "vrf_mismatch",
        `Refusing to write VRF ${row && row.vrf} while saving VRF ${vrfNo}`
      );
    }
  });
  /* Ledger first on the document path too. The records table is the live
     store; this order matters only when that table is not in use yet. */
  if (result.writeLedger) {
    const monthBase = (snapshot.ledgerByMonth && snapshot.ledgerByMonth[result.month]) || [];
    const monthRows = mergeLedgerRows(monthBase, vrfNo, result.rows || [], "replace");
    await writeVersioned(
      store,
      "ledger",
      result.month,
      { month: result.month, rows: monthRows },
      snapshot.ledgerStamp,
      (fresh) => ({
        month: result.month,
        rows: mergeLedgerRows(
          fresh && Array.isArray(fresh.rows) ? fresh.rows : [],
          vrfNo,
          result.rows || [],
          "replace"
        ),
      })
    );
    if (snapshot.ledgerIndexDirty) {
      await store.set("ledger", "index", { months: snapshot.ledgerMonths });
    }
  }
  if (result.writeReserve) {
    const yearDoc = (snapshot.reserveDocs && snapshot.reserveDocs[year]) || { rows: [], updated_at: null };
    const yearRows = mergeReserveRows(yearDoc.rows || [], result.hold);
    await writeVersioned(
      store,
      "reserves",
      year,
      { year, rows: yearRows },
      yearDoc.updated_at,
      (fresh) => ({
        year,
        rows: mergeReserveRows(fresh && Array.isArray(fresh.rows) ? fresh.rows : [], result.hold),
      })
    );
    if ((snapshot.reserveYears || []).indexOf(year) < 0) {
      const years = (snapshot.reserveYears || []).concat([year]).sort();
      await store.set("reserves", "index", { years });
    }
  }
  if (snapshot.cfgDirty) {
    await store.set("config", "app", configPayload(snapshot.cfg));
  }
  if (result.writeLedger) {
    try {
      await sealApprovedNumber(store, result.hold, result.rows, result.month);
    } catch (err) {
      /* The VRF is already on the ledger. A missed seal must not undo the approval. */
    }
  }
}

async function sealApprovedNumber(store, hold, rows, month) {
  if (!store || !hold || !store.set) return;
  const no = normNo(hold.vrfNo);
  if (!no) return;
  const entry = {
    no,
    sealed: true,
    reason: hold.printedAt ? "printed" : "approved",
    at: hold.printedAt || hold.approvedAt || "",
    snapshot: {
      month: month || "",
      rows: rows || [],
      reserve: {
        no: hold.no,
        vrfNo: no,
        vrfs: hold.vrfs || [],
        date: hold.date,
        status: hold.status,
        veh: hold.veh,
        project: hold.project,
        work: hold.work,
        requestedBy: hold.requestedBy,
        approvedBy: hold.approvedBy,
        approvedAt: hold.approvedAt,
        printedAt: hold.printedAt || "",
        draftPurpose: hold.draftPurpose || "",
        draftLines: hold.draftLines || [],
        budget: hold.budget,
        approvedBudget: hold.approvedBudget,
      },
    },
  };
  const rec = store.getRecord
    ? await store.getRecord("config", "issued")
    : { data: null, updated_at: null };
  const data = mergeIssuedNumbers(rec && rec.data, entry);
  if (rec && rec.updated_at && store.cas) {
    try {
      await store.cas("config", "issued", data, rec.updated_at);
      return;
    } catch (err) {
      if (!err || err.code !== "conflict") throw err;
    }
  }
  await store.set("config", "issued", data);
}

/**
 * Load holds + ledger, approve one pending VRF, write the same docs the portal uses.
 */
async function approvePendingVrf(store, body, options) {
  const key = normalizeVrfRequest(body);
  const opts = {
    approverNote: body && body.approverNote,
    approvedBy: body && body.approvedBy,
    now: options && options.now,
  };
  if (store.readApproveRecords) {
    const slice = await store.readApproveRecords(key);
    if (slice) {
      const hold = resolveHold(slice, key);
      const result = applyApproveFromHold(slice, hold, opts);
      return persistRecordApprove(store, result);
    }
  }
  const snapshot = await loadSnapshot(store, key);
  const hold = resolveHold(snapshot, key);
  const result = applyApproveFromHold(snapshot, hold, opts);
  await persistApprove(store, snapshot, result);
  return result.payload;
}

function createSupabaseStore(api) {
  const docs = api || require("./supabase");
  return {
    async get(collection, id) {
      const row = await docs.getDoc(collection, id);
      return row && row.data != null ? row.data : null;
    },
    async set(collection, id, data) {
      return docs.setDoc(collection, id, data);
    },
    async list(collection) {
      const rows = await docs.listCollection(collection);
      return (rows || []).map((row) => ({
        id: row.id,
        data: row.data,
      }));
    },
    async listIds(collection) {
      return docs.listIds(collection);
    },
    async getRecord(collection, id) {
      const row = await docs.getDoc(collection, id);
      if (!row || row.data == null) return { data: null, updated_at: null };
      return { data: row.data, updated_at: row.updated_at || null };
    },
    async cas(collection, id, data, updatedAt) {
      return docs.setDocIfUpdatedAt(collection, id, data, updatedAt);
    },
    async readApproveRecords(key) {
      return docs.readApproveSlice(key);
    },
    async approveAtomic(spec) {
      return docs.approveVrfRecord(spec);
    },
    async putLedgerRecord(spec) {
      return docs.putLedgerRecord(spec);
    },
    async putReserveRecord(spec) {
      return docs.putReserveRecord(spec);
    },
    async sealIssued(entry) {
      return docs.putIssuedOnce(entry);
    },
  };
}

function createMemoryStore(initial) {
  const docs = Object.create(null);
  const stamps = Object.create(null);
  let rev = 1;
  Object.keys(initial || {}).forEach((path) => {
    docs[path] = thaw(initial[path]);
    stamps[path] = "t0";
  });
  return {
    async get(collection, id) {
      const data = docs[`${collection}/${id}`];
      return data == null ? null : thaw(data);
    },
    async getRecord(collection, id) {
      const path = `${collection}/${id}`;
      if (docs[path] == null) return { data: null, updated_at: null };
      return { data: thaw(docs[path]), updated_at: stamps[path] || null };
    },
    async set(collection, id, data) {
      const path = `${collection}/${id}`;
      docs[path] = thaw(data);
      stamps[path] = "t" + ++rev;
      return docs[path];
    },
    async cas(collection, id, data, updatedAt) {
      const path = `${collection}/${id}`;
      if (docs[path] == null || stamps[path] !== updatedAt) {
        const err = new Error("The workbook changed while this VRF was saving.");
        err.code = "conflict";
        err.statusCode = 409;
        throw err;
      }
      docs[path] = thaw(data);
      stamps[path] = "t" + ++rev;
      return { updated_at: stamps[path] };
    },
    async list(collection) {
      const prefix = `${collection}/`;
      return Object.keys(docs)
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ id: k.slice(prefix.length), data: thaw(docs[k]) }));
    },
    async listIds(collection) {
      const prefix = `${collection}/`;
      return Object.keys(docs)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
    _docs: docs,
  };
}

module.exports = {
  applyApproveFromHold,
  approveError,
  holdOdo,
  parseOdo,
  approvePendingVrf,
  createMemoryStore,
  createSupabaseStore,
  isPostedNumber,
  loadSnapshot,
  matchingReserves,
  normalizeVrfRequest,
  persistApprove,
  postedVrfNumbers,
  resolveHold,
  shouldRemintHeldVrf,
  usedVrfNumbers,
};
