"use strict";

const { looksLikeDate, parseMessyDate } = require("./dates");
const { amountCell, joined, mapHeaders, pick, textCell } = require("./rows");

const ALIASES = {
  ref: "ref",
  "reference no": "ref",
  "reference": "ref",
  date: "date",
  "c/o": "co",
  co: "co",
  supplier: "supplier",
  description: "description",
  project: "project",
  vrf: "vrf",
  amount: "amount",
  fee: "fee",
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

function shiftMap(map) {
  const next = {};
  Object.keys(map).forEach((key) => {
    next[key] = map[key] + 1;
  });
  return next;
}

function parseGcashSheet(matrix, options = {}) {
  const issues = [];
  const batches = [];
  let batch = null;
  let map = null;
  let shifted = false;

  function start(batchNo, rowNo, yearHint) {
    batch = {
      batchNo,
      year: Number(options.defaultYear) || yearHint || null,
      opening: null,
      cashIns: [],
      expenses: [],
      receivables: [],
      rowNo,
    };
    batches.push(batch);
    map = null;
    shifted = false;
  }

  (matrix || []).forEach((row, index) => {
    const rowNo = index + 1;
    const line = joined(row);
    const batchMatch = line.match(/\bBATCH\s*(\d+)\b/i);
    if (batchMatch && textCell(row[0]).length < 40) {
      const yearMatch = line.match(/\b(20\d{2})\b/);
      start(Number(batchMatch[1]), rowNo, yearMatch ? Number(yearMatch[1]) : null);
      return;
    }
    if ((row || []).some((value) => /^(date|ref|reference no)$/i.test(textCell(value)))) {
      map = mapHeaders(row, ALIASES);
      return;
    }
    if (!batch || !map) return;
    if (/opening/i.test(line)) {
      const numbers = (row || []).map(amountCell).filter((value) => value);
      if (numbers.length) batch.opening = numbers[numbers.length - 1];
      return;
    }
    if (!shifted && map.date != null) {
      const dated = row[map.date];
      const next = row[map.date + 1];
      if (!looksLikeDate(dated) && looksLikeDate(next)) {
        map = shiftMap(map);
        shifted = true;
      }
    }
    const rec = pick(row, map);
    const dated = parseMessyDate(rec.date);
    if (rec.date && !dated.ok) issues.push({ rowNo, field: "date", raw: String(rec.date), message: "Could not read the date." });
    const description = textCell(rec.description);
    const amount = amountCell(rec.amount);
    const ref = textCell(rec.ref);
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
    if (/top-?\s*up/i.test(line) || textCell(rec.topup) || textCell(rec.source)) {
      const sourceText = textCell(rec.source) || line;
      let source = "J";
      if (/\bM\b|marian/i.test(sourceText)) source = "M";
      batch.cashIns.push({
        date: dated.ok ? dated.iso : "",
        sourceType: source,
        referenceNo: ref,
        amount: amount || amountCell(rec.topup),
        rowNo,
      });
      return;
    }
    if (!ref && !amount) return;
    const siDate = parseMessyDate(rec.siDate);
    if (rec.siDate && !siDate.ok) issues.push({ rowNo, field: "siDate", raw: String(rec.siDate), message: "Could not read the SI date." });
    const year = dated.iso ? Number(dated.iso.slice(0, 4)) : batch.year;
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
      siNo: textCell(rec.si),
      siDate: siDate.ok ? siDate.iso : "",
      invoiceAmount: amountCell(rec.invoiceAmount),
      classification: textCell(rec.classification),
      scanned: /^(y|yes|true|1)$/i.test(textCell(rec.scanned)),
      remarks: textCell(rec.remarks),
      rowNo,
    });
  });
  return { batches, issues };
}

module.exports = { parseGcashSheet };
