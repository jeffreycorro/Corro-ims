"use strict";

const crypto = require("crypto");
const { approverPasswordOk } = require("../lib/approver-password");
const {
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
} = require("../lib/domain");
const { errorBody } = require("../lib/errors");
const { computeWithholding } = require("../lib/money");
const { formatManilaDate, formatManilaIso } = require("../lib/manila");
const { json, requireSession } = require("../lib/session");
const { putObject, signDownload } = require("../lib/storage");
const { publicBank } = require("../lib/masters");
const { ensureCheckForVoucher, handleSheet, sheetSummary } = require("../lib/registers");
const { createSupabaseStore } = require("../lib/supabase-store");

function lean(row) {
  if (!row || typeof row !== "object") return row;
  const copy = { ...row };
  delete copy.receiver_signature;
  delete copy.image_data;
  copy.has_receiver_signature = Boolean(row.receiver_signature);
  return copy;
}

function ctxFrom(session, body) {
  return {
    name: session.name || session.email || "",
    email: session.email || "",
    sub: session.sub || "",
    today: formatManilaDate(),
    now: formatManilaIso(),
    approverOk: approverPasswordOk(body.password),
    month: body.month,
  };
}

function safePath(parts) {
  const path = parts.filter(Boolean).join("/");
  if (!path || path.includes("..") || path.includes("\\")) {
    const err = new Error("That file path is not allowed.");
    err.statusCode = 400;
    err.code = "bad_request";
    throw err;
  }
  return path;
}

async function attachPhotoLinks(state, storage) {
  if (!state) return;
  const rows = [];
  (state.checks || []).forEach((row) => rows.push(row));
  const monitor = state.monitor || {};
  (monitor.photos || []).forEach((row) => rows.push(row));
  (monitor.due30 || []).forEach((day) => (day.checks || []).forEach((row) => rows.push(row)));
  (state.instances || []).forEach((row) => rows.push(row));
  (monitor.attention || []).forEach((row) => rows.push(row));
  (monitor.upcoming || []).forEach((row) => rows.push(row));
  (monitor.reminders || []).forEach((row) => rows.push(row));
  const cache = new Map();
  async function sign(row, field, hrefField) {
    const path = row && row[field] ? String(row[field]) : "";
    if (!path || /^https?:\/\//i.test(path)) return;
    if (!cache.has(path)) {
      try {
        const signed = await storage.signDownload(path, 120);
        cache.set(path, signed.signedUrl || "");
      } catch (err) {
        cache.set(path, "");
      }
    }
    if (cache.get(path)) row[hrefField] = cache.get(path);
  }
  for (const row of rows) {
    await sign(row, "photo_url", "photo_href");
    await sign(row, "receipt_path", "receipt_href");
  }
}

async function handle(event, deps = {}) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const session = requireSession(event);
  const store = deps.store || createSupabaseStore();
  const storage = deps.storage || { putObject, signDownload };
  const body = JSON.parse(event.body || "{}");
  const op = String(body.op || "");
  const ctx = ctxFrom(session, body);
  const tz = { timezone: "Asia/Manila", serverTime: ctx.now };

  if (op === "boot") {
    await seedReference(store);
    const [dash, projects, accounts, signatories, suppliers, employees, banks, sheets] = await Promise.all([
      dashboard(store, ctx),
      store.list("projects"),
      store.list("accounts"),
      store.list("signatories"),
      supplierCatalog(store),
      store.list("employees"),
      store.list("bank_accounts"),
      sheetSummary(store, ctx),
    ]);
    return json(200, {
      ...tz,
      me: { email: session.email || null, name: session.name || null, role: session.role || null, department: session.department || null },
      dashboard: { ...dash, sheets },
      projects,
      accounts,
      signatories: signatories.map(publicSignatory),
      suppliers,
      employees,
      banks: banks.map(publicBank),
      build: body.build || "",
    });
  }

  if (op === "approverCheck") {
    if (!approverPasswordOk(body.password)) {
      return json(403, { error: "That password does not match.", code: "approver_password" });
    }
    return json(200, { ...tz, ok: true });
  }
  if (op === "preview") return json(200, { ...tz, tax: computeWithholding(body) });
  if (op === "dashboard") {
    const dash = await dashboard(store, ctx);
    const sheets = await sheetSummary(store, ctx);
    return json(200, { ...tz, dashboard: { ...dash, sheets } });
  }
  const sheet = await handleSheet(op, store, body, ctx);
  if (sheet) {
    if (op === "sheetState" && sheet.body && sheet.body.state && sheet.body.state.monitor) {
      await attachPhotoLinks(sheet.body.state, storage);
    }
    return json(sheet.status || 200, { ...tz, ...sheet.body });
  }
  if (op === "reports") return json(200, { ...tz, report: await reports(store, ctx) });

  if (op === "listVouchers") {
    const rows = (await store.list("vouchers")).map(lean);
    return json(200, { ...tz, vouchers: rows });
  }
  if (op === "getVoucher") {
    const row = await store.get("vouchers", body.id);
    const attachments = await store.list("attachments", (item) => item.owner_kind === "voucher" && item.owner_id === body.id);
    return json(200, { ...tz, voucher: lean(row), attachments });
  }
  if (op === "createVoucher") return json(200, { ...tz, voucher: lean(await createVoucher(store, body, ctx)) });
  if (op === "updateVoucher") return json(200, { ...tz, voucher: lean(await updateVoucher(store, body.id, body, ctx)) });
  if (op === "actVoucher") {
    const voucher = await transitionVoucher(store, body.id, body.action, body, ctx);
    if (body.action === "release" && voucher.release_method === "Check") {
      try {
        await ensureCheckForVoucher(store, voucher);
      } catch (err) {
        if (err && err.code === "conflict") throw err;
      }
    }
    return json(200, { ...tz, voucher: lean(voucher) });
  }

  if (op === "listAdvances") {
    const advances = await store.list("advances");
    const receipts = await store.list("receipts");
    return json(200, { ...tz, advances: advances.map(lean), receipts });
  }
  if (op === "createAdvance") return json(200, { ...tz, advance: await createAdvance(store, body, ctx) });
  if (op === "updateAdvance") return json(200, { ...tz, advance: await updateAdvance(store, body.id, body, ctx) });
  if (op === "actAdvance") return json(200, { ...tz, advance: await transitionAdvance(store, body.id, body.action, body, ctx) });
  if (op === "releaseAdvance") return json(200, { ...tz, voucher: lean(await releaseAdvance(store, body.id, ctx)) });
  if (op === "addReceipt") return json(200, { ...tz, receipt: await addReceipt(store, body.id, body, ctx) });
  if (op === "liquidate") return json(200, { ...tz, advance: await postLiquidation(store, body.id, body, ctx) });
  if (op === "reimburse") return json(200, { ...tz, voucher: lean(await reimburseAdvance(store, body.id, ctx)) });
  if (op === "balances") return json(200, { ...tz, balances: await balances(store) });

  if (op === "listBills") {
    const bills = await store.list("bills");
    const payments = await store.list("payments");
    return json(200, { ...tz, bills, payments });
  }
  if (op === "createBill") return json(200, { ...tz, bill: await createBill(store, body, ctx) });
  if (op === "payBill") return json(200, { ...tz, voucher: lean(await payBill(store, body.id, body, ctx)) });

  if (op === "suppliers") return json(200, { ...tz, suppliers: await supplierCatalog(store) });
  if (op === "saveSupplier") return json(200, { ...tz, supplier: await saveSupplier(store, body), suppliers: await supplierCatalog(store) });
  if (op === "projects") return json(200, { ...tz, projects: await store.list("projects") });
  if (op === "saveProject") return json(200, { ...tz, project: await saveProject(store, body), projects: await store.list("projects") });
  if (op === "copyProjects") return json(200, { ...tz, projects: await copySharedProjects(store) });
  if (op === "imports") return json(200, { ...tz, imports: await imports(store) });

  if (op === "signatories") {
    const rows = await store.list("signatories");
    return json(200, { ...tz, signatories: rows.map(publicSignatory) });
  }
  if (op === "saveSignatory") {
    await saveSignatory(store, body);
    const rows = await store.list("signatories");
    return json(200, { ...tz, signatories: rows.map(publicSignatory) });
  }

  if (op === "registerBuild") {
    const build = String(body.build || "").trim();
    if (!build) return json(400, { error: "build is required" });
    const id = build.replace(/[\\/]+/g, "-");
    const saved = await store.registerBuild(id, build, body.seq || Date.now());
    return json(200, { ...tz, build: saved });
  }
  if (op === "latestBuild") {
    const rows = await store.list("builds");
    const best = rows.reduce((win, row) => (!win || Number(row.seq) > Number(win.seq) ? row : win), null);
    return json(200, { ...tz, latest: best });
  }

  if (op === "attachments") {
    const rows = await store.list(
      "attachments",
      (item) => item.owner_kind === body.ownerKind && item.owner_id === body.ownerId
    );
    return json(200, { ...tz, attachments: rows });
  }

  if (op === "upload") {
    const raw = String(body.dataBase64 || "");
    const bytes = Buffer.from(raw, "base64");
    if (!bytes.length) return json(400, { error: "File data is required.", code: "bad_request" });
    if (bytes.length > 5 * 1024 * 1024) return json(400, { error: "That file is over 5 MB.", code: "bad_request" });
    const filename = String(body.filename || "file").split(/[/\\]/).pop();
    const path = safePath([
      String(body.ownerKind || "file"),
      String(body.ownerId || "misc").replace(/[^A-Za-z0-9_-]+/g, ""),
      formatManilaDate().slice(0, 7),
      `${crypto.randomUUID()}-${filename.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80)}`,
    ]);
    await storage.putObject(path, bytes, body.contentType || "application/octet-stream");
    const attachment = await attachMeta(
      store,
      {
        ownerKind: body.ownerKind,
        ownerId: body.ownerId,
        filename,
        storagePath: path,
        contentType: body.contentType,
        byteSize: bytes.length,
      },
      ctx
    );
    const signed = await storage.signDownload(path, 120);
    return json(200, { ...tz, attachment, signedUrl: signed.signedUrl });
  }

  return json(400, { error: `Unknown op: ${op}`, code: "bad_request" });
}

exports.handle = handle;
exports.handler = (event) => handle(event).catch((err) => json(err.statusCode || 500, errorBody(err)));
