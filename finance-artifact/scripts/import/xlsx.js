"use strict";

function sheetsFromBook(book) {
  const XLSX = require("xlsx");
  const flags = new Map();
  ((book.Workbook && book.Workbook.Sheets) || []).forEach((sheet) => {
    flags.set(sheet.name, Number(sheet.Hidden) || 0);
  });
  return book.SheetNames.map((name) => ({
    name,
    hidden: flags.get(name) || 0,
    rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: "" }),
  }));
}

function readWorkbook(filePath) {
  const XLSX = require("xlsx");
  return sheetsFromBook(XLSX.readFile(filePath, { cellDates: false }));
}

function readWorkbookBuffer(buffer) {
  const XLSX = require("xlsx");
  const book = XLSX.read(buffer, { type: "buffer", cellDates: false });
  return sheetsFromBook(book);
}

module.exports = { readWorkbook, readWorkbookBuffer };
