"use strict";

/**
 * Live shape on 2026-10-08: motorpool_records is the store, motorpool_issue_record
 * is installed, motorpool_approve_vrf is not. A new VRF is Send for approval on
 * the yard form. The follow-up read is readDocLive of that reserve year.
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRecordState, gateWrite, issueIntoRecords, MIN_WRITE_BUILD } = require("../netlify/lib/vrf-issue");

const envBackup = { ...process.env };
process.env.SUPABASE_URL = "https://live.example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE = "service-role-test";
process.env.MOTORPOOL_OPEN_YARD = "true";
delete process.env.SUPABASE_ANON_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { handler } = require("../netlify/functions/db");

const PAGE_BUILD = "2026-10-10 d";
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

const app = { nextVrf: 6123, nextReserve: 109 };
const records = {};
const docs = {};
const rpcLog = [];
let approveCalls = 0;

function stamp() {
  return new Date().toISOString();
}

function seedStore() {
  Object.keys(records).forEach((key) => delete records[key]);
  Object.keys(docs).forEach((key) => delete docs[key]);
  rpcLog.length = 0;
  approveCalls = 0;
  app.nextVrf = 6123;
  app.nextReserve = 109;
  const reserve = {
    no: "108",
    vrfNo: "6122",
    vrfs: ["6122"],
    date: "2026-10-07",
    status: "Approved",
    veh: "SV-12",
    work: "REP",
    project: "Yard",
    budget: 1500,
    approvedBudget: 1500,
    approvedBy: "Jeffrey",
    approvedAt: "2026-10-07T09:00:00+08:00",
    draftLines: [{ cat: "Belt", item: "Belt", qty: 1, price: 1500, unit: "pc", work: "REP" }],
    draftPurpose: "replace belt",
    draftOdo: "1000",
    odoAtRequest: 1000,
    requestedBy: "Sophie",
    submissionId: "sub-existing",
  };
  records["reserve:108"] = {
    id: "reserve:108",
    kind: "reserve",
    reserve_no: "108",
    vrf_no: "6122",
    live: true,
    year: "2026",
    month: null,
    data: reserve,
    updated_at: "2026-10-07T08:00:00+08:00",
  };
  records["ledger:6122"] = {
    id: "ledger:6122",
    kind: "ledger",
    reserve_no: "108",
    vrf_no: "6122",
    live: false,
    year: "2026",
    month: "2026-10",
    data: {
      month: "2026-10",
      vrf: "6122",
      rows: [
        {
          month: "2026-10",
          date: "2026-10-07",
          vrf: "6122",
          veh: "SV-12",
          cat: "Belt",
          item: "Belt",
          qty: 1,
          price: 1500,
          total: 1500,
          work: "REP",
          project: "Yard",
          reserve: "108",
          vstatus: "Open",
          odo: 1000,
          requestedBy: "Sophie",
        },
      ],
    },
    updated_at: "2026-10-07T08:00:00+08:00",
  };
  docs["config/app"] = {
    collection: "config",
    id: "app",
    data: { nextVrf: 6123, nextReserve: 109 },
    updated_at: "2026-10-07T08:00:00+08:00",
  };
  docs["ledger/index"] = {
    collection: "ledger",
    id: "index",
    data: { months: ["2026-10"] },
    updated_at: "2026-10-07T08:00:00+08:00",
  };
  docs["reserves/index"] = {
    collection: "reserves",
    id: "index",
    data: { years: ["2026"] },
    updated_at: "2026-10-07T08:00:00+08:00",
  };
}

function usedNumbers() {
  const used = new Set([6033]);
  Object.keys(records).forEach((key) => {
    const rec = records[key];
    if (!rec || !/^\d+$/.test(String(rec.vrf_no || ""))) return;
    if (rec.live || rec.kind === "ledger") used.add(parseInt(rec.vrf_no, 10));
  });
  return used;
}

function nextFree(used) {
  let max = 0;
  used.forEach((n) => {
    if (n !== 6033 && n > max) max = n;
  });
  let cand = max < 1 ? 1 : max + 1;
  while (used.has(cand)) cand += 1;
  return cand;
}

function nextReserveNo() {
  let max = 0;
  Object.keys(records).forEach((key) => {
    const rec = records[key];
    if (!rec || rec.kind !== "reserve" || !/^\d+$/.test(String(rec.reserve_no || ""))) return;
    max = Math.max(max, parseInt(rec.reserve_no, 10));
  });
  let no = max + 1;
  if (app.nextReserve > no) no = app.nextReserve;
  return no;
}

function reserveCount() {
  return Object.keys(records).filter((key) => records[key] && records[key].kind === "reserve").length;
}

/**
 * The installed motorpool_issue_record. kind "ledger" is intentionally the
 * live fall-through: it mints a reserve. The server must not send that kind.
 */
function issueRpc(spec, build) {
  spec = spec || {};
  rpcLog.push({ kind: spec.kind || "", build: build == null ? "" : String(build), specBuild: spec.build || "" });
  if (String(build || "") < "2026-10-06 a") {
    const err = new Error("Reload the page");
    err.statusCode = 400;
    throw err;
  }
  const kind = spec.kind || "";
  if (kind === "repair") {
    return {
      ok: true,
      kind: "repair",
      nextVrf: app.nextVrf,
      nextReserve: app.nextReserve,
      changes: [],
      attempts: 1,
    };
  }
  if (kind === "issued") {
    const entry = spec.entry || {};
    const no = String(entry.no || entry.vrf || "").trim();
    if (!no) {
      const err = new Error("A sealed VRF needs a number.");
      err.statusCode = 400;
      throw err;
    }
    const reserveNo = String(entry.reserveNo || "").trim();
    const id = "issued:" + no + "@" + (reserveNo || "number");
    if (!records[id]) {
      records[id] = {
        id,
        kind: "issued",
        reserve_no: reserveNo || null,
        vrf_no: no,
        live: false,
        year: null,
        month: null,
        data: Object.assign({}, entry, { sealed: true, no }),
        updated_at: stamp(),
      };
    }
    return { ok: true, kind: "issued", no, attempts: 1 };
  }
  const reserveIn = spec.reserve && typeof spec.reserve === "object" ? spec.reserve : {};
  if ((kind === "reserve" || kind === "bundle") && String(reserveIn.no || "").trim() && records["reserve:" + String(reserveIn.no).trim()]) {
    const existing = records["reserve:" + String(reserveIn.no).trim()];
    const allowed = {
      status: 1,
      veh: 1,
      work: 1,
      project: 1,
      budget: 1,
      approvedBudget: 1,
      draftLines: 1,
      draftPurpose: 1,
      scope: 1,
      requestedBy: 1,
      approvedBy: 1,
      approvedAt: 1,
      decisionNote: 1,
      draftOdo: 1,
      odoAtRequest: 1,
      submissionId: 1,
      vrfs: 1,
      date: 1,
    };
    const data = Object.assign({}, existing.data);
    Object.keys(reserveIn).forEach((key) => {
      if (allowed[key]) data[key] = reserveIn[key];
    });
    data.no = existing.reserve_no;
    data.vrfNo = existing.vrf_no || data.vrfNo || "";
    existing.data = data;
    existing.live = data.status !== "Rejected" && data.status !== "Archived";
    existing.updated_at = stamp();
    if (kind === "bundle") {
      const month = String(spec.month || "").trim();
      const vrf = String(existing.vrf_no || "");
      if (/^\d{4}-\d{2}$/.test(month) && vrf) {
        const rows = (spec.rows || []).map((line) => Object.assign({}, line, { vrf }));
        records["ledger:" + vrf] = {
          id: "ledger:" + vrf,
          kind: "ledger",
          reserve_no: existing.reserve_no,
          vrf_no: vrf,
          live: false,
          year: month.slice(0, 4),
          month,
          data: { month, vrf, rows },
          updated_at: stamp(),
        };
      }
    }
    return {
      ok: true,
      kind,
      store: "records",
      nextVrf: app.nextVrf,
      nextReserve: app.nextReserve,
      reserve: data,
      reserveNo: existing.reserve_no,
      vrf: existing.vrf_no || "",
      vrfNo: existing.vrf_no || "",
      attempts: 1,
      changes: [],
    };
  }
  const fresh = nextFree(usedNumbers());
  const newNo = nextReserveNo();
  const saved = Object.assign({}, reserveIn);
  delete saved.preparedSig;
  delete saved.checkedSig;
  delete saved.approvedSig;
  saved.no = String(newNo);
  saved.vrfNo = String(fresh);
  saved.vrfs = Array.isArray(saved.vrfs) ? saved.vrfs : [];
  records["reserve:" + newNo] = {
    id: "reserve:" + newNo,
    kind: "reserve",
    reserve_no: String(newNo),
    vrf_no: String(fresh),
    live: saved.status !== "Rejected" && saved.status !== "Archived",
    year: String(saved.date || "2026").slice(0, 4),
    month: null,
    data: saved,
    updated_at: stamp(),
  };
  app.nextVrf = Math.max(app.nextVrf, fresh + 1);
  app.nextReserve = Math.max(app.nextReserve, newNo + 1);
  docs["config/app"].data = Object.assign({}, docs["config/app"].data, {
    nextVrf: app.nextVrf,
    nextReserve: app.nextReserve,
  });
  return {
    ok: true,
    kind: kind || "issue",
    store: "records",
    nextVrf: app.nextVrf,
    nextReserve: app.nextReserve,
    reserve: saved,
    reserveNo: String(newNo),
    vrf: String(fresh),
    vrfNo: String(fresh),
    attempts: 1,
    changes: [],
  };
}

function queryRows(list, search) {
  const params = new URLSearchParams(search || "");
  let rows = list.filter((row) => {
    for (const [key, value] of params.entries()) {
      if (key === "select" || key === "order" || key === "limit" || key === "offset" || key === "on_conflict") continue;
      const eq = /^eq\.(.*)$/.exec(value);
      if (!eq) continue;
      const actual = row[key];
      if (String(actual == null ? "" : actual) !== eq[1]) return false;
    }
    return true;
  });
  rows = rows.slice().sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const offset = parseInt(params.get("offset") || "0", 10) || 0;
  const limit = params.get("limit");
  if (limit != null) return rows.slice(offset, offset + (parseInt(limit, 10) || 0));
  return offset ? rows.slice(offset) : rows;
}

function httpResult(status, body) {
  const text = body == null ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (text ? JSON.parse(text) : null),
  };
}

global.fetch = async (url, opts) => {
  const target = new URL(String(url), "https://live.example.supabase.co");
  const pathname = target.pathname;
  const method = (opts && opts.method) || "GET";
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  const search = target.search ? target.search.slice(1) : "";
  if (pathname.endsWith("/rpc/motorpool_approve_vrf")) {
    approveCalls += 1;
    return httpResult(404, {
      code: "PGRST202",
      message: "Could not find the function public.motorpool_approve_vrf(p_spec) in the schema cache",
    });
  }
  if (pathname.endsWith("/rpc/motorpool_issue_record")) {
    try {
      return httpResult(200, issueRpc(body && body.p_spec, body && body.p_build));
    } catch (err) {
      return httpResult(err.statusCode || 400, { message: err.message, code: err.code || "P0001" });
    }
  }
  if (pathname.endsWith("/rpc/acquire_motorpool_doc_lock")) {
    return httpResult(200, { acquired: true, holder: body && body.p_holder, expires_at: stamp() });
  }
  if (pathname.endsWith("/motorpool_records")) {
    const list = Object.keys(records).map((key) => records[key]);
    if (method === "GET") return httpResult(200, queryRows(list, search));
    if (method === "POST") {
      if (!body || !body.id) return httpResult(400, { message: "id required" });
      if (records[body.id]) return httpResult(409, { code: "23505", message: "duplicate key" });
      records[body.id] = Object.assign({ updated_at: stamp() }, body);
      return httpResult(201, null);
    }
    if (method === "PATCH") {
      const hits = queryRows(list, search);
      hits.forEach((row) => {
        Object.assign(records[row.id], body || {}, { updated_at: stamp() });
      });
      return httpResult(204, null);
    }
  }
  if (pathname.endsWith("/motorpool_docs")) {
    const list = Object.keys(docs).map((key) => docs[key]);
    if (method === "GET") return httpResult(200, queryRows(list, search));
    if (method === "POST") {
      const key = body.collection + "/" + body.id;
      const row = {
        collection: body.collection,
        id: body.id,
        data: body.data,
        updated_at: stamp(),
      };
      docs[key] = row;
      return httpResult(200, [row]);
    }
    if (method === "PATCH") {
      const hits = queryRows(list, search);
      if (!hits.length) return httpResult(200, []);
      hits.forEach((row) => {
        const key = row.collection + "/" + row.id;
        docs[key] = Object.assign({}, row, { data: body.data, updated_at: stamp() });
      });
      return httpResult(200, hits.map((row) => ({ updated_at: docs[row.collection + "/" + row.id].updated_at })));
    }
  }
  return httpResult(404, { code: "PGRST205", message: "Could not find the table " + pathname });
};

function jsonResponse(status, payload) {
  const text = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => payload,
  };
}

async function callHandler(body) {
  const res = await handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify(body),
  });
  let parsed = {};
  try {
    parsed = JSON.parse(res.body || "{}");
  } catch (err) {
    parsed = { error: res.body };
  }
  return { status: res.statusCode, body: parsed };
}

function makeNode(tag) {
  const node = { tagName: String(tag || "div").toUpperCase(), style: {}, children: [], childNodes: [], dataset: {} };
  node.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  ["id", "className", "textContent", "innerHTML", "value", "placeholder", "name", "title", "type", "src", "href", "alt", "htmlFor"].forEach((key) => {
    node[key] = "";
  });
  node.hidden = false;
  node.disabled = false;
  node.checked = false;
  const proxy = new Proxy(node, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return function () {
        return proxy;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  node.appendChild = (child) => {
    node.children.push(child);
    return child;
  };
  node.removeChild = () => proxy;
  node.insertBefore = (child) => child;
  node.addEventListener = () => {};
  node.removeEventListener = () => {};
  node.remove = () => {};
  node.setAttribute = (name, value) => {
    node[name] = value;
  };
  node.getAttribute = (name) => (node[name] == null ? "" : String(node[name]));
  node.querySelector = () => proxy;
  node.querySelectorAll = () => [];
  node.getContext = () => proxy;
  node.focus = () => {};
  node.click = () => {};
  node.closest = () => proxy;
  node.cloneNode = () => makeNode(tag);
  node.contains = () => false;
  return proxy;
}

function browserWindow() {
  const byId = {};
  const document = {
    documentElement: null,
    head: null,
    body: null,
    readyState: "complete",
    createElement: (tag) => makeNode(tag),
    createTextNode: (text) => ({ textContent: String(text == null ? "" : text) }),
    getElementById: (id) => {
      if (!byId[id]) {
        byId[id] = makeNode("div");
        byId[id].id = id;
      }
      return byId[id];
    },
    querySelector: (sel) => {
      const match = /^#([\w-]+)$/.exec(String(sel || ""));
      if (match) return document.getElementById(match[1]);
      return makeNode("div");
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  document.documentElement = makeNode("html");
  document.head = makeNode("head");
  document.body = makeNode("body");
  const window = {
    document,
    location: { hostname: "corcondev-motorpool.netlify.app", pathname: "/", search: "", hash: "", reload() {} },
    navigator: { userAgent: "test", clipboard: { writeText: async () => {} } },
    localStorage: storeMemory(),
    sessionStorage: storeMemory(),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    Blob: class FakeBlob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = opts && opts.type;
      }
    },
    FileReader: class FakeReader {
      readAsDataURL() {
        this.result = "";
        if (this.onload) this.onload();
      }
    },
    Option: function Option(text, value) {
      const node = makeNode("option");
      node.textContent = text;
      node.value = value;
      return node;
    },
    Image: function Image() {
      return makeNode("img");
    },
    crypto: { randomUUID: () => "test-holder" },
    MutationObserver: function MutationObserver() {
      this.observe = () => {};
      this.disconnect = () => {};
    },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    fetch: async (url, opts) => {
      const target = String(url);
      if (target.includes("/functions/auth")) {
        return jsonResponse(200, { authenticated: true, open: true, method: "open", methods: [] });
      }
      if (target.includes("/functions/db")) {
        const sent = opts && opts.body ? JSON.parse(opts.body) : {};
        window.__sent.push(sent);
        if (sent.op === "set" && /^(reserves\/\d{4}|ledger\/\d{4}-\d{2})$/.test(String(sent.path || ""))) {
          window.__blobSets.push(String(sent.path));
        }
        const res = await callHandler(sent);
        return jsonResponse(res.status, res.body);
      }
      return jsonResponse(404, { error: "missing " + target });
    },
  };
  window.window = window;
  window.globalThis = window;
  window.self = window;
  window.__sent = [];
  window.__blobSets = [];
  window.__toasts = [];
  window.__api = {};
  return window;
}

function storeMemory() {
  const data = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

function loadShim(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
  vm.runInNewContext(src, windowLike, { filename: "claude-shim.js" });
}

function loadPage(windowLike) {
  const open = html.indexOf("<script>\n(function(){");
  const end = html.lastIndexOf("})();");
  if (open < 0 || end < 0) throw new Error("page script not found");
  let src = html.slice(open + "<script>\n".length, end);
  const cut = src.indexOf("/* ============================ chrome ============================ */");
  if (cut < 0) throw new Error("chrome marker missing");
  src = src.slice(0, cut);
  src = src.replace(
    "function toast(msg){",
    "function toast(msg){ try{ globalThis.__toasts.push(String(msg)); }catch(e){} "
  );
  src += `
    globalThis.__api.sendForApproval = sendForApproval;
    globalThis.__api.saveReserves = saveReserves;
    globalThis.__api.replaceLedgerVrf = replaceLedgerVrf;
    globalThis.__api.appendLedger = appendLedger;
    globalThis.__api.commitVrfBundle = commitVrfBundle;
    globalThis.__api.postAndSaveReserve = postAndSaveReserve;
    globalThis.__api.saveVrfOdo = saveVrfOdo;
    globalThis.__api.saveVrfHeader = saveVrfHeader;
    globalThis.__api.markVrfPrinted = markVrfPrinted;
    globalThis.__api.liquidateVrf = liquidateVrf;
    globalThis.__api.cancelApprovedVrf = cancelApprovedVrf;
    globalThis.__api.markVrfDuplicate = markVrfDuplicate;
    globalThis.__api.writeDoc = writeDoc;
    globalThis.__api.vrfByNo = vrfByNo;
    globalThis.__api.reserveBy = reserveBy;
    globalThis.__api.findSameOpenRequests = findSameOpenRequests;
    globalThis.__api.vrfIndex = vrfIndex;
    globalThis.__api.resetIndex = function(){ _vrfs=null; _lw=null; _cons=null; _inv=null; };
    globalThis.__api.getS = function(){ return S; };
    globalThis.__api.BUILD = BUILD;
  })();
  `;
  vm.runInNewContext(src, windowLike, { filename: "index.html" });
}

function form(over) {
  return Object.assign(
    {
      veh: "DT-09",
      work: "REP",
      date: "2026-10-08",
      odo: "2200",
      project: "Yard",
      purpose: "new belt",
      requestedBy: "Ana Cruz",
      lines: [{ cat: "Belt", item: "Belt", qty: 1, price: 1500, unit: "pc", work: "REP" }],
    },
    over || {}
  );
}

function button() {
  return { disabled: false, textContent: "Send for approval" };
}

let page;

describe("new VRF save against the live store", () => {
  before(async () => {
    seedStore();
    page = browserWindow();
    loadShim(page);
    loadPage(page);
    page.__api.getS().db = await page.claude.use("db");
    page.__api.getS().esigs = {};
    page.__api.getS().vehicles = [
      { code: "SV-12", desc: "Service van", plate: "ABC" },
      { code: "DT-09", desc: "Dump truck", plate: "D09" },
      { code: "DT-01", desc: "Dump truck", plate: "D01" },
    ];
    page.__api.getS().parts = [];
    page.__api.getS().worktypes = [];
    page.__api.getS().projects = [];
  });

  beforeEach(() => {
    seedStore();
    const state = page.__api.getS();
    state.reserves = [JSON.parse(JSON.stringify(records["reserve:108"].data))];
    state.ledger = { "2026-10": JSON.parse(JSON.stringify(records["ledger:6122"].data.rows)) };
    state.cfg = { nextVrf: 6123, nextReserve: 109, pass: null, fuel: null, varianceTol: 0.1, driveFolder: "" };
    state.issued = { numbers: {} };
    state.rsvYears = ["2026"];
    state.ready = false;
    state._sendingVrf = false;
    state.view = "yard";
    state.office = false;
    page.__api.resetIndex();
    page.__toasts.length = 0;
    page.__sent.length = 0;
    page.__blobSets.length = 0;
  });

  after(() => {
    process.env = envBackup;
  });

  it("keeps the previous build able to write and publishes this one on window", () => {
    assert.equal(MIN_WRITE_BUILD, "2026-10-06 a");
    assert.equal(gateWrite({ op: "merge", build: "2026-10-07 a" }), null);
    assert.equal(gateWrite({ op: "merge", build: "" }).error, "Reload the page");
    assert.equal(page.__api.BUILD, PAGE_BUILD);
    assert.equal(page.BUILD, PAGE_BUILD);
    assert.match(html, /window\.BUILD = BUILD/);
    assert.match(html, /var BUILD = "2026-10-10 d"/);
  });

  it("names gateWrite when the shim cannot see the page build", async () => {
    const bare = browserWindow();
    loadShim(bare);
    const db = await bare.claude.use("db");
    const before = reserveCount();
    await assert.rejects(
      () => db.doc("reserves/2026").merge({ kind: "issue", year: "2026", reserve: { status: "Requested", veh: "DT-09", date: "2026-10-08" } }),
      (err) => err && err.message === "Reload the page" && err.code === "stale_client"
    );
    assert.equal(bare.__sent[0].build, "");
    assert.equal(bare.__sent[0].spec.build, undefined);
    assert.equal(rpcLog.length, 0);
    assert.equal(reserveCount(), before);
    const state = createRecordState({ app: { nextVrf: 6123, nextReserve: 109 }, reserves: [] });
    await assert.rejects(
      () => issueIntoRecords(state, { kind: "issue", reserve: { status: "Requested", veh: "DT-09", date: "2026-10-08" } }),
      (err) => err && err.message === "Reload the page" && err.statusCode === 409
    );
  });

  it("sends a new VRF for approval and reads the server number back", async () => {
    const before = reserveCount();
    await page.__api.sendForApproval(form(), button(), {});
    assert.equal(reserveCount(), before + 1);
    const created = records["reserve:109"];
    assert.ok(created);
    assert.equal(created.vrf_no, "6123");
    assert.equal(created.data.status, "Requested");
    assert.equal(created.data.veh, "DT-09");
    assert.equal(created.data.requestedBy, "Ana Cruz");
    assert.equal(created.data.no, "109");
    const state = page.__api.getS();
    const back = state.reserves.find((row) => String(row.no) === "109");
    assert.ok(back);
    assert.equal(String(back.vrfNo), "6123");
    assert.ok(page.__sent.some((call) => call.op === "get" && call.path === "reserves/2026"));
    const issue = rpcLog.find((call) => call.kind === "issue");
    assert.ok(issue);
    assert.equal(issue.build, PAGE_BUILD);
    assert.equal(issue.specBuild, PAGE_BUILD);
    assert.equal(page.__blobSets.length, 0);
    assert.equal(approveCalls, 0);
    assert.ok(page.__toasts.some((msg) => msg.indexOf("VRF 6123 sent for approval") === 0));
    assert.ok(!page.__toasts.some((msg) => /Reload the page/.test(msg)));
  });

  it("does not number a duplicate until the yard confirms, then assigns the next number", async () => {
    records["reserve:200"] = {
      id: "reserve:200",
      kind: "reserve",
      reserve_no: "200",
      vrf_no: "6100",
      live: true,
      year: "2026",
      month: null,
      data: {
        no: "200",
        vrfNo: "6100",
        vrfs: [],
        date: "2026-10-08",
        status: "Requested",
        veh: "DT-01",
        work: "REP",
        budget: 1500,
        draftOdo: "1000",
        odoAtRequest: 1000,
        draftLines: [{ cat: "Belt", item: "Belt", qty: 1, price: 1500, work: "REP" }],
        draftPurpose: "same job",
        requestedBy: "Ana Cruz",
        submissionId: "sub-open",
      },
      updated_at: stamp(),
    };
    const state = page.__api.getS();
    state.reserves.push(JSON.parse(JSON.stringify(records["reserve:200"].data)));
    page.__api.resetIndex();
    const draft = form({ veh: "DT-01", date: "2026-10-08", odo: "1000", purpose: "same job" });
    const before = reserveCount();
    await page.__api.sendForApproval(draft, button(), {});
    assert.equal(reserveCount(), before);
    assert.equal(rpcLog.filter((call) => call.kind === "issue").length, 0);
    const matches = page.__api.findSameOpenRequests(page.__api.vrfIndex(), {
      veh: "DT-01",
      date: "2026-10-08",
      odo: "1000",
      total: 1500,
      jobs: ["REP"],
      status: "Open",
    }, "");
    assert.ok(matches.length >= 1);
    await page.__api.sendForApproval(draft, button(), { confirmDuplicate: true });
    assert.equal(reserveCount(), before + 1);
    const created = Object.keys(records)
      .map((key) => records[key])
      .find((rec) => rec && rec.kind === "reserve" && rec.reserve_no !== "108" && rec.reserve_no !== "200");
    assert.ok(created);
    assert.equal(created.vrf_no, "6123");
    assert.equal(created.data.veh, "DT-01");
    assert.equal(records["reserve:200"].vrf_no, "6100");
    assert.equal(page.__blobSets.length, 0);
  });

  it("updates one reserve, one ledger row, and an approval without the approve RPC", async () => {
    const state = page.__api.getS();
    const reserve = page.__api.reserveBy("108");
    reserve.printedAt = "2026-10-08T10:00:00+08:00";
    reserve.audit = [{ at: "2026-10-08T10:00:00+08:00", by: "Ana", field: "note", from: "", to: "seen" }];
    reserve.duplicateOf = "";
    await page.__api.saveReserves("108");
    assert.equal(records["reserve:108"].data.printedAt, "2026-10-08T10:00:00+08:00");
    assert.equal(records["reserve:108"].data.audit.length, 1);
    assert.equal(records["reserve:108"].vrf_no, "6122");
    assert.ok(!rpcLog.some((call) => call.kind === "reserve"));

    await page.__api.replaceLedgerVrf("2026-10", "6122", [
      {
        month: "2026-10",
        date: "2026-10-07",
        vrf: "6122",
        veh: "SV-12",
        cat: "Belt",
        qty: 2,
        price: 1500,
        total: 3000,
        work: "REP",
        reserve: "108",
        vstatus: "Open",
      },
    ]);
    assert.equal(records["ledger:6122"].data.rows.length, 1);
    assert.equal(records["ledger:6122"].data.rows[0].qty, 2);
    assert.equal(reserveCount(), 1);
    assert.ok(!rpcLog.some((call) => call.kind === "ledger"));

    await page.__api.appendLedger("2026-10", [
      { month: "2026-10", vrf: "6122", veh: "SV-12", cat: "Oil", qty: 1, price: 100, total: 100, reserve: "108" },
    ]);
    assert.equal(records["ledger:6122"].data.rows.length, 2);
    assert.equal(reserveCount(), 1);

    state.ledger["2026-10"] = JSON.parse(JSON.stringify(records["ledger:6122"].data.rows));
    page.__api.resetIndex();
    const entry = page.__api.vrfByNo("6122");
    await page.__api.saveVrfOdo(entry, 5555);
    assert.ok(records["ledger:6122"].data.rows.every((row) => row.odo === 5555));
    assert.equal(String(records["reserve:108"].data.draftOdo), "5555");

    page.__api.resetIndex();
    const fresh = page.__api.vrfByNo("6122");
    await page.__api.saveVrfHeader(
      fresh,
      { veh: "DT-09", project: "Moved", date: "2026-10-08", odo: "42", requestedBy: "Ana", purpose: "header", work: "REP" },
      "Ana"
    );
    assert.equal(records["reserve:108"].data.project, "Moved");
    assert.equal(records["reserve:108"].data.veh, "DT-09");
    assert.ok((records["reserve:108"].data.audit || []).some((note) => note.field === "project"));
    assert.equal(records["ledger:6122"].data.rows[0].project, "Moved");
    assert.equal(records["ledger:6122"].month, "2026-10");
    assert.equal(reserveCount(), 1);

    page.__api.resetIndex();
    state.ledger["2026-10"] = JSON.parse(JSON.stringify(records["ledger:6122"].data.rows));
    const printed = page.__api.vrfByNo("6122");
    await page.__api.markVrfPrinted(printed);
    assert.ok(records["reserve:108"].data.printedAt);
    assert.ok(Object.keys(records).some((key) => records[key].kind === "issued" && records[key].vrf_no === "6122"));

    const held = JSON.parse(JSON.stringify(records["reserve:108"].data));
    held.status = "Requested";
    held.vrfs = [];
    held.approvedBudget = null;
    delete records["ledger:6122"];
    state.reserves = [held];
    state.ledger = {};
    page.__api.resetIndex();
    const approving = page.__api.reserveBy("108");
    approving.status = "Approved";
    approving.approvedBudget = 1500;
    approving.approvedBy = "Jeffrey";
    approving.approvedAt = "2026-10-08T09:00:00+08:00";
    const posted = await page.__api.postAndSaveReserve(approving);
    assert.equal(String(posted), "6122");
    assert.ok(records["ledger:6122"]);
    assert.equal(records["ledger:6122"].data.rows[0].vrf, "6122");
    assert.equal(records["reserve:108"].data.status, "Approved");
    assert.equal(approveCalls, 0);
    assert.ok(rpcLog.some((call) => call.kind === "bundle" && call.build === PAGE_BUILD));
    assert.equal(page.__blobSets.length, 0);
    assert.equal(reserveCount(), 1);
  });

  it("liquidates, cancels, and marks a duplicate without a year or month blob", async () => {
    page.__api.resetIndex();
    const open = page.__api.vrfByNo("6122");
    await page.__api.liquidateVrf(open, [{ price: 1400 }], [], "Ana Cruz", "bought the belt", "bought");
    assert.equal(records["ledger:6122"].data.rows[0].vstatus, "Closed");
    assert.equal(records["ledger:6122"].data.rows[0].price, 1400);
    assert.ok(records["reserve:108"].data.status === "Closed" || records["reserve:108"].data.status === "Flagged");
    assert.equal(reserveCount(), 1);

    seedStore();
    const state = page.__api.getS();
    state.reserves = [JSON.parse(JSON.stringify(records["reserve:108"].data))];
    state.ledger = { "2026-10": JSON.parse(JSON.stringify(records["ledger:6122"].data.rows)) };
    page.__api.resetIndex();
    const posted = page.__api.vrfByNo("6122");
    await page.__api.cancelApprovedVrf(posted, "Ana Cruz", "supplier had none");
    assert.equal(records["ledger:6122"].data.rows[0].vstatus, "Cancelled");
    assert.equal(records["reserve:108"].data.status, "Cancelled");

    seedStore();
    state.reserves = [JSON.parse(JSON.stringify(records["reserve:108"].data))];
    state.reserves[0].status = "Requested";
    state.reserves[0].vrfs = [];
    state.ledger = {};
    delete records["ledger:6122"];
    records["reserve:108"].data.status = "Requested";
    records["reserve:108"].data.vrfs = [];
    page.__api.resetIndex();
    const requested = page.__api.vrfByNo("6122");
    await page.__api.markVrfDuplicate(requested, "6001", "Ana Cruz", "Duplicate of VRF 6001");
    assert.equal(records["reserve:108"].data.status, "Cancelled");
    assert.equal(records["reserve:108"].data.cancelOutcome, "duplicate");
    assert.equal(records["reserve:108"].data.duplicateOf, "6001");
    assert.equal(reserveCount(), 1);
    assert.equal(page.__blobSets.length, 0);
    assert.ok(!rpcLog.some((call) => call.kind === "ledger"));
  });

  it("indexes a new month from the ledger row instead of calling the issue RPC", async () => {
    const res = await callHandler({
      op: "merge",
      build: PAGE_BUILD,
      spec: {
        kind: "ledger",
        month: "2026-11",
        vrf: "6122",
        mode: "append",
        ensureIndex: true,
        rows: [{ vrf: "6122", month: "2026-11", cat: "Oil", qty: 1, price: 10, reserve: "108" }],
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.kind, "ledger");
    assert.equal(records["ledger:6122"].month, "2026-11");
    assert.equal(records["ledger:6122"].data.rows.length, 2);
    assert.ok(docs["ledger/index"].data.months.indexOf("2026-11") >= 0);
    assert.equal(reserveCount(), 1);
    assert.ok(!rpcLog.some((call) => call.kind === "ledger"));
  });

  it("refuses a whole-year or whole-month fallback when merge does not answer", async () => {
    const state = page.__api.getS();
    const real = state.db;
    state.db = {
      doc() {
        return {
          merge: async () => null,
          set: async () => {
            page.__blobSets.push("client-set");
            throw new Error("set should not run");
          },
          get: async () => ({ exists: true, data: () => ({ rows: [], year: "2026", month: "2026-10" }) }),
        };
      },
    };
    await assert.rejects(
      () => page.__api.replaceLedgerVrf("2026-10", "6122", [{ vrf: "6122", month: "2026-10" }]),
      (err) => err && err.code === "not_confirmed"
    );
    await assert.rejects(
      () => page.__api.appendLedger("2026-10", [{ vrf: "6122", month: "2026-10" }]),
      (err) => err && err.code === "not_confirmed"
    );
    await assert.rejects(
      () =>
        page.__api.commitVrfBundle({
          month: "2026-10",
          vrf: "6122",
          rows: [{ vrf: "6122" }],
          mode: "replace",
          reserve: records["reserve:108"].data,
        }),
      (err) => err && err.code === "not_confirmed"
    );
    await assert.rejects(
      () => page.__api.saveReserves("108"),
      (err) => err && err.code === "not_confirmed"
    );
    state.db = real;
    await assert.rejects(
      () => page.__api.writeDoc("reserves/2026", { year: "2026", rows: [] }),
      (err) => err && err.code === "stale_overwrite" && !/Reload the page/.test(err.message)
    );
    await assert.rejects(
      () => page.__api.writeDoc("ledger/2026-10", { month: "2026-10", rows: [] }),
      (err) => err && err.code === "stale_overwrite"
    );
    assert.equal(page.__blobSets.length, 0);
    assert.equal(reserveCount(), 1);
  });
});
