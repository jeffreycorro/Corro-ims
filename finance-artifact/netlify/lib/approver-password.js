"use strict";

const { safeEqual } = require("./session");

/** Same page password as the HR Approver tab, unless the site overrides it. */
const HR_APPROVER_PAGE_PASSWORD = "032589";

function expectedApproverPassword() {
  const set = process.env.FINANCE_APPROVER_PASSWORD;
  if (set != null && String(set).trim() !== "") return String(set);
  return HR_APPROVER_PAGE_PASSWORD;
}

function approverPasswordOk(given) {
  return safeEqual(String(given ?? ""), expectedApproverPassword());
}

module.exports = { approverPasswordOk, expectedApproverPassword, HR_APPROVER_PAGE_PASSWORD };
