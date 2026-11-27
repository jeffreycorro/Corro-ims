"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const approveSrc = fs.readFileSync(path.join(__dirname, "../netlify/lib/approve-from-hold.js"), "utf8");
const auditSrc = fs.readFileSync(path.join(__dirname, "../public/fuel-audit.js"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  let start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  if (src.slice(start - 6, start) === "async ") start -= 6;
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

function element(tag) {
  return {
    tag: tag,
    className: "",
    textContent: "",
    innerHTML: "",
    style: {},
    childNodes: [],
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
  };
}

function loadPage() {
  const names = [
    "esc",
    "el",
    "reserveOwnsVrfNo",
    "reserveBy",
    "reserveForVrf",
    "cleanApproverNote",
    "issuedApproverNote",
    "vrfApproverNote",
    "approverNoteHtml",
    "appendApproverNote",
    "approveBoxDecisionNote",
  ];
  const ctx = {
    S: { reserves: [], issued: { numbers: {} } },
    document: { createElement: element },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function reserve(no, vrf, note) {
  return { no: String(no), vrfNo: String(vrf), vrfs: [String(vrf)], status: "Approved", decisionNote: note };
}

function sealed(vrf, reserveNo, note) {
  return {
    no: String(vrf),
    sealed: true,
    snapshot: {
      reserve: { no: String(reserveNo), vrfNo: String(vrf), decisionNote: note },
      rows: [{ vrf: String(vrf) }],
    },
  };
}

describe("VRF approver note", () => {
  it("is build 2026-11-27 a", () => {
    assert.match(html, /var BUILD = "2026-11-27 a"/);
  });

  it("shows the linked reserve decisionNote and escapes HTML", () => {
    const page = loadPage();
    page.S.reserves = [reserve(368, 6382, 'buy the belt <b>now</b> & "today"')];
    page.S.issued.numbers["6382"] = sealed(6382, 368, "sealed copy should not win");
    const entry = { vrf: "6382", reserve: "368" };
    assert.equal(page.vrfApproverNote(entry), 'buy the belt <b>now</b> & "today"');
    const parent = element("div");
    const box = page.appendApproverNote(parent, entry);
    assert.equal(parent.childNodes.length, 1);
    assert.equal(box.className, "approver-note");
    assert.match(box.innerHTML, /Approver's note/);
    assert.match(box.innerHTML, /&lt;b&gt;now&lt;\/b&gt;/);
    assert.match(box.innerHTML, /&amp;/);
    assert.match(box.innerHTML, /&quot;today&quot;/);
    assert.doesNotMatch(box.innerHTML, /<b>now<\/b>/);
  });

  it("falls back to the sealed snapshot when the reserve note is blank", () => {
    const page = loadPage();
    page.S.reserves = [reserve(364, 6378, "   ")];
    page.S.issued.numbers["6378@364"] = sealed(6378, 364, "paid at the shop");
    page.S.issued.numbers["6378@999"] = sealed(6378, 999, "other reserve");
    const entry = { vrf: "6378", reserve: "364" };
    assert.equal(page.vrfApproverNote(entry), "paid at the shop");
    const parent = element("div");
    const box = page.appendApproverNote(parent, entry);
    assert.match(box.innerHTML, /Approver's note/);
    assert.match(box.innerHTML, /paid at the shop/);

    page.S.reserves = [];
    page.S.issued.numbers = { "6380@366": sealed(6380, 366, "gauge was full") };
    assert.equal(page.vrfApproverNote({ vrf: "6380", reserve: "366" }), "gauge was full");
  });

  it("shows nothing when the reserve and the snapshot are both blank", () => {
    const page = loadPage();
    page.S.reserves = [reserve(366, 6380, "")];
    page.S.issued.numbers["6380"] = sealed(6380, 366, "  ");
    page.S.issued.numbers["9999"] = sealed(9999, 1, "not this VRF");
    const entry = { vrf: "6380", reserve: "366" };
    assert.equal(page.vrfApproverNote(entry), "");
    assert.equal(page.approverNoteHtml(""), "");
    assert.equal(page.approverNoteHtml("   "), "");
    assert.equal(page.approverNoteHtml(null), "");
    const parent = element("div");
    assert.equal(page.appendApproverNote(parent, entry), null);
    assert.equal(parent.childNodes.length, 0);
    assert.equal(JSON.stringify(parent).includes("Approver"), false);
  });

  it("does not borrow a note sealed for a different reserve", () => {
    const page = loadPage();
    page.S.reserves = [reserve(368, 6382, "")];
    page.S.issued.numbers["6382@999"] = sealed(6382, 999, "wrong reserve");
    assert.equal(page.vrfApproverNote({ vrf: "6382", reserve: "368" }), "");
  });

  it("keeps an existing note when the approve box is blank", () => {
    const page = loadPage();
    assert.equal(page.approveBoxDecisionNote("buy the belt", ""), "buy the belt");
    assert.equal(page.approveBoxDecisionNote("buy the belt", "   "), "buy the belt");
    assert.equal(page.approveBoxDecisionNote("buy the belt", null), "buy the belt");
    assert.equal(page.approveBoxDecisionNote("", ""), "");
    assert.equal(page.approveBoxDecisionNote(undefined, "  "), undefined);
  });

  it("replaces the note when the approve box has text", () => {
    const page = loadPage();
    assert.equal(page.approveBoxDecisionNote("buy the belt", "paid cash"), "paid cash");
    assert.equal(page.approveBoxDecisionNote("buy the belt", "  paid cash  "), "paid cash");
    assert.equal(page.approveBoxDecisionNote("", "ok"), "ok");
  });

  it("wires the note onto the VRF detail and the Approved By line of the print", () => {
    const open = extractFunction(html, "openVrf");
    const doc = extractFunction(html, "buildVrfDoc");
    assert.match(open, /appendApproverNote\(b, entry\)/);
    assert.match(doc, /if\(x\.cap==="Approved By"\) appendApproverNote\(c, entry\)/);
    const approve = extractFunction(html, "openReserve");
    const click = approve.slice(
      approve.indexOf('okb.addEventListener("click"'),
      approve.indexOf('nob.addEventListener("click"')
    );
    assert.match(click, /r\.decisionNote=approveBoxDecisionNote\(r\.decisionNote, an\.value\)/);
    assert.doesNotMatch(click, /r\.decisionNote=an\.value\.trim\(\)/);
    const reject = approve.slice(approve.indexOf('nob.addEventListener("click"'));
    assert.match(reject, /r\.decisionNote=an\.value\.trim\(\)/);
  });

  it("leaves print gates and the approve-vrf API note handling alone", () => {
    assert.match(approveSrc, /hold\.decisionNote = note \|\| hold\.decisionNote \|\| ""/);
    assert.match(auditSrc, /function mayPrint\(entry\)/);
    assert.doesNotMatch(auditSrc, /approverNote|decisionNote/);
    assert.doesNotMatch(approveSrc, /approveBoxDecisionNote/);
  });
});
