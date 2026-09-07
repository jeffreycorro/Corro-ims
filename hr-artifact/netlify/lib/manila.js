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

/** ISO-like local timestamp in Asia/Manila, e.g. 2026-09-07T16:00:00+08:00 */
function formatManilaIso(date = new Date()) {
  const p = manilaParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

module.exports = {
  MANILA,
  formatManilaIso,
  manilaParts,
};
