"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20261017000001_hr_discipline.sql"),
  "utf8"
);
const { ALLOWED_COLLECTIONS } = require("../netlify/lib/collections");
const disc = require("../public/hr-discipline.js");

function load201() {
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-201-file.js"), "utf8");
  const ctx = { console };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx);
  return ctx.hr201File;
}

function store(extra) {
  return Object.assign(
    {
      employees: {
        e1: {
          id: "e1",
          empNo: "1401",
          name: "Reyes, Ana",
          project: "Tagbao",
          dept: "Site",
        },
        e2: {
          id: "e2",
          empNo: "1402",
          name: "Cruz, Ben",
          project: "",
          dept: "Admin",
        },
      },
      discipline: {},
      writeups: {},
      nte: {},
    },
    extra || {}
  );
}

describe("disciplinary actions 2026-10-17a", () => {
  it("is build 2026-10-17a and the shared store accepts discipline", () => {
    assert.match(html, /const BUILD = "2026-10-26a"/);
    assert.ok(ALLOWED_COLLECTIONS.includes("discipline"));
    assert.match(html, /discipline:\{\}/);
    assert.match(html, /"discipline"/);
    assert.match(shim, /hr-discipline\.js/);
    assert.match(shim, /data-hr-discipline/);
    assert.match(migration, /insert into public\.hr_allowed_collections/i);
    assert.match(migration, /'discipline'/);
    const sql = migration.replace(/--[^\n]*/g, "");
    assert.doesNotMatch(sql, /\b(drop|delete|update|alter table)\b/i);
  });

  it("opens a year dashboard and files the signed copy on the existing 201 row", () => {
    assert.match(html, /Disciplinary Actions/);
    assert.match(html, /function viewDiscipline\(/);
    assert.match(html, /id="da-year"/);
    assert.match(html, /data-new-da/);
    assert.match(html, /discipline:\{label:"Disciplinary action",\s+docKey:"darmemo"/);
    assert.match(html, /function fileDisciplineScan\(/);
    assert.match(html, /fileOntoChecklist/);
    assert.match(html, /DAR \/ Memo \(disciplinary action\)/);
    assert.match(html, /k:"darmemo"[^}]*opt:1/);
  });

  it("counts a written reprimand and a suspension for the selected year", () => {
    const S = store({
      discipline: {
        a: {
          id: "a",
          empId: "e1",
          date: "2026-03-02",
          action: "Written Reprimand",
          offense: "Late three days",
          no: "DM2026 - 01",
          signedLink: "https://drive.google.com/file/d/rep/view",
        },
        b: {
          id: "b",
          empId: "e1",
          date: "2026-10-11",
          action: "Suspension",
          offense: "Absent without leave",
          days: "3",
          from: "2026-10-12",
          to: "2026-10-14",
          no: "DM2026 - 02",
        },
        old: {
          id: "old",
          empId: "e2",
          date: "2025-12-01",
          action: "Written Reprimand",
          offense: "Last year",
        },
      },
    });
    const sum = disc.summarize(S, "2026", "2026-10-17");
    assert.equal(sum.implemented, 2);
    assert.equal(sum.reprimands, 1);
    assert.equal(sum.suspensions, 1);
    assert.equal(sum.other, 0);
    assert.equal(sum.byType.find((t) => t.type === "Written Reprimand").count, 1);
    assert.equal(sum.byType.find((t) => t.type === "Suspension").count, 1);
    assert.equal(sum.byMonth[2].label, "March");
    assert.equal(sum.byMonth[2].reprimands, 1);
    assert.equal(sum.byMonth[9].suspensions, 1);
    assert.equal(sum.byMonth[0].total, 0);
    assert.equal(sum.bySite[0].site, "Tagbao");
    assert.equal(sum.bySite[0].total, 2);
    assert.equal(sum.byEmployee[0].name, "Reyes, Ana");
    assert.equal(sum.byEmployee[0].total, 2);
    assert.equal(sum.rows[0].days, 3);
    assert.equal(sum.rows[1].signed, true);
    const lastYear = disc.summarize(S, "2025", "2026-10-17");
    assert.equal(lastYear.implemented, 1);
    assert.equal(lastYear.reprimands, 1);
    assert.ok(sum.years.includes("2026"));
    assert.ok(sum.years.includes("2025"));
  });

  it("keeps write-ups and decided notices, and does not count the same case twice", () => {
    const S = store({
      discipline: {
        a: {
          id: "a",
          empId: "e2",
          date: "2026-06-01",
          action: "suspension",
          offense: "After the notice",
          nteId: "n1",
          nteNo: "NTE2026 - 04",
          days: "",
          from: "2026-06-02",
          to: "2026-06-04",
        },
      },
      writeups: {
        w1: {
          id: "w1",
          empId: "e1",
          date: "2026-02-02",
          sanction: "3-day Suspension",
          acts: "Left the site",
        },
      },
      nte: {
        n1: {
          id: "n1",
          empId: "e2",
          no: "NTE2026 - 04",
          issued: "2026-05-20",
          status: "decided",
          sanction: "Suspension",
          nodOn: "2026-06-01",
        },
        nOpen: {
          id: "nOpen",
          empId: "e1",
          issued: "2026-07-01",
          status: "issued",
          sanction: "",
        },
        nDraft: {
          id: "nDraft",
          empId: "e1",
          issued: "2026-07-02",
          status: "draft",
        },
      },
    });
    const sum = disc.summarize(S, "2026", "2026-10-17");
    assert.equal(sum.suspensions, 2);
    assert.equal(sum.implemented, 2);
    assert.equal(sum.openNotices, 1);
    assert.equal(sum.rows.filter((r) => r.source === "nte").length, 0);
    assert.equal(sum.bySite.find((s) => s.site === "Admin").suspensions, 1);
    assert.equal(sum.bySite.find((s) => s.site === "Tagbao").suspensions, 1);
    assert.equal(disc.suspensionDays(S.discipline.a), 3);
    assert.equal(disc.canonicalAction("suspension"), "Suspension");
  });

  it("adds the scan to the DAR / Memo checklist row without a second copy", () => {
    const docs = {
      resume: { s: "on", link: "https://drive.google.com/file/d/cv/view", links: [], filed: "2024-01-01", expiry: "" },
      darmemo: { s: "miss", link: "", links: [], filed: "", expiry: "" },
    };
    const once = disc.fileOntoChecklist(
      docs,
      disc.DOC_KEY,
      "https://drive.google.com/file/d/rep/view",
      "1401 reprimand signed",
      "2026-03-02"
    );
    assert.equal(once.resume.link, docs.resume.link);
    assert.equal(once.darmemo.s, "on");
    assert.equal(once.darmemo.filed, "2026-03-02");
    assert.equal(once.darmemo.link, "https://drive.google.com/file/d/rep/view");
    assert.equal(once.darmemo.links.length, 1);
    assert.equal(docs.darmemo.s, "miss");
    const twice = disc.fileOntoChecklist(
      once,
      "darmemo",
      "https://drive.google.com/file/d/sus/view",
      "1401 suspension signed",
      "2026-10-11"
    );
    assert.equal(twice.darmemo.links.length, 2);
    assert.equal(twice.darmemo.filed, "2026-03-02");
    const again = disc.fileOntoChecklist(
      twice,
      "darmemo",
      "https://drive.google.com/file/d/sus/view",
      "1401 suspension signed",
      "2026-10-11"
    );
    assert.equal(again.darmemo.links.length, 2);
    const expiring = disc.fileOntoChecklist(
      { darmemo: { s: "exp", link: "", links: [], filed: "2020-01-01", expiry: "2026-01-01" } },
      "darmemo",
      "https://drive.google.com/file/d/new/view",
      "replacement",
      "2026-10-17"
    );
    assert.equal(expiring.darmemo.s, "exp");
    assert.equal(expiring.darmemo.filed, "2020-01-01");
  });

  it("shows the signed disciplinary action on the 201 file for that person", () => {
    const hr = load201();
    const S = store({
      discipline: {
        a: {
          id: "a",
          empId: "e1",
          date: "2026-10-11",
          action: "Suspension",
          offense: "Absent without leave",
          days: "3",
          from: "2026-10-12",
          to: "2026-10-14",
          no: "DM2026 - 02",
          signedLink: "https://drive.google.com/file/d/sus/view",
        },
      },
    });
    const rows = hr.recordsFor("e1", S);
    const row = rows.find((r) => r.source === "discipline");
    assert.ok(row);
    assert.equal(row.type, "Suspension");
    assert.equal(row.link, "https://drive.google.com/file/d/sus/view");
    assert.equal(row.status, "Signed");
    assert.match(hr.sectionHtml(S.employees.e1, rows), /drive\.google\.com\/file\/d\/sus/);
    assert.equal(hr.recordsFor("e2", S).length, 0);
  });
});
