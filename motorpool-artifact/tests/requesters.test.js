"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../public/requesters");
const L = require("../public/vrf-liquidation");

/* Fake roster only. The live names stay in Supabase config/requesters. */
const ROSTER = {
  names: [
    { name: "Cruz, Ana L.", empNo: "1001", status: "Active" },
    { name: "Reyes, Ben", empNo: null, status: "Active" },
    { name: "Santos, Cara M.", empNo: "1003", status: "Separated" },
    { name: "Diaz, Eva", empNo: "2002", status: "External" },
    { name: "Aquino, Zoe", empNo: "1008", status: "Active" },
  ],
  aliases: {
    ana: "Cruz, Ana L.",
    "Ana Cruz": "Cruz, Ana L.",
    "ben r.": "Reyes, Ben",
    benny: "Reyes, Ben",
  },
};

describe("requester canon()", () => {
  it("maps aliases ignoring case and extra whitespace", () => {
    assert.equal(R.canon("ana", ROSTER), "Cruz, Ana L.");
    assert.equal(R.canon("  ANA   ", ROSTER), "Cruz, Ana L.");
    assert.equal(R.canon("Ana Cruz", ROSTER), "Cruz, Ana L.");
    assert.equal(R.canon("ben r.", ROSTER), "Reyes, Ben");
    assert.equal(R.canon("  Benny ", ROSTER), "Reyes, Ben");
  });

  it("uses the roster spelling when the raw text already names that person", () => {
    assert.equal(R.canon("cruz, ana l.", ROSTER), "Cruz, Ana L.");
    assert.equal(R.canon("diaz, eva", ROSTER), "Diaz, Eva");
  });

  it("leaves an unknown single name trimmed", () => {
    assert.equal(R.canon("  Old, Name  ", ROSTER), "Old, Name");
    assert.equal(R.canon("", ROSTER), "");
    assert.equal(R.canon(null, null), "");
  });

  it("ships an empty default and does not embed a roster", () => {
    assert.deepEqual(R.normalize(null), { names: [], aliases: {} });
    assert.deepEqual(R.normalize({}), { names: [], aliases: {} });
    assert.equal(R.canon("ana", R.EMPTY), "ana");
    const src = fs.readFileSync(path.join(__dirname, "../public/requesters.js"), "utf8");
    assert.match(src, /EMPTY_ROSTER = \{ names: \[\], aliases: \{\} \}/);
    assert.doesNotMatch(src, /Cruz, Ana|Reyes, Ben|Jeffrey|Carmel|Sophie/);
  });
});

describe("requester roster select", () => {
  it("labels with the employee number and sorts A–Z", () => {
    assert.equal(R.label({ name: "Cruz, Ana L.", empNo: "1001" }), "Cruz, Ana L. (1001)");
    assert.equal(R.label({ name: "Reyes, Ben", empNo: null }), "Reyes, Ben");
    assert.equal(R.label({ name: "Reyes, Ben", empNo: "" }), "Reyes, Ben");
    const names = R.choices(ROSTER).map((p) => p.name);
    assert.deepEqual(names, ["Aquino, Zoe", "Cruz, Ana L.", "Diaz, Eva", "Reyes, Ben"]);
    assert.equal(names.indexOf("Santos, Cara M."), -1);
  });

  it("keeps a separated person only so an old record can still show them", () => {
    const kept = R.choices(ROSTER, { keep: "Santos, Cara M." }).map((p) => p.name);
    assert.ok(kept.indexOf("Santos, Cara M.") >= 0);
    assert.deepEqual(kept.slice().sort(), kept.slice().sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    const fromAlias = R.choices(ROSTER, { keep: "cara" });
    assert.equal(fromAlias.some((p) => p.name === "Santos, Cara M."), false);
  });

  it("defaults the signed-in user only when they are on the roster and not separated", () => {
    assert.equal(R.matchSignedIn("  ana ", ROSTER).name, "Cruz, Ana L.");
    assert.equal(R.matchSignedIn("Diaz, Eva", ROSTER).name, "Diaz, Eva");
    assert.equal(R.matchSignedIn("Santos, Cara M.", ROSTER), null);
    assert.equal(R.matchSignedIn("Nobody", ROSTER), null);
  });

  it("stores exactly one canonical name and employee number", () => {
    assert.deepEqual(R.storeOne("ana", ROSTER), { requestedBy: "Cruz, Ana L.", requestedByEmpNo: "1001" });
    assert.deepEqual(R.storeOne("Reyes, Ben", ROSTER), { requestedBy: "Reyes, Ben", requestedByEmpNo: null });
    assert.deepEqual(R.storeOne("", ROSTER), { requestedBy: "", requestedByEmpNo: null });
    assert.deepEqual(R.storeOne("Old, Name", ROSTER, { allow: ["Old, Name"] }), {
      requestedBy: "Old, Name",
      requestedByEmpNo: null,
    });
    assert.throws(() => R.storeOne(["Cruz, Ana L.", "Reyes, Ben"], ROSTER), /exactly one/);
    assert.throws(() => R.storeOne("Cruz, Ana L.; Reyes, Ben", ROSTER), /exactly one/);
    assert.throws(() => R.storeOne("Cruz, Ana L.\nReyes, Ben", ROSTER), /exactly one/);
    assert.throws(() => R.storeOne("Nobody", ROSTER), /roster/);
  });

  it("appends one name for an admin and refuses a duplicate", () => {
    const next = R.appendName(ROSTER, { name: "  Bautista, Lio  ", empNo: "3010", status: "active" });
    assert.equal(next.names[1].name, "Bautista, Lio");
    assert.equal(next.names[1].empNo, "3010");
    assert.equal(next.names[1].status, "Active");
    assert.equal(ROSTER.names.some((p) => p.name === "Bautista, Lio"), false);
    assert.throws(() => R.appendName(next, { name: "bautista, lio" }), /already/);
    assert.throws(() => R.appendName(next, { name: "   " }), /Surname/);
  });
});

describe("requester filter, reserves, and issued snapshots", () => {
  it("lists canonical names once, sorted A–Z, including old spellings", () => {
    const raws = ["benny", "Aquino, Zoe", "ana", "Ana Cruz", "  BENNY ", "", "Old, Name"];
    assert.deepEqual(R.dedupeNames(raws, ROSTER), ["Aquino, Zoe", "Cruz, Ana L.", "Old, Name", "Reyes, Ben"]);
  });

  it("reads a raw name off an issued snapshot, then canon() groups it", () => {
    const issued = {
      numbers: {
        "9": {
          no: "9",
          snapshot: {
            reserve: { no: "3", requestedBy: "ben r." },
            rows: [{ requestedBy: "benny" }],
          },
        },
        "9@3": {
          no: "9",
          snapshot: { reserve: { no: "3", requestedBy: "benny" }, rows: [] },
        },
        "10": {
          no: "10",
          snapshot: { reserve: { no: "4" }, rows: [{ requestedBy: "  ANA " }] },
        },
      },
    };
    assert.equal(R.nameFromIssued(issued, "9", "3"), "ben r.");
    assert.equal(R.canon(R.nameFromIssued(issued, "9", "3"), ROSTER), "Reyes, Ben");
    assert.equal(R.nameFromIssued(issued, "10", "4"), "ANA");
    assert.equal(R.canon(R.nameFromIssued(issued, "10"), ROSTER), "Cruz, Ana L.");
    assert.equal(R.nameFromIssued(issued, "", "3"), "");
  });

  it("groups reserve and snapshot spellings under one filter name", () => {
    const entries = [
      { vrf: "1", status: "Open", total: 10, approvedAt: "2026-10-01", requestedBy: "ana", rows: [] },
      { vrf: "2", status: "Open", total: 12, approvedAt: "2026-10-02", requestedBy: "", rows: [{ requestedBy: "Ana Cruz" }] },
      { vrf: "3", status: "Open", total: 8, approvedAt: "2026-10-03", requestedBy: "ben r.", rows: [] },
    ];
    const rows = L.unliquidatedRows(entries, {}, {}, {
      today: "2026-11-01",
      canon: function (raw) { return R.canon(raw, ROSTER); },
    });
    assert.deepEqual(rows.map((r) => r.requester), ["Cruz, Ana L.", "Cruz, Ana L.", "Reyes, Ben"]);
    assert.deepEqual(L.filterRows(rows, { requester: "Cruz, Ana L." }).map((r) => r.vrf), ["1", "2"]);
    assert.deepEqual(R.dedupeNames(rows.map((r) => r.requester), ROSTER), ["Cruz, Ana L.", "Reyes, Ben"]);
  });

  it("leaves liquidation rows unchanged when no canon function is passed", () => {
    const rows = L.unliquidatedRows(
      [{ vrf: "1", status: "Open", total: 10, approvedAt: "2026-10-01", requestedBy: "ana", rows: [] }],
      {},
      {},
      { today: "2026-11-01" }
    );
    assert.equal(rows[0].requester, "ana");
  });
});

describe("artifact wires the roster select", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const cancel = fs.readFileSync(path.join(__dirname, "../public/vrf-cancel.js"), "utf8");

  it("reads config/requesters, canons legacy sources, and uses one select", () => {
    assert.match(html, /<script src="\/requesters\.js"><\/script>/);
    assert.match(html, /requesters:"config\/requesters"/);
    assert.match(html, /readDoc\(PATHS\.requesters\)/);
    assert.match(html, /function canon\(/);
    assert.match(html, /return canon\(who\)/);
    assert.match(html, /nameFromIssued\(S\.issued/);
    assert.match(html, /S\.reserves/);
    assert.match(html, /sel\.multiple=false/);
    assert.match(html, /requesterSelect\(d\.requestedBy/);
    assert.match(html, /requesterSelect\(snap\.requestedBy/);
    assert.match(html, /function askCancelVrf[\s\S]*?requesterSelect\(/);
    assert.doesNotMatch(html, /rIn\.placeholder="your name"/);
    assert.match(html, /isRosterAdmin\(/);
    assert.match(html, /Add name…/);
    assert.match(html, /requestedByEmpNo/);
    assert.match(html, /canon:function\(raw\)\{ return canon\(raw\); \}/);
    assert.match(html, /var BUILD = "2026-11-24 b"/);
    assert.match(cancel, /Requesters\.canon/);
  });
});
