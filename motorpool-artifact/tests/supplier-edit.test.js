"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { applyApproveFromHold } = require("../netlify/lib/approve-from-hold");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  let start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  if (src.slice(start - 6, start) === "async ") start -= 6;
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

function loadEdit() {
  const names = [
    "lineIdentity",
    "supplierStatusKey",
    "supplierEditAllowed",
    "supplierEditShape",
    "shownReserveSupplier",
    "supplierChangeText",
    "draftLineIndexForRow",
    "planSupplierEdit",
    "applySupplierEdit",
    "auditLineText",
  ];
  const ctx = {};
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function hold(over) {
  return Object.assign(
    {
      no: "12",
      vrfNo: "5812",
      status: "Requested",
      budget: 700,
      draftOdo: "10500",
      fuelPrevNote: "Previous fuel: 2026-09-01 · VRF 5800 · 40.00 L · odometer 10,000 km",
      approvedBy: "",
      approvedAt: "",
      approvedBudget: null,
      decisionNote: "",
      draftLines: [
        { cat: "Fuel — Diesel", item: "Fuel", supplier: "Petron", qty: 10, price: 50, unit: "L", work: "FUEL-STN" },
        { cat: "Belt", item: "Fan belt", supplier: "Auto Parts", qty: 1, price: 200, unit: "pc", work: "REP" },
      ],
    },
    over || {}
  );
}

describe("edit supplier before approval", () => {
  it("is build 2026-10-22 b", () => {
    assert.match(html, /var BUILD = "2026-10-22 b"/);
  });

  it("offers Edit supplier on a VRF that is still for approval", () => {
    assert.match(html, /Edit supplier/);
    assert.match(html, /data-edit-supplier/);
    assert.match(html, /data-supplier-change/);
    assert.match(html, /function supplierEditAllowed/);
    assert.match(html, /function planSupplierEdit/);
    assert.match(html, /Supplier change/);
  });

  it("changes one line and leaves the VRF pending", () => {
    const api = loadEdit();
    const row = hold();
    const beforeNote = row.fuelPrevNote;
    const plan = api.planSupplierEdit(row, {
      by: "Bea Cruz",
      at: "2026-10-21",
      lines: [{ index: 0, supplier: "Shell" }],
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.changed, true);
    assert.equal(row.status, "Requested");
    assert.equal(row.vrfNo, "5812");
    assert.equal(row.draftLines[0].supplier, "Petron");
    api.applySupplierEdit(row, plan);
    assert.equal(row.status, "Requested");
    assert.equal(row.vrfNo, "5812");
    assert.equal(row.fuelPrevNote, beforeNote);
    assert.equal(row.draftOdo, "10500");
    assert.equal(row.budget, 700);
    assert.equal(row.approvedBy, "");
    assert.equal(row.approvedAt, "");
    assert.equal(row.approvedBudget, null);
    assert.equal(row.decisionNote, "");
    assert.equal(row.draftLines[0].supplier, "Shell");
    assert.equal(row.draftLines[0].qty, 10);
    assert.equal(row.draftLines[0].price, 50);
    assert.equal(row.draftLines[1].supplier, "Auto Parts");
    assert.equal(row.audit.length, 1);
    assert.equal(row.audit[0].field, "supplier");
    const text = api.supplierChangeText(row.audit[0]);
    assert.match(text, /Petron → Shell/);
    assert.match(text, /Bea Cruz/);
    assert.match(text, /2026-10-21/);
    assert.match(text, /Fuel/);
    assert.equal(api.auditLineText(row.audit[0]), text);
    assert.equal(api.shownReserveSupplier(row), "Shell, Auto Parts");
    assert.equal(api.supplierEditShape(row).mode, "line");
  });

  it("edits the VRF supplier when the lines do not carry one", () => {
    const api = loadEdit();
    const row = hold({
      draftLines: [],
      supplier: "Petron",
    });
    assert.equal(api.supplierEditShape(row).mode, "vrf");
    const plan = api.planSupplierEdit(row, { by: "Ana", at: "2026-10-21", supplier: "Shell" });
    assert.equal(plan.ok, true);
    api.applySupplierEdit(row, plan);
    assert.equal(row.supplier, "Shell");
    assert.equal(row.status, "Requested");
    assert.equal(row.vrfNo, "5812");
    assert.match(row.fuelPrevNote, /Previous fuel: 2026-09-01/);
    assert.match(api.supplierChangeText(row.audit[0]), /Petron → Shell · Ana · 2026-10-21/);
    assert.equal(api.shownReserveSupplier(row), "Shell");
  });

  it("allows drafts and for-approval, and locks the filed statuses", () => {
    const api = loadEdit();
    ["", "Draft", "draft printed", "Requested", "FOR APPROVAL", "Sent for approval", "pending"].forEach((st) => {
      const row = hold({ status: st });
      assert.equal(api.supplierEditAllowed(row), true, st || "(blank)");
    });
    ["Approved", "Open", "Open — awaiting liquidation", "Liquidated", "Filed", "Cancelled", "Closed", "Rejected"].forEach((st) => {
      const row = hold({ status: st });
      const copy = JSON.parse(JSON.stringify(row));
      const plan = api.planSupplierEdit(row, {
        by: "Bea",
        at: "2026-10-21",
        lines: [{ index: 0, supplier: "Shell" }],
      });
      assert.equal(plan.ok, false, st);
      assert.equal(plan.code, "locked", st);
      assert.deepEqual(row, copy);
    });
    const cancelled = hold({ cancelledAt: "2026-10-21" });
    assert.equal(api.supplierEditAllowed(cancelled), false);
    const liquidated = hold({ liquidatedAt: "2026-10-21" });
    assert.equal(api.supplierEditAllowed(liquidated), false);
  });

  it("refuses a blank name or a blank supplier without writing", () => {
    const api = loadEdit();
    const row = hold();
    const copy = JSON.parse(JSON.stringify(row));
    const unnamed = api.planSupplierEdit(row, { lines: [{ index: 0, supplier: "Shell" }] });
    assert.equal(unnamed.code, "name");
    const blank = api.planSupplierEdit(row, { by: "Bea", lines: [{ index: 0, supplier: "  " }] });
    assert.equal(blank.code, "blank");
    assert.deepEqual(row, copy);
  });

  it("posts the new supplier through approve and keeps the previous-fuel note", () => {
    const api = loadEdit();
    const row = hold({ date: "2026-09-21", veh: "DT-09" });
    const note = row.fuelPrevNote;
    const plan = api.planSupplierEdit(row, {
      by: "Bea Cruz",
      at: "2026-10-21",
      lines: [{ index: 0, supplier: "Shell" }],
    });
    api.applySupplierEdit(row, plan);
    assert.equal(row.status, "Requested");
    const result = applyApproveFromHold(
      { ledgerRows: [], reserves: [], vehicles: [], parts: [] },
      row,
      { approvedBy: "Jeffrey", now: "2026-10-21" }
    );
    assert.equal(result.hold.vrfNo, "5812");
    assert.equal(result.rows[0].vrf, "5812");
    assert.equal(result.rows[0].supplier, "Shell");
    assert.equal(result.rows[1].supplier, "Auto Parts");
    assert.equal(result.rows[0].fuelPrevNote, note);
    assert.equal(result.hold.fuelPrevNote, note);
    assert.ok(result.hold.audit.some((n) => n.field === "supplier" && n.from === "Petron" && n.to === "Shell"));
    assert.equal(result.rows[0].vstatus, "Open");
  });
});
