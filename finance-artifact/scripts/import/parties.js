"use strict";

const { collapse, nameKey } = require("../../netlify/lib/names");

const SKIP = new Set(["unassigned", "cash", "cancelled", "cancelled check", "n a", "na", "none", "null", "tbd", "false"]);

function cleanName(raw) {
  const name = collapse(raw);
  const key = nameKey(name);
  if (!key || SKIP.has(key) || /^[\d\s]+$/.test(key)) return null;
  if (/^cancelled(\s+check)?$/.test(key)) return null;
  return { name, key };
}

function canonicalize(rawNames) {
  const unique = [];
  const seen = new Set();
  (rawNames || []).forEach((raw) => {
    const item = cleanName(raw);
    if (!item || seen.has(item.key)) return;
    seen.add(item.key);
    unique.push(item);
  });
  unique.sort((a, b) => b.key.length - a.key.length || a.name.localeCompare(b.name));
  const canon = [];
  const aliases = [];
  unique.forEach((item) => {
    const host = canon.find((row) => {
      if (row.key === item.key) return true;
      if (item.key.length < 12) return false;
      if (!row.key.startsWith(item.key)) return false;
      const rest = row.key.slice(item.key.length);
      return rest === "" || rest.startsWith(" ") || rest.length <= 12;
    });
    if (!host) canon.push(item);
    else if (host.key !== item.key) aliases.push({ alias: item.name, key: item.key, hostKey: host.key });
  });
  return { canon, aliases };
}

async function loadTable(store, table) {
  const rows = await store.list(table);
  const byKey = new Map();
  rows.forEach((row) => {
    if (row.name_key) byKey.set(row.name_key, row);
    const key = nameKey(row.name);
    if (key) byKey.set(key, row);
  });
  return { rows, byKey };
}

async function ensureParty(store, bag, item, extra) {
  const found = bag.byKey.get(item.key);
  if (found) return found;
  const row = await store.insert(bag.table, { name: item.name, name_key: item.key, active: true, ...extra });
  bag.rows.push(row);
  bag.byKey.set(item.key, row);
  return row;
}

async function seedAliases(store, table, fk, aliases, ids) {
  const rows = await store.list(table);
  const seen = new Set(rows.map((row) => row.alias_key));
  for (const alias of aliases) {
    if (seen.has(alias.key)) continue;
    const host = ids.get(alias.hostKey);
    if (!host) continue;
    await store.insert(table, { alias: alias.alias, alias_key: alias.key, [fk]: host });
    seen.add(alias.key);
  }
}

async function seedParties(store, names) {
  const suppliers = canonicalize(names.suppliers);
  const employees = canonicalize(names.employees);
  const projects = canonicalize(names.projects);
  const supplierBag = await loadTable(store, "suppliers");
  supplierBag.table = "suppliers";
  const supplierAliasKeys = new Set((await store.list("supplier_aliases")).map((row) => row.alias_key));
  const supplierIds = new Map();
  for (const item of suppliers.canon) {
    if (supplierAliasKeys.has(item.key)) continue;
    const row = await ensureParty(store, supplierBag, item, {
      tin: "",
      branch: "",
      address: "",
      vat_status: "",
      terms_days: null,
      motorpool_key: "",
    });
    supplierIds.set(item.key, row.id);
  }
  await seedAliases(store, "supplier_aliases", "supplier_id", suppliers.aliases, supplierIds);
  const employeeBag = await loadTable(store, "employees");
  employeeBag.table = "employees";
  const employeeAliasKeys = new Set((await store.list("employee_aliases")).map((row) => row.alias_key));
  const employeeIds = new Map();
  for (const item of employees.canon) {
    if (employeeAliasKeys.has(item.key)) continue;
    const row = await ensureParty(store, employeeBag, item, { department: "", hr_id: "" });
    employeeIds.set(item.key, row.id);
  }
  await seedAliases(store, "employee_aliases", "employee_id", employees.aliases, employeeIds);
  const projectBag = await loadTable(store, "projects");
  projectBag.table = "projects";
  const projectAliasKeys = new Set((await store.list("project_aliases")).map((row) => row.alias_key));
  const projectIds = new Map();
  for (const item of projects.canon) {
    if (projectAliasKeys.has(item.key)) continue;
    const row = await ensureParty(store, projectBag, item, { site: "", code: "", client: "", source: "finance" });
    projectIds.set(item.key, row.id);
  }
  await seedAliases(store, "project_aliases", "project_id", projects.aliases, projectIds);
}

module.exports = { canonicalize, seedParties };
