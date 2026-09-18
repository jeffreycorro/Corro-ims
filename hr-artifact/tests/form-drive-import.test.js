"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const hr = require("../public/hr-form-drive-import");

function emp(id, name, empNo) {
  return { id, empNo: empNo || id.replace(/\D/g, "") || "1241", name: name || "Test, " + id };
}

function stores(extra) {
  const S = {
    employees: {
      eJ: emp("eJ", "Jaranilla, Rosalie R.", "1241"),
      eC: emp("eC", "Cartuciano, Devin Carl", "1286"),
    },
    leaves: {
      lvOld: { id: "lvOld", empId: "eJ", no: "LRF2026-0169", status: "Approved" },
    },
    advances: {
      caOld: { id: "caOld", empId: "eC", no: "CAF2026-0008", signedLink: "https://drive.google.com/file/d/oldca/view" },
    },
    docreg: {},
    series: {
      LV: { key: "LV", prefix: "LRF", pad: 4 },
      CA: { key: "CA", prefix: "CAF", pad: 4 },
    },
  };
  return Object.assign(S, extra || {});
}

function hostFrom(S, extra) {
  const written = [];
  const toasts = [];
  const host = {
    S,
    TODAY: "2026-09-18",
    LEAVE_TYPES: [
      { k: "VL", n: "Vacation Leave" },
      { k: "SL", n: "Sick Leave" },
      { k: "SIL", n: "Service Incentive Leave" },
    ],
    DRIVE_SERVER: "Google Drive",
    FOLDER_MIME: "application/vnd.google-apps.folder",
    uid(pre) {
      return pre + written.length;
    },
    clone(o) {
      return JSON.parse(JSON.stringify(o));
    },
    normNo(v) {
      return String(v == null ? "" : v).replace(/\D/g, "");
    },
    empMatch(e, t) {
      const hay = ((e.name || "") + " " + (e.empNo || "")).toLowerCase();
      return String(t)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => hay.includes(w));
    },
    flipName(n) {
      const p = String(n || "").split(",");
      return p.length > 1 ? p[1].trim() + " " + p[0].trim() : String(n || "");
    },
    leaveDays(from, to) {
      if (!from) return 0;
      if (!to || to === from) return 1;
      return 2;
    },
    leaveType(k) {
      return { k, n: k };
    },
    esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;");
    },
    payloadFiles(r) {
      return (r && r.payload && r.payload.files) || [];
    },
    payloadText(r) {
      return (r && r.payload && (r.payload.text || r.payload.content)) || "";
    },
    mcpPayload(r) {
      return (r && r.payload) || {};
    },
    async put(coll, id, obj) {
      written.push([coll, id, obj]);
      S[coll] = S[coll] || {};
      S[coll][id] = obj;
    },
    toast(msg, kind) {
      toasts.push({ msg, kind });
    },
    driveMessage(e) {
      const c = e && e.code;
      if (c === "not_granted" || c === "capability_disabled") {
        return "Google Drive is switched off for this site, so nothing can be uploaded from here — the site's maintainer has to turn it on. Open the folder in Drive and drag the file in instead.";
      }
      return "Drive could not be read.";
    },
    openModal() {},
    closeModal() {},
    meterBar() {
      return "";
    },
    document: {
      createElement() {
        return { id: "", textContent: "" };
      },
      getElementById() {
        return null;
      },
      head: { appendChild() {} },
    },
    written,
    toasts,
  };
  return Object.assign(host, extra || {});
}

describe("filename parse", () => {
  it("reads emp no and LRF from 1241-LEAVE LRF2026-….jpg", () => {
    const p = hr.parseFormScanTitle("1241-LEAVE LRF2026-0123.jpg", "leave");
    assert.equal(p.kind, "leave");
    assert.equal(p.empNo, "1241");
    assert.equal(p.no, "LRF2026-0123");
  });

  it("keeps a spaced paper number as LRF2026-0123", () => {
    assert.equal(hr.parseFormNo("LRF2026 - 123", "leave").no, "LRF2026-0123");
    assert.ok(hr.sameFormNo("LRF 2026 - 0123", "LRF2026-0123", "leave"));
  });

  it("reads a cash-advance scan name", () => {
    const p = hr.parseFormScanTitle("1286-CASH ADVANCE CAF2026-0009.jpg", "ca");
    assert.equal(p.kind, "ca");
    assert.equal(p.empNo, "1286");
    assert.equal(p.no, "CAF2026-0009");
  });

  it("does not treat a leave handbook as a form", () => {
    assert.equal(hr.parseFormScanTitle("Leave Application Procedure.pdf", "leave"), null);
  });

  it("does not mint a number when the file has no LRF/CAF", () => {
    const p = hr.parseFormScanTitle("1241-LEAVE September scan.jpg", "leave");
    assert.equal(p.empNo, "1241");
    assert.equal(p.no, "");
  });
});

describe("scan text parse", () => {
  it("pulls leave fields off readable form text", () => {
    const t = hr.parseFormScanText(
      "Leave Request Form LRF2026-0188 Employee No: 1241 Type of leave: Vacation Leave From: 2026-09-20 To: 2026-09-22 Reason: Birthday Approved",
      "leave",
      [{ k: "VL", n: "Vacation Leave" }]
    );
    assert.equal(t.no, "LRF2026-0188");
    assert.equal(t.empNo, "1241");
    assert.equal(t.type, "VL");
    assert.equal(t.from, "2026-09-20");
    assert.equal(t.to, "2026-09-22");
    assert.match(t.reason, /Birthday/);
    assert.equal(t.status, "Approved");
  });

  it("pulls amount and purpose off a cash advance scan", () => {
    const t = hr.parseFormScanText(
      "Cash Advance Request CAF2026-0042 Employee No 1241 Amount: ₱20,000.00 Purpose: House renovation Date: 2026-01-13 Released",
      "ca"
    );
    assert.equal(t.no, "CAF2026-0042");
    assert.equal(t.empNo, "1241");
    assert.equal(t.amount, 20000);
    assert.match(t.purpose, /House renovation/);
    assert.equal(t.status, "Released");
  });
});

describe("duplicates and paper numbers", () => {
  it("skips an LRF already in S.leaves", () => {
    const S = stores();
    assert.equal(hr.formNoOnFile(S, "leave", "LRF2026-0169").id, "lvOld");
    assert.equal(hr.formNoOnFile(S, "leave", "LRF2026-0188"), null);
  });

  it("skips a Drive file already linked on a cash advance", () => {
    const S = stores();
    assert.ok(hr.fileAlreadyLinked(S, "ca", "https://drive.google.com/file/d/oldca/view"));
  });

  it("builds a leave that keeps the paper number and never allocates", () => {
    const S = stores();
    const host = hostFrom(S);
    const rec = hr.buildLeaveRecord(
      S.employees.eJ,
      { no: "LRF2026-0188", type: "SIL", from: "2026-09-20", to: "2026-09-20", reason: "Birthday" },
      { title: "1241-LEAVE LRF2026-0188.jpg", viewUrl: "https://drive.google.com/file/d/newlv/view" },
      host
    );
    assert.equal(rec.no, "LRF2026-0188");
    assert.equal(rec.empId, "eJ");
    assert.equal(rec.reason, "Birthday");
    assert.equal(rec.signedLink, "https://drive.google.com/file/d/newlv/view");
    assert.equal(rec.notes, "Imported from Drive");
    assert.doesNotMatch(JSON.stringify(rec), /allocate|peekNo|nextSeq/);
  });

  it("writes the kept CAF and skips a duplicate on the second pass", async () => {
    const S = stores();
    const host = hostFrom(S);
    const file = { id: "fnew", title: "1241-CASH ADVANCE CAF2026-0100.jpg", viewUrl: "https://drive.google.com/file/d/fnew/view" };
    const row = hr.classifyRow(
      S,
      "ca",
      file,
      hr.parseFormScanTitle(file.title, "ca"),
      host
    );
    assert.equal(row.no, "CAF2026-0100");
    assert.equal(row.emp.id, "eJ");
    assert.equal(row.already, null);
    const first = await hr.writeRow(host, "ca", row);
    assert.equal(first.made, true);
    assert.equal(S.advances[first.rec.id].no, "CAF2026-0100");
    assert.ok(Object.values(S.docreg).some((d) => d.no === "CAF2026-0100"));
    const again = await hr.writeRow(host, "ca", row);
    assert.equal(again.skipped, true);
    assert.equal(again.why, "duplicate");
  });

  it("refuses to write a row with no paper number", async () => {
    const S = stores();
    const host = hostFrom(S);
    const out = await hr.writeRow(host, "leave", {
      emp: S.employees.eJ,
      no: "",
      fields: {},
      file: { id: "x", title: "1241-LEAVE.jpg" },
      already: null,
    });
    assert.equal(out.made, false);
    assert.equal(out.why, "incomplete");
  });
});

describe("Drive search and host attach", () => {
  it("searches LRF / LEAVE / Leave Files and CAF / CASH ADVANCE folders", async () => {
    const queries = [];
    const mcp = {
      async callTool(server, tool, args) {
        assert.equal(server, "Google Drive");
        assert.equal(tool, "search_files");
        queries.push(args.query);
        if (/Leave Files/.test(args.query)) {
          return {
            payload: {
              files: [
                { id: "fld", title: "Leave Files", mimeType: "application/vnd.google-apps.folder" },
              ],
            },
          };
        }
        if (/parentId/.test(args.query)) {
          return {
            payload: {
              files: [
                {
                  id: "inFolder",
                  title: "1241-LEAVE LRF2026-0200.jpg",
                  mimeType: "image/jpeg",
                  viewUrl: "https://drive.google.com/file/d/inFolder/view",
                },
              ],
            },
          };
        }
        return { payload: { files: [] } };
      },
    };
    const host = hostFrom(stores());
    const found = await hr.searchFormScanFiles("leave", host, mcp);
    assert.ok(queries.some((q) => /LRF/.test(q)));
    assert.ok(queries.some((q) => /LEAVE/.test(q)));
    assert.ok(queries.some((q) => /Leave Files/.test(q)));
    assert.ok(queries.some((q) => /parentId/.test(q)));
    assert.equal(found.files.length, 1);
    assert.equal(found.files[0].id, "inFolder");
    assert.equal(found.folders, 1);
  });

  it("toasts the same Drive-off sentence when mcp is missing", async () => {
    const host = hostFrom(stores(), {
      async getMcp() {
        return null;
      },
    });
    await hr.open("leave", host);
    assert.equal(host.toasts.length, 1);
    assert.match(host.toasts[0].msg, /Google Drive is switched off for this site/);
    assert.equal(host.toasts[0].kind, "err");
  });

  it("replaces importRecords with the Drive door and keeps paste", () => {
    const calls = [];
    const host = hostFrom(stores(), {
      importRecords(kind) {
        calls.push("old:" + kind);
      },
      importRecordsPaste(kind) {
        calls.push("paste:" + kind);
      },
      async getMcp() {
        return null;
      },
    });
    hr.attach(host);
    host.importRecords("leave");
    assert.equal(host.importRecords._hrFormDrive, true);
    assert.equal(typeof host.importRecordsPaste, "function");
  });
});

describe("artifact wiring", () => {
  it("is loaded by the shim and not referenced from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-form-drive-import\.js/);
    assert.match(shim, /data-hr-form-drive-import/);
    assert.ok(shim.indexOf("hr-leave-numbers.js") < shim.indexOf("hr-form-drive-import.js"));
    assert.doesNotMatch(html, /hr-form-drive-import\.js/);
    assert.match(html, /id="imp-lv">Import from Drive/);
    assert.match(html, /id="imp-ca">Import from Drive/);
    assert.match(html, /function importRecordsPaste/);
    assert.match(html, /Paste rows instead|hrFormDriveImport/);
    const recFn = html.slice(html.indexOf("function importRecords("), html.indexOf("function importRecordsPaste"));
    assert.doesNotMatch(recFn, /tab or comma separated|TSV|spreadsheet/i);
  });

  it("loads in a window like the other companions", () => {
    const src = fs.readFileSync(path.join(__dirname, "../public/hr-form-drive-import.js"), "utf8");
    const windowLike = { document: { readyState: "complete", addEventListener() {} } };
    vm.runInNewContext(src, windowLike);
    assert.equal(typeof windowLike.hrFormDriveImport.parseFormScanTitle, "function");
    assert.equal(windowLike.hrFormDriveImport.parseFormNo("CAF2026-42", "ca").no, "CAF2026-0042");
  });
});
