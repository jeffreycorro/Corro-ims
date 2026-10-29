"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const os = require("os");
const {
  vrfPrintWatermark,
  vrfShowsApprovedSig,
  vrfApprovedSig,
  vrfPreviewUnapproved,
  vrfPreviewWatermark,
  vrfPreviewApprovedSig,
  VRF_PREVIEW_MARK,
} = require("./lib/rules");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const MARK = "NOT APPROVED \u2013 PREVIEW ONLY";

function sliceFn(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start + startMark.length);
  assert.ok(start > 0 && end > start, startMark);
  return source.slice(start, end);
}

describe("VRF print preview — stamp and signature rules", () => {
  it("names the unapproved preview stamp", () => {
    assert.equal(VRF_PREVIEW_MARK, MARK);
  });

  it("uses the real print stamp on an approved VRF and the preview stamp before approval", () => {
    const approved = { vrf: "5812", status: "Open", approvedBy: "Jeffrey" };
    assert.equal(vrfPreviewUnapproved(approved), false);
    assert.equal(vrfPreviewWatermark(approved), "APPROVED");
    assert.equal(vrfPreviewWatermark(approved), vrfPrintWatermark(approved));
    assert.equal(vrfPreviewApprovedSig(approved, null, "data:image/png;base64,JEFFREY"), "data:image/png;base64,JEFFREY");
    assert.equal(vrfShowsApprovedSig(approved), true);

    const closed = { vrf: "5795", status: "Closed" };
    assert.equal(vrfPreviewWatermark(closed), "APPROVED");
    assert.equal(vrfPreviewApprovedSig(closed, null, "data:image/png;base64,JEFFREY"), vrfApprovedSig(closed, null, "data:image/png;base64,JEFFREY"));

    const legacy = { vrf: "1001", status: "Legacy" };
    assert.equal(vrfPreviewWatermark(legacy), "APPROVED");

    const notBought = { vrf: "5833", status: "Not bought", approvedAt: "2026-10-02", src: "ledger" };
    assert.equal(vrfPreviewUnapproved(notBought), false);
    assert.equal(vrfPreviewWatermark(notBought), "NOT BOUGHT");
    assert.equal(vrfPreviewApprovedSig(notBought, null, "data:image/png;base64,JEFFREY"), "");
  });

  it("stamps an unapproved VRF NOT APPROVED – PREVIEW ONLY and leaves Approved By blank", () => {
    const requested = {
      vrf: "6267",
      status: "Requested",
      held: true,
      approvedBy: "Jeffrey",
      approvedSig: "data:image/png;base64,JEFFREY",
    };
    assert.equal(vrfPreviewUnapproved(requested), true);
    assert.equal(vrfPreviewWatermark(requested), MARK);
    assert.equal(vrfPreviewApprovedSig(requested, null, "data:image/png;base64,JEFFREY"), "");
    assert.notEqual(vrfPreviewWatermark(requested), vrfPrintWatermark(requested));

    const draft = { vrf: "— not yet posted —", status: "Draft", unnumbered: true, approvedSig: "data:image/png;base64,JEFFREY" };
    assert.equal(vrfPreviewWatermark(draft), MARK);
    assert.equal(vrfPreviewApprovedSig(draft, null, "data:image/png;base64,JEFFREY"), "");

    const blank = { vrf: "— not yet posted —" };
    assert.equal(vrfPreviewWatermark(blank), MARK);
    assert.equal(vrfPreviewApprovedSig(null, null, "data:image/png;base64,JEFFREY"), "");

    const rejected = { vrf: "5902", status: "Rejected", approvedBy: "Jeffrey" };
    assert.equal(vrfPreviewWatermark(rejected), MARK);
    assert.equal(vrfPreviewApprovedSig(rejected, null, "data:image/png;base64,JEFFREY"), "");

    const heldCancel = { vrf: "5901", status: "Cancelled", held: true, src: "reserve-hold" };
    assert.equal(vrfPreviewUnapproved(heldCancel), true);
    assert.equal(vrfPreviewWatermark(heldCancel), MARK);

    const approvedCancel = { vrf: "5830", status: "Cancelled", approvedAt: "2026-10-02", src: "ledger" };
    assert.equal(vrfPreviewUnapproved(approvedCancel), false);
    assert.equal(vrfPreviewWatermark(approvedCancel), "CANCELLED");
  });
});

describe("VRF print preview — page wiring", () => {
  it("keeps the artifact script syntactically valid", () => {
    const match = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(match && match[1], "inline artifact script");
    const tmp = path.join(os.tmpdir(), "motorpool-preview-check.js");
    fs.writeFileSync(tmp, match[1]);
    const checked = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr || "node --check failed");
  });

  it("is build 2026-10-29 d", () => {
    assert.match(html, /var BUILD = "2026-10-29 d"/);
  });

  it("offers Preview on the VRF form, the approval view, and the VRF log", () => {
    const form = sliceFn(html, 'var pv=el("button","btn","Preview");', "function askSendDespiteMatch");
    assert.match(form, /previewVrfPrint\(\{vrf:"— not yet posted —"/);
    assert.doesNotMatch(form, /printVrf\(\{vrf:"— not yet posted —"/);

    const approval = sliceFn(html, "function approveView()", "function remindView()");
    assert.match(approval, /el\("button","btn sm","Preview"\)/);
    assert.match(approval, /previewVrfPrint\(held\)/);
    assert.doesNotMatch(approval, /listPhotos|markVrfPrinted|vrfPrintGate/);

    const reserve = sliceFn(html, "function openReserve(no,asApprover)", "function approveView()");
    assert.match(reserve, /var pvHold=el\("button","btn","Preview"\)/);
    assert.match(reserve, /previewVrfPrint\(held\)/);
    assert.match(reserve, /printVrfNo\(held\)/);

    const log = sliceFn(html, "function vrfLogView()", "function partsView()");
    assert.match(log, /el\("button","btn sm","Preview"\)/);
    assert.match(log, /previewVrfPrint\(v\)/);
    assert.match(log, /printVrfNo\(v\)/);

    const open = sliceFn(html, "function openVrf(entry,tab)", "function blankLine()");
    assert.match(open, /el\("button","btn","Preview"\)/);
    assert.match(open, /previewVrfPrint\(entry\)/);
    assert.match(open, /printVrf\(entry\)/);
  });

  it("puts Preview next to Close on the not-approved print block, and that click does not print", () => {
    const block = sliceFn(html, "function showPrintBlocked(message, entry)", "function paintFuelAuditNote");
    assert.match(block, /Not approved — cannot print/);
    assert.match(block, /el\("button","btn","Preview"\)/);
    assert.match(block, /el\("button","btn pri","Close"\)/);
    assert.ok(block.indexOf('el("button","btn","Preview")') < block.indexOf('el("button","btn pri","Close")'));
    assert.match(block, /previewVrfPrint\(entry\)/);
    assert.doesNotMatch(block, /printVrf\(|markVrfPrinted|window\.print|printedAt/);

    const gate = sliceFn(html, "async function printVrf(entry,photos)", "function previewVrfPrint");
    assert.match(gate, /vrfPrintGate\(entry\)/);
    assert.match(gate, /showPrintBlocked\(printGate\.message\|\|"Not approved — cannot print", entry\)/);
    assert.ok(gate.indexOf("vrfPrintGate(entry)") < gate.indexOf("markVrfPrinted(entry)"));
    assert.match(gate, /openVrfPrintSheet\(entry, photos, false\)/);
  });

  it("opens the same print layout without recording a print", () => {
    const preview = sliceFn(html, "function previewVrfPrint(entry,photos)", "async function openVrfPrintSheet");
    assert.match(preview, /openVrfPrintSheet\(entry, photos, true\)/);
    assert.doesNotMatch(preview, /markVrfPrinted|vrfPrintGate|window\.print|printedAt|rememberSealedVrf|materializeApprovedVrf|showPrintBlocked/);

    const sheet = sliceFn(html, "async function openVrfPrintSheet(entry,photos,preview)", "function lightbox(src)");
    assert.doesNotMatch(sheet, /markVrfPrinted|vrfPrintGate|rememberSealedVrf|materializeApprovedVrf|printedAt\s*=/);
    assert.match(sheet, /if\(preview\)\{/);
    assert.match(sheet, /printVrf\(source, shot\)/);
    assert.match(sheet, /window\.print\(\)/);
    assert.match(sheet, /buildVrfDoc\(entry, list, preview\?\{preview:true\}:null\)/);
    assert.match(sheet, /m\.id=sheetId/);
    assert.match(sheet, /pvPreview/);
    assert.match(sheet, /if\(!preview\) bar\.appendChild\(saveb\)/);
    assert.doesNotMatch(sheet, /bar\.appendChild\(saveb\);\s*\n\s*printb/);

    const doc = sliceFn(html, "function buildVrfDoc(entry,photos,opts)", "var VRFDOC_CSS");
    assert.match(doc, /shownFuelPrevNote\(entry\)/);
    assert.match(doc, /appendFuelUse90\(d, shownFuelRollingNote\(entry\), "print"\)/);
    assert.match(doc, /vrfAuditList\(entry\)/);
    assert.match(doc, /vrfPreparedSig\(entry\)/);
    assert.match(doc, /var approvedSrc=unapproved\?"":vrfApprovedSig\(entry\)/);
    assert.match(doc, /d\.appendChild\(vrfMarkNode\(mark\)\)/);
    assert.match(doc, /ph\.appendChild\(vrfMarkNode\(mark\)\)/);
    assert.match(doc, /var mark=preview\?vrfPreviewWatermark\(entry\):vrfPrintWatermark\(entry\)/);
    assert.match(doc, /unapproved-preview/);
  });

  it("prints the unapproved watermark on every page, including a browser Ctrl+P", () => {
    assert.match(html, /NOT APPROVED \\u2013 PREVIEW ONLY/);
    assert.match(html, /\.vrfdoc \.vmark\.preview\{z-index:4\}/);
    assert.match(html, /\.vrfdoc \.vph \.vmark\.preview\{display:flex/);
    assert.match(html, /print-color-adjust:exact/);
    assert.match(html, /body:has\(#pvPreview\):not\(\.printing\)/);
    assert.match(html, /#pvPreview \.vrfdoc>\.vmark\.preview\{position:fixed;inset:10mm/);
    assert.match(html, /#pvPreview \.vph \.vmark\.preview\{display:flex!important;position:absolute/);
    assert.match(html, /function placeUnapprovedPreviewMarks/);
    assert.match(html, /body\.printing>#printArea\{display:block!important\}/);
    assert.match(html, /@media print\{\.vrfdoc>\.vmark\{position:fixed;inset:12mm\}/);
  });
});
