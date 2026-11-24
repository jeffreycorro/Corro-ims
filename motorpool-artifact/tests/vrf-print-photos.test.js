"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const os = require("os");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const JPEG = "data:image/jpeg;base64," + Buffer.from("receipt-photo").toString("base64");
const PNG = "data:image/png;base64," + Buffer.from("gauge").toString("base64");
const PHOTO_URL = "/.netlify/functions/photo?id=vrf-6148__1&fit=print";

function sliceFn(source, startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start + startMark.length);
  assert.ok(start > 0 && end > start, startMark);
  return source.slice(start, end);
}

function loadPrintFns() {
  const src = [
    sliceFn(html, "function isDocAttachment(x)", "async function listPhotos(vrf)"),
    sliceFn(html, "function isVideoMeta(x)", "function thumbSrcFor(rec)"),
    sliceFn(html, "function inlinePrintPhotoSrc(src)", "function placePrintRemote(x, page, url)"),
    sliceFn(html, "function placePrintRemote(x, page, url)", "function pullPrintPhoto(x, page, onDone)"),
  ].join("\n");
  const sandbox = {
    Promise,
    setTimeout,
    clearTimeout,
    PHOTO_GET_MS: 3000,
    document: {
      createElement(tag) {
        return {
          tagName: tag,
          alt: "",
          src: "",
          className: "",
          textContent: "",
          style: {},
          setAttribute() {},
        };
      },
    },
    FileReader: function FileReader() {
      this.result = "";
      this.onload = null;
      this.onerror = null;
    },
  };
  sandbox.FileReader.prototype.readAsDataURL = function readAsDataURL(blob) {
    const type = String((blob && blob.type) || "application/octet-stream");
    const body = String((blob && blob.base64) || "");
    this.result = "data:" + type + ";base64," + body;
    if (this.onload) this.onload();
  };
  vm.runInNewContext(src, sandbox);
  return sandbox;
}

describe("printed VRF photos are embedded images", () => {
  const api = loadPrintFns();

  it("is build 2026-11-24 b", () => {
    assert.match(html, /var BUILD = "2026-11-24 b"/);
  });

  it("treats a photo function URL as not printable and a data URL as the picture", () => {
    assert.equal(api.inlinePrintPhotoSrc(PHOTO_URL), "");
    assert.equal(api.inlinePrintPhotoSrc("https://drive.google.com/file/d/abc"), "");
    assert.equal(api.inlinePrintPhotoSrc("data:application/pdf;base64,QQ=="), "");
    assert.equal(api.inlinePrintPhotoSrc(JPEG), JPEG);
    assert.equal(api.inlinePrintPhotoSrc("  " + PNG), PNG);
    assert.equal(api.printAttachmentKind({ kind: "photo", id: "vrf-6148__1", data: PHOTO_URL }), "wait");
    assert.equal(api.printAttachmentKind({ kind: "photo", id: "vrf-6148__1", data: JPEG, caption: "OR 4512" }), "image");
    assert.equal(api.printAttachmentKind({ kind: "link", url: "https://drive.google.com/file/d/abc", caption: "Drive" }), "link");
    assert.equal(api.printAttachmentKind({ kind: "doc", mime: "application/pdf", caption: "scan.pdf" }), "pdf");
    assert.equal(api.printAttachmentKind({ kind: "pdf", data: "data:application/pdf;base64,QQ==" }), "pdf");
    assert.equal(api.printAttachmentKind({ kind: "video", mime: "video/mp4" }), "video");
    assert.equal(api.printAttachmentKind({ kind: "photo", _failed: true }), "failed");
    assert.equal(api.printAttachmentKind(null), "skip");
  });

  it("embeds request photos, liquidation receipts, and PSRF or LRF copies the same way", () => {
    const request = { id: "vrf-7001__1", kind: "photo", caption: "request photo", data: JPEG, source: "PSRF" };
    const receipt = {
      id: "vrf-liq-7001__1",
      kind: "photo",
      role: "liquidation",
      vrf: "liq-7001",
      caption: "LRF-0010 official receipt",
      data: JPEG,
    };
    const gauge = { id: "vrf-7001__2", kind: "photo", caption: "gauge", data: PNG };
    [request, receipt, gauge].forEach(function (photo) {
      assert.equal(api.printAttachmentKind(photo), "image");
      const src = api.inlinePrintPhotoSrc(photo.data);
      const markup = '<img alt="' + photo.caption + '" src="' + src + '">';
      assert.match(markup, /^<img alt="[^"]+" src="data:image\/(?:jpeg|png);base64,/);
      assert.doesNotMatch(markup, /netlify\/functions\/photo|https?:/);
    });
    const doc = sliceFn(html, "function buildVrfDoc(entry,photos,opts)", "var VRFDOC_CSS");
    assert.match(doc, /printAttachmentKind\(x\)/);
    assert.match(doc, /slot==="image"/);
    assert.match(doc, /im\.src=inlinePrintPhotoSrc\(x\.data\)/);
    assert.match(doc, /inlinePrintPhotoSrc\(gp\.data\)/);
    assert.doesNotMatch(doc, /im\.src=x\.data/);
    assert.match(doc, /appendAttachmentPages\(grouped\.request, "Request attachments", "Request links"\)/);
    assert.match(doc, /appendAttachmentPages\(grouped\.liquidation, "Liquidation attachments", "Liquidation links"\)/);
    assert.match(doc, /PDF attached/);
    assert.doesNotMatch(doc, /source==="PSRF"|source==="LRF"/);
  });

  it("fetches the fitted file and stores a data URL, not the photo address", async () => {
    const photo = { id: "vrf-6148__1", kind: "photo", caption: "OR 4512", data: PHOTO_URL };
    const fig = {};
    const page = {};
    let asked = "";
    api.printFigure = function () { return fig; };
    api.setPrintFigureBody = function (target, node) { target.body = node; };
    api.paintGaugeStill = function (target, item) { target.gauge = item.data; };
    api.markPrintFigureFailed = function (target) { target.failed = true; };
    api.fetchAttachment = function (url) {
      asked = url;
      return Promise.resolve({ type: "image/jpeg", base64: Buffer.from("receipt-photo").toString("base64") });
    };
    const ok = await api.placePrintRemote(photo, page, PHOTO_URL);
    assert.equal(ok, true);
    assert.equal(asked, PHOTO_URL);
    assert.equal(photo.data, JPEG);
    assert.equal(photo._failed, false);
    assert.equal(fig.body.tagName, "img");
    assert.equal(fig.body.src, JPEG);
    assert.equal(fig.body.alt, "OR 4512");
    assert.equal(page.gauge, JPEG);
    assert.equal(api.printAttachmentKind(photo), "image");
    assert.doesNotMatch(fig.body.src, /netlify\/functions\/photo/);

    const pdf = { id: "vrf-6148__3", kind: "doc", caption: "scan.pdf", data: PHOTO_URL };
    const pdfFig = {};
    api.printFigure = function () { return pdfFig; };
    api.fetchAttachment = function () {
      return Promise.resolve({ type: "application/pdf", base64: "QQ==" });
    };
    const pdfOk = await api.placePrintRemote(pdf, {}, "/.netlify/functions/photo?id=vrf-6148__3&fit=full");
    assert.equal(pdfOk, false);
    assert.equal(pdf.data, "");
    assert.equal(pdf._failed, true);
    assert.equal(pdfFig.failed, true);
    assert.notEqual(pdfFig.body && pdfFig.body.tagName, "img");
    assert.equal(api.inlinePrintPhotoSrc("data:application/pdf;base64,QQ=="), "");
    assert.equal(api.printAttachmentKind({ kind: "doc", mime: "application/pdf", caption: "scan.pdf" }), "pdf");
  });

  it("does not put the photo function URL back on the picture", () => {
    const remote = sliceFn(html, "function placePrintRemote(x, page, url)", "function pullPrintPhoto(x, page, onDone)");
    assert.doesNotMatch(remote, /x\.data\s*=\s*url/);
    assert.doesNotMatch(remote, /im\.src\s*=\s*url/);
    assert.match(remote, /fetchAttachment\(url\)/);
    assert.match(remote, /blobToPrintDataUrl\(blob\)/);
    assert.match(remote, /im\.src=embedded/);
    assert.match(remote, /PHOTO_GET_MS/);
    const pull = sliceFn(html, "function pullPrintPhoto(x, page, onDone)", "async function printVrf(entry,photos,edition)");
    assert.match(pull, /photoFileUrl\(x\.id,"print"\)/);
    assert.match(pull, /if\(x\.data\) x\.data=""/);
    assert.match(pull, /inlinePrintPhotoSrc\(doc\.data\)/);
    assert.match(pull, /im\.src=embeddedDoc/);
    assert.match(pull, /loadPhotoDoc\(x\.id,\{direct:true\}\)/);
    assert.match(pull, /whenImgReady/);
    assert.doesNotMatch(pull, /loadPhotoDocs\(files, "print"\)/);
    assert.doesNotMatch(pull, /\|\|x\.data\)/);
    const bar = sliceFn(html, "function syncBar()", "if(!preview) bar.appendChild(saveb)");
    assert.match(bar, /inlinePrintPhotoSrc\(x\.data\)/);
    const file = sliceFn(html, "function vrfDocFile(entry,photos,opts)", "async function inlinePrintSig(src)");
    assert.match(file, /printWhenImagesReady/);
    assert.match(file, /window\.onload/);
    const waiter = sliceFn(html, "function printWhenImagesReady()", "function vrfDocFile(entry,photos,opts)");
    assert.match(waiter, /getElementsByTagName\("img"\)/);
    assert.match(waiter, /imgs\[i\]\.complete/);
    assert.match(waiter, /addEventListener\("load", one\)/);
    assert.match(waiter, /addEventListener\("error", one\)/);
    assert.match(waiter, /window\.print\(\)/);
  });

  it("waits until every picture has loaded before the printable file prints", () => {
    const waiter = sliceFn(html, "function printWhenImagesReady()", "function vrfDocFile(entry,photos,opts)");
    function run(imgs) {
      const timers = [];
      let printed = 0;
      const sandbox = {
        document: { getElementsByTagName() { return imgs; } },
        window: { print() { printed += 1; } },
        setTimeout(cb) { timers.push(cb); return 1; },
      };
      vm.runInNewContext(waiter + "\nprintWhenImagesReady();", sandbox);
      return { timers, get printed() { return printed; } };
    }

    const pending = { complete: false, listeners: {}, addEventListener(ev, cb) { this.listeners[ev] = cb; } };
    const ready = { complete: true, addEventListener() { throw new Error("already loaded"); } };
    const waiting = run([ready, pending]);
    assert.equal(waiting.printed, 0);
    assert.equal(waiting.timers.length, 0);
    pending.listeners.load();
    assert.equal(waiting.printed, 0);
    assert.equal(waiting.timers.length, 1);
    waiting.timers[0]();
    assert.equal(waiting.printed, 1);

    const failed = { complete: false, listeners: {}, addEventListener(ev, cb) { this.listeners[ev] = cb; } };
    const broken = run([failed]);
    failed.listeners.error();
    assert.equal(broken.timers.length, 1);
    broken.timers[0]();
    assert.equal(broken.printed, 1);

    const none = run([]);
    assert.equal(none.timers.length, 1);
    none.timers[0]();
    assert.equal(none.printed, 1);
  });

  it("keeps the print gates and the approver check where they were", () => {
    assert.match(html, /return api\.mayPrint\(view\)/);
    assert.match(html, /var VARIANCE_PRINT_MAX=0\.50/);
    assert.match(html, /function namedApprover\(raw\)/);
    assert.match(html, /MotorpoolApprovers\.resolveApprover/);
    const gate = sliceFn(html, "async function printVrf(entry,photos,edition)", "function previewVrfPrint");
    assert.match(gate, /vrfPrintGate\(entry\)/);
    assert.match(gate, /model\.block && model\.block\.print/);
    const script = html.match(/<script>\n([\s\S]*)<\/script>\s*$/);
    assert.ok(script && script[1]);
    const tmp = path.join(os.tmpdir(), "motorpool-print-photos-check.js");
    fs.writeFileSync(tmp, script[1]);
    const checked = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr || "node --check failed");
  });
});
