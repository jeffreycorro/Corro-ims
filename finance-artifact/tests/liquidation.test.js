"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { employeePosition, liquidationMath } = require("../netlify/lib/liquidation");

describe("cash advance liquidation", () => {
  it("computes a refund when receipts are under the advance", () => {
    const math = liquidationMath(10000, [{ amount: 5000 }, { amount: 3500 }]);
    assert.equal(math.actual, 8500);
    assert.equal(math.refund, 1500);
    assert.equal(math.reimbursement, 0);
    assert.equal(math.unliquidated, 1500);
  });

  it("computes a reimbursement when receipts exceed the advance", () => {
    const math = liquidationMath(10000, [{ amount: 12000 }]);
    assert.equal(math.actual, 12000);
    assert.equal(math.refund, 0);
    assert.equal(math.reimbursement, 2000);
  });

  it("settles when the receipts match the advance", () => {
    const math = liquidationMath(2500.5, [{ amount: 2500.5 }]);
    assert.equal(math.refund, 0);
    assert.equal(math.reimbursement, 0);
    assert.equal(math.variance, 0);
  });

  it("treats a released advance as cash the employee still holds", () => {
    const open = employeePosition({ status: "Released", amount: 8000 });
    assert.equal(open.balance, 8000);
    const refundDue = employeePosition({
      status: "Liquidated",
      amount: 8000,
      refund_amount: 500,
      reimbursement_amount: 0,
      refund_received: false,
      reimbursement_paid: false,
    });
    assert.equal(refundDue.holds, 500);
    assert.equal(refundDue.balance, 500);
    const owed = employeePosition({
      status: "Liquidated",
      refund_amount: 0,
      reimbursement_amount: 300,
      refund_received: true,
      reimbursement_paid: false,
    });
    assert.equal(owed.balance, -300);
  });
});
