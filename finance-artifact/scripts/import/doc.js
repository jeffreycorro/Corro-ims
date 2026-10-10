"use strict";

const { textCell } = require("./rows");

function bankFromSheetName(name) {
  const text = String(name || "");
  if (/credit\s*line/i.test(text)) return "BPI Credit Line";
  if (/BPI\s*1842/i.test(text)) return "BPI 1842";
  const match = text.match(/\b(AUB|BDO|BPI|PBB|RCBC|DBP|LBP)\b/i);
  if (!match) return "";
  if (match[1].toUpperCase() === "BPI") return "BPI 1842";
  return match[1].toUpperCase();
}

function checkRole(name) {
  const text = String(name || "").trim();
  if (/^sheet\s*3$/i.test(text)) return "supplement";
  if (/monthly summary|check details|pending due|payable monitoring|^report$|account numbers/i.test(text)) return "skip";
  return "book";
}

function visible(sheet) {
  return sheet && !sheet.hidden;
}

function masterNames(rows) {
  const suppliers = [];
  const employees = [];
  const projects = [];
  (rows || []).forEach((row, index) => {
    if (!index) return;
    const supplier = textCell(row[0]);
    const employee = textCell(row[6]);
    const project = textCell(row[7]);
    if (supplier && !/supplier/i.test(supplier)) suppliers.push(supplier);
    if (employee) employees.push(employee);
    if (project) projects.push(project);
  });
  return { suppliers, employees, projects };
}

function sheetsToDoc({ petty, checks, gcash, bills, defaultYear }) {
  const doc = { defaultYear: Number(defaultYear) || 2026, masters: { suppliers: [], employees: [], projects: [] } };
  if (petty && petty.length) {
    doc.petty = [];
    petty.forEach((sheet) => {
      if (!visible(sheet)) return;
      const name = sheet.name || "";
      if (/template|^copy of/i.test(name.trim())) return;
      if (/masterlist/i.test(name)) {
        const found = masterNames(sheet.rows);
        doc.masters.suppliers.push(...found.suppliers);
        doc.masters.employees.push(...found.employees);
        doc.masters.projects.push(...found.projects);
        return;
      }
      doc.petty.push({ name, rows: sheet.rows || [] });
    });
  }
  if (checks && checks.length) {
    doc.checks = [];
    checks.forEach((sheet) => {
      if (!visible(sheet)) return;
      const role = checkRole(sheet.name);
      if (role === "skip") return;
      doc.checks.push({
        name: sheet.name,
        bank: bankFromSheetName(sheet.name),
        rows: sheet.rows || [],
        supplement: role === "supplement",
      });
    });
  }
  if (gcash && gcash.length) {
    doc.gcash = gcash.filter(visible).map((sheet) => ({ name: sheet.name, rows: sheet.rows || [] }));
  }
  if (bills && bills.length) {
    doc.bills = bills.filter(visible).map((sheet) => ({ name: sheet.name, rows: sheet.rows || [] }));
  }
  return doc;
}

module.exports = { bankFromSheetName, checkRole, masterNames, sheetsToDoc };
