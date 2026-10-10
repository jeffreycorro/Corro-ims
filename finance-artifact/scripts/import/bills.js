"use strict";

const { amountCell, textCell } = require("./rows");

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
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function monthToken(value, fallbackYear) {
  const text = textCell(value);
  if (!text) return null;
  let match = text.match(/^(20\d{2})[-/](\d{1,2})$/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}`;
  match = text.match(/^([A-Za-z]+)\.?\s*(20\d{2})?$/);
  if (match && MONTHS[match[1].toLowerCase()]) {
    const year = match[2] || fallbackYear;
    if (!year) return null;
    return `${year}-${String(MONTHS[match[1].toLowerCase()]).padStart(2, "0")}`;
  }
  return null;
}

function isNumeric(value) {
  if (typeof value === "number") return Number.isFinite(value);
  const text = textCell(value);
  if (!text) return false;
  return /^-?[\d,]+(\.\d+)?$/.test(text);
}

function parseBillGrid(matrix, options = {}) {
  const issues = [];
  const bills = [];
  let header = -1;
  let months = [];
  const year = options.defaultYear || new Date().getFullYear();
  (matrix || []).some((row, index) => {
    const hits = [];
    (row || []).forEach((value, col) => {
      const token = monthToken(value, year);
      if (token) hits.push({ col, month: token, label: textCell(value) });
    });
    if (hits.length >= 3) {
      header = index;
      months = hits;
      return true;
    }
    return false;
  });
  if (header < 0) {
    issues.push({ rowNo: 1, field: "header", raw: "", message: "No month header row was found." });
    return { bills, issues };
  }
  const sample = matrix[header + 1] || [];
  let shift = 0;
  if (months.length && !isNumeric(sample[months[0].col]) && isNumeric(sample[months[0].col + 1]) && textCell(sample[months[0].col])) {
    shift = 1;
  }
  for (let r = header + 1; r < matrix.length; r += 1) {
    const row = matrix[r] || [];
    const lead = [];
    const firstMonth = months[0].col;
    for (let c = 0; c < firstMonth; c += 1) {
      const value = textCell(row[c]);
      if (value) lead.push(value);
    }
    if (!lead.length) continue;
    const category = lead[0] || "";
    const biller = lead[1] || lead[0];
    const account = lead[2] || "";
    const accountName = lead[3] || "";
    months.forEach((col) => {
      const raw = row[col.col + shift];
      if (raw == null || textCell(raw) === "" || textCell(raw) === "-" || /^n\/?a$/i.test(textCell(raw))) {
        if (/^n\/?a$/i.test(textCell(raw))) {
          bills.push({
            category,
            biller,
            accountNo: account,
            accountName,
            month: col.month,
            amount: 0,
            status: "n-a",
            rowNo: r + 1,
          });
        }
        return;
      }
      if (!isNumeric(raw) && textCell(raw)) {
        issues.push({ rowNo: r + 1, field: col.month, raw: textCell(raw), message: "Month cell is not an amount." });
        return;
      }
      bills.push({
        category,
        biller,
        accountNo: account,
        accountName,
        month: col.month,
        amount: amountCell(raw),
        status: "unpaid",
        rowNo: r + 1,
      });
    });
  }
  return { bills, issues, shift };
}

module.exports = { parseBillGrid };
