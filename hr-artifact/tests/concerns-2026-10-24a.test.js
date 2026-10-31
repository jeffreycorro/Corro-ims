"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");

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

function rosterCtx(mode) {
  const ctx = {
    S: { ui: { attRoster: mode || "all" }, employees: {} },
    TODAY: "2026-10-24",
    esc(s) {
      return String(s == null ? "" : s);
    },
  };
  const names = [
    "statusTextIsSeparated",
    "empRehireDate",
    "priorSeparationSuperseded",
    "rehiredActiveAsOf",
    "attendanceRosterMode",
    "attendanceIsLeaver",
    "attendanceRosterMatches",
    "attendanceRosterSeg",
    "attendanceStatusNote",
  ];
  vm.runInNewContext(names.map((name) => extractFunction(html, name)).join("\n"), ctx);
  return ctx;
}

describe("Cassie concerns 2026-10-24a", () => {
  it("is build 2026-10-24a and keeps the earlier attendance PDF note", () => {
    assert.match(html, /const BUILD = "2026-10-29b"/);
    assert.match(readme, /build 2026-10-26a/);
    assert.match(readme, /build 2026-10-23a/);
    assert.match(readme, /No new database collection/);
    assert.match(readme, /lates, absences and leave|lates, absences, and leave/i);
  });

  it("lists every employee with a late or an absence, not the first 25", () => {
    const block = html.slice(html.indexOf("const offAll=offenders"), html.indexOf("Attendance edited after filing"));
    assert.match(block, /offAll\.filter/);
    assert.match(block, /All '\+off\.length\+' with a late or an absence/);
    assert.doesNotMatch(block, /off\.slice\(0,\s*25\)/);
    assert.doesNotMatch(block, /Showing 25 of/);
    assert.match(block, /attendanceRosterSeg\(\)/);
    assert.match(block, /data-attpdf=/);
    const seg = extractFunction(html, "attendanceRosterSeg");
    assert.match(seg, /btn\("active","Active"\)/);
    assert.match(seg, /btn\("resigned","Resigned"\)/);
    assert.match(seg, /btn\("all","All"\)/);
    assert.match(block, /id="att-off-q"/);
    const summary = extractFunction(html, "attendanceSummaryCard");
    assert.match(summary, /attendanceRosterMatches/);
    assert.match(summary, /data-attpdf=/);
    assert.doesNotMatch(summary, /rows\.slice\(0,/);
  });

  it("treats resigned, terminated, and AWOL as Resigned, and a rehire as active", () => {
    const all = rosterCtx("all");
    const active = rosterCtx("active");
    const resigned = rosterCtx("resigned");
    const people = {
      reg: { id: "e1", status: "Regular", name: "Alpha, Ann" },
      blank: { id: "e2", status: "", name: "Blank, Bea" },
      res: { id: "e3", status: "Resigned", name: "Resigned, Ray" },
      term: { id: "e4", status: "Terminated", name: "Term, Tess" },
      awol: { id: "e5", status: "AWOL", name: "Away, Al" },
      back: {
        id: "e6",
        status: "Separated",
        separatedOn: "2026-08-31",
        rehireDate: "2026-10-16",
        name: "Monte, Domingo C.",
      },
    };
    for (const ctx of [all, active, resigned]) {
      assert.equal(ctx.attendanceRosterMatches(people.reg), ctx === all || ctx === active);
      assert.equal(ctx.attendanceRosterMatches(people.blank), ctx === all || ctx === active);
      assert.equal(ctx.attendanceRosterMatches(people.res), ctx === all || ctx === resigned);
      assert.equal(ctx.attendanceRosterMatches(people.term), ctx === all || ctx === resigned);
      assert.equal(ctx.attendanceRosterMatches(people.awol), ctx === all || ctx === resigned);
      assert.equal(ctx.attendanceIsLeaver(people.back), false);
      assert.equal(ctx.attendanceRosterMatches(people.back), ctx === all || ctx === active);
    }
    assert.match(all.attendanceRosterSeg(), /data-aroster="all"/);
    assert.match(all.attendanceStatusNote(people.res), /Resigned/);
    assert.equal(all.attendanceStatusNote(people.reg), "");
    assert.match(all.attendanceStatusNote(people.awol), /AWOL/);
  });

  it("saves a PDF of lates, absences, and leave for one employee", () => {
    const names = [
      "attendanceStatusText",
      "leaveVerdictText",
      "attendanceSpanLabel",
      "attendanceKindTitle",
      "attendanceRecordFilename",
      "attendanceRecordSheet",
      "attendancePdfRequest",
    ];
    const seen = [];
    const ctx = {
      STATUS_PENDING: "Pending",
      TODAY: "2026-10-24",
      S: {
        employees: {
          e1: { id: "e1", name: "Reyes, Teofilo N. JR.", empNo: "1245", status: "Regular" },
          e9: { id: "e9", name: "Cruz, Rosa", empNo: "1402", status: "Resigned" },
        },
        settings: { hrHead: "Domingo Corro", hrTitle: "HR Officer" },
      },
      citedLeaveRef() {
        return null;
      },
      reportSaysNotFiled() {
        return false;
      },
      esc(s) {
        return String(s == null ? "" : s);
      },
      flipName(n) {
        const parts = String(n || "").split(",");
        if (parts.length < 2) return String(n || "");
        return (parts[1] + " " + parts[0]).replace(/\s+/g, " ").trim();
      },
      longDate(d) {
        return "long:" + d;
      },
      hrStaffName() {
        return "Cassie Moran";
      },
      slugNo(n) {
        return String(n || "doc").replace(/[^A-Za-z0-9_-]+/g, "-");
      },
      pfHead() {
        return "<header>CORRO CONST</header>";
      },
      pfTitle(t, sub) {
        return "<h1>" + t + "</h1><p>" + sub + "</p>";
      },
      pfRows(rows) {
        return rows.map((r) => r[0] + "=" + r[1]).join("|");
      },
      pfBand(t) {
        return "<band>" + t + "</band>";
      },
      pfSign(cols) {
        return "<sign>" + cols.map((c) => c.join(" ")).join(";") + "</sign>";
      },
      pfISO(key) {
        return "<iso>" + key + "</iso>";
      },
      drillRows(o) {
        seen.push(o);
        return [
          { date: "2026-10-16", status: "Absent", reason: "AWOL / no call, no show", site: "UP She Shelter", rawStatus: "Absent", excuse: null },
          { date: "2026-10-10", status: "Present/Late", reason: "traffic", site: "UP She Shelter", rawStatus: "Present/Late", excuse: null },
          { date: "2026-07-14", status: "Leave", reason: "sick", site: "ADMINS", rawStatus: "Absent", excuse: { kind: "register", no: "LRF2026-0101" } },
        ];
      },
    };
    vm.runInNewContext(names.map((name) => extractFunction(html, name)).join("\n"), ctx);
    const absencesOnly = [{ date: "2026-10-16", status: "Absent", reason: "AWOL / no call, no show", site: "UP She Shelter", rawStatus: "Absent" }];
    const req = ctx.attendancePdfRequest({ empId: "e9", kind: "absent", months: ["2026-07", "2026-10"] }, absencesOnly);
    assert.equal(req.spec.kind, "all");
    assert.equal(req.spec.empId, "e9");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, "all");
    assert.equal(req.rows.length, 3);
    const kept = ctx.attendancePdfRequest({ kind: "absent", months: ["2026-10"] }, absencesOnly);
    assert.equal(kept.spec.kind, "absent");
    assert.equal(kept.rows.length, 1);

    const sheet = ctx.attendanceRecordSheet(req.spec, req.rows);
    assert.match(sheet, /CORRO CONST/);
    assert.match(sheet, /LATES, ABSENCES AND LEAVE/);
    assert.match(sheet, /Employee=Rosa Cruz/);
    assert.match(sheet, /Employee no\.=1402/);
    assert.match(sheet, /Employment=Resigned/);
    assert.match(sheet, /Date range=long:2026-07-14 – long:2026-10-16/);
    assert.match(sheet, /<b>Date<\/b>/);
    assert.match(sheet, /<b>Status<\/b>/);
    assert.match(sheet, /<b>Reason as written<\/b>/);
    assert.match(sheet, /<b>Leave cited<\/b>/);
    assert.match(sheet, /<b>Area<\/b>/);
    assert.match(sheet, /2026-10-16/);
    assert.match(sheet, />Absent</);
    assert.match(sheet, />Late</);
    assert.match(sheet, />On leave</);
    assert.match(sheet, /AWOL \/ no call, no show/);
    assert.match(sheet, /traffic/);
    assert.match(sheet, /LRF2026-0101/);
    assert.match(sheet, /UP She Shelter/);
    assert.match(sheet, /ADMINS/);
    assert.match(sheet, /Prepared by Cassie Moran/);
    const drill = extractFunction(html, "attendanceDrill");
    assert.match(drill, /attendancePdfRequest\(o, allRows\)/);
    assert.match(html, /id="dr-pdf"/);
    const save = html.slice(html.indexOf('id="pv-save"'), html.indexOf('id="pv-save"') + 700);
    assert.match(save, /downloadBlob\(o\.name, o\.blob\)/);
    assert.doesNotMatch(save, /await/);
  });
});
