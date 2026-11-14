"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const api = require("../public/hr-reminder-numbers");

function series() {
  return {
    RM: {
      key: "RM",
      prefix: "RM",
      pad: 3,
      pattern: "{PREFIX}{YYYY}-{NNNN}",
      lastByYear: {},
    },
  };
}

function store(extra) {
  return Object.assign(
    { reminders: {}, docreg: {}, filed: {}, employees: {}, series: series() },
    extra || {}
  );
}

describe("written reminder numbers", () => {
  it("issues the next RM number and never goes backwards", () => {
    const S = store();
    const first = api.assign(S, { id: "a", status: "Issued", subject: "One" }, { issue: true, year: 2026 });
    assert.equal(first.ok, true);
    assert.equal(first.no, "RM2026-001");
    S.series.RM = first.series;
    S.reminders.a = { id: "a", no: first.no, subject: "One" };
    const second = api.assign(S, { id: "b", status: "Issued", subject: "Two" }, { issue: true, year: 2026 });
    assert.equal(second.no, "RM2026-002");
    S.series.RM = second.series;
    delete S.reminders.a;
    const afterDelete = api.nextNo(S, 2026);
    assert.equal(afterDelete.no, "RM2026-003");
    assert.notEqual(afterDelete.no, "RM2026-001");
  });

  it("keeps a voided register number out of the pool", () => {
    const S = store({
      docreg: {
        d1: { id: "d1", no: "RM2026-001", seriesKey: "RM", year: 2026, seq: 1, status: "Void", module: "reminder", refId: "gone" },
        d2: { id: "d2", no: "RM2026-002", seriesKey: "RM", year: 2026, seq: 2, status: "Issued", module: "reminder", refId: "rm2" },
      },
      reminders: {
        rm2: { id: "rm2", no: "RM2026-002", empId: "e1298", subject: "kept" },
      },
    });
    assert.equal(api.nextNo(S, 2026).no, "RM2026-003");
  });

  it("refuses a second copy of the same register number", () => {
    const S = store({
      reminders: { a: { id: "a", no: "RM2026-001", subject: "FIRST REMINDER", empId: "e1355" } },
    });
    const again = api.assign(S, { id: "b", no: "RM2026-001", status: "Issued" }, { issue: true, year: 2026 });
    assert.equal(again.ok, false);
    assert.equal(again.code, "duplicate_reminder_number");
    assert.match(again.message, /RM2026-001/);
    assert.match(again.message, /RM2026-002/);
  });

  it("shows the paper WR number and keeps the register number", () => {
    const rec = {
      id: "rm_0hoicrsa4mx",
      no: "RM2026-002",
      subject: "first reminder to Teofilo Reyes Bearing  WR2026-04",
      empId: "e1298",
    };
    assert.equal(api.paperNoOf(rec), "WR2026-04");
    assert.equal(api.displayNo(rec), "WR2026-04 · RM2026-002");
    const saved = api.assign(store({ reminders: { rm_0hoicrsa4mx: rec } }), rec, { issue: false });
    assert.equal(saved.ok, true);
    assert.equal(saved.no, "RM2026-002");
    assert.equal(saved.paperNo, "WR2026-04");
  });

  it("refuses a paper number another reminder already carries", () => {
    const S = store({
      reminders: {
        a: { id: "a", no: "RM2026-002", subject: "Bearing WR2026-04", empId: "e1298" },
      },
    });
    const dup = api.assign(S, { id: "b", paperNo: "WR2026 - 04", status: "Draft", subject: "again" }, { issue: false });
    assert.equal(dup.ok, false);
    assert.match(dup.message, /WR2026-04/);
  });

  it("names every employee on a multi-person reminder", () => {
    const rec = {
      id: "crew",
      audience: "Selected people",
      empId: "e1282",
      empIds: ["e1282", "e1241", "e1256", "e1323", "e1291"],
      no: "RM2026-003",
      paperNo: "WR2026-01",
    };
    assert.deepEqual(api.taggedEmpIds(rec), ["e1282", "e1241", "e1256", "e1323", "e1291"]);
    assert.equal(api.tagsEmp(rec, "e1291"), true);
    assert.equal(api.tagsEmp(rec, "e1355"), false);
    assert.equal(api.displayNo(rec), "WR2026-01 · RM2026-003");
  });

  it("reads a written-reminder scan from the 201 checklist", () => {
    const S = store({
      employees: {
        e1323: {
          id: "e1323",
          name: "Bernadez, Brinneshiel M.",
          docs: {
            darmemo: {
              s: "on",
              title: "1323-DM2026 - 15, July 20, 2026, Bernadez Brinneshiel.pdf",
              link: "https://drive.google.com/file/d/1vlPy6O0GiKV5QHRGd-KaL7uyV33BDB1i/view",
              links: [
                { title: "1323-DM2026 - 15, July 20, 2026, Bernadez Brinneshiel.pdf", url: "https://example/dm" },
                {
                  on: "2026-09-21",
                  title: "WRITTEN REMINDER MEMORANDUM, WR2026 - 01.pdf",
                  url: "https://drive.google.com/file/d/14hgvzAEAZUkew8ktvqYYfe6x2J8xtP1z/view",
                },
              ],
            },
          },
        },
        e1282: { id: "e1282", name: "Largo, Catherine A.", docs: {} },
      },
    });
    const hits = api.checklistReminders(S);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].empId, "e1323");
    assert.equal(hits[0].paperNo, "WR2026-01");
    assert.equal(api.checklistForEmp(S, "e1282").length, 0);
  });

  it("lists the live data fix without changing register numbers", () => {
    const S = store({
      reminders: {
        senining: { id: "rm_r0fkgukiayi", no: "RM2026-001", empId: "e1355", subject: "FIRST REMINDER", status: "Closed" },
        reyes: {
          id: "rm_0hoicrsa4mx",
          no: "RM2026-002",
          empId: "e1298",
          subject: "first reminder to Teofilo Reyes Bearing  WR2026-04",
          status: "Issued",
        },
      },
      employees: {
        e1323: {
          id: "e1323",
          docs: {
            darmemo: {
              links: [{ title: "WRITTEN REMINDER MEMORANDUM, WR2026 - 01.pdf", url: "https://drive.example/wr01" }],
            },
          },
        },
      },
    });
    const rows = api.dryRun(S);
    const paper = rows.find((r) => r.action === "set paperNo");
    assert.equal(paper.id, "rm_0hoicrsa4mx");
    assert.equal(paper.to, "WR2026-04");
    assert.equal(paper.registerNo, "RM2026-002");
    assert.ok(rows.filter((r) => r.action === "leave register number").every((r) => /kept|No renumber/.test(r.note)));
    assert.ok(!rows.some((r) => r.action === "set paperNo" && r.id === "rm_r0fkgukiayi"));
    const missing = rows.filter((r) => r.action === "missing").map((r) => r.paperNo).sort();
    assert.deepEqual(missing, ["WR2026-02", "WR2026-03", "WR2026-05"]);
    assert.ok(rows.some((r) => r.action === "checklist only" && r.paperNo === "WR2026-01" && r.id === "e1323"));
  });

  it("does not let a series write lower the high-water mark", () => {
    const stored = { key: "RM", prefix: "RM", pad: 3, lastByYear: { 2026: 2 }, lastSeq: 2 };
    const guarded = api.guardSeriesWrite(stored, { lastByYear: { 2026: 1 }, lastSeq: 1, pattern: "{PREFIX}{YYYY}-{NNNN}" });
    assert.equal(guarded.lastByYear["2026"], 2);
    assert.equal(guarded.lastSeq, 2);
    const retired = api.retireSeries(guarded, { no: "RM2026-002" });
    assert.equal(api.nextNo({ series: { RM: retired }, reminders: {}, docreg: {} }, 2026).no, "RM2026-003");
  });

  it("is wired into the shim, the 201 file, and the db function", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    const db = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");
    const file201 = fs.readFileSync(path.join(__dirname, "../public/hr-201-file.js"), "utf8");
    assert.match(html, /const BUILD = "2026-11-14a"/);
    assert.match(shim, /hr-reminder-numbers\.js/);
    assert.match(shim, /data-hr-reminder-numbers/);
    assert.ok(shim.indexOf("hr-reminder-numbers.js") < shim.indexOf("hr-201-file.js"));
    assert.doesNotMatch(html, /hr-reminder-numbers\.js/);
    assert.match(html, /id="rm-paper"/);
    assert.match(html, /duplicate_reminder_number/);
    assert.match(db, /rejectDuplicateReminderNumber/);
    assert.match(db, /retireReminderNumber/);
    assert.match(db, /hr-reminder-numbers/);
    assert.match(file201, /reminderShownNo/);
    assert.match(file201, /checklistForEmp/);
  });
});

describe("201 file shows a reminder on every named employee", () => {
  it("lists the paper number and the checklist scan", () => {
    const ctx = { window: {}, document: undefined };
    ctx.window = ctx;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-reminder-numbers.js"), "utf8"), ctx);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-201-file.js"), "utf8"), ctx);
    const hr = ctx.hr201File;
    const S = {
      employees: {
        e1: { id: "e1", name: "Largo, Catherine A." },
        e2: { id: "e2", name: "Osorio, Jade M." },
        e3: { id: "e3", name: "Bernadez, Brinneshiel M.", docs: {
          darmemo: { links: [{ title: "WRITTEN REMINDER MEMORANDUM, WR2026 - 01.pdf", url: "https://drive.example/wr", on: "2026-09-21" }] },
        } },
      },
      nte: {}, writeups: {}, discipline: {}, memos: {}, incidents: {}, leaves: {}, advances: {},
      reminders: {
        crew: {
          id: "crew",
          audience: "Selected people",
          empIds: ["e1", "e2"],
          no: "RM2026-003",
          paperNo: "WR2026-01",
          subject: "Crew",
          date: "2026-09-21",
          status: "Issued",
        },
      },
      docreg: {},
      filed: {},
      genfiles: {},
    };
    const a = hr.recordsFor("e1", S);
    const b = hr.recordsFor("e2", S);
    assert.equal(a.filter((r) => r.source === "reminders").length, 1);
    assert.equal(b.filter((r) => r.source === "reminders").length, 1);
    assert.equal(a.find((r) => r.source === "reminders").no, "WR2026-01 · RM2026-003");
    const scan = hr.recordsFor("e3", S).find((r) => r.source === "checklist");
    assert.ok(scan);
    assert.equal(scan.no, "WR2026-01");
    assert.equal(hr.recordsFor("e1", S).some((r) => r.source === "checklist"), false);
  });
});
