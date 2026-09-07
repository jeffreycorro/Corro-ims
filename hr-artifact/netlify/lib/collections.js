"use strict";

const ALLOWED_COLLECTIONS = Object.freeze([
  "employees",
  "nte",
  "writeups",
  "tasks",
  "templates",
  "reminders",
  "memos",
  "resources",
  "onboarding",
  "series",
  "docreg",
  "applicants",
  "exams",
  "roles",
  "advances",
  "leaves",
  "projects",
  "incidents",
  "genfiles",
  "decisions",
  "daily",
  "filed",
  "compliance",
  "forms",
  "periods",
  "meta",
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
 * Two-arg form is also accepted by callers that pass (collection, id).
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

module.exports = {
  ALLOWED_COLLECTIONS,
  assertCollection,
  parsePath,
  isAllowedCollection,
};
