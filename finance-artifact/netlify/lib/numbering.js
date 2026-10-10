"use strict";

const { fail } = require("./errors");

const SERIES = ["DV", "CA", "AP", "PC", "GC"];

function formatNumber(series, year, seq) {
  const prefix = String(series || "").toUpperCase();
  if (!SERIES.includes(prefix)) fail("bad_request", "Unknown number series.");
  const y = Number(year);
  const n = Number(seq);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) fail("bad_request", "Year is not valid.");
  if (!Number.isInteger(n) || n < 1) fail("bad_request", "Sequence is not valid.");
  const padded = String(n).padStart(4, "0");
  if (prefix === "GC") return `${y}Gcash-${padded}`;
  return `${prefix}${y}-${padded}`;
}

/**
 * In-memory stand-in for finance_take_number().
 * Caller must already hold the store lock. Numbers are never reused.
 */
function takeNumber(counters, series, year) {
  const prefix = String(series || "").toUpperCase();
  const y = Number(year);
  const key = `${prefix}:${y}`;
  const last = Number(counters.get(key) || 0);
  const seq = last + 1;
  counters.set(key, seq);
  return { series: prefix, year: y, seq, number: formatNumber(prefix, y, seq) };
}

module.exports = { SERIES, formatNumber, takeNumber };
