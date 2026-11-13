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
    "isFuel",
    "fuelLitersMissing",
    "fuelQtyNum",
    "normalizeFuelLine",
    "moneyNum",
    "lineMoney",
    "moneyRound",
    "vrfSpendTotal",
    "isFuelWorkCode",
    "fuelLitresOf",
    "supplierStatusKey",
    "priceFromAmount",
    "isLitreUnit",
    "lineIsFuelSpend",
    "amountAuditField",
    "formatAmountAudit",
    "amountSame",
    "pendingAmountText",
    "lineAmountLabel",
    "pushAmountNote",
    "draftFuelMeta",
    "lineItemDecided",
    "lineItemEditAllowed",
    "itemAuditField",
    "lineItemChangeText",
    "pushTextNote",
    "lineItemMoney",
    "planLineItemEdit",
    "applyLineItemEdit",
    "auditLineText",
    "supplierChangeText",
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
      work: "REP",
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
  const plan = api.planLineItemEdit(row, spec);
  if (plan.ok && plan.changed) api.applyLineItemEdit(row, plan);
  return plan;
}

describe("edit item and part category before approval", () => {
  it("is build 2026-11-13 a", () => {
    assert.match(html, /var BUILD = "2026-11-13 a"/);
  });

  it("offers Edit item while a VRF is still for approval and locks it after", () => {
    assert.match(html, /Edit item/);
    assert.match(html, /data-edit-item/);
    assert.match(html, /data-item-change/);
    assert.match(html, /data-item-locked/);
    assert.match(html, /data-item-vrf-total/);
    assert.match(html, /function lineItemEditAllowed/);
    assert.match(html, /function planLineItemEdit/);
    assert.match(html, /function applyLineItemEdit/);
    assert.match(html, /function openLineItemEdit/);
    assert.match(html, /Item change/);
    assert.match(html, /data-fuel-unit","locked"/);
    assert.match(extractFunction(html, "planLineItemEdit"), /lineItemEditAllowed/);
    assert.doesNotMatch(extractFunction(html, "planLineItemEdit"), /applyVrfAutoApproval/);
    assert.doesNotMatch(extractFunction(html, "applyLineItemEdit"), /applyVrfAutoApproval/);
    assert.match(extractFunction(html, "vrfMayEdit"), /st==="Open"\|\|st==="Requested"\|\|st==="Closed"/);
  });

  it("changes the item name and part category, writes the audit, and stays pending", () => {
    const api = loadEdit();
    const row = hold();
    const plan = apply(api, row, {
      by: "Bea Cruz",
      at: "2026-11-05",
      lines: [{ index: 1, item: "Alternator belt", cat: "Fan / Belt / Pumps", qty: 1, price: 200, amount: 200 }],
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
    assert.equal(row.draftLines[1].item, "Alternator belt");
    assert.equal(row.draftLines[1].cat, "Fan / Belt / Pumps");
    assert.equal(row.draftLines[1].supplier, "Auto Parts");
    assert.equal(row.draftLines[1].qty, 1);
    assert.equal(row.draftLines[1].price, 200);
    assert.equal(row.draftLines[1].unit, "pc");
    assert.equal(row.draftLines[0].item, "Fuel");
    assert.equal(row.draftLines[0].cat, "Fuel — Diesel");
    assert.equal(row.draftLines[0].unit, "L");
    assert.equal(row.draftLines[0].price, 50);
    assert.equal(row.budget, 700);
    const item = row.audit.filter((n) => n.field === "item")[0];
    const cat = row.audit.filter((n) => n.field === "cat")[0];
    assert.equal(item.by, "Bea Cruz");
    assert.equal(item.at, "2026-11-05");
    assert.equal(item.from, "Fan belt");
    assert.equal(item.to, "Alternator belt");
    assert.match(item.note, /Line 2/);
    assert.equal(cat.field, "cat");
    assert.equal(cat.from, "Belt");
    assert.equal(cat.to, "Fan / Belt / Pumps");
    assert.equal(api.lineItemChangeText(item), "Line 2 · Fan belt · item Fan belt → Alternator belt · Bea Cruz · 2026-11-05");
    assert.match(api.lineItemChangeText(cat), /part category Belt → Fan \/ Belt \/ Pumps/);
    assert.equal(api.auditLineText(item), api.lineItemChangeText(item));
    assert.equal(api.auditLineText(cat), api.lineItemChangeText(cat));
  });

  it("allows requested, pending, and an open hold, and blocks approved, closed, cancelled, and flagged", () => {
    const api = loadEdit();
    ["", "Draft", "Requested", "Pending", "FOR APPROVAL", "Sent for approval", "on hold", "Open hold", "open-hold", "Open before approve"].forEach((st) => {
      const row = hold({ status: st, approvedBy: "", approvedAt: "", approvedBudget: null });
      assert.equal(api.lineItemEditAllowed(row), true, st || "(blank)");
    });
    const openHold = hold({ status: "Open", approvedBy: "", approvedAt: "", approvedBudget: null });
    assert.equal(api.lineItemEditAllowed(openHold), true);
    ["Approved", "Closed", "Cancelled", "Flagged", "Rejected", "Open — awaiting liquidation"].forEach((st) => {
      const row = hold({ status: st });
      const copy = JSON.parse(JSON.stringify(row));
      const plan = api.planLineItemEdit(row, {
        by: "Bea",
        at: "2026-11-05",
        lines: [{ index: 1, item: "Alternator belt", cat: "Belt" }],
      });
      assert.equal(plan.ok, false, st);
      assert.equal(plan.code, "locked", st);
      api.applyLineItemEdit(row, plan);
      assert.deepEqual(row, copy);
    });
    const approvedOpen = hold({ status: "Open", approvedBy: "Jeffrey James M. Corro", approvedAt: "2026-11-05", approvedBudget: 700 });
    assert.equal(api.lineItemEditAllowed(approvedOpen), false);
    const stamped = hold({ status: "Requested", approvedBy: "Jeffrey" });
    assert.equal(api.lineItemEditAllowed(stamped), false);
  });

  it("keeps Fuel — Diesel and Fuel — Gasoline in liters and does not change the price", () => {
    const api = loadEdit();
    const row = hold({
      draftLines: [
        { cat: "Belt", item: "Diesel drum", supplier: "Petron", qty: 40, price: 88, unit: "pc", liters: "", work: "REP" },
        { cat: "Fuel — Gasoline", item: "Fuel", supplier: "Shell", qty: 11.53, price: 86.73, unit: "L", liters: "", work: "FUEL-STN" },
      ],
      budget: 4519.9,
    });
    apply(api, row, {
      by: "Bea Cruz",
      at: "2026-11-05",
      lines: [
        { index: 0, item: "Diesel", cat: "Fuel — Diesel", qty: 40, price: 88, amount: 3520 },
        { index: 1, item: "Gasoline", cat: "Fuel — Gasoline", qty: 11.53, price: 86.73 },
      ],
    });
    assert.equal(row.draftLines[0].cat, "Fuel — Diesel");
    assert.equal(row.draftLines[0].item, "Diesel");
    assert.equal(row.draftLines[0].unit, "liters");
    assert.equal(row.draftLines[0].liters, 40);
    assert.equal(row.draftLines[0].price, 88);
    assert.equal(row.draftLines[1].cat, "Fuel — Gasoline");
    assert.equal(row.draftLines[1].unit, "liters");
    assert.equal(row.draftLines[1].liters, 11.53);
    assert.equal(row.draftLines[1].price, 86.73);
    assert.equal(row.status, "Requested");
    assert.equal(row.approvedBy, "");
    const unit = row.audit.filter((n) => n.field === "unit")[0];
    assert.equal(unit.from, "pc");
    assert.equal(unit.to, "liters");
    const back = hold();
    apply(api, back, {
      by: "Bea Cruz",
      at: "2026-11-05",
      lines: [{ index: 0, item: "Not fuel", cat: "Belt", qty: 10, price: 50, amount: 500 }],
    });
    assert.equal(back.draftLines[0].cat, "Belt");
    assert.equal(back.draftLines[0].unit, "pc");
    assert.equal(back.draftLines[0].liters, "");
    assert.equal(back.draftLines[0].price, 50);
    assert.equal(back.draftLines[1].cat, "Belt");
    assert.equal(back.draftLines[1].unit, "pc");
  });

  it("recomputes the VRF total when quantity or price changes and does not approve", () => {
    const api = loadEdit();
    const row = hold();
    const plan = apply(api, row, {
      by: "Bea Cruz",
      at: "2026-11-05",
      lines: [{ index: 0, item: "Diesel", cat: "Fuel — Diesel", qty: 12, price: 55, amount: 660 }],
    });
    assert.equal(plan.ok, true);
    assert.equal(row.draftLines[0].qty, 12);
    assert.equal(row.draftLines[0].price, 55);
    assert.equal(row.draftLines[0].total, 660);
    assert.equal(row.draftLines[0].unit, "liters");
    assert.equal(row.draftLines[1].qty, 1);
    assert.equal(row.draftLines[1].price, 200);
    assert.equal(row.budget, 860);
    assert.equal(row.status, "Requested");
    assert.equal(row.approvedBy, "");
    assert.equal(row.approvedAt, "");
    assert.equal(row.approvedBudget, null);
    assert.equal(row.decisionNote, "");
    assert.equal(row.vrfNo, "5812");
    const total = row.audit.filter((n) => n.note === "VRF total")[0];
    assert.equal(total.field, "amount");
    assert.match(api.pendingAmountText(total), /amount 700\.00 → 860\.00/);
    assert.match(api.auditLineText(total), /700\.00 → 860\.00/);
    assert.equal(row.budget < 1000, true);
  });

  it("refuses a blank name, a blank item, or a blank category without writing", () => {
    const api = loadEdit();
    const row = hold();
    const copy = JSON.parse(JSON.stringify(row));
    assert.equal(api.planLineItemEdit(row, { lines: [{ index: 1, item: "X", cat: "Belt" }] }).code, "name");
    assert.equal(api.planLineItemEdit(row, { by: "Bea", lines: [{ index: 1, item: "  ", cat: "Belt" }] }).code, "blank");
    assert.equal(api.planLineItemEdit(row, { by: "Bea", lines: [{ index: 1, item: "Fan belt", cat: "  " }] }).code, "blank");
    const same = api.planLineItemEdit(row, {
      by: "Bea",
      at: "2026-11-05",
      lines: [{ index: 1, item: "Fan belt", cat: "Belt", qty: 1, price: 200, amount: 200 }],
    });
    assert.equal(same.changed, false);
    api.applyLineItemEdit(row, same);
    assert.deepEqual(row, copy);
  });

  it("posts the edited item and category through approve", () => {
    const api = loadEdit();
    const row = hold();
    apply(api, row, {
      by: "Bea Cruz",
      at: "2026-11-05",
      lines: [{ index: 1, item: "Alternator belt", cat: "Fan / Belt / Pumps" }],
    });
    assert.equal(row.status, "Requested");
    const result = applyApproveFromHold(
      { ledgerRows: [], reserves: [], vehicles: [], parts: [] },
      row,
      { approvedBy: "Jeffrey", now: "2026-11-05" }
    );
    assert.equal(result.hold.vrfNo, "5812");
    assert.equal(result.rows[1].item, "Alternator belt");
    assert.equal(result.rows[1].cat, "Fan / Belt / Pumps");
    assert.equal(result.rows[1].qty, 1);
    assert.equal(result.rows[1].price, 200);
    assert.equal(result.rows[0].item, "Fuel");
    assert.equal(result.rows[0].supplier, "Petron");
    assert.equal(result.hold.fuelPrevNote, PREV);
    assert.equal(result.rows[0].vstatus, "Open");
    assert.ok(result.hold.audit.some((n) => n.field === "item" && n.from === "Fan belt" && n.to === "Alternator belt"));
  });
});
