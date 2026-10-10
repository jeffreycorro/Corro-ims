"use strict";

const { parseMessyDate } = require("./dates");
const { amountCell, joined, normHeader, textCell } = require("./rows");

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

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthToken(value, fallbackYear) {
  const text = textCell(value);
  if (!text) return null;
  let match = text.match(/^(20\d{2})[-/](\d{1,2})$/);
  if (match) return { month: Number(match[2]), year: Number(match[1]), label: text };
  match = text.match(/^([A-Za-z]+)\.?\s*(20\d{2})?$/);
  if (match && MONTHS[match[1].toLowerCase()]) {
    const year = match[2] ? Number(match[2]) : Number(fallbackYear) || null;
    return { month: MONTHS[match[1].toLowerCase()], year, label: text };
  }
  return null;
}

function isNumeric(value) {
  if (typeof value === "number") return Number.isFinite(value);
  const text = textCell(value);
  if (!text) return false;
  return /^-?[\d,]+(\.\d+)?$/.test(text);
}

function yearOf(name, rows, fallback) {
  const named = String(name || "").match(/20\d{2}/);
  if (named) return Number(named[0]);
  const blob = (rows || []).slice(0, 3).map((row) => joined(row)).join(" ");
  const titled = blob.match(/20\d{2}/);
  if (titled) return Number(titled[0]);
  return Number(fallback) || 2026;
}

function doneMark(value) {
  return /^(y|yes|true|1|✔|✓|done)$/i.test(textCell(value));
}

function naMark(value) {
  return /^n\/?a$/i.test(textCell(value));
}

function findMonthRow(matrix, year) {
  let header = -1;
  let months = [];
  (matrix || []).some((row, index) => {
    const hits = [];
    (row || []).forEach((value, col) => {
      const token = monthToken(value, year);
      if (token) hits.push({ col, ...token });
    });
    if (hits.length >= 3) {
      header = index;
      months = hits;
      return true;
    }
    return false;
  });
  return { header, months };
}

function amountColumns(row) {
  const cols = [];
  (row || []).forEach((value, index) => {
    if (normHeader(value) === "amount") cols.push(index);
  });
  return cols;
}

function labelMap(row) {
  const map = {};
  (row || []).forEach((value, index) => {
    const key = normHeader(value);
    if (key === "category" || key === "site") map.category = index;
    else if (key === "bill" || key === "biller") map.bill = index;
    else if (key === "account number" || key === "account no") map.account = index;
    else if (key === "account name") map.accountName = index;
    else if (key === "unit details" || key === "unit") map.unit = index;
    else if (key === "folder no") map.folder = index;
  });
  return map;
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseBillGrid(matrix, options = {}) {
  const issues = [];
  const bills = [];
  const year = yearOf(options.sheetName, matrix, options.defaultYear);
  const found = findMonthRow(matrix, year);
  if (found.header < 0) {
    issues.push({ rowNo: 1, field: "header", raw: "", message: "No month header row was found.", sheet: options.sheetName || "" });
    return { bills, issues, shift: 0 };
  }
  const sub = matrix[found.header + 1] || [];
  const amounts = amountColumns(sub);
  let shift = 0;
  if (amounts.length >= 3) {
    const labels = labelMap(sub);
    let carried = "";
    for (let r = found.header + 2; r < matrix.length; r += 1) {
      const row = matrix[r] || [];
      const billName = textCell(labels.bill != null ? row[labels.bill] : "");
      if (!billName || /^(bill|biller)$/i.test(billName)) continue;
      const categoryCell = labels.category != null ? textCell(row[labels.category]) : "";
      if (categoryCell) carried = categoryCell;
      const category = categoryCell || carried;
      const account = labels.account != null ? textCell(row[labels.account]) : "";
      const accountName = labels.accountName != null ? textCell(row[labels.accountName]) : "";
      const fullYear = amounts.length === 12 && found.months[0] && found.months[0].month === 1;
      amounts.forEach((col, index) => {
        const slot = fullYear ? { month: index + 1, year } : found.months[index] || { month: index + 1, year };
        pushMonth(bills, row, col, {
          category,
          biller: billName,
          accountNo: account,
          accountName,
          month: monthKey(slot.year || year, slot.month || index + 1),
          rowNo: r + 1,
        });
      });
    }
    return { bills, issues, shift: 0, mode: "amount-columns" };
  }

  const sample = matrix[found.header + 1] || [];
  if (found.months.length && !isNumeric(sample[found.months[0].col]) && isNumeric(sample[found.months[0].col + 1]) && textCell(sample[found.months[0].col])) {
    shift = 1;
  }
  for (let r = found.header + 1; r < matrix.length; r += 1) {
    const row = matrix[r] || [];
    const lead = [];
    const firstMonth = found.months[0].col;
    for (let c = 0; c < firstMonth; c += 1) {
      const value = textCell(row[c]);
      if (value) lead.push(value);
    }
    if (!lead.length) continue;
    const category = lead[0] || "";
    const biller = lead[1] || lead[0];
    const account = lead[2] || "";
    const accountName = lead[3] || "";
    found.months.forEach((col) => {
      const raw = row[col.col + shift];
      const month = col.year ? monthKey(col.year, col.month) : monthKey(year, col.month);
      if (raw == null || textCell(raw) === "" || textCell(raw) === "-" ) return;
      if (naMark(raw)) {
        bills.push({ category, biller, accountNo: account, accountName, month, amount: 0, status: "n-a", dueDate: "", paidDate: "", rowNo: r + 1 });
        return;
      }
      if (!isNumeric(raw) && textCell(raw)) {
        issues.push({ rowNo: r + 1, field: month, raw: textCell(raw), message: "Month cell is not an amount.", sheet: options.sheetName || "" });
        return;
      }
      bills.push({
        category,
        biller,
        accountNo: account,
        accountName,
        month,
        amount: amountCell(raw),
        status: "unpaid",
        dueDate: "",
        paidDate: "",
        rowNo: r + 1,
      });
    });
  }
  return { bills, issues, shift };
}

function pushMonth(bills, row, amountCol, base) {
  const raw = row[amountCol];
  const due = parseMessyDate(row[amountCol + 1]);
  const paid = parseMessyDate(row[amountCol + 2]);
  const done = row[amountCol + 3];
  if ((raw == null || textCell(raw) === "" || textCell(raw) === "-") && !naMark(raw) && !doneMark(done) && !(paid.ok && paid.iso)) return;
  let status = "unpaid";
  if (naMark(raw) || naMark(done)) status = "n-a";
  else if (doneMark(done) || (paid.ok && paid.iso)) status = "paid";
  bills.push({
    ...base,
    amount: naMark(raw) ? 0 : amountCell(raw),
    status,
    dueDate: due.ok ? due.iso : "",
    paidDate: paid.ok ? paid.iso : "",
  });
}

function parseRentalSheet(matrix, options = {}) {
  const year = yearOf(options.sheetName, matrix, options.defaultYear);
  const found = findMonthRow(matrix, year);
  const receipts = [];
  if (found.header < 0) return { receipts, issues: [{ rowNo: 1, field: "header", raw: "", message: "No month header row was found.", sheet: options.sheetName || "" }] };
  const sub = matrix[found.header + 1] || [];
  const amounts = amountColumns(sub);
  const labels = labelMap(sub);
  for (let r = found.header + 2; r < matrix.length; r += 1) {
    const row = matrix[r] || [];
    const site = textCell(row[labels.category != null ? labels.category : 1]);
    const unit = textCell(row[labels.unit != null ? labels.unit : 3]);
    const accountName = textCell(row[labels.accountName != null ? labels.accountName : 4]);
    if (!site && !unit) continue;
    const cols = amounts.length ? amounts : found.months.map((item) => item.col);
    cols.forEach((col, index) => {
      const raw = row[col];
      if (raw == null || textCell(raw) === "" || textCell(raw) === "-" || naMark(raw)) return;
      if (!isNumeric(raw)) return;
      const paid = parseMessyDate(row[col + 2]);
      receipts.push({
        site,
        unit,
        accountName,
        month: monthKey(year, index + 1),
        amount: amountCell(raw),
        receivedOn: paid.ok ? paid.iso : "",
        rowNo: r + 1,
      });
    });
  }
  return { receipts, issues: [] };
}

function parseYearlySheet(matrix, options = {}) {
  const year = yearOf(options.sheetName, matrix, options.defaultYear);
  const taxes = [];
  (matrix || []).forEach((row, index) => {
    const site = textCell(row[1]);
    const kind = textCell(row[0]);
    if (!site || /tax declaration|property taxes/i.test(site)) return;
    if (kind && !/property tax/i.test(kind)) return;
    taxes.push({
      site,
      year,
      amount: 0,
      reference: textCell(row[2]),
      status: "unpaid",
      rowNo: index + 1,
    });
  });
  return { taxes, issues: [] };
}

module.exports = { parseBillGrid, parseRentalSheet, parseYearlySheet };
