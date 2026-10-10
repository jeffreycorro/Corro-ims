"use strict";

const { round2 } = require("./money");

function receiptTotal(receipts) {
  return round2(
    (receipts || []).reduce((sum, row) => {
      const amount = row && typeof row === "object" ? row.amount : row;
      return sum + round2(amount);
    }, 0)
  );
}

/**
 * Actual receipts against a cash advance.
 * actual < advanced → employee refunds the difference.
 * actual > advanced → company reimburses the difference.
 */
function liquidationMath(advanced, receipts) {
  const adv = round2(advanced);
  const actual = receiptTotal(receipts);
  const variance = round2(actual - adv);
  return {
    advanced: adv,
    actual,
    variance,
    refund: variance < 0 ? round2(-variance) : 0,
    reimbursement: variance > 0 ? variance : 0,
    unliquidated: variance < 0 ? round2(-variance) : 0,
  };
}

/**
 * Company view of one advance.
 * holds: cash still with the employee (unliquidated advance, or refund not yet turned in).
 * owed: reimbursement the company has not paid.
 * balance: holds minus owed. Positive means the employee still holds company cash.
 */
function employeePosition(advance) {
  const status = advance && advance.status;
  const amount = round2(advance && advance.amount);
  if (status === "Released") {
    return { holds: amount, owed: 0, balance: amount };
  }
  if (status === "Liquidated") {
    const holds = advance.refund_received ? 0 : round2(advance.refund_amount);
    const owed = advance.reimbursement_paid ? 0 : round2(advance.reimbursement_amount);
    return { holds, owed, balance: round2(holds - owed) };
  }
  return { holds: 0, owed: 0, balance: 0 };
}

module.exports = { employeePosition, liquidationMath, receiptTotal };
