"use strict";

const { addDays, daysBetween, monthKey } = require("./manila");
const { companyChecks, money, sumAmounts } = require("./sheet-math");

const COMPANY = "Corro Construction Development and Trade Corporation";
const STALE_DAYS = 180;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const BANK_COLORS = {
  AUB: "#6d28d9",
  BPI: "#c0392b",
  PBB: "#e07a2f",
  PSB: "#e07a2f",
  BDO: "#1d4ed8",
  RCBC: "#0f766e",
  DBP: "#7c3aed",
  LBP: "#b45309",
};

function statusOf(row) {
  return String((row && row.status) || "").toLowerCase();
}

function bankColor(code) {
  const key = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (BANK_COLORS[key]) return BANK_COLORS[key];
  if (key.startsWith("BPI")) return BANK_COLORS.BPI;
  if (key.startsWith("BDO")) return BANK_COLORS.BDO;
  if (key.startsWith("PSB") || key.startsWith("PBB")) return BANK_COLORS.PBB;
  const palette = ["#0f766e", "#7c3aed", "#b45309", "#be185d", "#0369a1", "#3f6212"];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash + key.charCodeAt(i) * (i + 1)) % palette.length;
  return palette[hash];
}

function countsAsIssued(row) {
  const status = statusOf(row);
  return status !== "cancelled" && status !== "void" && !row.is_transfer;
}

function countsAsOutstanding(row) {
  const status = statusOf(row);
  if (!countsAsIssued(row)) return false;
  if (status === "cleared" || status === "stale" || row.cleared_date) return false;
  return true;
}

function shouldStale(row, today) {
  const status = statusOf(row);
  if (!["issued", "for signature", "ready for pickup", "released"].includes(status)) return false;
  if (row.cleared_date) return false;
  const dated = String(row.check_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dated)) return false;
  return daysBetween(dated, today) >= STALE_DAYS;
}

function endOfMonth(iso) {
  const [year, month] = String(iso).slice(0, 7).split("-").map(Number);
  const dt = new Date(Date.UTC(year, month, 0));
  const d = String(dt.getUTCDate()).padStart(2, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${m}-${d}`;
}

function shiftYear(iso, delta) {
  const [year, month, day] = String(iso).slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(year + delta, month - 1, day));
  if (dt.getUTCMonth() !== month - 1) {
    const back = new Date(Date.UTC(year + delta, month, 0));
    return endOfMonth(`${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, "0")}-01`);
  }
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function compactAmount(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

function pctChange(current, prior) {
  if (!prior) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

function inBank(row, bankId) {
  return !bankId || bankId === "all" || row.bank_account_id === bankId;
}

function scopedChecks(checks, banks, bankId) {
  const personal = new Set((banks || []).filter((row) => row && row.is_personal).map((row) => row.id));
  if (bankId && bankId !== "all" && personal.has(bankId)) {
    return (checks || []).filter((row) => row.bank_account_id === bankId);
  }
  return companyChecks(checks, banks);
}

function bankOf(row, banks) {
  return (banks || []).find((item) => item.id === row.bank_account_id) || null;
}

function decorate(row, banks) {
  const bank = bankOf(row, banks);
  const code = (bank && (bank.bank_code || bank.nickname)) || row.bank_code || "";
  return {
    id: row.id,
    check_no: row.check_no,
    payee: row.payee,
    amount: money(row.amount),
    check_date: row.check_date,
    status: row.status,
    bank_id: row.bank_account_id,
    bank: bank ? bank.nickname || bank.bank_name : row.bank_code || "Bank",
    color: bankColor(code),
    photo_url: row.photo_url || "",
  };
}

function sumWindow(rows, from, to, bankId) {
  return sumAmounts(
    rows.filter((row) => countsAsIssued(row) && inBank(row, bankId) && row.check_date >= from && row.check_date <= to),
    (row) => row.amount
  );
}

function checkMonitor(checks, banks, options = {}) {
  const today = String(options.today || "2000-01-01").slice(0, 10);
  const currentYear = Number(today.slice(0, 4));
  const year = Number(options.year) || currentYear;
  const monthFilter = options.month && options.month !== "all" ? String(options.month).padStart(2, "0") : "all";
  const bankId = options.bankId && options.bankId !== "all" ? options.bankId : "all";
  const list = scopedChecks(checks, banks, bankId);
  const onward = list.filter((row) => countsAsOutstanding(row) && monthKey(row.check_date) >= monthKey(today));
  const throughEnd = list.filter((row) => {
    if (!countsAsOutstanding(row)) return false;
    const dated = String(row.check_date || "");
    return dated >= today && dated <= endOfMonth(today);
  });
  const yearMonths = [];
  for (let month = 1; month <= 12; month += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const mine = list.filter((row) => countsAsIssued(row) && inBank(row, bankId) && monthKey(row.check_date) === key);
    const lastKey = `${year - 1}-${String(month).padStart(2, "0")}`;
    const last = list.filter((row) => countsAsIssued(row) && inBank(row, bankId) && monthKey(row.check_date) === lastKey);
    const byBankMap = new Map();
    mine.forEach((row) => {
      const info = decorate(row, banks);
      const cur = byBankMap.get(info.bank_id) || { bank: info.bank, color: info.color, amount: 0 };
      cur.amount = money(cur.amount + info.amount);
      byBankMap.set(info.bank_id, cur);
    });
    yearMonths.push({
      month: key,
      label: MONTH_SHORT[month - 1],
      total: sumAmounts(mine, (row) => row.amount),
      lastYear: sumAmounts(last, (row) => row.amount),
      byBank: Array.from(byBankMap.values()),
      current: key === monthKey(today),
    });
  }
  const shown = monthFilter === "all" ? yearMonths : yearMonths.filter((row) => row.month.endsWith(`-${monthFilter}`));
  const totalShown = sumAmounts(shown, (row) => row.total);
  const average = shown.length ? money(totalShown / shown.length) : 0;
  let running = 0;
  let runningLast = 0;
  const cumulative = yearMonths.map((row) => {
    running = money(running + row.total);
    runningLast = money(runningLast + row.lastYear);
    return { month: row.month, label: row.label, thisYear: running, lastYear: runningLast };
  });
  const ytdEnd = (() => {
    if (monthFilter !== "all") {
      const end = endOfMonth(`${year}-${monthFilter}-01`);
      if (year === currentYear && end > today) return today;
      return end;
    }
    if (year === currentYear) return today;
    return `${year}-12-31`;
  })();
  const ytd = sumWindow(list, `${year}-01-01`, ytdEnd, bankId);
  const ytdLast = sumWindow(list, shiftYear(`${year}-01-01`, -1), shiftYear(ytdEnd, -1), bankId);
  const lastYearTotal = sumWindow(list, `${year - 1}-01-01`, `${year - 1}-12-31`, bankId);
  const quarters = [1, 2, 3, 4].map((quarter) => {
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return sumWindow(
      list,
      `${year}-${String(startMonth).padStart(2, "0")}-01`,
      endOfMonth(`${year}-${String(endMonth).padStart(2, "0")}-01`),
      bankId
    );
  });
  const focus = monthFilter !== "all" ? `${year}-${monthFilter}` : year === currentYear ? monthKey(today) : `${year}-12`;
  const focusRow = yearMonths.find((row) => row.month === focus) || yearMonths[yearMonths.length - 1];
  const prevDate = addDays(`${focus}-01`, -1).slice(0, 7);
  const prevRow = list.filter((row) => countsAsIssued(row) && inBank(row, bankId) && monthKey(row.check_date) === prevDate);
  const dueUntil = addDays(today, 29);
  const dueMap = new Map();
  list.forEach((row) => {
    if (!countsAsOutstanding(row)) return;
    const dated = String(row.check_date || "");
    if (dated < today || dated > dueUntil) return;
    const bucket = dueMap.get(dated) || [];
    bucket.push(decorate(row, banks));
    dueMap.set(dated, bucket);
  });
  if (!dueMap.has(today)) dueMap.set(today, []);
  const due30 = Array.from(dueMap.keys())
    .sort()
    .map((date) => {
      const rows = dueMap.get(date).sort((a, b) => a.bank.localeCompare(b.bank) || b.amount - a.amount);
      return {
        date,
        label: `${MONTH_SHORT[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8))}`,
        weekday: new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8)))).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
        isToday: date === today,
        total: sumAmounts(rows, (row) => row.amount),
        checks: rows,
      };
    });
  const outMap = new Map();
  list.forEach((row) => {
    if (!countsAsOutstanding(row) || !row.check_date) return;
    const key = monthKey(row.check_date);
    const bucket = outMap.get(key) || [];
    bucket.push(row);
    outMap.set(key, bucket);
  });
  const outstandingMonths = Array.from(outMap.keys())
    .sort()
    .map((key) => {
      const rows = outMap.get(key);
      const banksInMonth = new Map();
      rows.forEach((row) => {
        const info = decorate(row, banks);
        const cur = banksInMonth.get(info.bank_id) || { bank: info.bank, color: info.color, count: 0, amount: 0, checks: [] };
        cur.count += 1;
        cur.amount = money(cur.amount + info.amount);
        cur.checks.push({ id: info.id, payee: info.payee, amount: info.amount });
        banksInMonth.set(info.bank_id, cur);
      });
      return {
        month: key,
        label: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`,
        count: rows.length,
        amount: sumAmounts(rows, (row) => row.amount),
        banks: Array.from(banksInMonth.values()).sort((a, b) => b.amount - a.amount),
      };
    });
  const maxOutstanding = outstandingMonths.reduce((max, row) => Math.max(max, row.amount), 0);
  outstandingMonths.forEach((row) => {
    row.bar = maxOutstanding ? Math.round((row.amount / maxOutstanding) * 1000) / 10 : 0;
  });
  const years = Array.from(new Set(list.map((row) => Number(String(row.check_date || "").slice(0, 4))).filter((value) => value > 1990)));
  if (!years.includes(currentYear)) years.push(currentYear);
  return {
    company: COMPANY,
    today,
    monthName: MONTHS[Number(today.slice(5, 7)) - 1],
    outstandingOnward: sumAmounts(onward, (row) => row.amount),
    dueThroughMonthEnd: sumAmounts(throughEnd, (row) => row.amount),
    filters: { year, month: monthFilter, bankId },
    years: years.sort(),
    banks: (banks || []).map((row) => ({
      id: row.id,
      nickname: row.nickname || row.bank_name,
      personal: Boolean(row.is_personal),
      color: bankColor(row.bank_code || row.nickname),
    })),
    shown,
    yearMonths,
    totalShown,
    average,
    cumulative,
    chips: {
      ytd,
      pctVsLastYear: pctChange(ytd, ytdLast),
      lastYearTotal,
      quarters,
      momPct: pctChange(focusRow ? focusRow.total : 0, sumAmounts(prevRow, (row) => row.amount)),
      momLabel: `${MONTH_SHORT[Number(focus.slice(5, 7)) - 1]} vs ${MONTH_SHORT[Number(prevDate.slice(5, 7)) - 1]}`,
    },
    due30,
    outstandingMonths,
    photos: list.filter((row) => row.photo_url).map((row) => decorate(row, banks)),
  };
}

function auditBooklets(checks, banks) {
  const groups = new Map();
  (checks || []).forEach((row) => {
    const serial = Number(row.serial);
    if (!Number.isInteger(serial)) return;
    const key = `${row.bank_account_id}:${row.booklet_year}`;
    const group = groups.get(key) || { bankId: row.bank_account_id, bookletYear: row.booklet_year, serials: new Set() };
    group.serials.add(serial);
    groups.set(key, group);
  });
  return Array.from(groups.values())
    .map((group) => {
      const nums = Array.from(group.serials).sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < nums.length; i += 1) {
        if (nums[i] - nums[i - 1] <= 1) continue;
        const from = nums[i - 1] + 1;
        const to = nums[i] - 1;
        const count = to - from + 1;
        gaps.push(count > 12 ? { from, to, count } : { from, to, count, numbers: Array.from({ length: count }, (_, index) => from + index) });
      }
      const bank = (banks || []).find((item) => item.id === group.bankId);
      return {
        bankId: group.bankId,
        bank: bank ? bank.nickname || bank.bank_name : "Bank",
        bookletYear: group.bookletYear,
        from: nums[0],
        to: nums[nums.length - 1],
        gaps,
      };
    })
    .filter((group) => group.gaps.length)
    .sort((a, b) => String(a.bank).localeCompare(String(b.bank)) || a.bookletYear - b.bookletYear);
}

module.exports = {
  BANK_COLORS,
  COMPANY,
  STALE_DAYS,
  auditBooklets,
  bankColor,
  checkMonitor,
  compactAmount,
  countsAsIssued,
  countsAsOutstanding,
  shouldStale,
};
