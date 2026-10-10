"use strict";

const { billRemaining } = require("./aging");
const { round2 } = require("./money");
const { collapse, nameKey, reservedSupplierName } = require("./names");

function masterRows(doc, key) {
  if (!doc) return [];
  const data = doc.data && typeof doc.data === "object" ? doc.data : doc;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  if (key && Array.isArray(data[key])) return data[key];
  if (Array.isArray(data.suppliers)) return data.suppliers;
  if (Array.isArray(data.projects)) return data.projects;
  return [];
}

function mapHrAdvance(row) {
  const data = row && row.data && typeof row.data === "object" && !row.no && !row.amount ? row.data : row || {};
  const id = data.id || (row && row.id) || "";
  const liquidated = round2(
    (data.liquidations || []).reduce((sum, line) => sum + round2(line && line.amount), 0) +
      round2(data.deducted)
  );
  const amount = round2(data.amount);
  return {
    source: "hr",
    sourceId: String(id),
    number: data.no || "",
    employee: data.receivedBy || data.employee || data.name || "",
    employeeId: data.empId || "",
    department: data.department || "",
    purpose: data.purpose || "",
    project: data.project || "",
    amount,
    liquidated,
    balance: round2(amount - liquidated),
    date: data.date || "",
    releasedOn: data.releasedOn || "",
    status: data.status || "",
    readOnly: true,
  };
}

function mapHrProject(row) {
  const data = row && row.data && typeof row.data === "object" && !row.name ? row.data : row || {};
  const name = collapse(data.name || data.project || "");
  if (!name) return null;
  return {
    source: "hr",
    sourceId: String(data.id || (row && row.id) || nameKey(name)),
    name,
    site: collapse(data.site || data.location || ""),
    status: data.status || "",
    readOnly: true,
  };
}

function mapHrEmployee(row) {
  const data = row && row.data && typeof row.data === "object" && !row.name ? row.data : row || {};
  const name = collapse(data.name || "");
  if (!name) return null;
  return {
    source: "hr",
    sourceId: String(data.id || (row && row.id) || ""),
    name,
    department: data.department || data.dept || "",
    position: data.position || "",
    readOnly: true,
  };
}

function lineAmount(line) {
  if (!line || typeof line !== "object") return 0;
  if (line.total != null && line.total !== "") return round2(line.total);
  return round2(round2(line.qty) * round2(line.price));
}

function mapMotorpoolReserve(record) {
  const data = record && record.data && typeof record.data === "object" ? record.data : record || {};
  const lines = Array.isArray(data.lines) ? data.lines : Array.isArray(data.rows) ? data.rows : [];
  const summed = round2(lines.reduce((sum, line) => sum + lineAmount(line), 0));
  const budget =
    data.approvedBudget != null && data.approvedBudget !== ""
      ? round2(data.approvedBudget)
      : data.budget != null && data.budget !== ""
        ? round2(data.budget)
        : summed;
  const supplier =
    collapse(data.supplier) ||
    collapse((lines.find((line) => line && line.supplier) || {}).supplier);
  const number = data.vrfNo != null && String(data.vrfNo) !== "" ? String(data.vrfNo) : String(data.no || record.reserve_no || "");
  return {
    source: "motorpool",
    sourceId: String(record.id || (data.no ? `reserve:${data.no}` : number)),
    number,
    reserveNo: String(data.no || record.reserve_no || ""),
    vrfNo: data.vrfNo != null ? String(data.vrfNo) : "",
    supplier,
    project: collapse(data.project || data.site || ""),
    purpose: collapse(data.particulars || data.purpose || data.work || (number ? `VRF ${number}` : "")),
    amount: budget,
    date: data.date || "",
    status: data.status || "",
    requestedBy: data.requestedBy || "",
    readOnly: true,
  };
}

function mapMotorpoolSupplierRow(row) {
  const name = collapse(typeof row === "string" ? row : row && (row.name || row.supplier));
  if (!name || reservedSupplierName(name)) return null;
  return {
    source: "motorpool",
    name,
    nameKey: nameKey(name),
    tin: row && row.tin ? String(row.tin) : "",
    readOnly: true,
  };
}

function mapMotorpoolSuppliers(doc) {
  const rows = masterRows(doc, "suppliers");
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    const mapped = mapMotorpoolSupplierRow(row);
    if (!mapped || seen.has(mapped.nameKey)) return;
    seen.add(mapped.nameKey);
    out.push(mapped);
  });
  return out;
}

function mapMotorpoolProjectRow(row) {
  const name = collapse(typeof row === "string" ? row : row && (row.name || row.project));
  if (!name) return null;
  return {
    source: "motorpool",
    name,
    site: collapse((row && (row.site || row.location)) || ""),
    readOnly: true,
  };
}

function mapMotorpoolProjects(doc) {
  return masterRows(doc, "projects").map(mapMotorpoolProjectRow).filter(Boolean);
}

/**
 * Finance-owned suppliers win. A Motorpool name with the same key is linked,
 * not listed twice, and is never written back to Motorpool.
 */
function dedupeSuppliers(financeRows, motorpoolRows) {
  const byKey = new Map();
  (financeRows || []).forEach((row) => {
    const key = row.name_key || nameKey(row.name);
    if (!key) return;
    byKey.set(key, {
      id: row.id || null,
      name: row.name,
      nameKey: key,
      tin: row.tin || "",
      address: row.address || "",
      termsDays: row.terms_days != null ? row.terms_days : null,
      active: row.active !== false,
      source: "finance",
      motorpoolLinked: Boolean(row.motorpool_key),
      readOnly: false,
    });
  });
  (motorpoolRows || []).forEach((row) => {
    const mapped = row && row.nameKey ? row : mapMotorpoolSupplierRow(row);
    if (!mapped) return;
    const existing = byKey.get(mapped.nameKey);
    if (existing) {
      existing.motorpoolLinked = true;
      return;
    }
    byKey.set(mapped.nameKey, {
      id: null,
      name: mapped.name,
      nameKey: mapped.nameKey,
      tin: mapped.tin || "",
      address: "",
      termsDays: null,
      active: true,
      source: "motorpool",
      motorpoolLinked: true,
      readOnly: true,
    });
  });
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function hrBalance(advance) {
  return billRemaining(
    { net_amount: advance.amount, status: "Open" },
    [{ amount: advance.liquidated }]
  ).remaining;
}

module.exports = {
  dedupeSuppliers,
  hrBalance,
  mapHrAdvance,
  mapHrEmployee,
  mapHrProject,
  mapMotorpoolProjects,
  mapMotorpoolReserve,
  mapMotorpoolSupplierRow,
  mapMotorpoolSuppliers,
  masterRows,
};
