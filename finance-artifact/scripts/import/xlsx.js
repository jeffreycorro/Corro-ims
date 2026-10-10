"use strict";

function sheetsFromBook(book) {
  const XLSX = require("xlsx");
  return book.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: "" }),
  }));
}

function readWorkbook(filePath) {
  const XLSX = require("xlsx");
  return sheetsFromBook(XLSX.readFile(filePath, { cellDates: true }));
}

function readWorkbookBuffer(buffer) {
  const XLSX = require("xlsx");
  const book = XLSX.read(buffer, { type: "buffer", cellDates: true });
  return sheetsFromBook(book);
}

module.exports = { readWorkbook, readWorkbookBuffer };
