"use strict";

const crypto = require("crypto");
const { fail } = require("./errors");
const { rest } = require("./supabase");

const TABLES = {
  vouchers: "finance_vouchers",
  advances: "finance_cash_advances",
  receipts: "finance_liquidation_receipts",
  bills: "finance_bills",
  payments: "finance_bill_payments",
  suppliers: "finance_suppliers",
  projects: "finance_projects",
  accounts: "finance_accounts",
  signatories: "finance_signatories",
  attachments: "finance_attachments",
  builds: "finance_builds",
  contracts: "finance_contracts",
  billings: "finance_billings",
  collections: "finance_collections",
  petty_funds: "finance_petty_funds",
  petty_txns: "finance_petty_txns",
  bank_accounts: "finance_bank_accounts",
  bank_lines: "finance_bank_lines",
  employees: "finance_employees",
  employee_aliases: "finance_employee_aliases",
  project_aliases: "finance_project_aliases",
  supplier_aliases: "finance_supplier_aliases",
  funding_sources: "finance_funding_sources",
  bank_secrets: "finance_bank_secrets",
  petty_cycles: "finance_petty_cycles",
  petty_cash_ins: "finance_petty_cash_ins",
  petty_vouchers: "finance_petty_vouchers",
  petty_receipts: "finance_petty_receipts",
  petty_releases: "finance_petty_releases",
  checks: "finance_checks",
  check_invoices: "finance_check_invoices",
  wallets: "finance_wallets",
  wallet_batches: "finance_wallet_batches",
  wallet_cash_ins: "finance_wallet_cash_ins",
  wallet_expenses: "finance_wallet_expenses",
  wallet_receivables: "finance_wallet_receivables",
  checklist_bills: "finance_checklist_bills",
  checklist_instances: "finance_checklist_instances",
  rental_units: "finance_rental_units",
  rental_receipts: "finance_rental_receipts",
  property_taxes: "finance_property_taxes",
  import_issues: "finance_import_issues",
};

const NUMBERED = {
  vouchers: "finance_create_voucher",
  advances: "finance_create_advance",
  bills: "finance_create_bill",
  petty_vouchers: "finance_create_pcv",
  wallet_expenses: "finance_create_wallet_expense",
};

function tableOf(name) {
  const table = TABLES[name];
  if (!table) fail("bad_request", "Unknown finance table.");
  return table;
}

function asRow(json) {
  if (Array.isArray(json)) return json[0] || null;
  return json || null;
}

function createSupabaseStore() {
  return {
    async transaction(fn) {
      return fn(this);
    },
    async list(table, pred) {
      const rows = await rest({
        method: "GET",
        path: `/rest/v1/${tableOf(table)}`,
        query: "select=*&order=created_at.desc.nullslast&limit=5000",
      });
      const list = Array.isArray(rows) ? rows : [];
      return pred ? list.filter(pred) : list;
    },
    async get(table, id) {
      const rows = await rest({
        method: "GET",
        path: `/rest/v1/${tableOf(table)}`,
        query: `id=eq.${encodeURIComponent(id)}&select=*`,
      });
      return asRow(rows);
    },
    async insert(table, row) {
      const payload = { ...row };
      if (!payload.id) payload.id = crypto.randomUUID();
      const rows = await rest({
        method: "POST",
        path: `/rest/v1/${tableOf(table)}`,
        prefer: "return=representation",
        body: payload,
      });
      const saved = asRow(rows);
      if (!saved) fail("conflict", "The record was not saved.");
      return saved;
    },
    async update(table, id, patch, expect) {
      const payload = { ...patch };
      delete payload.id;
      delete payload.dv_no;
      delete payload.ca_no;
      delete payload.ap_no;
      const parts = [`id=eq.${encodeURIComponent(id)}`];
      if (expect && expect.status) parts.push(`status=eq.${encodeURIComponent(expect.status)}`);
      const rows = await rest({
        method: "PATCH",
        path: `/rest/v1/${tableOf(table)}`,
        query: parts.join("&"),
        prefer: "return=representation",
        body: payload,
      });
      const saved = asRow(rows);
      if (!saved) {
        fail("conflict", expect && expect.status ? `The record is no longer ${expect.status}.` : "Record not found.");
      }
      return saved;
    },
    async createNumbered(table, series, year, row) {
      const fn = NUMBERED[table];
      if (!fn) fail("bad_request", "That record is not numbered.");
      const saved = await rest({
        method: "POST",
        path: `/rest/v1/rpc/${fn}`,
        body: { p: { ...row, year: Number(year) } },
      });
      if (!saved || !saved.id) fail("conflict", "The number was not assigned.");
      return saved;
    },
    async reserveNumber(series, year, seq) {
      await rest({
        method: "POST",
        path: "/rest/v1/rpc/finance_reserve_number",
        body: { p_series: String(series || "").toUpperCase(), p_year: Number(year), p_seq: Number(seq) },
      });
      return { series: String(series || "").toUpperCase(), year: Number(year), seq: Number(seq) };
    },
    async registerBuild(id, build, seq) {
      await rest({
        method: "POST",
        path: "/rest/v1/rpc/finance_register_build",
        body: { p_id: id, p_build: build, p_seq: Number(seq) || Date.now() },
      });
      const rows = await rest({
        method: "GET",
        path: "/rest/v1/finance_builds",
        query: `id=eq.${encodeURIComponent(id)}&select=*`,
      });
      return asRow(rows);
    },
    external: {
      async hrAdvances() {
        return readDocs("docs", "collection=eq.advances&select=id,data");
      },
      async hrProjects() {
        return readDocs("docs", "collection=eq.projects&select=id,data");
      },
      async hrEmployees() {
        return readDocs("docs", "collection=eq.employees&select=id,data");
      },
      async mpSuppliers() {
        const rows = await readDocs("motorpool_docs", "collection=eq.master&id=eq.suppliers&select=id,data");
        return rows && rows[0] ? rows[0] : null;
      },
      async mpProjects() {
        const rows = await readDocs("motorpool_docs", "collection=eq.master&id=eq.projects&select=id,data");
        return rows && rows[0] ? rows[0] : null;
      },
      async mpReserves() {
        return readDocs(
          "motorpool_records",
          "kind=eq.reserve&select=id,data,reserve_no,vrf_no&order=updated_at.desc&limit=500"
        );
      },
    },
  };
}

async function readDocs(table, query) {
  try {
    const rows = await rest({ method: "GET", path: `/rest/v1/${table}`, query });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return table === "motorpool_docs" ? null : [];
  }
}

module.exports = { TABLES, createSupabaseStore, readDocs };
