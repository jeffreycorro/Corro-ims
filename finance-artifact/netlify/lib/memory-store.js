"use strict";

const crypto = require("crypto");
const { fail } = require("./errors");
const { formatNumber, takeNumber } = require("./numbering");

function formatReserve(series, year, seq, number) {
  const assigned = {
    series: String(series || "").toUpperCase(),
    year: Number(year),
    seq: Number(seq),
    number: number || formatNumber(series, year, seq),
  };
  return assigned;
}

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMemoryStore() {
  const tables = {
    vouchers: new Map(),
    advances: new Map(),
    receipts: new Map(),
    bills: new Map(),
    payments: new Map(),
    suppliers: new Map(),
    projects: new Map(),
    accounts: new Map(),
    signatories: new Map(),
    attachments: new Map(),
    builds: new Map(),
    contracts: new Map(),
    billings: new Map(),
    collections: new Map(),
    petty_funds: new Map(),
    petty_txns: new Map(),
    bank_accounts: new Map(),
    bank_lines: new Map(),
    employees: new Map(),
    employee_aliases: new Map(),
    project_aliases: new Map(),
    supplier_aliases: new Map(),
    funding_sources: new Map(),
    bank_secrets: new Map(),
    petty_cycles: new Map(),
    petty_cash_ins: new Map(),
    petty_vouchers: new Map(),
    petty_receipts: new Map(),
    petty_releases: new Map(),
    checks: new Map(),
    check_invoices: new Map(),
    wallets: new Map(),
    wallet_batches: new Map(),
    wallet_cash_ins: new Map(),
    wallet_expenses: new Map(),
    wallet_receivables: new Map(),
    checklist_bills: new Map(),
    checklist_instances: new Map(),
    rental_units: new Map(),
    rental_receipts: new Map(),
    property_taxes: new Map(),
    import_issues: new Map(),
    import_jobs: new Map(),
  };
  const counters = new Map();
  const issued = new Set();
  let tail = Promise.resolve();
  let depth = 0;

  function lock(fn) {
    if (depth > 0) return Promise.resolve().then(fn);
    const run = tail.then(() => {
      depth += 1;
      return Promise.resolve()
        .then(fn)
        .finally(() => {
          depth -= 1;
        });
    });
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function tableOf(table) {
    if (!tables[table]) fail("bad_request", "Unknown finance table.");
    return tables[table];
  }

  function listSync(table, pred) {
    const rows = Array.from(tableOf(table).values()).map(copy);
    return pred ? rows.filter(pred) : rows;
  }

  const api = {
    async transaction(fn) {
      return lock(() => fn(api));
    },
    async list(table, pred) {
      return lock(() => listSync(table, pred));
    },
    async get(table, id) {
      return lock(() => {
        const row = tableOf(table).get(String(id));
        return row ? copy(row) : null;
      });
    },
    async insert(table, row) {
      return lock(() => {
        const id = row.id || crypto.randomUUID();
        const bag = tableOf(table);
        if (bag.has(id)) fail("conflict", "That record already exists.");
        const saved = { ...copy(row), id, updated_at: new Date().toISOString() };
        bag.set(id, saved);
        return copy(saved);
      });
    },
    async update(table, id, patch, expect) {
      return lock(() => {
        const row = tableOf(table).get(String(id));
        if (!row) fail("not_found", "Record not found.");
        if (expect && expect.status && row.status !== expect.status) {
          fail("conflict", `The record is ${row.status} and was not updated.`);
        }
        const next = { ...row, ...copy(patch), id: row.id, updated_at: new Date().toISOString() };
        tables[table].set(row.id, next);
        return copy(next);
      });
    },
    async createNumbered(table, series, year, row, numberField) {
      return lock(() => {
        const assigned = takeNumber(counters, series, year);
        if (issued.has(assigned.number)) fail("conflict", `Number ${assigned.number} is already used.`);
        issued.add(assigned.number);
        const id = crypto.randomUUID();
        const saved = {
          ...copy(row),
          id,
          year: assigned.year,
          seq: assigned.seq,
          [numberField]: assigned.number,
          updated_at: new Date().toISOString(),
        };
        delete saved.dv_no;
        delete saved.ca_no;
        delete saved.ap_no;
        saved[numberField] = assigned.number;
        tables[table].set(id, saved);
        return copy(saved);
      });
    },
    async reserveNumber(series, year, seq, number) {
      return lock(() => {
        const assigned = formatReserve(series, year, seq, number);
        const key = `${assigned.series}:${assigned.year}`;
        const last = Number(counters.get(key) || 0);
        if (assigned.seq > last) counters.set(key, assigned.seq);
        issued.add(assigned.number);
        return assigned;
      });
    },
    async registerBuild(id, build, seq) {
      return lock(() => {
        if (tables.builds.has(id)) return copy(tables.builds.get(id));
        const row = { id, build, seq: Number(seq) || Date.now(), created_at: new Date().toISOString() };
        tables.builds.set(id, row);
        return copy(row);
      });
    },
    external: {
      async hrAdvances() {
        return [];
      },
      async hrProjects() {
        return [];
      },
      async hrEmployees() {
        return [];
      },
      async mpSuppliers() {
        return null;
      },
      async mpProjects() {
        return null;
      },
      async mpReserves() {
        return [];
      },
    },
  };

  return api;
}

module.exports = { createMemoryStore };
