"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  MIN_WRITE_BUILD,
  UNNUMBERED_ISSUED_KEY,
  clampClientCounter,
  createRecordState,
  gateWrite,
  issueIntoRecords,
  mergeAppConfig,
  planRestore,
  visibleHolds,
} = require("../netlify/lib/vrf-issue");
const { slimDocData } = require("../netlify/lib/supabase");

const BUILD = "2026-10-06 a";

function line(cat, qty, price) {
  return { cat, item: cat, qty, price };
}

function reserve(no, vrf, extra) {
  return Object.assign(
    {
      no: String(no),
      vrfNo: String(vrf),
      vrfs: [String(vrf)],
      date: "2026-10-05",
      status: "Requested",
      veh: "SV-12",
      draftLines: [line("Oil", 1, 100)],
      draftPurpose: "job",
    },
    extra || {}
  );
}

function livePair() {
  return [
    reserve(101, 6112, {
      veh: "BH-06",
      createdAt: "2026-10-05T13:39:00+08:00",
      draftPurpose: "Fuel",
      draftLines: [line("Fuel — Diesel", 100, 88.5)],
      budget: 8850,
    }),
    reserve(102, 6113, {
      veh: "DT-04",
      createdAt: "2026-10-05T13:49:00+08:00",
      draftPurpose: "Hauling",
      draftLines: [line("Fuel — Diesel", 60, 88.5)],
      budget: 5310,
      printedAt: "2026-10-05T13:53:00+08:00",
      status: "Approved",
    }),
    reserve(103, 6112, {
      veh: "DT-07",
      createdAt: "2026-10-05T13:58:00+08:00",
      submissionId: "sub-newer-103",
      draftPurpose: "Brake",
      draftLines: [line("Brake", 1, 6050)],
      budget: 6050,
      printedAt: "2026-10-05T13:58:00+08:00",
      status: "Approved",
    }),
    reserve(104, 6113, {
      veh: "SV-12",
      createdAt: "2026-10-05T16:26:00+08:00",
      submissionId: "sub-muuzkg79",
      draftPurpose: "Change oil / PMS",
      draftLines: [line("Oil Filter", 1, 985), line("Fuel Filter", 1, 1650), line("Engine oil", 6, 204)],
      budget: 3859,
      printedAt: "2026-10-05T16:44:00+08:00",
      status: "Approved",
      preparedSig: "data:image/png;base64," + "A".repeat(200),
    }),
    reserve(26, 6116, { veh: "MC-16", date: "2026-10-04", draftLines: [line("Belt", 1, 500)] }),
  ];
}

describe("per-record numbering", () => {
  it("gives two devices two numbers and keeps both rows", async () => {
    const state = createRecordState({
      reserves: [reserve(26, 6116, { veh: "MC-16" })],
      app: { nextVrf: 6117, nextReserve: 105, orphanSignature: "keep-me" },
    });
    const draft = (who, veh) => ({
      status: "Requested",
      date: "2026-10-06",
      veh,
      work: "REP",
      budget: 100,
      draftPurpose: who,
      draftLines: [line("Belt", 1, 100)],
      requestedBy: who,
      no: "104",
      vrfNo: "6113",
    });
    const [a, b] = await Promise.all([
      issueIntoRecords(state, { kind: "issue", build: BUILD, reserve: draft("AAA", "SV-99") }),
      issueIntoRecords(state, { kind: "issue", build: BUILD, reserve: draft("BBB", "DT-09") }),
    ]);
    assert.notEqual(a.vrfNo, b.vrfNo);
    assert.notEqual(a.reserveNo, b.reserveNo);
    assert.notEqual(a.vrfNo, "6113");
    assert.notEqual(b.vrfNo, "6113");
    const rows = Object.values(state.records).filter((rec) => rec.kind === "reserve");
    assert.equal(rows.length, 3);
    assert.equal(rows.filter((rec) => rec.vrf_no === "6116").length, 1);
    assert.equal(state.app.orphanSignature, "keep-me");
  });

  it("rejects a stale build before it can change a number or drop a row", async () => {
    const state = createRecordState({
      reserves: [reserve(102, 6113, { veh: "DT-04" })],
      app: { nextVrf: 6117, nextReserve: 105 },
    });
    const before = JSON.stringify(state.records);
    await assert.rejects(
      () =>
        issueIntoRecords(state, {
          kind: "issue",
          build: "2026-10-05 b",
          reserve: reserve(102, 1, { veh: "WIPED", vrfNo: "1" }),
        }),
      (err) => err && err.message === "Reload the page" && err.statusCode === 409
    );
    await assert.rejects(
      () => issueIntoRecords(state, { kind: "reserve", build: "", reserve: { no: "102", vrfNo: "1", veh: "WIPED" } }),
      (err) => err && err.statusCode === 409
    );
    assert.equal(JSON.stringify(state.records), before);
    assert.equal(state.records["reserve:102"].vrf_no, "6113");
    assert.equal(gateWrite({ op: "set", collection: "config", build: "2026-10-05 b" }).code, "stale_client");
    assert.equal(gateWrite({ op: "merge", build: MIN_WRITE_BUILD }), null);
    assert.equal(gateWrite({ op: "get", collection: "reserves", build: "" }), null);
    const patched = await issueIntoRecords(state, {
      kind: "reserve",
      build: BUILD,
      reserve: { no: "102", vrfNo: "9999", veh: "DT-04", status: "Approved", draftPurpose: "still hauling" },
    });
    assert.equal(patched.vrfNo, "6113");
    assert.equal(state.records["reserve:102"].data.vrfNo, "6113");
    assert.equal(state.records["reserve:102"].data.draftPurpose, "still hauling");
    assert.equal(Object.keys(state.records).length, 1);
  });

  it("ignores a lower nextVrf and keeps orphanSignature", () => {
    assert.equal(clampClientCounter(6117, 6100), 6117);
    assert.equal(clampClientCounter(6117, 6200), 6117);
    const merged = mergeAppConfig(
      { nextVrf: 6117, nextReserve: 105, orphanSignature: "keep-me", pass: "secret" },
      { nextVrf: 6100, nextReserve: 1 }
    );
    assert.equal(merged.nextVrf, 6117);
    assert.equal(merged.orphanSignature, "keep-me");
    assert.equal(merged.pass, "secret");
    assert.equal(merged.nextReserve, 1);
  });

  it("shows both printed copies and renumbers the newer reserve", () => {
    const issued = {
      numbers: {
        6112: { no: "6112", sealed: true, snapshot: { reserve: { no: "101" }, rows: [{ vrf: "6112" }] } },
        6113: { no: "6113", sealed: true, snapshot: { reserve: { no: "102" }, rows: [{ vrf: "6113" }] } },
        [UNNUMBERED_ISSUED_KEY]: {
          no: UNNUMBERED_ISSUED_KEY,
          sealed: true,
          reason: "printed",
          at: "2026-10-06T09:03:00+08:00",
          snapshot: {
            rows: [{ cat: "Oil", item: "Oil", qty: 1, price: 4148, veh: "BT-02", work: "Change oil", odo: 166742, notes: "CTU Barili" }],
            reserve: { veh: "BT-02", project: "CTU Barili Dormitory P2", date: "2026-10-06", requestedBy: "Sophie V. Batas", draftLines: [] },
          },
        },
      },
    };
    const plan = planRestore({
      reserves: livePair(),
      ledger: [],
      issued,
      app: { nextVrf: 6117, nextReserve: 105, orphanSignature: "keep-me" },
    });
    const byNo = {};
    plan.reserves.forEach((row) => {
      byNo[String(row.no)] = row;
    });
    assert.equal(byNo["102"].vrfNo, "6113");
    assert.equal(byNo["101"].vrfNo, "6112");
    assert.equal(byNo["104"].vrfNo, "6117");
    assert.equal(byNo["103"].vrfNo, "6118");
    assert.equal(
      byNo["104"].renumberNote,
      "Printed as VRF 6113 on 10/5. Now VRF 6117. Please re-mark the paper copy."
    );
    assert.equal(
      byNo["103"].renumberNote,
      "Printed as VRF 6112 on 10/5. Now VRF 6118. Please re-mark the paper copy."
    );
    assert.equal(byNo["104"].preparedSig, undefined);
    assert.equal(plan.app.nextVrf, 6119);
    assert.equal(plan.app.orphanSignature, "keep-me");
    assert.equal(plan.issued.numbers["6113"].no, "6113");
    assert.equal(plan.issued.numbers["6112"].no, "6112");
    assert.ok(plan.issued.numbers["6113@102"]);
    assert.ok(plan.issued.numbers["6113@104"]);
    assert.ok(plan.issued.numbers["6117@104"]);
    assert.ok(plan.issued.numbers["6112@101"]);
    assert.ok(plan.issued.numbers["6112@103"]);
    assert.equal(byNo["paper-6033"].vrfNo, "6033");
    assert.equal(plan.ledger.some((row) => String(row.vrf) === "6033"), true);
    assert.equal(plan.draft.submissionId, "draft-unnumbered-bt02");
    assert.equal(plan.draft.veh, "BT-02");
    assert.equal(vrfSeqSafe(plan.draft.vrfNo), 0);
    const holds = visibleHolds(plan.reserves);
    const copies6113 = holds.filter((row) => row.printedAs === "6113" || row.vrf === "6113");
    assert.ok(copies6113.length >= 2);
    const sv = holds.find((row) => row.reserve === "104");
    const dt = holds.find((row) => row.reserve === "102");
    assert.ok(sv && dt);
    assert.notEqual(sv.vrf, dt.vrf);
    assert.ok(sv.total > 0);
    assert.ok(dt.total > 0);
    assert.match(sv.paperNote, /Printed as VRF 6113/);
    const draftHold = holds.find((row) => row.unnumbered);
    assert.ok(draftHold);
    assert.equal(draftHold.vrf, UNNUMBERED_ISSUED_KEY);
  });
});

function vrfSeqSafe(n) {
  const m = /^(\d+)$/.exec(String(n || "").trim());
  return m ? parseInt(m[1], 10) : 0;
}

describe("reads stay small and the SQL restore is additive", () => {
  it("strips repeated signature images from a reserve year", () => {
    const image = "data:image/png;base64," + "B".repeat(163000);
    const rows = [];
    for (let i = 0; i < 59; i++) {
      rows.push({ no: String(i + 1), vrfNo: String(6000 + i), preparedSig: image, veh: "SV-12" });
    }
    const slim = slimDocData("reserves", { year: "2026", rows });
    const bytes = Buffer.byteLength(JSON.stringify(slim));
    assert.ok(bytes < 200000, "slim year is " + bytes + " bytes");
    assert.equal(slim.rows[0].preparedSig, undefined);
    assert.equal(slim.rows[0].veh, "SV-12");
    const photo = slimDocData("photos", { data: image });
    assert.equal(photo.data, image);
  });

  it("ships one additive migration that numbers on the server", () => {
    const file = path.join(__dirname, "../supabase/migrations/20261006000001_motorpool_vrf_records.sql");
    const sql = fs.readFileSync(file, "utf8");
    assert.match(sql, /security definer/i);
    assert.match(sql, /for update/i);
    assert.match(sql, /motorpool_records_live_vrf_idx/);
    assert.match(sql, /insert into public\.motorpool_allowed_collections \(name\)\s*values \('builds'\)/i);
    assert.match(sql, /on conflict \(id\) do nothing/i);
    assert.match(sql, /Reload the page/);
    assert.match(sql, /2026-10-06 a/);
    assert.match(sql, /preparedSig/);
    assert.match(sql, /Please re-mark the paper copy/);
    assert.match(sql, /motorpool_issue_record/);
    assert.doesNotMatch(sql, /\bdrop\b/i);
    assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /var BUILD = "2026-10-08 a"/);
    assert.match(html, /paperNote/);
    assert.match(html, /S\.db\.listIds/);
    assert.match(html, /function sendUnnumberedDraft/);
    assert.match(html, /restore:true/);
    assert.match(html, /if\(!vrfSeq\(no\)\) return/);
  });
});
