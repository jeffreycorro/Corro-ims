"use strict";

const { nameKey } = require("../../netlify/lib/names");
const { protectAccount } = require("../../netlify/lib/mask");
const { parseCheckNo } = require("../../netlify/lib/sheet-math");
const { RENTAL_UNITS } = require("../../netlify/lib/bill-monitor");
const { resolveParty, seedMasters } = require("../../netlify/lib/masters");
const { formatNumber } = require("../../netlify/lib/numbering");
const { parseBillGrid, parseRentalSheet, parseYearlySheet } = require("./bills");
const { parseCheckSheet } = require("./checks");
const { parseGcashSheet } = require("./gcash");
const { seedParties } = require("./parties");
const { parsePettySheet } = require("./petty-cash");

function seqOf(number, series) {
  if (series === "GC") {
    const match = String(number || "").match(/^(\d{4})Gcash-(\d+)$/i);
    return match ? { year: Number(match[1]), seq: Number(match[2]) } : null;
  }
  const match = String(number || "").match(/^[A-Z]+(\d{4})-(\d+)$/i);
  return match ? { year: Number(match[1]), seq: Number(match[2]) } : null;
}

function isMatrix(value) {
  return Array.isArray(value) && (!value.length || Array.isArray(value[0]));
}

function isSheetList(value) {
  return Array.isArray(value) && value.length > 0 && value[0] && Array.isArray(value[0].rows);
}

function makeIndex(rows, keyFn) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = keyFn(row);
    if (key) map.set(key, row);
  });
  return {
    get(key) {
      return map.get(key) || null;
    },
    put(key, row) {
      map.set(key, row);
    },
  };
}

async function upsertIndexed(store, table, index, key, row) {
  const existing = index.get(key);
  if (existing) {
    const updated = await store.update(table, existing.id, row);
    index.put(key, updated);
    return { row: updated, created: false };
  }
  const inserted = await store.insert(table, row);
  index.put(key, inserted);
  return { row: inserted, created: true };
}

async function issueWriter(store) {
  const rows = await store.list("import_issues");
  const seen = new Set(rows.map((row) => `${row.source}|${row.sheet}|${row.row_no}|${row.field}|${row.raw}|${row.message}`));
  return async function addIssue(issue) {
    const saved = {
      source: issue.source,
      sheet: issue.sheet || "",
      row_no: issue.rowNo || 0,
      field: issue.field || "",
      raw: issue.raw || "",
      message: issue.message,
    };
    const key = `${saved.source}|${saved.sheet}|${saved.row_no}|${saved.field}|${saved.raw}|${saved.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    await store.insert("import_issues", saved);
  };
}

async function partyCache(store) {
  const specs = {
    employee: { table: "employees", alias: "employee_aliases", fk: "employee_id", unassigned: "employee-unassigned" },
    project: { table: "projects", alias: "project_aliases", fk: "project_id", unassigned: "project-unassigned" },
    supplier: { table: "suppliers", alias: "supplier_aliases", fk: "supplier_id", unassigned: "supplier-unassigned" },
  };
  const cache = {};
  for (const kind of Object.keys(specs)) {
    const spec = specs[kind];
    const rows = await store.list(spec.table);
    const byKey = new Map();
    rows.forEach((row) => {
      if (row.name_key) byKey.set(row.name_key, row);
    });
    const aliases = await store.list(spec.alias);
    const aliasMap = new Map();
    aliases.forEach((row) => aliasMap.set(row.alias_key, row[spec.fk]));
    const unassigned = rows.find((row) => row.id === spec.unassigned) || rows.find((row) => row.name_key === "unassigned");
    cache[kind] = (name) => {
      const key = nameKey(name);
      if (!key) return { row: unassigned, unknown: false };
      if (kind === "supplier" && key === "cash") {
        const cash = rows.find((row) => row.name_key === "cash" || row.id === "supplier-cash");
        if (cash) return { row: cash, unknown: false };
      }
      if (byKey.has(key)) return { row: byKey.get(key), unknown: false };
      const id = aliasMap.get(key);
      if (id) {
        const row = rows.find((item) => item.id === id);
        if (row) return { row, unknown: false };
      }
      return { row: unassigned, unknown: true };
    };
  }
  return cache;
}

async function mapParty(store, parties, kind, name, addIssue, source, rowNo, sheet) {
  if (parties && parties[kind]) {
    const resolved = parties[kind](name);
    if (resolved.unknown && nameKey(name)) {
      await addIssue({
        source,
        sheet,
        rowNo,
        field: kind,
        raw: String(name || ""),
        message: `Unknown ${kind} "${name}" was mapped to Unassigned.`,
      });
    }
    return resolved.row;
  }
  const resolved = await resolveParty(store, kind, name, { unassigned: true });
  if (resolved.unknown && nameKey(name)) {
    await addIssue({
      source,
      sheet,
      rowNo,
      field: kind,
      raw: String(name || ""),
      message: `Unknown ${kind} "${name}" was mapped to Unassigned.`,
    });
  }
  return resolved.row;
}

function blankName(value) {
  const key = nameKey(value);
  return !key || key === "n a" || key === "na";
}

function parsePettyInput(input, options) {
  if (!input) return null;
  if (input.cycles) return input;
  if (isSheetList(input)) {
    const cycles = [];
    const issues = [];
    input.forEach((sheet) => {
      const parsed = parsePettySheet(sheet.rows, { ...options, sheetName: sheet.name });
      cycles.push(...parsed.cycles);
      issues.push(...parsed.issues.map((issue) => ({ ...issue, sheet: issue.sheet || sheet.name || "" })));
    });
    return { cycles, issues };
  }
  return parsePettySheet(input, options);
}

function parseChecksInput(input, options) {
  if (!input) return null;
  if (isSheetList(input)) {
    return input.map((sheet) => {
      if (sheet.checks) return sheet;
      const parsed = parseCheckSheet(sheet.rows || [], { bankNickname: sheet.bank || sheet.name || "", sheetName: sheet.name || "" });
      return { ...sheet, checks: parsed.checks, issues: parsed.issues.map((issue) => ({ ...issue, sheet: issue.sheet || sheet.name || "" })) };
    });
  }
  if (isMatrix(input)) {
    const parsed = parseCheckSheet(input, options);
    return [{ name: "", bank: "", checks: parsed.checks, issues: parsed.issues }];
  }
  return input;
}

function parseGcashInput(input, options) {
  if (!input) return null;
  if (input.batches) return input;
  if (isSheetList(input)) {
    const batches = [];
    const issues = [];
    input.forEach((sheet) => {
      const parsed = parseGcashSheet(sheet.rows, { ...options, sheetName: sheet.name });
      batches.push(...parsed.batches);
      issues.push(...parsed.issues.map((issue) => ({ ...issue, sheet: issue.sheet || sheet.name || "" })));
    });
    return { batches, issues };
  }
  return parseGcashSheet(input, options);
}

function parseBillsInput(input, options) {
  if (!input) return null;
  if (input.bills || input.rentals || input.taxes) return input;
  const sheets = isSheetList(input) ? input : [{ name: "", rows: input }];
  const bills = [];
  const rentals = [];
  const taxes = [];
  const issues = [];
  sheets.forEach((sheet) => {
    const name = sheet.name || "";
    const opts = { ...options, sheetName: name };
    if (/rental income/i.test(name)) {
      const parsed = parseRentalSheet(sheet.rows, opts);
      rentals.push(...parsed.receipts);
      issues.push(...parsed.issues);
      return;
    }
    if (/^yearly$/i.test(name.trim())) {
      const parsed = parseYearlySheet(sheet.rows, opts);
      taxes.push(...parsed.taxes);
      issues.push(...parsed.issues);
      return;
    }
    const parsed = parseBillGrid(sheet.rows, opts);
    bills.push(...parsed.bills);
    issues.push(...parsed.issues.map((issue) => ({ ...issue, sheet: issue.sheet || name })));
  });
  return { bills, rentals, taxes, issues };
}

function collectNames(masters, petty, checks, gcash) {
  const names = {
    suppliers: [...((masters && masters.suppliers) || [])],
    employees: [...((masters && masters.employees) || [])],
    projects: [...((masters && masters.projects) || [])],
  };
  for (const cycle of (petty && petty.cycles) || []) {
    for (const voucher of cycle.vouchers || []) {
      names.suppliers.push(voucher.supplier);
      names.employees.push(voucher.co);
      names.projects.push(voucher.project);
    }
    for (const release of cycle.releases || []) {
      names.employees.push(release.employee);
      names.projects.push(release.project);
    }
  }
  for (const sheet of checks || []) {
    for (const check of sheet.checks || []) {
      if (check.cancelled || check.isTransfer) continue;
      names.suppliers.push(check.supplier || check.payee);
    }
  }
  for (const batch of (gcash && gcash.batches) || []) {
    for (const expense of batch.expenses || []) {
      names.suppliers.push(expense.supplier);
      names.employees.push(expense.co);
      names.projects.push(expense.project);
    }
  }
  return names;
}

function matchBank(banks, sheet, parsedNo) {
  const nick = nameKey(sheet.bank || sheet.bankNickname || "");
  const byNick = banks.find((row) => nameKey(row.nickname) === nick || nameKey(row.account_type) === nick);
  if (byNick) return byNick;
  const code = nameKey(parsedNo.bankCode);
  if (code === "bpicl") return banks.find((row) => row.id === "bank-bpi-cl") || null;
  return (
    banks.find((row) => nameKey(row.bank_code) === code && nameKey(row.nickname) === code) ||
    banks.find((row) => nameKey(row.bank_code) === code) ||
    null
  );
}

async function applyPetty(store, input, options) {
  await seedMasters(store);
  const addIssue = options.addIssue || (await issueWriter(store));
  const parties = options.parties;
  const parsed = input && input.cycles ? input : parsePettyInput(input, options);
  const stats = { created: 0, updated: 0 };
  const cycles = makeIndex(await store.list("petty_cycles"), (row) => `${row.year}:${row.cycle_no}`);
  const cashIns = makeIndex(await store.list("petty_cash_ins"), (row) => row.import_key);
  const vouchers = makeIndex(await store.list("petty_vouchers"), (row) => row.pcv_no);
  const receipts = makeIndex(await store.list("petty_receipts"), (row) => row.import_key);
  const releases = makeIndex(await store.list("petty_releases"), (row) => row.import_key);
  for (const issue of parsed.issues || []) await addIssue({ ...issue, source: "petty" });
  for (const cycle of parsed.cycles || []) {
    const year = cycle.year || options.defaultYear || 2026;
    const key = `${year}:${cycle.cycleNo}`;
    const existingCycle = cycles.get(key);
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
    const savedCycle = await upsertIndexed(store, "petty_cycles", cycles, key, cyclePatch);
    if (savedCycle.created) stats.created += 1;
    else stats.updated += 1;
    const cycleId = savedCycle.row.id;
    for (const cash of cycle.cashIns || []) {
      const importKey = `cash:${year}:${cycle.cycleNo}:${cash.referenceNo || cash.rowNo}`;
      const row = await upsertIndexed(store, "petty_cash_ins", cashIns, importKey, {
        cycle_id: cycleId,
        txn_date: cash.date || "",
        source_type: cash.sourceType || "",
        reference_no: cash.referenceNo || "",
        check_id: null,
        amount: cash.amount || 0,
        import_key: importKey,
      });
      if (row.created) stats.created += 1;
    }
    for (const voucher of cycle.vouchers || []) {
      const employee = await mapParty(store, parties, "employee", voucher.co, addIssue, "petty", voucher.rowNo, "");
      const supplier = await mapParty(store, parties, "supplier", blankName(voucher.supplier) ? "Cash" : voucher.supplier, addIssue, "petty", voucher.rowNo, "");
      const project = await mapParty(store, parties, "project", voucher.project, addIssue, "petty", voucher.rowNo, "");
      const parsedNo = seqOf(voucher.pcvNo, "PC");
      const pcvNo = parsedNo ? formatNumber("PC", parsedNo.year, parsedNo.seq) : voucher.pcvNo;
      if (parsedNo && store.reserveNumber) await store.reserveNumber("PC", parsedNo.year, parsedNo.seq, pcvNo);
      const saved = await upsertIndexed(store, "petty_vouchers", vouchers, pcvNo, {
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
        const importKey = `rcpt:${pcvNo}:${receipt.siNo}:${receipt.invoiceAmount}`;
        await upsertIndexed(store, "petty_receipts", receipts, importKey, {
          voucher_id: saved.row.id,
          si_no: receipt.siNo || "",
          si_date: receipt.siDate || "",
          classification: receipt.classification || "",
          invoice_amount: receipt.invoiceAmount || 0,
          tin_snapshot: receipt.tin || "",
          import_key: importKey,
        });
      }
    }
    for (const release of cycle.releases || []) {
      const employee = await mapParty(store, parties, "employee", release.employee, addIssue, "petty", release.rowNo, "");
      const project = await mapParty(store, parties, "project", release.project, addIssue, "petty", release.rowNo, "");
      const importKey = `rel:${year}:${cycle.cycleNo}:${release.date}:${nameKey(release.employee)}:${release.amount}:${nameKey(release.description)}`;
      await upsertIndexed(store, "petty_releases", releases, importKey, {
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
        import_key: importKey,
      });
    }
  }
  return stats;
}

async function applyChecks(store, sheets, options = {}) {
  await seedMasters(store);
  const addIssue = options.addIssue || (await issueWriter(store));
  const parties = options.parties;
  const parsedSheets = sheets && sheets[0] && sheets[0].checks ? sheets : parseChecksInput(sheets, options);
  const stats = { created: 0, updated: 0 };
  const banks = await store.list("bank_accounts");
  const checks = makeIndex(await store.list("checks"), (row) => row.check_no);
  const invoices = makeIndex(await store.list("check_invoices"), (row) => row.import_key);
  for (const sheet of parsedSheets || []) {
    for (const issue of sheet.issues || []) await addIssue({ ...issue, source: "checks", sheet: issue.sheet || sheet.name || "" });
    for (const check of sheet.checks || []) {
      const parsedNo = parseCheckNo(check.checkNo);
      if (!parsedNo) continue;
      if (sheet.supplement && checks.get(parsedNo.checkNo)) continue;
      const bank = matchBank(banks, sheet, parsedNo);
      if (!bank) {
        await addIssue({ source: "checks", sheet: sheet.name || "", rowNo: check.rowNo, field: "bank", raw: parsedNo.bankCode, message: "No bank account matches this check." });
        continue;
      }
      const partyName = check.cancelled || check.isTransfer ? "" : check.supplier || check.payee;
      const supplier = partyName ? await mapParty(store, parties, "supplier", partyName, addIssue, "checks", check.rowNo, sheet.name || "") : null;
      const saved = await upsertIndexed(store, "checks", checks, parsedNo.checkNo, {
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
        const importKey = `inv:${parsedNo.checkNo}:${invoice.siNo}:${invoice.amount}`;
        await upsertIndexed(store, "check_invoices", invoices, importKey, {
          check_id: saved.row.id,
          si_no: invoice.siNo || "",
          si_date: invoice.siDate || "",
          amount: invoice.amount || 0,
          po_no: invoice.po || "",
          import_key: importKey,
        });
      }
    }
  }
  return stats;
}

async function applyGcash(store, input, options) {
  await seedMasters(store);
  const addIssue = options.addIssue || (await issueWriter(store));
  const parties = options.parties;
  const parsed = input && input.batches ? input : parseGcashInput(input, options);
  const stats = { created: 0, updated: 0 };
  const wallet = (await store.list("wallets")).find((row) => row.id === "wallet-gcash") || (await store.list("wallets"))[0];
  const batches = makeIndex(await store.list("wallet_batches"), (row) => `${row.wallet_id}:${row.year}:${row.batch_no}`);
  const cashIns = makeIndex(await store.list("wallet_cash_ins"), (row) => row.import_key);
  const expenses = makeIndex(await store.list("wallet_expenses"), (row) => row.ref_no);
  const receivables = makeIndex(await store.list("wallet_receivables"), (row) => row.import_key);
  for (const issue of parsed.issues || []) await addIssue({ ...issue, source: "gcash" });
  for (const batch of parsed.batches || []) {
    const year = batch.year || options.defaultYear || 2026;
    const batchKey = `${wallet.id}:${year}:${batch.batchNo}`;
    const savedBatch = await upsertIndexed(store, "wallet_batches", batches, batchKey, {
      wallet_id: wallet.id,
      year,
      batch_no: batch.batchNo,
      opening_balance: batch.opening == null ? 0 : batch.opening,
      status: "open",
    });
    if (savedBatch.created) stats.created += 1;
    for (const cash of batch.cashIns || []) {
      const importKey = `gcin:${year}:${batch.batchNo}:${cash.referenceNo || cash.rowNo}`;
      await upsertIndexed(store, "wallet_cash_ins", cashIns, importKey, {
        batch_id: savedBatch.row.id,
        txn_date: cash.date || "",
        source_type: cash.sourceType || "J",
        reference_no: cash.referenceNo || "",
        amount: cash.amount || 0,
        import_key: importKey,
      });
    }
    for (const expense of batch.expenses || []) {
      const employee = await mapParty(store, parties, "employee", expense.co, addIssue, "gcash", expense.rowNo, "");
      const supplier = await mapParty(store, parties, "supplier", blankName(expense.supplier) ? "Cash" : expense.supplier, addIssue, "gcash", expense.rowNo, "");
      const project = await mapParty(store, parties, "project", expense.project, addIssue, "gcash", expense.rowNo, "");
      const parsedNo = seqOf(expense.ref, "GC");
      let ref = expense.ref;
      if (parsedNo) {
        ref = formatNumber("GC", parsedNo.year, parsedNo.seq);
        if (store.reserveNumber) await store.reserveNumber("GC", parsedNo.year, parsedNo.seq, ref);
      }
      if (!ref) continue;
      await upsertIndexed(store, "wallet_expenses", expenses, ref, {
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
      const importKey = `grec:${year}:${batch.batchNo}:${nameKey(held.description)}:${held.amount}`;
      await upsertIndexed(store, "wallet_receivables", receivables, importKey, {
        batch_id: savedBatch.row.id,
        person_name: held.person || "",
        description: held.description || "",
        amount: held.amount || 0,
        status: held.status || "open",
        import_key: importKey,
      });
    }
  }
  return stats;
}

async function ensureRentals(store) {
  for (const unit of RENTAL_UNITS) {
    const existing = await store.get("rental_units", unit.id);
    if (!existing) await store.insert("rental_units", { ...unit, active: true });
  }
}

function rentalUnitId(site, unit) {
  const text = `${site || ""} ${unit || ""}`.toLowerCase();
  if (/edades/.test(text) && /720/.test(text)) return "rent-edades-720";
  if (/soho/.test(text) && /1123/.test(text)) return "rent-soho-1123";
  if (/remo/.test(text) && /3314/.test(text)) return "rent-sanremo-3314";
  return "";
}

async function applyBills(store, input, options) {
  await seedMasters(store);
  const addIssue = options.addIssue || (await issueWriter(store));
  const parsed = input && (input.bills || input.rentals || input.taxes) ? input : parseBillsInput(input, options);
  const stats = { created: 0, updated: 0 };
  const billIndex = makeIndex(await store.list("checklist_bills"), (row) => row.import_key);
  const instanceIndex = makeIndex(await store.list("checklist_instances"), (row) => row.import_key);
  for (const issue of parsed.issues || []) await addIssue({ ...issue, source: "bills" });
  for (const bill of parsed.bills || []) {
    const protectedNo = protectAccount(bill.accountNo);
    const keyName = `${nameKey(bill.category)}|${nameKey(bill.biller)}|${protectedNo.account_no}|${protectedNo.account_no ? "" : nameKey(bill.accountName)}`;
    const savedBill = await upsertIndexed(store, "checklist_bills", billIndex, keyName, {
      category: bill.category || "",
      biller: bill.biller || "",
      account_no: protectedNo.account_no,
      account_name: bill.accountName || "",
      frequency: "monthly",
      payment_method: "check",
      active: true,
      import_key: keyName,
    });
    if (protectedNo.ciphertext) {
      const secretId = `bill-${savedBill.row.id}`;
      const existing = await store.get("bank_secrets", secretId);
      if (existing) await store.update("bank_secrets", secretId, { ciphertext: protectedNo.ciphertext });
      else await store.insert("bank_secrets", { id: secretId, account_id: savedBill.row.id, ciphertext: protectedNo.ciphertext });
    }
    const instKey = `bill:${savedBill.row.id}:${bill.month}`;
    const saved = await upsertIndexed(store, "checklist_instances", instanceIndex, instKey, {
      bill_id: savedBill.row.id,
      month: bill.month,
      amount: bill.amount || 0,
      due_date: bill.dueDate || "",
      paid_date: bill.paidDate || "",
      status: bill.status || "unpaid",
      payment_kind: "",
      payment_id: null,
      import_key: instKey,
    });
    if (saved.created) stats.created += 1;
    else stats.updated += 1;
  }
  if ((parsed.rentals || []).length || (parsed.taxes || []).length) await ensureRentals(store);
  const receiptIndex = makeIndex(await store.list("rental_receipts"), (row) => `${row.unit_id}:${row.month}`);
  for (const receipt of parsed.rentals || []) {
    const unitId = rentalUnitId(receipt.site, receipt.unit);
    if (!unitId) {
      await addIssue({ source: "bills", rowNo: receipt.rowNo, field: "unit", raw: `${receipt.site} ${receipt.unit}`, message: "Rental row does not match a known unit." });
      continue;
    }
    const key = `${unitId}:${receipt.month}`;
    const saved = await upsertIndexed(store, "rental_receipts", receiptIndex, key, {
      unit_id: unitId,
      month: receipt.month,
      amount: receipt.amount || 0,
      received_on: receipt.receivedOn || "",
      reference: receipt.accountName || "",
    });
    if (saved.created) stats.created += 1;
  }
  const taxIndex = makeIndex(await store.list("property_taxes"), (row) => `${nameKey(row.site)}:${row.year}`);
  for (const tax of parsed.taxes || []) {
    const key = `${nameKey(tax.site)}:${tax.year}`;
    const saved = await upsertIndexed(store, "property_taxes", taxIndex, key, {
      site: tax.site,
      year: tax.year,
      amount: tax.amount || 0,
      paid_date: "",
      status: tax.status || "unpaid",
      reference: tax.reference || "",
    });
    if (saved.created) stats.created += 1;
  }
  return stats;
}

async function applyImport(store, doc) {
  const run = async () => {
    await seedMasters(store);
    const options = doc || {};
    const petty = options.petty ? parsePettyInput(options.petty, options) : null;
    const checks = options.checks ? parseChecksInput(options.checks, options) : null;
    const gcash = options.gcash ? parseGcashInput(options.gcash, options) : null;
    const bills = options.bills ? parseBillsInput(options.bills, options) : null;
    await seedParties(store, collectNames(options.masters, petty, checks, gcash));
    const parties = await partyCache(store);
    const addIssue = await issueWriter(store);
    const shared = { ...options, parties, addIssue };
    const result = { petty: null, checks: null, gcash: null, bills: null };
    if (petty) result.petty = await applyPetty(store, petty, shared);
    if (checks) result.checks = await applyChecks(store, checks, shared);
    if (gcash) result.gcash = await applyGcash(store, gcash, shared);
    if (bills) result.bills = await applyBills(store, bills, shared);
    result.issues = await store.list("import_issues");
    return result;
  };
  if (store.transaction) return store.transaction(run);
  return run();
}

module.exports = { applyBills, applyChecks, applyGcash, applyImport, applyPetty };
