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
const leaveNumbers = require("../../public/hr-leave-numbers");
const caNumbers = require("../../public/hr-ca-numbers");
const { mergeStoredOtRequest } = require("../lib/ot-merge");

function storeFromRows(rows) {
  return leaveNumbers.rowsToStore(rows);
}

async function rejectDuplicateLeaveNumber(collection, id, data) {
  if (!data || !data.no) return null;
  if (collection !== "leaves" && collection !== "docreg") return null;
  if (collection === "docreg" && !leaveNumbers.isLvDocreg(data)) return null;
  const [leaveRows, regRows] = await Promise.all([
    listCollection("leaves"),
    listCollection("docreg"),
  ]);
  const stores = {
    leaves: storeFromRows(leaveRows),
    docreg: storeFromRows(regRows),
  };
  return leaveNumbers.conflictForWrite(collection, id, data, stores);
}

function serverIo(holder) {
  return {
    async lock() {
      try {
        const result = await acquireLock("series", "CA", holder || "ca", 5);
        return !!(result && result.acquired === true);
      } catch (e) {
        return false;
      }
    },
    async load() {
      const [advances, docreg, filed, series] = await Promise.all([
        listCollection("advances"),
        listCollection("docreg"),
        listCollection("filed"),
        getDoc("series", "CA"),
      ]);
      return {
        advances: caNumbers.rowsToMap(advances),
        docreg: caNumbers.rowsToMap(docreg),
        filed: caNumbers.rowsToMap(filed),
        series: {
          CA:
            (series && series.data) || {
              key: "CA",
              prefix: "CAF",
              pad: 4,
              pattern: "{PREFIX}{YYYY}-{NNNN}",
            },
        },
      };
    },
    async readAdvance(id) {
      const row = await getDoc("advances", id);
      return row && row.data ? row.data : null;
    },
    async writeAdvance(rec) {
      const payload = Object.assign({}, rec);
      delete payload._hrCaInternal;
      await setDoc("advances", rec.id, payload);
    },
    async writeDocreg(rec) {
      await setDoc("docreg", rec.id, rec);
    },
    async writeSeries(rec) {
      const row = await getDoc("series", "CA");
      const stored = (row && row.data) || {};
      const merged = caNumbers.mergeSeriesCounter(stored, rec);
      await setDoc("series", "CA", Object.assign({}, stored, merged));
    },
    uid(prefix) {
      return (
        (prefix || "d") +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 8)
      );
    },
    year: new Date().getFullYear(),
  };
}

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

    if (op === "assignCa") {
      const advance = body.advance || body.data;
      if (!advance || !advance.id) {
        return json(400, { error: "advance id is required" });
      }
      const result = await caNumbers.assignCashAdvance(
        serverIo(body.holder || "assignCa"),
        advance
      );
      return json(200, {
        ...snapshotFromRow(result.advance.id, {
          id: result.advance.id,
          data: result.advance,
        }),
        advance: result.advance,
        docreg: result.docreg || null,
        series: result.series || null,
        kind: result.kind || "",
        ignored: result.ignored || "",
        collection: "advances",
        ...tz,
      });
    }

    if (op === "set") {
      const { collection, id } = parsePath(body.path, body.id);
      if (body.data === undefined) {
        return json(400, { error: "data is required" });
      }
      let payload = body.data;
      if (body.merge) {
        const existing = await getDoc(collection, id);
        payload = {
          ...(existing && existing.data && typeof existing.data === "object"
            ? existing.data
            : {}),
          ...body.data,
        };
      }
      if (collection === "otreqs") {
        const existing = await getDoc(collection, id);
        payload = mergeStoredOtRequest(existing && existing.data, payload);
      }
      if (collection === "advances") {
        const result = await caNumbers.assignCashAdvance(
          serverIo(body.holder || "set"),
          Object.assign({}, payload, { id: id })
        );
        return json(200, {
          ...snapshotFromRow(id, { id: id, data: result.advance }),
          advance: result.advance,
          docreg: result.docreg || null,
          series: result.series || null,
          kind: result.kind || "",
          ignored: result.ignored || "",
          collection,
          ...tz,
        });
      }
      if (collection === "series" && id === "CA") {
        const existing = await getDoc("series", "CA");
        payload = caNumbers.guardSeriesWrite(
          existing && existing.data,
          payload
        );
      }
      const conflict = await rejectDuplicateLeaveNumber(collection, id, payload);
      if (conflict) {
        return json(409, {
          error: conflict.message,
          code: leaveNumbers.DUP_CODE,
        });
      }
      const row = await setDoc(collection, id, payload, {
        merge: Boolean(body.merge),
      });
      return json(200, { ...snapshotFromRow(id, row), collection, ...tz });
    }

    if (op === "delete") {
      const { collection, id } = parsePath(body.path, body.id);
      if (collection === "advances" || collection === "docreg") {
        const existing = await getDoc(collection, id);
        const data = existing && existing.data;
        const caRow =
          collection === "advances"
            ? data
            : data && caNumbers.isCaDoc(data)
              ? { no: data.no, id: data.refId, empId: data.empId, date: data.date }
              : null;
        if (caRow && caRow.no) {
          await caNumbers.retireNumber(serverIo(body.holder || "delete"), caRow);
        }
      }
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
