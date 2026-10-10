"use strict";

const { parseMessyDate } = require("./dates");
const { amountCell, joined, mapHeaders, normHeader, pick, textCell } = require("./rows");

const ALIASES = {
  "qb upload": "qb",
  "status scanned": "scanned",
  "status: scanned": "scanned",
  scanned: "scanned",
  "reference no": "reference",
  "reference number": "reference",
  "pcv no": "reference",
  pcv: "reference",
  date: "date",
  "c/o": "co",
  co: "co",
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
  "tin no": "tin",
  "si no": "si",
  "si number": "si",
  "si date": "siDate",
  classification: "classification",
  amount: "amount",
  remarks: "remarks",
};

function cycleFromName(name, defaultYear) {
  const text = String(name || "").trim();
  let match = text.match(/PC(?:B)?\s*[- ]?\s*(20\d{2})\s*[- ]\s*(\d{1,2})\b/i);
  if (match) return pack(Number(match[1]), Number(match[2]));
  match = text.match(/PC(?:B)?\s*[- ]\s*(\d{1,2})\s*$/i);
  if (match) return pack(Number(defaultYear) || null, Number(match[1]));
  match = text.match(/PC(?:B)?\s*(\d{1,2})\s*$/i);
  if (match) return pack(Number(defaultYear) || null, Number(match[1]));
  return null;
}

function pack(year, cycleNo) {
  if (!cycleNo || cycleNo > 99) return null;
  return {
    year: year || null,
    cycleNo,
    label: year ? `PCB ${year}-${cycleNo}` : `PCB ${cycleNo}`,
  };
}

function parseCycleLabel(text, defaultYear) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 40) return null;
  let match = raw.match(/PCB\s*(20\d{2})\s*[- ]\s*(\d{1,2})\b/i);
  if (match) return pack(Number(match[1]), Number(match[2]));
  match = raw.match(/PCB\s*[- ]?\s*(\d{1,2})\b/i);
  if (match) return pack(Number(defaultYear) || null, Number(match[1]));
  match = raw.match(/petty\s*cash(?:\s*no\.?)?\s*(?:(20\d{2})\s*[- ]\s*)?(?:no\.?\s*)?(\d{1,2})\b/i);
  if (match) return pack(match[1] ? Number(match[1]) : Number(defaultYear) || null, Number(match[2]));
  return null;
}

function isHeader(row) {
  return (row || []).some((value) => {
    const key = normHeader(value).replace(/:/g, "");
    return key === "reference no" || key === "pcv no" || key === "pcv";
  });
}

function filled(row) {
  return (row || []).map(textCell).filter(Boolean);
}

function summaryLine(line) {
  return /cash on hand|cash for summary|running cash|total expense|total cash|grand total|remaining amount/i.test(line);
}

function openingLine(line) {
  return /balance\s*f\w*ward|^opening\b/i.test(line);
}

function padPcv(reference) {
  return reference.toUpperCase().replace(/^(PC)(\d{4})-(\d+)$/, (_, prefix, year, seq) => `${prefix}${year}-${String(seq).padStart(4, "0")}`);
}

function parsePettySheet(matrix, options = {}) {
  const issues = [];
  const cycles = [];
  let cycle = null;
  let map = null;
  let current = null;

  function pushIssue(rowNo, field, raw, message) {
    issues.push({ rowNo, field, raw: raw == null ? "" : String(raw), message, sheet: options.sheetName || "" });
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

  const named = cycleFromName(options.sheetName, options.defaultYear);
  if (named) startCycle(named, 0);

  (matrix || []).forEach((row, index) => {
    const rowNo = index + 1;
    const cells = filled(row);
    const line = cells.join(" ");
    if (!line || /^(false\s*)+$/i.test(line)) return;
    if (cells.length <= 3) {
      const label = parseCycleLabel(line, options.defaultYear);
      if (label) {
        if (!cycle) startCycle(label, rowNo);
        else if (!cycle.year && label.year && label.cycleNo === cycle.cycleNo) cycle.year = label.year;
        return;
      }
    }
    if (isHeader(row)) {
      map = mapHeaders(row, ALIASES);
      current = null;
      return;
    }
    if (!cycle || !map) return;
    if (summaryLine(line)) return;
    const rec = pick(row, map);
    const reference = textCell(rec.reference).replace(/\s+/g, "");
    const cash = amountCell(rec.cash);
    const release = amountCell(rec.release);
    const actual = amountCell(rec.actual);
    const amount = amountCell(rec.amount);
    const si = textCell(rec.si);
    const description = textCell(rec.description);
    const dated = parseMessyDate(rec.date);
    if (rec.date && !dated.ok) pushIssue(rowNo, "date", rec.date, "Could not read the date.");
    if (openingLine(description) || openingLine(line)) {
      const numbers = (row || []).map(amountCell).filter((value) => value);
      cycle.opening = cash || (numbers.length ? numbers[numbers.length - 1] : cycle.opening);
      return;
    }
    if (!reference && !description && !textCell(rec.co) && !textCell(rec.supplier) && !si) return;

    function attachReceipt(voucher) {
      if (!si && !textCell(rec.classification) && !amount) return;
      if (!si && !textCell(rec.classification)) return;
      const siDate = parseMessyDate(rec.siDate);
      if (rec.siDate && !siDate.ok) pushIssue(rowNo, "siDate", rec.siDate, "Could not read the SI date.");
      voucher.receipts.push({
        siNo: si,
        siDate: siDate.ok ? siDate.iso : "",
        classification: textCell(rec.classification),
        invoiceAmount: amount || actual,
        tin: textCell(rec.tin),
        supplierName: textCell(rec.supplierName) || textCell(rec.supplier),
        rowNo,
      });
    }

    if (/^PC\d{4}-/i.test(reference)) {
      current = {
        pcvNo: padPcv(reference),
        date: dated.ok ? dated.iso : "",
        co: textCell(rec.co),
        supplier: textCell(rec.supplier),
        project: textCell(rec.project),
        vrf: textCell(rec.vrf),
        po: textCell(rec.refno),
        description,
        amount: actual || amount,
        qb: /^(y|yes|true|1)$/i.test(textCell(rec.qb)),
        scanned: /^(y|yes|true|1|scanned)$/i.test(textCell(rec.scanned)),
        remarks: textCell(rec.remarks),
        receipts: [],
        rowNo,
      };
      cycle.vouchers.push(current);
      attachReceipt(current);
      return;
    }
    if (release && !/^PC\d{4}-/i.test(reference)) {
      if (!textCell(rec.co) && !description && !textCell(rec.supplier)) return;
      const note = textCell(rec.remarks) || (!/^([JM]\d{4}-|[A-Z]{2,}\d{4}-)/i.test(reference) ? textCell(rec.reference) : "");
      cycle.releases.push({
        date: dated.ok ? dated.iso : "",
        employee: textCell(rec.co),
        description,
        project: textCell(rec.project),
        vrf: textCell(rec.vrf),
        amount: release,
        statusNote: note,
        status: /liquidat/i.test(note) ? "liquidated" : /return/i.test(note) ? "returned" : "open",
        rowNo,
      });
      return;
    }
    if ((si || textCell(rec.classification) || amount) && current && !cash) {
      attachReceipt(current);
      if (!current.amount) current.amount = current.receipts.reduce((sum, item) => sum + amountCell(item.invoiceAmount), 0);
      return;
    }
    if (cash && !si) {
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
    }
  });

  return { cycles, issues };
}

module.exports = { cycleFromName, parseCycleLabel, parsePettySheet };
