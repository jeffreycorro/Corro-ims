"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  clampClientCounter,
  commitIssue,
  mergeReserveDetailed,
  screenClientSet,
} = require("../netlify/lib/vrf-issue");

function rsv(no, vrf, extra) {
  return Object.assign(
    {
      no: String(no),
      vrfNo: String(vrf),
      status: "Requested",
      date: "2026-10-02",
      veh: "DT-01",
      work: "REP",
      budget: 0,
      draftLines: [],
      draftPurpose: "",
      scope: "",
      vrfs: [],
    },
    extra || {}
  );
}

function withContent(no, vrf, extra) {
  return rsv(no, vrf, Object.assign({
    budget: 4800,
    draftPurpose: "Radiator hose",
    draftLines: [{ cat: "Cooling", item: "Hose", qty: 1, price: 4800 }],
    requestedBy: "Sophie Batas",
  }, extra || {}));
}

function memoryIo(seed, opts) {
  opts = opts || {};
  const docs = JSON.parse(JSON.stringify(seed));
  const stamps = {};
  Object.keys(docs).forEach((k) => {
    stamps[k] = 1;
  });
  let locked = false;
  const queue = [];
  function key(collection, id) {
    return collection + "/" + id;
  }
  const io = {
    docs,
    async listIds(collection) {
      const prefix = collection + "/";
      return Object.keys(docs)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
    async getRecord(collection, id) {
      const k = key(collection, id);
      if (!docs[k]) return { data: null, updated_at: null };
      return { data: JSON.parse(JSON.stringify(docs[k])), updated_at: stamps[k] };
    },
    async cas(collection, id, data, updatedAt) {
      if (opts.fail) {
        const err = new Error("disk full");
        err.code = "disk";
        throw err;
      }
      const k = key(collection, id);
      if (stamps[k] !== updatedAt) {
        const err = new Error("conflict");
        err.code = "conflict";
        throw err;
      }
      docs[k] = JSON.parse(JSON.stringify(data));
      stamps[k] += 1;
      return { updated_at: stamps[k] };
    },
    async set(collection, id, data) {
      if (opts.fail) {
        const err = new Error("disk full");
        err.code = "disk";
        throw err;
      }
      const k = key(collection, id);
      docs[k] = JSON.parse(JSON.stringify(data));
      stamps[k] = (stamps[k] || 0) + 1;
    },
    async acquire() {
      if (!locked) {
        locked = true;
        return { acquired: true };
      }
      await new Promise((res) => queue.push(res));
      locked = true;
      return { acquired: true };
    },
    async release() {
      locked = false;
      const next = queue.shift();
      if (next) next();
    },
  };
  return io;
}

function baseDocs() {
  return {
    "reserves/2026": {
      year: "2026",
      rows: [withContent(24, 5925, { date: "2026-10-02" })],
    },
    "ledger/2026-10": {
      month: "2026-10",
      rows: [{ vrf: "5925", veh: "DT-01", total: 4800, month: "2026-10" }],
    },
    "config/app": { nextVrf: 6108, nextReserve: 100, varianceTol: 0.1 },
    "config/issued": { numbers: { "6033": { no: "6033", sealed: true, reason: "paper" } } },
  };
}

describe("a duplicate VRF number does not block the save", () => {
  it("keeps the older real reserve and archives an empty duplicate", () => {
    const older = withContent(25, 6112, { date: "2026-10-03" });
    const empty = rsv(100, 6112, { date: "2026-10-05", veh: "", work: "" });
    const result = mergeReserveDetailed([older, empty], older, { at: "2026-10-05T12:00:00+08:00" });
    const keep = result.rows.find((r) => r.no === "25");
    const other = result.rows.find((r) => r.no === "100");
    assert.equal(keep.vrfNo, "6112");
    assert.equal(other.status, "Archived");
    assert.equal(other.archived, true);
    assert.equal(other.vrfNo, "");
    assert.equal(result.rows.length, 2);
    assert.ok(result.changes.some((c) => c.action === "archived" && c.reserveNo === "100"));
  });

  it("gives the newer real reserve a fresh number instead of refusing", () => {
    const older = withContent(25, 6112, { date: "2026-10-03" });
    const newer = withContent(100, 6112, { date: "2026-10-05", veh: "SV-02", draftPurpose: "Brake pad" });
    const result = mergeReserveDetailed([older, newer], newer, { at: "2026-10-05T12:00:00+08:00" });
    const keep = result.rows.find((r) => r.no === "25");
    const other = result.rows.find((r) => r.no === "100");
    assert.equal(keep.vrfNo, "6112");
    assert.equal(keep.veh, "DT-01");
    assert.notEqual(other.vrfNo, "6112");
    assert.equal(other.status, "Requested");
    assert.equal(other.veh, "SV-02");
    assert.ok(Number(other.vrfNo) > 6112);
    assert.equal(result.rows.length, 2);
  });
});

describe("server issues one number per saved row", () => {
  it("repairs a runaway counter to the highest real number plus one, skipping 6033", async () => {
    const io = memoryIo(baseDocs());
    const ack = await commitIssue({ kind: "repair", user: "Motorpool", device: "server", at: "2026-10-05T11:50:00+08:00" }, io);
    assert.equal(ack.nextVrf, 5926);
    assert.equal(io.docs["config/app"].nextVrf, 5926);
    assert.equal(io.docs["reserves/2026"].rows.find((r) => r.vrfNo === "5925").veh, "DT-01");
    assert.equal(ack.orphans.includes("6033"), false);
    assert.equal(ack.orphans.includes("5926"), true);
    assert.equal(ack.orphans.includes("6107"), true);
    const orphan = io.docs["config/vrf-audit"].entries.find((e) => e.outcome === "orphaned");
    assert.ok(orphan);
    assert.equal(orphan.user, "Motorpool");
    assert.equal(orphan.device, "server");
  });

  it("assigns the next real number when two creates run together", async () => {
    const io = memoryIo(baseDocs());
    const draft = (who) => ({
      status: "Requested",
      date: "2026-10-05",
      veh: "DT-0" + who,
      work: "REP",
      budget: 2200,
      draftPurpose: "Request " + who,
      draftLines: [{ cat: "Belt", item: "Belt", qty: 1, price: 2200 }],
      requestedBy: who,
      vrfs: [],
    });
    const [a, b] = await Promise.all([
      commitIssue({ kind: "issue", reserve: draft("A"), user: "A", device: "phone-a", at: "2026-10-05T12:00:00+08:00" }, io),
      commitIssue({ kind: "issue", reserve: draft("B"), user: "B", device: "phone-b", at: "2026-10-05T12:00:01+08:00" }, io),
    ]);
    assert.notEqual(a.reserve.vrfNo, b.reserve.vrfNo);
    assert.notEqual(a.reserve.no, b.reserve.no);
    const rows = io.docs["reserves/2026"].rows;
    assert.equal(rows.length, 3);
    const numbers = rows.map((r) => r.vrfNo);
    assert.equal(new Set(numbers).size, numbers.length);
    assert.ok(numbers.includes("5925"));
    assert.equal(io.docs["config/app"].nextVrf, Math.max(...numbers.map(Number)) + 1);
    const saved = io.docs["config/vrf-audit"].entries.filter((e) => e.outcome === "saved");
    assert.equal(saved.length, 2);
    assert.ok(saved.some((e) => e.device === "phone-a" && e.user === "A"));
  });

  it("does not consume a number when the save fails", async () => {
    const io = memoryIo(baseDocs(), { fail: true });
    const before = JSON.stringify(io.docs);
    await assert.rejects(
      () =>
        commitIssue(
          {
            kind: "issue",
            reserve: withContent("", "", { no: "", vrfNo: "", date: "2026-10-05" }),
            user: "Sophie",
            device: "desk",
            at: "2026-10-05T12:02:00+08:00",
          },
          io
        ),
      (err) => err && err.message === "disk full"
    );
    assert.equal(JSON.stringify(io.docs), before);
    assert.equal(io.docs["config/app"].nextVrf, 6108);
    assert.equal(io.docs["reserves/2026"].rows.length, 1);
    io.cas = memoryIo(baseDocs()).cas;
  });

  it("uses the same next number after a failed save once the disk works again", async () => {
    const seed = baseDocs();
    seed["config/app"].nextVrf = 5926;
    const broken = memoryIo(seed, { fail: true });
    await assert.rejects(() =>
      commitIssue(
        {
          kind: "issue",
          reserve: withContent("", "", { no: "", vrfNo: "", date: "2026-10-05", draftPurpose: "First try" }),
          user: "Sophie",
          device: "desk",
        },
        broken
      )
    );
    const io = memoryIo(seed);
    const ack = await commitIssue(
      {
        kind: "issue",
        reserve: withContent("", "", { no: "", vrfNo: "", date: "2026-10-05", draftPurpose: "First try" }),
        user: "Sophie",
        device: "desk",
      },
      io
    );
    assert.equal(ack.reserve.vrfNo, "5926");
    assert.equal(io.docs["config/app"].nextVrf, 5927);
    assert.equal(io.docs["reserves/2026"].rows.filter((r) => r.vrfNo === "5926").length, 1);
  });

  it("saves a new VRF while 6112 is already on RSV-25 and RSV-100", async () => {
    const docs = baseDocs();
    docs["reserves/2026"].rows.push(withContent(25, 6112, { date: "2026-10-03" }));
    docs["reserves/2026"].rows.push(rsv(100, 6112, { date: "2026-10-05", veh: "", work: "" }));
    docs["config/app"].nextVrf = 6112;
    const io = memoryIo(docs);
    const ack = await commitIssue(
      {
        kind: "issue",
        reserve: withContent("", "", { no: "", vrfNo: "6112", date: "2026-10-05", veh: "MC-14", draftPurpose: "New form" }),
        user: "Yard",
        device: "tablet",
        at: "2026-10-05T12:10:00+08:00",
      },
      io
    );
    const rows = io.docs["reserves/2026"].rows;
    assert.equal(rows.find((r) => r.no === "25").vrfNo, "6112");
    assert.equal(rows.find((r) => r.no === "100").status, "Archived");
    assert.notEqual(ack.reserve.vrfNo, "6112");
    assert.equal(rows.some((r) => r.no === ack.reserve.no && r.vrfNo === ack.reserve.vrfNo), true);
    const live = rows.map((r) => r.vrfNo).filter(Boolean);
    assert.equal(new Set(live).size, live.length);
  });
});

describe("a stale client cannot overwrite the shared list", () => {
  it("rejects a whole-year or whole-month set", () => {
    const year = screenClientSet("reserves", "2026");
    const month = screenClientSet("ledger", "2026-10");
    assert.equal(year.code, "stale_overwrite");
    assert.equal(month.code, "stale_overwrite");
    assert.equal(year.statusCode, 409);
    assert.equal(screenClientSet("reserves", "index"), null);
    assert.equal(screenClientSet("config", "app"), null);
  });

  it("does not let a client raise the counter past the saved value", () => {
    assert.equal(clampClientCounter(6108, 6112), 6108);
    assert.equal(clampClientCounter(6108, 5926), 5926);
    assert.equal(clampClientCounter(5926, 5926), 5926);
  });

  it("keeps the sibling reserve when the duplicate is resolved", () => {
    const older = withContent(25, 6112);
    const newer = withContent(100, 6112, { veh: "SV-02" });
    const result = mergeReserveDetailed([older, newer], older);
    assert.deepEqual(
      result.rows.map((r) => r.no).sort(),
      ["100", "25"]
    );
    assert.equal(result.rows.find((r) => r.no === "25").draftPurpose, "Radiator hose");
    assert.equal(result.rows.find((r) => r.no === "100").veh, "SV-02");
  });
});
