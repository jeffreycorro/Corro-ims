"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { PDFDocument } = require("pdf-lib");

const { createHandler, sha256 } = require("../netlify/lib/hr-approve-action");
const hrBotApprove = require("../public/hr-bot-approve");

const SECRET = "test-bot-secret-do-not-use-in-production-0123456789";
const HASH = sha256(SECRET);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG = Uint8Array.from(Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==",
  "base64"
));

function loadSheetAndPay() {
  const ctx = { console, TextEncoder, Intl, Date, Math, JSON, Number, String, Object, Array };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-payroll-sheet.js"), "utf8"), ctx);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-project-pay.js"), "utf8"), ctx);
  return ctx;
}

function engineStub() {
  const ctx = loadSheetAndPay();
  return {
    payTransition: ctx.payTransition,
    payRunStatusOf: ctx.payRunStatusOf,
    payCloneRun: ctx.payCloneRun,
    payPeriod: ctx.payPeriod || function () { return { from: "2026-11-19", to: "2026-11-25" }; },
    payProjectSummary: ctx.payProjectSummary,
    payAliasConfirmedMap: ctx.payAliasConfirmedMap,
    hrPaySheet: ctx.hrPaySheet,
  };
}

function lineWithException() {
  return [{
    empId: "e1",
    name: "Santos, Ben",
    days: 1,
    ot: 0,
    gross: 500,
    net: 500,
    exceptions: [{ code: "missing-day", text: "No daily manpower record for 2026-11-19.", date: "2026-11-19" }],
  }];
}

function harness(extra) {
  const writes = [];
  const audits = [];
  const uploads = [];
  const base = {
    rest: async function (req) {
      if (String(req.path).indexOf("hr_bot_secrets") >= 0) return [{ secret_sha256: HASH }];
      if (String(req.path).indexOf("hr_bot_audit") >= 0) {
        audits.push(req.body);
        return null;
      }
      return [];
    },
    getDoc: async function () { return null; },
    setDoc: async function (collection, id, data) { writes.push({ collection, id, data }); return { id, data }; },
    deleteDoc: async function () {},
    listCollection: async function () { return []; },
    putObject: async function (objectPath, bytes) { uploads.push({ objectPath, bytes }); return { path: objectPath }; },
    signDownload: async function (objectPath) { return { signedUrl: "https://files.example.test/" + objectPath, path: objectPath }; },
    renderPrintPdf: async function () { return Buffer.from("%PDF-1.4 bot"); },
    printHtml: function () { return '<div class="pay-approval-stamp">APPROVED BY JEFFREY JAMES CORRO</div>'; },
    printBlocked: function () { return ""; },
    lines: lineWithException(),
    engine: engineStub(),
    store: {
      employees: { e1: { id: "e1", name: "Santos, Ben", empNo: "10", rateType: "daily", dailyRate: 500, status: "Project-based" } },
      daily: {},
      settings: { signatory: "Jeffrey James M. Corro", hrSigs: { signatory: { data: PNG } }, otPolicy: 1 },
      advances: {},
      projects: {},
      payruns: {
        "weekly|2026-11-19": { id: "weekly|2026-11-19", kind: "weekly", from: "2026-11-19", to: "2026-11-25", status: "draft", lines: {} },
      },
      otplans: {},
      otreps: {},
      leaves: {},
      ui: {},
    },
    drive: false,
    loadDecision: false,
    today: "2026-11-28",
    now: "2026-11-28 09:15",
  };
  const handler = createHandler(Object.assign(base, extra || {}));
  return { handler, writes, audits, uploads };
}

function post(body, secret) {
  return {
    httpMethod: "POST",
    headers: secret ? { authorization: "Bearer " + secret } : {},
    body: JSON.stringify(body),
  };
}

describe("HR bot approval", function () {
  it("rejects a call with no bearer secret", async function () {
    const { handler, writes } = harness();
    const res = await handler(post({ kind: "payrun", id: "weekly|2026-11-19" }, ""));
    assert.equal(res.statusCode, 401);
    assert.equal(writes.length, 0);
  });

  it("rejects the wrong secret", async function () {
    const { handler, writes } = harness();
    const res = await handler(post({ kind: "payrun", id: "weekly|2026-11-19", dryRun: true }, "not-the-secret"));
    assert.equal(res.statusCode, 401);
    assert.equal(writes.length, 0);
  });

  it("stays closed when no hash is stored", async function () {
    const { handler } = harness({
      rest: async function (req) {
        if (String(req.path).indexOf("hr_bot_secrets") >= 0) return [];
        return null;
      },
    });
    const res = await handler(post({ kind: "payrun", id: "weekly|2026-11-19" }, SECRET));
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /20261128000001_hr_bot_approve/);
  });

  it("dry-run reports the payrun approval and does not write it", async function () {
    const { handler, writes, audits } = harness();
    const res = await handler(post({ kind: "payrun", id: "weekly|2026-11-19", dryRun: true }, SECRET));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.item, "weekly|2026-11-19");
    assert.equal(body.newStatus, "approved");
    assert.equal(body.approvedAt, "2026-11-28 09:15");
    assert.equal(body.approvedPdfUrl, null);
    assert.equal(body.dryRun, true);
    assert.deepEqual(body.steps, ["submit", "acknowledge", "approve"]);
    assert.equal(writes.length, 0);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].approver, "Jeffrey James M. Corro");
    assert.equal(audits[0].via, "HR Bot");
    assert.equal(audits[0].item_id, "weekly|2026-11-19");
    assert.equal(audits[0].dry_run, true);
  });

  it("submits, acknowledges exceptions, approves as Jeffrey, and returns the PDF url", async function () {
    const { handler, writes, uploads, audits } = harness();
    const res = await handler(post({ kind: "payrun", id: "weekly|2026-11-19" }, SECRET));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.newStatus, "approved");
    assert.equal(body.approvedAt, "2026-11-28 09:15");
    assert.match(body.approvedPdfUrl, /^https:\/\/files\.example\.test\/bot-approve\/payruns\//);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].collection, "payruns");
    assert.equal(writes[0].data.status, "approved");
    assert.equal(writes[0].data.approvedBy, "Jeffrey James M. Corro");
    assert.equal(writes[0].data.submittedBy, "Jeffrey James M. Corro");
    assert.ok(Object.keys(writes[0].data.exceptionsAck || {}).length > 0);
    assert.equal(uploads.length, 1);
    assert.equal(audits[0].approver, "Jeffrey James M. Corro");
    assert.equal(audits[0].via, "HR Bot");
    assert.equal(audits[0].ok, true);
    assert.equal(audits[0].dry_run, false);
  });

  it("does not approve a second time", async function () {
    const { handler, writes } = harness({
      store: {
        payruns: {
          "weekly|2026-11-19": {
            id: "weekly|2026-11-19",
            status: "approved",
            approvedAt: "2026-11-20 08:00",
            approvedBy: "Jeffrey James M. Corro",
            approvedPdfPath: "bot-approve/payruns/weekly-2026-11-19.pdf",
          },
        },
        settings: {},
        employees: {},
        projects: {},
      },
      lines: [],
    });
    const res = await handler(post({ kind: "payrun", id: "weekly|2026-11-19" }, SECRET));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.already, true);
    assert.equal(body.newStatus, "approved");
    assert.equal(body.approvedAt, "2026-11-20 08:00");
    assert.match(body.approvedPdfUrl, /^https:\/\//);
    assert.equal(writes.length, 0);
  });

  it("dry-runs a leave by fetching the scan and the signature without writing", async function () {
    const rec = {
      id: "l1",
      no: "LRF-TEST-0001",
      status: "For approval",
      empId: "e1",
      signedLink: "/.netlify/functions/files?path=misc/2026-11/scan.jpg",
      signedTitle: "LRF-TEST-0001 SIGNED.jpg",
    };
    let reads = 0;
    const { handler, writes, uploads } = harness({
      leave: { id: "l1", data: rec },
      readObject: async function (objectPath) {
        reads += 1;
        assert.equal(objectPath, "misc/2026-11/scan.jpg");
        return { bytes: JPEG, mime: "image/jpeg" };
      },
      store: {
        leaves: { l1: rec },
        employees: { e1: { id: "e1", name: "Santos, Ben" } },
        settings: { signatory: "Jeffrey James M. Corro", hrSigs: { signatory: { data: PNG } } },
        advances: {},
        daily: {},
        payruns: {},
      },
    });
    const res = await handler(post({ kind: "leave", id: "LRF-TEST-0001", dryRun: true }, SECRET));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.item, "LRF-TEST-0001");
    assert.equal(body.newStatus, "Approved");
    assert.equal(body.approvedPdfUrl, null);
    assert.deepEqual(body.steps, ["fetch", "stamp", "approve"]);
    assert.equal(reads, 1);
    assert.equal(writes.length, 0);
    assert.equal(uploads.length, 0);
  });

  it("returns approvedPdfUrl after a real leave approve stamps the signed scan", async function () {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const bytes = await pdf.save();
    const signed = "data:application/pdf;base64," + Buffer.from(bytes).toString("base64");
    const rec = {
      id: "l1",
      no: "LRF-TEST-0001",
      status: "For approval",
      empId: "e1",
      signedLink: signed,
    };
    let created = null;
    const { handler, writes } = harness({
      leave: { id: "l1", data: rec },
      drive: true,
      createFile: async function (args) {
        created = args;
        return { payload: { viewUrl: "https://drive.google.com/file/d/stamped/view", title: args.title, id: "stamped" } };
      },
      downloadFile: async function () { throw new Error("should use the data url"); },
      store: {
        leaves: { l1: rec },
        employees: { e1: { id: "e1", name: "Santos, Ben" } },
        settings: { signatory: "Someone Else", hrSigs: { signatory: { data: PNG } } },
        advances: {},
        daily: {},
        payruns: {},
        ui: {},
      },
    });
    const res = await handler(post({ kind: "leave", id: "l1" }, SECRET));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.item, "LRF-TEST-0001");
    assert.equal(body.newStatus, "Approved");
    assert.equal(body.approvedPdfUrl, "https://drive.google.com/file/d/stamped/view");
    assert.ok(created && created.base64Content);
    const saved = writes[writes.length - 1].data;
    assert.equal(saved.status, "Approved");
    assert.equal(saved.approvedBy, "Jeffrey James M. Corro");
    assert.equal(saved.pdfIncludesSignature, true);
    assert.equal(saved.approvedPdfLink, "https://drive.google.com/file/d/stamped/view");
    assert.equal(saved.officialPrint, "stamped-upload");
    assert.ok(saved.originalSignedLink);
  });

  it("refuses a leave that is not For approval", async function () {
    const rec = { id: "l2", no: "LRF-TEST-0002", status: "Filed" };
    const { handler, writes } = harness({
      leave: { id: "l2", data: rec },
      store: { leaves: { l2: rec }, settings: { hrSigs: { signatory: { data: PNG } } }, employees: {}, advances: {}, daily: {}, payruns: {} },
    });
    const res = await handler(post({ kind: "leave", id: "LRF-TEST-0002" }, SECRET));
    assert.equal(res.statusCode, 409);
    assert.equal(writes.length, 0);
  });

  it("shares submit, acknowledge, and approve with one sequence", function () {
    const ctx = loadSheetAndPay();
    const run = { id: "weekly|2026-11-19", kind: "weekly", from: "2026-11-19", to: "2026-11-25", lines: {} };
    const lines = lineWithException();
    const result = hrBotApprove.approveThroughFinalize(run, lines, {
      transition: ctx.payTransition,
      statusOf: ctx.payRunStatusOf,
      cloneRun: ctx.payCloneRun,
      openExceptions: ctx.hrPaySheet.openExceptions.bind(ctx.hrPaySheet),
      actor: { role: "admin", name: hrBotApprove.APPROVER_NAME },
      approverUnlocked: true,
      now: "2026-11-28 09:15",
      today: "2026-11-28",
      who: hrBotApprove.APPROVER_NAME,
      snapshot: null,
    });
    assert.equal(result.ok, true);
    assert.equal(result.run.status, "approved");
    assert.equal(result.run.approvedBy, "Jeffrey James M. Corro");
    assert.equal(result.run.submittedBy, "Jeffrey James M. Corro");
    assert.ok(Object.keys(result.run.exceptionsAck).length > 0);
    const again = hrBotApprove.approveStep(result.run, lines, {
      transition: ctx.payTransition,
      openExceptions: ctx.hrPaySheet.openExceptions.bind(ctx.hrPaySheet),
      actor: { role: "staff" },
      approverUnlocked: false,
      who: "HR",
    });
    assert.equal(again.ok, false);
  });
});

describe("payrun path under Node", function () {
  it("dry-runs a full weekly payrun in Node with every referenced helper loaded", async function () {
    const { loadEngine, printHtmlFor } = require("../netlify/lib/payroll-engine");
    const engine = loadEngine();
    assert.deepEqual(engine._unresolved, []);
    assert.ok(engine._bindings.includes("nameLastFirst"));
    assert.ok(engine._bindings.includes("LRF_FULL"));
    assert.ok(engine._bindings.includes("cmpEmpAlpha"));
    const day = {
      id: "d20261119",
      date: "2026-11-19",
      rows: {
        e1: { s: "Present", day: 1, ot: 1, site: "TAWASON", in: "08:10", out: "18:00", r: "Approved Leave (LRF2026 - 0207)" },
        e2: { s: "Present", day: 1, ot: 0, site: "TAWASON", in: "08:00", out: "17:00" },
      },
    };
    const person = function (id, name, empNo) {
      return {
        id: id,
        empNo: empNo,
        name: name,
        position: "Laborer",
        project: "TAWASON",
        rateType: "daily",
        dailyRate: 500,
        status: "Project-based",
        dateHired: "2020-01-01",
      };
    };
    const { handler, writes, uploads } = harness({
      engine: null,
      lines: null,
      printBlocked: null,
      printHtml: null,
      renderPrintPdf: async function (html) {
        assert.match(html, /APPROVED BY JEFFREY JAMES CORRO/);
        return Buffer.from("%PDF-1.4 node-payrun");
      },
      store: {
        employees: {
          e1: person("e1", "Santos, Ben", "10"),
          e2: person("e2", "Reyes, Ana", "11"),
        },
        daily: { d20261119: day },
        settings: {
          signatory: "Jeffrey James M. Corro",
          signatoryTitle: "CEO / President",
          payrollBy: "Catherine A. Largo",
          otPolicy: 1,
          otFormGateWaived: true,
          ded: { sss: 0, phic: 0, hdmf: 0 },
          hrSigs: {
            signatory: { data: PNG, title: "jeffrey.png" },
            evaluated: { data: PNG, title: "catherine.png" },
          },
        },
        advances: {},
        projects: {},
        payruns: {
          "weekly|2026-11-19": {
            id: "weekly|2026-11-19",
            kind: "weekly",
            from: "2026-11-19",
            to: "2026-11-25",
            status: "draft",
            lines: {},
          },
        },
        otplans: {},
        otreps: {},
        leaves: {
          l1: { id: "l1", empId: "e1", no: "LRF2026-0207", status: "Approved", type: "SIL", from: "2026-11-19", to: "2026-11-19", pay: 1 },
        },
        ui: {},
      },
    });
    const res = await handler(post({ kind: "payrun", id: "weekly|2026-11-19", dryRun: true }, SECRET));
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.item, "weekly|2026-11-19");
    assert.equal(body.newStatus, "approved");
    assert.equal(body.approvedPdfUrl, null);
    assert.deepEqual(body.steps, ["submit", "acknowledge", "approve"]);
    assert.equal(writes.length, 0);
    assert.equal(uploads.length, 0);
    const parsed = engine.nameLastFirst("Santos, Ben");
    assert.equal(parsed.last, "Santos");
    assert.equal(parsed.first, "Ben");
    const printed = printHtmlFor(engine.S, "weekly", { from: "2026-11-19", to: "2026-11-25" }, engine.payRunLines(
      "weekly",
      { from: "2026-11-19", to: "2026-11-25" },
      engine.payDates("2026-11-19", "2026-11-25"),
      engine.S.payruns["weekly|2026-11-19"]
    ).filter(engine.payHasTime), {
      id: "weekly|2026-11-19",
      kind: "weekly",
      from: "2026-11-19",
      to: "2026-11-25",
      status: "approved",
      approvedAt: "2026-11-28 09:15",
      approvedBy: "Jeffrey James M. Corro",
    }, "2026-11-28");
    assert.match(printed, /APPROVED BY JEFFREY JAMES CORRO/);
  });
});

describe("payroll engine print", function () {
  it("builds the approved print HTML from the same payPrintOptions path", function () {
    const { loadEngine, linesFor, printHtmlFor } = require("../netlify/lib/payroll-engine");
    const engine = loadEngine();
    assert.equal(typeof engine.payRunLines, "function");
    assert.equal(typeof engine.payPrintOptions, "function");
    const store = {
      employees: {
        e1: {
          id: "e1",
          empNo: "10",
          name: "Santos, Ben",
          position: "Laborer",
          project: "TAWASON",
          rateType: "daily",
          dailyRate: 500,
          status: "Project-based",
          hired: "2020-01-01",
        },
      },
      daily: {
        d20261119: {
          id: "d20261119",
          date: "2026-11-19",
          rows: { e1: { s: "Present", day: 1, ot: 0, site: "TAWASON", in: "08:00", out: "17:00" } },
        },
      },
      settings: {
        signatory: "Jeffrey James M. Corro",
        signatoryTitle: "CEO / President",
        payrollBy: "Catherine A. Largo",
        otPolicy: 1,
        otFormGateWaived: true,
        ded: { sss: 0, phic: 0, hdmf: 0 },
        hrSigs: {
          signatory: { data: PNG, title: "jeffrey.png" },
          evaluated: { data: PNG, title: "catherine.png" },
        },
      },
      advances: {},
      projects: {},
      payruns: {},
      otplans: {},
      otreps: {},
      leaves: {},
      ui: {},
    };
    const lines = linesFor(store, "weekly", "2026-11-19", "2026-11-25", "2026-11-28");
    assert.ok(lines.length >= 1);
    const run = {
      id: "weekly|2026-11-19",
      kind: "weekly",
      from: "2026-11-19",
      to: "2026-11-25",
      status: "approved",
      approvedAt: "2026-11-28 09:15",
      approvedBy: "Jeffrey James M. Corro",
      lines: {},
    };
    const html = printHtmlFor(store, "weekly", { from: "2026-11-19", to: "2026-11-25" }, lines, run, "2026-11-28");
    assert.match(html, /APPROVED BY JEFFREY JAMES CORRO/);
    assert.match(html, /class="pay-approval-sig"/);
    assert.match(html, /Weekly Payroll Report/);
  });
});

describe("build stamp", function () {
  it("is build 2026-11-28c", function () {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    const approver = fs.readFileSync(path.join(__dirname, "../public/hr-approver.js"), "utf8");
    assert.match(html, /const BUILD = "2026-11-28c"/);
    assert.match(html, /hrBotApprove\.submitStep/);
    assert.match(html, /hrBotApprove\.approveStep/);
    assert.match(html, /hrBotApprove\.acknowledgeStep/);
    assert.match(approver, /APPROVER_PASSWORD = "032589"/);
    assert.match(html, /function blockCompanyPrint/);
  });
});

describe("print pdf", function () {
  it("writes a PDF from the print HTML without Chrome", async function () {
    const { renderPrintPdf } = require("../netlify/lib/print-pdf");
    const bytes = await renderPrintPdf(
      '<div>APPROVED BY JEFFREY JAMES CORRO</div><img class="pay-approval-sig" src="' + PNG + '">',
      { preferChrome: false }
    );
    assert.equal(Buffer.from(bytes).slice(0, 4).toString(), "%PDF");
  });
});
