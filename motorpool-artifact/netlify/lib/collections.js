"use strict";

const ALLOWED_COLLECTIONS = Object.freeze([
  "master",
  "ledger",
  "ops",
  "reserves",
  "fuel",
  "photos",
  "config",
  "builds",
]);

const ALLOWED_SET = new Set(ALLOWED_COLLECTIONS);

function assertCollection(name) {
  if (!ALLOWED_SET.has(name)) {
    const err = new Error(`Collection not allowed: ${name}`);
    err.statusCode = 400;
    throw err;
  }
  return name;
}

/**
 * Path format: collection/id (id may contain additional slashes).
 * Artifact paths (do not invent others):
 *   master/vehicles | master/parts | master/items | master/worktypes
 *   master/suppliers | master/projects | master/drivers
 *   ledger/<YYYY-MM> | ledger/index
 *   ops/mechanic | ops/tasks | ops/breakdowns | ops/papers | ops/photoindex
 *   reserves/<YYYY> | reserves/index
 *   fuel/purchases | fuel/withdrawals
 *   photos/<key>
 *   config/app | config/counter | config/rsvcounter
 *   builds/<BUILD>   {build, seq}
 */
function parsePath(path, maybeId) {
  if (path && typeof path === "object" && path.collection && path.id) {
    assertCollection(path.collection);
    return { collection: path.collection, id: String(path.id) };
  }

  if (maybeId != null && maybeId !== "") {
    const collection = String(path);
    assertCollection(collection);
    return { collection, id: String(maybeId) };
  }

  const raw = String(path || "").replace(/^\/+/, "");
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) {
    const err = new Error("Path must be collection/id");
    err.statusCode = 400;
    throw err;
  }
  const collection = raw.slice(0, slash);
  const id = raw.slice(slash + 1);
  assertCollection(collection);
  if (!id) {
    const err = new Error("Path must be collection/id");
    err.statusCode = 400;
    throw err;
  }
  return { collection, id };
}

function isAllowedCollection(name) {
  return ALLOWED_SET.has(name);
}

function requiresFullWrite(collection, id) {
  return collection === "config" && id === "app";
}

function sanitizeFilterField(field) {
  return String(field || "").replace(/[^A-Za-z0-9_]/g, "");
}

function normalizeListFilters(raw) {
  const out = [];
  const list = Array.isArray(raw) ? raw.slice() : [];
  if (raw && !Array.isArray(raw) && raw.field) list.push(raw);
  list.forEach(function (f) {
    if (!f || !f.field) return;
    const field = sanitizeFilterField(f.field);
    const rawOp = String(f.op || "eq");
    const op = rawOp === "==" || rawOp === "eq" ? "eq" : rawOp === "like" ? "like" : "";
    if (!field || !op) return;
    out.push({ field, op, value: f.value == null ? "" : String(f.value) });
  });
  return out;
}

function listFilterQuery(filters) {
  return normalizeListFilters(filters)
    .map(function (f) {
      const value = encodeURIComponent(f.value);
      if (f.field === "id") return "&id=" + f.op + "." + value;
      return "&data->>" + f.field + "=" + f.op + "." + value;
    })
    .join("");
}

function rowMatchesFilters(row, filters) {
  return normalizeListFilters(filters).every(function (f) {
    const data = row && row.data && typeof row.data === "object" ? row.data : {};
    const actual = f.field === "id" ? String((row && row.id) || "") : data[f.field];
    const have = actual == null ? "" : String(actual);
    if (f.op === "like") {
      const re = new RegExp(
        "^" +
          String(f.value)
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/%/g, ".*") +
          "$"
      );
      return re.test(have);
    }
    return have === String(f.value);
  });
}

module.exports = {
  ALLOWED_COLLECTIONS,
  assertCollection,
  isAllowedCollection,
  listFilterQuery,
  normalizeListFilters,
  parsePath,
  requiresFullWrite,
  rowMatchesFilters,
  sanitizeFilterField,
};
