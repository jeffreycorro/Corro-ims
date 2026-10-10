"use strict";

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  febuary: 2,
  ferbruary: 2,
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
  augst: 8,
  sep: 9,
  sept: 9,
  september: 9,
  septemebr: 9,
  septemeber: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  novemeber: 11,
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

function manilaIso(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type) => Number(parts.find((part) => part.type === type).value);
  return iso(pick("year"), pick("month"), pick("day"));
}

function fromMonthDay(month, day, year) {
  let m = Number(month);
  let d = Number(day);
  if (m > 12 && d <= 12) {
    const swap = m;
    m = d;
    d = swap;
  }
  return iso(fixYear(year), m, d);
}

function fixYear(year) {
  const text = String(year == null ? "" : year).replace(/\D/g, "");
  if (!text) return NaN;
  const embedded = text.match(/20\d{2}/g);
  if (text.length > 4 && embedded) return Number(embedded[embedded.length - 1]);
  const n = Number(text);
  if (n >= 1990 && n <= 2100) return n;
  if (text.length === 3 && text.startsWith("2")) return 2000 + Number(text.slice(1));
  if (text.length === 4 && text.startsWith("0") && text.charAt(1) === "2") return 2000 + Number(text.slice(2));
  return n;
}

function excelSerial(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const dt = new Date(utc);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function blankDate(text) {
  return /^(n\/?a|n\.a\.?|none|null|nil|-+|—|\.|\/)$/i.test(text);
}

function cleanDateText(raw) {
  let text = String(raw).trim().replace(/^'+/, "");
  text = text.replace(/septemebr/gi, "September").replace(/septemeber/gi, "September");
  text = text.replace(/ferbruary/gi, "February").replace(/janaury/gi, "January");
  text = text.replace(/novemeber/gi, "November").replace(/\baugst\b/gi, "August");
  text = text.replace(/,/g, "/").replace(/\s+/g, "");
  text = text.replace(/\/\./g, "/").replace(/\.+\//g, "/").replace(/\.{2,}/g, ".");
  text = text.replace(/\/{2,}/g, "/");
  return text;
}

function parseMessyDate(raw) {
  if (raw == null || raw === "") return { ok: true, iso: "", raw: "" };
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const value = manilaIso(raw);
    return value ? { ok: true, iso: value, raw: String(raw) } : { ok: false, iso: null, raw: String(raw) };
  }
  if (typeof raw === "number") {
    const value = excelSerial(raw);
    return value ? { ok: true, iso: value, raw: String(raw) } : { ok: false, iso: null, raw: String(raw) };
  }
  let text = String(raw).trim();
  if (!text || blankDate(text)) return { ok: true, iso: "", raw: String(raw) };
  const compact = cleanDateText(text);
  if (!compact || blankDate(compact)) return { ok: true, iso: "", raw: String(raw) };

  const stamped = compact.match(/^(\d{4,8})-(\d{2})-(\d{2})(?:t(\d{2}):(\d{2}))?/i);
  if (stamped) {
    const year = fixYear(stamped[1]);
    if (stamped[4] != null) {
      const utc = new Date(Date.UTC(year, Number(stamped[2]) - 1, Number(stamped[3]), Number(stamped[4]), Number(stamped[5])));
      if (!Number.isNaN(utc.getTime())) {
        const value = manilaIso(utc);
        if (value) return { ok: true, iso: value, raw: String(raw) };
      }
    }
    const plain = iso(year, stamped[2], stamped[3]);
    if (plain) return { ok: true, iso: plain, raw: String(raw) };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const value = text.slice(0, 10);
    return iso(value.slice(0, 4), value.slice(5, 7), value.slice(8, 10))
      ? { ok: true, iso: value, raw: String(raw) }
      : { ok: false, iso: null, raw: String(raw) };
  }

  let match = compact.match(/^(\d{1,2})\/(\d{1,2})\/(\d{3,4})$/);
  if (match) {
    const value = fromMonthDay(match[1], match[2], match[3]);
    if (value) return { ok: true, iso: value, raw: String(raw) };
  }
  match = compact.match(/^(\d{1,2})\/(\d{2})(\d{4})$/);
  if (match) {
    const value = fromMonthDay(match[1], match[2], match[3]);
    if (value) return { ok: true, iso: value, raw: String(raw) };
  }
  match = compact.match(/^(\d{3,4})\/(\d{4})$/);
  if (match) {
    const digits = match[1];
    const year = match[2];
    if (digits.length === 3) {
      const value = fromMonthDay(digits.slice(0, 2), digits.slice(2), year);
      if (value) return { ok: true, iso: value, raw: String(raw) };
    }
    if (digits.length === 4) {
      const value = fromMonthDay(digits.slice(0, 2), digits.slice(2), year);
      if (value) return { ok: true, iso: value, raw: String(raw) };
    }
  }

  const spaced = String(raw).trim().replace(/septemebr/gi, "September").replace(/septemeber/gi, "September");
  match = spaced.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    const value = month ? iso(match[3], month, match[2]) : null;
    if (value) return { ok: true, iso: value, raw: String(raw) };
  }
  match = spaced.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    const value = month ? iso(match[3], month, match[1]) : null;
    if (value) return { ok: true, iso: value, raw: String(raw) };
  }

  const inner = String(raw).match(/(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{3,4})/);
  if (inner && cleanDateText(inner[1]) !== compact) {
    const nested = parseMessyDate(inner[1]);
    if (nested.ok && nested.iso) return { ok: true, iso: nested.iso, raw: String(raw) };
  }
  return { ok: false, iso: null, raw: String(raw) };
}

function looksLikeDate(raw) {
  if (raw == null || raw === "") return false;
  const parsed = parseMessyDate(raw);
  return Boolean(parsed.ok && parsed.iso);
}

module.exports = { excelSerial, looksLikeDate, parseMessyDate };
