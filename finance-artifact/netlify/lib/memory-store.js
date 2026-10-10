"use strict";

const crypto = require("crypto");
const { fail } = require("./errors");
const { takeNumber } = require("./numbering");

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

  function listSync(table, pred) {
    const rows = Array.from(tables[table].values()).map(copy);
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
        const row = tables[table].get(String(id));
        return row ? copy(row) : null;
      });
    },
    async insert(table, row) {
      return lock(() => {
        const id = row.id || crypto.randomUUID();
        if (tables[table].has(id)) fail("conflict", "That record already exists.");
        const saved = { ...copy(row), id, updated_at: new Date().toISOString() };
        tables[table].set(id, saved);
        return copy(saved);
      });
    },
    async update(table, id, patch, expect) {
      return lock(() => {
        const row = tables[table].get(String(id));
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
