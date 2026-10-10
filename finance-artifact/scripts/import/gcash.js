"use strict";

const { looksLikeDate, parseMessyDate } = require("./dates");
const { amountCell, joined, mapHeaders, pick, textCell } = require("./rows");

const ALIASES = {
  ref: "ref",
  "reference no": "ref",
  reference: "ref",
  date: "date",
  "c/o": "co",
  co: "co",
  supplier: "supplier",
  description: "description",
  project: "project",
  vrf: "vrf",
  amount: "amount",
  fee: "fee",
  cash: "cash",
  "si no": "si",
  "si date": "siDate",
  "invoice amount": "invoiceAmount",
  classification: "classification",
  scanned: "scanned",
  remarks: "remarks",
  source: "source",
  "top up": "topup",
  "top-up": "topup",
};

const CLASSIFICATION = /^(no classification|non-?vat|vat|vat & no classification)$/i;

function shiftMap(map) {
  const next = {};
  Object.keys(map).forEach((key) => {
    next[key] = map[key] + 1;
  });
  return next;
}

function sheetYearOf(name) {
  const match = String(name || "").match(/20\d{2}/);
  return match ? Number(match[0]) : null;
}

function batchHeader(row) {
  const cells = (row || []).map(textCell).filter(Boolean);
  if (!cells.length || cells.length > 3) return null;
  const hit = cells.map((cell) => cell.match(/^batch\s*(\d+)\b/i)).find(Boolean);
  if (!hit) return null;
  const extra = cells.filter((cell) => !/^batch\s*\d+\b/i.test(cell) && !/gcash/i.test(cell));
  if (extra.length) return null;
  return { batchNo: Number(hit[1]), year: (cells.join(" ").match(/\b(20\d{2})\b/) || [])[1] };
}

function isHeader(row) {
  return (row || []).some((value) => /^(date|ref|reference no|reference number)$/i.test(textCell(value).replace(/[.:]+$/g, "")));
}

function openingLine(line) {
  return /balance\s*f\w*ward|^opening\b/i.test(line);
}

function summaryLine(line) {
  return /total cash|total expense|remaining|total amount/i.test(line);
}

function parseGcashSheet(matrix, options = {}) {
  const issues = [];
  const batches = [];
  const sheetYear = Number(options.sheetYear) || sheetYearOf(options.sheetName) || null;
  let batch = null;
  let map = null;
  let shifted = false;
  let announced = false;

  function start(batchNo, rowNo, yearHint) {
    const hinted = yearHint ? Number(yearHint) : null;
    batch = {
      batchNo,
      year: sheetYear || hinted || Number(options.defaultYear) || null,
      opening: null,
      cashIns: [],
      expenses: [],
      receivables: [],
      headerSeen: false,
      rowNo,
    };
    batches.push(batch);
    map = null;
    shifted = false;
  }

  (matrix || []).forEach((row, index) => {
    const rowNo = index + 1;
    const line = joined(row);
    const header = batchHeader(row);
    if (header) {
      start(header.batchNo, rowNo, header.year);
      announced = true;
      return;
    }
    if (isHeader(row)) {
      if (!batch) start(1, rowNo, null);
      else if (batch.headerSeen && !announced) start((batch.batchNo || 0) + 1, rowNo, null);
      announced = false;
      batch.headerSeen = true;
      map = mapHeaders(row, ALIASES);
      const amountCols = [];
      (row || []).forEach((value, col) => {
        if (String(value || "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[.:]+$/g, "") === "amount") amountCols.push(col);
      });
      if (amountCols[1] != null && map.invoiceAmount == null) map.invoiceAmount = amountCols[1];
      shifted = false;
      return;
    }
    if (!batch || !map) return;
    if (summaryLine(line)) return;
    if (!shifted && map.date != null) {
      const dated = row[map.date];
      const next = row[map.date + 1];
      if (!looksLikeDate(dated) && looksLikeDate(next) && !openingLine(line)) {
        map = shiftMap(map);
        shifted = true;
      }
    }
    const rec = pick(row, map);
    const description = textCell(rec.description);
    const cash = amountCell(rec.cash);
    const amount = amountCell(rec.amount);
    if (openingLine(description) || openingLine(line)) {
      const numbers = (row || []).map(amountCell).filter((value) => value);
      batch.opening = cash || (numbers.length ? numbers[numbers.length - 1] : batch.opening);
      return;
    }
    if (/lacking amount/i.test(description) || /lacking amount/i.test(line)) {
      const person = description.split(/[–—-]/).slice(1).join("-").trim();
      batch.receivables.push({
        description,
        person,
        amount: amount || amountCell((description.match(/([\d,]+\.?\d*)/) || [])[1]),
        status: "open",
        rowNo,
      });
      return;
    }
    const dated = parseMessyDate(rec.date);
    if (rec.date && !dated.ok) issues.push({ rowNo, field: "date", raw: String(rec.date), message: "Could not read the date.", sheet: options.sheetName || "" });
    const ref = textCell(rec.ref);
    if ((cash && !amount) || /top-?\s*up/i.test(line) || textCell(rec.topup)) {
      if (!cash && !amount && !textCell(rec.topup)) return;
      const sourceText = textCell(rec.source) || description || ref || line;
      let source = "J";
      if (/refund/i.test(sourceText)) source = "REFUND";
      else if (/^M\d{4}-/i.test(ref) || /\bM\b|marian/i.test(sourceText)) source = "M";
      else if (/payroll/i.test(sourceText)) source = "PAYROLL";
      batch.cashIns.push({
        date: dated.ok ? dated.iso : "",
        sourceType: source,
        referenceNo: ref,
        amount: cash || amount || amountCell(rec.topup),
        rowNo,
      });
      return;
    }
    if (!ref) return;
    if (/expense|remaining|total/i.test(line) && !/gcash/i.test(ref)) return;
    const siDate = parseMessyDate(rec.siDate);
    if (rec.siDate && !siDate.ok) issues.push({ rowNo, field: "siDate", raw: String(rec.siDate), message: "Could not read the SI date.", sheet: options.sheetName || "" });
    let siNo = textCell(rec.si);
    let classification = textCell(rec.classification);
    if (CLASSIFICATION.test(siNo)) {
      classification = classification || siNo;
      siNo = "";
    }
    const year = dated.iso ? Number(dated.iso.slice(0, 4)) : null;
    if (year && !batch.year) batch.year = year;
    batch.expenses.push({
      ref,
      date: dated.ok ? dated.iso : "",
      co: textCell(rec.co),
      supplier: textCell(rec.supplier),
      project: textCell(rec.project),
      vrf: textCell(rec.vrf),
      description,
      amount,
      fee: amountCell(rec.fee),
      siNo,
      siDate: siDate.ok ? siDate.iso : "",
      invoiceAmount: amountCell(rec.invoiceAmount),
      classification,
      scanned: /^(y|yes|true|1|scanned)$/i.test(textCell(rec.scanned)),
      remarks: textCell(rec.remarks),
      rowNo,
    });
  });
  return { batches, issues };
}

module.exports = { parseGcashSheet, sheetYearOf };
