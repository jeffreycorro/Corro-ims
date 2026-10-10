"use strict";

const MANILA = "Asia/Manila";

function manilaParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return parts;
}

function formatManilaDate(date = new Date()) {
  const p = manilaParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function formatManilaIso(date = new Date()) {
  const p = manilaParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

function manilaYear(date = new Date()) {
  return Number(formatManilaDate(date).slice(0, 4));
}

function addDays(isoDate, days) {
  const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + Number(days) * 86400000;
  const dt = new Date(utc);
  const y2 = dt.getUTCFullYear();
  const m2 = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(dt.getUTCDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}

function daysBetween(fromDate, toDate) {
  const [y1, m1, d1] = String(fromDate).slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = String(toDate).slice(0, 10).split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

function monthKey(iso) {
  return String(iso || "").slice(0, 7);
}

module.exports = {
  MANILA,
  addDays,
  daysBetween,
  formatManilaDate,
  formatManilaIso,
  manilaParts,
  manilaYear,
  monthKey,
};
