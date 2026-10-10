"use strict";

const { AP_BUCKETS, CA_BUCKETS, billRemaining, billStatusFor, bucketTotals, caBucket, classifyBill, dueThisWeek } = require("./aging");
const {
  dedupeSuppliers,
  mapHrAdvance,
  mapHrEmployee,
  mapHrProject,
  mapMotorpoolProjects,
  mapMotorpoolReserve,
  mapMotorpoolSuppliers,
} = require("./adapters");
const { fail } = require("./errors");
const { employeePosition, liquidationMath } = require("./liquidation");
const { daysBetween, monthKey } = require("./manila");
const { computeWithholding, round2 } = require("./money");
const { collapse, nameKey } = require("./names");
const { resolveAction, CA_ACTIONS, DV_ACTIONS } = require("./workflow");

const DEFAULT_ACCOUNTS = [
  { code: "5100", name: "Materials", kind: "expense" },
  { code: "5200", name: "Labor", kind: "expense" },
  { code: "5300", name: "Equipment rental", kind: "expense" },
  { code: "5400", name: "Fuel and toll", kind: "expense" },
  { code: "5500", name: "Subcontract", kind: "expense" },
  { code: "5600", name: "Permits and fees", kind: "expense" },
  { code: "5700", name: "Utilities", kind: "expense" },
  { code: "5800", name: "Office and admin", kind: "expense" },
  { code: "5900", name: "Cash advance", kind: "asset" },
  { code: "1100", name: "Petty cash", kind: "asset" },
  { code: "2000", name: "Accounts payable", kind: "liability" },
];

const DEFAULT_SIGNATORIES = [
  { slot: "prepared", person_name: "Finance Officer", title: "Prepared by" },
  { slot: "checked", person_name: "Evaluator", title: "Checked by" },
  { slot: "approved", person_name: "Jeffrey Corro", title: "Approved by" },
];

const DEPARTMENTS = ["admin", "technical", "finance", "procurement", "motorpool", "safety", "site", "hr"];

function actorName(ctx) {
  return (ctx && (ctx.name || ctx.email || ctx.sub)) || "";
}

function todayOf(ctx) {
  return (ctx && ctx.today) || new Date().toISOString().slice(0, 10);
}

function nowOf(ctx) {
  return (ctx && ctx.now) || new Date().toISOString();
}

function yearOf(ctx) {
  return Number(String(todayOf(ctx)).slice(0, 4));
}

function event(ctx, action, from, to) {
  return { at: nowOf(ctx), by: actorName(ctx), action, from: from || "", to: to || "" };
}

function pushEvent(row, entry) {
  const events = Array.isArray(row.events) ? row.events.slice() : [];
  events.push(entry);
  return events;
}

async function seedReference(store) {
  const accounts = await store.list("accounts");
  if (!accounts.length) {
    for (const row of DEFAULT_ACCOUNTS) {
      await store.insert("accounts", { ...row, active: true });
    }
  }
  const signs = await store.list("signatories");
  const have = new Set(signs.map((row) => row.slot));
  for (const row of DEFAULT_SIGNATORIES) {
    if (!have.has(row.slot)) await store.insert("signatories", { ...row, id: row.slot, image_data: "" });
  }
  const { seedMasters } = require("./masters");
  await seedMasters(store);
}

async function requireProject(store, name) {
  const key = nameKey(name);
  if (!key) fail("bad_request", "Choose a project.");
  const rows = await store.list("projects");
  const found = rows.find((row) => row.name_key === key && row.active !== false);
  if (!found) fail("bad_request", "That project is not on the shared list. Add it under Projects first.");
  return found;
}

function taxFrom(input) {
  return computeWithholding({
    amount: input.amount,
    vatMode: input.vatMode != null ? input.vatMode : input.vat_mode,
    vatRate: input.vatRate != null ? input.vatRate : input.vat_rate,
    ewtRate: input.ewtRate != null ? input.ewtRate : input.ewt_rate,
  });
}

function text(value) {
  return collapse(value);
}

async function openVouchersFor(store, sourceKind, sourceId) {
  const rows = await store.list("vouchers");
  return rows.filter(
    (row) => row.source_kind === sourceKind && String(row.source_id || "") === String(sourceId) && row.status !== "Cancelled"
  );
}

async function assertBillRoom(store, billId, amount, ignoreVoucherId) {
  const bill = await store.get("bills", billId);
  if (!bill || bill.status === "Cancelled") fail("bad_request", "That supplier bill is not open.");
  const payments = await store.list("payments", (row) => row.bill_id === bill.id && row.voided !== true);
  const linked = await openVouchersFor(store, "supplier_bill", bill.id);
  const committed = round2(
    linked
      .filter((row) => row.id !== ignoreVoucherId && row.status !== "Released" && row.status !== "Cleared")
      .reduce((sum, row) => sum + round2(row.net_amount), 0)
  );
  const remaining = billRemaining(bill, payments).remaining;
  if (round2(amount) - round2(remaining - committed) > 0.009) {
    fail("bad_request", "That payment is more than the bill still owes.");
  }
  return bill;
}

async function assertAdvanceRelease(store, advanceId) {
  const advance = await store.get("advances", advanceId);
  if (!advance || advance.status !== "Approved") {
    fail("bad_request", "Release a cash advance only after it is approved.");
  }
  const linked = await openVouchersFor(store, "cash_advance", advance.id);
  if (linked.length) fail("conflict", "This cash advance already has a disbursement voucher.");
  return advance;
}

async function createVoucher(store, input, ctx) {
  const project = await requireProject(store, input.projectName || input.project_name);
  const tax = taxFrom(input);
  if (tax.gross <= 0) fail("bad_request", "Amount must be greater than zero.");
  const payee = text(input.payee);
  if (!payee) fail("bad_request", "Payee is required.");
  const particulars = text(input.particulars);
  if (!particulars) fail("bad_request", "Particulars are required.");
  const accountName = text(input.accountName || input.account_name);
  if (!accountName) fail("bad_request", "Choose an account.");
  const sourceKind = text(input.sourceKind || input.source_kind) || "manual";
  const sourceId = input.sourceId || input.source_id || null;
  if (sourceKind === "supplier_bill" && sourceId) await assertBillRoom(store, sourceId, tax.net, null);
  if (sourceKind === "cash_advance" && sourceId) await assertAdvanceRelease(store, sourceId);
  return store.createNumbered(
    "vouchers",
    "DV",
    input.year || yearOf(ctx),
    {
      status: "Draft",
      payee,
      project_id: project.id,
      project_name: project.name,
      particulars,
      account_code: text(input.accountCode || input.account_code),
      account_name: accountName,
      amount: tax.amount,
      vat_mode: tax.vatMode,
      vat_rate: tax.vatRate,
      vat_amount: tax.vat,
      ewt_rate: tax.ewtRate,
      ewt_amount: tax.ewt,
      vatable_base: tax.vatable,
      gross_amount: tax.gross,
      net_amount: tax.net,
      source_kind: sourceKind,
      source_id: sourceId,
      check_bank: "",
      check_no: "",
      check_date: "",
      release_method: "",
      receiver_name: "",
      receiver_signature: "",
      created_by: actorName(ctx),
      events: [event(ctx, "create", "", "Draft")],
    },
    "dv_no"
  );
}

async function updateVoucher(store, id, input, ctx) {
  const row = await store.get("vouchers", id);
  if (!row) fail("not_found", "Voucher not found.");
  if (row.status !== "Draft") fail("conflict", "Only a draft voucher can be edited.");
  const project = await requireProject(store, input.projectName || input.project_name || row.project_name);
  const tax = taxFrom({
    amount: input.amount != null ? input.amount : row.amount,
    vatMode: input.vatMode != null ? input.vatMode : input.vat_mode != null ? input.vat_mode : row.vat_mode,
    vatRate: input.vatRate != null ? input.vatRate : input.vat_rate != null ? input.vat_rate : row.vat_rate,
    ewtRate: input.ewtRate != null ? input.ewtRate : input.ewt_rate != null ? input.ewt_rate : row.ewt_rate,
  });
  if (tax.gross <= 0) fail("bad_request", "Amount must be greater than zero.");
  const payee = text(input.payee != null ? input.payee : row.payee);
  const particulars = text(input.particulars != null ? input.particulars : row.particulars);
  const accountName = text(input.accountName || input.account_name || row.account_name);
  if (!payee || !particulars || !accountName) fail("bad_request", "Payee, particulars, and account are required.");
  if (row.source_kind === "supplier_bill" && row.source_id) {
    await assertBillRoom(store, row.source_id, tax.net, row.id);
  }
  return store.update(
    "vouchers",
    row.id,
    {
      payee,
      project_id: project.id,
      project_name: project.name,
      particulars,
      account_code: text(input.accountCode || input.account_code || row.account_code),
      account_name: accountName,
      amount: tax.amount,
      vat_mode: tax.vatMode,
      vat_rate: tax.vatRate,
      vat_amount: tax.vat,
      ewt_rate: tax.ewtRate,
      ewt_amount: tax.ewt,
      vatable_base: tax.vatable,
      gross_amount: tax.gross,
      net_amount: tax.net,
      events: pushEvent(row, event(ctx, "edit", row.status, row.status)),
    },
    { status: "Draft" }
  );
}

function signatoryName(rows, slot, fallback) {
  const row = (rows || []).find((item) => item.slot === slot);
  return (row && row.person_name) || fallback;
}

function releasePatch(input, ctx) {
  const method = text(input.releaseMethod || input.release_method);
  if (method !== "Check" && method !== "Cash") fail("bad_request", "Release as Check or Cash.");
  const receiver = text(input.receiverName || input.receiver_name);
  if (!receiver) fail("bad_request", "Receiver name is required.");
  const signature = String(input.receiverSignature || input.receiver_signature || "");
  if (!/^data:image\/(png|jpeg|jpg);base64,/i.test(signature)) {
    fail("bad_request", "Receiver signature is required.");
  }
  if (signature.length > 500000) fail("bad_request", "Receiver signature is too large.");
  const patch = {
    release_method: method,
    receiver_name: receiver,
    receiver_signature: signature,
    receiver_signed_at: nowOf(ctx),
    released_at: nowOf(ctx),
    released_on: todayOf(ctx),
  };
  if (method === "Check") {
    const bank = text(input.checkBank || input.check_bank);
    const checkNo = text(input.checkNo || input.check_no);
    const checkDate = String(input.checkDate || input.check_date || "").slice(0, 10);
    if (!bank || !checkNo || !/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) {
      fail("bad_request", "Check release needs the bank, check number, and date.");
    }
    patch.check_bank = bank;
    patch.check_no = checkNo;
    patch.check_date = checkDate;
  }
  return patch;
}

async function applyReleasedLinks(store, voucher, ctx) {
  if (voucher.source_kind === "cash_advance" && voucher.source_id) {
    const advance = await store.get("advances", voucher.source_id);
    if (advance && advance.status === "Approved") {
      await store.update(
        "advances",
        advance.id,
        {
          status: "Released",
          voucher_id: voucher.id,
          released_at: voucher.released_at,
          released_on: voucher.released_on || todayOf(ctx),
          events: pushEvent(advance, event(ctx, "release", "Approved", "Released")),
        },
        { status: "Approved" }
      );
    }
  }
  if (voucher.source_kind === "reimbursement" && voucher.source_id) {
    const advance = await store.get("advances", voucher.source_id);
    if (advance && advance.status === "Liquidated" && !advance.reimbursement_paid) {
      await store.update(
        "advances",
        advance.id,
        { reimbursement_paid: true, reimbursement_voucher_id: voucher.id },
        { status: "Liquidated" }
      );
    }
  }
  if (voucher.source_kind === "supplier_bill" && voucher.source_id) {
    const existing = await store.list("payments", (row) => row.voucher_id === voucher.id && row.voided !== true);
    if (!existing.length) {
      await store.insert("payments", {
        bill_id: voucher.source_id,
        voucher_id: voucher.id,
        amount: round2(voucher.net_amount),
        paid_on: voucher.released_on || todayOf(ctx),
        created_by: actorName(ctx),
        voided: false,
      });
    }
    await refreshBill(store, voucher.source_id);
  }
}

async function refreshBill(store, billId) {
  const bill = await store.get("bills", billId);
  if (!bill || bill.status === "Cancelled") return bill;
  const payments = await store.list("payments", (row) => row.bill_id === bill.id && row.voided !== true);
  const paid = round2(payments.reduce((sum, row) => sum + round2(row.amount), 0));
  const status = billStatusFor(round2(bill.net_amount), paid, bill.status);
  return store.update("bills", bill.id, { paid_amount: paid, status }, { status: bill.status });
}

async function transitionVoucher(store, id, action, input, ctx) {
  const row = await store.get("vouchers", id);
  if (!row) fail("not_found", "Voucher not found.");
  const spec = resolveAction(DV_ACTIONS, row.status, action);
  if (spec.approver && !(ctx && ctx.approverOk)) {
    fail("approver_password", "That approver password does not match.");
  }
  const signs = await store.list("signatories");
  const patch = { status: spec.to, events: pushEvent(row, event(ctx, action, row.status, spec.to)) };
  if (action === "submit") {
    patch.prepared_by = signatoryName(signs, "prepared", actorName(ctx));
    patch.prepared_at = nowOf(ctx);
  }
  if (action === "check") {
    patch.checked_by = signatoryName(signs, "checked", actorName(ctx));
    patch.checked_at = nowOf(ctx);
  }
  if (action === "approve") {
    patch.approved_by = signatoryName(signs, "approved", "Jeffrey Corro");
    patch.approved_at = nowOf(ctx);
  }
  if (action === "release") {
    if (row.source_kind === "supplier_bill" && row.source_id) {
      await assertBillRoom(store, row.source_id, row.net_amount, row.id);
    }
    Object.assign(patch, releasePatch(input || {}, ctx));
  }
  if (action === "clear") patch.cleared_at = nowOf(ctx);
  if (action === "cancel") patch.cancelled_at = nowOf(ctx);
  const saved = await store.update("vouchers", row.id, patch, { status: row.status });
  if (saved.status === "Released") await applyReleasedLinks(store, saved, ctx);
  return store.get("vouchers", saved.id);
}

async function reconcile(store, ctx) {
  const vouchers = await store.list("vouchers");
  for (const voucher of vouchers) {
    if (voucher.status !== "Released" && voucher.status !== "Cleared") continue;
    await applyReleasedLinks(store, voucher, ctx || {});
  }
}

async function createAdvance(store, input, ctx) {
  const project = await requireProject(store, input.projectName || input.project_name);
  const amount = round2(input.amount);
  if (amount <= 0) fail("bad_request", "Amount must be greater than zero.");
  const employee = text(input.employeeName || input.employee_name || input.employee);
  if (!employee) fail("bad_request", "Employee is required.");
  const purpose = text(input.purpose);
  if (!purpose) fail("bad_request", "Purpose is required.");
  const department = text(input.department).toLowerCase();
  if (!DEPARTMENTS.includes(department)) fail("bad_request", "Choose a department.");
  const dateNeeded = String(input.dateNeeded || input.date_needed || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateNeeded)) fail("bad_request", "Date needed is required.");
  return store.createNumbered(
    "advances",
    "CA",
    input.year || yearOf(ctx),
    {
      status: "Draft",
      employee_name: employee,
      employee_id: text(input.employeeId || input.employee_id),
      department,
      purpose,
      project_id: project.id,
      project_name: project.name,
      amount,
      date_needed: dateNeeded,
      voucher_id: null,
      hr_source_id: input.hrSourceId || input.hr_source_id || null,
      motorpool_source_id: input.motorpoolSourceId || input.motorpool_source_id || null,
      source_number: text(input.sourceNumber || input.source_number),
      liquidated_amount: 0,
      refund_amount: 0,
      reimbursement_amount: 0,
      refund_received: false,
      reimbursement_paid: false,
      reimbursement_voucher_id: null,
      created_by: actorName(ctx),
      events: [event(ctx, "create", "", "Draft")],
    },
    "ca_no"
  );
}

async function updateAdvance(store, id, input, ctx) {
  const row = await store.get("advances", id);
  if (!row) fail("not_found", "Cash advance not found.");
  if (row.status !== "Draft") fail("conflict", "Only a draft cash advance can be edited.");
  const project = await requireProject(store, input.projectName || input.project_name || row.project_name);
  const amount = round2(input.amount != null ? input.amount : row.amount);
  if (amount <= 0) fail("bad_request", "Amount must be greater than zero.");
  const employee = text(input.employeeName || input.employee_name || row.employee_name);
  const purpose = text(input.purpose != null ? input.purpose : row.purpose);
  const department = text(input.department || row.department).toLowerCase();
  const dateNeeded = String(input.dateNeeded || input.date_needed || row.date_needed).slice(0, 10);
  if (!employee || !purpose || !DEPARTMENTS.includes(department) || !/^\d{4}-\d{2}-\d{2}$/.test(dateNeeded)) {
    fail("bad_request", "Employee, department, purpose, and date needed are required.");
  }
  return store.update(
    "advances",
    row.id,
    {
      employee_name: employee,
      employee_id: text(input.employeeId || input.employee_id || row.employee_id),
      department,
      purpose,
      project_id: project.id,
      project_name: project.name,
      amount,
      date_needed: dateNeeded,
      events: pushEvent(row, event(ctx, "edit", row.status, row.status)),
    },
    { status: "Draft" }
  );
}

async function transitionAdvance(store, id, action, input, ctx) {
  const row = await store.get("advances", id);
  if (!row) fail("not_found", "Cash advance not found.");
  const spec = resolveAction(CA_ACTIONS, row.status, action);
  if (spec.approver && !(ctx && ctx.approverOk)) {
    fail("approver_password", "That approver password does not match.");
  }
  const signs = await store.list("signatories");
  const patch = { status: spec.to, events: pushEvent(row, event(ctx, action, row.status, spec.to)) };
  if (action === "submit") {
    patch.prepared_by = signatoryName(signs, "prepared", actorName(ctx));
    patch.prepared_at = nowOf(ctx);
  }
  if (action === "check") {
    patch.checked_by = signatoryName(signs, "checked", actorName(ctx));
    patch.checked_at = nowOf(ctx);
  }
  if (action === "approve") {
    patch.approved_by = signatoryName(signs, "approved", "Jeffrey Corro");
    patch.approved_at = nowOf(ctx);
  }
  if (action === "cancel") patch.cancelled_at = nowOf(ctx);
  if (action === "receive_refund") {
    if (round2(row.refund_amount) <= 0) fail("bad_request", "This advance has no refund to receive.");
    patch.refund_received = true;
    patch.refund_received_at = nowOf(ctx);
  }
  return store.update("advances", row.id, patch, { status: row.status });
}

async function releaseAdvance(store, id, ctx) {
  const advance = await assertAdvanceRelease(store, id);
  return createVoucher(
    store,
    {
      payee: advance.employee_name,
      projectName: advance.project_name,
      particulars: `Cash advance ${advance.ca_no} — ${advance.purpose}`,
      accountCode: "5900",
      accountName: "Cash advance",
      amount: advance.amount,
      vatMode: "none",
      ewtRate: 0,
      sourceKind: "cash_advance",
      sourceId: advance.id,
    },
    ctx
  );
}

function normalizeReceipts(input) {
  const rows = Array.isArray(input) ? input : input && Array.isArray(input.receipts) ? input.receipts : [];
  return rows.map((row) => {
    const amount = round2(row && row.amount);
    if (amount < 0) fail("bad_request", "A receipt amount cannot be negative.");
    const date = String((row && (row.date || row.receipt_date)) || "").slice(0, 10);
    if (amount > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("bad_request", "Each receipt needs a date.");
    return {
      receipt_date: date,
      particulars: text(row && row.particulars) || "Receipt",
      amount,
      attachment_id: (row && (row.attachmentId || row.attachment_id)) || null,
    };
  }).filter((row) => row.amount > 0 || row.receipt_date);
}

async function addReceipt(store, advanceId, input, ctx) {
  const advance = await store.get("advances", advanceId);
  if (!advance) fail("not_found", "Cash advance not found.");
  if (advance.status !== "Released") fail("conflict", "Receipts are added after the cash advance is released.");
  const [row] = normalizeReceipts([input]);
  if (!row || row.amount <= 0) fail("bad_request", "Receipt amount is required.");
  return store.insert("receipts", { ...row, advance_id: advance.id, created_by: actorName(ctx) });
}

async function postLiquidation(store, advanceId, input, ctx) {
  const advance = await store.get("advances", advanceId);
  if (!advance) fail("not_found", "Cash advance not found.");
  if (advance.status !== "Released") fail("conflict", "Liquidate a cash advance only after it is released.");
  const extra = normalizeReceipts(input || {});
  for (const row of extra) {
    await store.insert("receipts", { ...row, advance_id: advance.id, created_by: actorName(ctx) });
  }
  const receipts = await store.list("receipts", (row) => row.advance_id === advance.id);
  const math = liquidationMath(advance.amount, receipts);
  return store.update(
    "advances",
    advance.id,
    {
      status: "Liquidated",
      liquidated_amount: math.actual,
      refund_amount: math.refund,
      reimbursement_amount: math.reimbursement,
      refund_received: math.refund === 0,
      reimbursement_paid: math.reimbursement === 0,
      liquidated_at: nowOf(ctx),
      liquidated_on: todayOf(ctx),
      events: pushEvent(advance, event(ctx, "liquidate", "Released", "Liquidated")),
    },
    { status: "Released" }
  );
}

async function reimburseAdvance(store, id, ctx) {
  const advance = await store.get("advances", id);
  if (!advance || advance.status !== "Liquidated") fail("conflict", "Reimburse only a liquidated cash advance.");
  if (round2(advance.reimbursement_amount) <= 0) fail("bad_request", "Nothing to reimburse.");
  if (advance.reimbursement_paid || advance.reimbursement_voucher_id) {
    fail("conflict", "A reimbursement voucher is already on this advance.");
  }
  const voucher = await createVoucher(
    store,
    {
      payee: advance.employee_name,
      projectName: advance.project_name,
      particulars: `Reimbursement for ${advance.ca_no} — ${advance.purpose}`,
      accountCode: "5900",
      accountName: "Cash advance",
      amount: advance.reimbursement_amount,
      vatMode: "none",
      ewtRate: 0,
      sourceKind: "reimbursement",
      sourceId: advance.id,
    },
    ctx
  );
  await store.update(
    "advances",
    advance.id,
    { reimbursement_voucher_id: voucher.id },
    { status: "Liquidated" }
  );
  return voucher;
}

async function createBill(store, input, ctx) {
  const project = await requireProject(store, input.projectName || input.project_name);
  const supplierName = text(input.supplierName || input.supplier_name);
  if (!supplierName) fail("bad_request", "Supplier is required.");
  const invoiceNo = text(input.invoiceNo || input.invoice_no);
  if (!invoiceNo) fail("bad_request", "Invoice number is required.");
  const invoiceDate = String(input.invoiceDate || input.invoice_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) fail("bad_request", "Invoice date is required.");
  const terms = Number(input.termsDays != null ? input.termsDays : input.terms_days != null ? input.terms_days : 0);
  if (!Number.isFinite(terms) || terms < 0 || terms > 365) fail("bad_request", "Terms must be 0 to 365 days.");
  let due = String(input.dueDate || input.due_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const { addDays } = require("./manila");
    due = addDays(invoiceDate, terms);
  }
  const tax = taxFrom(input);
  if (tax.gross <= 0) fail("bad_request", "Amount must be greater than zero.");
  const supplier = await ensureSupplier(store, {
    name: supplierName,
    id: input.supplierId || input.supplier_id,
    tin: input.tin,
    termsDays: terms,
  });
  const bills = await store.list("bills");
  const dup = bills.find(
    (row) =>
      row.status !== "Cancelled" &&
      row.supplier_id === supplier.id &&
      nameKey(row.invoice_no) === nameKey(invoiceNo)
  );
  if (dup) fail("conflict", "That supplier invoice is already on file.");
  return store.createNumbered(
    "bills",
    "AP",
    input.year || yearOf(ctx),
    {
      status: "Open",
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      terms_days: terms,
      due_date: due,
      project_id: project.id,
      project_name: project.name,
      particulars: text(input.particulars) || `Invoice ${invoiceNo}`,
      amount: tax.amount,
      vat_mode: tax.vatMode,
      vat_rate: tax.vatRate,
      vat_amount: tax.vat,
      ewt_rate: tax.ewtRate,
      ewt_amount: tax.ewt,
      vatable_base: tax.vatable,
      gross_amount: tax.gross,
      net_amount: tax.net,
      paid_amount: 0,
      created_by: actorName(ctx),
      events: [event(ctx, "create", "", "Open")],
    },
    "ap_no"
  );
}

async function payBill(store, billId, input, ctx) {
  const amount = round2(input && input.amount);
  if (amount <= 0) fail("bad_request", "Payment amount is required.");
  const bill = await assertBillRoom(store, billId, amount, null);
  return createVoucher(
    store,
    {
      payee: bill.supplier_name,
      projectName: bill.project_name,
      particulars: `Payment ${bill.ap_no} invoice ${bill.invoice_no}`,
      accountCode: "2000",
      accountName: "Accounts payable",
      amount,
      vatMode: "none",
      vatRate: 0,
      ewtRate: 0,
      sourceKind: "supplier_bill",
      sourceId: bill.id,
    },
    ctx
  );
}

async function ensureSupplier(store, input) {
  if (input.id) {
    const existing = await store.get("suppliers", input.id);
    if (existing) return existing;
  }
  const key = nameKey(input.name);
  if (!key) fail("bad_request", "Supplier name is required.");
  const rows = await store.list("suppliers");
  const found = rows.find((row) => row.name_key === key);
  if (found) return found;
  return store.insert("suppliers", {
    name: collapse(input.name),
    name_key: key,
    tin: text(input.tin),
    address: text(input.address),
    terms_days: input.termsDays != null ? Number(input.termsDays) : null,
    motorpool_key: key,
    active: true,
  });
}

async function saveSupplier(store, input) {
  const name = collapse(input.name);
  const key = nameKey(name);
  if (!key) fail("bad_request", "Supplier name is required.");
  const tin = text(input.tin);
  const branch = text(input.branch);
  const vat = text(input.vatStatus != null ? input.vatStatus : input.vat_status);
  const storedKey = branch ? `${key} ${nameKey(branch)}` : key;
  const rows = await store.list("suppliers");
  const dup = rows.find((row) => {
    if (row.id === input.id) return false;
    if (tin) return row.tin === tin && text(row.branch) === branch;
    return row.name_key === storedKey && !text(row.tin);
  });
  if (dup) fail("conflict", "That supplier is already on the list.");
  if (input.id) {
    const existing = await store.get("suppliers", input.id);
    if (!existing) fail("not_found", "Supplier not found.");
    return store.update("suppliers", existing.id, {
      name,
      name_key: storedKey,
      tin: input.tin != null ? tin : text(existing.tin),
      branch: input.branch != null ? branch : text(existing.branch),
      vat_status: input.vatStatus != null || input.vat_status != null ? vat : text(existing.vat_status),
      address: text(input.address != null ? input.address : existing.address),
      terms_days: input.termsDays != null ? Number(input.termsDays) : existing.terms_days,
      active: input.active !== false,
    });
  }
  return store.insert("suppliers", {
    name,
    name_key: storedKey,
    tin,
    branch,
    vat_status: vat,
    address: text(input.address),
    terms_days: input.termsDays != null ? Number(input.termsDays) : 30,
    motorpool_key: "",
    active: true,
  });
}

async function saveProject(store, input) {
  const name = collapse(input.name);
  const key = nameKey(name);
  if (!key) fail("bad_request", "Project name is required.");
  const rows = await store.list("projects");
  const dup = rows.find((row) => row.name_key === key && row.id !== input.id);
  if (dup) return dup;
  if (input.id) {
    const existing = await store.get("projects", input.id);
    if (!existing) fail("not_found", "Project not found.");
    return store.update("projects", existing.id, {
      name,
      name_key: key,
      site: text(input.site != null ? input.site : existing.site),
      code: text(input.code != null ? input.code : existing.code),
      client: text(input.client != null ? input.client : existing.client),
      active: input.active !== false,
    });
  }
  return store.insert("projects", {
    name,
    name_key: key,
    site: text(input.site),
    code: text(input.code),
    client: text(input.client),
    source: text(input.source) || "finance",
    active: true,
  });
}

async function saveSignatory(store, input) {
  const slot = text(input.slot).toLowerCase();
  if (!["prepared", "checked", "approved"].includes(slot)) fail("bad_request", "Unknown signature slot.");
  const person = text(input.personName || input.person_name);
  if (!person) fail("bad_request", "Signatory name is required.");
  let image = input.imageData != null ? input.imageData : input.image_data;
  if (image) {
    image = String(image);
    if (!/^data:image\/(png|jpeg|jpg);base64,/i.test(image)) {
      fail("bad_request", "Signature image must be a PNG or JPEG.");
    }
    if (image.length > 700000) fail("bad_request", "Signature image is too large.");
  }
  const existing = (await store.list("signatories")).find((row) => row.slot === slot || row.id === slot);
  const patch = { slot, person_name: person, title: text(input.title) || existing && existing.title || slot };
  if (image) patch.image_data = image;
  if (existing) return store.update("signatories", existing.id, patch);
  return store.insert("signatories", { ...patch, id: slot, image_data: image || "" });
}

function publicSignatory(row) {
  return {
    slot: row.slot,
    person_name: row.person_name,
    title: row.title || "",
    has_image: Boolean(row.image_data),
  };
}

async function supplierCatalog(store) {
  const financeRows = await store.list("suppliers");
  let motorpool = [];
  try {
    const doc = await store.external.mpSuppliers();
    motorpool = mapMotorpoolSuppliers(doc);
  } catch {
    motorpool = [];
  }
  return dedupeSuppliers(financeRows, motorpool);
}

async function imports(store) {
  const safe = async (fn) => {
    try {
      return await fn();
    } catch {
      return [];
    }
  };
  const [advances, projects, employees, reserves, mpProjects, mpSuppliers] = await Promise.all([
    safe(() => store.external.hrAdvances()),
    safe(() => store.external.hrProjects()),
    safe(() => store.external.hrEmployees()),
    safe(() => store.external.mpReserves()),
    safe(() => store.external.mpProjects()),
    safe(() => store.external.mpSuppliers()),
  ]);
  return {
    hrAdvances: (advances || []).map(mapHrAdvance).filter((row) => row.sourceId || row.number),
    hrProjects: (projects || []).map(mapHrProject).filter(Boolean),
    hrEmployees: (employees || []).map(mapHrEmployee).filter(Boolean),
    motorpoolReserves: (reserves || []).map(mapMotorpoolReserve),
    motorpoolProjects: mapMotorpoolProjects(mpProjects),
    motorpoolSuppliers: mapMotorpoolSuppliers(mpSuppliers),
  };
}

async function copySharedProjects(store) {
  const pack = await imports(store);
  const saved = [];
  for (const row of pack.hrProjects.concat(pack.motorpoolProjects)) {
    saved.push(await saveProject(store, { name: row.name, site: row.site, source: row.source }));
  }
  return saved;
}

function caAgingRow(advance, today) {
  const start = advance.released_on || String(advance.released_at || "").slice(0, 10) || advance.date_needed;
  const days = start ? Math.max(0, daysBetween(start, today)) : 0;
  return {
    id: advance.id,
    ca_no: advance.ca_no,
    employee_name: advance.employee_name,
    department: advance.department,
    project_name: advance.project_name,
    amount: round2(advance.amount),
    days,
    bucket: caBucket(days),
    released_on: start,
  };
}

async function balances(store) {
  const advances = await store.list("advances");
  const by = new Map();
  advances.forEach((advance) => {
    const pos = employeePosition(advance);
    const key = nameKey(advance.employee_name) || advance.employee_name;
    const row = by.get(key) || {
      employee_name: advance.employee_name,
      employee_id: advance.employee_id || "",
      holds: 0,
      owed: 0,
      balance: 0,
      open: 0,
    };
    row.holds = round2(row.holds + pos.holds);
    row.owed = round2(row.owed + pos.owed);
    row.balance = round2(row.holds - row.owed);
    if (advance.status === "Released") row.open += 1;
    by.set(key, row);
  });
  return Array.from(by.values()).sort((a, b) => a.employee_name.localeCompare(b.employee_name));
}

async function dashboard(store, ctx) {
  await reconcile(store, ctx);
  const today = todayOf(ctx);
  const month = monthKey(today);
  const vouchers = await store.list("vouchers");
  const advances = await store.list("advances");
  const bills = await store.list("bills");
  const payments = await store.list("payments");
  const cashOut = round2(
    vouchers
      .filter((row) => (row.status === "Released" || row.status === "Cleared") && monthKey(row.released_on || row.released_at) === month)
      .reduce((sum, row) => sum + round2(row.net_amount), 0)
  );
  const pendingVouchers = vouchers.filter((row) => row.status === "For Approval");
  const pendingAdvances = advances.filter((row) => row.status === "For Approval");
  const unliquidated = advances.filter((row) => row.status === "Released");
  const openBills = bills.filter((row) => row.status === "Open" || row.status === "Partial");
  const due = openBills.filter((bill) => dueThisWeek(bill, payments.filter((row) => row.bill_id === bill.id), today));
  return {
    today,
    month,
    cashOutThisMonth: cashOut,
    pendingApprovals: {
      vouchers: pendingVouchers.length,
      advances: pendingAdvances.length,
      total: pendingVouchers.length + pendingAdvances.length,
    },
    unliquidated: {
      count: unliquidated.length,
      amount: round2(unliquidated.reduce((sum, row) => sum + round2(row.amount), 0)),
    },
    apDue: {
      openAmount: round2(openBills.reduce((sum, row) => sum + round2(round2(row.net_amount) - round2(row.paid_amount)), 0)),
      dueThisWeekCount: due.length,
      dueThisWeekAmount: round2(due.reduce((sum, row) => sum + round2(round2(row.net_amount) - round2(row.paid_amount)), 0)),
    },
  };
}

async function reports(store, ctx) {
  await reconcile(store, ctx);
  const today = todayOf(ctx);
  const month = String((ctx && ctx.month) || monthKey(today));
  const vouchers = await store.list("vouchers");
  const advances = await store.list("advances");
  const bills = await store.list("bills");
  const payments = await store.list("payments");
  const book = vouchers
    .filter((row) => (row.status === "Released" || row.status === "Cleared") && monthKey(row.released_on || row.released_at) === month)
    .sort((a, b) => String(a.dv_no).localeCompare(String(b.dv_no)));
  const apRows = bills
    .map((bill) => {
      const info = classifyBill(bill, payments.filter((row) => row.bill_id === bill.id), today);
      return info.open ? { ...info, id: bill.id, ap_no: bill.ap_no, supplier_name: bill.supplier_name, invoice_no: bill.invoice_no, amount: info.remaining } : null;
    })
    .filter(Boolean);
  const caRows = advances.filter((row) => row.status === "Released").map((row) => caAgingRow(row, today));
  const cost = new Map();
  book.forEach((row) => {
    const key = row.project_name || "—";
    const cur = cost.get(key) || { project_name: key, amount: 0, count: 0 };
    cur.amount = round2(cur.amount + round2(row.net_amount));
    cur.count += 1;
    cost.set(key, cur);
  });
  return {
    month,
    today,
    cashBook: book,
    apAging: { rows: apRows, buckets: bucketTotals(apRows, AP_BUCKETS) },
    caAging: { rows: caRows, buckets: bucketTotals(caRows, CA_BUCKETS) },
    projectCost: Array.from(cost.values()).sort((a, b) => b.amount - a.amount),
    dueThisWeek: apRows.filter((row) => row.due >= today && row.due <= require("./manila").addDays(today, 6)),
  };
}

async function attachMeta(store, input, ctx) {
  const ownerKind = text(input.ownerKind || input.owner_kind);
  const ownerId = String(input.ownerId || input.owner_id || "");
  if (!["voucher", "advance", "bill", "receipt"].includes(ownerKind) || !ownerId) {
    fail("bad_request", "Attachment owner is required.");
  }
  const table = ownerKind === "voucher" ? "vouchers" : ownerKind === "advance" ? "advances" : ownerKind === "bill" ? "bills" : "receipts";
  const owner = await store.get(table, ownerId);
  if (!owner) fail("not_found", "That record was not found.");
  const path = String(input.storagePath || input.storage_path || "");
  if (!path || path.includes("..")) fail("bad_request", "Storage path is required.");
  return store.insert("attachments", {
    owner_kind: ownerKind,
    owner_id: ownerId,
    filename: text(input.filename) || "file",
    storage_path: path,
    content_type: text(input.contentType || input.content_type) || "application/octet-stream",
    byte_size: Number(input.byteSize || input.byte_size) || 0,
    uploaded_by: actorName(ctx),
  });
}

module.exports = {
  DEFAULT_ACCOUNTS,
  DEFAULT_SIGNATORIES,
  DEPARTMENTS,
  addReceipt,
  attachMeta,
  balances,
  copySharedProjects,
  createAdvance,
  createBill,
  createVoucher,
  dashboard,
  imports,
  payBill,
  postLiquidation,
  publicSignatory,
  reconcile,
  reimburseAdvance,
  releaseAdvance,
  reports,
  saveProject,
  saveSignatory,
  saveSupplier,
  seedReference,
  supplierCatalog,
  transitionAdvance,
  transitionVoucher,
  updateAdvance,
  updateVoucher,
};
