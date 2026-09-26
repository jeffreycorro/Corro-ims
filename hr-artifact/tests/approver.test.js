"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");
const { PDFDocument } = require("pdf-lib");
const appr = require("../public/hr-approver");

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const SIG = "data:image/png;base64,QQQ";

function settings() {
  return {
    payrollBy: "Catherine A. Largo",
    payrollTitle: "Safety Officer",
    hrHead: "Domingo C. Monte Jr.",
    signatory: "Jeffrey James M. Corro",
    signatoryTitle: "CEO / President",
    president: "Jeffrey James M. Corro",
    hrSigs: {
      prepared: { data: "data:image/png;base64,PREP", name: "Prepared by", title: "cassie.jpg" },
      signatory: { data: SIG, name: "Jeffrey James M. Corro", title: "jeffrey-corro.jpg", slot: "signatory" },
    },
  };
}

describe("HR approver queue", () => {
  it("keeps filed and for-signature items out, and queues a signed evaluator copy", () => {
    const S = {
      settings: settings(),
      employees: { e1: { id: "e1", name: "Santos, Ana" } },
      leaves: {
        filed: { id: "filed", status: "Filed", empId: "e1", no: "LRF1" },
        printing: { id: "printing", status: "For signature", empId: "e1", no: "LRF2" },
        old: { id: "old", status: "Approved", empId: "e1", no: "LRF0", approvedBy: "paper" },
      },
      advances: {},
      docreg: {},
    };
    const signed = appr.applyEvaluatorGate(
      "leaves",
      { id: "ev", status: "For signature", empId: "e1", no: "LRF3", signedLink: "https://drive/lrf3.pdf", from: "2026-09-20", to: "2026-09-22", days: 3, type: "VL" },
      { id: "ev", status: "For signature", empId: "e1" },
      S
    );
    assert.equal(signed.status, "For approval");
    assert.equal(signed.evaluatedBy, "Catherine A. Largo");
    assert.equal(signed.pdfIncludesSignature, undefined);
    S.leaves.ev = signed;
    const q = appr.queueItems(S);
    assert.deepEqual(q.map((r) => r.id), ["ev"]);
    assert.equal(q[0].kind, "leave");
    assert.equal(q[0].employee, "Santos, Ana");
    assert.equal(q[0].evaluator, "Catherine A. Largo");
    assert.match(q[0].pdf, /lrf3/);
  });

  it("turns an Approved save after evaluation into For approval, and leaves historical Approved alone", () => {
    const S = { settings: settings(), leaves: {}, advances: {}, docreg: {} };
    const claimed = appr.applyEvaluatorGate(
      "leaves",
      { id: "l", status: "Approved", signedLink: "https://drive/signed.pdf", empId: "e1" },
      { id: "l", status: "For signature", signedLink: "https://drive/signed.pdf", empId: "e1" },
      S
    );
    assert.equal(claimed.status, "For approval");
    assert.equal(claimed.approvalLabel, appr.LABEL_WAITING);

    const historical = appr.applyEvaluatorGate(
      "leaves",
      { id: "h", status: "Approved", signedLink: "https://drive/old.pdf" },
      { id: "h", status: "Approved", signedLink: "https://drive/old.pdf" },
      S
    );
    assert.equal(historical.status, "Approved");
    assert.equal(appr.queueItems({ settings: settings(), leaves: { h: historical }, advances: {}, docreg: {} }).length, 0);

    const imported = appr.applyEvaluatorGate(
      "advances",
      { id: "c", status: "Approved", notes: "Imported from Drive", amount: 5000 },
      undefined,
      S
    );
    assert.equal(imported.status, "Approved");
  });

  it("does not treat a cash advance as approved before Jeffrey, and rejects it out of the queue", () => {
    const S = { settings: settings(), employees: { e1: { name: "Cruz, Bea" } }, leaves: {}, docreg: {} };
    const ca = appr.applyEvaluatorGate(
      "advances",
      { id: "ca", status: "Requested", signedLink: "https://drive/ca.pdf", amount: 20000, purpose: "Travel", empId: "e1", no: "CAF1" },
      { id: "ca", status: "Requested" },
      S
    );
    assert.equal(ca.status, "For approval");
    const q = appr.queueItems({ ...S, advances: { ca: ca } });
    assert.equal(q.length, 1);
    assert.match(q[0].detail, /Travel/);
    assert.match(q[0].detail, /20000/);

    const rejected = appr.rejectRecord(ca, { kind: "ca", note: "need receipts", by: "Jeffrey James M. Corro" });
    assert.equal(rejected.record.status, "Disapproved");
    assert.equal(rejected.record.approverNote, "need receipts");
    assert.equal(appr.queueItems({ ...S, advances: { ca: rejected.record } }).length, 0);
  });

  it("queues a newly issued employment contract and ignores quitclaims and already-issued contracts", () => {
    const S = {
      settings: settings(),
      employees: { e1: { name: "Reyes, Pio" } },
      leaves: {},
      advances: {},
      docreg: {},
    };
    const issued = appr.applyEvaluatorGate(
      "docreg",
      { id: "d1", seriesKey: "CON", kind: "contract", status: "Issued", title: "Employment Contract — Project-based", empId: "e1", no: "CON2026-01" },
      { id: "d1", seriesKey: "CON", status: "Draft" },
      S
    );
    assert.equal(issued.approverStatus, "For approval");
    assert.equal(issued.evaluatedBy, "Domingo C. Monte Jr.");
    assert.equal(issued.status, "Issued");

    const old = { id: "d0", seriesKey: "CON", kind: "contract", status: "Issued", title: "Employment Contract", no: "CON2025-01" };
    const kept = appr.applyEvaluatorGate("docreg", Object.assign({}, old), old, S);
    assert.equal(kept.approverStatus, undefined);

    const quit = appr.applyEvaluatorGate(
      "docreg",
      { id: "q", seriesKey: "CLR", kind: "contract", status: "Issued", title: "Release, Waiver and Quitclaim" },
      { id: "q", status: "Draft", seriesKey: "CLR" },
      S
    );
    assert.notEqual(quit.approverStatus, "For approval");

    const rows = appr.queueItems({ ...S, docreg: { d1: issued, d0: kept, q: quit } });
    assert.deepEqual(rows.map((r) => r.kind + ":" + r.id), ["contract:d1"]);
  });

  it("keeps a contract on the queue when issue saves the wording a second time", () => {
    const S = { settings: settings(), leaves: {}, advances: {}, docreg: {} };
    const first = appr.applyEvaluatorGate(
      "docreg",
      { id: "d1", seriesKey: "CON", status: "Issued", title: "Project-Based Employment Contract", no: "CON2026-04" },
      undefined,
      S
    );
    assert.equal(first.approverStatus, "For approval");
    const second = appr.applyEvaluatorGate(
      "docreg",
      { id: "d1", seriesKey: "CON", status: "Issued", title: "Project-Based Employment Contract", body: "@SIGN Jeffrey|For CORRO", no: "CON2026-04" },
      first,
      S
    );
    assert.equal(second.approverStatus, "For approval");
    assert.equal(second.evaluatedBy, "Domingo C. Monte Jr.");
    assert.match(second.body, /@SIGN/);
  });
});

describe("Jeffrey signature stamp", () => {
  it("uses the signatory e-signature already in HR settings, not the prepared-by image", () => {
    const S = { settings: settings(), employees: {} };
    assert.equal(appr.signatureSrc(S), SIG);
    const fromPerson = appr.signatureSrc({
      settings: { signatory: "Jeffrey James M. Corro" },
      employees: { j: { name: "Corro, Jeffrey J.", sigData: "data:image/jpeg;base64,JEFF" } },
    });
    assert.equal(fromPerson, "data:image/jpeg;base64,JEFF");
  });

  it("stamps only the final-approval cell and records Approved with approvedAt", () => {
    const cols = [
      { who: "Evaluated by", name: "Catherine A. Largo", role: "Safety Officer" },
      { who: "Final Approval (Management)", name: "Jeffrey James M. Corro", role: "CEO / President" },
    ];
    const idx = appr.stampColumnIndex(cols, appr.leaveStampTest);
    assert.equal(idx, 1);
    const html =
      '<table class="pf-sign"><tr><td class="ink">&nbsp;</td><td class="ink">&nbsp;</td></tr>' +
      "<tr><td>Date: ______________</td><td>Date: ______________</td></tr></table>";
    const stamped = appr.stampSignHtml(html, idx, SIG, "2026-09-22");
    assert.equal(stamped.indexOf(SIG) > stamped.indexOf('class="ink"'), true);
    const firstInk = stamped.slice(0, stamped.indexOf(SIG));
    assert.match(firstInk, /<td class="ink">&nbsp;<\/td>/);
    assert.match(stamped, /Date: 2026-09-22/);
    assert.doesNotMatch(stamped.slice(0, stamped.indexOf("Date: 2026-09-22")), /Date: 2026-09-22/);

    const caIdx = appr.stampColumnIndex(
      [
        { who: "Evaluated by", name: "Catherine A. Largo" },
        { who: "Approved by", name: "Jeffrey James M. Corro" },
      ],
      appr.caStampTest
    );
    assert.equal(caIdx, 1);

    const projIdx = appr.stampColumnIndex(
      [
        ["Jeffrey James M. Corro", "For CORRO CONST. DEVELOPMENT & TRADE CORP."],
        ["Ana Santos", "Project Employee"],
      ],
      (col) => appr.contractStampTest(col, "Jeffrey James M. Corro")
    );
    assert.equal(projIdx, 0);
    const witnessIdx = appr.stampColumnIndex(
      [
        ["", "Witness"],
        ["", "Witness"],
      ],
      appr.contractStampTest
    );
    assert.equal(witnessIdx, -1);

    const blocked = appr.approveRecord({ id: "l", status: "For approval" }, { kind: "leave", signature: "" });
    assert.equal(blocked.ok, false);
    const ok = appr.approveRecord(
      { id: "l", status: "For approval", evaluatedBy: "Catherine A. Largo" },
      { kind: "leave", signature: SIG, by: "Jeffrey James M. Corro", at: "2026-09-22T15:04:00", on: "2026-09-22" }
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.record.status, "Approved");
    assert.equal(ok.record.pdfIncludesSignature, true);
    assert.equal(ok.record.approvedAt, "2026-09-22T15:04:00");
    assert.equal(ok.record.approvedBy, "Jeffrey James M. Corro");
    assert.equal(ok.record.signatureStamp, SIG);
    assert.equal(appr.queueItems({ leaves: { l: ok.record }, advances: {}, docreg: {}, settings: settings() }).length, 0);
  });

  it("stamps the president line of an employment contract and drops it from the queue", () => {
    const host = {
      S: { settings: settings(), leaves: {}, advances: {}, docreg: {}, employees: {} },
      document: { readyState: "complete", addEventListener() {}, getElementById() { return null; } },
      pfSignPlain(cols) {
        return cols.map(() => '<td class="ink">&nbsp;</td>').join("");
      },
      proseHTML() {
        return host.pfSignPlain([
          ["Jeffrey James M. Corro", "CEO / President"],
          ["Ana Santos", "Employee"],
        ]);
      },
      pfHead() {
        return "<letterhead>";
      },
      pfTitle(t) {
        return "<h>" + t + "</h>";
      },
      pfControl() {
        return "";
      },
      pfISO() {
        return "";
      },
      paperBody(text) {
        return "PLAIN:" + text;
      },
    };
    appr.patchGlobals(host);
    const waiting = {
      id: "c1",
      seriesKey: "CON",
      kind: "contract",
      status: "Issued",
      approverStatus: "For approval",
      title: "Employment Contract",
      no: "CON2026-04",
    };
    const banner = host.paperBody("@SIGN president", waiting);
    assert.match(banner, /FOR APPROVAL/);
    assert.doesNotMatch(banner, /base64,QQQ/);

    const done = appr.approveRecord(waiting, {
      kind: "contract",
      signature: SIG,
      by: "Jeffrey James M. Corro",
      at: "2026-09-22T16:00:00",
      on: "2026-09-22",
    });
    assert.equal(done.record.status, "Issued");
    assert.equal(done.record.approverStatus, "Approved");
    assert.equal(done.record.pdfIncludesSignature, true);
    const html = host.paperBody("@SIGN president", done.record);
    assert.match(html, /src="data:image\/png;base64,QQQ"/);
    assert.doesNotMatch(html, /FOR APPROVAL/);
    const imgAt = html.indexOf("base64,QQQ");
    const secondInk = html.indexOf('class="ink"', imgAt);
    assert.ok(secondInk > imgAt);
    assert.match(html.slice(secondInk), /&nbsp;/);
    assert.equal(
      appr.queueItems({ leaves: {}, advances: {}, docreg: { c1: done.record }, settings: settings(), employees: {} }).length,
      0
    );
  });

  it("wires put so an evaluator Approved save does not land as fully approved", async () => {
    const S = {
      settings: settings(),
      leaves: { l1: { id: "l1", status: "For signature", signedLink: "https://drive/x.pdf", empId: "e" } },
      advances: {},
      docreg: {},
      employees: {},
    };
    const host = {
      S,
      document: { readyState: "complete", addEventListener() {}, getElementById() { return null; } },
      async put(coll, id, obj) {
        S[coll][id] = obj;
      },
    };
    appr.patchGlobals(host);
    await host.put("leaves", "l1", {
      id: "l1",
      status: "Approved",
      signedLink: "https://drive/x.pdf",
      empId: "e",
    });
    assert.equal(S.leaves.l1.status, "For approval");
    assert.equal(S.leaves.l1.evaluatedBy, "Catherine A. Largo");
    assert.equal(appr.queueItems(S).length, 1);

    const approved = appr.approveRecord(S.leaves.l1, { kind: "leave", signature: appr.signatureSrc(S), by: "Jeffrey James M. Corro" });
    approved.record._fromApprover = true;
    await host.put("leaves", "l1", approved.record);
    assert.equal(S.leaves.l1.status, "Approved");
    assert.equal(S.leaves.l1.pdfIncludesSignature, true);
    assert.ok(S.leaves.l1.approvedAt);
    assert.equal(appr.queueItems(S).length, 0);
  });
});

describe("approver password gate", () => {
  function waitingStore() {
    return {
      settings: settings(),
      ui: { view: "approver", apprFilter: "all" },
      employees: { e1: { name: "Santos, Ana" } },
      leaves: {
        ev: {
          id: "ev",
          status: "For approval",
          no: "LRF9",
          empId: "e1",
          evaluatedBy: "Catherine A. Largo",
          signedLink: "https://drive/lrf9.pdf",
          from: "2026-09-01",
          to: "2026-09-02",
        },
      },
      advances: {},
      docreg: {},
    };
  }

  function harness() {
    const buttons = [];
    const pass = { id: "hr-appr-pass", value: "", focus() { this.focused = true; } };
    const err = { id: "hr-appr-pass-err", textContent: "" };
    const view = { id: "view", innerHTML: "" };
    const nav = {
      id: "nav",
      child: null,
      querySelector() {
        return this.child;
      },
      appendChild(btn) {
        this.child = btn;
      },
    };
    const doc = {
      readyState: "complete",
      listeners: {},
      addEventListener(type, fn) {
        this.listeners[type] = fn;
      },
      getElementById(id) {
        if (id === "view") return view;
        if (id === "nav") return nav;
        if (id === "hr-appr-pass") return pass;
        if (id === "hr-appr-pass-err") return err;
        return null;
      },
      createElement() {
        return {
          type: "button",
          className: "",
          innerHTML: "",
          title: "",
          setAttribute() {},
        };
      },
    };
    const host = {
      S: waitingStore(),
      document: doc,
      crumb: "",
      setCrumb(t, s) {
        host.crumb = t + "|" + (s || "");
      },
      render() {},
      renderNav() {},
      wire() {},
    };
    return { host, doc, view, nav, pass, err, buttons };
  }

  it("hides the queue until the password is entered, and keeps the unlock in page memory", () => {
    const src = fs.readFileSync(path.join(__dirname, "../public/hr-approver.js"), "utf8");
    assert.match(src, /APPROVER_PASSWORD = "032589"/);
    assert.doesNotMatch(src, /localStorage\.(get|set)Item/);
    assert.doesNotMatch(src, /sessionStorage\.(get|set)Item/);

    appr.resetApproverLock();
    assert.equal(appr.isApproverUnlocked(), false);
    const locked = appr.gateHtml();
    assert.match(locked, /id="hr-appr-pass"/);
    assert.match(locked, /Unlock/);
    assert.doesNotMatch(locked, /LRF9|data-hr-appr-approve/);

    const empty = appr.tryApproverPassword("   ");
    assert.equal(empty.ok, false);
    assert.match(empty.message, /Type a password first/);
    assert.equal(appr.isApproverUnlocked(), false);

    const wrong = appr.tryApproverPassword("000000");
    assert.equal(wrong.ok, false);
    assert.match(wrong.message, /does not match/);
    assert.equal(appr.isApproverUnlocked(), false);

    const { host, doc, view, nav, pass, err } = harness();
    appr.patchGlobals(host);
    host.render();
    assert.match(view.innerHTML, /hr-appr-pass/);
    assert.doesNotMatch(view.innerHTML, /LRF9/);
    assert.equal(host.crumb, "Approver|Password required");
    assert.match(nav.child.className, /locked/);

    pass.value = "000000";
    doc.listeners.click({
      target: { closest: (sel) => (sel.indexOf("data-hr-appr-unlock") !== -1 ? {} : null) },
      preventDefault() {},
    });
    assert.equal(err.textContent, "That password does not match. Try again.");
    assert.match(view.innerHTML, /hr-appr-pass/);
    assert.equal(pass.value, "000000");

    pass.value = "032589";
    doc.listeners.keydown({
      key: "Enter",
      target: { id: "hr-appr-pass" },
      preventDefault() {},
    });
    assert.equal(appr.isApproverUnlocked(), true);
    assert.match(view.innerHTML, /LRF9/);
    assert.match(view.innerHTML, /data-hr-appr-approve="leave"/);
    assert.doesNotMatch(view.innerHTML, /hr-appr-pass/);
    assert.doesNotMatch(nav.child.className, /locked/);

    appr.resetApproverLock();
    assert.equal(appr.isApproverUnlocked(), false);
  });
});

describe("approver tab wiring", () => {
  it("is loaded by the shim and the HR build is 2026-09-26c", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-approver\.js/);
    assert.match(html, /const BUILD = "2026-09-26c"/);
    const view = appr.approverHtml(
      {},
      {
        settings: settings(),
        ui: { apprFilter: "all" },
        employees: { e1: { name: "Santos, Ana" } },
        leaves: {
          ev: {
            id: "ev",
            status: "For approval",
            no: "LRF9",
            empId: "e1",
            evaluatedBy: "Catherine A. Largo",
            signedLink: "https://drive/lrf9.pdf",
            from: "2026-09-01",
            to: "2026-09-02",
          },
        },
        advances: {},
        docreg: {},
      }
    );
    assert.match(view, /Approver|For approval/);
    assert.match(view, /LRF9/);
    assert.match(view, /Catherine A\. Largo/);
    assert.match(view, /data-hr-appr-approve="leave"/);
    assert.match(view, /Evaluated — for approval|evaluator signs first/);
  });

  it("shows For approval as the selected leave status when the record is waiting", () => {
    const opts = ["Filed", "For signature", "Approved", "Disapproved"].map((text) => ({
      value: text,
      text,
      textContent: text,
      selected: text === "Filed",
      hasAttribute() {
        return false;
      },
      parentNode: null,
    }));
    const sel = {
      options: opts,
      appendChild(el) {
        opts.push(el);
        el.parentNode = sel;
      },
      insertBefore(el, before) {
        opts.splice(opts.indexOf(before), 0, el);
        el.parentNode = sel;
      },
    };
    opts.forEach((o) => {
      o.parentNode = sel;
    });
    const host = {
      document: {
        readyState: "complete",
        addEventListener() {},
        getElementById(id) {
          return id === "l-status" || id === "c-status" ? sel : null;
        },
        createElement() {
          return { value: "", textContent: "", selected: false, parentNode: null, hasAttribute() { return false; } };
        },
      },
      S: { settings: settings(), leaves: {}, advances: {}, docreg: {}, employees: {}, ui: {} },
      openModal() {},
    };
    appr.patchGlobals(host);
    host.openModal();
    const waiting = sel.options.find((o) => o.value === "For approval");
    const approved = sel.options.find((o) => o.text === "Approved");
    assert.ok(waiting);
    assert.equal(waiting.selected, true);
    assert.ok(sel.options.indexOf(waiting) < sel.options.indexOf(approved));
  });
});

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

function loadLeaveCaSigs() {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const ctx = {
    S: { settings: {}, employees: {}, ui: {} },
    TODAY: "2026-09-23",
    toasts: [],
    toast(msg, kind) {
      ctx.toasts.push({ msg: msg, kind: kind });
    },
    dailyGet() {
      return null;
    },
    esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    },
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
    },
    flipName(n) {
      const p = String(n || "").split(",");
      return p.length > 1 ? p[1].trim() + " " + p[0].trim() : String(n || "");
    },
  };
  ctx.nameLastFirst = function (n) {
    const s = String(n || "").trim();
    if (s.indexOf(",") >= 0) {
      const p = s.split(",");
      return { last: p[0].trim(), first: p.slice(1).join(",").trim() };
    }
    const parts = s.split(/\s+/);
    return { last: parts[parts.length - 1] || "", first: parts.slice(0, -1).join(" ") };
  };
  const names = [
    "hrSigSrc",
    "foldSigName",
    "hrSigSlotDefs",
    "matchHrSigFilename",
    "leaveCaEvaluators",
    "findHrSig",
    "leaveCaSig",
    "leaveCaMissingSigs",
    "leaveCaPrintBlocked",
    "pfSign",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

describe("Leave and Cash Advance e-signatures", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const approverSrc = fs.readFileSync(path.join(__dirname, "../public/hr-approver.js"), "utf8");

  it("keeps the approver password gate and stamps Jeffrey only on Approve", () => {
    assert.match(approverSrc, /var APPROVER_PASSWORD = "032589"/);
    assert.match(approverSrc, /function approveRecord/);
    assert.match(approverSrc, /pdfIncludesSignature = true/);
    assert.match(approverSrc, /signatureStamp = sig/);
    assert.match(html, /const BUILD = "2026-09-26c"/);
    assert.match(html, /function leaveCaPrintBlocked/);
    assert.match(html, /leaveCaSig\("dept"\)/);
    assert.match(html, /leaveCaSig\("evaluated"\)/);
    const ca = html.slice(html.indexOf("function printCA"), html.indexOf("function printCA") + 3200);
    const leave = html.slice(html.indexOf("function printLeave"), html.indexOf("function printLeave") + 3200);
    assert.match(ca, /leaveCaPrintBlocked/);
    assert.match(ca, /leaveCaEvaluators\(\)\[0\]/);
    assert.match(leave, /leaveCaPrintBlocked/);
    assert.match(leave, /leaveCaSig\("dept"\)/);
    assert.match(html, /handleSignedPick[\s\S]{0,400}leaveCaPrintBlocked/);
    assert.match(html, /function markPrinted[\s\S]{0,400}leaveCaPrintBlocked/);
  });

  it("blocks print until Domingo and Catherine images are on file, then stamps those two columns", () => {
    const ctx = loadLeaveCaSigs();
    ctx.S.settings = {
      hrHead: "Domingo C. Monte Jr.",
      hrTitle: "HR Officer",
      payrollBy: "Catherine A. Largo",
      payrollTitle: "Safety Officer",
      financeHead: "",
      financeTitle: "Finance Officer",
      signatory: "Jeffrey James M. Corro",
      hrSigs: {
        prepared: { data: "data:image/png;base64,CASSIE", name: "Prepared by", title: "cassie.jpg", slot: "prepared" },
      },
    };
    const blocked = ctx.leaveCaPrintBlocked();
    assert.match(blocked, /Cannot print or send this for approval/);
    assert.match(blocked, /Department Head — Domingo C\. Monte Jr\./);
    assert.match(blocked, /domingo, monte, hr-head, or approved/);
    assert.match(blocked, /Evaluated by — Catherine A\. Largo/);
    assert.match(blocked, /catherine, largo, evaluated, or payroll/);
    assert.match(blocked, /Settings → HR e-signatures/);
    assert.equal(ctx.leaveCaSig("dept"), "");
    assert.equal(ctx.leaveCaSig("evaluated"), "");

    ctx.S.settings.hrSigs.approved = {
      data: "data:image/png;base64,DOMINGO",
      name: "Approved by",
      title: "domingo.jpg",
      slot: "approved",
    };
    assert.match(ctx.leaveCaPrintBlocked(), /Evaluated by — Catherine A\. Largo/);
    assert.doesNotMatch(ctx.leaveCaPrintBlocked(), /Department Head/);
    assert.equal(ctx.leaveCaSig("dept"), "data:image/png;base64,DOMINGO");
    assert.notEqual(ctx.leaveCaSig("dept"), "data:image/png;base64,CASSIE");

    ctx.S.settings.hrSigs.e9 = {
      data: "data:image/png;base64,CATHERINE",
      name: "Largo, Catherine A.",
      title: "catherine-largo.jpg",
      slot: "",
    };
    assert.equal(ctx.leaveCaSig("evaluated"), "data:image/png;base64,CATHERINE");
    assert.equal(ctx.leaveCaPrintBlocked(), "");

    const caHtml = ctx.pfSign([
      { who: "Department Head", name: "Domingo C. Monte Jr.", role: "HR Officer", src: ctx.leaveCaSig("dept") },
      Object.assign({}, ctx.leaveCaEvaluators()[0], { src: ctx.leaveCaSig("evaluated") }),
      { who: "Finance", name: "", role: "Finance Officer", missing: "Finance officer name — Settings" },
      { who: "Approved by", name: "Jeffrey James M. Corro", role: "CEO / President" },
    ]);
    assert.match(caHtml, /Department Head/);
    assert.match(caHtml, /data:image\/png;base64,DOMINGO/);
    assert.match(caHtml, /data:image\/png;base64,CATHERINE/);
    assert.match(caHtml, /Finance officer name — Settings/);
    assert.doesNotMatch(caHtml, /name not set — Settings/);
    const approvedAt = caHtml.indexOf("Approved by");
    const approvedInk = caHtml.indexOf('class="ink"', caHtml.indexOf('class="ink"', caHtml.indexOf('class="ink"', caHtml.indexOf('class="ink"') + 1) + 1) + 1);
    assert.ok(approvedInk > approvedAt || approvedAt > 0);
    assert.match(caHtml.slice(caHtml.lastIndexOf('class="ink"')), /&nbsp;/);
    assert.doesNotMatch(caHtml.slice(caHtml.lastIndexOf('class="ink"')), /base64/);

    ctx.S.settings.financeHead = "Set In Settings";
    const named = ctx.pfSign([
      { who: "Finance", name: ctx.S.settings.financeHead, role: "Finance Officer", missing: "Finance officer name — Settings" },
    ]);
    assert.match(named, /Set In Settings/);
    assert.doesNotMatch(named, /Finance officer name — Settings/);
    assert.doesNotMatch(named, /name not set/);
  });

  it("files domingo and catherine JPEGs on their slots and still files Corro.jpg on HR head when that is the name", () => {
    const ctx = loadLeaveCaSigs();
    ctx.S.settings = {
      hrStaff: "Maria Trina Cassandra A. Moran",
      hrHead: "Domingo C. Monte Jr.",
      payrollBy: "Catherine A. Largo",
      signatory: "Jeffrey James M. Corro",
      president: "Jeffrey James M. Corro",
    };
    ctx.S.employees = {};
    assert.equal(ctx.matchHrSigFilename("domingo.jpg").slot, "approved");
    assert.equal(ctx.matchHrSigFilename("monte.jpg").slot, "approved");
    assert.equal(ctx.matchHrSigFilename("catherine.jpg").slot, "evaluated");
    assert.equal(ctx.matchHrSigFilename("largo.jpg").slot, "evaluated");
    assert.equal(ctx.matchHrSigFilename("evaluated-by.jpg").slot, "evaluated");
    assert.equal(ctx.matchHrSigFilename("jeffrey.jpg").slot, "signatory");
    assert.equal(ctx.matchHrSigFilename("signatory.jpg").slot, "signatory");
    assert.equal(ctx.matchHrSigFilename("Corro.jpg").slot, "signatory");
    const slots = ctx.hrSigSlotDefs();
    const signatory = slots.find((s) => s.k === "signatory");
    assert.ok(signatory);
    assert.equal(signatory.aliases.indexOf("corro"), -1);

    ctx.S.settings.hrHead = "Jeffrey James Corro";
    assert.equal(ctx.matchHrSigFilename("Corro.jpg").slot, "approved");
    assert.equal(ctx.matchHrSigFilename("cassie.jpg").slot, "cassie");
    assert.equal(ctx.matchHrSigFilename("prepared.jpg").slot, "prepared");
  });

  it("keeps Domingo and Catherine when Approve stamps the last column", () => {
    const ctx = loadLeaveCaSigs();
    const caCols = [
      { who: "Department Head", name: "Domingo C. Monte Jr.", role: "HR Officer", src: "data:image/png;base64,DOMINGO" },
      { who: "Evaluated by", name: "Catherine A. Largo", role: "Safety Officer", src: "data:image/png;base64,CATHERINE" },
      { who: "Finance", name: "", role: "Finance Officer" },
      { who: "Approved by", name: "Jeffrey James M. Corro", role: "CEO / President" },
    ];
    const caIdx = appr.stampColumnIndex(caCols, appr.caStampTest);
    assert.equal(caIdx, 3);
    const caStamped = appr.stampSignHtml(ctx.pfSign(caCols), caIdx, SIG, "2026-09-23");
    assert.ok(caStamped.indexOf("base64,DOMINGO") < caStamped.indexOf("base64,CATHERINE"));
    assert.ok(caStamped.indexOf("base64,CATHERINE") < caStamped.indexOf("base64,QQQ"));
    assert.match(caStamped, /Date: 2026-09-23/);

    const leaveCols = [
      { who: "Immediate Supervisor", name: "Site Lead", role: "Signature" },
      { who: "Evaluated by", name: "Catherine A. Largo", role: "Safety Officer", src: "data:image/png;base64,CATHERINE" },
      { who: "HR Department", name: "Domingo C. Monte Jr.", role: "Signature", src: "data:image/png;base64,DOMINGO" },
      { who: "Final Approval (Management)", name: "Jeffrey James M. Corro", role: "Signature" },
    ];
    const leaveIdx = appr.stampColumnIndex(leaveCols, appr.leaveStampTest);
    assert.equal(leaveIdx, 3);
    const leaveStamped = appr.stampSignHtml(ctx.pfSign(leaveCols), leaveIdx, SIG, "2026-09-23");
    assert.match(leaveStamped, /Immediate Supervisor/);
    assert.ok(leaveStamped.indexOf("base64,CATHERINE") < leaveStamped.indexOf("base64,DOMINGO"));
    assert.ok(leaveStamped.indexOf("base64,DOMINGO") < leaveStamped.indexOf("base64,QQQ"));
    const supervisorInk = leaveStamped.slice(leaveStamped.indexOf('class="ink"'), leaveStamped.indexOf("base64,CATHERINE"));
    assert.match(supervisorInk, /&nbsp;/);
  });
});

describe("Approve stamps the uploaded signed file", () => {
  function sigSettings() {
    const st = settings();
    st.hrSigs.signatory = {
      data: PNG,
      name: "Jeffrey James M. Corro",
      title: "jeffrey.jpg",
      slot: "signatory",
    };
    return st;
  }

  async function blankPdfUrl() {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const bytes = await pdf.save();
    return "data:application/pdf;base64," + Buffer.from(bytes).toString("base64");
  }

  function hostFor(coll, rec) {
    const S = {
      settings: sigSettings(),
      employees: {},
      leaves: {},
      advances: {},
      docreg: {},
      ui: {},
    };
    S[coll][rec.id] = rec;
    const prints = [];
    const opened = [];
    const toasts = [];
    const host = {
      S,
      TODAY: "2026-09-24",
      prints,
      opened,
      toasts,
      document: {
        createElement() {
          const a = { click() { opened.push(a.href); } };
          return a;
        },
      },
      toast(msg, kind) {
        toasts.push({ msg, kind });
      },
      render() {},
      printLeave(l) {
        prints.push({ kind: "leave", id: l && l.id, no: l && l.no });
      },
      printCA(a) {
        prints.push({ kind: "ca", id: a && a.id, no: a && a.no });
      },
      async put(c, id, obj) {
        S[c][id] = obj;
      },
    };
    appr.patchGlobals(host);
    return host;
  }

  it("places Final Approval / Approved by on the rightmost column and leaves the employee line alone", () => {
    const leave = appr.stampBox("leave", 595, 842);
    const ca = appr.stampBox("ca", 612, 792);
    const contract = appr.stampBox("contract", 595, 842);
    assert.ok(leave.x > 595 * 0.7, "leave stamp is in the rightmost approval column");
    assert.ok(leave.y > 842 * 0.12 && leave.y < 842 * 0.22);
    assert.ok(ca.x > 612 * 0.7, "cash advance stamp is in the Approved by column");
    assert.ok(contract.x > 595 * 0.45 && contract.x < 595 * 0.72);
    assert.ok(leave.x + leave.width < 595);
    assert.ok(leave.x > 595 * 0.5, "employee signature on the left is not the stamp target");
  });

  it("Approve with an upload saves the stamped copy and keeps the original", async () => {
    const original = await blankPdfUrl();
    const rec = {
      id: "l1",
      status: "For approval",
      no: "LRF9",
      empId: "e1",
      evaluatedBy: "Catherine A. Largo",
      signedLink: original,
      signedTitle: "LRF9 scan.pdf",
    };
    const host = hostFor("leaves", rec);
    await appr.approveItem(host, "leave", "l1");
    const saved = host.S.leaves.l1;
    assert.equal(saved.status, "Approved");
    assert.equal(saved.pdfIncludesSignature, true);
    assert.equal(saved.officialPrint, "stamped-upload");
    assert.equal(saved.originalSignedLink, original);
    assert.equal(saved.approvedPdfLink, saved.signedLink);
    assert.notEqual(saved.signedLink, original);
    assert.match(saved.signedLink, /^data:application\/pdf;base64,/);
    const stamped = Buffer.from(saved.signedLink.split(",")[1], "base64");
    assert.match(stamped.subarray(0, 5).toString("utf8"), /%PDF/);
    assert.match(stamped.toString("latin1"), /\/Image/);
    assert.notEqual(stamped.toString("base64"), original.split(",")[1]);
    assert.equal(host.opened[0], saved.signedLink);
    assert.equal(host.prints.length, 0);
    assert.doesNotMatch(JSON.stringify(saved), /employeeSig/);

    const later = appr.applyEvaluatorGate(
      "leaves",
      { id: "l1", status: "Approved", empId: "e1", no: "LRF9" },
      saved,
      host.S
    );
    assert.equal(later.originalSignedLink, original);
    assert.equal(later.approvedPdfLink, saved.approvedPdfLink);
    assert.equal(later.officialPrint, "stamped-upload");
  });

  it("Approve without an upload still stamps the portal form", async () => {
    const rec = {
      id: "c1",
      status: "For approval",
      no: "CAF2",
      empId: "e1",
      evaluatedBy: "Catherine A. Largo",
      amount: 500,
      purpose: "Travel",
    };
    const host = hostFor("advances", rec);
    await appr.approveItem(host, "ca", "c1");
    const saved = host.S.advances.c1;
    assert.equal(saved.status, "Approved");
    assert.equal(saved.pdfIncludesSignature, true);
    assert.equal(saved.signatureStamp, PNG);
    assert.equal(saved.approvedPdfLink, undefined);
    assert.equal(saved.originalSignedLink, undefined);
    assert.equal(saved.officialPrint, undefined);
    assert.equal(saved.signedLink, undefined);
    assert.deepEqual(host.prints, [{ kind: "ca", id: "c1", no: "CAF2" }]);
    assert.equal(host.opened.length, 0);
    assert.match(host.toasts.map((t) => t.msg).join(" "), /Save as PDF/);
  });

  it("stamps a contract upload from link and does not invent an employee signature", async () => {
    const original = await blankPdfUrl();
    const rec = {
      id: "d1",
      seriesKey: "CON",
      kind: "contract",
      status: "Issued",
      approverStatus: "For approval",
      title: "Employment Contract",
      no: "CON2026-04",
      link: original,
    };
    const host = hostFor("docreg", rec);
    assert.equal(appr.employeeUploadUrl(rec, "contract"), original);
    await appr.approveItem(host, "contract", "d1");
    const saved = host.S.docreg.d1;
    assert.equal(saved.status, "Issued");
    assert.equal(saved.approverStatus, "Approved");
    assert.equal(saved.originalSignedLink, original);
    assert.equal(saved.originalLink, original);
    assert.equal(saved.link, saved.approvedPdfLink);
    assert.notEqual(saved.link, original);
    assert.match(saved.approvedPdfLink, /^data:application\/pdf;base64,/);
    assert.equal(host.opened[0], saved.approvedPdfLink);
    assert.equal(host.prints.length, 0);
  });

  it("turns an uploaded JPEG or PNG scan into the official PDF and refuses a file that is not an image", async () => {
    const rec = {
      id: "l2",
      status: "For approval",
      no: "LRF10",
      empId: "e1",
      signedLink: PNG,
      signedTitle: "scan.png",
    };
    const host = hostFor("leaves", rec);
    await appr.approveItem(host, "leave", "l2");
    const saved = host.S.leaves.l2;
    assert.equal(saved.originalSignedLink, PNG);
    assert.match(saved.approvedPdfLink, /^data:application\/pdf;base64,/);
    assert.equal(saved.status, "Approved");

    const bad = {
      id: "l3",
      status: "For approval",
      no: "LRF11",
      signedLink: "data:text/plain;base64,SGk=",
    };
    const host2 = hostFor("leaves", bad);
    await appr.approveItem(host2, "leave", "l3");
    assert.equal(host2.S.leaves.l3.status, "For approval");
    assert.equal(host2.S.leaves.l3.approvedPdfLink, undefined);
    assert.match(host2.toasts.map((t) => t.msg).join(" "), /not a PDF or JPEG\/PNG/);
  });
});
