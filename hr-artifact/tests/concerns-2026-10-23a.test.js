"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");

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

describe("Cassie concerns 2026-10-23a", () => {
  it("is build 2026-10-23a and keeps the earlier build note", () => {
    assert.match(html, /const BUILD = "2026-10-26a"/);
    const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
    assert.match(readme, /build 2026-10-23a/);
    assert.match(readme, /build 2026-10-20a/);
    assert.match(readme, /No new database collection/);
    assert.match(readme, /Add someone who is not on the pipeline|type a name that is not on the pipeline/);
  });

  it("offers a PDF of the attendance records next to the CSV", () => {
    assert.match(html, /id="dr-pdf"/);
    assert.match(html, /function attendanceRecordSheet\(/);
    assert.match(html, /function saveAttendancePdf\(/);
    assert.match(html, /pfISO\("attrec"\)/);
    assert.match(html, /\{k:"attrec"/);
    const saveFile = extractFunction(html, "saveFile");
    assert.ok(saveFile.indexOf("downloadBlob") < saveFile.indexOf("await"));
    const pv = html.slice(html.indexOf('id="pv-save"'), html.indexOf('id="pv-save"') + 700);
    assert.match(pv, /downloadBlob\(o\.name, o\.blob\)/);
    assert.doesNotMatch(pv, /await/);
    const dl = shim.slice(shim.indexOf("function createDownloads"), shim.indexOf("function normalizeClientMessages"));
    assert.match(dl, /text\/csv/);
    assert.doesNotMatch(dl, /a\.remove\(\)/);
    assert.match(dl, /removeChild\(a\)/);
  });

  it("prints the employee, the date range, and the same columns under the company header", () => {
    const names = [
      "attendanceStatusText",
      "leaveVerdictText",
      "attendanceSpanLabel",
      "attendanceKindTitle",
      "attendanceRecordFilename",
      "attendanceRecordSheet",
    ];
    const src = names.map((name) => extractFunction(html, name)).join("\n");
    const ctx = {
      STATUS_PENDING: "Pending",
      TODAY: "2026-10-23",
      S: {
        employees: { e1: { id: "e1", name: "Reyes, Teofilo N. JR.", empNo: "1245" } },
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
    };
    vm.runInNewContext(src, ctx);
    const rows = [
      { date: "2026-10-16", status: "Absent", reason: "AWOL / no call, no show", site: "UP She Shelter", rawStatus: "Absent", excuse: null },
      { date: "2026-07-14", status: "Absent", reason: "", site: "UP She Shelter", rawStatus: "Absent", excuse: { kind: "report", no: "LRF2025-0123" } },
    ];
    const sheet = ctx.attendanceRecordSheet({ empId: "e1", kind: "absent" }, rows);
    assert.match(sheet, /CORRO CONST/);
    assert.match(sheet, /ABSENCES/);
    assert.match(sheet, /Employee=Teofilo N\. JR\. Reyes/);
    assert.match(sheet, /Employee no\.=1245/);
    assert.match(sheet, /Date range=long:2026-07-14 – long:2026-10-16/);
    assert.match(sheet, /Records=2/);
    assert.match(sheet, /Prepared=long:2026-10-23/);
    assert.match(sheet, /<b>Date<\/b>/);
    assert.match(sheet, /<b>Status<\/b>/);
    assert.match(sheet, /<b>Reason as written<\/b>/);
    assert.match(sheet, /<b>Leave cited<\/b>/);
    assert.match(sheet, /<b>Area<\/b>/);
    assert.match(sheet, /2026-10-16/);
    assert.match(sheet, /AWOL \/ no call, no show/);
    assert.match(sheet, /none written/);
    assert.match(sheet, /LRF2025-0123 — not on file/);
    assert.match(sheet, /UP She Shelter/);
    assert.match(sheet, /Prepared by Cassie Moran/);
    assert.match(sheet, /Noted by Domingo Corro/);
    assert.match(sheet, /<iso>attrec<\/iso>/);
    const table = sheet.slice(sheet.indexOf("<b>Date</b>"));
    assert.ok(table.indexOf("2026-10-16") < table.indexOf("2026-07-14"));
    assert.equal(ctx.attendanceRecordFilename({ empId: "e1" }, rows), "attendance-Teofilo-N-JR-Reyes");
  });
});
