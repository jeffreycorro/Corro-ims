"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

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

function loadFold() {
  const names = [
    "isEphemeralUrl",
    "isHeavyDataUrl",
    "durableDriveUrl",
    "otSiteKey",
    "otBook",
    "noteOtDeleted",
    "otTombstoned",
    "queueOtUpload",
    "otFileList",
    "otFormUrl",
    "otHasHeavyInline",
    "otForStore",
    "shedOtRequest",
    "shedOtMap",
    "mergeOtRequest",
    "otReqNeedsRepair",
    "foldOtMap",
    "otFormHtml",
    "otRequestCovers",
  ];
  const ctx = {
    S: { settings: {}, otreqs: {} },
    esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
    },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

const HEAVY = "data:image/jpeg;base64," + "A".repeat(3000);
const FORM = "https://drive.google.com/file/d/DANAO1/view";

describe("2026-10-07a OT request recovery", () => {
  it("is build 2026-10-07a and lists every attached file", () => {
    assert.match(html, /const BUILD = "2026-10-07a"/);
    assert.match(html, /id="ot-file" type="file" multiple/);
    assert.match(html, /function foldOtMap\(/);
    assert.match(html, /otHasHeavyInline/);
  });

  it("keeps a browser-only request when the shared list is empty", () => {
    const ctx = loadFold();
    const local = {
      danao: {
        id: "danao",
        from: "2026-10-05",
        to: "2026-10-05",
        site: "Danao SPLPA",
        wholeSite: true,
        status: "Approved",
        reason: "- Hauling, - Backfilling",
        formUrl: HEAVY,
        formTitle: "DANAO OT REQUEST 10.05.2026.jpg",
        files: [{ url: HEAVY, title: "DANAO OT REQUEST 10.05.2026.jpg" }],
      },
    };
    const folded = ctx.foldOtMap(local, {});
    assert.equal(folded.map.danao.formUrl, HEAVY);
    assert.equal(folded.map.danao.status, "Approved");
    assert.equal(JSON.stringify(folded.repair.map((r) => r.id)), JSON.stringify(["danao"]));
    const shed = ctx.shedOtRequest(folded.map.danao);
    assert.equal(shed.formUrl, HEAVY);
    assert.equal(ctx.otFileList(shed).length, 1);
  });

  it("drops a shared request that a non-empty snapshot no longer has", () => {
    const ctx = loadFold();
    const kept = {
      id: "a",
      from: "2026-10-05",
      status: "Approved",
      formUrl: FORM,
      _otShared: true,
    };
    const gone = {
      id: "b",
      from: "2026-10-04",
      status: "Filed",
      formUrl: FORM,
      _otShared: true,
    };
    const folded = ctx.foldOtMap({ a: kept, b: gone }, { a: { id: "a", from: "2026-10-05", status: "Approved", formUrl: FORM } });
    assert.ok(folded.map.a);
    assert.equal(folded.map.b, undefined);
    assert.equal(
      folded.repair.some((r) => r.id === "b"),
      false
    );
  });

  it("does not upload a request this browser deleted", () => {
    const ctx = loadFold();
    ctx.noteOtDeleted("danao");
    const folded = ctx.foldOtMap(
      { danao: { id: "danao", from: "2026-10-05", status: "Approved", formUrl: HEAVY } },
      {}
    );
    assert.equal(folded.map.danao, undefined);
    assert.equal(folded.repair.length, 0);
    assert.ok(ctx.S.settings.otDeleted.indexOf("danao") >= 0);
  });

  it("keeps the first file when a second file is attached", () => {
    const ctx = loadFold();
    const local = {
      id: "danao",
      from: "2026-10-05",
      status: "Approved",
      formUrl: FORM,
      formTitle: "DANAO OT REQUEST 10.05.2026.jpg",
      files: [{ url: FORM, title: "DANAO OT REQUEST 10.05.2026.jpg" }],
    };
    const second = "https://drive.google.com/file/d/PAGE2/view";
    const merged = ctx.mergeOtRequest(local, {
      id: "danao",
      from: "2026-10-05",
      status: "Approved",
      formUrl: second,
      formTitle: "page 2.jpg",
      files: [{ url: second, title: "page 2.jpg" }],
    });
    assert.equal(
      JSON.stringify(ctx.otFileList(merged).map((f) => f.title)),
      JSON.stringify(["DANAO OT REQUEST 10.05.2026.jpg", "page 2.jpg"])
    );
    const htmlOut = ctx.otFormHtml(merged);
    assert.match(htmlOut, /DANAO OT REQUEST 10\.05\.2026\.jpg/);
    assert.match(htmlOut, /page 2\.jpg/);
    assert.match(htmlOut, /href=/);
  });

  it("links an inline file and says when only the title survived", () => {
    const ctx = loadFold();
    const linked = ctx.otFormHtml({
      formUrl: HEAVY,
      formTitle: "DANAO OT REQUEST 10.05.2026.jpg",
    });
    assert.match(linked, /download=/);
    assert.match(linked, /DANAO OT REQUEST 10\.05\.2026\.jpg/);
    const missing = ctx.otFormHtml({ formTitle: "DANAO OT REQUEST 10.05.2026.jpg", formUrl: "" });
    assert.match(missing, /file not stored/);
    assert.equal(
      ctx.otRequestCovers(
        {
          status: "Approved",
          from: "2026-10-05",
          to: "2026-10-05",
          wholeSite: true,
          site: "Danao SPLPA",
          formUrl: HEAVY,
        },
        "e1",
        "2026-10-05",
        "Danao SPLPA"
      ),
      true
    );
  });

  it("sheds an inline file only after the shared save has accepted it", () => {
    const ctx = loadFold();
    const row = {
      id: "danao",
      formUrl: HEAVY,
      formTitle: "DANAO OT REQUEST 10.05.2026.jpg",
      files: [{ url: HEAVY, title: "DANAO OT REQUEST 10.05.2026.jpg" }],
      _otShared: true,
    };
    assert.equal(ctx.otHasHeavyInline(row), true);
    assert.equal(ctx.shedOtRequest(row).formUrl, "");
    const held = Object.assign({}, row);
    if (held._otShared && ctx.otHasHeavyInline(held)) held._otShared = false;
    assert.equal(ctx.shedOtRequest(held).formUrl, HEAVY);
    const stored = ctx.otForStore(row);
    assert.equal(stored._otShared, undefined);
    assert.equal(stored.formUrl, HEAVY);
  });
});
