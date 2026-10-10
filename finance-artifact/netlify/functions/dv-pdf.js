"use strict";

const { errorBody } = require("../lib/errors");
const { renderDvPdf } = require("../lib/pdf");
const { json, requireSession } = require("../lib/session");
const { createSupabaseStore } = require("../lib/supabase-store");

async function handle(event, deps = {}) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  requireSession(event);
  const store = deps.store || createSupabaseStore();
  const id = (event.queryStringParameters && event.queryStringParameters.id) || "";
  if (!id) return json(400, { error: "id is required" });
  const voucher = await store.get("vouchers", id);
  if (!voucher) return json(404, { error: "Voucher not found.", code: "not_found" });
  const signatories = await store.list("signatories");
  const bytes = await renderDvPdf(voucher, signatories);
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${voucher.dv_no || "dv"}.pdf"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
    body: Buffer.from(bytes).toString("base64"),
    isBase64Encoded: true,
  };
}

exports.handle = handle;
exports.handler = (event) => handle(event).catch((err) => json(err.statusCode || 500, errorBody(err)));
