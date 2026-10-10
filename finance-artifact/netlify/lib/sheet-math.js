"use strict";

const { daysBetween, monthKey } = require("./manila");

const CHECK_STATUSES = [
  "issued",
  "for signature",
  "ready for pickup",
  "released",
  "cleared",
  "cancelled",
  "void",
  "stale",
];

const DEAD_CHECK = new Set(["cancelled", "void"]);

function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function money(value) {
  return cents(value) / 100;
}

function sumAmounts(rows, pick) {
  const total = (rows || []).reduce((sum, row) => sum + cents(pick ? pick(row) : row), 0);
  return total / 100;
}

function cycleFooter({ opening, cashIns, vouchers, releases }) {
  const totalCash = money(Number(opening || 0) + sumAmounts(cashIns, (row) => row.amount));
  const live = (vouchers || []).filter((row) => row.status !== "void" && row.status !== "cancelled");
  const totalExpenses = sumAmounts(live, (row) => row.amount);
  const openReleases = (releases || []).filter((row) => String(row.status || "open") === "open");
  const cashReleased = sumAmounts(openReleases, (row) => row.amount);
  return {
    totalCash,
    cashReleased,
    totalExpenses,
    cashOnHand: money(totalCash - totalExpenses - cashReleased),
  };
}

function gcashBalance({ opening, cashIns, expenses, receivables }) {
  const inn = sumAmounts(cashIns, (row) => row.amount);
  const out = (expenses || [])
    .filter((row) => row.status !== "void")
    .reduce((sum, row) => sum + cents(row.amount) + cents(row.fee), 0);
  const held = (receivables || [])
    .filter((row) => row.status !== "collected" && row.status !== "closed")
    .reduce((sum, row) => sum + cents(row.amount), 0);
  return money(Number(opening || 0) + inn - out / 100 - held / 100);
}

function checkStatus(row) {
  return String((row && row.status) || "").toLowerCase();
}

function dueStatus(check, today) {
  const status = checkStatus(check);
  if (status === "cleared" || (check && check.cleared_date)) return "Cleared";
  if (status === "cancelled") return "Cancelled";
  if (status === "void") return "Void";
  if (status === "stale") return "Stale";
  if (!check || !check.check_date) return "OK";
  const days = daysBetween(today, String(check.check_date).slice(0, 10));
  if (days < 0) return "Overdue";
  if (days === 0) return "Due Today";
  if (days <= 5) return "Due Soon";
  return "OK";
}

function daysUntilDue(check, today) {
  if (!check || !check.check_date) return null;
  return daysBetween(today, String(check.check_date).slice(0, 10));
}

function countsInMonth(row) {
  const status = checkStatus(row);
  return !DEAD_CHECK.has(status);
}

function monthTotals(checks, month) {
  const rows = (checks || []).filter((row) => countsInMonth(row) && monthKey(row.check_date) === month);
  const cleared = rows.filter((row) => checkStatus(row) === "cleared" || row.cleared_date);
  const outstanding = rows.filter((row) => checkStatus(row) !== "cleared" && !row.cleared_date);
  const expense = rows.filter((row) => !row.is_transfer);
  return {
    month,
    count: rows.length,
    total: sumAmounts(rows, (row) => row.amount),
    cleared: sumAmounts(cleared, (row) => row.amount),
    outstanding: sumAmounts(outstanding, (row) => row.amount),
    expense: sumAmounts(expense, (row) => row.amount),
  };
}

function monthlySummary(checks) {
  const months = Array.from(
    new Set((checks || []).filter(countsInMonth).map((row) => monthKey(row.check_date)).filter(Boolean))
  ).sort();
  return months.map((month) => {
    const row = monthTotals(checks, month);
    const onward = (checks || []).filter((item) => {
      if (!countsInMonth(item)) return false;
      if (checkStatus(item) === "cleared" || item.cleared_date) return false;
      return monthKey(item.check_date) >= month;
    });
    return { ...row, outstandingFromHere: sumAmounts(onward, (item) => item.amount) };
  });
}

function buildCheckViews(checks, today, range) {
  const tagged = (checks || []).map((row) => ({
    ...row,
    due_status: dueStatus(row, today),
    days_until_due: daysUntilDue(row, today),
  }));
  const pendingDue = tagged.filter((row) => ["Overdue", "Due Today", "Due Soon"].includes(row.due_status));
  const uncleared = tagged.filter((row) => !["Cleared", "Cancelled", "Void", "Stale"].includes(row.due_status) && checkStatus(row) !== "cleared");
  let payables = tagged.filter((row) => !DEAD_CHECK.has(checkStatus(row)) && checkStatus(row) !== "cleared" && !row.cleared_date);
  if (range && range.from) payables = payables.filter((row) => String(row.check_date || "") >= range.from);
  if (range && range.to) payables = payables.filter((row) => String(row.check_date || "") <= range.to);
  return { monthly: monthlySummary(checks), pendingDue, payables, uncleared, checks: tagged };
}

function parseCheckNo(raw) {
  const compact = String(raw || "").replace(/\s+/g, "").toUpperCase();
  const match = compact.match(/^([A-Z]+)(\d{4})-(\d+)$/);
  if (!match) return null;
  return {
    bankCode: match[1],
    bookletYear: Number(match[2]),
    serial: match[3],
    checkNo: `${match[1]}${match[2]}-${match[3]}`,
  };
}

function bankCodeOf(account) {
  const nick = String((account && (account.nickname || account.bank_name)) || "").toUpperCase();
  if (nick.startsWith("BPI")) return "BPI";
  const token = nick.split(/[^A-Z0-9]+/).filter(Boolean)[0];
  return token || "BANK";
}

module.exports = {
  CHECK_STATUSES,
  bankCodeOf,
  buildCheckViews,
  cents,
  cycleFooter,
  dueStatus,
  gcashBalance,
  money,
  monthTotals,
  monthlySummary,
  parseCheckNo,
  sumAmounts,
};
