"use strict";

const { addDays, daysBetween } = require("./manila");
const { round2 } = require("./money");

const AP_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"];
const CA_BUCKETS = ["0-30", "31-60", "61-90", "90+"];

function apBucket(daysPastDue) {
  const n = Number(daysPastDue);
  if (!Number.isFinite(n) || n <= 0) return "current";
  if (n <= 30) return "1-30";
  if (n <= 60) return "31-60";
  if (n <= 90) return "61-90";
  return "90+";
}

function caBucket(daysOut) {
  const n = Number(daysOut);
  if (!Number.isFinite(n) || n <= 30) return "0-30";
  if (n <= 60) return "31-60";
  if (n <= 90) return "61-90";
  return "90+";
}

function billRemaining(bill, payments) {
  const net = round2(bill && (bill.net_amount != null ? bill.net_amount : bill.net));
  const paidFromRows = round2(
    (payments || [])
      .filter((p) => p && p.voided !== true)
      .reduce((sum, p) => sum + round2(p.amount), 0)
  );
  const paid = payments ? paidFromRows : round2(bill && bill.paid_amount);
  return {
    net,
    paid,
    remaining: round2(Math.max(0, net - paid)),
  };
}

function billStatusFor(net, paid, current) {
  if (current === "Cancelled") return "Cancelled";
  const left = round2(net - paid);
  if (paid <= 0.009) return "Open";
  if (left > 0.009) return "Partial";
  return "Paid";
}

function classifyBill(bill, payments, today) {
  const money = billRemaining(bill, payments);
  const due = String((bill && bill.due_date) || "").slice(0, 10);
  const past = due ? daysBetween(due, today) : 0;
  const open = bill && bill.status !== "Cancelled" && bill.status !== "Paid" && money.remaining > 0.009;
  return {
    ...money,
    due,
    daysPastDue: past,
    bucket: open ? apBucket(past) : null,
    open: Boolean(open),
  };
}

function dueThisWeek(bill, payments, today) {
  const info = classifyBill(bill, payments, today);
  if (!info.open || !info.due) return false;
  const end = addDays(today, 6);
  return info.due >= today && info.due <= end;
}

function bucketTotals(rows, buckets) {
  const out = {};
  buckets.forEach((name) => {
    out[name] = { count: 0, amount: 0 };
  });
  (rows || []).forEach((row) => {
    const name = row.bucket;
    if (!out[name]) return;
    out[name].count += 1;
    out[name].amount = round2(out[name].amount + round2(row.amount != null ? row.amount : row.remaining));
  });
  return out;
}

module.exports = {
  AP_BUCKETS,
  CA_BUCKETS,
  apBucket,
  billRemaining,
  billStatusFor,
  bucketTotals,
  caBucket,
  classifyBill,
  dueThisWeek,
};
