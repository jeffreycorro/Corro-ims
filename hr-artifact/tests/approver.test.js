"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const appr = require("../public/hr-approver");

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

describe("approver tab wiring", () => {
  it("is loaded by the shim and the HR build is 2026-09-22b", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-approver\.js/);
    assert.match(html, /const BUILD = "2026-09-22b"/);
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
