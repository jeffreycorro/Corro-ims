"use strict";

function readWorkbook(filePath) {
  const XLSX = require("xlsx");
  const book = XLSX.readFile(filePath, { cellDates: true });
  return book.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: "" }),
  }));
}

module.exports = { readWorkbook };
