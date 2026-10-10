"use strict";

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  septemebr: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function iso(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fromMonthDay(month, day, year) {
  let m = Number(month);
  let d = Number(day);
  if (m > 12 && d <= 12) {
    const swap = m;
    m = d;
    d = swap;
  }
  return iso(year, m, d);
}

function excelSerial(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const dt = new Date(utc);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function parseMessyDate(raw) {
  if (raw == null || raw === "") return { ok: true, iso: "", raw: "" };
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const value = iso(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
    return value ? { ok: true, iso: value, raw: String(raw) } : { ok: false, iso: null, raw: String(raw) };
  }
  if (typeof raw === "number") {
    const value = excelSerial(raw);
    return value ? { ok: true, iso: value, raw: String(raw) } : { ok: false, iso: null, raw: String(raw) };
  }
  let text = String(raw).trim();
  if (!text) return { ok: true, iso: "", raw: "" };
  text = text.replace(/septemebr/gi, "September");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const value = text.slice(0, 10);
    return iso(value.slice(0, 4), value.slice(5, 7), value.slice(8, 10))
      ? { ok: true, iso: value, raw: String(raw) }
      : { ok: false, iso: null, raw: String(raw) };
  }
  const compact = text.replace(/\s+/g, "");
  let match = compact.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const value = fromMonthDay(match[1], match[2], match[3]);
    return value ? { ok: true, iso: value, raw: String(raw) } : { ok: false, iso: null, raw: String(raw) };
  }
  match = compact.match(/^(\d{1,2})\/(\d{2})(\d{4})$/);
  if (match) {
    const value = fromMonthDay(match[1], match[2], match[3]);
    return value ? { ok: true, iso: value, raw: String(raw) } : { ok: false, iso: null, raw: String(raw) };
  }
  match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    const value = month ? iso(match[3], month, match[2]) : null;
    return value ? { ok: true, iso: value, raw: String(raw) } : { ok: false, iso: null, raw: String(raw) };
  }
  match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    const value = month ? iso(match[3], month, match[1]) : null;
    return value ? { ok: true, iso: value, raw: String(raw) } : { ok: false, iso: null, raw: String(raw) };
  }
  return { ok: false, iso: null, raw: String(raw) };
}

function looksLikeDate(raw) {
  if (raw == null || raw === "") return false;
  const parsed = parseMessyDate(raw);
  return Boolean(parsed.ok && parsed.iso);
}

module.exports = { looksLikeDate, parseMessyDate };
