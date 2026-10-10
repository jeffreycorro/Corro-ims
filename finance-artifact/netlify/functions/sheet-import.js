"use strict";

const { fail } = require("../lib/errors");
const { errorBody } = require("../lib/errors");
const { json, requireSession } = require("../lib/session");
const { getObject, putObject } = require("../lib/storage");
const {
  commitJob,
  dryRun,
  jobIssuesCsv,
  jobStatus,
  stagePart,
  startJob,
  tick,
} = require("../lib/sheet-import");
const { createSupabaseStore } = require("../lib/supabase-store");

function requireAdmin(session) {
  const role = String((session && session.role) || "")
    .trim()
    .toLowerCase();
  if (role !== "admin") fail("forbidden", "Only an administrator can import the Google Sheets.");
}

async function handle(event, deps = {}) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const session = requireSession(event);
  requireAdmin(session);
  const store = deps.store || createSupabaseStore();
  const storage = deps.storage || { getObject, putObject };
  const body = JSON.parse(event.body || "{}");
  const op = String(body.op || "");

  if (op === "importStart") return json(200, { job: await startJob(store, session, body) });
  if (op === "importStage") return json(200, await stagePart(store, storage, body.jobId, body));
  if (op === "importDryRun") return json(200, { job: await dryRun(store, storage, body.jobId, body) });
  if (op === "importCommit") return json(200, { job: await commitJob(store, storage, body.jobId, body) });
  if (op === "importTick") return json(200, { job: await tick(store, storage, body.jobId, body) });
  if (op === "importStatus") return json(200, { job: await jobStatus(store, body.jobId || "") });
  if (op === "importIssuesCsv") return json(200, await jobIssuesCsv(store, body.jobId));
  return json(400, { error: `Unknown op: ${op}`, code: "bad_request" });
}

exports.handle = handle;
exports.handler = (event, deps) => {
  const injected = deps && (deps.store || deps.storage) ? deps : {};
  return handle(event, injected).catch((err) => json(err.statusCode || 500, errorBody(err)));
};
