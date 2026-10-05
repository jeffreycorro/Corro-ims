"use strict";

const { json, requireSession } = require("../lib/session");
const { parsePath, assertCollection, requiresFullWrite, normalizeListFilters } = require("../lib/collections");
const {
  acquireLock,
  deleteDoc,
  getDoc,
  listCollection,
  listIds,
  listPhotoMeta,
  setDoc,
  setDocIfUpdatedAt,
} = require("../lib/supabase");
const { applyClientMerge } = require("../lib/doc-merge");
const { clampClientCounter, screenClientSet } = require("../lib/vrf-issue");
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

    const session = requireSession(event);

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
      if (requiresFullWrite(collection, id) && body.merge) {
        return json(400, { error: "config/app requires a full-field write" });
      }
      const screened = screenClientSet(collection, id);
      if (screened) return json(screened.statusCode, { error: screened.error, code: screened.code });
      if (collection === "config" && id === "app" && body.data && typeof body.data === "object") {
        const existing = await getDoc(collection, id);
        const current = existing && existing.data ? existing.data.nextVrf : null;
        body.data.nextVrf = clampClientCounter(current, body.data.nextVrf);
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

    if (op === "merge") {
      const spec = body.spec;
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
        return json(400, { error: "spec is required", code: "bad_request" });
      }
      if (!spec.user) {
        spec.user = session.name || session.full_name || session.email || session.sub || "";
      }
      if (!spec.at) spec.at = formatManilaIso();
      const io = {
        async getRecord(collection, id) {
          const row = await getDoc(collection, id);
          if (!row || row.data == null) return { data: null, updated_at: null };
          return { data: row.data, updated_at: row.updated_at || null };
        },
        async cas(collection, id, data, updatedAt) {
          return setDocIfUpdatedAt(collection, id, data, updatedAt);
        },
        async set(collection, id, data) {
          const row = await setDoc(collection, id, data);
          return row;
        },
        async listIds(collection) {
          return listIds(collection);
        },
        async acquire(collection, id, holder) {
          return acquireLock(collection, id, holder, 15);
        },
      };
      const result = await applyClientMerge(spec, io);
      return json(200, Object.assign({ ok: true }, result, tz));
    }

    if (op === "listIds") {
      const collection = assertCollection(body.collection || body.name);
      const ids = await listIds(collection);
      return json(200, { collection, ids, ...tz });
    }

    if (op === "photoMeta") {
      const owner = String(body.owner || "").trim();
      if (!owner) return json(400, { error: "owner is required" });
      const docs = await listPhotoMeta(owner);
      return json(200, { owner, docs, ...tz });
    }

    if (op === "list") {
      const collection = assertCollection(body.collection || body.name);
      const filters = normalizeListFilters(body.filters || body.where);
      const rows = await listCollection(collection, filters);
      return json(200, {
        collection,
        docs: rows.map((row) => snapshotFromRow(row.id, row)),
        filters,
        ...tz,
      });
    }

    return json(400, { error: `Unknown op: ${op}` });
  } catch (err) {
    const status = err.statusCode || 500;
    const payload = { error: err.message || "Database error" };
    if (err && err.code) payload.code = err.code;
    return json(status, payload);
  }
};
