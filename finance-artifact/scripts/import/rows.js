"use strict";

const { money } = require("../../netlify/lib/sheet-math");

function normHeader(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[.:]+$/g, "");
}

function cell(row, index) {
  if (!row || index == null || index < 0 || index >= row.length) return "";
  const value = row[index];
  return value == null ? "" : value;
}

function textCell(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function amountCell(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return money(value);
  const text = String(value).trim();
  if (!text || text === "-" || text === "—") return 0;
  const negative = /^\(.*\)$/.test(text);
  const n = Number(text.replace(/[,₱]|php/gi, "").replace(/[()\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return money(negative ? -n : n);
}

function mapHeaders(headerRow, aliases) {
  const map = {};
  (headerRow || []).forEach((value, index) => {
    const key = aliases[normHeader(value)];
    if (key && map[key] == null) map[key] = index;
  });
  return map;
}

function pick(row, map) {
  const out = {};
  Object.keys(map).forEach((key) => {
    out[key] = cell(row, map[key]);
  });
  return out;
}

function joined(row) {
  return (row || []).map((value) => textCell(value)).filter(Boolean).join(" ");
}

module.exports = { amountCell, cell, joined, mapHeaders, normHeader, pick, textCell };
