"use strict";

const { fail } = require("./errors");

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function peso(value) {
  const v = round2(value);
  const neg = v < 0;
  const parts = Math.abs(v).toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-₱" : "₱") + parts.join(".");
}

/**
 * Philippine VAT and expanded withholding tax.
 * amount is the figure typed on the voucher or bill.
 * vatMode: inclusive | exclusive | none
 * EWT is computed on the VAT-exclusive base.
 * Net cash is the VAT-inclusive gross minus EWT withheld.
 */
function computeWithholding({ amount, vatMode, vatRate, ewtRate } = {}) {
  const grossInput = round2(amount);
  if (grossInput < 0) fail("bad_request", "Amount cannot be negative.");
  const mode = String(vatMode || "inclusive").toLowerCase();
  if (!["inclusive", "exclusive", "none"].includes(mode)) {
    fail("bad_request", "VAT mode must be inclusive, exclusive, or none.");
  }
  let vr = mode === "none" ? 0 : vatRate == null || vatRate === "" ? 0.12 : Number(vatRate);
  let er = ewtRate == null || ewtRate === "" ? 0 : Number(ewtRate);
  if (!Number.isFinite(vr) || vr < 0 || vr > 1) fail("bad_request", "VAT rate is not valid.");
  if (!Number.isFinite(er) || er < 0 || er > 0.3) fail("bad_request", "Withholding rate is not valid.");
  if (mode === "none") vr = 0;

  let vatable;
  let vat;
  let gross;
  if (mode === "exclusive") {
    vatable = grossInput;
    vat = round2(vatable * vr);
    gross = round2(vatable + vat);
  } else if (mode === "none") {
    vatable = grossInput;
    vat = 0;
    gross = grossInput;
  } else if (vr > 0) {
    gross = grossInput;
    vatable = round2(gross / (1 + vr));
    vat = round2(gross - vatable);
  } else {
    gross = grossInput;
    vatable = gross;
    vat = 0;
  }
  const ewt = round2(vatable * er);
  const net = round2(gross - ewt);
  return {
    amount: grossInput,
    vatMode: mode,
    vatRate: vr,
    ewtRate: er,
    vatable,
    vat,
    ewt,
    gross,
    net,
  };
}

module.exports = { computeWithholding, peso, round2 };
