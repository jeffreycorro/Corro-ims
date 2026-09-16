"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(
  path.join(__dirname, "../public/index.html"),
  "utf8"
);
const roster = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../public/separated-roster.json"), "utf8")
);

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

function loadRosterFns() {
  const ctx = {
    S: { daily: {}, employees: {}, settings: {}, ui: { dailyDate: "2026-09-16" } },
    TODAY: "2026-09-16",
    KNOWN_SEP: null,
    FIRST_ADDED: null,
    LAST_SITE_IX: null,
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
    },
    clone(o) {
      return JSON.parse(JSON.stringify(o));
    },
    dailyGet(d) {
      return ctx.S.daily["d" + String(d).replace(/-/g, "")] || null;
    },
    atWork() {
      return Object.values(ctx.S.employees).filter(
        (e) => !ctx.empSeparatedAsOf(e, ctx.S.ui.dailyDate || ctx.TODAY)
      );
    },
    esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    },
  };
  const names = [
    "knownSepRec",
    "empStatusIsSeparated",
    "empSeparatedAsOf",
    "mergeIncomingDoc",
    "hrSigSrc",
    "lastSiteBefore",
    "firstAddedIndex",
    "dailySiteOf",
    "dailyPeople",
    "persistRosterOnDay",
    "memoChain",
  ];
  const body = names.map((n) => extractFunction(html, n)).join("\n");
  vm.runInNewContext(body, ctx);
  return ctx;
}

describe("staff concern sheet — live 16c HTML", () => {
  it("ships the separated apply list next to the artifact", () => {
    assert.equal(roster.count, 67);
    assert.equal(roster.employees.length, 67);
    assert.equal(roster.status, "Separated");
    assert.ok(roster.employees.some((e) => e.empNo === "1243"));
  });

  it("wires roster persist, snapshot merge, e-sig, and signed-memo UI", () => {
    assert.match(html, /function persistRosterOnDay/);
    assert.match(html, /function empSeparatedAsOf/);
    assert.match(html, /function mergeIncomingDoc/);
    assert.match(html, /function hrSigSrc/);
    assert.match(html, /function handleHrSigPick/);
    assert.match(html, /id="dm-hrsig"/);
    assert.match(html, /id="set-hrsig"/);
    assert.match(html, /job\.hrSig/);
    assert.match(html, /applySeparatedRoster/);
    assert.match(html, /separated-roster\.json/);
    assert.match(html, /pill ok[^>]*>signed/);
    assert.match(html, /prev\.signedLink && !m\.signedLink/);
    assert.match(html, /rec\.hrSigData\|\|rec\.hrSigLink\|\|hrSigSrc\(\)/);
    assert.match(html, /Object\.keys\(rec\.rows\|\|\{\}\)\.forEach\(id=>\{ if\(id\) seen\[id\]=true/);
    assert.match(html, /const BUILD = "2026-09-16c"/);
  });

  it("keeps a new hire and their site after save and on the next blank day", () => {
    const ctx = loadRosterFns();
    ctx.S.employees = {
      e1250: { id: "e1250", empNo: "1250", name: "Armenio", status: "Regular", project: "ADMINS" },
      e1400: { id: "e1400", empNo: "1400", name: "Nuevo, Ana", status: "Probationary", project: "ADMINS" },
    };
    ctx.atWork = () => [ctx.S.employees.e1250];
    const monday = {
      id: "d20260914",
      date: "2026-09-14",
      extra: ["e1400"],
      omit: [],
      rows: { e1400: { s: "Present", r: "", site: "CTU BARILI" } },
    };
    ctx.persistRosterOnDay(monday);
    ctx.S.daily.d20260914 = monday;
    ctx.FIRST_ADDED = null;
    ctx.LAST_SITE_IX = null;
    assert.ok(monday.extra.includes("e1400"));
    assert.equal(monday.rows.e1400.site, "CTU BARILI");

    const tue = { date: "2026-09-15", rows: {}, extra: [], omit: [] };
    const people = ctx.dailyPeople(tue);
    assert.ok(people.some((e) => e.id === "e1400"), "new hire rolls onto Tuesday");
    ctx.persistRosterOnDay(tue);
    assert.ok(tue.extra.includes("e1400"));
    assert.equal(tue.rows.e1400.site, "CTU BARILI");
  });

  it("does not let a stale daily snapshot drop extra, site, or HR e-sig", () => {
    const ctx = loadRosterFns();
    const incoming = {
      date: "2026-09-15",
      extra: [],
      rows: { e1250: { s: "Present", r: "" } },
      omit: [],
      log: [],
    };
    const local = {
      date: "2026-09-15",
      extra: ["e1400"],
      rows: {
        e1250: { s: "Present", r: "", site: "TAWASON" },
        e1400: { s: "Present", r: "", site: "CTU BARILI" },
      },
      omit: [],
      hrSigData: "data:image/png;base64,AAA",
      log: [{ at: "later" }],
    };
    const next = ctx.mergeIncomingDoc("daily", incoming, local);
    assert.ok(next.extra.includes("e1400"));
    assert.equal(next.rows.e1400.site, "CTU BARILI");
    assert.equal(next.rows.e1250.site, "TAWASON");
    assert.equal(next.hrSigData, "data:image/png;base64,AAA");
    assert.equal(next.log.length, 1);
  });

  it("keeps a just-attached signedLink when a stale memo snapshot arrives", () => {
    const ctx = loadRosterFns();
    const next = ctx.mergeIncomingDoc(
      "memos",
      { id: "m1", subject: "Hours", link: "", signedLink: "" },
      { id: "m1", subject: "Hours", signedLink: "https://drive.google.com/file/d/SIGNED", signedTitle: "signed.pdf", signedOn: "2026-09-15" }
    );
    assert.equal(next.signedLink, "https://drive.google.com/file/d/SIGNED");
    assert.equal(next.signedTitle, "signed.pdf");
  });

  it("drops resigned and apply-list people from the standing roster", () => {
    const ctx = loadRosterFns();
    ctx.KNOWN_SEP = { 1243: { separatedOn: "", separationReason: "" } };
    assert.equal(
      ctx.empSeparatedAsOf({ id: "a", empNo: "1243", status: "Regular" }, "2026-09-16"),
      true
    );
    assert.equal(
      ctx.empSeparatedAsOf({ id: "b", empNo: "9999", status: "Resigned", separatedOn: "2026-09-01" }, "2026-09-16"),
      true
    );
    assert.equal(
      ctx.empSeparatedAsOf({ id: "c", empNo: "1250", status: "Regular" }, "2026-09-16"),
      false
    );
    assert.equal(
      ctx.empSeparatedAsOf(
        { id: "d", empNo: "1300", status: "Separated", separatedOn: "2026-09-16" },
        "2026-09-16"
      ),
      true
    );
    assert.equal(
      ctx.empSeparatedAsOf(
        { id: "e", empNo: "1300", status: "Separated", separatedOn: "2026-09-17" },
        "2026-09-16"
      ),
      false
    );

    ctx.S.employees = {
      e1243: { id: "e1243", empNo: "1243", name: "Adolfo", status: "Regular" },
      e1250: { id: "e1250", empNo: "1250", name: "Armenio", status: "Regular" },
    };
    const list = ctx.dailyPeople({ date: "2026-09-16", rows: {}, extra: [], omit: [] });
    assert.ok(!list.some((e) => e.id === "e1243"));
    assert.ok(list.some((e) => e.id === "e1250"));
  });

  it("prints the HR e-sig in the Daily Monitoring memo chain slot", () => {
    const ctx = loadRosterFns();
    const out = ctx.memoChain([
      ["Prepared by:", "Cassie", "HR Staff", "data:image/png;base64,AAA"],
      ["Approved by:", "Head", "HR Officer"],
    ]);
    assert.match(out, /data:image\/png;base64,AAA/);
    assert.match(out, /<img /);
    assert.match(out, /Prepared by:/);
    assert.doesNotMatch(out, /Approved by:[\s\S]*<img /);
  });
});
