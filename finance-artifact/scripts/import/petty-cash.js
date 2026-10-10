"use strict";

const { looksLikeDate, parseMessyDate } = require("./dates");
const { amountCell, joined, mapHeaders, pick, textCell } = require("./rows");

const ALIASES = {
  "qb upload": "qb",
  "status scanned": "scanned",
  scanned: "scanned",
  "reference no": "reference",
  "reference number": "reference",
  "pcv no": "reference",
  "pcv": "reference",
  date: "date",
  "c/o": "co",
  "co": "co",
  supplier: "supplier",
  description: "description",
  project: "project",
  vrf: "vrf",
  "vrf no": "vrf",
  cash: "cash",
  "release amount": "release",
  release: "release",
  "actual amount": "actual",
  actual: "actual",
  "ref no": "refno",
  "ref. no": "refno",
  "supplier name": "supplierName",
  tin: "tin",
  "si no": "si",
  "si number": "si",
  "si date": "siDate",
  classification: "classification",
  amount: "amount",
  remarks: "remarks",
};

function parseCycleLabel(text, defaultYear) {
  const match = String(text || "").match(/PCB\s*(\d{4})?\s*[- ]?\s*(\d+)/i);
  if (!match) return null;
  const cycleNo = Number(match[2]);
  const year = match[1] ? Number(match[1]) : Number(defaultYear) || null;
  if (!cycleNo) return null;
  return {
    year,
    cycleNo,
    label: year ? `PCB ${year}-${cycleNo}` : `PCB ${cycleNo}`,
  };
}

function isHeader(row) {
  return (row || []).some((value) => textCell(value).toUpperCase() === "REFERENCE NO");
}

function blank(value) {
  return textCell(value) === "";
}

function parsePettySheet(matrix, options = {}) {
  const issues = [];
  const cycles = [];
  let cycle = null;
  let map = null;
  let current = null;

  function pushIssue(rowNo, field, raw, message) {
    issues.push({ rowNo, field, raw: raw == null ? "" : String(raw), message });
  }

  function startCycle(label, rowNo) {
    cycle = {
      year: label.year,
      cycleNo: label.cycleNo,
      label: label.label,
      dateFrom: "",
      dateTo: "",
      opening: null,
      cashIns: [],
      vouchers: [],
      releases: [],
      rowNo,
    };
    cycles.push(cycle);
    current = null;
    map = null;
  }

  (matrix || []).forEach((row, index) => {
    const rowNo = index + 1;
    const line = joined(row);
    const label = parseCycleLabel(line, options.defaultYear);
    if (label && /PCB/i.test(line)) {
      startCycle(label, rowNo);
      return;
    }
    if (isHeader(row)) {
      map = mapHeaders(row, ALIASES);
      current = null;
      return;
    }
    if (!cycle || !map) return;
    if (/^opening\b/i.test(line)) {
      const numbers = (row || []).map(amountCell).filter((value) => value);
      if (numbers.length) cycle.opening = numbers[numbers.length - 1];
      return;
    }
    const rec = pick(row, map);
    const reference = textCell(rec.reference).replace(/\s+/g, "");
    const cash = amountCell(rec.cash);
    const release = amountCell(rec.release);
    const actual = amountCell(rec.actual);
    const amount = amountCell(rec.amount);
    const si = textCell(rec.si);
    const dated = parseMessyDate(rec.date);
    if (rec.date && !dated.ok) pushIssue(rowNo, "date", rec.date, "Could not read the date.");

    if (/^PC\d{4}-/i.test(reference)) {
      current = {
        pcvNo: reference.toUpperCase().replace(/^(PC)(\d{4})-(\d+)$/, (_, p, y, n) => `${p}${y}-${String(n).padStart(4, "0")}`),
        date: dated.ok ? dated.iso : "",
        co: textCell(rec.co),
        supplier: textCell(rec.supplier),
        project: textCell(rec.project),
        vrf: textCell(rec.vrf),
        po: textCell(rec.refno),
        description: textCell(rec.description),
        amount: actual || amount,
        qb: /^(y|yes|true|1)$/i.test(textCell(rec.qb)),
        scanned: /^(y|yes|true|1|scanned)$/i.test(textCell(rec.scanned)),
        remarks: textCell(rec.remarks),
        receipts: [],
        rowNo,
      };
      cycle.vouchers.push(current);
      return;
    }
    if (release && !reference) {
      cycle.releases.push({
        date: dated.ok ? dated.iso : "",
        employee: textCell(rec.co),
        description: textCell(rec.description),
        project: textCell(rec.project),
        vrf: textCell(rec.vrf),
        amount: release,
        statusNote: textCell(rec.remarks),
        status: /liquidat/i.test(textCell(rec.remarks)) ? "liquidated" : /return/i.test(textCell(rec.remarks)) ? "returned" : "open",
        rowNo,
      });
      return;
    }
    if (cash && !si && !amount) {
      const ref = textCell(rec.refno) || reference;
      let source = "CHECK";
      if (/^J\d{4}-/i.test(ref)) source = "J";
      else if (/^M\d{4}-/i.test(ref)) source = "M";
      else if (/payroll/i.test(ref)) source = "PAYROLL";
      else if (/refund/i.test(ref)) source = "REFUND";
      else if (/sales/i.test(ref)) source = "SALES";
      cycle.cashIns.push({
        date: dated.ok ? dated.iso : "",
        sourceType: source,
        referenceNo: ref,
        amount: cash,
        rowNo,
      });
      return;
    }
    if ((si || textCell(rec.classification) || amount) && current) {
      const siDate = parseMessyDate(rec.siDate);
      if (rec.siDate && !siDate.ok) pushIssue(rowNo, "siDate", rec.siDate, "Could not read the SI date.");
      current.receipts.push({
        siNo: si,
        siDate: siDate.ok ? siDate.iso : "",
        classification: textCell(rec.classification),
        invoiceAmount: amount || actual,
        tin: textCell(rec.tin),
        supplierName: textCell(rec.supplierName) || textCell(rec.supplier),
        rowNo,
      });
      if (!current.amount) current.amount = current.receipts.reduce((sum, line) => sum + amountCell(line.invoiceAmount), 0);
      return;
    }
    if ((row || []).every((value) => blank(value) || amountCell(value) === 0)) return;
  });

  return { cycles, issues };
}

module.exports = { parseCycleLabel, parsePettySheet };
