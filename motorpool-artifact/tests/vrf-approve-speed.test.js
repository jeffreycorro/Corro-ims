"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  applyClientMerge,
  mergeLedgerRows,
  officeApproveTraffic,
} = require("../netlify/lib/doc-merge");
const {
  approvePendingVrf,
  createMemoryStore,
} = require("../netlify/lib/approve-from-hold");
const { applyVrfAutoApproval, VRF_AUTO_APPROVE_UNDER } = require("./lib/rules");

function otherRow() {
  return {
    vrf: "5881",
    veh: "SV-09",
    date: "2026-09-25",
    supplier: "FUEL RESERVE",
    item: "Fuel reserve dispense",
    total: 1690,
    vstatus: "Open",
    marker: "OTHER-VRF-5881",
  };
}

function pendingHold() {
  return {
    no: "12",
    vrfNo: "5812",
    date: "2026-09-21",
    kind: "job",
    veh: "MC-01",
    work: "PM",
    project: "HH-STAFF-2026",
    budget: 12500,
    requestedBy: "Jun Cruz",
    status: "Requested",
    approvedBudget: null,
    approvedBy: "",
    vrfs: [],
    draftLines: [
      { cat: "FILTER — Oil", item: "Oil filter", qty: 1, price: 12500, unit: "pc", supplier: "315", work: "PM" },
    ],
    draftPurpose: "service",
    draftOdo: "45210",
  };
}

function bigWorkbook() {
  const months = [];
  for (let m = 1; m <= 8; m++) {
    const id = "2026-" + String(m).padStart(2, "0");
    const rows = [];
    for (let i = 0; i < 80; i++) {
      rows.push({ vrf: String(5000 + m * 100 + i), veh: "SV-09", total: 100 + i, supplier: "OTHER-VRF-5881" });
    }
    months.push({ id, rows });
  }
  const reserves = [];
  for (let i = 0; i < 60; i++) {
    reserves.push({
      no: String(100 + i),
      vrfNo: String(4000 + i),
      status: "Approved",
      date: "2026-08-01",
      vrfs: [String(4000 + i)],
      preparedSig: "sig-" + "x".repeat(1800),
    });
  }
  return { months, reserves };
}

describe("approve traffic — browser round trips and payload", () => {
  it("sends one small merge instead of the whole month and the whole year", () => {
    const book = bigWorkbook();
    const monthRows = book.months[7].rows.concat([otherRow()]);
    const yearReserves = book.reserves.concat([pendingHold()]);
    const newRows = [
      { vrf: "5812", veh: "MC-01", total: 12500, vstatus: "Open", supplier: "315" },
    ];
    const traffic = officeApproveTraffic({
      monthRows,
      yearReserves,
      newRows,
      reserve: Object.assign({}, pendingHold(), { status: "Approved", vrfs: ["5812"] }),
      months: book.months.map((m) => m.id).concat(["2026-09"]),
    });

    assert.equal(traffic.before.roundTrips, 6);
    assert.equal(traffic.after.roundTrips, 1);
    assert.ok(traffic.after.requestBytes < traffic.before.requestBytes / 5);
    assert.ok(traffic.after.responseBytes < traffic.before.responseBytes / 20);
    assert.equal(
      traffic.before.trips.map((t) => t.op + " " + t.path).join("\n"),
      [
        "GET ledger/2026-09",
        "SET ledger/2026-09",
        "GET ledger/index",
        "LIST photos",
        "GET reserves/2026",
        "SET reserves/2026",
      ].join("\n")
    );
    assert.equal(traffic.after.trips[0].op, "POST");
    assert.doesNotMatch(JSON.stringify(traffic.bundle), /OTHER-VRF-5881/);
    assert.doesNotMatch(JSON.stringify(traffic.bundle), /preparedSig/);
  });
});

describe("merge keeps every other VRF", () => {
  it("replaces one VRF and retries a conflict without copying the neighbour", async () => {
    const docs = {
      "ledger/2026-09": { month: "2026-09", rows: [otherRow()] },
      "reserves/2026": { year: "2026", rows: [pendingHold(), { no: "9", vrfNo: "5881", status: "Approved", vrfs: ["5881"], date: "2026-09-25" }] },
    };
    const stamps = { "ledger/2026-09": "t0", "reserves/2026": "t0" };
    let conflicts = 0;
    const io = {
      async getRecord(collection, id) {
        const path = collection + "/" + id;
        return { data: docs[path] ? JSON.parse(JSON.stringify(docs[path])) : null, updated_at: stamps[path] || null };
      },
      async cas(collection, id, data, updatedAt) {
        const path = collection + "/" + id;
        if (conflicts < 1 && collection === "ledger") {
          conflicts += 1;
          const err = new Error("conflict");
          err.code = "conflict";
          throw err;
        }
        if (stamps[path] !== updatedAt) {
          const err = new Error("conflict");
          err.code = "conflict";
          throw err;
        }
        docs[path] = JSON.parse(JSON.stringify(data));
        stamps[path] = "t" + (conflicts + 2);
      },
      async set(collection, id, data) {
        docs[collection + "/" + id] = JSON.parse(JSON.stringify(data));
      },
    };
    const reserve = Object.assign({}, pendingHold(), { status: "Approved", vrfs: ["5812"], approvedBy: "Jeffrey" });
    const ack = await applyClientMerge(
      {
        kind: "bundle",
        month: "2026-09",
        year: "2026",
        vrf: "5812",
        mode: "replace",
        rows: [{ vrf: "5812", veh: "MC-01", total: 12500, vstatus: "Open" }],
        reserve,
      },
      io
    );
    assert.equal(ack.ok, true);
    assert.ok(ack.attempts >= 2);
    assert.equal(ack.wrote, 1);
    assert.deepEqual(
      docs["ledger/2026-09"].rows.find((r) => r.vrf === "5881"),
      otherRow()
    );
    assert.equal(docs["ledger/2026-09"].rows.filter((r) => r.vrf === "5812").length, 1);
    assert.equal(docs["reserves/2026"].rows.find((r) => r.no === "9").vrfNo, "5881");
    assert.equal(docs["reserves/2026"].rows.find((r) => r.no === "12").status, "Approved");
    assert.throws(
      () => mergeLedgerRows([otherRow()], "5812", [{ vrf: "5881" }], "replace"),
      (err) => err.code === "vrf_mismatch"
    );
  });
});

describe("approve-vrf loads the target month only", () => {
  it("does not read the other ledger months, and a conflict retry leaves 5881 intact", async () => {
    const docs = {
      "reserves/index": { years: ["2026"] },
      "reserves/2026": {
        year: "2026",
        rows: [pendingHold(), { no: "9", vrfNo: "5881", status: "Approved", date: "2026-09-25", vrfs: ["5881"], draftLines: [] }],
      },
      "ledger/index": { months: [] },
      "config/app": { nextVrf: 5813, varianceTol: 0.1, nextReserve: 13 },
      "master/vehicles": { rows: [{ code: "MC-01", desc: "Hilux" }] },
      "master/parts": { rows: [{ cat: "FILTER — Oil", sub: "Filters" }] },
      "ledger/2026-09": { month: "2026-09", rows: [otherRow()] },
    };
    for (let m = 1; m <= 8; m++) {
      const id = "2026-" + String(m).padStart(2, "0");
      docs["ledger/index"].months.push(id);
      docs["ledger/" + id] = {
        month: id,
        rows: [{ vrf: "9" + id, total: m, marker: "OTHER-MONTH-" + id }],
      };
    }
    docs["ledger/index"].months.push("2026-09");
    const store = createMemoryStore(docs);
    const calls = [];
    let ledgerConflicts = 0;
    const wrapped = {
      async get(c, id) {
        calls.push("get " + c + "/" + id);
        return store.get(c, id);
      },
      async getRecord(c, id) {
        calls.push("getRecord " + c + "/" + id);
        return store.getRecord(c, id);
      },
      async set(c, id, data) {
        calls.push("set " + c + "/" + id);
        return store.set(c, id, data);
      },
      async cas(c, id, data, stamp) {
        calls.push("cas " + c + "/" + id);
        if (c === "ledger" && ledgerConflicts < 1) {
          ledgerConflicts += 1;
          const err = new Error("conflict");
          err.code = "conflict";
          throw err;
        }
        return store.cas(c, id, data, stamp);
      },
      async list(c) {
        calls.push("list " + c);
        return store.list(c);
      },
      async listIds(c) {
        calls.push("listIds " + c);
        return store.listIds(c);
      },
    };
    const out = await approvePendingVrf(wrapped, { vrf: "5812", approvedBy: "Jeffrey" }, { now: "2026-09-21" });
    assert.equal(out.vrf, "5812");
    assert.equal(out.status, "Open");

    const monthGets = calls.filter((c) => c.startsWith("getRecord ledger/2026-") || c.startsWith("get ledger/2026-"));
    assert.deepEqual(monthGets.filter((c) => c.includes("2026-09")), monthGets);
    assert.equal(calls.filter((c) => c === "list ledger" || c === "list reserves").length, 0);
    assert.ok(calls.filter((c) => c === "getRecord ledger/2026-09").length <= 2);
    assert.ok(!calls.some((c) => c.startsWith("getRecord ledger/2026-01")));

    const month = await store.get("ledger", "2026-09");
    assert.deepEqual(month.rows.find((r) => r.vrf === "5881"), otherRow());
    assert.equal(month.rows.filter((r) => r.vrf === "5812").length, 1);
    const untouched = await store.get("ledger", "2026-01");
    assert.equal(untouched.rows[0].marker, "OTHER-MONTH-2026-01");

    const beforeApi = 7 + 1 + 9 + 4;
    assert.ok(calls.length < beforeApi, "new call list " + calls.length + " vs old " + beforeApi + "\n" + calls.join("\n"));
  });
});

describe("approval rules stay put", () => {
  it("still auto-approves under 1000 as CEO policy", () => {
    assert.equal(VRF_AUTO_APPROVE_UNDER, 1000);
    const hold = { status: "Requested" };
    assert.equal(applyVrfAutoApproval(hold, 150, "2026-09-29"), true);
    assert.equal(hold.approvedBy, "CEO policy");
    const queued = { status: "Requested" };
    assert.equal(applyVrfAutoApproval(queued, 1690, "2026-09-29"), false);
    assert.equal(queued.status, "Requested");
  });
});

describe("artifact HTML — approve does not wait on the whole workbook", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("bundles the approve write, paints Approving…, and does not await photo copies", () => {
    assert.match(html, /var BUILD = "2026-10-04 a"/);
    assert.match(html, /async function commitVrfBundle/);
    assert.match(html, /async function postAndSaveReserve/);
    assert.match(html, /function queuePhotoCopy/);
    assert.match(html, /kind:"bundle"/);
    assert.match(html, /data-approve-rsv/);
    assert.match(html, /Approving…/);
    assert.match(html, /Nothing was saved\./);
    const postStart = html.indexOf("async function postReserveVrf");
    const postEnd = html.indexOf("async function postAndSaveReserve", postStart);
    const postBody = html.slice(postStart, postEnd);
    assert.doesNotMatch(postBody, /await copyPhotos/);
    assert.match(postBody, /queueReservePhotos/);
    const approveStart = html.indexOf('okb.addEventListener("click"');
    const approveEnd = html.indexOf("nob.addEventListener", approveStart);
    const approveBody = html.slice(approveStart, approveEnd);
    assert.match(approveBody, /postAndSaveReserve/);
    assert.match(approveBody, /Approving…/);
    assert.match(approveBody, /setTimeout/);
    assert.doesNotMatch(approveBody, /m\.remove\(\);\s*render\(\)/);
  });
});
