"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  dedupeSuppliers,
  mapHrAdvance,
  mapMotorpoolReserve,
  mapMotorpoolSuppliers,
} = require("../netlify/lib/adapters");
const { canAccessFinance } = require("../netlify/lib/access");
const { approverPasswordOk } = require("../netlify/lib/approver-password");
const { assertRecordId, rejectBlob } = require("../netlify/lib/collections");
const { renderDvPdf } = require("../netlify/lib/pdf");
const { signSession, verifySession } = require("../netlify/lib/session");

const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("finance access and records", () => {
  it("lets admin and finance in, and keeps other departments out", () => {
    assert.equal(canAccessFinance({ role: "admin", department: "hr" }), true);
    assert.equal(canAccessFinance({ role: "dept_lead", department: "finance" }), true);
    assert.equal(canAccessFinance({ role: "staff", department: "finance" }), true);
    assert.equal(canAccessFinance({ role: "finance", department: "admin" }), true);
    assert.equal(canAccessFinance({ role: "staff", department: "site" }), false);
    assert.equal(canAccessFinance(null), false);
  });

  it("signs a session cookie the server can read back", () => {
    process.env.FINANCE_SESSION_SECRET = "test-secret";
    const token = signSession({ sub: "user-1", email: "finance@example.com", role: "dept_lead", department: "finance" });
    const session = verifySession(token);
    assert.equal(session.email, "finance@example.com");
    assert.equal(verifySession(token + "x"), null);
  });

  it("checks the approver page password and honors an override", () => {
    delete process.env.FINANCE_APPROVER_PASSWORD;
    assert.equal(approverPasswordOk("032589"), true);
    assert.equal(approverPasswordOk("wrong"), false);
    process.env.FINANCE_APPROVER_PASSWORD = "site-only";
    assert.equal(approverPasswordOk("site-only"), true);
    assert.equal(approverPasswordOk("032589"), false);
    delete process.env.FINANCE_APPROVER_PASSWORD;
  });

  it("refuses a whole year or a rows blob", () => {
    assert.throws(() => assertRecordId("2026"), /one record at a time/);
    assert.throws(() => assertRecordId("2026-10"), /one record at a time/);
    assert.throws(() => rejectBlob({ rows: [{ id: 1 }, { id: 2 }] }), /one record/);
    assert.equal(assertRecordId("dv-1"), "dv-1");
  });

  it("reads an HR cash advance and a Motorpool reserve without inventing writes", () => {
    const advance = mapHrAdvance({
      id: "doc-1",
      data: {
        id: "ca1",
        no: "CAF2026-0012",
        empId: "e1",
        receivedBy: "Ana Cruz",
        amount: 5000,
        purpose: "Materials",
        project: "Tower A",
        status: "Released",
        liquidations: [{ amount: 2000 }],
        deducted: 500,
      },
    });
    assert.equal(advance.number, "CAF2026-0012");
    assert.equal(advance.balance, 2500);
    assert.equal(advance.readOnly, true);

    const reserve = mapMotorpoolReserve({
      id: "reserve:12",
      reserve_no: "12",
      data: {
        no: "12",
        vrfNo: "5881",
        status: "Approved",
        project: "Tower A",
        approvedBudget: 3200,
        lines: [{ supplier: "Shell", qty: 1, price: 3200, total: 3200 }],
      },
    });
    assert.equal(reserve.number, "5881");
    assert.equal(reserve.supplier, "Shell");
    assert.equal(reserve.amount, 3200);
    assert.equal(reserve.readOnly, true);
  });

  it("dedupes Motorpool suppliers and skips the reserved labels", () => {
    const motorpool = mapMotorpoolSuppliers({
      data: { suppliers: ["ABC Trading", { name: "ABC Trading" }, "MOTORPOOL INVENTORY", "Shell"] },
    });
    assert.deepEqual(motorpool.map((row) => row.name), ["ABC Trading", "Shell"]);
    const merged = dedupeSuppliers(
      [{ id: "s1", name: "ABC Trading", name_key: "abc trading", tin: "123", active: true, motorpool_key: "abc trading" }],
      motorpool
    );
    assert.equal(merged.length, 2);
    const abc = merged.find((row) => row.name === "ABC Trading");
    assert.equal(abc.readOnly, false);
    assert.equal(abc.motorpoolLinked, true);
    assert.equal(merged.find((row) => row.name === "Shell").readOnly, true);
  });

  it("stamps e-signatures on the voucher PDF and names a missing one", async () => {
    const voucher = {
      dv_no: "DV2026-0001",
      status: "Approved",
      payee: "ABC Trading",
      project_name: "Tower A",
      particulars: "Cement",
      account_code: "5100",
      account_name: "Materials",
      amount: 1000,
      vat_amount: 0,
      ewt_amount: 0,
      net_amount: 1000,
      prepared_by: "Finance Officer",
      checked_by: "Evaluator",
      approved_by: "Jeffrey Corro",
    };
    const signs = [
      { slot: "prepared", person_name: "Finance Officer", image_data: SIG },
      { slot: "checked", person_name: "Evaluator", image_data: SIG },
      { slot: "approved", person_name: "Jeffrey Corro", image_data: "" },
    ];
    await assert.rejects(() => renderDvPdf(voucher, signs), /Jeffrey Corro/);
    signs[2].image_data = SIG;
    const bytes = await renderDvPdf({ ...voucher, status: "Draft" }, signs);
    assert.equal(Buffer.from(bytes).slice(0, 4).toString(), "%PDF");
  });

  it("keeps the migration additive, prefixed, and service-role only", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/20261010000001_finance_schema.sql"),
      "utf8"
    );
    assert.match(sql, /finance_take_number/);
    assert.match(sql, /lpad\(n::text, 4, '0'\)/);
    assert.match(sql, /unique \(year, seq\)/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /grant all on table public\.%I to service_role/);
    assert.match(sql, /finance-uploads/);
    assert.match(sql, /finance_contracts/);
    assert.match(sql, /finance_petty_funds/);
    assert.match(sql, /finance_bank_lines/);
    assert.match(sql, /on conflict \(id\) do nothing/);
    assert.doesNotMatch(sql, /drop table/i);
    assert.doesNotMatch(sql, /motorpool_docs/);
    assert.doesNotMatch(sql, /update public\.docs/);
    const store = fs.readFileSync(path.join(__dirname, "../netlify/lib/supabase-store.js"), "utf8");
    const external = store.slice(store.indexOf("external:"), store.indexOf("async function readDocs"));
    assert.doesNotMatch(external, /POST|PATCH|DELETE/);
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /const BUILD = "2026-10-10 a"/);
    assert.match(html, /claude-shim\.js/);
    assert.match(html, /buildBanner/);
    const app = fs.readFileSync(path.join(__dirname, "../public/finance-app.js"), "utf8");
    assert.match(app, /COMING SOON/);
    assert.match(app, /Approver/);
    assert.match(app, /₱/);
  });
});
