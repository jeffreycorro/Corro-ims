"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  addReceipt,
  balances,
  createAdvance,
  createBill,
  createVoucher,
  payBill,
  postLiquidation,
  reimburseAdvance,
  releaseAdvance,
  saveProject,
  seedReference,
  transitionAdvance,
  transitionVoucher,
} = require("../netlify/lib/domain");
const { createMemoryStore } = require("../netlify/lib/memory-store");

const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function ready() {
  const store = createMemoryStore();
  await seedReference(store);
  await saveProject(store, { name: "Tower A", site: "Cebu" });
  const actor = { name: "Ana Cruz", today: "2026-10-10", now: "2026-10-10T09:00:00+08:00", approverOk: false };
  return { store, actor };
}

async function toApproval(store, id, kind, actor) {
  const transition = kind === "advance" ? transitionAdvance : transitionVoucher;
  await transition(store, id, "submit", {}, actor);
  await transition(store, id, "check", {}, actor);
}

describe("approvals", () => {
  it("walks a voucher from draft to cleared and rejects a skipped step", async () => {
    const { store, actor } = await ready();
    const draft = await createVoucher(
      store,
      { payee: "ABC Trading", projectName: "Tower A", particulars: "Cement", accountName: "Materials", amount: 1000, vatMode: "none" },
      actor
    );
    await assert.rejects(() => transitionVoucher(store, draft.id, "approve", {}, { ...actor, approverOk: true }), /Draft/);
    await toApproval(store, draft.id, "voucher", actor);
    await assert.rejects(
      () => transitionVoucher(store, draft.id, "approve", { password: "nope" }, actor),
      (err) => err.code === "approver_password"
    );
    const approved = await transitionVoucher(store, draft.id, "approve", {}, { ...actor, approverOk: true });
    assert.equal(approved.status, "Approved");
    assert.equal(approved.approved_by, "Jeffrey Corro");
    assert.equal(approved.checked_by, "Evaluator");
    const released = await transitionVoucher(
      store,
      draft.id,
      "release",
      { releaseMethod: "Check", checkBank: "BDO", checkNo: "10021", checkDate: "2026-10-10", receiverName: "Site Cashier", receiverSignature: SIG },
      actor
    );
    assert.equal(released.status, "Released");
    assert.equal(released.release_method, "Check");
    assert.equal(released.check_no, "10021");
    const cleared = await transitionVoucher(store, draft.id, "clear", {}, actor);
    assert.equal(cleared.status, "Cleared");
    await assert.rejects(() => transitionVoucher(store, draft.id, "cancel", {}, actor), /Cleared/);
  });

  it("releases an approved cash advance only through its voucher", async () => {
    const { store, actor } = await ready();
    const advance = await createAdvance(
      store,
      { employeeName: "Ben Cruz", department: "site", purpose: "Fuel", projectName: "Tower A", amount: 10000, dateNeeded: "2026-10-11" },
      actor
    );
    await assert.rejects(() => releaseAdvance(store, advance.id, actor), /approved/);
    await toApproval(store, advance.id, "advance", actor);
    await transitionAdvance(store, advance.id, "approve", {}, { ...actor, approverOk: true });
    const voucher = await releaseAdvance(store, advance.id, actor);
    assert.equal(voucher.source_kind, "cash_advance");
    assert.equal(voucher.net_amount, 10000);
    let still = await store.get("advances", advance.id);
    assert.equal(still.status, "Approved");
    await toApproval(store, voucher.id, "voucher", actor);
    await transitionVoucher(store, voucher.id, "approve", {}, { ...actor, approverOk: true });
    await transitionVoucher(
      store,
      voucher.id,
      "release",
      { releaseMethod: "Cash", receiverName: "Ben Cruz", receiverSignature: SIG },
      actor
    );
    still = await store.get("advances", advance.id);
    assert.equal(still.status, "Released");
    assert.equal(still.voucher_id, voucher.id);
    await addReceipt(store, advance.id, { date: "2026-10-12", particulars: "Diesel", amount: 8500 }, actor);
    const liquidated = await postLiquidation(store, advance.id, { receipts: [] }, actor);
    assert.equal(liquidated.status, "Liquidated");
    assert.equal(liquidated.liquidated_amount, 8500);
    assert.equal(liquidated.refund_amount, 1500);
    const people = await balances(store);
    const ben = people.find((row) => row.employee_name === "Ben Cruz");
    assert.equal(ben.balance, 1500);
  });

  it("pays part of a supplier bill when the payment voucher is released", async () => {
    const { store, actor } = await ready();
    const bill = await createBill(
      store,
      {
        supplierName: "ABC Trading",
        invoiceNo: "1001",
        invoiceDate: "2026-10-01",
        termsDays: 30,
        projectName: "Tower A",
        particulars: "Rebar",
        amount: 1120,
        vatMode: "inclusive",
        ewtRate: 0.01,
      },
      actor
    );
    assert.equal(bill.net_amount, 1110);
    assert.equal(bill.due_date, "2026-10-31");
    const part = await payBill(store, bill.id, { amount: 400 }, actor);
    await assert.rejects(() => payBill(store, bill.id, { amount: 800 }, actor), /owes/);
    await toApproval(store, part.id, "voucher", actor);
    await transitionVoucher(store, part.id, "approve", {}, { ...actor, approverOk: true });
    await transitionVoucher(
      store,
      part.id,
      "release",
      { releaseMethod: "Cash", receiverName: "ABC Trading", receiverSignature: SIG },
      actor
    );
    const updated = await store.get("bills", bill.id);
    assert.equal(updated.status, "Partial");
    assert.equal(Number(updated.paid_amount), 400);
  });

  it("opens a reimbursement voucher when receipts exceed the advance", async () => {
    const { store, actor } = await ready();
    const advance = await createAdvance(
      store,
      { employeeName: "Cara Diaz", department: "finance", purpose: "Travel", projectName: "Tower A", amount: 1000, dateNeeded: "2026-10-11" },
      actor
    );
    await toApproval(store, advance.id, "advance", actor);
    await transitionAdvance(store, advance.id, "approve", {}, { ...actor, approverOk: true });
    const voucher = await releaseAdvance(store, advance.id, actor);
    await toApproval(store, voucher.id, "voucher", actor);
    await transitionVoucher(store, voucher.id, "approve", {}, { ...actor, approverOk: true });
    await transitionVoucher(
      store,
      voucher.id,
      "release",
      { releaseMethod: "Cash", receiverName: "Cara Diaz", receiverSignature: SIG },
      actor
    );
    await postLiquidation(store, advance.id, { receipts: [{ date: "2026-10-12", particulars: "Fare", amount: 1250 }] }, actor);
    const extra = await reimburseAdvance(store, advance.id, actor);
    assert.equal(extra.source_kind, "reimbursement");
    assert.equal(extra.net_amount, 250);
    assert.equal(extra.status, "Draft");
  });
});
