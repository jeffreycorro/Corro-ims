"use strict";

/**
 * Trim and collapse spaces on a project or site label as it is saved.
 * This does not fold case, punctuation, or doubled letters, and it does not
 * swap a stored name for a different project. Near-duplicate blocking stays
 * on the form that adds a project.
 */
function normProjectLabel(raw) {
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
}

function normalizeNamedProject(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  let changed = false;
  const next = Object.assign({}, row);
  ["project", "site"].forEach((key) => {
    if (typeof next[key] !== "string") return;
    const label = normProjectLabel(next[key]);
    if (label !== next[key]) {
      next[key] = label;
      changed = true;
    }
  });
  return changed ? next : row;
}

function normalizeProjectRecord(row) {
  if (typeof row === "string") return normProjectLabel(row);
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  let changed = false;
  const next = Object.assign({}, row);
  ["code", "name"].forEach((key) => {
    if (typeof next[key] !== "string") return;
    const label = normProjectLabel(next[key]);
    if (label !== next[key]) {
      next[key] = label;
      changed = true;
    }
  });
  return changed ? next : row;
}

function mapList(list, fn) {
  if (!Array.isArray(list)) return list;
  let changed = false;
  const next = list.map((row) => {
    const mapped = fn(row);
    if (mapped !== row) changed = true;
    return mapped;
  });
  return changed ? next : list;
}

function normalizeProjectsDoc(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const rows = mapList(data.rows, normalizeProjectRecord);
  const projects = mapList(data.projects, normalizeProjectRecord);
  if (rows === data.rows && projects === data.projects) return data;
  const out = Object.assign({}, data);
  if (Array.isArray(data.rows)) out.rows = rows;
  if (Array.isArray(data.projects)) out.projects = projects;
  return out;
}

function normalizeVehiclesDoc(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const rows = mapList(data.rows, normalizeNamedProject);
  const vehicles = mapList(data.vehicles, normalizeNamedProject);
  if (rows === data.rows && vehicles === data.vehicles) return data;
  const out = Object.assign({}, data);
  if (Array.isArray(data.rows)) out.rows = rows;
  if (Array.isArray(data.vehicles)) out.vehicles = vehicles;
  return out;
}

function normalizeRowListDoc(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const rows = mapList(data.rows, normalizeNamedProject);
  if (rows === data.rows) return data;
  return Object.assign({}, data, { rows });
}

function normalizeProjectWrite(collection, id, data) {
  if (collection === "master" && id === "projects") return normalizeProjectsDoc(data);
  if (collection === "master" && id === "vehicles") return normalizeVehiclesDoc(data);
  if (collection === "fuel" && (id === "withdrawals" || id === "purchases")) return normalizeRowListDoc(data);
  if (collection === "ops" && (id === "mechanic" || id === "tasks")) return normalizeRowListDoc(data);
  return data;
}

function normalizeLedgerRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return mapList(rows, normalizeNamedProject);
}

function normalizeReserve(reserve) {
  return normalizeNamedProject(reserve);
}

function normalizeIssueSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return spec;
  const out = Object.assign({}, spec);
  let changed = false;
  if (spec.reserve && typeof spec.reserve === "object") {
    const reserve = normalizeReserve(spec.reserve);
    if (reserve !== spec.reserve) {
      out.reserve = reserve;
      changed = true;
    }
  }
  if (Array.isArray(spec.rows)) {
    const rows = normalizeLedgerRows(spec.rows);
    if (rows !== spec.rows) {
      out.rows = rows;
      changed = true;
    }
  }
  return changed ? out : spec;
}

module.exports = {
  normProjectLabel,
  normalizeIssueSpec,
  normalizeLedgerRows,
  normalizeProjectWrite,
  normalizeProjectsDoc,
  normalizeReserve,
  normalizeVehiclesDoc,
};
