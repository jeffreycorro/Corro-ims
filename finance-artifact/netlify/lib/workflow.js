"use strict";

const { fail } = require("./errors");

const DV_STATUSES = [
  "Draft",
  "For Review",
  "For Approval",
  "Approved",
  "Released",
  "Cleared",
  "Cancelled",
];

const CA_STATUSES = [
  "Draft",
  "For Review",
  "For Approval",
  "Approved",
  "Released",
  "Liquidated",
  "Cancelled",
];

const DV_ACTIONS = {
  submit: { from: ["Draft"], to: "For Review" },
  check: { from: ["For Review"], to: "For Approval" },
  approve: { from: ["For Approval"], to: "Approved", approver: true },
  release: { from: ["Approved"], to: "Released" },
  clear: { from: ["Released"], to: "Cleared" },
  cancel: { from: ["Draft", "For Review", "For Approval", "Approved"], to: "Cancelled" },
  return: { from: ["For Review", "For Approval"], to: null },
};

const CA_ACTIONS = {
  submit: { from: ["Draft"], to: "For Review" },
  check: { from: ["For Review"], to: "For Approval" },
  approve: { from: ["For Approval"], to: "Approved", approver: true },
  cancel: { from: ["Draft", "For Review", "For Approval", "Approved"], to: "Cancelled" },
  return: { from: ["For Review", "For Approval"], to: null },
  receive_refund: { from: ["Liquidated"], to: "Liquidated" },
};

function returnTarget(status) {
  if (status === "For Review") return "Draft";
  if (status === "For Approval") return "For Review";
  return null;
}

function resolveAction(table, status, action) {
  const spec = table[action];
  if (!spec) fail("bad_request", "Unknown action.");
  if (!spec.from.includes(status)) {
    fail("conflict", `Cannot ${action.replace(/_/g, " ")} a record that is ${status}.`);
  }
  const to = action === "return" ? returnTarget(status) : spec.to;
  if (!to) fail("conflict", `Cannot return a record that is ${status}.`);
  return { ...spec, to };
}

module.exports = {
  CA_ACTIONS,
  CA_STATUSES,
  DV_ACTIONS,
  DV_STATUSES,
  resolveAction,
  returnTarget,
};
