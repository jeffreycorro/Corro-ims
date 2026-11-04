"use strict";

const { lookupKeys, normalize } = require("../../public/voucher-no");

/** Read-only Finance registers. Select lists stay limited to the number and status. */
const SOURCES = [
  { source: "petty", label: "Petty cash", table: "finance_petty_vouchers", column: "pcv_no" },
  { source: "gcash", label: "GCash", table: "finance_wallet_expenses", column: "ref_no" },
  { source: "voucher", label: "Check voucher", table: "finance_vouchers", column: "dv_no" },
  { source: "check", label: "Check", table: "finance_checks", column: "check_no" },
];

function isMissingRelation(err) {
  const details = err && err.details;
  const code = details && (details.code || "");
  const msg = String((err && err.message) || "") + " " + String((details && details.message) || "");
  return code === "42P01" || code === "PGRST205" || /could not find the table|could not find the relation|schema cache/i.test(msg);
}

/** Keys that are safe to drop into a PostgREST filter. Anything else is not looked up. */
function safeKey(key) {
  return /^[A-Z0-9][A-Z0-9./-]{0,79}$/.test(String(key || ""));
}

async function findSource(rest, source, keys) {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!safeKey(key)) continue;
    let rows;
    try {
      rows = await rest({
        method: "GET",
        path: "/rest/v1/" + source.table,
        query:
          source.column +
          "=ilike." +
          encodeURIComponent(key) +
          "&select=" +
          source.column +
          ",status&limit=1",
      });
    } catch (err) {
      if (isMissingRelation(err)) return null;
      throw err;
    }
    if (Array.isArray(rows) && rows[0]) {
      const row = rows[0];
      return {
        source: source.source,
        label: source.label,
        status: row.status == null ? "" : String(row.status),
        number: row[source.column] == null ? key : String(row[source.column]),
      };
    }
  }
  return null;
}

async function matchOne(raw, rest) {
  const norm = normalize(raw);
  const result = {
    voucherNo: norm.voucherNo,
    voucherKey: norm.voucherKey,
    hint: norm.hint,
    matched: false,
    matches: [],
    lookedUp: false,
  };
  if (!norm.voucherNo) return result;
  const keys = lookupKeys(norm).filter(safeKey);
  if (!keys.length) return result;
  result.lookedUp = true;
  for (let s = 0; s < SOURCES.length; s++) {
    const hit = await findSource(rest, SOURCES[s], keys);
    if (hit) result.matches.push(hit);
  }
  result.matched = result.matches.length > 0;
  return result;
}

async function matchFinanceVouchers(numbers, rest) {
  if (typeof rest !== "function") {
    const err = new Error("Finance lookup is not configured");
    err.code = "unavailable";
    throw err;
  }
  const list = Array.isArray(numbers) ? numbers.slice(0, 20) : [];
  const results = [];
  for (let i = 0; i < list.length; i++) {
    results.push(await matchOne(list[i], rest));
  }
  return results;
}

module.exports = {
  SOURCES,
  isMissingRelation,
  matchFinanceVouchers,
  matchOne,
  safeKey,
};
