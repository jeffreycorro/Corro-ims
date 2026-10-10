"use strict";

const crypto = require("crypto");

function bankSecret() {
  return process.env.FINANCE_BANK_SECRET || "";
}

function maskAccount(raw) {
  const digits = String(raw == null ? "" : raw).replace(/\D/g, "");
  if (!digits) return "";
  return `••••${digits.slice(-4)}`;
}

function hasLongDigitRun(value) {
  return /\d{6,}/.test(String(value == null ? "" : value));
}

function encryptAccount(raw, secret = bankSecret()) {
  if (!secret || raw == null || raw === "") return "";
  const key = crypto.createHash("sha256").update(String(secret)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(raw), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptAccount(payload, secret = bankSecret()) {
  if (!payload || !secret) return "";
  const buf = Buffer.from(String(payload), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const key = crypto.createHash("sha256").update(String(secret)).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * Normal tables keep a masked account number. A full number is encrypted into
 * finance_bank_secrets and is never returned by list or get handlers.
 */
function protectAccount(raw, secret = bankSecret()) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return { account_no: "", ciphertext: "" };
  if (/^[•*]{2,}\d{2,4}$/.test(text) && !hasLongDigitRun(text)) {
    return { account_no: text, ciphertext: "" };
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 6 || hasLongDigitRun(text)) {
    return { account_no: maskAccount(digits), ciphertext: encryptAccount(text, secret) };
  }
  return { account_no: text, ciphertext: "" };
}

function publicAccountNo(value) {
  const text = String(value == null ? "" : value);
  if (hasLongDigitRun(text)) return maskAccount(text);
  return text;
}

module.exports = {
  bankSecret,
  decryptAccount,
  encryptAccount,
  hasLongDigitRun,
  maskAccount,
  protectAccount,
  publicAccountNo,
};
