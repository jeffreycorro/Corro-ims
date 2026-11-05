"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { approvePendingVrf, createMemoryStore } = require("../netlify/lib/approve-from-hold");
const { createHandler } = require("../netlify/functions/approve-vrf");

const SECRET = "test-approve-vrf-secret-value";
const NOTE = "Sep 29 FUEL RESERVE sheet backfill. 40 L already on the sheet — do not release again.";
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function fuelLine(over) {
  return Object.assign(
    {
      cat: "Fuel — Diesel",
      item: "Fuel Reserve dispense",
      supplier: "FUEL RESERVE",
      qty: 40,
      unit: "L",
      price: 88.5,
      liters: "",
      work: "FUEL-RES",
    },
    over
  );
}

function sheetHold(over) {
  return Object.assign(
    {
      no: "296",
      vrfNo: "6296",
      date: "2026-09-29",
      kind: "fuel-issue",
      veh: "DT-04",
      work: "FUEL-RES",
      project: "",
      budget: 3540,
      litres: 40,
      requestedBy: "Sheet",
      status: "Requested",
      approvedBudget: null,
      approvedBy: "",
      approvedAt: "",
      decisionNote: "",
      vrfs: [],
      draftLines: [fuelLine()],
      draftPurpose: "FUEL RESERVE sheet",
      draftOdo: "",
    },
    over
  );
}

function seed(holds) {
  return {
    "reserves/index": { years: ["2026"] },
    "reserves/2026": { year: "2026", rows: holds },
    "ledger/index": { months: ["2026-11"] },
    "ledger/2026-11": { month: "2026-11", rows: [] },
    "fuel/withdrawals": { rows: [{ date: "2026-09-01", vrf: "1000", vehicle: "DT-01", liters: 5 }] },
    "config/app": {
      nextVrf: 6298,
      pass: null,
      fuel: null,
      varianceTol: 0.1,
      nextReserve: 400,
      driveFolder: "",
    },
    "master/vehicles": {
      rows: [
        { code: "DT-04", desc: "Dump truck" },
        { code: "SV-09", desc: "Service van" },
      ],
    },
    "master/parts": { rows: [{ cat: "Fuel — Diesel", sub: "Fuel" }] },
  };
}

function backfillBody(vrf, note) {
  return {
    vrf,
    approvedBy: "Jeffrey James M. Corro",
    approverNote: "jeffrey-yes via Noah",
    backfill: { note: note || NOTE, noRelease: true },
  };
}

async function withdrawalsOf(store) {
  return store.get("fuel", "withdrawals");
}

describe("approve backfill", () => {
  it("keeps 29 Sep, stamps 40 L from qty, and does not release fuel", async () => {
    const store = createMemoryStore(
      seed([
        sheetHold(),
        sheetHold({
          no: "297",
          vrfNo: "6297",
          veh: "SV-09",
          draftLines: [fuelLine({ qty: 1, unit: "pc", liters: 40, price: 3540 })],
        }),
      ])
    );
    const fuelBefore = await withdrawalsOf(store);

    const dt = await approvePendingVrf(store, backfillBody("6296"), { now: "2026-11-05" });
    assert.equal(dt.ok, true);
    assert.equal(dt.vrf, "6296");
    assert.equal(dt.status, "Open");
    assert.deepEqual(dt.backfill, { note: NOTE, noRelease: true });
    assert.equal(dt.approvedAt, "2026-11-05T00:00:00+08:00");

    const sv = await approvePendingVrf(store, backfillBody("6297"), { now: "2026-11-05" });
    assert.equal(sv.vrf, "6297");
    assert.deepEqual(sv.backfill, { note: NOTE, noRelease: true });

    const september = await store.get("ledger", "2026-09");
    const november = await store.get("ledger", "2026-11");
    assert.equal(september.rows.length, 2);
    assert.deepEqual(november.rows, []);

    const row6296 = september.rows.find((row) => row.vrf === "6296");
    assert.equal(row6296.date, "2026-09-29");
    assert.equal(row6296.month, "2026-09");
    assert.equal(row6296.veh, "DT-04");
    assert.equal(row6296.liters, 40);
    assert.equal(row6296.qty, 40);
    assert.equal(row6296.total, 3540);
    assert.equal(row6296.backfill, true);
    assert.equal(row6296.notes, NOTE);
    assert.equal(row6296.vstatus, "Open");
    assert.equal(row6296.supplier, "FUEL RESERVE");
    assert.equal(row6296.work, "FUEL-RES");

    const row6297 = september.rows.find((row) => row.vrf === "6297");
    assert.equal(row6297.date, "2026-09-29");
    assert.equal(row6297.month, "2026-09");
    assert.equal(row6297.veh, "SV-09");
    assert.equal(row6297.qty, 1);
    assert.equal(row6297.liters, 40);
    assert.equal(row6297.total, 3540);
    assert.equal(row6297.backfill, true);
    assert.equal(row6297.notes, NOTE);

    const year = await store.get("reserves", "2026");
    for (const no of ["6296", "6297"]) {
      const hold = year.rows.find((row) => String(row.vrfNo) === no);
      assert.equal(hold.status, "Approved");
      assert.equal(hold.date, "2026-09-29");
      const audit = (hold.audit || []).find((entry) => entry && entry.backfill === true);
      assert.ok(audit);
      assert.equal(audit.note, "jeffrey-yes via Noah — " + NOTE);
      assert.equal(audit.from, "Requested");
      assert.equal(audit.to, "Approved");
    }

    assert.deepEqual(await withdrawalsOf(store), fuelBefore);
    assert.equal(Object.keys(store._docs).some((key) => key.startsWith("fuel/") && key !== "fuel/withdrawals"), false);
  });

  it("accepts the flag on the approve-vrf function and leaves a repeat as already posted", async () => {
    const env = { ...process.env };
    process.env.APPROVE_VRF_SECRET = SECRET;
    delete process.env.MOTORPOOL_APPROVE_SECRET;
    try {
      const store = createMemoryStore(seed([sheetHold()]));
      const fuelBefore = await withdrawalsOf(store);
      const handler = createHandler({ store });
      const res = await handler({
        httpMethod: "POST",
        headers: { authorization: "Bearer " + SECRET },
        body: JSON.stringify(backfillBody("6296")),
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.vrf, "6296");
      assert.deepEqual(body.backfill, { note: NOTE, noRelease: true });
      const row = (await store.get("ledger", "2026-09")).rows[0];
      assert.equal(row.date, "2026-09-29");
      assert.equal(row.liters, 40);
      assert.equal(row.backfill, true);

      const again = await handler({
        httpMethod: "POST",
        headers: { "x-approve-secret": SECRET },
        body: JSON.stringify(backfillBody("6296")),
      });
      assert.equal(again.statusCode, 200);
      assert.equal(JSON.parse(again.body).already, true);
      assert.equal((await store.get("ledger", "2026-09")).rows.length, 1);
      assert.deepEqual(await withdrawalsOf(store), fuelBefore);
    } finally {
      process.env = env;
    }
  });

  it("does not stamp backfill or invent litres when the flag is omitted", async () => {
    const store = createMemoryStore(seed([sheetHold()]));
    const out = await approvePendingVrf(
      store,
      { vrf: "6296", approvedBy: "Carmel" },
      { now: "2026-11-05" }
    );
    assert.equal(out.backfill, undefined);
    const row = (await store.get("ledger", "2026-09")).rows[0];
    assert.equal(row.date, "2026-09-29");
    assert.equal(row.month, "2026-09");
    assert.equal(row.liters, null);
    assert.equal(row.backfill, undefined);
    assert.equal(row.notes, "FUEL RESERVE sheet");
    assert.equal((await withdrawalsOf(store)).rows.length, 1);
    assert.equal((await store.get("ledger", "2026-11")).rows.length, 0);
  });

  it("refuses a bad flag and writes nothing", async () => {
    const cases = [
      { backfill: "yes" },
      { backfill: { note: NOTE, noRelease: false } },
      { backfill: { noRelease: true } },
      { backfill: { note: "   ", noRelease: true } },
    ];
    for (const extra of cases) {
      const store = createMemoryStore(seed([sheetHold()]));
      await assert.rejects(
        () =>
          approvePendingVrf(
            store,
            Object.assign({ vrf: "6296", approvedBy: "Jeffrey James M. Corro" }, extra),
            { now: "2026-11-05" }
          ),
        (err) => err.statusCode === 400 && err.code === "bad_request"
      );
      const year = await store.get("reserves", "2026");
      assert.equal(year.rows[0].status, "Requested");
      assert.equal(await store.get("ledger", "2026-09"), null);
      assert.equal((await withdrawalsOf(store)).rows.length, 1);
    }
  });

  it("refuses a backfill fuel line with no litres and a hold with no date", async () => {
    const blank = createMemoryStore(
      seed([sheetHold({ draftLines: [fuelLine({ qty: "", liters: "", price: 3540 })] })])
    );
    await assert.rejects(
      () => approvePendingVrf(blank, backfillBody("6296"), { now: "2026-11-05" }),
      (err) => err.statusCode === 400 && /no litres/.test(err.message)
    );
    assert.equal((await blank.get("reserves", "2026")).rows[0].status, "Requested");

    const undated = createMemoryStore(seed([sheetHold({ date: "" })]));
    await assert.rejects(
      () => approvePendingVrf(undated, backfillBody("6296"), { now: "2026-11-05" }),
      (err) => err.statusCode === 400 && /VRF date/.test(err.message)
    );
    assert.equal((await undated.get("reserves", "2026")).rows[0].status, "Requested");
    assert.equal(await undated.get("ledger", "2026-09"), null);
    assert.deepEqual((await undated.get("ledger", "2026-11")).rows, []);
  });

  it("heals a missing September line with the backfill note and still skips fuel", async () => {
    const store = createMemoryStore(
      seed([
        sheetHold({
          status: "Approved",
          approvedBy: "Jeffrey James M. Corro",
          approvedAt: "2026-11-05T01:00:00+08:00",
          vrfs: ["6296"],
        }),
      ])
    );
    const fuelBefore = await withdrawalsOf(store);
    const out = await approvePendingVrf(store, backfillBody("6296"), { now: "2026-11-05" });
    assert.equal(out.healed, true);
    assert.deepEqual(out.backfill, { note: NOTE, noRelease: true });
    const row = (await store.get("ledger", "2026-09")).rows[0];
    assert.equal(row.date, "2026-09-29");
    assert.equal(row.liters, 40);
    assert.equal(row.backfill, true);
    assert.equal(row.notes, NOTE);
    const hold = (await store.get("reserves", "2026")).rows[0];
    const audit = hold.audit.find((entry) => entry.backfill === true);
    assert.equal(audit.note, NOTE);
    assert.equal(audit.field, "ledger");
    assert.deepEqual(await withdrawalsOf(store), fuelBefore);
  });
});

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

function loadReserveIssue() {
  const names = [
    "spendEndStatus",
    "isFuel",
    "fuelLitresOf",
    "isFuelWorkCode",
    "allLines",
    "rsvKind",
    "reserveFuelLitres",
    "fuelAudit",
    "reserveIssueLedger",
  ];
  const ctx = {
    S: { ledger: {}, reserves: [], purchases: [], withdrawals: [] },
    FuelAudit: require("../public/fuel-audit.js"),
  };
  vm.runInNewContext(names.map((name) => extractFunction(html, name)).join("\n"), ctx);
  return ctx;
}

function ledgerFuel(over) {
  return Object.assign(
    {
      date: "2026-09-29",
      vrf: "6296",
      veh: "DT-04",
      cat: "Fuel — Diesel",
      supplier: "FUEL RESERVE",
      work: "FUEL-RES",
      qty: 40,
      unit: "L",
      liters: 40,
      vstatus: "Open",
    },
    over
  );
}

describe("reserve litres skip a backfill", () => {
  it("is build 2026-11-05 f", () => {
    assert.match(html, /var BUILD = "2026-11-05 f"/);
    assert.match(html, /if\(r\.backfill===true\) return;/);
  });

  it("leaves 80 L of sheet backfill out of unassigned and out of the bulk lot", () => {
    const ctx = loadReserveIssue();
    ctx.S.reserves = [
      {
        no: "9",
        kind: "fuel-bulk",
        veh: "AV",
        status: "Approved",
        date: "2026-09-01",
        litres: 200,
        draftLines: [{ cat: "Fuel — Diesel", qty: 200, unit: "L", liters: 200, work: "FUEL-BULK" }],
      },
    ];
    ctx.S.withdrawals = [{ reserve: "9", liters: 8, vehicle: "DT-02", date: "2026-09-15", vrf: "6100" }];
    ctx.S.ledger = {
      "2026-09": [
        ledgerFuel({ vrf: "6296", veh: "DT-04", liters: 40, backfill: true }),
        ledgerFuel({ vrf: "6297", veh: "SV-09", liters: 40, backfill: true }),
        ledgerFuel({ vrf: "6298", veh: "DT-04", liters: 40, reserve: "9", backfill: true }),
        ledgerFuel({ vrf: "6200", veh: "DT-01", liters: 15, date: "2026-09-20" }),
        ledgerFuel({ vrf: "6201", veh: "DT-03", liters: 20, reserve: "9", date: "2026-09-21" }),
        ledgerFuel({ vrf: "6202", veh: "SV-01", liters: 5, backfill: "true", date: "2026-09-22" }),
      ],
    };

    const book = ctx.reserveIssueLedger();
    const lot = book.lots.find((row) => row.id === "RSV-9");
    assert.equal(lot.issued, 28);
    assert.equal(lot.remaining, 172);
    assert.equal(book.unassignedLiters, 20);
    assert.equal(
      book.unassigned.some((row) => row.vrf === "6296" || row.vrf === "6297" || row.vrf === "6298"),
      false
    );

    ctx.S.ledger["2026-09"].forEach((row) => {
      if (row.backfill === true) row.backfill = false;
    });
    const counted = ctx.reserveIssueLedger();
    const lotAgain = counted.lots.find((row) => row.id === "RSV-9");
    assert.equal(lotAgain.issued, 68);
    assert.equal(counted.unassignedLiters, 100);
  });
});
