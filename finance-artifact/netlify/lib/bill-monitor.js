"use strict";

const { addDays, monthKey } = require("./manila");
const { money, sumAmounts } = require("./sheet-math");

const CATEGORIES = [
  "Office",
  "Tawason",
  "Pagsabungan",
  "Danlag",
  "Borbajo Talamban",
  "Residencia Edades",
  "San Remo Oasis",
  "PITOS HOUSE",
  "CREDIT CARDS",
  "Tawason 2",
  "City Soho Condo",
  "LP Balaga 1",
  "LP Balaga 2",
  "LP Balaga MCWD",
  "Medellin Electric Bill",
  "Medellin Water Bill",
];

const BILL_TYPES = [
  "Electricity",
  "Water",
  "Internet/Telecom",
  "Rent",
  "Gov't Contributions",
  "Professional Fees",
  "Amortization",
  "Credit Cards",
];

const CREDIT_CARDS = [
  "RCBC",
  "BDO Platinum",
  "Security Bank Cashback",
  "BPI",
  "Security Bank Platinum",
  "HSBC",
  "UnionBank",
  "BDO Installment",
];

const RENTAL_UNITS = [
  { id: "rent-edades-720", name: "Residencia Edades 720", site: "Residencia Edades", unit_no: "720", monthly_rent: 8500 },
  { id: "rent-soho-1123", name: "City Soho 1123", site: "City Soho Condo", unit_no: "1123", monthly_rent: 10000 },
  { id: "rent-sanremo-3314", name: "San Remo 3314", site: "San Remo Oasis", unit_no: "3314", monthly_rent: 12500 },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isCard(bill) {
  if (!bill) return false;
  if (bill.bill_type === "Credit Cards") return true;
  if (String(bill.card_name || "").trim()) return true;
  return String(bill.category || "").toUpperCase() === "CREDIT CARDS";
}

function pctChange(current, prior) {
  if (!prior) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

function share(amount, total) {
  if (!total) return 0;
  return Math.round((amount / total) * 1000) / 10;
}

function addMonths(month, count) {
  const [year, mon] = String(month).slice(0, 7).split("-").map(Number);
  const dt = new Date(Date.UTC(year, mon - 1 + count, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsAhead(today, count) {
  const start = monthKey(today);
  const rows = [];
  for (let i = 0; i < count; i += 1) rows.push(addMonths(start, i));
  return rows;
}

function dueOn(month, day) {
  const [year, mon] = String(month).split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const picked = Math.min(Math.max(Number(day) || 1, 1), last);
  return `${month}-${String(picked).padStart(2, "0")}`;
}

function effectiveDue(instance, bill) {
  const dated = String(instance.due_date || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dated)) return dated;
  if (!isCard(bill) || !/^\d{4}-\d{2}$/.test(instance.month || "")) return "";
  return `${addMonths(instance.month, 1)}-01`;
}

function statementLabel(instance, bill) {
  if (!isCard(bill) || !/^\d{4}-\d{2}$/.test(instance.month || "")) return "";
  const posted = Number(instance.month.slice(5, 7));
  const due = effectiveDue(instance, bill);
  const dueMonth = due ? Number(due.slice(5, 7)) : posted === 12 ? 1 : posted + 1;
  return `${SHORT[posted - 1]} statement, due ~${SHORT[dueMonth - 1]}`;
}

function paidRow(instance) {
  return instance && instance.status === "paid";
}

function openRow(instance) {
  return instance && instance.status !== "paid" && instance.status !== "n-a";
}

function inWindow(instance, year, fromMonth, toMonth) {
  if (!instance || !instance.month || !String(instance.month).startsWith(String(year))) return false;
  const month = Number(instance.month.slice(5, 7));
  return month >= fromMonth && month <= toMonth;
}

function billOf(instance, bills) {
  return (bills || []).find((row) => row.id === instance.bill_id) || null;
}

function selected(bill, category, billId) {
  if (!bill) return false;
  if (billId && billId !== "all" && bill.id !== billId) return false;
  if (!category || category === "all") return true;
  if (category === "excl") return !isCard(bill);
  return bill.category === category;
}

function sumPaid(instances, bills, year, fromMonth, toMonth, category, billId) {
  return sumAmounts(
    (instances || []).filter((row) => {
      if (!paidRow(row) || !inWindow(row, year, fromMonth, toMonth)) return false;
      return selected(billOf(row, bills), category, billId);
    }),
    (row) => row.amount
  );
}

function series(instances, bills, year, category, billId) {
  const rows = [];
  for (let month = 1; month <= 12; month += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const mine = (instances || []).filter((row) => paidRow(row) && row.month === key && selected(billOf(row, bills), category, billId));
    rows.push({ month: key, label: SHORT[month - 1], total: sumAmounts(mine, (row) => row.amount) });
  }
  return rows;
}

function slices(instances, bills, year, fromMonth, toMonth, group) {
  const bucket = new Map();
  (instances || []).forEach((row) => {
    if (!paidRow(row) || !inWindow(row, year, fromMonth, toMonth)) return;
    const bill = billOf(row, bills);
    if (group === "cards" && !isCard(bill)) return;
    let label = "Unspecified";
    if (group === "type") label = (bill && bill.bill_type) || "Unspecified";
    else if (group === "cards") label = (bill && (bill.card_name || bill.biller)) || "Card";
    else label = (bill && bill.category) || "Unspecified";
    const cur = bucket.get(label) || 0;
    bucket.set(label, money(cur + Number(row.amount || 0)));
  });
  const total = Array.from(bucket.values()).reduce((sum, amount) => money(sum + amount), 0);
  return Array.from(bucket.entries())
    .map(([label, amount]) => ({ label, amount, pct: share(amount, total) }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

function decorate(instance, bill) {
  const due = effectiveDue(instance, bill);
  return {
    id: instance.id,
    billId: instance.bill_id,
    biller: bill ? bill.biller : "Bill",
    category: bill ? bill.category : "",
    billType: bill ? bill.bill_type || "" : "",
    card: bill ? bill.card_name || "" : "",
    month: instance.month,
    amount: money(instance.amount),
    due,
    statement: statementLabel(instance, bill),
    receipt_path: instance.receipt_path || "",
    status: instance.status,
  };
}

function billMonitor(bills, instances, options = {}) {
  const today = String(options.today || "2000-01-01").slice(0, 10);
  const year = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const lastComplete = currentMonth - 1;
  const category = options.category && options.category !== "all" ? options.category : "all";
  const billId = options.billId && options.billId !== "all" ? options.billId : "all";
  const list = instances || [];
  const catalog = bills || [];
  const thisYtd = lastComplete >= 1 ? sumPaid(list, catalog, year, 1, lastComplete, "all", "all") : 0;
  const lastYtd = lastComplete >= 1 ? sumPaid(list, catalog, year - 1, 1, lastComplete, "all", "all") : 0;
  const thisYtdEx = lastComplete >= 1 ? sumPaid(list, catalog, year, 1, lastComplete, "excl", "all") : 0;
  const lastYtdEx = lastComplete >= 1 ? sumPaid(list, catalog, year - 1, 1, lastComplete, "excl", "all") : 0;
  const attention = [];
  const upcoming = [];
  const reminders = [];
  const soon = addDays(today, 3);
  list.forEach((row) => {
    if (!openRow(row)) return;
    const bill = billOf(row, catalog);
    const item = decorate(row, bill);
    const due = item.due;
    if (due && due < today) attention.push({ ...item, pill: "OVERDUE" });
    else if (due && due === today) attention.push({ ...item, pill: "DUE NOW" });
    if (due && due >= today && due <= soon) reminders.push({ ...item, days: Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) });
    if (row.month && row.month > monthKey(today)) upcoming.push({ ...item, pill: "UPCOMING" });
  });
  attention.sort((a, b) => a.due.localeCompare(b.due) || b.amount - a.amount);
  reminders.sort((a, b) => a.due.localeCompare(b.due));
  upcoming.sort((a, b) => a.month.localeCompare(b.month) || a.biller.localeCompare(b.biller));
  const monthly = series(list, catalog, year, category, billId).map((row, index) => ({
    ...row,
    lastYear: series(list, catalog, year - 1, category, billId)[index].total,
    inProgress: index + 1 === currentMonth,
  }));
  let run = 0;
  let runLast = 0;
  const cumulative = monthly.map((row) => {
    run = money(run + row.total);
    runLast = money(runLast + row.lastYear);
    return { month: row.month, label: row.label, thisYear: run, lastYear: runLast, inProgress: row.inProgress };
  });
  const monthlyNamed = monthly.map((row) => ({ month: row.month, label: row.label, thisYear: row.total, lastYear: row.lastYear, inProgress: row.inProgress }));
  const known = new Set(CATEGORIES);
  const extras = [];
  catalog.forEach((bill) => {
    if (bill.category && !known.has(bill.category) && !extras.includes(bill.category)) extras.push(bill.category);
  });
  const items = catalog
    .filter((bill) => selected(bill, category, "all"))
    .map((bill) => ({ id: bill.id, biller: bill.biller, category: bill.category, billType: bill.bill_type || "", card: bill.card_name || "" }))
    .sort((a, b) => a.biller.localeCompare(b.biller));
  const progress = monthlyNamed.find((row) => row.inProgress) || null;
  return {
    today,
    year,
    throughLabel: lastComplete >= 1 ? MONTHS[lastComplete - 1] : "",
    progressLabel: MONTHS[currentMonth - 1],
    categories: CATEGORIES.concat(extras),
    kpis: {
      lastYearPaid: sumPaid(list, catalog, year - 1, 1, 12, "all", "all"),
      thisYearPaid: thisYtd,
      pctVsLastYear: pctChange(thisYtd, lastYtd),
      pctExcludingCards: pctChange(thisYtdEx, lastYtdEx),
      attentionTotal: sumAmounts(attention, (row) => row.amount),
      attentionCount: attention.length,
    },
    trend: {
      monthly: monthlyNamed,
      cumulative,
      readout: {
        thisYtd: lastComplete >= 1 ? sumPaid(list, catalog, year, 1, lastComplete, category, billId) : 0,
        lastYtd: lastComplete >= 1 ? sumPaid(list, catalog, year - 1, 1, lastComplete, category, billId) : 0,
        pct: pctChange(
          lastComplete >= 1 ? sumPaid(list, catalog, year, 1, lastComplete, category, billId) : 0,
          lastComplete >= 1 ? sumPaid(list, catalog, year - 1, 1, lastComplete, category, billId) : 0
        ),
        lastFull: sumPaid(list, catalog, year - 1, 1, 12, category, billId),
        progressAmount: progress ? progress.thisYear : 0,
      },
    },
    items,
    spend: {
      ytd: {
        location: slices(list, catalog, year, 1, Math.max(lastComplete, 0), "location"),
        type: slices(list, catalog, year, 1, Math.max(lastComplete, 0), "type"),
        cards: slices(list, catalog, year, 1, Math.max(lastComplete, 0), "cards"),
      },
      last: {
        location: slices(list, catalog, year - 1, 1, 12, "location"),
        type: slices(list, catalog, year - 1, 1, 12, "type"),
        cards: slices(list, catalog, year - 1, 1, 12, "cards"),
      },
    },
    attention,
    upcoming,
    reminders,
    upcomingTotal: sumAmounts(upcoming, (row) => row.amount),
    reminderTotal: sumAmounts(reminders, (row) => row.amount),
  };
}

module.exports = {
  BILL_TYPES,
  CATEGORIES,
  CREDIT_CARDS,
  RENTAL_UNITS,
  addMonths,
  billMonitor,
  dueOn,
  isCard,
  monthsAhead,
};
