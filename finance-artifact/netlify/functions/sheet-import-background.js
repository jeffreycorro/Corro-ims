"use strict";

const { errorBody } = require("../lib/errors");
const { fail } = require("../lib/errors");
const { json, requireSession } = require("../lib/session");
const { getObject, putObject } = require("../lib/storage");
const { runUntilDone } = require("../lib/sheet-import");
const { createSupabaseStore } = require("../lib/supabase-store");

function requireAdmin(session) {
  const role = String((session && session.role) || "")
    .trim()
    .toLowerCase();
  if (role !== "admin") fail("forbidden", "Only an administrator can import the Google Sheets.");
}

async function handle(event, deps = {}) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  const session = requireSession(event);
  requireAdmin(session);
  const body = JSON.parse(event.body || "{}");
  const store = deps.store || createSupabaseStore();
  const storage = deps.storage || { getObject, putObject };
  const job = await runUntilDone(store, storage, body.jobId, { budgetMs: 12 * 60 * 1000, chunkSize: body.chunkSize });
  return json(200, { job });
}

exports.handle = handle;
exports.handler = (event, deps) => {
  const injected = deps && (deps.store || deps.storage) ? deps : {};
  return handle(event, injected).catch((err) => json(err.statusCode || 500, errorBody(err)));
};
