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
    S: { daily: {}, employees: {},     settings: {}, ui: { dailyDate: "2026-09-16" }, roles: {} },
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
    flipName(n) {
      const p = String(n || "").split(",");
      return p.length > 1 ? p[1].trim() + " " + p[0].trim() : String(n || "");
    },
    STATUS_PENDING: "Has not yet arrived",
  };
  const names = [
    "knownSepRec",
    "empStatusIsLive",
    "empStatusIsSeparated",
    "separatedSnapIsStale",
    "employeeLiveBeatsSeparatedSnap",
    "sepRosterWouldApply",
    "dayIsOpen",
    "openDayKeepsLeaver",
    "stripOpenDayLeavers",
    "empSeparatedAsOf",
    "empPosition",
    "dayStatusOf",
    "mergeIncomingDoc",
    "hrSigSrc",
    "lastSiteBefore",
    "firstAddedIndex",
    "dailySiteOf",
    "dailyPeople",
    "dailyGroups",
    "persistRosterOnDay",
    "applyHrSigsToRec",
    "memoChain",
    "mergeIdList",
    "mergeDailyRowKeep",
    "lastRosterLayout",
    "dailyOrderOf",
    "dailySiteOrderOf",
    "sortByRosterOrder",
    "nameLastFirst",
    "foldSigName",
    "hrSigSlotDefs",
    "matchHrSigFilename",
    "normStatus",
    "dayCredit",
  ];
  const body = names.map((n) => extractFunction(html, n)).join("\n");
  vm.runInNewContext(body, ctx);
  return ctx;
}

describe("staff concern sheet — live 18a HTML", () => {
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
    assert.match(html, /function handleHrSigFiles/);
    assert.match(html, /function matchHrSigFilename/);
    assert.match(html, /id="dm-hrsig"/);
    assert.match(html, /id="set-hrsig"/);
    assert.match(html, /job\.hrSig/);
    assert.match(html, /applySeparatedRoster/);
    assert.match(html, /separated-roster\.json/);
    assert.match(html, /pill ok[^>]*>signed/);
    assert.match(html, /prev\.signedLink && !m\.signedLink/);
    assert.match(html, /cassieSig\(rec\)/);
    assert.match(html, /hrSigSrc\(rec\|\|null, "prepared"\)/);
    assert.match(html, /Object\.keys\(rec\.rows\|\|\{\}\)\.forEach\(id=>\{ if\(id\) seen\[id\]=true/);
    assert.match(html, /const BUILD = "2026-09-24d"/);
    assert.match(html, /Has not yet arrived/);
    assert.match(html, /OT HRS/);
    assert.match(html, /Last name/);
    assert.match(html, /el\.multiple=!forced/);
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

  it("does not let a stale daily snapshot drop OT, times, or report order", () => {
    const ctx = loadRosterFns();
    const incoming = {
      date: "2026-09-17",
      extra: ["e1250"],
      rows: { e1250: { s: "Present", r: "", site: "TAWASON" } },
      omit: [],
      order: ["e1250"],
    };
    const local = {
      date: "2026-09-17",
      extra: ["e1250", "e1400"],
      rows: {
        e1250: { s: "Present", r: "", site: "TAWASON", ot: 2.5, in: "7:30 AM", out: "6:00 PM" },
        e1400: { s: "Has not yet arrived", r: "", site: "CTU BARILI", ot: 1 },
      },
      omit: [],
      order: ["e1400", "e1250"],
      siteOrder: ["CTU BARILI", "TAWASON"],
    };
    const next = ctx.mergeIncomingDoc("daily", incoming, local);
    assert.equal(next.rows.e1250.ot, 2.5);
    assert.equal(next.rows.e1250.in, "7:30 AM");
    assert.equal(next.rows.e1250.out, "6:00 PM");
    assert.equal(next.rows.e1400.ot, 1);
    assert.equal(next.rows.e1400.s, "Has not yet arrived");
    assert.equal(JSON.stringify(next.order), JSON.stringify(["e1250", "e1400"]));
    assert.equal(JSON.stringify(next.siteOrder), JSON.stringify(["CTU BARILI", "TAWASON"]));
  });

  it("keeps saved people in Drive / payroll OT layout after save and on the next day", () => {
    const ctx = loadRosterFns();
    ctx.S.employees = {
      e1250: { id: "e1250", empNo: "1250", name: "Armenio, Toribio D.", status: "Regular", project: "ADMINS" },
      e1400: { id: "e1400", empNo: "1400", name: "Nuevo, Ana", status: "Probationary", project: "ADMINS" },
      e1353: { id: "e1353", empNo: "1353", name: "Pedrano, Jaica M.", status: "Regular", project: "ADMINS" },
    };
    ctx.atWork = () => [ctx.S.employees.e1250, ctx.S.employees.e1400, ctx.S.employees.e1353];
    const monday = {
      id: "d20260916",
      date: "2026-09-16",
      extra: ["e1400"],
      omit: [],
      order: ["e1400", "e1353", "e1250"],
      siteOrder: ["CTU BARILI", "TAWASON", "ADMINS"],
      rows: {
        e1400: { s: "Present", r: "", site: "CTU BARILI", ot: 3 },
        e1353: { s: "Present", r: "", site: "TAWASON", ot: 1.5 },
        e1250: { s: "Has not yet arrived", r: "", site: "ADMINS", ot: null },
      },
    };
    ctx.persistRosterOnDay(monday);
    ctx.S.daily.d20260916 = monday;
    ctx.FIRST_ADDED = null;
    ctx.LAST_SITE_IX = null;
    assert.equal(JSON.stringify(monday.order), JSON.stringify(["e1400", "e1353", "e1250"]));
    assert.equal(monday.rows.e1400.ot, 3);
    assert.equal(monday.rows.e1353.ot, 1.5);

    const tue = { date: "2026-09-17", rows: {}, extra: [], omit: [] };
    const people = ctx.dailyPeople(tue);
    assert.equal(JSON.stringify(people.map((e) => e.id)), JSON.stringify(["e1400", "e1353", "e1250"]));
    ctx.persistRosterOnDay(tue);
    assert.equal(tue.rows.e1400.site, "CTU BARILI");
    assert.equal(JSON.stringify(tue.order), JSON.stringify(["e1400", "e1353", "e1250"]));
  });

  it("splits Drive-style last / first names and matches e-sig JPEGs by filename", () => {
    const ctx = loadRosterFns();
    ctx.S.settings = {
      hrStaff: "Maria Trina Cassandra A. Moran",
      hrHead: "Jeffrey James Corro",
    };
    ctx.S.employees = {
      e1250: { id: "e1250", empNo: "1250", name: "Armenio, Toribio D." },
      e1353: { id: "e1353", empNo: "1353", name: "Pedrano, Jaica M." },
    };
    const nf = ctx.nameLastFirst("Armenio, Toribio D.");
    assert.equal(nf.last, "Armenio");
    assert.equal(nf.first, "Toribio D.");
    assert.equal(ctx.matchHrSigFilename("cassie.jpg").slot, "cassie");
    assert.equal(ctx.matchHrSigFilename("prepared-by.jpeg").slot, "prepared");
    assert.equal(ctx.matchHrSigFilename("Moran.JPG").slot, "cassie");
    assert.equal(ctx.matchHrSigFilename("approved.jpg").slot, "approved");
    assert.equal(ctx.matchHrSigFilename("hr-head.jpg").slot, "approved");
    assert.equal(ctx.matchHrSigFilename("Corro.jpg").slot, "approved");
    const empHit = ctx.matchHrSigFilename("1250-Armenio.jpg");
    assert.equal(empHit.emp && empHit.emp.id, "e1250");
    const lastHit = ctx.matchHrSigFilename("Pedrano.jpeg");
    assert.equal(lastHit.emp && lastHit.emp.id, "e1353");
  });

  it("treats Has not yet arrived as its own unpaid, non-absent status", () => {
    const ctx = loadRosterFns();
    assert.equal(ctx.STATUS_PENDING, "Has not yet arrived");
    assert.equal(ctx.normStatus("Has not yet arrived"), "Has not yet arrived");
    assert.equal(ctx.normStatus("Not yet arrived"), "Has not yet arrived");
    assert.equal(ctx.normStatus("not yet in"), "Has not yet arrived");
    assert.equal(ctx.normStatus("NYA"), "Has not yet arrived");
    assert.equal(ctx.dayCredit({ s: "Has not yet arrived" }), 0);
    assert.equal(ctx.dayCredit({ s: ctx.STATUS_PENDING }), 0);
    assert.equal(ctx.dayCredit({ s: "Present" }), 1);
    assert.equal(ctx.dayCredit({ s: "Absent" }), 0);
    assert.match(html, /const STATUS_PENDING = "Has not yet arrived"/);
    assert.match(html, /"Has not yet arrived"/);
    assert.match(html, /DAY_STATUS = \["Present","Has not yet arrived"/);
    assert.doesNotMatch(html, /DAY_STATUS = \[[^\]]*"Not yet arrived"/);
    assert.match(html, /if\(st===STATUS_PENDING\) return 0/);
    assert.match(html, /else if\(r===STATUS_PENDING\) t\.pending\+\+/);
    assert.match(html, /t\.pending\?tile\(t\.pending,STATUS_PENDING,"still to be settled before this day is filed","warn"\)/);
  });

  it("adds bulk rest and pending buttons that only change selects until Save", () => {
    assert.match(html, /id="dm-allrest"/);
    assert.match(html, /id="dm-allpending"/);
    const rest = html.slice(html.indexOf('const dar=$("#dm-allrest"'));
    const restBlock = rest.slice(0, rest.indexOf("const dpen="));
    const pending = html.slice(html.indexOf('const dpen=$("#dm-allpending"'));
    const pendingBlock = pending.slice(0, pending.indexOf("/* Write it down"));
    assert.match(restBlock, /sel\.value="Rest Day"/);
    assert.match(restBlock, /askConfirm/);
    assert.match(html, /Mark all Rest day/);
    assert.match(pendingBlock, /sel\.value=STATUS_PENDING/);
    assert.doesNotMatch(restBlock, /dailySave|dailyCollect|render\(/);
    assert.doesNotMatch(pendingBlock, /dailySave|dailyCollect|render\(/);
  });

  it("tells hosted HR that Drive being off is a site setting, not theirs", () => {
    assert.match(html, /function hostedSite\(\)/);
    assert.match(html, /function driveOffNote\(\)/);
    assert.match(html, /script\[src\*="claude-shim"\]/);
    assert.match(html, /h\+=driveOffNote\(\);/);
    assert.match(html, /Google Drive is switched off for this site/);
    assert.doesNotMatch(html, /mcp\s*:\s*true/);
    const ctx = {
      document: { querySelector: (sel) => (String(sel).includes("claude-shim") ? { src: "/claude-shim.js" } : null) },
    };
    vm.runInNewContext(extractFunction(html, "hostedSite") + "\n" + extractFunction(html, "driveOffNote"), ctx);
    assert.equal(ctx.hostedSite(), true);
    assert.match(ctx.driveOffNote(), /Google Drive is switched off for this site/);
    assert.match(ctx.driveOffNote(), /not something you can fix/);
    ctx.document.querySelector = () => null;
    assert.equal(ctx.hostedSite(), false);
    assert.match(ctx.driveOffNote(), /Google Drive is not connected in this browser/);
    const driveMsg = extractFunction(html, "driveMessage");
    const msgCtx = { hostedSite: () => true };
    vm.runInNewContext(driveMsg, msgCtx);
    assert.match(
      msgCtx.driveMessage({ code: "capability_disabled" }),
      /Google Drive is switched off for this site/
    );
    msgCtx.hostedSite = () => false;
    assert.equal(
      msgCtx.driveMessage({ code: "not_granted" }),
      "Uploading is not available in this view. Open the folder in Drive and drag the file in instead."
    );
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
      ctx.empSeparatedAsOf({ id: "a", empNo: "1243", status: "" }, "2026-09-16"),
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
      e1243: { id: "e1243", empNo: "1243", name: "Adolfo", status: "" },
      e1250: { id: "e1250", empNo: "1250", name: "Armenio", status: "Regular" },
    };
    const list = ctx.dailyPeople({ date: "2026-09-16", rows: {}, extra: [], omit: [] });
    assert.ok(!list.some((e) => e.id === "e1243"));
    assert.ok(list.some((e) => e.id === "e1250"));
  });

  it("lets a 201 Project-based status for Ben Pasion stick over the stale apply-list", () => {
    const ctx = loadRosterFns();
    ctx.KNOWN_SEP = {
      1351: { separatedOn: "2026-09-02", separationReason: "Duplicate record" },
      1243: { separatedOn: "", separationReason: "" },
    };
    const ben = {
      id: "e1351",
      empNo: "1351",
      name: "Pasion, Ben",
      status: "Project-based",
      project: "Balaga",
      position: "Mason",
    };
    assert.equal(ctx.empStatusIsLive(ben), true);
    assert.equal(ctx.sepRosterWouldApply(ben), false);
    assert.equal(ctx.empSeparatedAsOf(ben, "2026-09-18"), false);
    assert.equal(ctx.sepRosterWouldApply({ id: "e1243", empNo: "1243", status: "" }), true);
    assert.equal(ctx.sepRosterWouldApply({ id: "e1243", empNo: "1243", status: "Regular" }), false);
    assert.equal(ctx.sepRosterWouldApply({ id: "e1351", empNo: "1351", status: "Separated" }), false);

    const incoming = {
      id: "e1351",
      empNo: "1351",
      name: "Pasion, Ben",
      status: "Project-based",
      project: "Balaga",
    };
    const local = {
      id: "e1351",
      empNo: "1351",
      name: "Pasion, Ben",
      status: "Separated",
      separatedOn: "2026-09-02",
    };
    const next = ctx.mergeIncomingDoc("employees", incoming, local);
    assert.equal(next.status, "Project-based");

    const flipped = ctx.mergeIncomingDoc(
      "employees",
      {
        id: "e1351",
        empNo: "1351",
        name: "Pasion, Ben",
        status: "Separated",
        separatedOn: "2026-09-02",
        separationReason: "Duplicate record",
        statusBasis: "Applied from the 2026-09-16 separated roster",
      },
      {
        id: "e1351",
        empNo: "1351",
        name: "Pasion, Ben",
        status: "Project-based",
        project: "Balaga",
        statusBasis: "Set on the 201 file",
      }
    );
    assert.equal(flipped.status, "Project-based");
    assert.equal(flipped.statusBasis, "Set on the 201 file");

    const definite = {
      id: "e1351",
      empNo: "1351",
      name: "Pasion, Ben",
      status: "Project-based with a definite period",
      project: "Balaga",
    };
    assert.equal(ctx.empStatusIsLive(definite), true);
    assert.equal(ctx.sepRosterWouldApply(definite), false);
    assert.equal(ctx.empSeparatedAsOf(definite, "2026-09-24"), false);
    assert.equal(
      ctx.employeeLiveBeatsSeparatedSnap(definite, {
        status: "Separated",
        statusBasis: "Applied from the 2026-09-16 separated roster",
      }),
      true
    );
    assert.equal(
      ctx.employeeLiveBeatsSeparatedSnap(ben, {
        status: "Separated",
        statusBasis: "Marked separated on the Daily Manpower screen",
      }),
      false
    );
    const marked = ctx.mergeIncomingDoc(
      "employees",
      {
        id: "e1351",
        status: "Separated",
        separatedOn: "2026-09-24",
        statusBasis: "Marked separated on the Daily Manpower screen",
      },
      ben
    );
    assert.equal(marked.status, "Separated");

    ctx.S.employees = {
      e1351: ben,
      e1243: { id: "e1243", empNo: "1243", name: "Adolfo", status: "Separated" },
      e1250: { id: "e1250", empNo: "1250", name: "Armenio", status: "Regular" },
    };
    const list = ctx.dailyPeople({ date: "2026-09-18", rows: {}, extra: [], omit: [] });
    assert.ok(list.some((e) => e.id === "e1351"), "project-based Ben stays on Daily Manpower");
    ctx.S.employees.e1351 = definite;
    const definiteDay = ctx.dailyPeople({ date: "2026-09-24", rows: {}, extra: [], omit: [] });
    assert.ok(
      definiteDay.some((e) => e.id === "e1351"),
      "project-based with a definite period stays on Daily Manpower"
    );
    assert.ok(!list.some((e) => e.id === "e1243"), "true Separated stay off the list");
    assert.ok(list.some((e) => e.id === "e1250"));
  });

  it("keeps resigned and separated names off today's open monitoring list", () => {
    const ctx = loadRosterFns();
    ctx.S.employees = {
      e1250: { id: "e1250", empNo: "1250", name: "Armenio", status: "Regular", project: "ADMINS" },
      e1243: { id: "e1243", empNo: "1243", name: "Adolfo", status: "Separated", separatedOn: "2026-08-31" },
      eRes: { id: "eRes", empNo: "1260", name: "Canoy", status: "Resigned", separatedOn: "2026-08-01" },
      eLow: { id: "eLow", empNo: "1261", name: "Capuno", status: "separated" },
      eAwol: { id: "eAwol", empNo: "1262", name: "Coja", status: "AWOL" },
      e1351: { id: "e1351", empNo: "1351", name: "Pasion, Ben", status: "Project-based", project: "Balaga" },
    };
    assert.equal(ctx.empStatusIsSeparated({ status: "separated" }), true);
    assert.equal(ctx.empStatusIsSeparated({ status: "RESIGNED" }), true);
    assert.equal(ctx.empStatusIsSeparated({ status: "Terminated" }), true);
    assert.equal(ctx.empStatusIsSeparated({ status: "Regular" }), false);
    assert.equal(ctx.dayIsOpen({ date: "2026-09-16" }), true);
    assert.equal(ctx.dayIsOpen({ date: "2026-09-15" }), false);

    const snap = {
      date: "2026-09-16",
      rows: {
        e1250: { s: "Present", site: "ADMINS" },
        e1243: { s: "Present", site: "ADMINS" },
        eRes: { s: "Present", site: "ADMINS" },
        eLow: { s: "Present", site: "ADMINS" },
        eAwol: { s: "Present", site: "ADMINS" },
        e1351: { s: "Present", site: "Balaga" },
      },
      extra: ["e1250", "e1243", "eRes", "eLow", "eAwol", "e1351"],
      omit: [],
    };
    const today = ctx.dailyPeople(snap);
    assert.ok(today.some((e) => e.id === "e1250"));
    assert.ok(today.some((e) => e.id === "e1351"), "live Project-based stays");
    assert.ok(!today.some((e) => e.id === "e1243"));
    assert.ok(!today.some((e) => e.id === "eRes"));
    assert.ok(!today.some((e) => e.id === "eLow"));
    assert.ok(!today.some((e) => e.id === "eAwol"));

    const past = {
      date: "2026-09-15",
      rows: snap.rows,
      extra: snap.extra.slice(),
      omit: [],
    };
    const filed = ctx.dailyPeople(past);
    assert.ok(filed.some((e) => e.id === "e1243"), "past saved day keeps the leaver");
    assert.ok(filed.some((e) => e.id === "eRes"));

    ctx.S.daily.d20260915 = {
      id: "d20260915",
      date: "2026-09-15",
      rows: snap.rows,
      extra: snap.extra.slice(),
    };
    ctx.FIRST_ADDED = null;
    const blank = ctx.dailyPeople({ date: "2026-09-16", rows: {}, extra: [], omit: [] });
    assert.ok(blank.some((e) => e.id === "e1250"));
    assert.ok(!blank.some((e) => e.id === "e1243"), "yesterday's snapshot does not fill today's blank sheet");
    assert.ok(!blank.some((e) => e.id === "eRes"));

    const callback = ctx.dailyPeople({
      date: "2026-09-16",
      rows: { e1243: { s: "Present", site: "ADMINS" } },
      extra: ["e1243"],
      callback: ["e1243"],
      omit: [],
    });
    assert.ok(callback.some((e) => e.id === "e1243"), "explicit same-day callback stays");

    const open = {
      id: "d20260916",
      date: "2026-09-16",
      rows: {
        e1250: { s: "Present", site: "ADMINS", ot: 1 },
        e1243: { s: "Present", site: "ADMINS" },
        eRes: { s: "Present", site: "TAWASON" },
      },
      extra: ["e1250", "e1243", "eRes"],
      order: ["e1243", "e1250", "eRes"],
      omit: [],
    };
    assert.equal(ctx.stripOpenDayLeavers(open), true);
    assert.ok(!open.rows.e1243);
    assert.ok(!open.rows.eRes);
    assert.equal(open.rows.e1250.ot, 1);
    assert.ok(!open.extra.includes("e1243"));
    assert.ok(open.extra.includes("e1250"));
    ctx.persistRosterOnDay(open);
    assert.ok(!open.rows.e1243);
    assert.ok(open.rows.e1250);
    assert.ok(!open.extra.includes("eRes"));

    const merged = ctx.mergeIncomingDoc(
      "daily",
      {
        date: "2026-09-16",
        extra: ["e1243", "e1250"],
        rows: { e1243: { s: "Present" }, e1250: { s: "Present", ot: 2 } },
        omit: [],
      },
      { date: "2026-09-16", extra: ["eRes"], rows: { eRes: { s: "Present", site: "ADMINS" } }, omit: [] }
    );
    assert.ok(!merged.extra.includes("e1243"));
    assert.ok(!merged.extra.includes("eRes"));
    assert.ok(merged.extra.includes("e1250"));
    assert.equal(merged.rows.e1250.ot, 2);
    assert.equal(merged.rows.e1243, undefined);
    assert.equal(merged.rows.eRes, undefined);

    const pastMerge = ctx.mergeIncomingDoc(
      "daily",
      { date: "2026-09-10", extra: ["e1243"], rows: { e1243: { s: "Present", site: "A" } }, omit: [] },
      { date: "2026-09-10", extra: [], rows: {}, omit: [] }
    );
    assert.equal(pastMerge.rows.e1243.s, "Present");
    assert.ok(pastMerge.extra.includes("e1243"));

    const kept = ctx.mergeIncomingDoc(
      "employees",
      { id: "e1243", empNo: "1243", status: "Regular" },
      {
        id: "e1243",
        empNo: "1243",
        status: "Separated",
        separatedOn: "2026-08-31",
        statusBasis: "Marked separated on the Daily Manpower screen",
      }
    );
    assert.equal(kept.status, "Separated");
    assert.equal(kept.separatedOn, "2026-08-31");
  });

  it("shows master position titles and defaults a blank day status to Present", () => {
    const ctx = loadRosterFns();
    ctx.S.roles = { ro1: { id: "ro1", title: "Office Engineer" } };
    assert.equal(ctx.empPosition({ position: "MASON" }), "MASON");
    assert.equal(ctx.empPosition({ jobTitle: "DRIVER" }), "DRIVER");
    assert.equal(ctx.empPosition({ roleId: "ro1" }), "Office Engineer");
    assert.equal(ctx.empPosition({ position: "", jobTitle: "" }), "");
    assert.equal(ctx.dayStatusOf({ s: "" }), "Present");
    assert.equal(ctx.dayStatusOf({}), "Present");
    assert.equal(ctx.dayStatusOf({ s: "Has not yet arrived" }), "Has not yet arrived");
    assert.match(html, /function empPosition/);
    assert.match(html, /function dayStatusOf/);
    assert.match(html, /function fillBlankPositionsFromMaster/);
    assert.match(html, /esc\(empPosition\(e\)\|\|"—"\)/);
    assert.match(html, /s:sel\.value\|\|"Present"/);
    assert.match(html, /if\(!next\.s\) next\.s="Present"/);

    ctx.S.employees = {
      e1351: { id: "e1351", empNo: "1351", name: "Pasion, Ben", status: "Project-based", project: "Balaga" },
    };
    const rec = { date: "2026-09-18", rows: { e1351: { s: "", r: "", site: "Balaga" } }, extra: ["e1351"], omit: [] };
    ctx.persistRosterOnDay(rec);
    assert.equal(rec.rows.e1351.s, "Present");
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
