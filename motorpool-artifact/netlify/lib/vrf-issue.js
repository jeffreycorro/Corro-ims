"use strict";

/**
 * VRF numbers are assigned when a row is saved, on the server, under the
 * counter lock. A failed save does not consume a number. A duplicate the
 * portal itself created (the same VRF on two reserves) is resolved at save
 * time: the older or real reserve keeps the number, an empty duplicate is
 * archived, and a duplicate that has a real request gets the next free number.
 * Nothing is deleted.
 */

const RUNAWAY_FROM = 5926;
const PAPER = { "6033": true };

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normNo(n) {
  return String(n == null ? "" : n).trim();
}

function vrfSeq(n) {
  const s = normNo(n);
  const m = /^(?:vrf[\s-]*)?(\d+)$/i.exec(s);
  if (!m) return 0;
  const v = parseInt(m[1], 10);
  if (!isFinite(v) || v < 1 || String(v) !== m[1]) return 0;
  return v;
}

function badRequest(message) {
  const err = new Error(message);
  err.code = "bad_request";
  err.statusCode = 400;
  return err;
}

function closedOut(r) {
  if (!r) return true;
  const st = String(r.status || "");
  return st === "Rejected" || st === "Archived" || r.archived === true;
}

function isSealed(r) {
  if (!r || closedOut(r)) return false;
  const st = String(r.status || "");
  if (st === "Approved" || st === "Closed" || st === "Cancelled" || st === "Flagged") return true;
  if (r.liquidatedAt || r.printedAt || r.approvedAt) return true;
  if (PAPER[normNo(r.vrfNo)]) return true;
  return false;
}

function hasContent(r) {
  if (!r || closedOut(r)) return false;
  if (isSealed(r)) return true;
  const lines = r.draftLines || [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (String(l.cat || "").trim() || String(l.item || "").trim()) return true;
    if (Number(l.qty) || Number(l.price)) return true;
  }
  if (String(r.draftPurpose || "").trim() || String(r.scope || "").trim()) return true;
  if (Number(r.budget) > 0 || Number(r.approvedBudget) > 0) return true;
  return false;
}

function claimsOf(r) {
  const out = [];
  const seen = {};
  function add(n) {
    n = normNo(n);
    if (!n || seen[n]) return;
    seen[n] = 1;
    out.push(n);
  }
  if (!r || closedOut(r)) return out;
  add(r.vrfNo);
  (r.vrfs || []).forEach(add);
  return out;
}

function blockedNumbers(issued) {
  const blocked = { "6033": true };
  const numbers = issued && issued.numbers && typeof issued.numbers === "object" ? issued.numbers : {};
  Object.keys(numbers).forEach((k) => {
    const row = numbers[k];
    if (row && row.sealed === false) return;
    const n = normNo((row && (row.no || row.vrf)) || k);
    if (n) blocked[n] = true;
  });
  return blocked;
}

function collectUsed(reserves, ledgerRows) {
  const used = {};
  function add(n) {
    const seq = vrfSeq(n);
    if (seq) used[String(seq)] = true;
  }
  (reserves || []).forEach((r) => claimsOf(r).forEach(add));
  (ledgerRows || []).forEach((row) => add(row && row.vrf));
  return used;
}

function highestReal(used, blocked) {
  let max = 0;
  Object.keys(used || {}).forEach((k) => {
    if (blocked && blocked[k]) return;
    const n = vrfSeq(k);
    if (n > max) max = n;
  });
  return max;
}

function nextFree(used, blocked, from) {
  let n = parseInt(from, 10);
  if (!isFinite(n) || n < 1) n = 1;
  let guard = 0;
  while ((used[String(n)] || (blocked && blocked[String(n)])) && guard < 100000) {
    n += 1;
    guard += 1;
  }
  return n;
}

function nextFromUsed(used, blocked, storedNext) {
  const max = highestReal(used, blocked);
  if (!max) {
    const stored = vrfSeq(storedNext) || 1;
    return nextFree(used, blocked, stored);
  }
  return nextFree(used, blocked, max + 1);
}

function yearOf(r) {
  const d = String((r && r.date) || "");
  const m = /^(\d{4})/.exec(d);
  if (m) return m[1];
  return String(new Date().getFullYear());
}

function nextReserveNumber(reserves) {
  let max = 0;
  (reserves || []).forEach((r) => {
    const n = parseInt(String(r && r.no), 10);
    if (isFinite(n) && n > max && String(n) === String(r.no).trim()) max = n;
  });
  return max + 1;
}

function numericNo(r) {
  const n = parseInt(String(r && r.no), 10);
  return isFinite(n) && String(n) === String(r.no).trim() ? n : null;
}

function pickKeeper(group) {
  return group.slice().sort((a, b) => {
    const as = isSealed(a) ? 2 : hasContent(a) ? 1 : 0;
    const bs = isSealed(b) ? 2 : hasContent(b) ? 1 : 0;
    if (as !== bs) return bs - as;
    const an = numericNo(a);
    const bn = numericNo(b);
    if (an != null && bn != null && an !== bn) return an - bn;
    const ad = String(a.date || "");
    const bd = String(b.date || "");
    if (ad !== bd) return ad < bd ? -1 : 1;
    return String(a.no).localeCompare(String(b.no));
  })[0];
}

function uniqueByNo(list) {
  const out = [];
  const seen = {};
  (list || []).forEach((r) => {
    const k = String(r && r.no);
    if (seen[k]) return;
    seen[k] = 1;
    out.push(r);
  });
  return out;
}

function allocate(list, ctx) {
  const blocked = ctx.blocked || { "6033": true };
  const used = Object.assign({}, ctx.externalUsed || {}, collectUsed(list, []));
  const n = nextFromUsed(used, blocked, ctx.storedNext);
  if (ctx.externalUsed) ctx.externalUsed[String(n)] = true;
  return n;
}

function retarget(r, from, to, keeper, ctx) {
  const old = String(from);
  const next = String(to);
  if (String(r.vrfNo || "") === old) r.vrfNo = next;
  r.vrfs = (r.vrfs || []).map((x) => (String(x) === old ? next : x));
  if (claimsOf(r).indexOf(next) < 0) r.vrfNo = next;
  r.audit = (r.audit || []).concat([
    {
      at: (ctx && ctx.at) || "",
      by: "Motorpool",
      field: "vrfNo",
      from: old,
      to: next,
      note:
        "VRF " +
        old +
        " was also on RSV-" +
        keeper.no +
        ". That reserve kept it. This one was given VRF " +
        next +
        " so the save could go through.",
    },
  ]);
}

function archiveReserve(r, vrf, keeper, ctx) {
  const old = normNo(r.vrfNo || vrf);
  r.archived = true;
  r.status = "Archived";
  r.archivedAt = (ctx && ctx.at) || "";
  r.archivedVrfNo = old;
  r.archivedReason =
    "Duplicate of VRF " + vrf + " on RSV-" + keeper.no + ". Archived, not deleted.";
  if (String(r.vrfNo || "") === String(vrf)) r.vrfNo = "";
  r.vrfs = (r.vrfs || []).filter((x) => String(x) !== String(vrf));
  r.audit = (r.audit || []).concat([
    {
      at: r.archivedAt,
      by: "Motorpool",
      field: "status",
      from: old ? "VRF " + old : "",
      to: "Archived",
      note: r.archivedReason,
    },
  ]);
}

/**
 * Resolve every VRF claimed by more than one live reserve.
 * Rows are never removed. Returns a new list plus a change log.
 */
function resolveCollisions(rows, ctx) {
  ctx = ctx || {};
  const blocked = Object.assign({ "6033": true }, ctx.blocked || {});
  const local = Object.assign({}, ctx, { blocked });
  const list = (rows || []).map(clone);
  const changes = [];
  const stuck = {};
  for (let pass = 0; pass < 12; pass++) {
    const groups = {};
    list.forEach((r) => {
      claimsOf(r).forEach((no) => {
        (groups[no] = groups[no] || []).push(r);
      });
    });
    const dupes = Object.keys(groups).filter((no) => uniqueByNo(groups[no]).length > 1 && !stuck[no]);
    if (!dupes.length) break;
    let moved = false;
    dupes.forEach((no) => {
      const group = uniqueByNo(groups[no]);
      const keeper = pickKeeper(group);
      group.forEach((r) => {
        if (r === keeper) return;
        if (isSealed(r) && isSealed(keeper)) {
          stuck[no] = true;
          changes.push({
            action: "kept-sealed",
            outcome: "kept-sealed",
            reserveNo: String(r.no),
            no,
            keeper: String(keeper.no),
          });
          return;
        }
        if (!hasContent(r)) {
          archiveReserve(r, no, keeper, local);
          changes.push({
            action: "archived",
            outcome: "archived",
            reserveNo: String(r.no),
            no,
            from: no,
            keeper: String(keeper.no),
            note: r.archivedReason,
          });
          moved = true;
          return;
        }
        if (isSealed(r)) {
          stuck[no] = true;
          return;
        }
        const fresh = String(allocate(list, local));
        retarget(r, no, fresh, keeper, local);
        changes.push({
          action: "renumbered",
          outcome: "renumbered",
          reserveNo: String(r.no),
          no: fresh,
          from: no,
          to: fresh,
          keeper: String(keeper.no),
        });
        moved = true;
      });
    });
    if (!moved) break;
  }
  return { reserves: list, changes };
}

function numberTakenByOther(reserves, reserve) {
  const no = normNo(reserve && reserve.vrfNo);
  if (!no) return false;
  return (reserves || []).some((r) => {
    if (!r || String(r.no) === String(reserve.no)) return false;
    return claimsOf(r).indexOf(no) !== -1;
  });
}

function assignIncoming(reserve, reserves, ctx) {
  if (!reserve || typeof reserve !== "object") throw badRequest("Reserve is required");
  const copy = clone(reserve);
  if (copy.no == null || String(copy.no) === "") copy.no = String(nextReserveNumber(reserves));
  const others = (reserves || []).filter((r) => String(r.no) !== String(copy.no));
  if (!normNo(copy.vrfNo) || numberTakenByOther(reserves, copy)) {
    const n = allocate(others, ctx);
    copy.vrfNo = String(n);
    copy.vrfs = (copy.vrfs || []).filter((x) => normNo(x) && normNo(x) !== normNo(reserve.vrfNo));
  }
  return copy;
}

function diffChanges(before, after) {
  const prev = {};
  (before || []).forEach((r) => {
    if (r && r.no != null) prev[String(r.no)] = r;
  });
  const changes = [];
  (after || []).forEach((r) => {
    if (!r || r.no == null) return;
    const old = prev[String(r.no)];
    if (!old) {
      changes.push({
        action: "saved",
        outcome: "saved",
        reserveNo: String(r.no),
        no: normNo(r.vrfNo),
      });
      return;
    }
    if (!closedOut(old) && closedOut(r) && String(r.status) === "Archived") {
      changes.push({
        action: "archived",
        outcome: "archived",
        reserveNo: String(r.no),
        no: normNo(old.vrfNo || r.archivedVrfNo),
        from: normNo(old.vrfNo),
        keeper: "",
        note: r.archivedReason || "",
      });
      return;
    }
    if (normNo(old.vrfNo) && normNo(old.vrfNo) !== normNo(r.vrfNo)) {
      changes.push({
        action: "renumbered",
        outcome: "renumbered",
        reserveNo: String(r.no),
        no: normNo(r.vrfNo),
        from: normNo(old.vrfNo),
        to: normNo(r.vrfNo),
      });
    }
  });
  return changes;
}

function mergeReserveDetailed(existing, reserve, ctx) {
  if (!reserve || reserve.no == null || String(reserve.no) === "") {
    throw badRequest("Reserve number is required");
  }
  const cur = (existing || []).map(clone);
  const incoming = clone(reserve);
  const key = String(incoming.no);
  const idx = cur.findIndex((r) => r && String(r.no) === key);
  if (idx >= 0) cur[idx] = incoming;
  else cur.push(incoming);
  const resolved = resolveCollisions(cur, ctx || {});
  const saved = resolved.reserves.find((r) => r && String(r.no) === key) || null;
  return { rows: resolved.reserves, changes: resolved.changes, saved };
}

function reserveNos(rows) {
  const out = [];
  const seen = {};
  (rows || []).forEach((r) => {
    if (!r || r.no == null || String(r.no) === "") return;
    const n = String(r.no);
    if (seen[n]) return;
    seen[n] = 1;
    out.push(n);
  });
  return out;
}

function assertNoReserveDropped(before, after) {
  const have = {};
  reserveNos(after).forEach((n) => {
    have[n] = 1;
  });
  const gone = reserveNos(before).filter((n) => !have[n]);
  if (gone.length) {
    const err = new Error(
      "Refusing to drop RSV-" + gone[0] + " while saving another reserve."
    );
    err.code = "stale_overwrite";
    err.statusCode = 409;
    throw err;
  }
}

function isBlobOverwrite(collection, id) {
  if (collection === "reserves" && /^\d{4}$/.test(String(id))) return true;
  if (collection === "ledger" && /^\d{4}-\d{2}$/.test(String(id))) return true;
  return false;
}

function screenClientSet(collection, id) {
  if (!isBlobOverwrite(collection, id)) return null;
  return {
    statusCode: 409,
    error: "This list is saved one record at a time. Reload the page. Nothing was overwritten.",
    code: "stale_overwrite",
  };
}

function clampClientCounter(existingNext, incomingNext) {
  const cur = vrfSeq(existingNext);
  const inc = vrfSeq(incomingNext);
  if (cur && inc > cur) return cur;
  return inc || cur || existingNext || 1;
}

function orphanNumbers(used, blocked, storedNext) {
  const max = highestReal(used, blocked);
  const oldNext = vrfSeq(storedNext) || 0;
  const hi = Math.max(oldNext, max + 1) - 1;
  const out = [];
  for (let n = RUNAWAY_FROM; n <= hi && out.length < 250; n++) {
    if (used[String(n)] || (blocked && blocked[String(n)])) continue;
    out.push(String(n));
  }
  return out;
}

function actorFrom(spec) {
  spec = spec || {};
  return {
    at: spec.at || new Date().toISOString(),
    user: normNo(spec.user) || "unknown",
    device: normNo(spec.device) || "unknown",
  };
}

function pushAudit(audit, entries) {
  const prev = audit && Array.isArray(audit.entries) ? audit.entries : [];
  return { entries: entries.concat(prev).slice(0, 300) };
}

async function loadPicture(io) {
  if (!io || !io.listIds || !io.getRecord) throw badRequest("Server store is not available");
  const [reserveIds, ledgerIds, issuedRec, appRec, auditRec] = await Promise.all([
    io.listIds("reserves"),
    io.listIds("ledger"),
    io.getRecord("config", "issued"),
    io.getRecord("config", "app"),
    io.getRecord("config", "vrf-audit"),
  ]);
  const years = (reserveIds || []).filter((id) => /^\d{4}$/.test(String(id)));
  const months = (ledgerIds || []).filter((id) => /^\d{4}-\d{2}$/.test(String(id)));
  const yearRecs = {};
  const monthRecs = {};
  await Promise.all(
    years.map(async (y) => {
      yearRecs[y] = await io.getRecord("reserves", y);
    }).concat(
      months.map(async (m) => {
        monthRecs[m] = await io.getRecord("ledger", m);
      })
    )
  );
  const byYear = {};
  const originalByYear = {};
  const reserves = [];
  years.forEach((y) => {
    const rows = ((yearRecs[y] && yearRecs[y].data && yearRecs[y].data.rows) || []).map(clone);
    byYear[y] = rows;
    originalByYear[y] = JSON.stringify(rows);
    rows.forEach((r) => reserves.push(r));
  });
  const byMonth = {};
  const originalByMonth = {};
  const ledgerRows = [];
  months.forEach((m) => {
    const rows = (monthRecs[m] && monthRecs[m].data && monthRecs[m].data.rows) || [];
    byMonth[m] = rows.map(clone);
    originalByMonth[m] = JSON.stringify(byMonth[m]);
    byMonth[m].forEach((row) => ledgerRows.push(row));
  });
  const app = (appRec && appRec.data) || {};
  return {
    years,
    months,
    yearRecs,
    monthRecs,
    byYear,
    byMonth,
    originalByYear,
    originalByMonth,
    reserves,
    ledgerRows,
    blocked: blockedNumbers(issuedRec && issuedRec.data),
    app,
    appUpdated: appRec && appRec.updated_at,
    audit: (auditRec && auditRec.data) || { entries: [] },
    auditUpdated: auditRec && auditRec.updated_at,
    nextVrfStored: vrfSeq(app.nextVrf),
  };
}

function regroup(reserves) {
  const byYear = {};
  (reserves || []).forEach((r) => {
    const y = yearOf(r);
    (byYear[y] = byYear[y] || []).push(r);
  });
  return byYear;
}

async function putDoc(io, collection, id, data, updatedAt) {
  if (updatedAt && io.cas) {
    await io.cas(collection, id, data, updatedAt);
    return;
  }
  await io.set(collection, id, data);
}

async function withCounterLock(io, fn) {
  if (!io.acquire) return fn();
  const holder = "vrf-" + Math.random().toString(36).slice(2, 10);
  let locked = false;
  for (let i = 0; i < 25; i++) {
    const lock = await io.acquire("config", "counter", holder);
    if (lock && lock.acquired) {
      locked = true;
      break;
    }
    await new Promise((res) => setTimeout(res, 40));
  }
  if (!locked) {
    const err = new Error(
      "Could not reserve a VRF number. Another device is saving. Nothing was numbered. Try again."
    );
    err.code = "vrf_counter";
    err.statusCode = 409;
    throw err;
  }
  try {
    return await fn();
  } finally {
    if (io.release) {
      try {
        await io.release("config", "counter", holder);
      } catch (e) {
        /* the lock expires on its own */
      }
    }
  }
}

async function commitIssueOnce(spec, io) {
  spec = spec || {};
  const kind = spec.kind;
  const who = actorFrom(spec);
  const picture = await loadPicture(io);
  const ctx = {
    blocked: picture.blocked,
    externalUsed: collectUsed([], picture.ledgerRows),
    at: who.at,
    storedNext: picture.nextVrfStored,
  };
  const before = clone(picture.reserves);
  let healed = resolveCollisions(picture.reserves, ctx);
  let reserves = healed.reserves;

  let saved = null;
  let ledgerNo = "";
  if ((kind === "issue" || kind === "reserve") && spec.reserve) {
    const incoming = assignIncoming(spec.reserve, reserves, ctx);
    const y = yearOf(incoming);
    const bucket = reserves.filter((r) => yearOf(r) !== y);
    const mine = reserves.filter((r) => yearOf(r) === y);
    const idx = mine.findIndex((r) => String(r.no) === String(incoming.no));
    if (idx >= 0) mine[idx] = incoming;
    else mine.push(incoming);
    reserves = bucket.concat(mine);
    healed = resolveCollisions(reserves, ctx);
    reserves = healed.reserves;
    saved = reserves.find((r) => r && String(r.no) === String(incoming.no)) || null;
  }

  let monthWritten = "";
  if (kind === "issue-ledger") {
    const month = normNo(spec.month);
    if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest("VRF number and month are required");
    const incoming = spec.rows || [];
    if (!incoming.length) throw badRequest("Nothing to save");
    const usedNow = Object.assign({}, ctx.externalUsed, collectUsed(reserves, []));
    ledgerNo = String(nextFromUsed(usedNow, picture.blocked, picture.nextVrfStored));
    ctx.externalUsed[ledgerNo] = true;
    const stamped = incoming.map((row) => Object.assign(clone(row) || {}, { vrf: ledgerNo }));
    const beforeRows = picture.byMonth[month] || [];
    picture.byMonth[month] = beforeRows.concat(stamped);
    picture.dirtyMonths = picture.dirtyMonths || {};
    picture.dirtyMonths[month] = picture.monthRecs[month];
    picture.ledgerRows = picture.ledgerRows.concat(stamped);
    monthWritten = month;
    saved = { vrf: ledgerNo };
  }

  const byYear = regroup(reserves);
  const usedFinal = collectUsed(reserves, picture.ledgerRows);
  const nextVrf = nextFromUsed(usedFinal, picture.blocked, picture.nextVrfStored);
  const nextReserve = nextReserveNumber(reserves);
  const orphans = orphanNumbers(usedFinal, picture.blocked, picture.nextVrfStored || nextVrf);
  const signature = orphans.join(",");
  const logOrphans = signature && signature !== String(picture.app.orphanSignature || "");
  const changes = diffChanges(before, reserves);
  if (ledgerNo) {
    changes.push({
      action: "saved",
      outcome: "saved",
      no: ledgerNo,
      reserveNo: "",
      note: "Saved with the ledger row",
    });
  }

  const dirtyYears = Object.keys(byYear);
  for (let i = 0; i < dirtyYears.length; i++) {
    const y = dirtyYears[i];
    const rows = byYear[y];
    const nextJson = JSON.stringify(rows);
    if (picture.originalByYear[y] === nextJson) continue;
    assertNoReserveDropped(picture.originalByYear[y] ? JSON.parse(picture.originalByYear[y]) : [], rows);
    const rec = picture.yearRecs[y];
    await putDoc(io, "reserves", y, { year: y, rows }, rec && rec.updated_at);
  }
  if (monthWritten) {
    const rows = picture.byMonth[monthWritten];
    const rec = picture.monthRecs[monthWritten];
    await putDoc(
      io,
      "ledger",
      monthWritten,
      { month: monthWritten, rows },
      rec && rec.updated_at
    );
  }

  const app = Object.assign({}, picture.app, {
    nextVrf,
    nextReserve,
    orphanSignature: logOrphans ? signature : picture.app.orphanSignature || "",
  });
  await putDoc(io, "config", "app", app, picture.appUpdated);

  const auditEntries = [];
  changes.forEach((c) => {
    if (!c || c.action === "kept-sealed") return;
    auditEntries.push({
      no: c.no || c.to || "",
      from: c.from || "",
      reserveNo: c.reserveNo || "",
      at: who.at,
      user: who.user,
      device: who.device,
      outcome: c.outcome || c.action,
      note: c.note || "",
    });
  });
  if (logOrphans) {
    auditEntries.push({
      no: orphans.length ? orphans[orphans.length - 1] : "",
      numbers: orphans,
      at: who.at,
      user: who.user,
      device: who.device,
      outcome: "orphaned",
      note:
        "These numbers sit in the counter gap and no saved VRF or reserve row has them. They were not given out again.",
    });
  }
  let audit = picture.audit;
  if (auditEntries.length) {
    audit = pushAudit(picture.audit, auditEntries);
    await putDoc(io, "config", "vrf-audit", audit, picture.auditUpdated);
  }

  return {
    ok: true,
    kind: kind || "repair",
    nextVrf,
    nextReserve,
    reserve: saved && saved.no != null ? saved : null,
    vrf: ledgerNo || (saved && normNo(saved.vrfNo)) || "",
    vrfNo: saved && saved.vrfNo ? normNo(saved.vrfNo) : ledgerNo,
    reserveNo: saved && saved.no != null ? String(saved.no) : "",
    changes,
    orphans,
    audit: (audit && audit.entries) || [],
    changed: changes.some((c) => c.action === "archived" || c.action === "renumbered"),
  };
}

async function commitIssue(spec, io) {
  return withCounterLock(io, async () => {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await commitIssueOnce(spec, io);
        result.attempts = attempt + 1;
        return result;
      } catch (err) {
        last = err;
        if (!err || err.code !== "conflict" || attempt === 2) throw err;
      }
    }
    throw last;
  });
}

module.exports = {
  RUNAWAY_FROM,
  actorFrom,
  allocate,
  assertNoReserveDropped,
  assignIncoming,
  blockedNumbers,
  clampClientCounter,
  clone,
  closedOut,
  collectUsed,
  commitIssue,
  diffChanges,
  hasContent,
  highestReal,
  isBlobOverwrite,
  isSealed,
  mergeReserveDetailed,
  nextFree,
  nextFromUsed,
  nextReserveNumber,
  normNo,
  orphanNumbers,
  pickKeeper,
  resolveCollisions,
  screenClientSet,
  vrfSeq,
  yearOf,
};
