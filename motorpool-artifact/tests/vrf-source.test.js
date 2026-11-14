"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { applyApproveFromHold } = require("../netlify/lib/approve-from-hold");
const { createRecordState, draftFromIssued, issueIntoRecords } = require("../netlify/lib/vrf-issue");
const {
  VRF_AUTO_APPROVE_UNDER,
  VRF_SOURCE_CHOICES,
  applyVrfAutoApproval,
  applyVrfHeaderPatch,
  headerAuditNotes,
  ledgerLineFromHoldRow,
  vrfSourceLabel,
} = require("./lib/rules");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const BUILD = "2026-11-13 a";

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

function loadPageFns(names) {
  const ctx = {};
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function hold(extra) {
  return Object.assign(
    {
      no: "20",
      vrfNo: "7101",
      date: "2026-11-03",
      status: "Requested",
      veh: "DT-09",
      work: "REP",
      budget: 1500,
      requestedBy: "Ana",
      draftPurpose: "belt",
      draftOdo: "11000",
      draftLines: [{ cat: "Belt", item: "Belt", qty: 1, price: 1500, unit: "pc", work: "REP" }],
    },
    extra || {}
  );
}

describe("VRF source", () => {
  it("is build 2026-11-13 a", () => {
    assert.match(html, /var BUILD = "2026-11-13 a"/);
    assert.equal(BUILD, "2026-11-13 a");
  });

  it("labels LRF · LRF-0010 and stays blank when nothing was set", () => {
    assert.deepEqual(VRF_SOURCE_CHOICES, ["Motor Pool", "PSRF", "LRF"]);
    assert.equal(vrfSourceLabel({ source: "LRF", sourceNo: "LRF-0010" }), "Source: LRF · LRF-0010");
    assert.equal(vrfSourceLabel({ source: "lrf", sourceNo: " LRF-0010 " }), "Source: LRF · LRF-0010");
    assert.equal(vrfSourceLabel({ source: "Motor Pool" }), "Source: Motor Pool");
    assert.equal(vrfSourceLabel({ source: "motorpool", sourceNo: "MP-4" }), "Source: Motor Pool · MP-4");
    assert.equal(vrfSourceLabel({ sourceNo: "PSRF-22" }), "Source: PSRF-22");
    assert.equal(vrfSourceLabel({}), "");
    assert.equal(vrfSourceLabel({ source: "", sourceNo: "" }), "");
    assert.equal(vrfSourceLabel({ vrf: "5864", veh: "MC-14", rows: [{ vrf: "5864", item: "Fuel" }] }), "");
    assert.equal(
      vrfSourceLabel({ rows: [{ source: "PSRF", sourceNo: "PSRF-9" }] }),
      "Source: PSRF · PSRF-9"
    );
  });

  it("logs who changed source and source no, and leaves amounts alone", () => {
    const before = {
      veh: "SV-09",
      project: "",
      date: "2026-09-25",
      odo: "204707",
      requestedBy: "Sophie Batas",
      purpose: "Fuel reserve dispense",
      work: "FUEL-RES",
      source: "",
      sourceNo: "",
    };
    const patch = Object.assign({}, before, { source: "LRF", sourceNo: "LRF-0010" });
    const notes = headerAuditNotes(before, patch, "Sophie Batas", "2026-11-03");
    assert.equal(notes.length, 2);
    assert.deepEqual(notes[0], {
      at: "2026-11-03",
      by: "Sophie Batas",
      field: "source",
      from: "",
      to: "LRF",
    });
    assert.deepEqual(notes[1], {
      at: "2026-11-03",
      by: "Sophie Batas",
      field: "source no",
      from: "",
      to: "LRF-0010",
    });
    assert.equal(headerAuditNotes(before, before, "Sophie Batas", "2026-11-03").length, 0);
    assert.equal(
      headerAuditNotes(
        { source: "lrf", sourceNo: "LRF-0010" },
        { source: "LRF", sourceNo: "LRF-0010" },
        "Sophie Batas",
        "2026-11-03"
      ).length,
      0
    );

    const row = {
      vrf: "5864",
      veh: "SV-09",
      qty: 1,
      price: 150.11,
      total: 150.11,
      vstatus: "Closed",
      liq: { at: "2026-09-28", outcome: "bought" },
      supplier: "Iced Petron",
    };
    const patched = applyVrfHeaderPatch([row], patch, notes);
    assert.equal(patched[0].source, "LRF");
    assert.equal(patched[0].sourceNo, "LRF-0010");
    assert.equal(patched[0].qty, 1);
    assert.equal(patched[0].price, 150.11);
    assert.equal(patched[0].total, 150.11);
    assert.equal(patched[0].vstatus, "Closed");
    assert.deepEqual(patched[0].liq, row.liq);
    assert.equal(patched[0].audit.length, 2);

    const cleared = applyVrfHeaderPatch(patched, Object.assign({}, patch, { source: "", sourceNo: "" }), []);
    assert.equal(Object.prototype.hasOwnProperty.call(cleared[0], "source"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(cleared[0], "sourceNo"), false);
    assert.equal(cleared[0].total, 150.11);
    assert.equal(cleared[0].vstatus, "Closed");
  });

  it("does not change the under-1000 auto-approve rule", () => {
    assert.equal(VRF_AUTO_APPROVE_UNDER, 1000);
    const queued = { status: "Requested" };
    assert.equal(applyVrfAutoApproval(queued, 1500, "2026-11-03"), false);
    assert.equal(queued.status, "Requested");
  });

  it("copies source onto posted lines and issued rows, and leaves older holds without it", () => {
    const withSource = hold({ source: "LRF", sourceNo: "LRF-0010" });
    const posted = applyApproveFromHold(
      { ledgerRows: [], reserves: [withSource], vehicles: [], parts: [] },
      withSource,
      { approvedBy: "Jeffrey", now: "2026-11-03" }
    );
    assert.equal(posted.rows[0].source, "LRF");
    assert.equal(posted.rows[0].sourceNo, "LRF-0010");
    assert.equal(posted.rows[0].qty, 1);
    assert.equal(posted.rows[0].price, 1500);
    assert.equal(posted.rows[0].total, 1500);
    assert.equal(posted.rows[0].vstatus, "Open");
    assert.equal(posted.hold.status, "Approved");
    assert.equal(posted.hold.source, "LRF");
    assert.equal(posted.hold.sourceNo, "LRF-0010");

    const older = hold({ vrfNo: "7102", no: "21" });
    const plain = applyApproveFromHold(
      { ledgerRows: [], reserves: [older], vehicles: [], parts: [] },
      older,
      { approvedBy: "Jeffrey", now: "2026-11-03" }
    );
    assert.equal(Object.prototype.hasOwnProperty.call(plain.rows[0], "source"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(plain.rows[0], "sourceNo"), false);
    assert.equal(plain.rows[0].total, 1500);
    assert.equal(plain.hold.status, "Approved");

    const line = ledgerLineFromHoldRow(
      { vrf: "7101", veh: "DT-09", source: "PSRF", sourceNo: "PSRF-3", date: "2026-11-03" },
      { cat: "Belt", item: "Belt", qty: 1, price: 1500 },
      "2026-11-03"
    );
    assert.equal(line.source, "PSRF");
    assert.equal(line.sourceNo, "PSRF-3");
    assert.equal(line.total, 1500);
    const bare = ledgerLineFromHoldRow(
      { vrf: "7102", veh: "DT-09", date: "2026-11-03" },
      { cat: "Belt", item: "Belt", qty: 1, price: 1500 },
      "2026-11-03"
    );
    assert.equal(Object.prototype.hasOwnProperty.call(bare, "source"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(bare, "sourceNo"), false);

    const redraft = draftFromIssued({
      at: "2026-11-03",
      snapshot: {
        reserve: { source: "Motor Pool", sourceNo: "MP-2", draftPurpose: "oil", veh: "DT-09" },
        rows: [{ vrf: "7101", veh: "DT-09" }],
      },
    });
    assert.equal(redraft.source, "Motor Pool");
    assert.equal(redraft.sourceNo, "MP-2");
    const oldDraft = draftFromIssued({
      snapshot: { reserve: { veh: "DT-09", draftPurpose: "oil" }, rows: [{ veh: "DT-09" }] },
    });
    assert.equal(Object.prototype.hasOwnProperty.call(oldDraft, "source"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(oldDraft, "sourceNo"), false);
  });

  it("keeps source on the reserve record and does not require it to issue", async () => {
    const state = createRecordState({ app: { nextVrf: 7101, nextReserve: 30 }, reserves: [] });
    const saved = await issueIntoRecords(state, {
      build: BUILD,
      kind: "issue",
      reserve: hold({ no: "", vrfNo: "", source: "LRF", sourceNo: "LRF-0010" }),
    });
    assert.equal(saved.reserve.source, "LRF");
    assert.equal(saved.reserve.sourceNo, "LRF-0010");
    assert.equal(saved.reserve.status, "Requested");

    const plain = await issueIntoRecords(state, {
      build: BUILD,
      kind: "issue",
      reserve: hold({ no: "", vrfNo: "", vrf: undefined, draftLines: hold().draftLines }),
    });
    assert.equal(Object.prototype.hasOwnProperty.call(plain.reserve, "source"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(plain.reserve, "sourceNo"), false);
    assert.ok(plain.reserve.vrfNo);
  });
});

describe("VRF source — page", () => {
  const page = loadPageFns([
    "canonVrfSource",
    "vrfSourceNoText",
    "vrfSourceParts",
    "vrfSourceLabel",
    "vrfSourceHay",
    "vrfMatchesLogSource",
    "vrfSearchHits",
    "vrfMatchesLogTerm",
    "headerAuditNotes",
  ]);

  it("uses the same label and search on the page", () => {
    assert.equal(page.vrfSourceLabel({ source: "LRF", sourceNo: "LRF-0010" }), "Source: LRF · LRF-0010");
    assert.equal(page.vrfSourceLabel({ vrf: "6033", rows: [{ item: "Fuel" }] }), "");
    const hit = { vrf: "7101", units: ["DT-09"], project: "Yard", source: "LRF", sourceNo: "LRF-0010", rows: [] };
    const old = { vrf: "5864", units: ["MC-14"], project: "UP- She Shelter", rows: [{ item: "Fuel", supplier: "Iced Petron", cat: "Fuel — Gasoline" }] };
    assert.equal(page.vrfMatchesLogTerm(hit, "lrf-0010"), true);
    assert.equal(page.vrfMatchesLogTerm(hit, "lrf"), true);
    assert.equal(page.vrfMatchesLogTerm(old, "lrf-0010"), false);
    assert.equal(page.vrfMatchesLogTerm(old, "5864"), true);
    assert.equal(page.vrfMatchesLogTerm(old, "iced petron"), true);
    assert.equal(page.vrfMatchesLogSource(hit, "LRF"), true);
    assert.equal(page.vrfMatchesLogSource(hit, "PSRF"), false);
    assert.equal(page.vrfMatchesLogSource(old, ""), true);
    assert.equal(page.vrfMatchesLogSource(old, "Motor Pool"), false);
    const notes = page.headerAuditNotes(
      { source: "", sourceNo: "" },
      { source: "PSRF", sourceNo: "PSRF-2" },
      "Ana Cruz",
      "2026-11-03"
    );
    assert.equal(notes[0].by, "Ana Cruz");
    assert.equal(notes[0].field, "source");
    assert.equal(notes[0].from, "");
    assert.equal(notes[0].to, "PSRF");
    assert.equal(notes[1].field, "source no");
    assert.equal(notes[1].to, "PSRF-2");
  });

  it("offers source on the new form and the header edit, and prints it only when set", () => {
    assert.match(html, /var VRF_SOURCE_CHOICES=\["Motor Pool","PSRF","LRF"\]/);
    assert.match(html, /function vrfSourceSelect/);
    assert.match(html, /fld\("Source", srcSel\)/);
    assert.match(html, /fld\("Source no\.", srcNo\)/);
    assert.match(html, /e\.g\. LRF-0010/);
    assert.match(html, /Source is optional\. Leave it blank and the VRF and printout stay as they are\./);
    assert.match(html, /Shows on the VRF and the printout as /);
    assert.match(html, /copyVrfSourceFields\(hold, \{source:d\.source, sourceNo:d\.sourceNo\}\)/);
    assert.match(html, /source:canonVrfSource\(d\.source\), sourceNo:vrfSourceNoText\(d\.sourceNo\)/);

    const send = extractFunction(html, "sendForApproval");
    assert.match(send, /Put your name in/);
    assert.match(send, /copyVrfSourceFields\(hold/);
    assert.doesNotMatch(send, /Source is required|Pick a source|sourceNo is required/);

    const edit = extractFunction(html, "openVrfEdit");
    assert.match(edit, /vrfSourceSelect\(snap\.source\)/);
    assert.match(edit, /fld\("Source", srcSel\)/);
    assert.match(edit, /fld\("Source no\.", srcNoIn\)/);
    assert.match(edit, /source:srcSel\.value, sourceNo:srcNoIn\.value/);
    assert.doesNotMatch(edit, /Source is required|Pick a source/);

    const save = extractFunction(html, "saveVrfHeader");
    assert.match(save, /applyVrfSourceFields\(copy, patch\.source, patch\.sourceNo\)/);
    assert.match(save, /applyVrfSourceFields\(rsv, patch\.source, patch\.sourceNo\)/);
    assert.match(save, /copy\.qty=r\.qty; copy\.price=r\.price; copy\.total=r\.total/);
    assert.match(save, /copy\.vstatus=r\.vstatus; copy\.liq=r\.liq/);

    const may = extractFunction(html, "vrfMayEdit");
    assert.match(may, /st==="Open"\|\|st==="Requested"\|\|st==="Closed"/);
    assert.doesNotMatch(may, /source/);

    const doc = extractFunction(html, "buildVrfDoc");
    assert.match(doc, /var sourceLabel=vrfSourceLabel\(entry\)/);
    assert.match(doc, /if\(sourceLabel\)/);
    assert.match(doc, /el\("div","vsource",sourceLabel\)/);

    const open = extractFunction(html, "openVrf");
    assert.match(open, /vrfSourceLabel\(entry\)/);
    const reserve = extractFunction(html, "openReserve");
    assert.match(reserve, /vrfSourceLabel\(r\)/);

    const log = extractFunction(html, "vrfLogView");
    assert.match(log, /voucher no, LRF or PSRF no/);
    assert.match(log, /every source/);
    assert.match(log, /vrfMatchesLogSource\(v, S\.logSource\)/);
    assert.match(log, /vrfMatchesLogTerm\(v, term\)/);
    assert.match(log, /\["Motor Pool","Motor Pool"\],\["PSRF","PSRF"\],\["LRF","LRF"\]/);

    const post = extractFunction(html, "prepareReservePost");
    assert.match(post, /copyVrfSourceFields\(row, r\)/);
    assert.match(html, /source:"",sourceNo:""/);
  });
});
