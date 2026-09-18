"use strict";

const { json, requireSession } = require("../lib/session");
const { getDoc, setDoc, listCollection } = require("../lib/supabase");
const { formatManilaDate, formatManilaIso } = require("../lib/manila");
const { ingestApplicants } = require("../lib/applicants-ingest");
const {
  applicantFromEmail,
  fetchMailboxEmails,
  imapConfigured,
  statusPayload,
} = require("../lib/applicants-email");

function createHandler(deps = {}) {
  const load = deps.getDoc || getDoc;
  const save = deps.setDoc || setDoc;
  const list = deps.listCollection || listCollection;
  const todayFn = deps.today || formatManilaDate;
  const pull = deps.fetchMailboxEmails || fetchMailboxEmails;

  return async function handler(event) {
    try {
      if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, body: "" };
      }
      requireSession(event);

      if (event.httpMethod === "GET") {
        return json(200, {
          ok: true,
          ...statusPayload(),
          serverTime: formatManilaIso(),
        });
      }
      if (event.httpMethod !== "POST") {
        return json(405, { error: "Method not allowed" });
      }

      if (!imapConfigured() && !deps.fetchMailboxEmails) {
        return json(503, {
          ok: false,
          code: "imap_unconfigured",
          ...statusPayload(),
        });
      }

      const today = todayFn();
      const messages = await pull({ sinceDays: 21 });
      const applicants = (messages || [])
        .map((msg) => applicantFromEmail(msg, today))
        .filter(Boolean);

      if (!applicants.length) {
        return json(200, {
          ok: true,
          created: [],
          updated: [],
          errors: [],
          pulled: 0,
          ...statusPayload(),
          timezone: "Asia/Manila",
          serverTime: formatManilaIso(),
        });
      }

      const result = await ingestApplicants(applicants, {
        getDoc: load,
        setDoc: save,
        listCollection: list,
        today,
      });

      return json(200, {
        ...result,
        pulled: applicants.length,
        ...statusPayload(),
        timezone: "Asia/Manila",
        serverTime: formatManilaIso(),
      });
    } catch (err) {
      const status = err.statusCode || 500;
      const body = { error: (err && err.message) || "Email ingest error" };
      if (err && err.code) body.code = err.code;
      if (status === 503 || err.code === "imap_unconfigured") {
        Object.assign(body, statusPayload());
      }
      return json(status, body);
    }
  };
}

exports.createHandler = createHandler;
exports.handler = createHandler();
