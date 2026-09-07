"use strict";

const { json, requireSession } = require("../lib/session");
const { parsePath, assertCollection } = require("../lib/collections");
const {
  acquireLock,
  deleteDoc,
  getDoc,
  listCollection,
  setDoc,
} = require("../lib/supabase");
const { formatManilaIso } = require("../lib/manila");

function snapshotFromRow(id, row) {
  if (!row) {
    return { id, exists: false, data: null, updated_at: null };
  }
  return {
    id: row.id || id,
    exists: true,
    data: row.data,
    updated_at: row.updated_at || null,
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    requireSession(event);

    const body = JSON.parse(event.body || "{}");
    const op = body.op;
    const tz = { timezone: "Asia/Manila", serverTime: formatManilaIso() };

    if (op === "get") {
      const { collection, id } = parsePath(body.path, body.id);
      const row = await getDoc(collection, id);
      return json(200, { ...snapshotFromRow(id, row), collection, ...tz });
    }

    if (op === "set") {
      const { collection, id } = parsePath(body.path, body.id);
      if (body.data === undefined) {
        return json(400, { error: "data is required" });
      }
      const row = await setDoc(collection, id, body.data, {
        merge: Boolean(body.merge),
      });
      return json(200, { ...snapshotFromRow(id, row), collection, ...tz });
    }

    if (op === "delete") {
      const { collection, id } = parsePath(body.path, body.id);
      await deleteDoc(collection, id);
      return json(200, { ok: true, collection, id, exists: false, ...tz });
    }

    if (op === "acquire") {
      const { collection, id } = parsePath(body.path, body.id);
      const holder =
        (body.holder && String(body.holder).trim()) ||
        (body.options && body.options.holder && String(body.options.holder).trim()) ||
        "";
      if (!holder) {
        return json(400, { error: "holder is required", acquired: false });
      }
      const result = await acquireLock(collection, id, holder, body.ttlSeconds);
      const acquired = result && result.acquired === true;
      return json(200, {
        acquired,
        holder: result ? result.holder : holder,
        expires_at: result ? result.expires_at : null,
        collection,
        id,
        ...tz,
      });
    }

    if (op === "list") {
      const collection = assertCollection(body.collection || body.name);
      const rows = await listCollection(collection);
      return json(200, {
        collection,
        docs: rows.map((row) => snapshotFromRow(row.id, row)),
        ...tz,
      });
    }

    return json(400, { error: `Unknown op: ${op}` });
  } catch (err) {
    const status = err.statusCode || 500;
    return json(status, { error: err.message || "Database error" });
  }
};
