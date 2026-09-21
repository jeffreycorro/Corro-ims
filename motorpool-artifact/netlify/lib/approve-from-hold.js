"use strict";

/**
 * Office → Approvals → Approve, as a reusable hold → ledger write.
 * The artifact UI does the same in-page: mark the Requested reserve Approved,
 * then post its draft lines with vstatus Open. This module is the server copy
 * so Noah/Builder can call it without a browser session.
 *
 * Does not invent a VRF number. Uniqueness remint (PR #54) still runs when
 * the hold being approved collides with an already-posted number.
 */

const { manilaDate, manilaYear } = require("./manila");

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

function shouldRemintHeldVrf(r, vrfs, reserves) {
  if (!r || !normNo(r.vrfNo)) return false;
  const st = String(r.status || "");
  if (st === "Rejected" || st === "Closed") return false;
  if (reserveOwnsPostedVrf(r)) return false;
  const no = normNo(r.vrfNo);
  const posted = !!postedVrfNumbers(vrfs)[no];
  const otherHold = (reserves || []).some((o) => {
    if (!o || String(o.no) === String(r.no)) return false;
    if (!liveReserveStatus(o.status)) return false;
    if (normNo(o.vrfNo) === no) return true;
    return (o.vrfs || []).some((x) => String(x) === no);
  });
  return posted || otherHold;
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

function resolveHold(snapshot, key) {
  const pending = pendingHolds(snapshot.reserves);

  if (key.kind === "reserve") {
    const hits = pending.filter((r) => normNo(r.no) === key.no);
    if (hits.length > 1) {
      throw approveError(
        409,
        "ambiguous",
        `RSV-${key.no} matches ${hits.length} pending holds — refusing to guess`
      );
    }
    if (hits.length === 1) return hits[0];
    const any = (snapshot.reserves || []).filter((r) => normNo(r.no) === key.no);
    if (any.length === 1 && approvedState(any[0].status)) {
      throw approveError(409, "already_posted", `RSV-${key.no} is already posted`);
    }
    throw approveError(404, "not_found", `RSV-${key.no} is not waiting for approval`);
  }

  if (isPostedNumber(snapshot, key.no)) {
    throw approveError(409, "already_posted", `VRF ${key.no} is already posted`);
  }

  const byVrf = pending.filter((r) => normNo(r.vrfNo) === key.no);
  if (byVrf.length > 1) {
    throw approveError(
      409,
      "ambiguous",
      `VRF ${key.no} matches ${byVrf.length} pending holds — refusing to guess`
    );
  }
  if (byVrf.length === 1) return byVrf[0];

  if (key.bareNumber) {
    const byReserve = pending.filter((r) => normNo(r.no) === key.no);
    if (byReserve.length > 1) {
      throw approveError(
        409,
        "ambiguous",
        `${key.no} matches ${byReserve.length} pending reserve numbers — refusing to guess`
      );
    }
    if (byReserve.length === 1) return byReserve[0];
  }

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
      project: hold.project || "",
      liters: parseFloat(l.liters) || null,
      odo: parseFloat(String(hold.draftOdo || "").replace(/,/g, "")) || null,
      reserve: String(hold.no),
      vstatus: "Open",
      requestedBy: hold.requestedBy || "",
      override: hold.bypass || hold.fuelOverride ? hold.fuelOverride || null : null,
      bypass: !!hold.bypass,
      notes: note,
    };
  });
}

function applyApproveFromHold(snapshot, hold, opts) {
  opts = opts || {};
  if (!hold || String(hold.status) !== "Requested") {
    throw approveError(409, "not_pending", "That VRF is not waiting for approval");
  }

  const lines = (hold.draftLines || []).filter((l) => l && l.cat);
  if (!lines.length) {
    throw approveError(
      409,
      "no_draft_lines",
      "Pending hold has no draft lines to post — refusing to invent a VRF"
    );
  }

  let vrfNo = normNo(hold.vrfNo);
  if (!vrfNo) {
    throw approveError(
      409,
      "missing_vrf_number",
      "Pending hold has no VRF number — refusing to invent one"
    );
  }

  if (shouldRemintHeldVrf(hold, snapshot.ledgerRows, snapshot.reserves)) {
    const used = usedVrfNumbers(snapshot.ledgerRows, snapshot.reserves, {
      exceptReserve: hold.no,
    });
    const startFrom = Math.max(
      parseInt(snapshot.cfg.nextVrf, 10) || 1,
      parseInt(vrfNo, 10) || 1
    );
    const next = nextFreeVrf(startFrom, used);
    hold.vrfNo = String(next);
    vrfNo = String(next);
    if (next + 1 > (snapshot.cfg.nextVrf || 0)) {
      snapshot.cfg.nextVrf = next + 1;
      snapshot.cfgDirty = true;
    }
  }

  if (postedVrfNumbers(snapshot.ledgerRows)[String(vrfNo)]) {
    throw approveError(409, "already_posted", `VRF ${vrfNo} is already posted`);
  }

  const today = opts.now || manilaDate();
  const note = String(opts.approverNote || "").trim();
  hold.status = "Approved";
  hold.approvedBudget = hold.approvedBudget != null ? hold.approvedBudget : hold.budget;
  hold.approvedBy = String(opts.approvedBy || "").trim() || "api";
  hold.approvedAt = today;
  hold.decisionNote = note || hold.decisionNote || "";
  hold.approvedVia = "api";
  hold.approverNote = note;
  hold.vrfs = (hold.vrfs || []).concat([String(vrfNo)]);

  const rows = buildLedgerRows(hold, vrfNo, snapshot, today);
  const mk = rows[0] ? rows[0].month : monthKey(hold.date) || today.slice(0, 7);
  snapshot.ledgerByMonth[mk] = (snapshot.ledgerByMonth[mk] || []).concat(rows);
  snapshot.ledgerRows = snapshot.ledgerRows.concat(rows);
  if ((snapshot.ledgerMonths || []).indexOf(mk) < 0) {
    snapshot.ledgerMonths = (snapshot.ledgerMonths || []).concat([mk]).sort();
    snapshot.ledgerIndexDirty = true;
  }

  return {
    month: mk,
    rows,
    hold,
    payload: {
      ok: true,
      vrf: String(vrfNo),
      reserve: String(hold.no),
      status: "Open",
      approvedVia: "api",
      approvedAt: today,
      approvedBudget: hold.approvedBudget,
      approverNote: note || undefined,
    },
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

async function loadSnapshot(store) {
  const [reservesIndex, listedReserves, ledgerIndex, listedLedger, cfgDoc, vehicles, parts] =
    await Promise.all([
      store.get("reserves", "index"),
      store.list("reserves"),
      store.get("ledger", "index"),
      store.list("ledger"),
      store.get("config", "app"),
      store.get("master", "vehicles"),
      store.get("master", "parts"),
    ]);

  const years = mergeIds(listedReserves, (reservesIndex && reservesIndex.years) || [], /^\d{4}$/);
  if (!years.length) years.push(String(manilaYear()));

  const yearDocs = await Promise.all(years.map((y) => store.get("reserves", y)));
  const reserves = [];
  yearDocs.forEach((doc) => {
    if (doc && Array.isArray(doc.rows)) {
      doc.rows.forEach((row) => {
        if (row) reserves.push(thaw(row));
      });
    }
  });

  const months = mergeIds(listedLedger, (ledgerIndex && ledgerIndex.months) || [], /^\d{4}-\d{2}$/);
  reserves.forEach((r) => {
    const mk = monthKey(r && r.date);
    if (mk && months.indexOf(mk) < 0) months.push(mk);
  });
  months.sort();

  const monthDocs = await Promise.all(months.map((m) => store.get("ledger", m)));
  const ledgerByMonth = {};
  const ledgerRows = [];
  months.forEach((m, i) => {
    const doc = monthDocs[i];
    const rows = doc && Array.isArray(doc.rows) ? doc.rows.map(thaw) : [];
    ledgerByMonth[m] = rows;
    rows.forEach((row) => ledgerRows.push(row));
  });

  return {
    reserves,
    reserveYears: years,
    ledgerRows,
    ledgerByMonth,
    ledgerMonths: months.slice(),
    ledgerIndexDirty: false,
    cfg: configFromDoc(cfgDoc),
    cfgDirty: false,
    vehicles: thaw(vehicles) || { rows: [] },
    parts: thaw(parts) || { rows: [] },
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

async function persistApprove(store, snapshot, result) {
  const year = yearOf(result.hold.date);
  const yearRows = snapshot.reserves.filter((r) => yearOf(r.date) === year);
  const writes = [
    store.set("reserves", year, { year, rows: yearRows }),
    store.set("ledger", result.month, {
      month: result.month,
      rows: snapshot.ledgerByMonth[result.month] || [],
    }),
  ];
  if (snapshot.ledgerIndexDirty) {
    writes.push(store.set("ledger", "index", { months: snapshot.ledgerMonths }));
  }
  if ((snapshot.reserveYears || []).indexOf(year) < 0) {
    const years = (snapshot.reserveYears || []).concat([year]).sort();
    writes.push(store.set("reserves", "index", { years }));
  }
  if (snapshot.cfgDirty) {
    writes.push(store.set("config", "app", configPayload(snapshot.cfg)));
  }
  await Promise.all(writes);
}

/**
 * Load holds + ledger, approve one pending VRF, write the same docs the portal uses.
 */
async function approvePendingVrf(store, body, options) {
  const key = normalizeVrfRequest(body);
  const snapshot = await loadSnapshot(store);
  const hold = resolveHold(snapshot, key);
  const result = applyApproveFromHold(snapshot, hold, {
    approverNote: body && body.approverNote,
    approvedBy: body && body.approvedBy,
    now: options && options.now,
  });
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
  };
}

function createMemoryStore(initial) {
  const docs = Object.create(null);
  Object.keys(initial || {}).forEach((path) => {
    docs[path] = thaw(initial[path]);
  });
  return {
    async get(collection, id) {
      const data = docs[`${collection}/${id}`];
      return data == null ? null : thaw(data);
    },
    async set(collection, id, data) {
      docs[`${collection}/${id}`] = thaw(data);
      return docs[`${collection}/${id}`];
    },
    async list(collection) {
      const prefix = `${collection}/`;
      return Object.keys(docs)
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ id: k.slice(prefix.length), data: thaw(docs[k]) }));
    },
    _docs: docs,
  };
}

module.exports = {
  applyApproveFromHold,
  approveError,
  approvePendingVrf,
  createMemoryStore,
  createSupabaseStore,
  isPostedNumber,
  loadSnapshot,
  normalizeVrfRequest,
  persistApprove,
  postedVrfNumbers,
  resolveHold,
  shouldRemintHeldVrf,
  usedVrfNumbers,
};
