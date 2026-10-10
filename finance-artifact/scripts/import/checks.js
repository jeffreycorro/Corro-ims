"use strict";

const { parseCheckNo } = require("../../netlify/lib/sheet-math");
const { parseMessyDate } = require("./dates");
const { amountCell, joined, normHeader, pick, textCell } = require("./rows");

const ALIASES = {
  "check no": "checkNo",
  "check number": "checkNo",
  "check #": "checkNo",
  "cheque no": "checkNo",
  "dated check": "checkDate",
  "date issued": "dateIssued",
  "issue date": "dateIssued",
  "check date": "checkDate",
  "cheque date": "checkDate",
  "date of check": "checkDate",
  date: "checkDate",
  payee: "payee",
  supplier: "supplier",
  amount: "amount",
  "check amount": "amount",
  total: "amount",
  po: "po",
  "po no": "po",
  "po ref": "po",
  "reference number / p o": "po",
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

function looseHeader(value) {
  return normHeader(value)
    .replace(/\(.*?\)/g, " ")
    .replace(/[./#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapCheckHeaders(headerRow) {
  const map = {};
  (headerRow || []).forEach((value, index) => {
    const key = looseHeader(value);
    const field = ALIASES[key];
    if (!field) return;
    if (field === "amount" && map.amount != null && map.siAmount == null) {
      map.siAmount = index;
      return;
    }
    if (map[field] == null) map[field] = index;
  });
  if (map.checkNo == null) {
    const fallback = (headerRow || []).findIndex((value) => /^column 1$/i.test(textCell(value)));
    if (fallback >= 0) map.checkNo = fallback;
  }
  return map;
}

function isHeader(row) {
  const cells = (row || []).map(textCell);
  if (cells.some((value) => /check\s*(no|number|#)|cheque\s*no/i.test(value))) return true;
  const loose = cells.map(looseHeader);
  return loose.includes("date") && loose.includes("payee") && loose.some((value) => value === "amount" || value === "check amount");
}

function normalizeCheckNo(raw, dateIso) {
  const compact = String(raw || "").replace(/\s+/g, "").toUpperCase();
  const parsed = parseCheckNo(compact);
  if (parsed) return parsed;
  const bare = compact.match(/^([A-Z]+)-(\d+)$/);
  if (!bare) return null;
  const year = dateIso ? Number(dateIso.slice(0, 4)) : null;
  if (!year) return null;
  return parseCheckNo(`${bare[1]}${year}-${bare[2]}`);
}

function isCancelled(payee, status, remarks) {
  if (/^cancelled(\s*check)?$/i.test(payee)) return true;
  if (/^cancelled(\s*check)?$/i.test(status)) return true;
  if (/cancelled\s*check/i.test(remarks)) return true;
  return false;
}

function isVoid(status, remarks) {
  return /^void$/i.test(status) || /^void$/i.test(remarks);
}

function isTransfer(payee, remarks) {
  return /fund\s*transfer|\btransfer\s+from\b|\btransfer\s+to\b/i.test(`${payee} ${remarks}`);
}

function mapStatus(raw, flags) {
  if (flags.cancelled) return "cancelled";
  if (flags.voided) return "void";
  const status = String(raw || "").toLowerCase();
  if (status === "cleared" || status === "credited") return "cleared";
  if (status === "void") return "void";
  if (status === "stale") return "stale";
  if (status === "released") return "released";
  if (status === "for signature") return "for signature";
  if (status === "ready for pickup") return "ready for pickup";
  if (flags.clearedDate) return "cleared";
  return "issued";
}

function parseCheckSheet(matrix, options = {}) {
  const issues = [];
  const checks = [];
  let map = null;
  let current = null;
  (matrix || []).forEach((row, index) => {
    const rowNo = index + 1;
    if (isHeader(row)) {
      map = mapCheckHeaders(row);
      current = null;
      return;
    }
    if (!map) return;
    const rec = pick(row, map);
    const rawNo = textCell(rec.checkNo);
    const payee = textCell(rec.payee);
    const remarks = textCell(rec.remarks);
    const notes = textCell(rec.notes);
    const statusRaw = textCell(rec.status);
    if (rawNo) {
      const issued = parseMessyDate(rec.dateIssued);
      const dated = parseMessyDate(map.checkDate != null ? rec.checkDate : rec.dateIssued || rec.checkDate);
      const parsed = normalizeCheckNo(rawNo, dated.ok ? dated.iso : issued.ok ? issued.iso : "");
      const checkNo = parsed ? parsed.checkNo : rawNo.replace(/\s+/g, "").toUpperCase();
      const amount = amountCell(rec.amount);
      // A repeated check number with no amount is the next invoice line of a merged cell, not a new check.
      const continuation = current && current.checkNo === checkNo && !amount;
      if (!continuation) {
        if ((map.checkDate != null ? rec.checkDate : rec.dateIssued) && !dated.ok) {
          issues.push({
            rowNo,
            field: "checkDate",
            raw: String(rec.checkDate || rec.dateIssued),
            message: "Could not read the check date.",
            sheet: options.sheetName || "",
          });
        }
        if (!parsed) {
          issues.push({
            rowNo,
            field: "checkNo",
            raw: rawNo,
            message: "Check number is not BANKYYYY-serial.",
            sheet: options.sheetName || "",
          });
        }
        const cancelled = isCancelled(payee, statusRaw, remarks);
        const voided = isVoid(statusRaw, remarks);
        const cleared = parseMessyDate(rec.clearedDate);
        const rel = parseMessyDate(rec.releaseDate);
        current = {
          checkNo,
          bankCode: parsed ? parsed.bankCode : "",
          bookletYear: parsed ? parsed.bookletYear : null,
          serial: parsed ? parsed.serial : "",
          dateIssued: issued.ok ? issued.iso : "",
          checkDate: dated.ok ? dated.iso : "",
          payee,
          supplier: cancelled ? "" : textCell(rec.supplier),
          amount,
          po: textCell(rec.po),
          status: mapStatus(statusRaw, { cancelled, voided, clearedDate: cleared.ok && cleared.iso }),
          receivedBy: textCell(rec.receivedBy),
          releaseDate: rel.ok ? rel.iso : "",
          clearedDate: cleared.ok ? cleared.iso : "",
          scanned: /^(y|yes|true|1|✔|✓)$/i.test(textCell(rec.scanned)),
          remarks,
          notes,
          bankNickname: options.bankNickname || "",
          isTransfer: isTransfer(payee, remarks),
          cancelled,
          invoices: [],
          rowNo,
        };
        checks.push(current);
      }
    }
    const si = textCell(rec.si);
    const siAmount = rec.siAmount === "" || rec.siAmount == null ? null : amountCell(rec.siAmount);
    if (current && (si || siAmount)) {
      const siDate = parseMessyDate(rec.siDate);
      if (rec.siDate && !siDate.ok) {
        issues.push({ rowNo, field: "siDate", raw: String(rec.siDate), message: "Could not read the SI date.", sheet: options.sheetName || "" });
      }
      current.invoices.push({
        siNo: si,
        siDate: siDate.ok ? siDate.iso : "",
        amount: siAmount == null ? amountCell(rec.amount) : siAmount,
        po: textCell(rec.po),
        rowNo,
      });
    } else if (!rawNo && (payee || amountCell(rec.amount)) && joined(row)) {
      issues.push({
        rowNo,
        field: "checkNo",
        raw: joined(row).slice(0, 80),
        message: "Row has no check number and no invoice to attach.",
        sheet: options.sheetName || "",
      });
    }
  });
  return { checks, issues };
}

module.exports = { parseCheckSheet };
