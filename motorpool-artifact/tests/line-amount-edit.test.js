"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { applyApproveFromHold } = require("../netlify/lib/approve-from-hold");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const PREV = "Previous fuel: 2026-09-01 · VRF 5800 · 40.00 L · odometer 10,000 km";

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
    "moneyNum",
    "lineMoney",
    "vrfSpendTotal",
    "isFuel",
    "isFuelWorkCode",
    "fuelLitresOf",
    "fuelFillLitresOf",
    "supplierStatusKey",
    "supplierEditAllowed",
    "supplierChangeText",
    "moneyRound",
    "priceFromAmount",
    "isLitreUnit",
    "lineIsFuelSpend",
    "reserveFuelLitres",
    "amountAuditField",
    "formatAmountAudit",
    "amountSame",
    "pendingAmountText",
    "lineAmountLabel",
    "amountEditShape",
    "pushAmountNote",
    "draftFuelMeta",
    "planLineAmountEdit",
    "applyLineAmountEdit",
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
      veh: "DT-09",
      date: "2026-10-02",
      work: "FUEL-STN",
      kind: "fuel-bulk",
      budget: 700,
      litres: 10,
      pricePerL: 50,
      draftOdo: "10500",
      fuelPrevNote: PREV,
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

function apply(api, row, spec) {
  const plan = api.planLineAmountEdit(row, spec);
  if (plan.ok && plan.changed) api.applyLineAmountEdit(row, plan);
  return plan;
}

describe("edit quantity and amount before approval", () => {
  it("is build 2026-10-29 c", () => {
    assert.match(html, /var BUILD = "2026-10-29 c"/);
  });

  it("offers Edit amount on a VRF that is still for approval", () => {
    assert.match(html, /Edit amount/);
    assert.match(html, /data-edit-amount/);
    assert.match(html, /data-amount-change/);
    assert.match(html, /function planLineAmountEdit/);
    assert.match(html, /function applyLineAmountEdit/);
    assert.match(html, /Amount change/);
    assert.match(html, /var fuelAsked=reserveFuelLitres\(r\)/);
    assert.match(html, /fuelCheck\(r\.veh,meterAll,fuelAsked\)/);
    assert.match(html, /rsvKind\(r\)==="fuel-issue"\|\|rsvKind\(r\)==="fuel-bulk"/);
    assert.match(html, /fuelUsageNote\(r\.veh, reserveMeter\(r\), asked\)/);
    assert.match(extractFunction(html, "planLineAmountEdit"), /supplierEditAllowed/);
    assert.doesNotMatch(extractFunction(html, "applyLineAmountEdit"), /applyVrfAutoApproval/);
  });

  it("changes one line's qty and price, recomputes the total, and stays pending", () => {
    const api = loadEdit();
    const row = hold();
    const plan = apply(api, row, {
      by: "Bea Cruz",
      at: "2026-10-22",
      lines: [{ index: 0, qty: 12, price: 55, amount: 660 }],
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.changed, true);
    assert.equal(row.status, "Requested");
    assert.equal(row.vrfNo, "5812");
    assert.equal(row.fuelPrevNote, PREV);
    assert.equal(row.draftOdo, "10500");
    assert.equal(row.approvedBy, "");
    assert.equal(row.approvedAt, "");
    assert.equal(row.approvedBudget, null);
    assert.equal(row.decisionNote, "");
    assert.equal(row.draftLines[0].qty, 12);
    assert.equal(row.draftLines[0].price, 55);
    assert.equal(row.draftLines[0].total, 660);
    assert.equal(row.draftLines[0].liters, 12);
    assert.equal(row.draftLines[0].supplier, "Petron");
    assert.equal(row.draftLines[1].qty, 1);
    assert.equal(row.draftLines[1].price, 200);
    assert.equal(row.draftLines[1].supplier, "Auto Parts");
    assert.equal(row.budget, 860);
    assert.equal(row.litres, 12);
    assert.equal(row.pricePerL, 55);
    assert.equal(api.fuelFillLitresOf(row), 12);
    assert.equal(api.reserveFuelLitres(row), 12);
    const fields = row.audit.map((n) => n.field + ":" + n.note);
    assert.ok(fields.indexOf("qty:Line 1 · Fuel") >= 0);
    assert.ok(fields.indexOf("price:Line 1 · Fuel") >= 0);
    assert.ok(fields.indexOf("amount:Line 1 · Fuel") >= 0);
    assert.ok(fields.indexOf("amount:VRF total") >= 0);
    assert.equal(row.audit.some((n) => n.field === "liters"), false);
    const price = row.audit.filter((n) => n.field === "price")[0];
    const text = api.pendingAmountText(price);
    assert.equal(text, "Line 1 · Fuel · price 50.00 → 55.00 · Bea Cruz · 2026-10-22");
    assert.equal(api.auditLineText(price), text);
    const total = row.audit.filter((n) => n.note === "VRF total")[0];
    assert.match(api.pendingAmountText(total), /amount 700\.00 → 860\.00/);
    assert.equal(row.budget < 1000, true);
    const supplier = { field: "supplier", from: "Petron", to: "Shell", by: "Bea Cruz", at: "2026-10-21", note: "Line 1 · Fuel" };
    assert.equal(api.auditLineText(supplier), api.supplierChangeText(supplier));
  });

  it("keeps a separate litres field from changing the quantity", () => {
    const api = loadEdit();
    const row = hold({
      budget: 2700,
      litres: 40,
      pricePerL: 62.5,
      draftLines: [
        { cat: "Fuel — Diesel", item: "Fuel", supplier: "Petron", qty: 1, price: 2500, unit: "pc", liters: 40, work: "FUEL-STN" },
        { cat: "Belt", item: "Fan belt", supplier: "Auto Parts", qty: 1, price: 200, unit: "pc", work: "REP" },
      ],
    });
    const plan = apply(api, row, {
      by: "Bea Cruz",
      at: "2026-10-22",
      lines: [{ index: 0, qty: 1, price: 2500, amount: 2500, liters: 48 }],
    });
    assert.equal(plan.ok, true);
    assert.equal(row.status, "Requested");
    assert.equal(row.vrfNo, "5812");
    assert.equal(row.fuelPrevNote, PREV);
    assert.equal(row.draftLines[0].qty, 1);
    assert.equal(row.draftLines[0].price, 2500);
    assert.equal(row.draftLines[0].total, 2500);
    assert.equal(row.draftLines[0].liters, 48);
    assert.equal(row.draftLines[1].qty, 1);
    assert.equal(row.budget, 2700);
    assert.equal(row.litres, 48);
    assert.equal(Math.round(row.pricePerL * 10000), 520833);
    assert.equal(api.fuelFillLitresOf(row), 48);
    assert.equal(api.reserveFuelLitres(row), 48);
    const note = row.audit.filter((n) => n.field === "liters")[0];
    assert.equal(api.pendingAmountText(note), "Line 1 · Fuel · litres 40 → 48 · Bea Cruz · 2026-10-22");
    assert.equal(row.audit.some((n) => n.field === "qty"), false);
    assert.equal(row.audit.some((n) => n.note === "VRF total"), false);
  });

  it("does not approve when the new total drops under 1000", () => {
    const api = loadEdit();
    const row = hold({
      budget: 1500,
      draftLines: [
        { cat: "Fuel — Diesel", item: "Fuel", supplier: "Petron", qty: 10, price: 130, unit: "L", work: "FUEL-STN" },
        { cat: "Belt", item: "Fan belt", supplier: "Auto Parts", qty: 1, price: 200, unit: "pc", work: "REP" },
      ],
    });
    apply(api, row, {
      by: "Bea Cruz",
      at: "2026-10-22",
      lines: [{ index: 0, qty: 10, price: 50, amount: 500 }],
    });
    assert.equal(row.budget, 700);
    assert.equal(row.status, "Requested");
    assert.equal(row.approvedBy, "");
    assert.equal(row.approvedAt, "");
    assert.equal(row.approvedBudget, null);
    assert.equal(row.decisionNote, "");
    assert.equal(row.vrfNo, "5812");
    assert.equal(row.fuelPrevNote, PREV);
  });

  it("locks filed statuses and rejects a blank name or a zero amount", () => {
    const api = loadEdit();
    ["", "Draft", "draft printed", "Requested", "FOR APPROVAL", "Sent for approval", "pending"].forEach((st) => {
      const row = hold({ status: st });
      const plan = api.planLineAmountEdit(row, {
        by: "Bea",
        at: "2026-10-22",
        lines: [{ index: 0, qty: 12, price: 50, amount: 600 }],
      });
      assert.equal(plan.ok, true, st || "(blank)");
    });
    ["Approved", "Open", "Liquidated", "Filed", "Cancelled", "Closed"].forEach((st) => {
      const row = hold({ status: st });
      const copy = JSON.parse(JSON.stringify(row));
      const plan = api.planLineAmountEdit(row, {
        by: "Bea",
        at: "2026-10-22",
        lines: [{ index: 0, qty: 12, price: 55, amount: 660 }],
      });
      assert.equal(plan.ok, false, st);
      assert.equal(plan.code, "locked", st);
      api.applyLineAmountEdit(row, plan);
      assert.deepEqual(row, copy);
    });
    const row = hold();
    const copy = JSON.parse(JSON.stringify(row));
    assert.equal(api.planLineAmountEdit(row, { lines: [{ index: 0, qty: 12, price: 55, amount: 660 }] }).code, "name");
    assert.equal(api.planLineAmountEdit(row, { by: "Bea", lines: [{ index: 0, qty: 0, price: 55, amount: 0 }] }).code, "zero");
    assert.equal(api.planLineAmountEdit(row, { by: "Bea", lines: [{ index: 0, qty: 12, price: 0, amount: 0 }] }).code, "zero");
    const same = api.planLineAmountEdit(row, { by: "Bea", at: "2026-10-22", lines: [{ index: 0, qty: 10, price: 50, amount: 500 }] });
    assert.equal(same.changed, false);
    api.applyLineAmountEdit(row, same);
    assert.deepEqual(row, copy);
  });

  it("posts the edited qty, price, and amount through approve and keeps the previous-fuel note", () => {
    const api = loadEdit();
    const row = hold();
    apply(api, row, {
      by: "Bea Cruz",
      at: "2026-10-22",
      lines: [{ index: 0, qty: 12, price: 55, amount: 660, liters: 12 }],
    });
    assert.equal(row.status, "Requested");
    const result = applyApproveFromHold(
      { ledgerRows: [], reserves: [], vehicles: [], parts: [] },
      row,
      { approvedBy: "Jeffrey", now: "2026-10-22" }
    );
    assert.equal(result.hold.vrfNo, "5812");
    assert.equal(result.rows[0].vrf, "5812");
    assert.equal(result.rows[0].qty, 12);
    assert.equal(result.rows[0].price, 55);
    assert.equal(result.rows[0].total, 660);
    assert.equal(result.rows[0].liters, 12);
    assert.equal(result.rows[0].supplier, "Petron");
    assert.equal(result.rows[1].qty, 1);
    assert.equal(result.rows[1].price, 200);
    assert.equal(result.rows[1].total, 200);
    assert.equal(result.rows[0].fuelPrevNote, PREV);
    assert.equal(result.hold.fuelPrevNote, PREV);
    assert.equal(result.rows[0].vstatus, "Open");
    assert.ok(result.hold.audit.some((n) => n.field === "price" && n.from === "50.00" && n.to === "55.00"));
  });
});
