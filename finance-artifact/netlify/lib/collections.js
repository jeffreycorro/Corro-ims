"use strict";

const READABLE = new Set([
  "projects",
  "accounts",
  "suppliers",
  "builds",
  "signatories",
  "vouchers",
  "advances",
  "bills",
  "payments",
  "receipts",
  "attachments",
]);

const WRITABLE = new Set(["projects", "accounts", "suppliers", "builds", "signatories"]);

function assertCollection(name, { write = false } = {}) {
  const collection = String(name || "").trim();
  const allowed = write ? WRITABLE : READABLE;
  if (!allowed.has(collection)) {
    const err = new Error(
      write
        ? "Vouchers, cash advances, and bills are saved one record at a time through the finance function."
        : "Unknown collection."
    );
    err.statusCode = 400;
    err.code = "bad_request";
    throw err;
  }
  return collection;
}

function assertRecordId(id) {
  const value = String(id || "").trim();
  if (!value || value.length > 120) {
    const err = new Error("A record id is required.");
    err.statusCode = 400;
    err.code = "bad_request";
    throw err;
  }
  if (/^\d{4}$/.test(value) || /^\d{4}-\d{2}$/.test(value)) {
    const err = new Error("This list is saved one record at a time. A whole year or month is not a document.");
    err.statusCode = 400;
    err.code = "stale_overwrite";
    throw err;
  }
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    const err = new Error("That record id is not allowed.");
    err.statusCode = 400;
    err.code = "bad_request";
    throw err;
  }
  return value;
}

function parsePath(path, id) {
  const raw = String(path || "").trim();
  const parts = raw.split("/").filter(Boolean);
  if (parts.length < 2 && !id) {
    const err = new Error("path must be collection/id");
    err.statusCode = 400;
    err.code = "bad_request";
    throw err;
  }
  const collection = parts[0];
  const recordId = parts.length >= 2 ? parts.slice(1).join("/") : id;
  return { collection, id: assertRecordId(recordId) };
}

function rejectBlob(data) {
  if (data && typeof data === "object" && Array.isArray(data.rows) && data.rows.length > 1) {
    const err = new Error("Send one record. A rows array is not stored as one document.");
    err.statusCode = 400;
    err.code = "stale_overwrite";
    throw err;
  }
}

module.exports = {
  READABLE,
  WRITABLE,
  assertCollection,
  assertRecordId,
  parsePath,
  rejectBlob,
};
