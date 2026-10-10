"use strict";

const { assertCollection, parsePath, rejectBlob } = require("../lib/collections");
const { errorBody } = require("../lib/errors");
const { formatManilaIso } = require("../lib/manila");
const { json, requireSession } = require("../lib/session");
const { createSupabaseStore } = require("../lib/supabase-store");

function snapshot(id, row) {
  if (!row) return { id, exists: false, data: null };
  const data = { ...row };
  delete data.image_data;
  delete data.receiver_signature;
  return { id: row.id || id, exists: true, data, updated_at: row.updated_at || null };
}

async function handle(event, deps = {}) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  requireSession(event);
  const store = deps.store || createSupabaseStore();
  const body = JSON.parse(event.body || "{}");
  const op = body.op;
  const tz = { timezone: "Asia/Manila", serverTime: formatManilaIso() };

  if (op === "get") {
    const { collection, id } = parsePath(body.path, body.id);
    assertCollection(collection);
    const row = await store.get(collection, id);
    return json(200, { ...snapshot(id, row), collection, ...tz });
  }

  if (op === "list") {
    const collection = assertCollection(body.collection || body.name);
    const rows = await store.list(collection);
    return json(200, {
      collection,
      docs: rows.map((row) => snapshot(row.id, row)),
      ...tz,
    });
  }

  if (op === "set") {
    const { collection, id } = parsePath(body.path, body.id);
    assertCollection(collection, { write: true });
    if (body.data === undefined || typeof body.data !== "object" || Array.isArray(body.data)) {
      return json(400, { error: "data must be one record", code: "bad_request" });
    }
    rejectBlob(body.data);
    if (collection === "builds") {
      const saved = await store.registerBuild(id, String(body.data.build || id), body.data.seq || Date.now());
      return json(200, { ...snapshot(id, saved), collection, ...tz });
    }
    const existing = await store.get(collection, id);
    const saved = existing
      ? await store.update(collection, id, { ...body.data, id })
      : await store.insert(collection, { ...body.data, id });
    return json(200, { ...snapshot(id, saved), collection, ...tz });
  }

  return json(400, { error: `Unknown op: ${op || ""}`, code: "bad_request" });
}

exports.handle = handle;
exports.handler = (event) =>
  handle(event).catch((err) => json(err.statusCode || 500, errorBody(err)));
