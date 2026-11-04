"use strict";

/* A deleted 201 is a document id, not a name. The boot roster check used to
   treat "on this browser, missing on the server" as a failed upload and write
   the row back. Remembering the id stops that restore. A different 201 (a new
   id) is a different record — name matching would also hide the person we
   kept when two files were merged. */

const TOMBSTONE_DOC_ID = "employeeTombstones";

const DELETED_CODE = "employee_deleted";
const DELETED_MESSAGE =
  "This employee profile was deleted and stays off the roster.";

function tombstoneFromEmployee(id, data, at) {
  const src = data && typeof data === "object" ? data : {};
  return {
    id: String(id || src.id || ""),
    name: src.name || "",
    empNo: src.empNo != null ? String(src.empNo) : "",
    at: at || "",
  };
}

function mergeMaps(prev, incoming) {
  const out = {};
  [prev || {}, incoming || {}].forEach((map) => {
    Object.keys(map).forEach((id) => {
      const next = map[id] || {};
      const prior = out[id] || {};
      const name = next.name || prior.name || "";
      const empNo = next.empNo || prior.empNo || "";
      const at = next.at || prior.at || "";
      out[id] = { id: String(id), name: name, empNo: empNo, at: at };
    });
  });
  return out;
}

function matches(byId, id, data) {
  const map = byId && typeof byId === "object" ? byId : {};
  const sid = String((data && data.id) || id || "");
  if (!sid || !map[sid]) return null;
  return map[sid];
}

function prepareEmployeeSet(byId, id, payload) {
  const hit = matches(byId, id, payload);
  if (!hit) return { ok: true, payload: payload };
  return {
    ok: false,
    code: DELETED_CODE,
    error: DELETED_MESSAGE,
  };
}

function prepareTombstoneDoc(prevById, incomingById) {
  return { byId: mergeMaps(prevById, incomingById) };
}

function tombstoneAfterDelete(prevById, id, existingData, at) {
  const rec = tombstoneFromEmployee(id, existingData, at);
  if (!rec.id) return { byId: mergeMaps(prevById, {}), record: null };
  return {
    byId: mergeMaps(prevById, { [rec.id]: rec }),
    record: rec,
  };
}

function filterEmployeeRows(rows, byId) {
  return (rows || []).filter((row) => !matches(byId, row && row.id, row && row.data));
}

function pruneEmployeeMap(employees, byId) {
  const src = employees || {};
  const next = {};
  Object.keys(src).forEach((id) => {
    if (matches(byId, id, src[id])) return;
    next[id] = src[id];
  });
  return next;
}

/* Ids to upload because they never reached the server. Tombstoned ids are
   not retries — uploading them is how a deleted profile came back. */
function rosterRetryIds(localIds, serverIds, employees, byId) {
  const have = {};
  (serverIds || []).forEach((id) => {
    have[id] = true;
  });
  return (localIds || []).filter((id) => {
    if (!id || have[id]) return false;
    const e = employees && employees[id];
    return !matches(byId, id, e || { id: id });
  });
}

module.exports = {
  DELETED_CODE,
  DELETED_MESSAGE,
  TOMBSTONE_DOC_ID,
  filterEmployeeRows,
  matches,
  mergeMaps,
  prepareEmployeeSet,
  prepareTombstoneDoc,
  pruneEmployeeMap,
  rosterRetryIds,
  tombstoneAfterDelete,
  tombstoneFromEmployee,
};
