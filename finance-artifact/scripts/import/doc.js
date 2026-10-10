"use strict";

function bankFromSheetName(name) {
  const match = String(name || "").match(/AUB|BDO|BPI|PBB|RCBC|DBP|LBP/i);
  return match ? match[0].toUpperCase() : "";
}

function sheetsToDoc({ petty, checks, gcash, bills, defaultYear }) {
  const doc = { defaultYear: Number(defaultYear) || 2026 };
  if (petty && petty.length) doc.petty = petty.flatMap((sheet) => sheet.rows || []);
  if (checks && checks.length) {
    doc.checks = checks.map((sheet) => ({
      name: sheet.name,
      bank: bankFromSheetName(sheet.name),
      rows: sheet.rows || [],
    }));
  }
  if (gcash && gcash.length) doc.gcash = gcash.flatMap((sheet) => sheet.rows || []);
  if (bills && bills.length) doc.bills = (bills[0] && bills[0].rows) || [];
  return doc;
}

module.exports = { bankFromSheetName, sheetsToDoc };
