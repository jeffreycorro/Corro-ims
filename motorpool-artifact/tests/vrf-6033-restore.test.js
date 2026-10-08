"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  alignedNextVrf,
  holdIsSealed,
  issuedShouldRehydrate,
  matchingPaperPurchase,
  maxVrfSeq,
  mergeIssuedNumbers,
  nextFreeVrf,
  paperVrf6033,
  paperVrfRestoreBundle,
  runawayRangeOnFile,
  shouldRemintHeldVrf,
  usedVrfNumbers,
  vrfNumberTaken,
  vrfRecorded,
} = require("./lib/rules");
const {
  applyClientMerge,
  assertSiblingVrfsKept,
  mergeIssuedNumbers: mergeIssuedServer,
} = require("../netlify/lib/doc-merge");

function usedUpTo(max) {
  const used = {};
  for (let n = 5800; n <= max; n++) used[String(n)] = 1;
  return used;
}

describe("VRF 6033 stays reserved and can be written back", () => {
  it("matches the printed approved form", () => {
    const spec = paperVrf6033();
    assert.equal(spec.vrf, "6033");
    assert.equal(spec.date, "2026-10-03");
    assert.equal(spec.veh, "Equipment 1");
    assert.equal(spec.name, "ONE BAGGER MIXER");
    assert.equal(spec.plate, "EQUIPMENT");
    assert.equal(spec.odo, "");
    assert.equal(spec.project, "Danao Guinacot");
    assert.equal(spec.job, "Fuel purchase (station)");
    assert.equal(spec.requestedBy, "Engr. Kimberly Galapin");
    assert.equal(spec.purpose, "Fuel — Gasoline ×11.53");
    assert.equal(spec.preparedBy, "Sophie V. Batas");
    assert.equal(spec.approvedBy, "Jeffrey James M. Corro");
    assert.equal(spec.status, "Approved");
    assert.equal(spec.lines[0].supplier, "Iced Petron");
    assert.equal(spec.lines[0].qty, 11.53);
    assert.equal(spec.lines[0].price, 86.73);
    assert.equal(spec.lines[0].total, 1000);
    assert.equal(spec.total, 1000);
    assert.equal(spec.attachments.length, 2);
    assert.match(spec.attachments[0].name, /831473351_/);
    assert.equal(spec.attachments[0].by, "Sophie Batas");
  });

  it("builds an approved ledger row on 6033 without asking the counter for a number", () => {
    const bundle = paperVrfRestoreBundle();
    assert.equal(bundle.vrf, "6033");
    assert.equal(bundle.month, "2026-10");
    assert.equal(bundle.mode, "replace");
    assert.equal(bundle.reserve.no, "paper-6033");
    assert.equal(bundle.reserve.vrfNo, "6033");
    assert.equal(bundle.reserve.status, "Approved");
    assert.equal(bundle.reserve.printedAt, "2026-10-03T14:05:00+08:00");
    assert.equal(bundle.reserve.approvedBy, "Jeffrey James M. Corro");
    assert.equal(bundle.rows.length, 1);
    assert.equal(bundle.rows[0].vrf, "6033");
    assert.equal(bundle.rows[0].vstatus, "Open");
    assert.equal(bundle.rows[0].total, 1000);
    assert.equal(bundle.rows[0].veh, "Equipment 1");
    assert.equal(bundle.rows[0].name, "ONE BAGGER MIXER");
    assert.equal(bundle.rows[0].notes, "Fuel — Gasoline ×11.53");
    assert.equal(bundle.rows[0].requestedBy, "Engr. Kimberly Galapin");
  });

  it("does not hand 6033 out while new VRFs still continue after 5925", () => {
    const used = usedVrfNumbers([{ vrf: "5925" }], []);
    assert.equal(vrfNumberTaken("6033", [], []), true);
    assert.equal(vrfRecorded([{ vrf: "5925" }], [], "6033"), false);
    assert.equal(maxVrfSeq(used), 5925);
    assert.equal(alignedNextVrf(6055, used), 5926);
    assert.equal(nextFreeVrf(6033, used), 6034);
    assert.equal(nextFreeVrf(5926, usedUpTo(5925)), 5926);
    const walked = [];
    let n = alignedNextVrf(6055, usedUpTo(5925));
    for (let i = 0; i < 120 && n < 6060; i++) {
      walked.push(n);
      const nextUsed = Object.assign({}, usedUpTo(5925));
      walked.forEach((x) => {
        nextUsed[String(x)] = 1;
      });
      n = nextFreeVrf(n + 1, nextUsed);
    }
    assert.equal(walked.includes(6033), false);
    assert.equal(walked[0], 5926);
  });

  it("still follows a real number above 6033", () => {
    const used = usedUpTo(6034);
    assert.equal(maxVrfSeq(used), 6034);
    assert.equal(alignedNextVrf(6055, used), 6035);
  });

  it("does not remint an approved or printed hold, including 6033", () => {
    const approved = { no: "80", vrfNo: "6033", status: "Approved", vrfs: [], printedAt: "" };
    assert.equal(holdIsSealed(approved), true);
    assert.equal(
      shouldRemintHeldVrf(approved, [{ vrf: "6033", src: "ledger" }], [approved]),
      false
    );
    const printedRequested = { no: "81", vrfNo: "5928", status: "Requested", printedAt: "2026-10-03" };
    assert.equal(holdIsSealed(printedRequested), true);
    assert.equal(shouldRemintHeldVrf(printedRequested, [], [printedRequested]), false);
  });

  it("lists other numbers already on file in the 5926–6055 gap", () => {
    assert.deepEqual(
      runawayRangeOnFile([{ vrf: "5925" }, { vrf: "5928" }, { vrf: "6055" }], []),
      ["5928", "6055"]
    );
    assert.deepEqual(runawayRangeOnFile([{ vrf: "5925" }], []), []);
  });

  it("does not post the same purchase twice when another number already has it", () => {
    const twin = {
      vrf: "5928",
      date: "2026-10-03",
      veh: "Equipment 1",
      supplier: "Iced Petron",
      total: 1000,
    };
    assert.deepEqual(matchingPaperPurchase([twin]), ["5928"]);
    assert.deepEqual(matchingPaperPurchase([{ vrf: "6033", date: "2026-10-03", veh: "Equipment 1", supplier: "Iced Petron", total: 1000 }]), []);
  });

  it("keeps every sealed number when a later save records another", () => {
    const first = mergeIssuedNumbers(null, {
      no: "6033",
      reason: "paper",
      snapshot: { rows: [{ vrf: "6033" }], reserve: { no: "paper-6033" } },
    });
    const second = mergeIssuedNumbers(first, { no: "5928", reason: "approved", snapshot: { rows: [{ vrf: "5928" }], reserve: { no: "9" } } });
    assert.equal(second.numbers["6033"].no, "6033");
    assert.equal(second.numbers["5928"].reason, "approved");
    assert.equal(issuedShouldRehydrate(second.numbers["6033"]), true);
    const kept = mergeIssuedNumbers(second, { no: "6033", reason: "printed" });
    assert.ok(kept.numbers["6033"].snapshot.rows.length);
    assert.equal(kept.numbers["5928"].no, "5928");
  });
});

describe("a month save cannot drop another VRF", () => {
  it("refuses a write that loses a sibling number", () => {
    assert.throws(
      () => assertSiblingVrfsKept([{ vrf: "5925" }, { vrf: "6033" }], [{ vrf: "5926" }], "5926"),
      (err) => err.code === "ledger_unreadable"
    );
    assert.doesNotThrow(() =>
      assertSiblingVrfsKept([{ vrf: "5925" }, { vrf: "6033" }], [{ vrf: "5925" }, { vrf: "6033", total: 1000 }], "6033")
    );
  });

  it("folds 6033 into the month and the issued log without removing 5925", async () => {
    const bundle = paperVrfRestoreBundle();
    const docs = {
      "ledger/2026-10": { month: "2026-10", rows: [{ vrf: "5925", total: 400, veh: "SV-01" }] },
      "reserves/2026": { year: "2026", rows: [{ no: "70", vrfNo: "5925", status: "Closed" }] },
    };
    const stamps = { "ledger/2026-10": "t0", "reserves/2026": "t0" };
    const io = {
      async getRecord(collection, id) {
        const key = collection + "/" + id;
        if (!docs[key]) return { data: null, updated_at: null };
        return { data: docs[key], updated_at: stamps[key] };
      },
      async cas(collection, id, data, updatedAt) {
        const key = collection + "/" + id;
        assert.equal(stamps[key] || null, updatedAt || null);
        docs[key] = data;
        stamps[key] = "t1";
        return { updated_at: "t1" };
      },
      async set(collection, id, data) {
        docs[collection + "/" + id] = data;
      },
    };
    const ack = await applyClientMerge(
      {
        kind: "bundle",
        month: bundle.month,
        year: bundle.year,
        vrf: bundle.vrf,
        rows: bundle.rows,
        mode: "replace",
        reserve: bundle.reserve,
      },
      io
    );
    assert.equal(ack.ok, true);
    const vrfs = docs["ledger/2026-10"].rows.map((r) => r.vrf).sort();
    assert.deepEqual(vrfs, ["5925", "6033"]);
    assert.equal(docs["ledger/2026-10"].rows.find((r) => r.vrf === "5925").veh, "SV-01");
    assert.equal(docs["reserves/2026"].rows.find((r) => r.no === "paper-6033").status, "Approved");
    assert.equal(docs["reserves/2026"].rows.find((r) => r.no === "70").vrfNo, "5925");

    await applyClientMerge(
      { kind: "issued", entry: { no: "6033", reason: "paper", snapshot: { rows: bundle.rows, reserve: bundle.reserve } } },
      io
    );
    await applyClientMerge(
      { kind: "issued", entry: { no: "5928", reason: "approved", snapshot: { rows: [{ vrf: "5928" }], reserve: { no: "71" } } } },
      io
    );
    assert.equal(docs["config/issued"].numbers["6033"].sealed, true);
    assert.equal(docs["config/issued"].numbers["5928"].no, "5928");
    assert.equal(mergeIssuedServer(docs["config/issued"], { no: "6033", reason: "printed" }).numbers["5928"].no, "5928");
  });
});

describe("artifact HTML — 6033 restore and build 2026-10-05 a", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("ships the stamp, the paper form, and a restore that does not claim a number", () => {
    assert.match(html, /var BUILD = "2026-10-08 a"/);
    assert.match(html, /function paperVrf6033/);
    assert.match(html, /function restoreMissingPaperVrfs/);
    assert.match(html, /function rehydrateSealedVrfs/);
    assert.match(html, /function rememberSealedVrf/);
    assert.match(html, /Danao Guinacot/);
    assert.match(html, /Iced Petron/);
    assert.match(html, /Engr\. Kimberly Galapin/);
    assert.match(html, /Sophie V\. Batas/);
    assert.match(html, /Jeffrey James M\. Corro/);
    assert.match(html, /ONE BAGGER MIXER/);
    assert.match(html, /11\.53/);
    assert.match(html, /86\.73/);
    const restoreStart = html.indexOf("async function restoreMissingPaperVrfs");
    const restoreEnd = html.indexOf("async function rehydrateSealedVrfs", restoreStart);
    const restore = html.slice(restoreStart, restoreEnd);
    assert.match(restore, /commitVrfBundle/);
    assert.doesNotMatch(restore, /claimVrf\(/);
    const sealStart = html.indexOf("function holdIsSealed");
    const sealEnd = html.indexOf("function shouldRemintHeldVrf", sealStart);
    const seal = html.slice(sealStart, sealEnd);
    assert.match(seal, /Approved/);
    assert.match(seal, /printedAt/);
    assert.match(seal, /isPaperVrfHold/);
  });
});
