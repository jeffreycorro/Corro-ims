"use strict";

const { parseCheckNo } = require("../../netlify/lib/sheet-math");
const { parseMessyDate } = require("./dates");
const { amountCell, joined, mapHeaders, pick, textCell } = require("./rows");

const ALIASES = {
  "check no": "checkNo",
  "check number": "checkNo",
  "check #": "checkNo",
  "cheque no": "checkNo",
  "date issued": "dateIssued",
  "issue date": "dateIssued",
  "check date": "checkDate",
  "cheque date": "checkDate",
  date: "checkDate",
  payee: "payee",
  supplier: "supplier",
  amount: "amount",
  "po": "po",
  "po no": "po",
  "po ref": "po",
  status: "status",
  "si no": "si",
  "si number": "si",
  "invoice no": "si",
  "si date": "siDate",
  "si amount": "siAmount",
  "invoice amount": "siAmount",
  remarks: "remarks",
  notes: "notes",
  "received by": "receivedBy",
  "release date": "releaseDate",
  "cleared date": "clearedDate",
  scanned: "scanned",
};

function isHeader(row) {
  return (row || []).some((value) => /check\s*(no|number|#)/i.test(textCell(value)));
}

function parseCheckSheet(matrix, options = {}) {
  const issues = [];
  const checks = [];
  let map = null;
  let current = null;
  (matrix || []).forEach((row, index) => {
    const rowNo = index + 1;
    if (isHeader(row)) {
      map = mapHeaders(row, ALIASES);
      return;
    }
    if (!map) return;
    const rec = pick(row, map);
    const rawNo = textCell(rec.checkNo);
    if (rawNo) {
      const parsed = parseCheckNo(rawNo);
      if (!parsed) {
        issues.push({ rowNo, field: "checkNo", raw: rawNo, message: "Check number is not BANKYYYY-serial." });
      }
      const issued = parseMessyDate(rec.dateIssued || rec.checkDate);
      const dated = parseMessyDate(rec.checkDate || rec.dateIssued);
      if ((rec.checkDate || rec.dateIssued) && !dated.ok) {
        issues.push({ rowNo, field: "checkDate", raw: rec.checkDate || rec.dateIssued, message: "Could not read the check date." });
      }
      current = {
        checkNo: parsed ? parsed.checkNo : rawNo.replace(/\s+/g, "").toUpperCase(),
        bankCode: parsed ? parsed.bankCode : "",
        bookletYear: parsed ? parsed.bookletYear : null,
        serial: parsed ? parsed.serial : "",
        dateIssued: issued.ok ? issued.iso : "",
        checkDate: dated.ok ? dated.iso : "",
        payee: textCell(rec.payee),
        supplier: textCell(rec.supplier),
        amount: amountCell(rec.amount),
        po: textCell(rec.po),
        status: textCell(rec.status).toLowerCase() || "issued",
        receivedBy: textCell(rec.receivedBy),
        releaseDate: "",
        clearedDate: "",
        scanned: /^(y|yes|true|1)$/i.test(textCell(rec.scanned)),
        remarks: textCell(rec.remarks),
        notes: textCell(rec.notes),
        bankNickname: options.bankNickname || "",
        invoices: [],
        rowNo,
      };
      const rel = parseMessyDate(rec.releaseDate);
      const cleared = parseMessyDate(rec.clearedDate);
      current.releaseDate = rel.ok ? rel.iso : "";
      current.clearedDate = cleared.ok ? cleared.iso : "";
      if (current.clearedDate && current.status === "issued") current.status = "cleared";
      checks.push(current);
    }
    const si = textCell(rec.si);
    const siAmount = rec.siAmount === "" || rec.siAmount == null ? null : amountCell(rec.siAmount);
    if (current && (si || siAmount)) {
      const siDate = parseMessyDate(rec.siDate);
      if (rec.siDate && !siDate.ok) {
        issues.push({ rowNo, field: "siDate", raw: rec.siDate, message: "Could not read the SI date." });
      }
      current.invoices.push({
        siNo: si,
        siDate: siDate.ok ? siDate.iso : "",
        amount: siAmount == null ? amountCell(rec.amount) : siAmount,
        po: textCell(rec.po),
        rowNo,
      });
    } else if (!rawNo && joined(row) && !isHeader(row)) {
      issues.push({ rowNo, field: "checkNo", raw: joined(row).slice(0, 80), message: "Row has no check number and no invoice to attach." });
    }
  });
  return { checks, issues };
}

module.exports = { parseCheckSheet };
