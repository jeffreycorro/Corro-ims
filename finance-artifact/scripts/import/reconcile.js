"use strict";

const { cycleFooter, gcashBalance, monthTotals } = require("../../netlify/lib/sheet-math");

const TARGETS = {
  pcb35CashOnHand: 28242,
  pcb35OpenReleases: 24315,
  gcashBalance: 1394.11,
  sept2026Checks: 11553814.54,
};

async function reconciliation(store) {
  const cycles = await store.list("petty_cycles");
  const cycle = cycles.find((row) => Number(row.cycle_no) === 35);
  let pcb35 = null;
  if (cycle) {
    const cashIns = await store.list("petty_cash_ins", (row) => row.cycle_id === cycle.id);
    const vouchers = await store.list("petty_vouchers", (row) => row.cycle_id === cycle.id);
    const releases = await store.list("petty_releases", (row) => row.cycle_id === cycle.id);
    const footer = cycleFooter({ opening: cycle.opening_balance, cashIns, vouchers, releases });
    pcb35 = {
      label: cycle.label,
      cashOnHand: footer.cashOnHand,
      openReleases: footer.cashReleased,
      matches:
        footer.cashOnHand === TARGETS.pcb35CashOnHand && footer.cashReleased === TARGETS.pcb35OpenReleases,
    };
  }
  const batches = await store.list("wallet_batches");
  const latest = batches.slice().sort((a, b) => Number(b.batch_no) - Number(a.batch_no) || Number(b.year) - Number(a.year))[0];
  let gcash = null;
  if (latest) {
    const cashIns = await store.list("wallet_cash_ins", (row) => row.batch_id === latest.id);
    const expenses = await store.list("wallet_expenses", (row) => row.batch_id === latest.id);
    const receivables = await store.list("wallet_receivables", (row) => row.batch_id === latest.id);
    const balance = gcashBalance({ opening: latest.opening_balance, cashIns, expenses, receivables });
    gcash = { batch: latest.batch_no, balance, matches: balance === TARGETS.gcashBalance };
  }
  const checks = await store.list("checks");
  const sept = monthTotals(checks, "2026-09");
  return {
    targets: TARGETS,
    pcb35,
    gcash,
    sept2026: { total: sept.total, expense: sept.expense, matches: sept.total === TARGETS.sept2026Checks },
  };
}

module.exports = { TARGETS, reconciliation };
