"use strict";

function collapse(raw) {
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
}

function nameKey(raw) {
  const s = collapse(raw).toLowerCase();
  let out = "";
  let spaced = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charAt(i);
    if ((c >= "0" && c <= "9") || c.toLowerCase() !== c.toUpperCase()) {
      out += c;
      spaced = false;
    } else if (!spaced && out) {
      out += " ";
      spaced = true;
    }
  }
  return out.trim();
}

const RESERVED_SUPPLIER_NAMES = ["MOTORPOOL INVENTORY", "FUEL RESERVE"];

function reservedSupplierName(raw) {
  const key = nameKey(raw);
  if (!key) return "";
  for (const name of RESERVED_SUPPLIER_NAMES) {
    if (nameKey(name) === key) return name;
  }
  return "";
}

module.exports = { RESERVED_SUPPLIER_NAMES, collapse, nameKey, reservedSupplierName };
