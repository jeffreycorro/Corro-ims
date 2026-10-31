"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const numbers = require("../public/hr-memo-numbers");
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const db = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");
const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20261029000001_hr_memo_numbers.sql"),
  "utf8"
);

function memo(id, no, extra) {
  return Object.assign({ id: id, no: no, status: "Issued", subject: id }, extra || {});
}

function reg(id, no, seq, refId, extra) {
  return Object.assign(
    {
      id: id,
      no: no,
      seriesKey: "CM",
      year: 2026,
      seq: seq,
      module: "memo",
      refId: refId,
      status: "Draft",
      title: "",
    },
    extra || {}
  );
}

/* Shape of the live register on 2026-10-29: filed C.M. 2026 - 01 through 15,
   draft memos 22 and 29, and register rows for sequences that were drawn
   and then left behind (16, 23, 25, 28) plus a duplicate 22. */
function liveStore() {
  const memos = {};
  const docreg = {};
  for (let seq = 1; seq <= 15; seq += 1) {
    const no = numbers.formatCm(2026, seq, null);
    const id = "m" + seq;
    memos[id] = memo(id, no, { fromDrive: true, status: "Issued" });
    docreg["d" + seq] = reg("d" + seq, no, seq, id, { status: "Issued" });
  }
  memos.m22 = memo("m22", "C.M. 2026 - 22", { status: "Draft", fromDrive: false, subject: "October 31" });
  memos.m29 = memo("m29", "C.M. 2026 - 29", { status: "Draft", fromDrive: false, subject: "November 2" });
  docreg.d16 = reg("d16", "C.M. 2026 - 16", 16, "m22");
  docreg.d22a = reg("d22a", "C.M. 2026 - 22", 22, "m22");
  docreg.d22b = reg("d22b", "C.M. 2026 - 22", 22, "m22");
  docreg.d23 = reg("d23", "C.M. 2026 - 23", 23, "m29");
  docreg.d25 = reg("d25", "C.M. 2026 - 25", 25, "m29");
  docreg.d28 = reg("d28", "C.M. 2026 - 28", 28, "m29");
  docreg.d29 = reg("d29", "C.M. 2026 - 29", 29, "m29");
  return {
    memos: memos,
    docreg: docreg,
    filed: {},
    series: { CM: { key: "CM", prefix: "C.M.", pad: 2, pattern: "{PREFIX} {YYYY} - {NNNN}" } },
  };
}

describe("company memorandum numbers", () => {
  it("parses the filed format and the same number typed with different spacing", () => {
    assert.deepEqual(numbers.parseCm("C.M. 2026 - 15"), { year: 2026, seq: 15, key: "CM|2026|15" });
    assert.equal(numbers.sameNo("C.M. 2026 - 15", "C.M. 2026-15"), true);
    assert.equal(numbers.sameNo("C.M. 2026 - 01", "CM 2026 - 1"), true);
    assert.equal(numbers.sameNo("C.M. 2026 - 15", "C.M. 2026 - 16"), false);
    assert.equal(numbers.canonical("c.m. 2026-7", null), "C.M. 2026 - 07");
    assert.equal(numbers.parseCm("Implementation of Revised Work Schedule"), null);
  });

  it("offers the lowest number no saved memo holds (16), ignoring leftover register rows and filed forms", () => {
    const S = liveStore();
    assert.equal(numbers.highSeq(S, 2026), 29);
    assert.equal(numbers.nextNo(S, 2026).no, "C.M. 2026 - 16");
    assert.equal(numbers.nextNo(S, 2027).no, "C.M. 2027 - 01");
    S.filed.f = { id: "f", no: "C.M. 2026 - 16" };
    S.series.CM.lastByYear = { 2026: 40 };
    assert.equal(numbers.nextNo(S, 2026).no, "C.M. 2026 - 16");
    S.memos.m16 = memo("m16", "C.M. 2026 - 16", { status: "Draft" });
    assert.equal(numbers.nextNo(S, 2026).no, "C.M. 2026 - 17");
    S.memos.m17 = memo("m17", "C.M. 2026 - 17");
    for (let n = 18; n <= 21; n += 1) S.memos["m" + n] = memo("m" + n, numbers.formatCm(2026, n, null));
    assert.equal(numbers.nextNo(S, 2026).no, "C.M. 2026 - 23");
    assert.equal(numbers.nextNo(S, 2026, "m22").no, "C.M. 2026 - 22");
  });

  it("an in-flight save holds its number for the next draw", () => {
    const S = liveStore();
    numbers.hold("C.M. 2026 - 16", "m-a");
    try {
      assert.equal(numbers.nextNo(S, 2026).no, "C.M. 2026 - 17");
      assert.equal(numbers.nextNo(S, 2026, "m-a").no, "C.M. 2026 - 16");
    } finally {
      numbers.release("C.M. 2026 - 16", "m-a");
    }
  });

  it("refuses only a number held by a different memo, naming the next free number", () => {
    const S = liveStore();
    const taken = numbers.conflictForWrite("memos", "m-new", { no: "C.M. 2026-15" }, S);
    assert.equal(taken.code, "duplicate_memo_number");
    assert.match(taken.message, /C\.M\. 2026 - 15/);
    assert.match(taken.message, /memo register/);
    assert.match(taken.message, /next free number is C\.M\. 2026 - 16/);

    assert.equal(numbers.conflictForWrite("memos", "m-new", { no: "C.M. 2026 - 16" }, S), null);
    assert.equal(numbers.conflictForWrite("memos", "m-new", { no: "C.M. 2026 - 23" }, S), null);
    S.filed.scan = { id: "scan", no: "C.M. 2026 - 31" };
    assert.equal(numbers.conflictForWrite("memos", "m-new", { no: "C.M. 2026 - 31" }, S), null);

    assert.equal(numbers.conflictForWrite("memos", "m22", { no: "C.M. 2026 - 22" }, S), null);
    assert.match(numbers.conflictForWrite("memos", "m22", { no: "C.M. 2026 - 29" }, S).message, /November 2/);

    assert.equal(numbers.conflictForWrite("docreg", "d22a", { no: "C.M. 2026 - 22", seriesKey: "CM", refId: "m22" }, S), null);
    const regOther = numbers.conflictForWrite("docreg", "dx", { no: "C.M. 2026 - 22", seriesKey: "CM", refId: "m-new" }, S);
    assert.equal(regOther.code, "duplicate_memo_number");
  });

  it("lists memos and register rows whose numbers look wrong", () => {
    const list = numbers.suspects(liveStore(), 2026);
    const memoIds = list.filter((x) => x.kind === "memo").map((x) => x.id).sort();
    assert.deepEqual(memoIds, ["m22", "m29"]);
    const regIds = list.filter((x) => x.kind === "docreg").map((x) => x.id).sort();
    assert.deepEqual(regIds, ["d16", "d23", "d25", "d28"]);
  });

  it("keeps the number an issued memo already has when the save omits it", () => {
    const w = {
      S: liveStore(),
      document: { readyState: "complete", addEventListener() {}, getElementById() { return null; }, body: { appendChild() {} }, head: { appendChild() {} }, documentElement: { appendChild() {} }, createElement() { return { id: "" }; } },
      MutationObserver: class { observe() {} },
      console,
      setTimeout,
    };
    w.window = w;
    const memoSrc = fs.readFileSync(path.join(__dirname, "../public/hr-memo.js"), "utf8");
    const numberSrc = fs.readFileSync(path.join(__dirname, "../public/hr-memo-numbers.js"), "utf8");
    vm.runInNewContext(numberSrc + "\n" + memoSrc, w);
    const calls = [];
    const orig = function (coll, id, obj) {
      calls.push({ coll, id, no: obj && obj.no });
      return true;
    };
    w.put = orig;
    w.hrMemo.patchGlobals();
    const saved = w.put("memos", "m15", { id: "m15", no: "", status: "Issued", subject: "typed" });
    assert.equal(saved.obj ? saved.obj.no : null, null);
    return Promise.resolve(saved).then(function (out) {
      assert.equal(out, true);
      assert.equal(calls[0].coll, "memos");
      assert.equal(calls[0].no, "C.M. 2026 - 15");
      assert.equal(calls.filter((c) => c.coll === "docreg").length, 0);
    });
  });

  it("saves the suggested number and refuses a duplicate before writing", async () => {
    const S = liveStore();
    const calls = [];
    const w = {
      S: S,
      document: {
        readyState: "complete",
        addEventListener() {},
        getElementById() { return null; },
        body: { appendChild() {} },
        head: { appendChild() {} },
        documentElement: { appendChild() {} },
        createElement() { return { id: "" }; },
      },
      MutationObserver: class { observe() {} },
      console,
      setTimeout,
      allocate() { throw new Error("series counter must not be drawn for CM"); },
      uid(prefix) { return prefix + "_new"; },
      toast(msg, kind) { w.lastToast = { msg: msg, kind: kind }; },
    };
    w.window = w;
    const memoSrc = fs.readFileSync(path.join(__dirname, "../public/hr-memo.js"), "utf8");
    const numberSrc = fs.readFileSync(path.join(__dirname, "../public/hr-memo-numbers.js"), "utf8");
    vm.runInNewContext(numberSrc + "\n" + memoSrc, w);
    w.put = function (coll, id, obj) {
      calls.push({ coll, id, no: obj.no, refId: obj.refId });
      if (!w.S[coll]) w.S[coll] = {};
      w.S[coll][id] = obj;
      return true;
    };
    w.hrMemo.patchGlobals();

    const dup = await w.put("memos", "m-new", { id: "m-new", no: "CM 2026-22", status: "Draft", subject: "Again" });
    assert.equal(dup, false);
    assert.equal(calls.length, 0);
    assert.match(w.lastToast.msg, /C\.M\. 2026 - 22/);
    assert.equal(w.lastToast.kind, "err");

    calls.length = 0;
    const ok = await w.put("memos", "m-new", { id: "m-new", no: "C.M. 2026 - 16", status: "Draft", subject: "All Souls" });
    assert.equal(ok, true);
    assert.equal(calls[0].coll, "memos");
    assert.equal(calls[0].no, "C.M. 2026 - 16");
    assert.equal(calls[1].coll, "docreg");
    assert.equal(calls[1].no, "C.M. 2026 - 16");
    assert.equal(calls[1].refId, "m-new");

    calls.length = 0;
    const edit = await w.put("memos", "m-new", { id: "m-new", no: "C.M. 2026 - 16", status: "Draft", subject: "All Souls (edited)", signedLink: "https://drive/x" });
    assert.equal(edit, true);
    assert.equal(calls[0].no, "C.M. 2026 - 16");
    assert.equal(calls.filter((c) => c.coll === "docreg" && c.no !== "C.M. 2026 - 16").length, 0);
    assert.equal(calls.filter((c) => c.coll === "docreg" && c.id !== "d_new").length, 0);

    calls.length = 0;
    w.S.memos.m29.status = "Draft";
    const old = await w.put("memos", "m29", { id: "m29", no: "C.M. 2026 - 29", status: "Draft", subject: "November 2 again" });
    assert.equal(old, true);
    assert.equal(calls.filter((c) => c.coll === "docreg").every((c) => c.id === "d29"), true);

    calls.length = 0;
    w.S.docreg = {};
    await w.put("memos", "m29", { id: "m29", no: "C.M. 2026 - 29", status: "Draft", subject: "no row" });
    assert.equal(calls.filter((c) => c.coll === "docreg").length, 0);

    const drawn = await w.allocate("CM", { refId: "m-brand" });
    assert.equal(drawn.no, "C.M. 2026 - 17");
    assert.equal(calls.filter((c) => c.coll === "docreg").length, 0);
    assert.equal((await w.allocate("CM", { refId: "m29" })).no, "C.M. 2026 - 29");
  });

  it("shows the next number on New memo and leaves a filed memo number locked", () => {
    assert.match(html, /const BUILD = "2026-10-29b"/);
    assert.match(html, /id="m-no"/);
    assert.match(html, /peekNo\("CM"\)/);
    assert.match(html, /data-suggest/);
    assert.match(html, /memoNoLocked/);
    assert.match(html, /m\.fromDrive \|\| m\.status==="Issued"/);
    assert.match(html, /savedOk===false/);
    assert.match(shim, /hr-memo-numbers\.js/);
    assert.match(db, /rejectDuplicateMemoNumber/);
    assert.match(db, /docs_memos_cm_no_uidx/);
    assert.match(migration, /docs_memos_cm_no_uidx/);
    assert.match(migration, /collection = 'memos'/);
    assert.doesNotMatch(migration, /delete from public\.docs/i);
  });
});
