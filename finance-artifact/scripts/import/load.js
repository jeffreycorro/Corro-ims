"use strict";

const { nameKey } = require("../../netlify/lib/names");
const { protectAccount } = require("../../netlify/lib/mask");
const { parseCheckNo } = require("../../netlify/lib/sheet-math");
const { resolveParty, seedMasters } = require("../../netlify/lib/masters");
const { formatNumber } = require("../../netlify/lib/numbering");
const { parseBillGrid } = require("./bills");
const { parseCheckSheet } = require("./checks");
const { parseGcashSheet } = require("./gcash");
const { parsePettySheet } = require("./petty-cash");

function seqOf(number, series) {
  if (series === "GC") {
    const match = String(number || "").match(/^(\d{4})Gcash-(\d+)$/i);
    return match ? { year: Number(match[1]), seq: Number(match[2]) } : null;
  }
  const match = String(number || "").match(/^[A-Z]+(\d{4})-(\d+)$/i);
  return match ? { year: Number(match[1]), seq: Number(match[2]) } : null;
}

async function addIssue(store, issue) {
  const rows = await store.list("import_issues");
  const dup = rows.find(
    (row) => row.source === issue.source && row.row_no === issue.rowNo && row.field === issue.field && row.raw === issue.raw && row.message === issue.message
  );
  if (dup) return dup;
  return store.insert("import_issues", {
    source: issue.source,
    sheet: issue.sheet || "",
    row_no: issue.rowNo || 0,
    field: issue.field || "",
    raw: issue.raw || "",
    message: issue.message,
  });
}

async function mapParty(store, kind, name, issues, source, rowNo) {
  const resolved = await resolveParty(store, kind, name, { unassigned: true });
  if (resolved.unknown && nameKey(name)) {
    await addIssue(store, {
      source,
      rowNo,
      field: kind,
      raw: String(name || ""),
      message: `Unknown ${kind} "${name}" was mapped to Unassigned.`,
    });
  }
  return resolved.row;
}

async function upsert(store, table, pred, row) {
  const existing = (await store.list(table)).find(pred);
  if (existing) return { row: await store.update(table, existing.id, row), created: false };
  return { row: await store.insert(table, row), created: true };
}

async function applyPetty(store, matrix, options) {
  await seedMasters(store);
  const parsed = Array.isArray(matrix) ? parsePettySheet(matrix, options) : matrix;
  const stats = { created: 0, updated: 0 };
  for (const issue of parsed.issues || []) await addIssue(store, { ...issue, source: "petty" });
  for (const cycle of parsed.cycles || []) {
    const year = cycle.year || options.defaultYear || 2026;
    const existingCycle = (await store.list("petty_cycles")).find((row) => row.year === year && row.cycle_no === cycle.cycleNo);
    const cyclePatch = {
      year,
      cycle_no: cycle.cycleNo,
      label: `PCB ${year}-${cycle.cycleNo}`,
      date_from: cycle.dateFrom || (existingCycle && existingCycle.date_from) || "",
      date_to: cycle.dateTo || (existingCycle && existingCycle.date_to) || "",
    };
    if (!existingCycle) {
      cyclePatch.opening_balance = cycle.opening == null ? 0 : cycle.opening;
      cyclePatch.status = "open";
    } else if (cycle.opening != null) {
      cyclePatch.opening_balance = cycle.opening;
    }
    const savedCycle = await upsert(store, "petty_cycles", (row) => row.year === year && row.cycle_no === cycle.cycleNo, cyclePatch);
    if (savedCycle.created) stats.created += 1;
    else stats.updated += 1;
    const cycleId = savedCycle.row.id;
    for (const cash of cycle.cashIns || []) {
      const key = `cash:${year}:${cycle.cycleNo}:${cash.referenceNo || cash.rowNo}`;
      const row = await upsert(store, "petty_cash_ins", (item) => item.import_key === key, {
        cycle_id: cycleId,
        txn_date: cash.date || "",
        source_type: cash.sourceType || "",
        reference_no: cash.referenceNo || "",
        check_id: null,
        amount: cash.amount || 0,
        import_key: key,
      });
      if (row.created) stats.created += 1;
    }
    for (const voucher of cycle.vouchers || []) {
      const employee = await mapParty(store, "employee", voucher.co, null, "petty", voucher.rowNo);
      const supplier = await mapParty(store, "supplier", voucher.supplier || "Cash", null, "petty", voucher.rowNo);
      const project = await mapParty(store, "project", voucher.project, null, "petty", voucher.rowNo);
      const parsedNo = seqOf(voucher.pcvNo, "PC");
      const pcvNo = parsedNo ? formatNumber("PC", parsedNo.year, parsedNo.seq) : voucher.pcvNo;
      if (parsedNo && store.reserveNumber) await store.reserveNumber("PC", parsedNo.year, parsedNo.seq, pcvNo);
      const saved = await upsert(store, "petty_vouchers", (item) => item.pcv_no === pcvNo, {
        pcv_no: pcvNo,
        year: parsedNo ? parsedNo.year : year,
        seq: parsedNo ? parsedNo.seq : 0,
        cycle_id: cycleId,
        txn_date: voucher.date || "",
        employee_id: employee.id,
        employee_name: employee.name,
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        project_id: project.id,
        project_name: project.name,
        vrf_no: voucher.vrf || "",
        po_no: voucher.po || "",
        description: voucher.description || "",
        amount: voucher.amount || 0,
        qb_uploaded: Boolean(voucher.qb),
        scanned: Boolean(voucher.scanned),
        remarks: voucher.remarks || "",
        status: "posted",
      });
      if (saved.created) stats.created += 1;
      for (const receipt of voucher.receipts || []) {
        const key = `rcpt:${pcvNo}:${receipt.siNo}:${receipt.invoiceAmount}`;
        await upsert(store, "petty_receipts", (item) => item.import_key === key, {
          voucher_id: saved.row.id,
          si_no: receipt.siNo || "",
          si_date: receipt.siDate || "",
          classification: receipt.classification || "",
          invoice_amount: receipt.invoiceAmount || 0,
          tin_snapshot: receipt.tin || "",
          import_key: key,
        });
      }
    }
    for (const release of cycle.releases || []) {
      const employee = await mapParty(store, "employee", release.employee, null, "petty", release.rowNo);
      const project = await mapParty(store, "project", release.project, null, "petty", release.rowNo);
      const key = `rel:${year}:${cycle.cycleNo}:${release.date}:${nameKey(release.employee)}:${release.amount}:${nameKey(release.description)}`;
      await upsert(store, "petty_releases", (item) => item.import_key === key, {
        cycle_id: cycleId,
        txn_date: release.date || "",
        employee_id: employee.id,
        employee_name: employee.name,
        description: release.description || "",
        project_id: project.id,
        project_name: project.name,
        vrf_no: release.vrf || "",
        amount: release.amount || 0,
        status_note: release.statusNote || "",
        status: release.status || "open",
        voucher_id: null,
        import_key: key,
      });
    }
  }
  return stats;
}

async function applyChecks(store, sheets) {
  await seedMasters(store);
  const stats = { created: 0, updated: 0 };
  const banks = await store.list("bank_accounts");
  for (const sheet of sheets || []) {
    const parsed = sheet.checks ? sheet : parseCheckSheet(sheet.rows || sheet, { bankNickname: sheet.bank || sheet.name || "" });
    for (const issue of parsed.issues || []) await addIssue(store, { ...issue, source: "checks", sheet: sheet.name || "" });
    for (const check of parsed.checks || []) {
      const parsedNo = parseCheckNo(check.checkNo);
      if (!parsedNo) continue;
      const nick = nameKey(sheet.bank || sheet.bankNickname || check.bankNickname || parsedNo.bankCode);
      const bank = banks.find((row) => nameKey(row.nickname) === nick || nameKey(row.bank_code) === nick || nameKey(row.bank_name) === nick)
        || banks.find((row) => nameKey(row.bank_code) === nameKey(parsedNo.bankCode));
      if (!bank) {
        await addIssue(store, { source: "checks", rowNo: check.rowNo, field: "bank", raw: parsedNo.bankCode, message: "No bank account matches this check." });
        continue;
      }
      const supplier = check.supplier || check.payee
        ? await mapParty(store, "supplier", check.supplier || check.payee, null, "checks", check.rowNo)
        : null;
      const saved = await upsert(store, "checks", (row) => row.check_no === parsedNo.checkNo, {
        bank_account_id: bank.id,
        bank_code: parsedNo.bankCode,
        booklet_year: parsedNo.bookletYear,
        serial: parsedNo.serial,
        check_no: parsedNo.checkNo,
        date_issued: check.dateIssued || "",
        check_date: check.checkDate || "",
        payee: check.payee || "",
        payee_supplier_id: supplier ? supplier.id : null,
        amount: check.amount || 0,
        po_ref: check.po || "",
        status: check.status || "issued",
        release_date: check.releaseDate || "",
        received_by: check.receivedBy || "",
        cleared_date: check.clearedDate || "",
        scanned: Boolean(check.scanned),
        document_location: "",
        photo_url: "",
        notes: check.notes || "",
        remarks: check.remarks || "",
        is_transfer: Boolean(check.isTransfer),
        dv_id: null,
      });
      if (saved.created) stats.created += 1;
      else stats.updated += 1;
      for (const invoice of check.invoices || []) {
        const key = `inv:${parsedNo.checkNo}:${invoice.siNo}:${invoice.amount}`;
        await upsert(store, "check_invoices", (row) => row.import_key === key, {
          check_id: saved.row.id,
          si_no: invoice.siNo || "",
          si_date: invoice.siDate || "",
          amount: invoice.amount || 0,
          po_no: invoice.po || "",
          import_key: key,
        });
      }
    }
  }
  return stats;
}

async function applyGcash(store, matrix, options) {
  await seedMasters(store);
  const parsed = matrix && matrix.batches ? matrix : parseGcashSheet(matrix, options);
  const stats = { created: 0, updated: 0 };
  const wallet = (await store.list("wallets")).find((row) => row.id === "wallet-gcash") || (await store.list("wallets"))[0];
  for (const issue of parsed.issues || []) await addIssue(store, { ...issue, source: "gcash" });
  for (const batch of parsed.batches || []) {
    const year = batch.year || options.defaultYear || 2026;
    const savedBatch = await upsert(
      store,
      "wallet_batches",
      (row) => row.wallet_id === wallet.id && row.year === year && row.batch_no === batch.batchNo,
      {
        wallet_id: wallet.id,
        year,
        batch_no: batch.batchNo,
        opening_balance: batch.opening == null ? 0 : batch.opening,
        status: "open",
      }
    );
    if (savedBatch.created) stats.created += 1;
    for (const cash of batch.cashIns || []) {
      const key = `gcin:${year}:${batch.batchNo}:${cash.referenceNo || cash.rowNo}`;
      await upsert(store, "wallet_cash_ins", (row) => row.import_key === key, {
        batch_id: savedBatch.row.id,
        txn_date: cash.date || "",
        source_type: cash.sourceType || "J",
        reference_no: cash.referenceNo || "",
        amount: cash.amount || 0,
        import_key: key,
      });
    }
    for (const expense of batch.expenses || []) {
      const employee = await mapParty(store, "employee", expense.co, null, "gcash", expense.rowNo);
      const supplier = await mapParty(store, "supplier", expense.supplier || "Cash", null, "gcash", expense.rowNo);
      const project = await mapParty(store, "project", expense.project, null, "gcash", expense.rowNo);
      const parsedNo = seqOf(expense.ref, "GC");
      let ref = expense.ref;
      if (parsedNo) {
        ref = formatNumber("GC", parsedNo.year, parsedNo.seq);
        if (store.reserveNumber) await store.reserveNumber("GC", parsedNo.year, parsedNo.seq, ref);
      }
      if (!ref) continue;
      await upsert(store, "wallet_expenses", (row) => row.ref_no === ref, {
        ref_no: ref,
        year: parsedNo ? parsedNo.year : year,
        seq: parsedNo ? parsedNo.seq : 0,
        batch_id: savedBatch.row.id,
        txn_date: expense.date || "",
        employee_id: employee.id,
        employee_name: employee.name,
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        project_id: project.id,
        project_name: project.name,
        vrf_no: expense.vrf || "",
        description: expense.description || "",
        amount: expense.amount || 0,
        fee: expense.fee || 0,
        si_no: expense.siNo || "",
        si_date: expense.siDate || "",
        invoice_amount: expense.invoiceAmount || 0,
        classification: expense.classification || "",
        scanned: Boolean(expense.scanned),
        remarks: expense.remarks || "",
        bill_instance_id: null,
        status: "posted",
      });
    }
    for (const held of batch.receivables || []) {
      const key = `grec:${year}:${batch.batchNo}:${nameKey(held.description)}:${held.amount}`;
      await upsert(store, "wallet_receivables", (row) => row.import_key === key, {
        batch_id: savedBatch.row.id,
        person_name: held.person || "",
        description: held.description || "",
        amount: held.amount || 0,
        status: held.status || "open",
        import_key: key,
      });
    }
  }
  return stats;
}

async function applyBills(store, matrix, options) {
  await seedMasters(store);
  const parsed = matrix && matrix.bills ? matrix : parseBillGrid(matrix, options);
  const stats = { created: 0, updated: 0 };
  for (const issue of parsed.issues || []) await addIssue(store, { ...issue, source: "bills" });
  for (const bill of parsed.bills || []) {
    const protectedNo = protectAccount(bill.accountNo);
    const keyName = `${nameKey(bill.category)}|${nameKey(bill.biller)}|${protectedNo.account_no}`;
    const savedBill = await upsert(
      store,
      "checklist_bills",
      (row) => row.import_key === keyName,
      {
        category: bill.category || "",
        biller: bill.biller || "",
        account_no: protectedNo.account_no,
        account_name: bill.accountName || "",
        frequency: "monthly",
        payment_method: "check",
        active: true,
        import_key: keyName,
      }
    );
    if (protectedNo.ciphertext) {
      const secretId = `bill-${savedBill.row.id}`;
      const existing = await store.get("bank_secrets", secretId);
      if (existing) await store.update("bank_secrets", secretId, { ciphertext: protectedNo.ciphertext });
      else await store.insert("bank_secrets", { id: secretId, account_id: savedBill.row.id, ciphertext: protectedNo.ciphertext });
    }
    const instKey = `bill:${savedBill.row.id}:${bill.month}`;
    const saved = await upsert(store, "checklist_instances", (row) => row.import_key === instKey, {
      bill_id: savedBill.row.id,
      month: bill.month,
      amount: bill.amount || 0,
      due_date: "",
      paid_date: "",
      status: bill.status || "unpaid",
      payment_kind: "",
      payment_id: null,
      import_key: instKey,
    });
    if (saved.created) stats.created += 1;
    else stats.updated += 1;
  }
  return stats;
}

async function applyImport(store, doc) {
  const run = async () => {
    await seedMasters(store);
    const result = { petty: null, checks: null, gcash: null, bills: null };
    if (doc.petty) result.petty = await applyPetty(store, doc.petty, doc);
    if (doc.checks) result.checks = await applyChecks(store, doc.checks);
    if (doc.gcash) result.gcash = await applyGcash(store, doc.gcash, doc);
    if (doc.bills) result.bills = await applyBills(store, doc.bills, doc);
    result.issues = await store.list("import_issues");
    return result;
  };
  if (store.transaction) return store.transaction(run);
  return run();
}

module.exports = { applyBills, applyChecks, applyGcash, applyImport, applyPetty };
