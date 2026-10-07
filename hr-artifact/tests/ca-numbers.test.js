"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ca = require("../public/hr-ca-numbers");

function emptyStore() {
  return {
    employees: {
      e1: { id: "e1", empNo: "1241", name: "Largo, Catherine A." },
    },
    advances: {},
    docreg: {},
    filed: {},
    series: {
      CA: { key: "CA", prefix: "CAF", pad: 4, pattern: "{PREFIX}{YYYY}-{NNNN}", lastByYear: {}, retired: [] },
    },
    settings: { hrHead: "Domingo C. Monte Jr.", payrollBy: "Catherine A. Largo" },
  };
}

function draft(id, extra) {
  return Object.assign(
    {
      id: id,
      no: "",
      empId: "e1",
      receivedBy: "Largo, Catherine A.",
      amount: 1500,
      purpose: "Cash Advance",
      date: "2026-10-06",
      status: "Requested",
      deductPerPeriod: 500,
      planEvery: "Semi-monthly",
    },
    extra || {}
  );
}

describe("cash advance control numbers", () => {
  it("assigns the next CAF number when two cash advances are created at once", async () => {
    const S = emptyStore();
    const io = ca.memoryIo(S);
    const [a, b] = await Promise.all([
      ca.assignCashAdvance(io, draft("a")),
      ca.assignCashAdvance(io, draft("b")),
    ]);
    assert.equal(a.advance.no, "CAF2026-0001");
    assert.equal(b.advance.no, "CAF2026-0002");
    assert.notEqual(a.advance.no, b.advance.no);
    assert.equal(S.advances.a.no, "CAF2026-0001");
    assert.equal(S.advances.b.no, "CAF2026-0002");
    assert.equal(S.series.CA.lastByYear[2026], 2);
  });

  it("keeps the original number when an existing cash advance is edited", async () => {
    const S = emptyStore();
    S.advances.a = draft("a", { no: "CAF2026-0042", amount: 800, createdAt: "2026-01-02T00:00:00.000Z" });
    S.series.CA.lastByYear[2026] = 42;
    const io = ca.memoryIo(S);
    const out = await ca.assignCashAdvance(
      io,
      draft("a", { no: "CAF2026-0099", amount: 900, particulars: "cement" })
    );
    assert.equal(out.kind, "edit");
    assert.equal(out.advance.no, "CAF2026-0042");
    assert.equal(out.advance.amount, 900);
    assert.equal(out.advance.particulars, "cement");
    assert.equal(S.advances.a.no, "CAF2026-0042");
    assert.equal(S.series.CA.lastByYear[2026], 42);
    const next = await ca.assignCashAdvance(io, draft("b"));
    assert.equal(next.advance.no, "CAF2026-0043");
  });

  it("does not reuse a number after cancel or delete", async () => {
    const S = emptyStore();
    const io = ca.memoryIo(S);
    const first = await ca.assignCashAdvance(io, draft("a"));
    const second = await ca.assignCashAdvance(io, draft("b"));
    assert.equal(first.advance.no, "CAF2026-0001");
    assert.equal(second.advance.no, "CAF2026-0002");

    const cancelled = await ca.assignCashAdvance(io, Object.assign({}, S.advances.a, { status: "Cancelled" }));
    assert.equal(cancelled.advance.no, "CAF2026-0001");
    assert.equal(S.advances.a.status, "Cancelled");

    await ca.retireNumber(io, S.advances.b);
    delete S.advances.b;

    const third = await ca.assignCashAdvance(io, draft("c"));
    assert.equal(third.advance.no, "CAF2026-0003");
    assert.notEqual(third.advance.no, "CAF2026-0001");
    assert.notEqual(third.advance.no, "CAF2026-0002");
    assert.equal(ca.takenByOther(S, "CAF2026-0001"), true);
    assert.equal(ca.takenByOther(S, "CAF2026-0002"), true);
  });

  it("uses the same control number on the form, the file name, and the PDF", async () => {
    const S = emptyStore();
    const io = ca.memoryIo(S);
    const saved = await ca.assignCashAdvance(io, draft("a", { amount: 20000 }));
    const rec = saved.advance;
    const emp = S.employees.e1;
    const face = ca.surfaces(rec, emp);
    assert.equal(face.form, rec.no);
    assert.equal(face.print, rec.no);
    assert.equal(face.export, rec.no);
    assert.equal(face.pdf, "CAF2026-0001.pdf");
    assert.equal(face.fileName, face.pdf);
    assert.equal(face.drive, "1241-CAF2026-0001 SIGNED.pdf");
    assert.equal(face.approved, "CAF2026-0001 APPROVED.pdf");
    assert.equal(ca.deductControlNos(S, "e1").join(","), rec.no);

    const body =
      '<div>CASH ADVANCE REQUEST FORM</div>' +
      '<table class="pf-foot"><tr><td>Cash Advance Request Form No.</td><td class="no">' +
      rec.no +
      "</td></tr></table>";
    assert.equal(ca.sheetControlNo(body), rec.no);
    assert.equal(ca.slugNo(ca.sheetControlNo(body)) + ".pdf", face.pdf);
  });

  it("does not claim a number before the cash advance is saved", () => {
    const S = emptyStore();
    const peeked = ca.planSave(S, draft("a", { no: "CAF2026-0099", amount: 1500 }), { year: 2026 });
    assert.equal(peeked.kind, "mint");
    assert.equal(peeked.advance.no, "CAF2026-0001");
    assert.equal(S.advances.a, undefined);
    assert.equal(Object.keys(S.docreg).length, 0);
    const blank = ca.planSave(S, draft("z", { amount: 0, no: "CAF2026-0008" }), { year: 2026 });
    assert.equal(blank.kind, "draft");
    assert.equal(blank.advance.no, "");
    assert.equal(ca.highSeq(S, 2026), 0);
  });

  it("keeps an existing duplicate on the oldest record and flags the rest", () => {
    const S = emptyStore();
    S.advances.old = draft("old", {
      no: "CAF2026-0007",
      createdAt: "2026-02-01T00:00:00.000Z",
      date: "2026-02-01",
    });
    S.advances.newer = draft("newer", {
      no: "CAF 2026 - 7",
      createdAt: "2026-08-01T00:00:00.000Z",
      date: "2026-08-01",
    });
    const beforeOld = S.advances.old.no;
    const beforeNew = S.advances.newer.no;
    const review = ca.reviewDuplicates(S);
    assert.equal(review.length, 1);
    assert.equal(review[0].keeper.id, "old");
    assert.equal(review[0].keeper.no, beforeOld);
    assert.equal(review[0].review.length, 1);
    assert.equal(review[0].review[0].id, "newer");
    assert.equal(review[0].review[0].no, beforeNew);
    assert.equal(S.advances.old.no, beforeOld);
    assert.equal(S.advances.newer.no, beforeNew);
  });

  it("gives the later of two simultaneous claims the next number and leaves the other record alone", async () => {
    const S = emptyStore();
    const io = ca.memoryIo(S);
    const origWrite = io.writeAdvance;
    let planted = false;
    io.writeAdvance = function (rec) {
      return origWrite(rec).then(function (saved) {
        if (!planted && rec && rec.id === "b" && rec.no) {
          planted = true;
          S.advances.older = draft("older", {
            no: rec.no,
            amount: 400,
            createdAt: "2020-01-01T00:00:00.000Z",
            date: "2020-01-01",
          });
        }
        return saved;
      });
    };
    const out = await ca.assignCashAdvance(io, draft("b"));
    assert.equal(S.advances.older.no, "CAF2026-0001");
    assert.equal(out.advance.no, "CAF2026-0002");
    assert.equal(S.advances.b.no, "CAF2026-0002");
  });

  it("does not let a stale series write move the counter backwards or jump it forward", () => {
    const stored = { key: "CA", prefix: "CAF", pad: 4, pattern: "{PREFIX}{YYYY}-{NNNN}", lastByYear: { 2026: 42 }, retired: ["CAF|2026|9"] };
    const staleLow = ca.guardSeriesWrite(stored, { prefix: "CAF", lastByYear: { 2026: 1 }, retired: [] });
    assert.equal(staleLow.lastByYear[2026], 42);
    assert.deepEqual(staleLow.retired, ["CAF|2026|9"]);
    const staleHigh = ca.guardSeriesWrite(stored, { lastByYear: { 2026: 9999 }, retired: ["CAF|2026|100"] });
    assert.equal(staleHigh.lastByYear[2026], 42);
    assert.deepEqual(staleHigh.retired, ["CAF|2026|9"]);
    const trusted = ca.mergeSeriesCounter(stored, { lastByYear: { 2026: 43 }, retired: ["CAF|2026|10"] });
    assert.equal(trusted.lastByYear[2026], 43);
    assert.ok(trusted.retired.indexOf("CAF|2026|9") >= 0);
    assert.ok(trusted.retired.indexOf("CAF|2026|10") >= 0);
  });

  it("keeps a paper number and links payroll to that control number", async () => {
    const S = emptyStore();
    const io = ca.memoryIo(S);
    const paper = await ca.assignCashAdvance(
      io,
      draft("imp", { no: "CAF2026-0015", amount: 3000, notes: "Imported from Drive", deductPerPeriod: 500 })
    );
    assert.equal(paper.kind, "paper");
    assert.equal(paper.advance.no, "CAF2026-0015");
    const next = await ca.assignCashAdvance(io, draft("n"));
    assert.equal(next.advance.no, "CAF2026-0016");
    assert.deepEqual(ca.deductControlNos(S, "e1"), ["CAF2026-0015", "CAF2026-0016"]);
    S.advances.imp.status = "Cancelled";
    assert.deepEqual(ca.deductControlNos(S, "e1"), ["CAF2026-0016"]);
    const note = ca.noteWithControlNos("Cash advance: ₱2,500.00 still to be recovered after this deduction.", ["CAF2026-0016"]);
    assert.match(note, /CAF2026-0016/);
    assert.match(note, /Cash advance:/);
  });

  it("keeps the control number field read-only", () => {
    const input = { disabled: false, readOnly: false, title: "", setAttribute: function () {} };
    const label = { textContent: "Number", parentNode: { querySelector: function () { return input; } } };
    const doc = {
      querySelector: function (sel) {
        if (sel === ".modal") return doc._modal;
        return null;
      },
      _modal: {
        querySelector: function () {
          return { textContent: "New cash advance" };
        },
        querySelectorAll: function (sel) {
          if (sel === "label") return [label];
          return [];
        },
      },
    };
    const locked = ca.lockControlField(doc);
    assert.equal(locked, input);
    assert.equal(label.textContent, "Control number");
    assert.equal(input.disabled, true);
    assert.equal(input.readOnly, true);
  });

  it("saves two new advances through the portal put path without sharing a number", async () => {
    const S = emptyStore();
    const puts = [];
    const host = {
      S: S,
      SESSION: "s-test",
      TODAY: "2026-10-06",
      toast() {},
      async put(coll, id, obj) {
        puts.push({ coll, id, no: obj && obj.no });
        S[coll] = S[coll] || {};
        S[coll][id] = obj;
        return true;
      },
      async allocate() {
        return { id: "pre", no: "CAF2026-0099" };
      },
      peekNo() {
        return "CAF2026-0099";
      },
      async drop(coll, id) {
        delete S[coll][id];
      },
    };
    ca.patchGlobals(host);
    assert.equal(await host.peekNo("CA"), "");
    const reserved = await host.allocate("CA", { title: "Cash Advance" });
    assert.equal(reserved.no, "");
    const rec = draft("a");
    rec.no = reserved.no;
    const [first, second] = await Promise.all([
      host.put("advances", "a", rec),
      host.put("advances", "b", draft("b", { no: "CAF2026-0099" })),
    ]);
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(S.advances.a.no, "CAF2026-0001");
    assert.equal(S.advances.b.no, "CAF2026-0002");
    await host.put("advances", "a", Object.assign({}, S.advances.a, { amount: 10, no: "CAF2026-0008" }));
    assert.equal(S.advances.a.no, "CAF2026-0001");
    assert.equal(S.advances.a.amount, 10);
    await host.drop("advances", "b");
    const again = await host.put("advances", "c", draft("c"));
    assert.equal(again, true);
    assert.equal(S.advances.c.no, "CAF2026-0003");
    assert.equal(ca.takenByOther(S, "CAF2026-0002"), true);
  });

  it("is build 2026-10-06a and the portal loads the cash-advance numbering companion", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const db = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");
    const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
    const sw = fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8");
    assert.match(html, /const BUILD = "2026-10-07c"/);
    assert.match(shim, /hr-ca-numbers\.js/);
    assert.match(shim, /data-hr-ca-numbers/);
    assert.match(shim, /assignCa/);
    assert.doesNotMatch(html, /hr-ca-numbers\.js/);
    assert.match(db, /hr-ca-numbers/);
    assert.match(db, /assignCa/);
    assert.match(readme, /hr-ca-numbers\.js/);
    assert.doesNotMatch(sw, /hr-ca-numbers/);
    assert.match(html, /prefix:"CAF"/);
    assert.match(html, /pattern:"\{PREFIX\}\{YYYY\}-\{NNNN\}"/);
  });
});
