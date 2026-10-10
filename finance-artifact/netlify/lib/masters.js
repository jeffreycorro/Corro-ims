"use strict";

const { fail } = require("./errors");
const { collapse, nameKey } = require("./names");
const { protectAccount, publicAccountNo } = require("./mask");

const { CATEGORIES: CHECKLIST_SITES } = require("./bill-monitor");

const CLASSIFICATIONS = ["Vat", "Non-Vat", "No Classification", "Vat & No classification"];

const FUNDING = [
  { id: "fund-j", code: "J", name: "Owner cash Jeffrey" },
  { id: "fund-m", code: "M", name: "Owner cash Marian" },
  { id: "fund-payroll", code: "PAYROLL", name: "Payroll excess" },
  { id: "fund-check", code: "CHECK", name: "Check" },
  { id: "fund-sales", code: "SALES", name: "Sales" },
  { id: "fund-refund", code: "REFUND", name: "Refund" },
];

const BANKS = [
  { id: "bank-aub", bank_name: "Asia United Bank", nickname: "AUB", account_type: "AUB", bank_code: "AUB" },
  { id: "bank-bdo", bank_name: "BDO", nickname: "BDO", account_type: "BDO", bank_code: "BDO" },
  { id: "bank-bpi-1842", bank_name: "BPI", nickname: "BPI 1842", account_type: "BPI 1842", bank_code: "BPI" },
  { id: "bank-bpi-cl", bank_name: "BPI", nickname: "BPI Credit Line", account_type: "BPI Credit Line", bank_code: "BPI" },
  { id: "bank-pbb", bank_name: "Philippine Business Bank", nickname: "PBB", account_type: "PBB", bank_code: "PBB" },
  { id: "bank-rcbc", bank_name: "RCBC", nickname: "RCBC", account_type: "RCBC", bank_code: "RCBC" },
  { id: "bank-dbp", bank_name: "DBP", nickname: "DBP", account_type: "DBP", bank_code: "DBP" },
  { id: "bank-lbp", bank_name: "Land Bank", nickname: "LBP", account_type: "LBP", bank_code: "LBP" },
  { id: "bank-bdo-personal", bank_name: "BDO", nickname: "BDO Personal", account_type: "BDO Personal", bank_code: "BDOJOINT", account_name: "Jeffrey", is_personal: true },
];

const PARTY = {
  employee: { table: "employees", alias: "employee_aliases", fk: "employee_id", unassigned: "employee-unassigned" },
  project: { table: "projects", alias: "project_aliases", fk: "project_id", unassigned: "project-unassigned" },
  supplier: { table: "suppliers", alias: "supplier_aliases", fk: "supplier_id", unassigned: "supplier-unassigned" },
};

async function ensureRow(store, table, id, row) {
  const existing = await store.get(table, id);
  if (existing) return existing;
  const rows = await store.list(table);
  const key = row.name_key || row.code;
  const found = rows.find((item) => (key && (item.name_key === key || item.code === key)) || item.id === id);
  if (found) return found;
  return store.insert(table, { ...row, id });
}

async function seedMasters(store) {
  await ensureRow(store, "projects", "project-unassigned", {
    name: "Unassigned",
    name_key: "unassigned",
    site: "",
    code: "",
    client: "",
    source: "finance",
    active: true,
  });
  await ensureRow(store, "employees", "employee-unassigned", {
    name: "Unassigned",
    name_key: "unassigned",
    department: "",
    hr_id: "",
    active: true,
  });
  await ensureRow(store, "suppliers", "supplier-unassigned", {
    name: "Unassigned",
    name_key: "unassigned",
    tin: "",
    branch: "",
    address: "",
    vat_status: "",
    terms_days: null,
    motorpool_key: "",
    active: true,
  });
  await ensureRow(store, "suppliers", "supplier-cash", {
    name: "Cash",
    name_key: "cash",
    tin: "",
    branch: "",
    address: "",
    vat_status: "No Classification",
    terms_days: null,
    motorpool_key: "",
    active: true,
  });
  for (const row of FUNDING) {
    await ensureRow(store, "funding_sources", row.id, { ...row, active: true });
  }
  for (const row of BANKS) {
    await ensureRow(store, "bank_accounts", row.id, {
      bank_name: row.bank_name,
      nickname: row.nickname,
      account_type: row.account_type,
      bank_code: row.bank_code,
      account_name: row.account_name || "Corro Construction Development and Trade Corporation",
      account_no: "",
      currency: "PHP",
      active: true,
      is_personal: Boolean(row.is_personal),
    });
  }
  await ensureRow(store, "wallets", "wallet-gcash", { name: "GCash", active: true });
}

function partyId(kind, raw) {
  if (!raw || typeof raw !== "object") return "";
  if (raw.id && !raw.name && !raw.employeeName && !raw.projectName && !raw.supplierName) return raw.id;
  if (kind === "employee") return raw.employeeId || raw.employee_id || "";
  if (kind === "project") return raw.projectId || raw.project_id || "";
  return raw.supplierId || raw.supplier_id || "";
}

function partyName(kind, raw) {
  if (typeof raw === "string") return raw;
  if (!raw) return "";
  if (kind === "employee") return raw.employeeName || raw.employee_name || raw.co || raw.name || "";
  if (kind === "project") return raw.projectName || raw.project_name || raw.project || raw.name || "";
  return raw.supplierName || raw.supplier_name || raw.supplier || raw.name || "";
}

async function unassignedRow(store, kind) {
  const spec = PARTY[kind];
  const row = await store.get(spec.table, spec.unassigned);
  if (row) return row;
  await seedMasters(store);
  return store.get(spec.table, spec.unassigned);
}

async function resolveParty(store, kind, raw, opts = {}) {
  const spec = PARTY[kind];
  if (!spec) fail("bad_request", "Unknown list.");
  const id = partyId(kind, raw);
  if (id) {
    const row = await store.get(spec.table, id);
    if (row) return { row, unknown: false, raw: row.name };
    if (!opts.unassigned) return { row: null, unknown: true, raw: id };
  }
  const name = collapse(partyName(kind, raw));
  const key = nameKey(name);
  if (kind === "supplier" && key === "cash") {
    const cash = (await store.list("suppliers")).find((row) => row.name_key === "cash" || row.id === "supplier-cash");
    if (cash) return { row: cash, unknown: false, raw: name };
  }
  if (!key) {
    if (opts.unassigned) return { row: await unassignedRow(store, kind), unknown: true, raw: name };
    return { row: null, unknown: true, raw: name };
  }
  const rows = await store.list(spec.table);
  let found = rows.find((row) => row.name_key === key || nameKey(row.name) === key);
  if (!found && kind === "supplier" && raw && raw.tin) {
    const tin = collapse(raw.tin);
    const branch = collapse(raw.branch || "");
    found = rows.find((row) => row.tin === tin && collapse(row.branch || "") === branch);
  }
  if (!found) {
    const aliases = await store.list(spec.alias);
    const alias = aliases.find((row) => row.alias_key === key);
    if (alias) found = rows.find((row) => row.id === alias[spec.fk]) || (await store.get(spec.table, alias[spec.fk]));
  }
  if (!found && opts.unassigned) return { row: await unassignedRow(store, kind), unknown: true, raw: name };
  return { row: found || null, unknown: !found, raw: name };
}

async function mustParty(store, kind, raw) {
  const resolved = await resolveParty(store, kind, raw, { unassigned: false });
  if (!resolved.row) {
    const label = kind === "employee" ? "employee" : kind === "project" ? "project" : "supplier";
    fail("bad_request", `Choose a ${label} from the list.`);
  }
  return resolved.row;
}

function publicBank(row) {
  if (!row) return row;
  return {
    id: row.id,
    bank_name: row.bank_name || "",
    nickname: row.nickname || row.account_name || "",
    account_type: row.account_type || "",
    bank_code: row.bank_code || "",
    account_name: row.account_name || "",
    account_no: publicAccountNo(row.account_no || ""),
    currency: row.currency || "PHP",
    active: row.active !== false,
    is_personal: Boolean(row.is_personal),
  };
}

async function saveBankAccount(store, input) {
  const nickname = collapse(input.nickname || input.account_type || input.bank_name);
  if (!nickname) fail("bad_request", "Bank nickname is required.");
  const protectedNo = protectAccount(input.accountNo != null ? input.accountNo : input.account_no);
  const rows = await store.list("bank_accounts");
  const existing = input.id ? await store.get("bank_accounts", input.id) : rows.find((row) => nameKey(row.nickname) === nameKey(nickname));
  const patch = {
    bank_name: collapse(input.bankName || input.bank_name) || (existing && existing.bank_name) || nickname,
    nickname,
    account_type: collapse(input.accountType || input.account_type) || nickname,
    bank_code: collapse(input.bankCode || input.bank_code) || (existing && existing.bank_code) || "",
    account_name: collapse(input.accountName || input.account_name) || (existing && existing.account_name) || "",
    account_no: protectedNo.account_no,
    currency: "PHP",
    active: input.active !== false,
  };
  const saved = existing ? await store.update("bank_accounts", existing.id, patch) : await store.insert("bank_accounts", patch);
  if (protectedNo.ciphertext) {
    const secret = await store.get("bank_secrets", saved.id);
    if (secret) await store.update("bank_secrets", saved.id, { ciphertext: protectedNo.ciphertext });
    else await store.insert("bank_secrets", { id: saved.id, account_id: saved.id, ciphertext: protectedNo.ciphertext });
  }
  return publicBank(saved);
}

async function saveAlias(store, input) {
  const kind = String(input.kind || "");
  const spec = PARTY[kind];
  if (!spec) fail("bad_request", "Alias list is employee, project, or supplier.");
  const alias = collapse(input.alias);
  const key = nameKey(alias);
  if (!key) fail("bad_request", "Alias text is required.");
  const targetId = input.targetId || input.target_id;
  const target = await store.get(spec.table, targetId);
  if (!target) fail("bad_request", "Choose the real record this spelling maps to.");
  const rows = await store.list(spec.alias);
  const existing = rows.find((row) => row.alias_key === key);
  const patch = { alias, alias_key: key, [spec.fk]: target.id };
  if (existing) return store.update(spec.alias, existing.id, patch);
  return store.insert(spec.alias, patch);
}

module.exports = {
  BANKS,
  CHECKLIST_SITES,
  CLASSIFICATIONS,
  FUNDING,
  mustParty,
  publicBank,
  resolveParty,
  saveAlias,
  saveBankAccount,
  seedMasters,
};
