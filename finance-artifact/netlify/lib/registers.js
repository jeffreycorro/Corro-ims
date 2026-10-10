"use strict";

const { fail } = require("./errors");
const { monthKey } = require("./manila");
const {
  CHECKLIST_SITES,
  CLASSIFICATIONS,
  mustParty,
  publicBank,
  saveAlias,
  saveBankAccount,
  seedMasters,
} = require("./masters");
const { nameKey, collapse } = require("./names");
const { publicAccountNo } = require("./mask");
const { buildCheckViews, bankCodeOf, cycleFooter, gcashBalance, monthTotals, parseCheckNo } = require("./sheet-math");

const CHECK_STATUSES = ["issued", "for signature", "ready for pickup", "released", "cleared", "cancelled", "void", "stale"];

function text(value) {
  return collapse(value);
}

function isoDate(value, label) {
  const raw = String(value || "").slice(0, 10);
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) fail("bad_request", `${label} must be a date.`);
  return raw;
}

function pesos(value, label, { negative = false } = {}) {
  const n = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(n) || (!negative && n < 0)) fail("bad_request", `${label} must be a peso amount.`);
  return n;
}

function flag(value) {
  return value === true || value === "true" || value === "yes" || value === "on" || value === 1;
}

function present(value) {
  return value != null && String(value).trim() !== "";
}

async function cycleById(store, id) {
  const cycle = await store.get("petty_cycles", id);
  if (!cycle) fail("not_found", "That petty cash cycle was not found.");
  return cycle;
}

async function cycleDetail(store, cycleId) {
  const cycle = await cycleById(store, cycleId);
  const cashIns = await store.list("petty_cash_ins", (row) => row.cycle_id === cycle.id);
  const vouchers = await store.list("petty_vouchers", (row) => row.cycle_id === cycle.id);
  const ids = new Set(vouchers.map((row) => row.id));
  const receipts = await store.list("petty_receipts", (row) => ids.has(row.voucher_id));
  const releases = await store.list("petty_releases", (row) => row.cycle_id === cycle.id);
  const footer = cycleFooter({ opening: cycle.opening_balance, cashIns, vouchers, releases });
  return { cycle, cashIns, vouchers, receipts, releases, footer };
}

async function openCycle(store, input) {
  await seedMasters(store);
  const year = Number(input.year);
  const cycleNo = Number(input.cycleNo != null ? input.cycleNo : input.cycle_no);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) fail("bad_request", "Cycle year is not valid.");
  if (!Number.isInteger(cycleNo) || cycleNo < 1) fail("bad_request", "Cycle number is not valid.");
  const rows = await store.list("petty_cycles");
  const existing = rows.find((row) => row.year === year && row.cycle_no === cycleNo);
  if (existing) return cycleDetail(store, existing.id);
  const previous = rows
    .filter((row) => row.year < year || (row.year === year && row.cycle_no < cycleNo))
    .sort((a, b) => a.year - b.year || a.cycle_no - b.cycle_no)
    .pop();
  const asked = present(input.openingBalance) ? input.openingBalance : present(input.opening_balance) ? input.opening_balance : null;
  let opening = asked == null ? 0 : pesos(asked, "Opening balance");
  if (asked == null && previous) {
    if (previous.status === "closed" && previous.closing_balance != null) opening = Number(previous.closing_balance);
    else {
      const detail = await cycleDetail(store, previous.id);
      opening = detail.footer.cashOnHand;
    }
  }
  const saved = await store.insert("petty_cycles", {
    year,
    cycle_no: cycleNo,
    label: `PCB ${year}-${cycleNo}`,
    date_from: isoDate(input.dateFrom || input.date_from, "Date from"),
    date_to: isoDate(input.dateTo || input.date_to, "Date to"),
    opening_balance: opening,
    closing_balance: null,
    status: "open",
  });
  return cycleDetail(store, saved.id);
}

async function closeCycle(store, id) {
  const detail = await cycleDetail(store, id);
  const onHand = detail.footer.cashOnHand;
  if (detail.cycle.status !== "closed") {
    await store.update("petty_cycles", detail.cycle.id, { status: "closed", closing_balance: onHand });
  }
  const nextNo = Number(detail.cycle.cycle_no) + 1;
  const rows = await store.list("petty_cycles");
  const next = rows.find((row) => row.year === detail.cycle.year && row.cycle_no === nextNo);
  if (!next) {
    await store.insert("petty_cycles", {
      year: detail.cycle.year,
      cycle_no: nextNo,
      label: `PCB ${detail.cycle.year}-${nextNo}`,
      date_from: "",
      date_to: "",
      opening_balance: onHand,
      closing_balance: null,
      status: "open",
    });
  } else if (next.status === "open") {
    await store.update("petty_cycles", next.id, { opening_balance: onHand });
  }
  return cycleDetail(store, detail.cycle.id);
}

async function saveCashIn(store, input) {
  const cycle = await cycleById(store, input.cycleId || input.cycle_id);
  if (cycle.status === "closed") fail("bad_request", "That cycle is closed.");
  const amount = pesos(input.amount, "Cash in");
  if (amount <= 0) fail("bad_request", "Cash in needs an amount.");
  const source = text(input.sourceType || input.source_type).toUpperCase();
  const sources = await store.list("funding_sources");
  if (source && !sources.some((row) => row.code === source)) fail("bad_request", "Choose a funding source.");
  const reference = text(input.referenceNo || input.reference_no);
  let checkId = input.checkId || input.check_id || null;
  if (checkId) {
    const check = await store.get("checks", checkId);
    if (!check) fail("bad_request", "That check is not on file.");
  }
  return store.insert("petty_cash_ins", {
    cycle_id: cycle.id,
    txn_date: isoDate(input.date || input.txn_date, "Date"),
    source_type: source,
    reference_no: reference,
    check_id: checkId,
    amount,
    import_key: "",
  });
}

async function savePcv(store, input, ctx) {
  const cycle = await cycleById(store, input.cycleId || input.cycle_id);
  if (cycle.status === "closed") fail("bad_request", "That cycle is closed.");
  const employee = await mustParty(store, "employee", input);
  const project = await mustParty(store, "project", input);
  const supplier = await mustParty(store, "supplier", input.supplierId || input.supplier_id ? input : { name: input.supplierName || input.supplier || input.supplier_name });
  const date = isoDate(input.date || input.txn_date, "Date") || (ctx && ctx.today) || "";
  const year = date ? Number(date.slice(0, 4)) : cycle.year;
  const amount = pesos(input.amount, "Voucher amount");
  if (amount <= 0) fail("bad_request", "Voucher amount is required.");
  return store.createNumbered(
    "petty_vouchers",
    "PC",
    year,
    {
      cycle_id: cycle.id,
      txn_date: date,
      employee_id: employee.id,
      employee_name: employee.name,
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      project_id: project.id,
      project_name: project.name,
      vrf_no: text(input.vrfNo || input.vrf_no),
      po_no: text(input.poNo || input.po_no),
      description: text(input.description),
      amount,
      qb_uploaded: flag(input.qbUploaded || input.qb_uploaded),
      scanned: flag(input.scanned),
      remarks: text(input.remarks),
      status: "posted",
    },
    "pcv_no"
  );
}

async function saveReceipt(store, input) {
  const voucher = await store.get("petty_vouchers", input.voucherId || input.voucher_id);
  if (!voucher) fail("not_found", "That petty cash voucher was not found.");
  const classification = text(input.classification);
  if (classification && !CLASSIFICATIONS.includes(classification)) fail("bad_request", "Classification is not on the list.");
  if (nameKey(voucher.supplier_name) === "cash") fail("bad_request", "Cash vouchers have no supplier receipt.");
  return store.insert("petty_receipts", {
    voucher_id: voucher.id,
    si_no: text(input.siNo || input.si_no),
    si_date: isoDate(input.siDate || input.si_date, "SI date"),
    classification,
    invoice_amount: pesos(input.invoiceAmount != null ? input.invoiceAmount : input.invoice_amount, "Invoice amount"),
    tin_snapshot: text(input.tin || input.tin_snapshot),
    import_key: "",
  });
}

async function saveRelease(store, input) {
  const cycle = await cycleById(store, input.cycleId || input.cycle_id);
  if (cycle.status === "closed") fail("bad_request", "That cycle is closed.");
  const employee = await mustParty(store, "employee", input);
  const project = await mustParty(store, "project", input);
  const status = text(input.status || "open").toLowerCase();
  if (!["open", "liquidated", "returned"].includes(status)) fail("bad_request", "Release status is open, liquidated, or returned.");
  let voucherId = input.voucherId || input.voucher_id || null;
  if (voucherId) {
    const voucher = await store.get("petty_vouchers", voucherId);
    if (!voucher) fail("bad_request", "That voucher is not on this fund.");
  }
  return store.insert("petty_releases", {
    cycle_id: cycle.id,
    txn_date: isoDate(input.date || input.txn_date, "Date"),
    employee_id: employee.id,
    employee_name: employee.name,
    description: text(input.description),
    project_id: project.id,
    project_name: project.name,
    vrf_no: text(input.vrfNo || input.vrf_no),
    amount: pesos(input.amount, "Release"),
    status_note: text(input.statusNote || input.status_note),
    status,
    voucher_id: voucherId,
    import_key: "",
  });
}

function pettyPayeeCycle(payee) {
  const match = String(payee || "").match(/petty\s+cash\s+pcb\s+no\.?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function maybeTopUp(store, check) {
  const cycleNo = pettyPayeeCycle(check.payee);
  if (!cycleNo) return null;
  const cycles = await store.list("petty_cycles");
  const cycle = cycles.find((row) => row.cycle_no === cycleNo && row.status === "open") || cycles.find((row) => row.cycle_no === cycleNo);
  if (!cycle) return null;
  const existing = (await store.list("petty_cash_ins")).find((row) => row.check_id === check.id);
  if (existing) return existing;
  return store.insert("petty_cash_ins", {
    cycle_id: cycle.id,
    txn_date: check.date_issued || check.check_date || "",
    source_type: "CHECK",
    reference_no: check.check_no,
    check_id: check.id,
    amount: check.amount,
    import_key: `cash-check:${check.check_no}`,
  });
}

async function saveCheck(store, input) {
  await seedMasters(store);
  const bank = await store.get("bank_accounts", input.bankAccountId || input.bank_account_id);
  if (!bank) fail("bad_request", "Choose a bank account.");
  const checkDate = isoDate(input.checkDate || input.check_date, "Check date");
  const dateIssued = isoDate(input.dateIssued || input.date_issued, "Date issued");
  let parsed = parseCheckNo(input.checkNo || input.check_no);
  const bookletYear = parsed ? parsed.bookletYear : Number(input.bookletYear || input.booklet_year);
  if (!parsed) {
    if (!Number.isInteger(bookletYear)) fail("bad_request", "Check number must look like BPI2026-1000274146, or send the booklet year.");
    const serial = String(input.serial || "").replace(/\D/g, "");
    const next = serial || (await nextCheckSerial(store, bank.id, bookletYear));
    parsed = parseCheckNo(`${bankCodeOf(bank)}${bookletYear}-${next}`);
  }
  if (!parsed) fail("bad_request", "Check number was not accepted.");
  const rows = await store.list("checks");
  if (rows.some((row) => row.check_no === parsed.checkNo && row.id !== input.id)) fail("conflict", `Check ${parsed.checkNo} is already on file.`);
  if (rows.some((row) => row.bank_account_id === bank.id && row.booklet_year === parsed.bookletYear && row.serial === parsed.serial && row.id !== input.id)) {
    fail("conflict", "That serial is already used in this booklet.");
  }
  const status = text(input.status || "issued").toLowerCase() || "issued";
  if (!CHECK_STATUSES.includes(status)) fail("bad_request", "That check status is not on the list.");
  let supplier = null;
  if (input.supplierId || input.supplier_id || input.supplierName || input.payeeSupplier) {
    supplier = await mustParty(store, "supplier", {
      supplierId: input.supplierId || input.supplier_id,
      name: input.supplierName || input.payeeSupplier || input.payee_supplier,
    });
  }
  const banks = await store.list("bank_accounts");
  const payee = text(input.payee);
  const transfer = flag(input.isTransfer || input.is_transfer) || banks.some((row) => nameKey(row.nickname) === nameKey(payee) || nameKey(row.bank_name) === nameKey(payee));
  const saved = await store.insert("checks", {
    bank_account_id: bank.id,
    bank_code: parsed.bankCode,
    booklet_year: parsed.bookletYear,
    serial: parsed.serial,
    check_no: parsed.checkNo,
    date_issued: dateIssued,
    check_date: checkDate,
    payee,
    payee_supplier_id: supplier ? supplier.id : null,
    amount: pesos(input.amount, "Check amount"),
    po_ref: text(input.poRef || input.po_ref || input.po),
    status,
    release_date: isoDate(input.releaseDate || input.release_date, "Release date"),
    received_by: text(input.receivedBy || input.received_by),
    cleared_date: isoDate(input.clearedDate || input.cleared_date, "Cleared date"),
    scanned: flag(input.scanned),
    document_location: text(input.documentLocation || input.document_location),
    photo_url: text(input.photoUrl || input.photo_url),
    notes: text(input.notes),
    remarks: text(input.remarks),
    is_transfer: Boolean(transfer) && !pettyPayeeCycle(payee),
    dv_id: input.dvId || input.dv_id || null,
  });
  await maybeTopUp(store, saved);
  return saved;
}

async function nextCheckSerial(store, bankId, year) {
  const rows = await store.list("checks", (row) => row.bank_account_id === bankId && row.booklet_year === year);
  let max = 0;
  rows.forEach((row) => {
    const n = Number(row.serial);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return String(max + 1);
}

async function saveCheckInvoice(store, input) {
  const check = await store.get("checks", input.checkId || input.check_id);
  if (!check) fail("not_found", "That check was not found.");
  return store.insert("check_invoices", {
    check_id: check.id,
    si_no: text(input.siNo || input.si_no),
    si_date: isoDate(input.siDate || input.si_date, "SI date"),
    amount: pesos(input.amount, "Invoice amount", { negative: true }),
    po_no: text(input.poNo || input.po_no || input.po),
    import_key: "",
  });
}

async function checkPack(store, ctx, range) {
  const checks = await store.list("checks");
  const invoices = await store.list("check_invoices");
  const banks = (await store.list("bank_accounts")).map(publicBank);
  const views = buildCheckViews(checks, ctx.today, range);
  return { checks: views.checks, invoices, banks, monthly: views.monthly, pendingDue: views.pendingDue, payables: views.payables, uncleared: views.uncleared };
}

async function openBatch(store, input) {
  await seedMasters(store);
  const walletId = input.walletId || input.wallet_id || "wallet-gcash";
  const wallet = await store.get("wallets", walletId);
  if (!wallet) fail("bad_request", "That GCash wallet is not on file.");
  const year = Number(input.year);
  const batchNo = Number(input.batchNo != null ? input.batchNo : input.batch_no);
  if (!Number.isInteger(year) || !Number.isInteger(batchNo) || batchNo < 1) fail("bad_request", "Batch year and number are required.");
  const rows = await store.list("wallet_batches");
  const existing = rows.find((row) => row.wallet_id === wallet.id && row.year === year && row.batch_no === batchNo);
  if (existing) return gcashDetail(store, existing.id);
  const previous = rows
    .filter((row) => row.wallet_id === wallet.id && (row.year < year || (row.year === year && row.batch_no < batchNo)))
    .sort((a, b) => a.year - b.year || a.batch_no - b.batch_no)
    .pop();
  const asked = present(input.openingBalance) ? input.openingBalance : present(input.opening_balance) ? input.opening_balance : null;
  let opening = asked == null ? 0 : pesos(asked, "Opening balance");
  if (asked == null && previous) {
    const detail = await gcashDetail(store, previous.id);
    opening = detail.balance;
  }
  const saved = await store.insert("wallet_batches", {
    wallet_id: wallet.id,
    year,
    batch_no: batchNo,
    opening_balance: opening,
    status: "open",
  });
  return gcashDetail(store, saved.id);
}

async function gcashDetail(store, batchId) {
  const batch = await store.get("wallet_batches", batchId);
  if (!batch) fail("not_found", "That GCash batch was not found.");
  const cashIns = await store.list("wallet_cash_ins", (row) => row.batch_id === batch.id);
  const expenses = await store.list("wallet_expenses", (row) => row.batch_id === batch.id);
  const receivables = await store.list("wallet_receivables", (row) => row.batch_id === batch.id);
  const balance = gcashBalance({ opening: batch.opening_balance, cashIns, expenses, receivables });
  return { batch, cashIns, expenses, receivables, balance };
}

async function saveWalletCashIn(store, input) {
  const detail = await gcashDetail(store, input.batchId || input.batch_id);
  const source = text(input.sourceType || input.source_type).toUpperCase();
  return store.insert("wallet_cash_ins", {
    batch_id: detail.batch.id,
    txn_date: isoDate(input.date || input.txn_date, "Date"),
    source_type: source || "J",
    reference_no: text(input.referenceNo || input.reference_no),
    amount: pesos(input.amount, "Top up"),
    import_key: "",
  });
}

async function saveGcashExpense(store, input, ctx) {
  const detail = await gcashDetail(store, input.batchId || input.batch_id);
  const employee = await mustParty(store, "employee", input);
  const project = await mustParty(store, "project", input);
  const supplier = await mustParty(store, "supplier", input.supplierId || input.supplier_id ? input : { name: input.supplierName || input.supplier || "Cash" });
  const date = isoDate(input.date || input.txn_date, "Date") || (ctx && ctx.today) || "";
  const year = date ? Number(date.slice(0, 4)) : detail.batch.year;
  const classification = text(input.classification);
  if (classification && !CLASSIFICATIONS.includes(classification)) fail("bad_request", "Classification is not on the list.");
  return store.createNumbered(
    "wallet_expenses",
    "GC",
    year,
    {
      batch_id: detail.batch.id,
      txn_date: date,
      employee_id: employee.id,
      employee_name: employee.name,
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      project_id: project.id,
      project_name: project.name,
      vrf_no: text(input.vrfNo || input.vrf_no),
      description: text(input.description),
      amount: pesos(input.amount, "Amount"),
      fee: pesos(input.fee || 0, "Fee"),
      si_no: text(input.siNo || input.si_no),
      si_date: isoDate(input.siDate || input.si_date, "SI date"),
      invoice_amount: input.invoiceAmount != null || input.invoice_amount != null ? pesos(input.invoiceAmount != null ? input.invoiceAmount : input.invoice_amount, "Invoice amount") : 0,
      classification,
      scanned: flag(input.scanned),
      remarks: text(input.remarks),
      bill_instance_id: input.billInstanceId || input.bill_instance_id || null,
      status: "posted",
    },
    "ref_no"
  );
}

async function saveReceivable(store, input) {
  const detail = await gcashDetail(store, input.batchId || input.batch_id);
  return store.insert("wallet_receivables", {
    batch_id: detail.batch.id,
    person_name: text(input.personName || input.person_name),
    description: text(input.description),
    amount: pesos(input.amount, "Receivable"),
    status: text(input.status || "open").toLowerCase() === "collected" ? "collected" : "open",
    import_key: "",
  });
}

async function saveChecklistBill(store, input) {
  const category = text(input.category);
  const biller = text(input.biller);
  if (!category || !biller) fail("bad_request", "Site and biller are required.");
  const method = text(input.paymentMethod || input.payment_method || "check");
  if (!["GCash", "check", "bank"].includes(method)) fail("bad_request", "Payment method is GCash, check, or bank.");
  const { protectAccount } = require("./mask");
  const protectedNo = protectAccount(input.accountNo != null ? input.accountNo : input.account_no);
  const saved = await store.insert("checklist_bills", {
    category,
    biller,
    account_no: protectedNo.account_no,
    account_name: text(input.accountName || input.account_name),
    frequency: text(input.frequency || "monthly"),
    payment_method: method,
    active: true,
    import_key: "",
  });
  if (protectedNo.ciphertext) {
    await store.insert("bank_secrets", { id: `bill-${saved.id}`, account_id: saved.id, ciphertext: protectedNo.ciphertext });
  }
  return { ...saved, account_no: publicAccountNo(saved.account_no) };
}

async function saveChecklistInstance(store, input) {
  const bill = await store.get("checklist_bills", input.billId || input.bill_id);
  if (!bill) fail("not_found", "That bill was not found.");
  const month = String(input.month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) fail("bad_request", "Month must be YYYY-MM.");
  const status = text(input.status || "unpaid").toLowerCase();
  if (!["paid", "unpaid", "n-a"].includes(status)) fail("bad_request", "Status is paid, unpaid, or n-a.");
  const kind = text(input.paymentKind || input.payment_kind);
  if (kind && !["check", "gcash", "dv"].includes(kind)) fail("bad_request", "Payment link is check, gcash, or dv.");
  const rows = await store.list("checklist_instances");
  const existing = rows.find((row) => row.bill_id === bill.id && row.month === month);
  const patch = {
    bill_id: bill.id,
    month,
    amount: pesos(input.amount || 0, "Amount"),
    due_date: isoDate(input.dueDate || input.due_date, "Due date"),
    paid_date: isoDate(input.paidDate || input.paid_date, "Paid date"),
    status,
    payment_kind: kind,
    payment_id: input.paymentId || input.payment_id || null,
  };
  if (existing) return store.update("checklist_instances", existing.id, patch);
  return store.insert("checklist_instances", { ...patch, import_key: "" });
}

function checklistDue(instances, today) {
  return (instances || []).filter((row) => {
    if (row.status === "paid" || row.status === "n-a" || !row.due_date) return false;
    return row.due_date <= today.slice(0, 10) || (row.due_date >= today && row.due_date <= addWeek(today));
  }).map((row) => ({ ...row, bucket: row.due_date < today ? "overdue" : "due" }));
}

function addWeek(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 6));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

async function saveEmployee(store, input) {
  const name = text(input.name);
  const key = nameKey(name);
  if (!key) fail("bad_request", "Employee name is required.");
  const rows = await store.list("employees");
  const existing = input.id ? await store.get("employees", input.id) : rows.find((row) => row.name_key === key);
  if (!input.id && existing) return existing;
  const patch = { name, name_key: key, department: text(input.department), hr_id: text(input.hrId || input.hr_id), active: input.active !== false };
  if (existing) return store.update("employees", existing.id, patch);
  return store.insert("employees", patch);
}

async function saveRentalUnit(store, input) {
  const name = text(input.name);
  if (!name) fail("bad_request", "Unit name is required.");
  return store.insert("rental_units", { name, site: text(input.site), active: true });
}

async function saveRentalReceipt(store, input) {
  const unit = await store.get("rental_units", input.unitId || input.unit_id);
  if (!unit) fail("not_found", "That rental unit was not found.");
  const month = String(input.month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) fail("bad_request", "Month must be YYYY-MM.");
  const rows = await store.list("rental_receipts");
  const existing = rows.find((row) => row.unit_id === unit.id && row.month === month);
  const patch = {
    unit_id: unit.id,
    month,
    amount: pesos(input.amount, "Rent"),
    received_on: isoDate(input.receivedOn || input.received_on, "Received on"),
    reference: text(input.reference),
  };
  if (existing) return store.update("rental_receipts", existing.id, patch);
  return store.insert("rental_receipts", patch);
}

async function savePropertyTax(store, input) {
  const site = text(input.site);
  const year = Number(input.year);
  if (!site || !Number.isInteger(year)) fail("bad_request", "Site and year are required.");
  const rows = await store.list("property_taxes");
  const existing = rows.find((row) => nameKey(row.site) === nameKey(site) && Number(row.year) === year);
  const patch = {
    site,
    year,
    amount: pesos(input.amount || 0, "Tax"),
    paid_date: isoDate(input.paidDate || input.paid_date, "Paid date"),
    status: text(input.status || "unpaid") || "unpaid",
    reference: text(input.reference),
  };
  if (existing) return store.update("property_taxes", existing.id, patch);
  return store.insert("property_taxes", patch);
}

async function sheetSummary(store, ctx) {
  const cycles = await store.list("petty_cycles");
  const open = cycles.filter((row) => row.status === "open").sort((a, b) => b.year - a.year || b.cycle_no - a.cycle_no)[0];
  let petty = null;
  if (open) {
    const detail = await cycleDetail(store, open.id);
    petty = { label: open.label, cashOnHand: detail.footer.cashOnHand, cashReleased: detail.footer.cashReleased };
  }
  const checks = await store.list("checks");
  const month = monthKey(ctx.today || "");
  const totals = month ? monthTotals(checks, month) : { total: 0, expense: 0 };
  const views = buildCheckViews(checks, ctx.today || "2000-01-01");
  const batches = await store.list("wallet_batches");
  const batch = batches.slice().sort((a, b) => b.year - a.year || b.batch_no - a.batch_no)[0];
  let gcash = null;
  if (batch) {
    const detail = await gcashDetail(store, batch.id);
    gcash = { label: `${batch.year} batch ${batch.batch_no}`, balance: detail.balance };
  }
  const instances = await store.list("checklist_instances");
  const due = checklistDue(instances, ctx.today || "2000-01-01");
  return { petty, gcash, checkMonth: totals, pendingChecks: views.pendingDue.length, checklistDue: due.length };
}

async function sheetState(store, body, ctx) {
  await seedMasters(store);
  const view = String(body.view || "petty");
  const employees = await store.list("employees");
  const projects = await store.list("projects");
  const suppliers = await store.list("suppliers");
  const funding = await store.list("funding_sources");
  const banks = (await store.list("bank_accounts")).map(publicBank);
  const base = { employees, projects, suppliers, funding, banks, sites: CHECKLIST_SITES, classifications: CLASSIFICATIONS };
  if (view === "masters") {
    return {
      ...base,
      aliases: {
        employees: await store.list("employee_aliases"),
        projects: await store.list("project_aliases"),
        suppliers: await store.list("supplier_aliases"),
      },
    };
  }
  if (view === "checks") {
    const pack = await checkPack(store, ctx, { from: body.from || "", to: body.to || "" });
    return { ...base, ...pack };
  }
  if (view === "gcash") {
    const batches = await store.list("wallet_batches");
    const batch = body.batchId ? await store.get("wallet_batches", body.batchId) : batches.slice().sort((a, b) => b.year - a.year || b.batch_no - a.batch_no)[0];
    const detail = batch ? await gcashDetail(store, batch.id) : { batch: null, cashIns: [], expenses: [], receivables: [], balance: 0 };
    return { ...base, batches, ...detail };
  }
  if (view === "checklist") {
    const bills = (await store.list("checklist_bills")).map((row) => ({ ...row, account_no: publicAccountNo(row.account_no) }));
    const instances = await store.list("checklist_instances");
    return {
      ...base,
      bills,
      instances,
      due: checklistDue(instances, ctx.today),
      rentals: await store.list("rental_units"),
      rentalReceipts: await store.list("rental_receipts"),
      taxes: await store.list("property_taxes"),
    };
  }
  const cycles = await store.list("petty_cycles");
  const selected = body.cycleId
    ? cycles.find((row) => row.id === body.cycleId)
    : cycles.slice().sort((a, b) => b.year - a.year || b.cycle_no - a.cycle_no)[0];
  const detail = selected ? await cycleDetail(store, selected.id) : { cycle: null, cashIns: [], vouchers: [], receipts: [], releases: [], footer: null };
  return { ...base, cycles, ...detail };
}

async function ensureCheckForVoucher(store, voucher) {
  if (!voucher || voucher.release_method !== "Check") return null;
  const parsed = parseCheckNo(voucher.check_no);
  if (!parsed) return null;
  await seedMasters(store);
  const existing = (await store.list("checks")).find((row) => row.check_no === parsed.checkNo);
  if (existing) {
    if (!existing.dv_id) return store.update("checks", existing.id, { dv_id: voucher.id });
    return existing;
  }
  const banks = await store.list("bank_accounts");
  const bank = banks.find((row) => nameKey(row.nickname) === nameKey(voucher.check_bank) || nameKey(row.bank_code) === nameKey(parsed.bankCode) || nameKey(row.bank_name) === nameKey(voucher.check_bank));
  if (!bank) return null;
  return saveCheck(store, {
    bankAccountId: bank.id,
    checkNo: parsed.checkNo,
    checkDate: voucher.check_date,
    dateIssued: voucher.released_on,
    payee: voucher.payee,
    amount: voucher.net_amount,
    status: "released",
    receivedBy: voucher.receiver_name,
    releaseDate: voucher.released_on,
    dvId: voucher.id,
  });
}

async function handleSheet(op, store, body, ctx) {
  if (op === "sheetState") return { body: { state: await sheetState(store, body, ctx) } };
  if (op === "sheetSummary") return { body: { sheets: await sheetSummary(store, ctx) } };
  if (op === "saveEmployee") return { body: { employee: await saveEmployee(store, body) } };
  if (op === "saveAlias") return { body: { alias: await saveAlias(store, body) } };
  if (op === "saveBank") return { body: { bank: await saveBankAccount(store, body) } };
  if (op === "openCycle") return { body: await openCycle(store, body) };
  if (op === "closeCycle") return { body: await closeCycle(store, body.id) };
  if (op === "saveCashIn") return { body: { cashIn: await saveCashIn(store, body) } };
  if (op === "savePcv") return { body: { voucher: await savePcv(store, body, ctx) } };
  if (op === "saveReceipt") return { body: { receipt: await saveReceipt(store, body) } };
  if (op === "saveRelease") return { body: { release: await saveRelease(store, body) } };
  if (op === "saveCheck") return { body: { check: await saveCheck(store, body) } };
  if (op === "saveCheckInvoice") return { body: { invoice: await saveCheckInvoice(store, body) } };
  if (op === "openBatch") return { body: await openBatch(store, body) };
  if (op === "saveWalletCashIn") return { body: { cashIn: await saveWalletCashIn(store, body) } };
  if (op === "saveGcashExpense") return { body: { expense: await saveGcashExpense(store, body, ctx) } };
  if (op === "saveReceivable") return { body: { receivable: await saveReceivable(store, body) } };
  if (op === "saveChecklistBill") return { body: { bill: await saveChecklistBill(store, body) } };
  if (op === "saveChecklistInstance") return { body: { instance: await saveChecklistInstance(store, body) } };
  if (op === "saveRentalUnit") return { body: { unit: await saveRentalUnit(store, body) } };
  if (op === "saveRentalReceipt") return { body: { receipt: await saveRentalReceipt(store, body) } };
  if (op === "savePropertyTax") return { body: { tax: await savePropertyTax(store, body) } };
  if (op === "importApply") {
    const { applyImport } = require("../../scripts/import/load");
    const { reconciliation } = require("../../scripts/import/reconcile");
    const loaded = await applyImport(store, body.doc || body);
    return { body: { loaded, reconciliation: await reconciliation(store) } };
  }
  return null;
}

module.exports = {
  checkPack,
  closeCycle,
  cycleDetail,
  ensureCheckForVoucher,
  gcashDetail,
  handleSheet,
  openBatch,
  openCycle,
  saveCashIn,
  saveCheck,
  saveCheckInvoice,
  saveGcashExpense,
  savePcv,
  saveReceipt,
  saveRelease,
  sheetSummary,
};
