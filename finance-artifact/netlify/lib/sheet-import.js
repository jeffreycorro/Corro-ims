"use strict";

const crypto = require("crypto");
const { sheetsToDoc } = require("../../scripts/import/doc");
const { applyImport } = require("../../scripts/import/load");
const { TARGETS, reconciliation } = require("../../scripts/import/reconcile");
const { readWorkbookBuffer } = require("../../scripts/import/xlsx");
const { fail } = require("./errors");
const { createMemoryStore } = require("./memory-store");

const KINDS = ["petty", "checks", "gcash", "bills"];
const PART_BYTES = 3 * 1024 * 1024;
const MAX_PARTS = 40;
const DEFAULT_CHUNK = 40;
const MAX_CHUNK = 80;

const COUNT_TABLES = [
  ["petty_cycles", "Petty cash cycles"],
  ["petty_cash_ins", "Petty cash ins"],
  ["petty_vouchers", "Petty cash vouchers"],
  ["petty_receipts", "Petty cash receipts"],
  ["petty_releases", "Petty cash releases"],
  ["checks", "Checks"],
  ["check_invoices", "Check invoices"],
  ["wallet_batches", "GCash batches"],
  ["wallet_cash_ins", "GCash top-ups"],
  ["wallet_expenses", "GCash expenses"],
  ["wallet_receivables", "GCash receivables"],
  ["checklist_bills", "Bills"],
  ["checklist_instances", "Bill months"],
  ["import_issues", "Import issues"],
];

const WRITE_RANK = {
  employees: 10,
  projects: 10,
  suppliers: 10,
  funding_sources: 10,
  bank_accounts: 10,
  wallets: 10,
  employee_aliases: 12,
  project_aliases: 12,
  supplier_aliases: 12,
  petty_cycles: 20,
  checks: 20,
  wallet_batches: 20,
  checklist_bills: 20,
  petty_vouchers: 30,
  petty_cash_ins: 40,
  petty_receipts: 40,
  petty_releases: 40,
  check_invoices: 40,
  wallet_cash_ins: 40,
  wallet_expenses: 40,
  wallet_receivables: 40,
  checklist_instances: 40,
  bank_secrets: 45,
  import_issues: 50,
};

const WRITE_TABLES = new Set(Object.keys(WRITE_RANK));

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function naturalKey(table, row) {
  if (!row) return "";
  if (table === "petty_cycles") return `${row.year}|${row.cycle_no}`;
  if (table === "petty_vouchers") return row.pcv_no ? `pcv:${row.pcv_no}` : "";
  if (table === "checks") return row.check_no ? `chk:${row.check_no}` : "";
  if (table === "wallet_batches") return `${row.wallet_id}|${row.year}|${row.batch_no}`;
  if (table === "wallet_expenses") return row.ref_no ? `ref:${row.ref_no}` : "";
  if (table === "import_issues") return [row.source, row.row_no, row.field, row.raw, row.message].join("|");
  if (row.import_key) return `k:${row.import_key}`;
  if (table === "bank_secrets" && row.id) return `id:${row.id}`;
  return "";
}

async function rowsOf(store, table) {
  if (typeof store.listAll === "function") return store.listAll(table);
  return store.list(table);
}

function publicIssue(row) {
  return {
    source: row.source || "",
    sheet: row.sheet || "",
    row_no: row.row_no || row.rowNo || 0,
    field: row.field || "",
    raw: row.raw || "",
    message: row.message || "",
  };
}

function shapeRecon(doc, report) {
  const targets = report.targets || TARGETS;
  const pcb = report.pcb35;
  const gcash = report.gcash;
  const sept = report.sept2026 || { total: 0, matches: false };
  return {
    pcb35: doc.petty
      ? {
          included: true,
          missing: !pcb,
          cashOnHand: pcb ? pcb.cashOnHand : null,
          openReleases: pcb ? pcb.openReleases : null,
          targetCash: targets.pcb35CashOnHand,
          targetOpen: targets.pcb35OpenReleases,
          matches: Boolean(pcb && pcb.matches),
        }
      : { included: false, targetCash: targets.pcb35CashOnHand, targetOpen: targets.pcb35OpenReleases },
    gcash: doc.gcash
      ? {
          included: true,
          missing: !gcash,
          balance: gcash ? gcash.balance : null,
          target: targets.gcashBalance,
          matches: Boolean(gcash && gcash.matches),
        }
      : { included: false, target: targets.gcashBalance },
    sept2026: doc.checks
      ? {
          included: true,
          total: sept.total,
          target: targets.sept2026Checks,
          matches: Boolean(sept.matches),
        }
      : { included: false, target: targets.sept2026Checks },
  };
}

async function classify(live, scratch) {
  const counts = [];
  for (const [table, label] of COUNT_TABLES) {
    const liveRows = await rowsOf(live, table);
    const liveKeys = new Set(liveRows.map((row) => naturalKey(table, row)).filter(Boolean));
    const rows = await scratch.list(table);
    let create = 0;
    let update = 0;
    for (const row of rows) {
      const key = naturalKey(table, row);
      if (!key) continue;
      if (liveKeys.has(key)) update += 1;
      else create += 1;
    }
    if (create || update) counts.push({ table, label, rows: create + update, create, update });
  }
  return counts;
}

async function previewImport(live, doc) {
  const scratch = createMemoryStore();
  const loaded = await applyImport(scratch, doc);
  const report = await reconciliation(scratch);
  return {
    counts: await classify(live, scratch),
    reconciliation: shapeRecon(doc, report),
    issues: (loaded.issues || []).map(publicIssue),
  };
}

function createWriteCache(backing) {
  const bags = new Map();
  const loaded = new Set();
  const dirty = new Map();

  async function ensure(table) {
    if (loaded.has(table)) return;
    const rows = await rowsOf(backing, table);
    const bag = new Map();
    for (const row of rows) bag.set(String(row.id), copy(row));
    bags.set(table, bag);
    loaded.add(table);
  }

  const api = {
    async transaction(fn) {
      return fn(api);
    },
    async list(table, pred) {
      await ensure(table);
      const rows = Array.from(bags.get(table).values()).map(copy);
      return pred ? rows.filter(pred) : rows;
    },
    async get(table, id) {
      await ensure(table);
      const row = bags.get(table).get(String(id));
      return row ? copy(row) : null;
    },
    async insert(table, row) {
      await ensure(table);
      const id = row.id || crypto.randomUUID();
      const bag = bags.get(table);
      if (bag.has(id)) fail("conflict", "That record already exists.");
      const saved = { ...copy(row), id };
      bag.set(id, saved);
      dirty.set(`${table}\0${id}`, { op: "insert", table, id });
      return copy(saved);
    },
    async update(table, id, patch) {
      await ensure(table);
      const bag = bags.get(table);
      const prev = bag.get(String(id));
      if (!prev) fail("not_found", "Record not found.");
      const next = { ...prev, ...copy(patch), id: prev.id };
      bag.set(prev.id, next);
      const key = `${table}\0${prev.id}`;
      if (!dirty.has(key)) dirty.set(key, { op: "update", table, id: prev.id });
      return copy(next);
    },
    async reserveNumber(series, year, seq, number) {
      if (backing.reserveNumber) return backing.reserveNumber(series, year, seq, number);
      return { series, year: Number(year), seq: Number(seq) };
    },
    writes() {
      const items = [];
      for (const mark of dirty.values()) {
        if (!WRITE_TABLES.has(mark.table)) continue;
        const row = bags.get(mark.table).get(mark.id);
        items.push({
          op: mark.op,
          table: mark.table,
          id: mark.id,
          row: copy(row),
          rank: WRITE_RANK[mark.table] || 30,
        });
      }
      items.sort((a, b) => a.rank - b.rank || a.table.localeCompare(b.table) || String(a.id).localeCompare(String(b.id)));
      return items.map((item) => ({ op: item.op, table: item.table, id: item.id, row: item.row }));
    },
  };
  return api;
}

async function buildPlan(live, doc) {
  const cache = createWriteCache(live);
  await applyImport(cache, doc);
  return { writes: cache.writes() };
}

function persistable(row) {
  const out = {};
  Object.keys(row || {}).forEach((key) => {
    if (row[key] !== undefined) out[key] = row[key];
  });
  return out;
}

async function applyWrite(store, write) {
  const row = persistable(write.row);
  const existing = await store.get(write.table, write.id);
  if (existing) return store.update(write.table, write.id, row);
  try {
    return await store.insert(write.table, row);
  } catch (err) {
    if (err && (err.code === "conflict" || err.statusCode === 409)) return store.update(write.table, write.id, row);
    throw err;
  }
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function issuesCsv(issues) {
  const header = ["source", "sheet", "row_no", "field", "raw", "message"];
  const lines = [header.join(",")];
  for (const row of issues || []) {
    lines.push(header.map((key) => csvCell(row[key])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function safeJobId(id) {
  const clean = String(id || "");
  if (!/^[A-Za-z0-9-]{8,80}$/.test(clean)) fail("bad_request", "That import was not found.");
  return clean;
}

function chunkSizeOf(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_CHUNK;
  return Math.min(n, MAX_CHUNK);
}

function fileView(files) {
  return KINDS.filter((kind) => files && files[kind]).map((kind) => {
    const entry = files[kind] || {};
    const parts = Array.isArray(entry.parts) ? entry.parts : [];
    return { kind, received: parts.length, total: Number(entry.total) || 0, ready: parts.length > 0 && parts.length === Number(entry.total) };
  });
}

function publicJob(job) {
  if (!job) return null;
  const report = job.report || {};
  const issues = Array.isArray(report.issues) ? report.issues : [];
  return {
    id: job.id,
    status: job.status,
    phase: job.phase || "",
    cursor: Number(job.cursor) || 0,
    total: Number(job.total) || 0,
    error: job.error || "",
    created_by: job.created_by || "",
    sheet_year: Number(job.sheet_year) || 2026,
    files: fileView(job.files),
    report: {
      counts: report.counts || [],
      reconciliation: report.reconciliation || null,
      issueCount: issues.length,
      issues: issues.slice(0, 100),
      issuesTruncated: issues.length > 100,
    },
  };
}

async function mustJob(store, id) {
  const job = await store.get("import_jobs", safeJobId(id));
  if (!job) fail("not_found", "That import was not found.");
  return job;
}

async function startJob(store, session, input) {
  const year = Number(input && input.year) || 2026;
  if (year < 2000 || year > 2100) fail("bad_request", "Choose a year between 2000 and 2100.");
  const id = crypto.randomUUID();
  const row = await store.insert("import_jobs", {
    id,
    status: "staging",
    created_by: session.email || session.name || "",
    files: {},
    phase: "upload",
    cursor: 0,
    total: 0,
    plan_path: "",
    sheet_year: year,
    report: {},
    error: "",
    created_at: new Date().toISOString(),
  });
  return publicJob(row);
}

async function stagePart(store, storage, jobId, input) {
  const job = await mustJob(store, jobId);
  if (job.status === "running" || job.status === "done") fail("conflict", "That import has already started.");
  const kind = String(input.kind || "");
  if (!KINDS.includes(kind)) fail("bad_request", "Choose petty cash, checks, GCash, or bills.");
  const index = Number(input.index);
  const total = Number(input.total);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || index >= total || total > MAX_PARTS) {
    fail("bad_request", "That upload part is out of range.");
  }
  const bytes = Buffer.from(String(input.dataBase64 || ""), "base64");
  if (!bytes.length) fail("bad_request", "File data is required.");
  if (bytes.length > PART_BYTES) fail("bad_request", "Upload the sheet in smaller parts.");
  const path = `imports/${job.id}/parts/${kind}/${index}`;
  await storage.putObject(path, bytes, "application/octet-stream", { upsert: true });
  const files = { ...(job.files || {}) };
  const previous = files[kind] || {};
  const parts = Array.from(new Set([...(previous.parts || []), index])).sort((a, b) => a - b);
  files[kind] = { total, parts };
  await store.update("import_jobs", job.id, {
    files,
    status: "staging",
    phase: "upload",
    report: {},
    error: "",
    plan_path: "",
    cursor: 0,
    total: 0,
  });
  return { jobId: job.id, kind, received: parts.length, total };
}

async function assemble(storage, job, kind) {
  const entry = (job.files || {})[kind];
  if (!entry) return "";
  const total = Number(entry.total) || 0;
  const parts = entry.parts || [];
  if (!total || parts.length !== total) {
    fail("bad_request", `The ${kind} file is still uploading (${parts.length} of ${total}).`);
  }
  const buffers = [];
  for (let index = 0; index < total; index += 1) {
    buffers.push(await storage.getObject(`imports/${job.id}/parts/${kind}/${index}`));
  }
  const whole = Buffer.concat(buffers);
  if (whole.length > 50 * 1024 * 1024) fail("bad_request", "That workbook is over 50 MB.");
  const path = `imports/${job.id}/${kind}.xlsx`;
  await storage.putObject(path, whole, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { upsert: true });
  return path;
}

function readSheets(kind, buffer) {
  try {
    return readWorkbookBuffer(buffer);
  } catch (err) {
    fail("bad_request", `The ${kind} file is not an Excel workbook.`);
  }
  return [];
}

async function loadDoc(storage, job) {
  const books = {};
  const paths = {};
  for (const kind of KINDS) {
    if (!(job.files || {})[kind]) continue;
    const path = await assemble(storage, job, kind);
    paths[kind] = path;
    books[kind] = readSheets(kind, await storage.getObject(path));
  }
  if (!Object.keys(books).length) fail("bad_request", "Upload at least one workbook.");
  const doc = sheetsToDoc({ ...books, defaultYear: job.sheet_year || 2026 });
  return { doc, paths };
}

async function dryRun(store, storage, jobId, input) {
  const job = await mustJob(store, jobId);
  if (job.status === "running") fail("conflict", "That import is still running.");
  const year = Number(input && input.year) || job.sheet_year || 2026;
  if (year < 2000 || year > 2100) fail("bad_request", "Choose a year between 2000 and 2100.");
  job.sheet_year = year;
  const { doc } = await loadDoc(storage, job);
  const report = await previewImport(store, doc);
  const saved = await store.update("import_jobs", job.id, {
    status: "ready",
    phase: "ready",
    sheet_year: year,
    report,
    error: "",
    plan_path: "",
    cursor: 0,
    total: 0,
  });
  return publicJob(saved);
}

async function tick(store, storage, jobId, input) {
  const job = await mustJob(store, jobId);
  if (job.status === "done") return publicJob(job);
  if (job.status !== "running" && job.status !== "failed") fail("conflict", "Run a dry run, then import.");
  if (!job.plan_path) fail("conflict", "This import has no saved plan.");
  let plan;
  try {
    plan = JSON.parse(String(await storage.getObject(job.plan_path)));
  } catch (err) {
    fail("not_found", "The import plan is missing. Start the import again.");
  }
  const writes = (plan && plan.writes) || [];
  const cursor = Number(job.cursor) || 0;
  const size = chunkSizeOf(input && input.chunkSize);
  const end = Math.min(writes.length, cursor + size);
  try {
    for (const write of writes.slice(cursor, end)) await applyWrite(store, write);
  } catch (err) {
    await store.update("import_jobs", job.id, { status: "failed", phase: job.phase || "import", error: err.message || "Import failed." });
    throw err;
  }
  const done = end >= writes.length;
  const phase = done ? "done" : (writes[end] && writes[end].table) || "import";
  const saved = await store.update("import_jobs", job.id, {
    status: done ? "done" : "running",
    phase,
    cursor: end,
    total: writes.length,
    error: "",
  });
  return publicJob(saved);
}

async function commitJob(store, storage, jobId, input) {
  const job = await mustJob(store, jobId);
  if (job.status !== "ready") fail("conflict", "Run a dry run before import.");
  const { doc } = await loadDoc(storage, job);
  const preview = await previewImport(store, doc);
  const plan = await buildPlan(store, doc);
  const planPath = `imports/${job.id}/plan.json`;
  await storage.putObject(planPath, Buffer.from(JSON.stringify(plan)), "application/json", { upsert: true });
  await store.update("import_jobs", job.id, {
    status: "running",
    phase: plan.writes.length ? plan.writes[0].table : "done",
    plan_path: planPath,
    cursor: 0,
    total: plan.writes.length,
    report: preview,
    error: "",
  });
  if (!plan.writes.length) {
    const saved = await store.update("import_jobs", job.id, { status: "done", phase: "done", cursor: 0, total: 0 });
    return publicJob(saved);
  }
  return tick(store, storage, job.id, input);
}

async function runUntilDone(store, storage, jobId, options) {
  const started = Date.now();
  const budget = (options && options.budgetMs) || 12 * 60 * 1000;
  let job = await mustJob(store, jobId);
  let guard = 0;
  while (job.status === "running" || job.status === "failed") {
    if (Date.now() - started > budget) break;
    if (guard > 100000) break;
    guard += 1;
    const next = await tick(store, storage, jobId, { chunkSize: (options && options.chunkSize) || DEFAULT_CHUNK });
    job = await mustJob(store, jobId);
    if (next.status === "done" || next.status === "failed") break;
  }
  return publicJob(job);
}

async function jobStatus(store, jobId) {
  if (jobId) return publicJob(await mustJob(store, jobId));
  const rows = await store.list("import_jobs");
  const latest = rows.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  return publicJob(latest || null);
}

async function jobIssuesCsv(store, jobId) {
  const job = await mustJob(store, jobId);
  const issues = (job.report && job.report.issues) || [];
  return { filename: `import-issues-${job.id}.csv`, csv: issuesCsv(issues) };
}

function createMemoryStorage() {
  const files = new Map();
  return {
    files,
    async putObject(path, bytes) {
      files.set(path, Buffer.from(bytes));
      return { path };
    },
    async getObject(path) {
      const hit = files.get(path);
      if (!hit) {
        const err = new Error("Could not read that upload.");
        err.statusCode = 404;
        err.code = "not_found";
        throw err;
      }
      return Buffer.from(hit);
    },
  };
}

module.exports = {
  COUNT_TABLES,
  KINDS,
  applyWrite,
  buildPlan,
  commitJob,
  createMemoryStorage,
  dryRun,
  issuesCsv,
  jobIssuesCsv,
  jobStatus,
  previewImport,
  publicJob,
  runUntilDone,
  stagePart,
  startJob,
  tick,
};
