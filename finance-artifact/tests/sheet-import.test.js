"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const XLSX = require("xlsx");
const { seedReference } = require("../netlify/lib/domain");
const { createMemoryStore } = require("../netlify/lib/memory-store");
const { signSession } = require("../netlify/lib/session");
const { createMemoryStorage } = require("../netlify/lib/sheet-import");
const { reconciliation } = require("../scripts/import/reconcile");
const { handler } = require("../netlify/functions/sheet-import");

process.env.FINANCE_SESSION_SECRET = process.env.FINANCE_SESSION_SECRET || "sheet-import-test";

function workbook(sheets) {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet.rows), String(sheet.name).slice(0, 31));
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

function pettyRows(expense) {
  return [
    ["PCB 2026-35"],
    ["REFERENCE NO", "DATE", "C/O", "SUPPLIER", "DESCRIPTION", "Project", "Cash", "Release Amount", "Actual Amount"],
    ["Opening balance", 10000],
    ["", "not-a-date", "", "", "", "", "", "", ""],
    ["", "2026-09-01", "", "", "Top up", "", 80000, "", ""],
    ["PC2026-0001", "2026-09-02", "", "Cash", "Supplies", "", "", "", expense],
    ["", "2026-09-03", "", "", "Open release", "", "", 24315, ""],
  ];
}

function books(expense) {
  return {
    petty: workbook([{ name: "PCB", rows: pettyRows(expense) }]),
    checks: workbook([{
      name: "BPI",
      rows: [
        ["Check No", "Check Date", "Payee", "Amount"],
        ["BPI2026-100", "2026-09-30", "Suppliers", 11553814.54],
      ],
    }]),
    gcash: workbook([{
      name: "GCash",
      rows: [
        ["BATCH 1"],
        ["REF", "DATE", "C/O", "SUPPLIER", "DESCRIPTION", "PROJECT", "AMOUNT", "FEE"],
        ["Opening", 30000],
        ["2026Gcash-0001", "2026-09-04", "", "Cash", "Loads", "", 28605.89, 0],
      ],
    }]),
    bills: workbook([{
      name: "Bills",
      rows: [
        ["Site", "Biller", "Jan", "Feb", "Mar"],
        ["Office", "Meralco", 100, 200, 300],
      ],
    }]),
  };
}

async function setup() {
  const store = createMemoryStore();
  await seedReference(store);
  return { store, storage: createMemoryStorage() };
}

function call(store, storage, op, body, role) {
  const token = signSession({
    role: role || "admin",
    email: "admin@example.com",
    name: "Admin",
    exp: Date.now() + 60 * 60 * 1000,
  });
  return handler(
    {
      httpMethod: "POST",
      headers: { cookie: `finance_session=${encodeURIComponent(token)}` },
      body: JSON.stringify(Object.assign({ op }, body || {})),
    },
    { store, storage }
  ).then((res) => ({ status: res.statusCode, json: JSON.parse(res.body || "{}") }));
}

async function upload(store, storage, jobId, kind, buffer) {
  const mid = Math.max(1, Math.floor(buffer.length / 2));
  const parts = [buffer.subarray(0, mid), buffer.subarray(mid)].filter((part) => part.length);
  for (let index = 0; index < parts.length; index += 1) {
    const res = await call(store, storage, "importStage", {
      jobId,
      kind,
      index,
      total: parts.length,
      dataBase64: parts[index].toString("base64"),
    });
    assert.equal(res.status, 200, res.json.error || "");
  }
}

async function finish(store, storage, job) {
  let guard = 0;
  while (job.status === "running" && guard < 500) {
    const res = await call(store, storage, "importTick", { jobId: job.id, chunkSize: 1 });
    assert.equal(res.status, 200, res.json.error || "");
    job = res.json.job;
    guard += 1;
  }
  assert.equal(job.status, "done", job.error || "");
  assert.ok(guard >= 1);
  return job;
}

describe("google sheet import", () => {
  it("dry-runs the four workbooks without writing, then imports in chunks and updates on a second run", async () => {
    const { store, storage } = await setup();
    const started = await call(store, storage, "importStart", { year: 2026 });
    assert.equal(started.status, 200, started.json.error || "");
    const jobId = started.json.job.id;
    const first = books(37443);
    for (const kind of Object.keys(first)) await upload(store, storage, jobId, kind, first[kind]);
    assert.equal((await store.list("petty_vouchers")).length, 0);
    assert.equal((await store.list("import_issues")).length, 0);

    const preview = await call(store, storage, "importDryRun", { jobId, year: 2026 });
    assert.equal(preview.status, 200, preview.json.error || "");
    const report = preview.json.job.report;
    assert.equal(report.reconciliation.pcb35.matches, true);
    assert.equal(report.reconciliation.pcb35.cashOnHand, 28242);
    assert.equal(report.reconciliation.pcb35.openReleases, 24315);
    assert.equal(report.reconciliation.gcash.matches, true);
    assert.equal(report.reconciliation.gcash.balance, 1394.11);
    assert.equal(report.reconciliation.sept2026.matches, true);
    assert.equal(report.reconciliation.sept2026.total, 11553814.54);
    const vouchers = report.counts.find((row) => row.table === "petty_vouchers");
    const checks = report.counts.find((row) => row.table === "checks");
    const expenses = report.counts.find((row) => row.table === "wallet_expenses");
    const months = report.counts.find((row) => row.table === "checklist_instances");
    assert.equal(vouchers.create, 1);
    assert.equal(vouchers.update, 0);
    assert.equal(checks.create, 1);
    assert.equal(expenses.create, 1);
    assert.equal(months.create, 3);
    assert.ok(report.issueCount >= 1);
    assert.equal((await store.list("petty_vouchers")).length, 0);
    assert.equal((await store.list("checks")).length, 0);

    const csv = await call(store, storage, "importIssuesCsv", { jobId });
    assert.equal(csv.status, 200);
    assert.match(csv.json.csv, /source,sheet,row_no,field,raw,message/);
    assert.match(csv.json.csv, /Could not read the date/);
    assert.match(csv.json.filename, /import-issues-/);

    const committed = await call(store, storage, "importCommit", { jobId, chunkSize: 1 });
    assert.equal(committed.status, 200, committed.json.error || "");
    assert.equal(committed.json.job.cursor, 1);
    assert.ok(committed.json.job.total > 1);
    await finish(store, storage, committed.json.job);

    const live = await reconciliation(store);
    assert.equal(live.pcb35.cashOnHand, 28242);
    assert.equal(live.pcb35.openReleases, 24315);
    assert.equal(live.gcash.balance, 1394.11);
    assert.equal(live.sept2026.total, 11553814.54);
    assert.equal((await store.list("petty_vouchers")).length, 1);
    assert.equal((await store.list("checks")).length, 1);
    const issueCount = (await store.list("import_issues")).length;
    assert.ok(issueCount >= 1);

    const again = await call(store, storage, "importStart", { year: 2026 });
    const secondId = again.json.job.id;
    const second = books(100);
    await upload(store, storage, secondId, "petty", second.petty);
    const secondPreview = await call(store, storage, "importDryRun", { jobId: secondId, year: 2026 });
    assert.equal(secondPreview.status, 200, secondPreview.json.error || "");
    const secondVouchers = secondPreview.json.job.report.counts.find((row) => row.table === "petty_vouchers");
    assert.equal(secondVouchers.create, 0);
    assert.equal(secondVouchers.update, 1);
    assert.equal(secondPreview.json.job.report.reconciliation.gcash.included, false);
    assert.equal(secondPreview.json.job.report.reconciliation.sept2026.included, false);
    const secondCommit = await call(store, storage, "importCommit", { jobId: secondId, chunkSize: 1 });
    await finish(store, storage, secondCommit.json.job);
    const rows = await store.list("petty_vouchers");
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].amount), 100);
    assert.equal((await store.list("checks")).length, 1);
    assert.equal((await store.list("import_issues")).length, issueCount);
  });

  it("refuses a finance user and keeps the import migration service-role only", async () => {
    const { store, storage } = await setup();
    const denied = await call(store, storage, "importStart", {}, "finance");
    assert.equal(denied.status, 403);
    assert.match(denied.json.error, /administrator/);
    const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261010000004_finance_sheet_import.sql"), "utf8");
    assert.match(sql, /finance_import_jobs/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /service_role/);
    assert.doesNotMatch(sql, /drop table/i);
    const page = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(page, /const BUILD = "2026-10-10 f"/);
    assert.ok(page.indexOf("finance-import.js") < page.indexOf("finance-app.js"));
    const code = fs.readFileSync(path.join(__dirname, "../public/finance-import.js"), "utf8");
    const sandbox = {
      window: {},
      document: {
        addEventListener() {},
        getElementById() { return { textContent: "" }; },
        querySelector() { return null; },
        createElement() { return { click() {} }; },
      },
      console,
      fetch() { return Promise.resolve({ ok: true, text: () => Promise.resolve("{}") }); },
      URL: { createObjectURL() { return ""; } },
      Blob: function Blob() {},
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const html = sandbox.window.FinanceImport.render({
      me: { role: "admin" },
      sheetImport: {
        year: 2026,
        names: { petty: "CCD-03.xlsx" },
        job: {
          id: "job-1",
          status: "ready",
          files: [{ kind: "petty", received: 1, total: 1, ready: true }],
          report: {
            counts: [{ table: "checks", label: "Checks", rows: 1, create: 1, update: 0 }],
            reconciliation: {
              pcb35: { included: true, matches: true, cashOnHand: 28242, openReleases: 24315, targetCash: 28242, targetOpen: 24315 },
              gcash: { included: true, matches: true, balance: 1394.11, target: 1394.11 },
              sept2026: { included: true, matches: true, total: 11553814.54, target: 11553814.54 },
            },
            issues: [{ source: "petty", row_no: 4, field: "date", raw: "not-a-date", message: "Could not read the date." }],
            issueCount: 1,
          },
        },
      },
    });
    assert.match(html, /CCD-03 Petty Cash/);
    assert.match(html, /CCD-04 Check Monitoring/);
    assert.match(html, /GCash monitoring/);
    assert.match(html, /Bill Paying Checklist/);
    assert.match(html, /Dry run/);
    assert.match(html, />Import</);
    assert.match(html, /PCB 35/);
    assert.match(html, /₱28,242\.00/);
    assert.match(html, /₱1,394\.11/);
    assert.match(html, /₱11,553,814\.54/);
    assert.match(html, /Download issues CSV/);
    assert.match(html, /Already there/);
    const hidden = sandbox.window.FinanceImport.render({ me: { role: "finance", department: "finance" } });
    assert.match(hidden, /Only an administrator can import the Google Sheets/);
    const app = fs.readFileSync(path.join(__dirname, "../public/finance-app.js"), "utf8");
    assert.match(app, /\["imports", "Import"\]/);
  });
});
