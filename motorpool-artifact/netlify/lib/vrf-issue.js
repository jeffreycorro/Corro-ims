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
const MIN_WRITE_BUILD = "2026-10-06 a";
const UNNUMBERED_ISSUED_KEY = "— not yet posted —";

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

function reserveAgeKey(r) {
  const created = String((r && (r.createdAt || r.submittedAt || r.date)) || "9999-99-99").slice(0, 10);
  const no = numericNo(r);
  const noKey = no == null ? "99999999" : String(no).padStart(8, "0");
  return created + "|" + noKey;
}

function pickKeeper(group) {
  return group.slice().sort((a, b) => {
    const as = isSealed(a) ? 2 : hasContent(a) ? 1 : 0;
    const bs = isSealed(b) ? 2 : hasContent(b) ? 1 : 0;
    if (as !== bs) return bs - as;
    const ak = reserveAgeKey(a);
    const bk = reserveAgeKey(b);
    if (ak !== bk) return ak < bk ? -1 : 1;
    return String(a.no).localeCompare(String(b.no));
  })[0];
}

function formatPaperDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!m) return "";
  return String(Number(m[2])) + "/" + String(Number(m[3]));
}

function paperRenumberNote(from, to, printedAt) {
  const day = formatPaperDay(printedAt);
  const printed = day
    ? "Printed as VRF " + from + " on " + day + "."
    : "Printed as VRF " + from + ".";
  return printed + " Now VRF " + to + ". Please re-mark the paper copy.";
}

function stripSigFields(row) {
  if (!row || typeof row !== "object") return row;
  const copy = clone(row);
  ["preparedSig", "checkedSig", "approvedSig"].forEach((key) => {
    if (typeof copy[key] === "string" && copy[key].length > 80) {
      if (!copy[key + "Ref"]) copy[key + "Ref"] = copy[key + "Name"] || key;
      delete copy[key];
    }
  });
  return copy;
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
          if (local.renumberSealed === false) {
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
          const fresh = String(allocate(list, local));
          const printedAt = r.printedAt || r.date || "";
          retarget(r, no, fresh, keeper, local);
          r.printedAs = String(no);
          r.renumberNote = paperRenumberNote(String(no), fresh, printedAt);
          const last = r.audit && r.audit[r.audit.length - 1];
          if (last) last.note = r.renumberNote;
          changes.push({
            action: "renumbered",
            outcome: "renumbered",
            reserveNo: String(r.no),
            no: fresh,
            from: no,
            to: fresh,
            keeper: String(keeper.no),
            note: r.renumberNote,
          });
          moved = true;
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
  const copy = stripSigFields(clone(reserve));
  /* A create never keeps a number the browser picked. Two stale tabs were
     both saving 6113 because each one chose it from its own copy. */
  delete copy.no;
  delete copy.vrfNo;
  copy.vrfs = [];
  copy.no = String(nextReserveNumber(reserves));
  copy.vrfNo = String(allocate(reserves, ctx));
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
  ctx = ctx || {};
  if (!reserve || reserve.no == null || String(reserve.no) === "") {
    throw badRequest("Reserve number is required");
  }
  const cur = (existing || []).map(clone);
  const incoming = stripSigFields(clone(reserve));
  const key = String(incoming.no);
  const idx = cur.findIndex((r) => r && String(r.no) === key);
  let savedKey = key;
  if (idx >= 0) {
    const prev = cur[idx];
    const patched = stripSigFields(Object.assign({}, prev, incoming));
    patched.no = prev.no;
    patched.vrfNo = prev.vrfNo;
    if ((prev.audit || []).length > (patched.audit || []).length) patched.audit = prev.audit;
    if (prev.renumberNote && !incoming.renumberNote) patched.renumberNote = prev.renumberNote;
    if (prev.printedAs && !incoming.printedAs) patched.printedAs = prev.printedAs;
    cur[idx] = patched;
  } else if (ctx.trustNumber && normNo(incoming.vrfNo) && !numberTakenByOther(cur, incoming)) {
    cur.push(incoming);
  } else {
    const assigned = assignIncoming(incoming, cur, ctx);
    savedKey = String(assigned.no);
    cur.push(assigned);
  }
  const resolved = resolveCollisions(cur, ctx);
  const saved =
    resolved.reserves.find((r) => r && String(r.no) === savedKey) ||
    resolved.reserves.find((r) => r && String(r.no) === key) ||
    null;
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
  /* The counter only moves forward on the server. A stale tab must not
     raise it and must not roll it back. */
  if (cur && inc && inc !== cur) return cur;
  if (cur) return cur;
  return inc || existingNext || incomingNext || 1;
}

function mergeAppConfig(existing, incoming) {
  const base = existing && typeof existing === "object" ? clone(existing) : {};
  const inc = incoming && typeof incoming === "object" ? incoming : {};
  const merged = Object.assign({}, base, inc);
  merged.nextVrf = clampClientCounter(base.nextVrf, inc.nextVrf);
  if (base.orphanSignature && !inc.orphanSignature) merged.orphanSignature = base.orphanSignature;
  return merged;
}

function buildAccepted(build) {
  return String(build == null ? "" : build) >= MIN_WRITE_BUILD;
}

function gateWrite(body) {
  body = body || {};
  const op = body.op;
  if (op !== "set" && op !== "delete" && op !== "merge") return null;
  if (op !== "merge") {
    const collection = body.collection;
    if (collection !== "reserves" && collection !== "ledger" && collection !== "config") return null;
  }
  if (buildAccepted(body.build)) return null;
  return { statusCode: 409, error: "Reload the page", code: "stale_client" };
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
    renumberSealed: kind !== "repair",
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

function paperReserve6033() {
  return {
    no: "paper-6033",
    vrfNo: "6033",
    vrfs: ["6033"],
    date: "2026-10-03",
    kind: "job",
    veh: "Equipment 1",
    name: "ONE BAGGER MIXER",
    plate: "EQUIPMENT",
    work: "FUEL-STN",
    project: "Danao Guinacot",
    budget: 1000,
    approvedBudget: 1000,
    status: "Approved",
    requestedBy: "Engr. Kimberly Galapin",
    approvedBy: "Jeffrey James M. Corro",
    approvedAt: "2026-10-03T14:05:00+08:00",
    printedAt: "2026-10-03T14:05:00+08:00",
    draftPurpose: "Fuel — Gasoline ×11.53",
    preparedSigName: "Sophie V. Batas",
    submissionId: "paper-vrf-6033",
    draftLines: [
      {
        cat: "Fuel — Gasoline",
        item: "Fuel",
        supplier: "Iced Petron",
        qty: 11.53,
        unit: "L",
        price: 86.73,
        work: "FUEL-STN",
      },
    ],
  };
}

function paperLedger6033() {
  return {
    month: "2026-10",
    date: "2026-10-03",
    vrf: "6033",
    veh: "Equipment 1",
    name: "ONE BAGGER MIXER",
    plate: "EQUIPMENT",
    cat: "Fuel — Gasoline",
    item: "Fuel",
    qty: 11.53,
    price: 86.73,
    total: 1000,
    supplier: "Iced Petron",
    unit: "L",
    project: "Danao Guinacot",
    work: "FUEL-STN",
    reserve: "paper-6033",
    requestedBy: "Engr. Kimberly Galapin",
    notes: "Fuel — Gasoline ×11.53",
  };
}

function draftFromIssued(entry) {
  const snap = (entry && entry.snapshot) || {};
  const reserve = snap.reserve || {};
  const rows = Array.isArray(snap.rows) ? snap.rows : [];
  const first = rows[0] || {};
  const lines =
    Array.isArray(reserve.draftLines) && reserve.draftLines.length
      ? clone(reserve.draftLines)
      : rows.map((row) => ({
          cat: row.cat || "",
          item: row.item || "",
          supplier: row.supplier || "",
          qty: row.qty,
          price: row.price,
          unit: row.unit || "",
          work: row.work || "",
        }));
  return {
    no: "draft-unnumbered",
    vrfNo: "",
    vrfs: [],
    unnumbered: true,
    draftUnnumbered: true,
    date: reserve.date || first.date || "",
    veh: reserve.veh || first.veh || "",
    project: reserve.project || first.project || "",
    work: reserve.work || first.work || "",
    requestedBy: reserve.requestedBy || first.requestedBy || "",
    draftPurpose: reserve.draftPurpose || first.notes || "",
    draftOdo: reserve.draftOdo || (first.odo == null ? "" : String(first.odo)),
    draftLines: lines,
    status: "Requested",
    submissionId: "draft-unnumbered-bt02",
    renumberNote: "Printed without a number. Send this draft so it receives the next VRF number.",
    printedAt: (entry && entry.at) || reserve.printedAt || "",
  };
}

function holdTotal(r) {
  let sum = 0;
  (r && r.draftLines ? r.draftLines : []).forEach((line) => {
    sum += (Number(line && line.qty) || 0) * (Number(line && line.price) || 0);
  });
  if (!sum && Number(r && r.budget)) sum = Number(r.budget);
  return Math.round(sum * 100) / 100;
}

/* One log row per live reserve. Two reserves that share a VRF number both
   stay on the list, with their own lines. An unnumbered printed draft stays too. */
function visibleHolds(reserves) {
  const out = [];
  (reserves || []).forEach((r) => {
    if (!r || closedOut(r)) return;
    const numbered = vrfSeq(r.vrfNo);
    const unnumbered =
      !numbered &&
      (r.unnumbered || r.draftUnnumbered || normNo(r.submissionId) === "draft-unnumbered-bt02");
    if (!numbered && !unnumbered) return;
    out.push({
      vrf: numbered ? String(numbered) : UNNUMBERED_ISSUED_KEY,
      reserve: String(r.no),
      veh: r.veh || "",
      total: holdTotal(r),
      lines: (r.draftLines || []).length,
      paperNote: r.renumberNote || "",
      printedAs: r.printedAs || "",
      unnumbered: !numbered,
    });
  });
  return out;
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

function copyIssued(entry, no, reserveNo, extra) {
  const next = Object.assign({}, entry || {}, extra || {}, { no: String(no), sealed: true });
  if (reserveNo) next.reserveNo = String(reserveNo);
  return next;
}

/**
 * Additive restore plan. Existing rows are copied, never removed.
 * Same-day duplicates: the lower reserve number keeps the VRF.
 * Duplicate numbers are walked from the highest down, so 6113's
 * second copy takes the next free number before 6112's.
 */
function planRestore(input) {
  input = input || {};
  const reserves = (input.reserves || []).map((r) => stripSigFields(clone(r)));
  const ledger = (input.ledger || []).map(clone);
  const issued = clone(input.issued) || { numbers: {} };
  if (!issued.numbers || typeof issued.numbers !== "object") issued.numbers = {};
  const app = Object.assign({}, clone(input.app) || {});
  const orphanSignature = app.orphanSignature || "";
  const used = {};
  function addUsed(n) {
    const seq = vrfSeq(n);
    if (seq) used[String(seq)] = true;
  }
  reserves.forEach((r) => claimsOf(r).forEach(addUsed));
  ledger.forEach((row) => addUsed(row && row.vrf));
  Object.keys(issued.numbers).forEach(addUsed);
  addUsed("6033");
  const blocked = { "6033": true };

  const groups = {};
  reserves.forEach((r) => {
    if (closedOut(r)) return;
    const seq = vrfSeq(r.vrfNo);
    if (!seq) return;
    (groups[String(seq)] = groups[String(seq)] || []).push(r);
  });
  const changes = [];
  Object.keys(groups)
    .filter((no) => groups[no].length > 1)
    .sort((a, b) => Number(b) - Number(a))
    .forEach((no) => {
      const group = groups[no].slice().sort((a, b) => {
        const ak = reserveAgeKey(a);
        const bk = reserveAgeKey(b);
        if (ak !== bk) return ak < bk ? -1 : 1;
        return String(a.no).localeCompare(String(b.no));
      });
      const keeper = group[0];
      const snap = issued.numbers[no] || null;
      issued.numbers[no + "@" + keeper.no] = copyIssued(snap, no, keeper.no, {});
      group.slice(1).forEach((r) => {
        const fresh = String(nextFromUsed(used, blocked, null));
        used[fresh] = true;
        r.printedAs = String(no);
        r.renumberNote = paperRenumberNote(String(no), fresh, r.printedAt || r.date || "");
        if (String(r.vrfNo || "") === String(no)) r.vrfNo = fresh;
        r.vrfs = (r.vrfs || []).map((x) => (String(x) === String(no) ? fresh : x));
        if (!vrfSeq(r.vrfNo)) r.vrfNo = fresh;
        changes.push({
          reserveNo: String(r.no),
          from: String(no),
          to: fresh,
          note: r.renumberNote,
        });
        issued.numbers[no + "@" + r.no] = copyIssued(snap, no, r.no, { printedAs: String(no) });
        issued.numbers[fresh + "@" + r.no] = copyIssued(snap, fresh, r.no, {
          printedAs: String(no),
          now: fresh,
        });
      });
    });

  const has6033 =
    reserves.some((r) => vrfSeq(r.vrfNo) === 6033) || ledger.some((row) => vrfSeq(row && row.vrf) === 6033);
  if (!has6033) {
    reserves.push(paperReserve6033());
    ledger.push(paperLedger6033());
    used["6033"] = true;
  }

  let draft = null;
  const unnumbered = issued.numbers[UNNUMBERED_ISSUED_KEY];
  const hasDraft = reserves.some((r) => normNo(r.submissionId) === "draft-unnumbered-bt02");
  if (unnumbered && !hasDraft) {
    draft = draftFromIssued(unnumbered);
    reserves.push(draft);
  }

  const next = nextFromUsed(used, blocked, app.nextVrf);
  if (!vrfSeq(app.nextVrf) || next > vrfSeq(app.nextVrf)) app.nextVrf = next;
  app.orphanSignature = orphanSignature;

  return { reserves, ledger, issued, app, changes, draft };
}

function reserveList(state) {
  return Object.keys(state.records)
    .map((id) => state.records[id])
    .filter((rec) => rec && rec.kind === "reserve" && rec.data)
    .map((rec) => rec.data);
}

function liveUsed(state) {
  const used = { "6033": true };
  Object.keys(state.records).forEach((id) => {
    const rec = state.records[id];
    if (!rec) return;
    if (rec.kind === "reserve" && rec.live) {
      const seq = vrfSeq(rec.vrf_no);
      if (seq) used[String(seq)] = true;
    }
    if (rec.kind === "ledger") {
      const seq = vrfSeq(rec.vrf_no);
      if (seq) used[String(seq)] = true;
    }
  });
  const numbers = (state.issued && state.issued.numbers) || {};
  Object.keys(numbers).forEach((key) => {
    const seq = vrfSeq(key);
    if (seq) used[String(seq)] = true;
  });
  return used;
}

function bumpCounter(state, vrfNo, reserveNo) {
  const seq = vrfSeq(vrfNo);
  const cur = vrfSeq(state.app.nextVrf);
  if (seq && (!cur || seq + 1 > cur)) state.app.nextVrf = seq + 1;
  const no = parseInt(String(reserveNo), 10);
  const nextReserve = parseInt(String(state.app.nextReserve), 10) || 1;
  if (isFinite(no) && String(no) === String(reserveNo).trim() && no + 1 > nextReserve) {
    state.app.nextReserve = no + 1;
  }
}

function createRecordState(seed) {
  seed = seed || {};
  const records = {};
  (seed.reserves || []).forEach((row) => {
    const copy = stripSigFields(clone(row));
    const id = "reserve:" + copy.no;
    records[id] = {
      id,
      kind: "reserve",
      reserve_no: String(copy.no),
      vrf_no: normNo(copy.vrfNo),
      live: !closedOut(copy),
      year: yearOf(copy),
      data: copy,
    };
  });
  (seed.ledger || []).forEach((row) => {
    const vrf = normNo(row && row.vrf);
    if (!vrf) return;
    const id = "ledger:" + vrf;
    if (!records[id]) {
      records[id] = {
        id,
        kind: "ledger",
        vrf_no: vrf,
        live: true,
        month: row.month || "",
        data: { month: row.month || "", vrf, rows: [clone(row)] },
      };
    } else {
      records[id].data.rows.push(clone(row));
    }
  });
  return {
    records,
    issued: clone(seed.issued) || { numbers: {} },
    app: Object.assign({ nextVrf: 1, nextReserve: 1 }, clone(seed.app) || {}),
    queue: Promise.resolve(),
  };
}

function staleClientError() {
  const err = new Error("Reload the page");
  err.code = "stale_client";
  err.statusCode = 409;
  return err;
}

function findUnnumbered(state, submissionId) {
  const sub = normNo(submissionId);
  if (!sub) return null;
  const ids = Object.keys(state.records);
  for (let i = 0; i < ids.length; i++) {
    const rec = state.records[ids[i]];
    if (!rec || rec.kind !== "reserve" || !rec.data) continue;
    if (normNo(rec.data.submissionId) !== sub) continue;
    if (vrfSeq(rec.vrf_no)) continue;
    return rec;
  }
  return null;
}

function issueIntoRecordsOnce(state, spec) {
  spec = spec || {};
  if (!buildAccepted(spec.build)) throw staleClientError();
  const kind = spec.kind || "issue";
  if (kind === "repair") {
    return {
      ok: true,
      kind: "repair",
      store: "records",
      nextVrf: state.app.nextVrf,
      nextReserve: state.app.nextReserve,
      changes: [],
    };
  }
  const used = liveUsed(state);
  const ctx = { blocked: { "6033": true }, externalUsed: used, storedNext: state.app.nextVrf };
  const incoming = stripSigFields(clone(spec.reserve || {}));
  if (kind === "reserve" && normNo(incoming.no) && state.records["reserve:" + normNo(incoming.no)]) {
    const rec = state.records["reserve:" + normNo(incoming.no)];
    const prev = rec.data;
    const patched = stripSigFields(Object.assign({}, prev, incoming));
    patched.no = prev.no;
    patched.vrfNo = prev.vrfNo;
    if ((prev.audit || []).length > (patched.audit || []).length) patched.audit = prev.audit;
    if (prev.renumberNote && !incoming.renumberNote) patched.renumberNote = prev.renumberNote;
    if (prev.printedAs && !incoming.printedAs) patched.printedAs = prev.printedAs;
    rec.data = patched;
    rec.vrf_no = normNo(prev.vrfNo);
    rec.live = !closedOut(patched);
    return {
      ok: true,
      kind,
      store: "records",
      reserve: patched,
      reserveNo: String(patched.no),
      vrfNo: normNo(patched.vrfNo),
      nextVrf: state.app.nextVrf,
      nextReserve: state.app.nextReserve,
    };
  }
  const draft = findUnnumbered(state, incoming.submissionId);
  if (draft && (kind === "issue" || kind === "reserve")) {
    const fresh = String(allocate(reserveList(state), ctx));
    draft.data.vrfNo = fresh;
    draft.data.vrfs = [];
    draft.data.unnumbered = false;
    draft.vrf_no = fresh;
    draft.live = !closedOut(draft.data);
    bumpCounter(state, fresh, draft.data.no);
    return {
      ok: true,
      kind,
      store: "records",
      reserve: draft.data,
      reserveNo: String(draft.data.no),
      vrfNo: fresh,
      vrf: fresh,
      nextVrf: state.app.nextVrf,
      nextReserve: state.app.nextReserve,
    };
  }
  const trust =
    (spec.restore === true || normNo(incoming.vrfNo) === "6033") &&
    normNo(incoming.vrfNo) &&
    normNo(incoming.no) &&
    !used[String(vrfSeq(incoming.vrfNo))];
  let assigned;
  if (trust) {
    assigned = incoming;
  } else {
    assigned = assignIncoming(incoming, reserveList(state), ctx);
  }
  const id = "reserve:" + assigned.no;
  if (state.records[id]) throw badRequest("That reserve is already on file.");
  state.records[id] = {
    id,
    kind: "reserve",
    reserve_no: String(assigned.no),
    vrf_no: normNo(assigned.vrfNo),
    live: !closedOut(assigned),
    year: yearOf(assigned),
    data: assigned,
  };
  bumpCounter(state, assigned.vrfNo, assigned.no);
  return {
    ok: true,
    kind,
    store: "records",
    reserve: assigned,
    reserveNo: String(assigned.no),
    vrfNo: normNo(assigned.vrfNo),
    vrf: normNo(assigned.vrfNo),
    nextVrf: state.app.nextVrf,
    nextReserve: state.app.nextReserve,
  };
}

function issueIntoRecords(state, spec) {
  const run = state.queue.then(() => issueIntoRecordsOnce(state, spec));
  state.queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

module.exports = {
  MIN_WRITE_BUILD,
  RUNAWAY_FROM,
  UNNUMBERED_ISSUED_KEY,
  actorFrom,
  allocate,
  assertNoReserveDropped,
  assignIncoming,
  blockedNumbers,
  buildAccepted,
  clampClientCounter,
  clone,
  closedOut,
  collectUsed,
  commitIssue,
  createRecordState,
  diffChanges,
  draftFromIssued,
  gateWrite,
  hasContent,
  highestReal,
  isBlobOverwrite,
  isSealed,
  issueIntoRecords,
  mergeAppConfig,
  mergeReserveDetailed,
  nextFree,
  nextFromUsed,
  nextReserveNumber,
  normNo,
  orphanNumbers,
  paperRenumberNote,
  paperReserve6033,
  pickKeeper,
  planRestore,
  resolveCollisions,
  screenClientSet,
  stripSigFields,
  visibleHolds,
  vrfSeq,
  yearOf,
};
