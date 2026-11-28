"use strict";

const crypto = require("crypto");
const { codedError, errorBody } = require("./coded-error");
const { formatManilaDate, formatManilaIso, manilaParts } = require("./manila");
const { json } = require("./session");
const { createLimiter } = require("./rate-limit");
const hrBotApprove = require("../../public/hr-bot-approve");
const hrApprover = require("../../public/hr-approver");
const PDFLib = require("pdf-lib");

const APPROVER = hrBotApprove.APPROVER_NAME;
const VIA = hrBotApprove.VIA;
const PDF_TTL = 7 * 24 * 60 * 60;
const PAYRUN_ID = /^(weekly|semi)\|\d{4}-\d{2}-\d{2}(?:\|\d{4}-\d{2}-\d{2})?$/;

const checkLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: "Too many approval requests. Try again later.",
});

function manilaStamp(date) {
  const p = manilaParts(date || new Date());
  return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute;
}

function bearer(event) {
  const headers = (event && event.headers) || {};
  const raw = headers.authorization || headers.Authorization || "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(String(raw).trim());
  return match ? match[1] : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function sameHash(presented, stored) {
  const a = Buffer.from(String(presented || "").toLowerCase());
  const b = Buffer.from(String(stored || "").toLowerCase());
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function fail(statusCode, message, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function rowsToMap(rows) {
  const map = {};
  (rows || []).forEach(function (row) {
    if (!row || !row.id) return;
    const data = row.data && typeof row.data === "object" ? row.data : {};
    map[row.id] = Object.assign({ id: data.id || row.id }, data);
  });
  return map;
}

function projectNames(projects) {
  const out = [];
  Object.keys(projects || {}).forEach(function (key) {
    const row = projects[key];
    if (row && row.name) out.push(row.name);
    else if (typeof row === "string" && row) out.push(row);
  });
  return out;
}

function safeSegment(value) {
  return String(value || "item")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80) || "item";
}

function ensurePdfLib() {
  if (!globalThis.PDFLib || !globalThis.PDFLib.PDFDocument) globalThis.PDFLib = PDFLib;
}

function filesFunctionPath(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  let search = "";
  if (raw.charAt(0) === "/") {
    const q = raw.indexOf("?");
    const pathname = q < 0 ? raw : raw.slice(0, q);
    if (pathname !== "/.netlify/functions/files") return "";
    search = q < 0 ? "" : raw.slice(q + 1);
  } else {
    let parsed;
    try { parsed = new URL(raw); } catch (e) { return ""; }
    if (!parsed.pathname.endsWith("/.netlify/functions/files")) return "";
    search = parsed.search.replace(/^\?/, "");
  }
  return new URLSearchParams(search).get("path") || "";
}

function dataUrl(bytes, mime) {
  const body = Buffer.from(bytes || []).toString("base64");
  return "data:" + (mime || "application/octet-stream") + ";base64," + body;
}

function isDataUrl(url) {
  return /^data:/i.test(String(url || "").trim());
}

function makeFetchUploadBytes(deps) {
  return async function fetchUploadBytes(url) {
    const raw = String(url || "").trim();
    if (isDataUrl(raw)) {
      const comma = raw.indexOf(",");
      const meta = raw.slice(5, comma);
      if (!/;base64/i.test(meta)) throw new Error("The uploaded file could not be read.");
      const bytes = Buffer.from(raw.slice(comma + 1).replace(/\s/g, ""), "base64");
      if (!bytes.length) throw new Error("The uploaded file is empty.");
      return { bytes: new Uint8Array(bytes), mime: (meta.split(";")[0] || "").trim() };
    }
    const stored = filesFunctionPath(raw);
    if (stored) {
      if (typeof deps.readObject !== "function") {
        throw new Error("The signed file is in portal storage. The bot could not read it, so approval was not saved.");
      }
      return deps.readObject(stored);
    }
    if (/drive\.google\.com/i.test(raw)) {
      const match = raw.match(/\/file\/d\/([^/?#]+)/i) || raw.match(/[?&]id=([^&#]+)/i);
      if (!match || typeof deps.downloadFile !== "function") {
        throw new Error("The signed file is on Google Drive. The portal could not read it, so approval was not saved.");
      }
      const out = await deps.downloadFile({ fileId: decodeURIComponent(match[1]) });
      const payload = (out && out.payload) || {};
      const b64 = payload.base64Content || payload.base64 || "";
      if (!b64) throw new Error("Drive did not return the signed file.");
      return {
        bytes: new Uint8Array(Buffer.from(String(b64).replace(/\s/g, ""), "base64")),
        mime: payload.mimeType || "",
      };
    }
    if (!/^https?:\/\//i.test(raw)) throw new Error("Could not download the signed file.");
    const res = await fetch(raw);
    if (!res || !res.ok) {
      throw new Error("Could not download the signed file" + (res && res.status ? " (" + res.status + ")." : "."));
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const mime = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
    return { bytes: buf, mime: String(mime).split(";")[0].trim() };
  };
}

async function signatureDataUrl(sig, fetchUploadBytes) {
  const raw = String(sig || "").trim();
  if (!raw) return "";
  if (isDataUrl(raw)) return raw;
  const file = await fetchUploadBytes(raw);
  return dataUrl(file.bytes, file.mime || "image/png");
}

function responseBody(extra) {
  return {
    item: extra.item,
    newStatus: extra.newStatus,
    approvedAt: extra.approvedAt || "",
    approvedPdfUrl: extra.approvedPdfUrl || null,
    kind: extra.kind,
    dryRun: !!extra.dryRun,
    steps: extra.steps || [],
    already: !!extra.already,
  };
}

function migrationHint() {
  return "Apply hr-artifact/supabase/migrations/20261128000001_hr_bot_approve.sql in the Supabase SQL editor, then insert only the SHA-256 hash of the bearer secret. This deploy does not apply that migration.";
}

async function secretHashes(deps) {
  let rows;
  try {
    rows = await deps.rest({
      method: "GET",
      path: "/rest/v1/hr_bot_secrets",
      query: "select=secret_sha256",
    });
  } catch (err) {
    const missing = /hr_bot_secrets|does not exist|schema cache|PGRST/i.test(String(err && err.message));
    if (missing || (err && (err.statusCode === 404 || err.statusCode === 400))) {
      throw fail(503, migrationHint(), "not_provisioned");
    }
    throw err;
  }
  const hashes = (Array.isArray(rows) ? rows : [])
    .map(function (row) { return String(row && row.secret_sha256 || "").trim().toLowerCase(); })
    .filter(Boolean);
  if (!hashes.length) {
    throw fail(503, "No bot secret is stored yet. " + migrationHint(), "not_provisioned");
  }
  return hashes;
}

async function authorize(event, deps) {
  const token = bearer(event);
  if (!token) throw fail(401, "Unauthorized.", "unauthorized");
  const hashes = await secretHashes(deps);
  const digest = sha256(token);
  const ok = hashes.some(function (stored) { return sameHash(digest, stored); });
  if (!ok) throw fail(401, "Unauthorized.", "unauthorized");
}

async function writeAudit(deps, row) {
  try {
    await deps.rest({
      method: "POST",
      path: "/rest/v1/hr_bot_audit",
      prefer: "return=minimal",
      body: {
        at: row.at || formatManilaIso(),
        approver: APPROVER,
        via: VIA,
        item_id: row.itemId,
        kind: row.kind,
        action: row.action || "approve",
        dry_run: !!row.dryRun,
        ok: !!row.ok,
        new_status: row.newStatus || "",
        detail: row.detail || {},
      },
    });
  } catch (err) {
    const missing = /hr_bot_audit|does not exist|schema cache|PGRST/i.test(String(err && err.message));
    if (missing) throw fail(503, migrationHint(), "not_provisioned");
    throw err;
  }
}

async function loadMap(deps, collection) {
  const rows = await deps.listCollection(collection);
  return rowsToMap(rows);
}

async function payrollStore(deps) {
  const settingsRow = await deps.getDoc("meta", "settings");
  const settings = Object.assign(
    {},
    (settingsRow && settingsRow.data) || {},
    { signatory: APPROVER }
  );
  const [employees, daily, advances, projects, payruns, otplans, otreps, leaves] = await Promise.all([
    loadMap(deps, "employees"),
    loadMap(deps, "daily"),
    loadMap(deps, "advances"),
    loadMap(deps, "projects"),
    loadMap(deps, "payruns"),
    loadMap(deps, "otplans"),
    loadMap(deps, "otreps"),
    loadMap(deps, "leaves"),
  ]);
  return {
    employees: employees,
    daily: daily,
    advances: advances,
    projects: projects,
    payruns: payruns,
    otplans: otplans,
    otreps: otreps,
    leaves: leaves,
    settings: settings,
    ui: {},
  };
}

function periodFor(engine, id, run) {
  const parts = String(id).split("|");
  const kind = parts[0];
  const from = (run && run.from) || parts[1];
  let to = (run && run.to) || parts[2] || "";
  if (!to) to = engine.payPeriod(kind, from).to;
  return { kind: kind, from: from, to: to };
}

async function storePdf(deps, objectPath, bytes) {
  await deps.putObject(objectPath, bytes, "application/pdf");
  const signed = await deps.signDownload(objectPath, PDF_TTL);
  return signed.signedUrl;
}

async function approvePayrun(body, deps, dryRun) {
  const id = String(body.id || "").trim();
  if (!PAYRUN_ID.test(id)) {
    throw fail(400, "Payrun id must look like weekly|2026-11-19.", "bad_request");
  }
  const payroll = deps.payroll || require("./payroll-engine");
  const engine = deps.engine || payroll.loadEngine();
  const store = deps.store || await payrollStore(deps);
  const existing = (store.payruns && store.payruns[id]) || null;
  const row = existing || (await deps.getDoc("payruns", id));
  const saved = existing || (row && row.data ? Object.assign({ id: id }, row.data) : null);
  const period = periodFor(engine, id, saved);
  const today = deps.today || formatManilaDate();
  const now = deps.now || manilaStamp();
  const lines = deps.lines || payroll.linesFor(store, period.kind, period.from, period.to, today);
  const currentStatus = saved ? engine.payRunStatusOf(saved) : "draft";
  if (!lines.length && currentStatus !== "approved") {
    throw fail(400, "Nobody has a day recorded in this period.", "bad_request");
  }
  const blocked = deps.printBlocked
    ? deps.printBlocked(store, today)
    : payroll.printBlocked(store, today);
  if (blocked && currentStatus !== "approved") {
    throw fail(409, blocked, "print_blocked");
  }
  const statusOf = engine.payRunStatusOf;
  const current = saved ? statusOf(saved) : "draft";
  if (current === "approved") {
    let url = (saved && (saved.approvedPdfLink || saved.approvedPdfUrl)) || null;
    if (!dryRun && saved && saved.approvedPdfPath) {
      const signed = await deps.signDownload(saved.approvedPdfPath, PDF_TTL);
      url = signed.signedUrl;
    }
    return responseBody({
      item: id,
      kind: "payrun",
      newStatus: "approved",
      approvedAt: (saved && saved.approvedAt) || "",
      approvedPdfUrl: dryRun ? null : url,
      dryRun: dryRun,
      steps: [],
      already: true,
    });
  }
  const summary = hrBotApprove.projectSummary(lines, {
    settings: store.settings || {},
    extraProjects: projectNames(store.projects),
    payProjectSummary: engine.payProjectSummary,
    payAliasConfirmedMap: engine.payAliasConfirmedMap,
    lateForRow: engine.hrPaySheet && engine.hrPaySheet.lateForRow,
  });
  const actor = { role: "admin", name: APPROVER };
  const result = hrBotApprove.approveThroughFinalize(saved || {
    id: id,
    kind: period.kind,
    from: period.from,
    to: period.to,
    lines: {},
  }, lines, {
    transition: engine.payTransition,
    statusOf: engine.payRunStatusOf,
    cloneRun: engine.payCloneRun,
    openExceptions: engine.hrPaySheet.openExceptions.bind(engine.hrPaySheet),
    actor: actor,
    approverUnlocked: true,
    now: now,
    today: today,
    who: APPROVER,
    snapshot: hrBotApprove.approvalSnapshot(summary),
  });
  if (!result.ok) throw fail(409, result.error || "The payrun was not approved.", "not_approved");
  let pdfUrl = null;
  const next = result.run;
  if (!dryRun) {
    const html = deps.printHtml
      ? deps.printHtml(store, period, lines, next, today)
      : payroll.printHtmlFor(store, period.kind, { from: period.from, to: period.to }, lines, next, today);
    const bytes = await deps.renderPrintPdf(html);
    const objectPath = "bot-approve/payruns/" + safeSegment(id) + ".pdf";
    pdfUrl = await storePdf(deps, objectPath, bytes);
    next.approvedPdfPath = objectPath;
    next.approvedPdfLink = pdfUrl;
    next.approvedBy = APPROVER;
    const previous = saved ? JSON.parse(JSON.stringify(saved)) : null;
    await deps.setDoc("payruns", id, next);
    try {
      await writeAudit(deps, {
        itemId: id,
        kind: "payrun",
        dryRun: false,
        ok: true,
        newStatus: "approved",
        detail: { steps: result.steps, from: result.from },
      });
    } catch (err) {
      if (previous) await deps.setDoc("payruns", id, previous);
      else await deps.deleteDoc("payruns", id);
      throw err;
    }
  }
  return responseBody({
    item: id,
    kind: "payrun",
    newStatus: "approved",
    approvedAt: next.approvedAt || now,
    approvedPdfUrl: pdfUrl,
    dryRun: dryRun,
    steps: result.steps,
    already: false,
  });
}

async function leaveStore(deps, rec) {
  if (deps.store) return deps.store;
  const settingsRow = await deps.getDoc("meta", "settings");
  const settings = Object.assign({}, (settingsRow && settingsRow.data) || {}, { signatory: APPROVER });
  const [employees, leaves, advances, daily, payruns] = await Promise.all([
    loadMap(deps, "employees"),
    loadMap(deps, "leaves"),
    loadMap(deps, "advances"),
    loadMap(deps, "daily"),
    loadMap(deps, "payruns"),
  ]);
  if (rec && rec.id) leaves[rec.id] = rec;
  return {
    employees: employees,
    leaves: leaves,
    advances: advances,
    daily: daily,
    payruns: payruns,
    settings: settings,
    ui: {},
  };
}

async function findLeave(deps, id) {
  const direct = await deps.getDoc("leaves", id);
  if (direct && direct.data) return { id: direct.id, data: Object.assign({ id: direct.id }, direct.data) };
  let rows = [];
  try {
    rows = await deps.rest({
      method: "GET",
      path: "/rest/v1/docs",
      query: "collection=eq.leaves&data->>no=eq." + encodeURIComponent(id) + "&select=id,data",
    });
  } catch (err) {
    rows = [];
  }
  if (!Array.isArray(rows) || !rows.length) return null;
  if (rows.length > 1) {
    throw fail(409, "More than one leave uses that number.", "ambiguous");
  }
  const row = rows[0];
  return { id: row.id, data: Object.assign({ id: row.id }, row.data || {}) };
}

function driveMcp(deps) {
  if (deps.drive === false) return null;
  if (!deps.downloadFile && !deps.createFile) return null;
  return {
    async callTool(server, name, args) {
      args = args || {};
      if (name === "download_file") {
        if (!deps.downloadFile) throw new Error("The signed file is on Google Drive. The portal could not read it, so approval was not saved.");
        return deps.downloadFile(args);
      }
      if (name !== "create_file") throw new Error("That Drive tool is not used for approval.");
      if (deps.createFile) {
        try {
          return await deps.createFile(args);
        } catch (err) {
          if (!deps.putObject) throw err;
        }
      }
      const bytes = Buffer.from(String(args.base64Content || ""), "base64");
      const objectPath = "bot-approve/leaves/" + safeSegment(args.title || "leave") + ".pdf";
      const url = await storePdf(deps, objectPath, bytes);
      return { payload: { viewUrl: url, title: args.title || "approved.pdf", id: objectPath } };
    },
  };
}

async function publishDataPdf(deps, rec) {
  const link = String((rec && (rec.approvedPdfLink || rec.signedLink)) || "");
  if (!/^data:application\/pdf;base64,/i.test(link)) return link || null;
  const comma = link.indexOf(",");
  const bytes = Buffer.from(link.slice(comma + 1).replace(/\s/g, ""), "base64");
  const objectPath = "bot-approve/leaves/" + safeSegment(rec.no || rec.id) + ".pdf";
  const url = await storePdf(deps, objectPath, bytes);
  rec.approvedPdfPath = objectPath;
  rec.approvedPdfLink = url;
  rec.signedLink = url;
  return url;
}

async function approveLeave(body, deps, dryRun) {
  const id = String(body.id || "").trim();
  if (!id || id.length > 80) throw fail(400, "A leave id or LRF number is required.", "bad_request");
  const found = deps.leave || await findLeave(deps, id);
  if (!found) throw fail(404, "That leave was not found.", "not_found");
  const rec = found.data;
  const waiting = rec.status === hrApprover.FOR_APPROVAL && !rec.pdfIncludesSignature;
  if (!waiting && rec.status === "Approved" && rec.pdfIncludesSignature) {
    let url = rec.approvedPdfLink || rec.signedLink || null;
    if (!dryRun && rec.approvedPdfPath) {
      const signed = await deps.signDownload(rec.approvedPdfPath, PDF_TTL);
      url = signed.signedUrl;
    }
    return responseBody({
      item: rec.no || found.id,
      kind: "leave",
      newStatus: "Approved",
      approvedAt: rec.approvedAt || "",
      approvedPdfUrl: dryRun ? null : url,
      dryRun: dryRun,
      steps: [],
      already: true,
    });
  }
  if (!waiting) {
    throw fail(409, "That leave is " + (rec.status || "not waiting") + ", not For approval.", "not_waiting");
  }
  const store = await leaveStore(deps, rec);
  let decision = deps.hrDecision;
  if (decision === undefined && deps.loadDecision !== false) {
    try { decision = require("./payroll-engine").loadEngine().hrDecision; } catch (e) { decision = null; }
  }
  const fetchUploadBytes = makeFetchUploadBytes(deps);
  let sig = hrApprover.signatureSrc(store);
  if (!sig) {
    throw fail(409, "Attach Jeffrey's e-signature in Settings → HR e-signatures (filename jeffrey, corro, ceo, or signatory) before approving.", "missing_signature");
  }
  ensurePdfLib();
  try {
    sig = await signatureDataUrl(sig, fetchUploadBytes);
  } catch (err) {
    throw fail(409, (err && err.message) || "Jeffrey's e-signature could not be read.", "missing_signature");
  }
  if (store.settings) {
    store.settings.hrSigs = Object.assign({}, store.settings.hrSigs);
    const prev = store.settings.hrSigs.signatory || {};
    store.settings.hrSigs.signatory = Object.assign({}, prev, { data: sig });
  }
  const uploadUrl = hrApprover.employeeUploadUrl(rec, "leave");
  if (dryRun) {
    const preview = hrApprover.approveRecord(rec, {
      kind: "leave",
      signature: sig,
      by: APPROVER,
      at: deps.nowIso || formatManilaIso(),
      on: deps.today || formatManilaDate(),
    });
    if (!preview.ok) throw fail(409, preview.error || "The leave was not approved.", "not_approved");
    if (uploadUrl) {
      try {
        const stamped = await hrApprover.stampBytes({ fetchUploadBytes: fetchUploadBytes }, {
          url: uploadUrl,
          kind: "leave",
          signature: sig,
          dateText: preview.record.approvedOn || "",
          rec: rec,
        });
        if (!stamped || !stamped.length) throw new Error("The signed upload could not be stamped.");
      } catch (err) {
        throw fail(409, (err && err.message) || "The signed upload could not be stamped.", "not_approved");
      }
    }
    return responseBody({
      item: rec.no || found.id,
      kind: "leave",
      newStatus: "Approved",
      approvedAt: preview.record.approvedAt,
      approvedPdfUrl: null,
      dryRun: true,
      steps: uploadUrl ? ["fetch", "stamp", "approve"] : ["approve"],
      already: false,
    });
  }
  let stampError = "";
  const host = {
    S: store,
    TODAY: deps.today || formatManilaDate(),
    hrDecision: decision || null,
    fetchUploadBytes: fetchUploadBytes,
    toast: function (msg, kind) {
      if (kind === "err" && msg) stampError = String(msg);
    },
    put: async function (coll, docId, next) {
      await deps.setDoc(coll, docId, next);
      store[coll][docId] = next;
    },
  };
  const mcp = driveMcp(deps);
  if (mcp) host.getMcp = async function () { return mcp; };
  const previous = JSON.parse(JSON.stringify(rec));
  process.env.TZ = "Asia/Manila";
  await hrApprover.approveItem(host, "leave", found.id);
  const saved = store.leaves[found.id];
  if (!saved || saved.status !== "Approved" || !saved.pdfIncludesSignature) {
    throw fail(409, stampError || "The leave was not approved. The signed upload could not be stamped.", "not_approved");
  }
  saved.approvedBy = APPROVER;
  let pdfUrl = saved.approvedPdfLink || saved.signedLink || null;
  if (pdfUrl && String(pdfUrl).indexOf("data:") === 0) {
    pdfUrl = await publishDataPdf(deps, saved);
  }
  await deps.setDoc("leaves", found.id, saved);
  try {
    await writeAudit(deps, {
      itemId: rec.no || found.id,
      kind: "leave",
      dryRun: false,
      ok: true,
      newStatus: "Approved",
      detail: { id: found.id, steps: ["approve"] },
    });
  } catch (err) {
    await deps.setDoc("leaves", found.id, previous);
    throw err;
  }
  return responseBody({
    item: rec.no || found.id,
    kind: "leave",
    newStatus: "Approved",
    approvedAt: saved.approvedAt || "",
    approvedPdfUrl: pdfUrl,
    dryRun: false,
    steps: ["approve"],
    already: false,
  });
}

function parseBody(event) {
  if (!event || event.body == null || event.body === "") return {};
  try {
    const value = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw fail(400, "Send a JSON object.", "bad_request");
    }
    return value;
  } catch (err) {
    if (err && err.statusCode) throw err;
    throw fail(400, "That body is not JSON.", "bad_request");
  }
}

async function perform(event, deps) {
  checkLimit(event);
  await authorize(event, deps);
  const body = parseBody(event);
  const kind = String(body.kind || "").trim().toLowerCase();
  const dryRun = body.dryRun === true || body.dryRun === "true" || body.dryRun === 1;
  if (kind !== "payrun" && kind !== "leave") {
    throw fail(400, "kind must be payrun or leave.", "bad_request");
  }
  try {
    const result = kind === "payrun"
      ? await approvePayrun(body, deps, dryRun)
      : await approveLeave(body, deps, dryRun);
    if (dryRun) {
      await writeAudit(deps, {
        itemId: result.item,
        kind: kind,
        dryRun: true,
        ok: true,
        newStatus: result.newStatus,
        action: "dry-run",
        detail: { steps: result.steps, already: result.already },
      });
    }
    return json(200, result);
  } catch (err) {
    const item = String((body && body.id) || "");
    if (item && err && err.code !== "not_provisioned") {
      try {
        await writeAudit(deps, {
          itemId: item,
          kind: kind || "",
          dryRun: dryRun,
          ok: false,
          newStatus: "",
          action: "error",
          detail: { error: String(err.message || "failed").slice(0, 300) },
        });
      } catch (auditErr) {
        if (auditErr && auditErr.code === "not_provisioned") throw auditErr;
      }
    }
    throw err;
  }
}

function createHandler(overrides) {
  const supabase = require("./supabase");
  const storage = require("./supabase-storage");
  const given = overrides || {};
  const deps = Object.assign({
    rest: supabase.rest,
    getDoc: supabase.getDoc,
    setDoc: supabase.setDoc,
    deleteDoc: supabase.deleteDoc,
    listCollection: supabase.listCollection,
    putObject: storage.putObject,
    readObject: storage.readObject,
    signDownload: storage.signDownload,
    renderPrintPdf: require("./print-pdf").renderPrintPdf,
    today: null,
    now: null,
  }, given);
  if (!given.createFile && given.drive !== false) {
    const drive = require("./google-drive");
    if (!deps.downloadFile) deps.downloadFile = drive.downloadFile;
    if (!deps.createFile) deps.createFile = drive.createFile;
  }
  return async function handler(event) {
    try {
      if (!event || event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
      if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
      return await perform(event, deps);
    } catch (err) {
      const status = err.statusCode || 500;
      return json(status, errorBody(err));
    }
  };
}

module.exports = {
  APPROVER: APPROVER,
  VIA: VIA,
  authorize: authorize,
  createHandler: createHandler,
  manilaStamp: manilaStamp,
  perform: perform,
  sha256: sha256,
};
