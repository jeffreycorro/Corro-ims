"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  applyApproveFromHold,
  approvePendingVrf,
  createMemoryStore,
  normalizeVrfRequest,
  resolveHold,
  shouldRemintHeldVrf,
} = require("../netlify/lib/approve-from-hold");
const { createHandler } = require("../netlify/functions/approve-vrf");

const SECRET = "test-approve-vrf-secret-value";

function pendingHold(over) {
  return Object.assign(
    {
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
      approvedAt: "",
      decisionNote: "",
      vrfs: [],
      draftLines: [
        {
          cat: "FILTER — Oil",
          item: "Oil filter",
          qty: 1,
          price: 12500,
          unit: "pc",
          supplier: "315",
          work: "PM",
        },
      ],
      draftPurpose: "service",
      draftOdo: "45210",
    },
    over
  );
}

function seedDocs(over) {
  const hold = pendingHold(over && over.hold);
  const extraHolds = (over && over.extraHolds) || [];
  const ledgerRows = (over && over.ledgerRows) || [];
  return {
    "reserves/index": { years: ["2026"] },
    "reserves/2026": { year: "2026", rows: [hold].concat(extraHolds) },
    "ledger/index": { months: ["2026-09"] },
    "ledger/2026-09": { month: "2026-09", rows: ledgerRows },
    "config/app": {
      nextVrf: (over && over.nextVrf) || 5813,
      pass: null,
      fuel: null,
      varianceTol: 0.1,
      nextReserve: 13,
      driveFolder: "",
    },
    "master/vehicles": { rows: [{ code: "MC-01", desc: "Hilux" }] },
    "master/parts": { rows: [{ cat: "FILTER — Oil", sub: "Filters" }] },
  };
}

function call(handler, event) {
  return handler({
    httpMethod: "POST",
    headers: {},
    body: "{}",
    ...event,
  });
}

describe("normalizeVrfRequest", () => {
  it("accepts vrf, vrfNumber, and RSV-12 / VRF-5812 spellings", () => {
    assert.deepEqual(normalizeVrfRequest({ vrf: "5812" }), {
      kind: "vrf",
      no: "5812",
      raw: "5812",
      bareNumber: true,
    });
    assert.deepEqual(normalizeVrfRequest({ vrfNumber: 5812 }), {
      kind: "vrf",
      no: "5812",
      raw: "5812",
      bareNumber: true,
    });
    assert.equal(normalizeVrfRequest({ vrf: "RSV-12" }).kind, "reserve");
    assert.equal(normalizeVrfRequest({ vrf: "rsv 12" }).no, "12");
    assert.equal(normalizeVrfRequest({ vrf: "VRF-5812" }).no, "5812");
    assert.equal(normalizeVrfRequest({ vrf: "VRF-5812" }).bareNumber, false);
  });

  it("rejects an empty body", () => {
    assert.throws(() => normalizeVrfRequest({}), (err) => err.statusCode === 400);
  });
});

describe("approve-from-hold (Office approve path)", () => {
  it("posts a pending hold onto the ledger as Open", async () => {
    const store = createMemoryStore(seedDocs());
    const out = await approvePendingVrf(
      store,
      { vrf: "5812", approverNote: "jeffrey-yes via Noah" },
      { now: "2026-09-21" }
    );
    assert.equal(out.ok, true);
    assert.equal(out.vrf, "5812");
    assert.equal(out.reserve, "12");
    assert.equal(out.status, "Open");
    assert.equal(out.approvedVia, "api");
    assert.equal(out.approverNote, "jeffrey-yes via Noah");

    const year = await store.get("reserves", "2026");
    const hold = year.rows[0];
    assert.equal(hold.status, "Approved");
    assert.equal(hold.approvedVia, "api");
    assert.equal(hold.approverNote, "jeffrey-yes via Noah");
    assert.deepEqual(hold.vrfs, ["5812"]);
    assert.equal(hold.approvedBudget, 12500);

    const month = await store.get("ledger", "2026-09");
    assert.equal(month.rows.length, 1);
    assert.equal(month.rows[0].vrf, "5812");
    assert.equal(month.rows[0].vstatus, "Open");
    assert.equal(month.rows[0].reserve, "12");
    assert.equal(month.rows[0].odo, 45210);
    assert.equal(month.rows[0].name, "Hilux");
    assert.equal(month.rows[0].total, 12500);
  });

  it("accepts RSV-12 as the hold key", async () => {
    const store = createMemoryStore(seedDocs());
    const out = await approvePendingVrf(store, { vrf: "RSV-12" }, { now: "2026-09-21" });
    assert.equal(out.vrf, "5812");
    assert.equal(out.reserve, "12");
  });

  it("does not remint a uniquely pending number", async () => {
    const store = createMemoryStore(seedDocs());
    const out = await approvePendingVrf(store, { vrfNumber: 5812 }, { now: "2026-09-21" });
    assert.equal(out.vrf, "5812");
    const cfg = await store.get("config", "app");
    assert.equal(cfg.nextVrf, 5813);
  });

  it("remints a colliding RSV-keyed hold and leaves the posted row untouched", async () => {
    const store = createMemoryStore(
      seedDocs({
        hold: { no: "44", vrfNo: "58528" },
        extraHolds: [
          {
            no: "40",
            vrfNo: "58528",
            status: "Approved",
            vrfs: ["58528"],
            date: "2026-09-20",
            draftLines: [],
          },
        ],
        ledgerRows: [{ vrf: "58528", date: "2026-09-20", total: 9000, src: "ledger", vstatus: "Open" }],
        nextVrf: 58529,
      })
    );
    const docs = await store.get("reserves", "2026");
    const pending = docs.rows.find((r) => r.no === "44");
    const posted = [{ vrf: "58528", src: "ledger" }];
    assert.equal(shouldRemintHeldVrf(pending, posted, docs.rows), true);

    const out = await approvePendingVrf(store, { vrf: "RSV-44" }, { now: "2026-09-21" });
    assert.equal(out.vrf, "58529");
    const year = await store.get("reserves", "2026");
    assert.equal(year.rows.find((r) => r.no === "44").vrfNo, "58529");
    const month = await store.get("ledger", "2026-09");
    assert.equal(month.rows.filter((r) => r.vrf === "58528").length, 1);
    assert.equal(month.rows.some((r) => r.vrf === "58529" && r.vstatus === "Open"), true);
  });

  it("never invents a VRF when the hold has no number or no lines", () => {
    const snapshot = {
      reserves: [],
      ledgerRows: [],
      ledgerByMonth: {},
      ledgerMonths: [],
      cfg: { nextVrf: 10 },
      vehicles: { rows: [] },
      parts: { rows: [] },
    };
    assert.throws(
      () => applyApproveFromHold(snapshot, pendingHold({ vrfNo: "" })),
      (err) => err.code === "missing_vrf_number"
    );
    assert.throws(
      () => applyApproveFromHold(snapshot, pendingHold({ draftLines: [] })),
      (err) => err.code === "no_draft_lines"
    );
  });
});

describe("approve-vrf Netlify function", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    process.env.APPROVE_VRF_SECRET = SECRET;
    delete process.env.MOTORPOOL_APPROVE_SECRET;
  });

  afterEach(() => {
    process.env = env;
  });

  function handlerWithSeed(over) {
    return createHandler({ store: createMemoryStore(seedDocs(over)) });
  }

  it("returns 401 when the secret is missing", async () => {
    const res = await call(handlerWithSeed(), {
      headers: {},
      body: JSON.stringify({ vrf: "5812" }),
    });
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "unauthorized");
    assert.doesNotMatch(res.body, new RegExp(SECRET));
  });

  it("returns 401 when the secret is wrong", async () => {
    const res = await call(handlerWithSeed(), {
      headers: { authorization: "Bearer totally-wrong" },
      body: JSON.stringify({ vrf: "5812" }),
    });
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).code, "unauthorized");
    assert.doesNotMatch(res.body, /totally-wrong/);
    assert.doesNotMatch(res.body, new RegExp(SECRET));
  });

  it("returns 404 when the VRF is not waiting for approval", async () => {
    const res = await call(handlerWithSeed(), {
      headers: { "x-approve-secret": SECRET },
      body: JSON.stringify({ vrf: "9999" }),
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "not_found");
    assert.match(body.error, /9999/);
  });

  it("approves a pending VRF the same way Office Approve posts the ledger", async () => {
    const store = createMemoryStore(seedDocs());
    const handler = createHandler({ store });
    const res = await call(handler, {
      headers: { authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ vrf: "5812", approverNote: "jeffrey-yes via Noah" }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.vrf, "5812");
    assert.equal(body.status, "Open");
    assert.equal(body.approvedVia, "api");
    const month = await store.get("ledger", "2026-09");
    assert.equal(month.rows[0].vstatus, "Open");
    const hold = (await store.get("reserves", "2026")).rows[0];
    assert.equal(hold.status, "Approved");
    assert.equal(hold.approvedVia, "api");
  });

  it("returns 409 when that VRF is already posted", async () => {
    const res = await call(
      handlerWithSeed({
        hold: { status: "Approved", vrfs: ["5812"], approvedBudget: 12500 },
        ledgerRows: [{ vrf: "5812", vstatus: "Open", src: "ledger" }],
      }),
      {
        headers: { "X-Approve-Secret": SECRET },
        body: JSON.stringify({ vrfNumber: 5812 }),
      }
    );
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).code, "already_posted");
  });

  it("returns 409 when a pending hold still shows a number that is already on the ledger", async () => {
    const res = await call(
      handlerWithSeed({
        ledgerRows: [{ vrf: "5812", vstatus: "Open", total: 12500 }],
      }),
      {
        headers: { authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ vrf: "5812" }),
      }
    );
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).code, "already_posted");
  });

  it("returns 409 on an ambiguous duplicate pending hold", async () => {
    const res = await call(
      handlerWithSeed({
        extraHolds: [pendingHold({ no: "99", vrfNo: "5812" })],
      }),
      {
        headers: { "x-approve-secret": SECRET },
        body: JSON.stringify({ vrf: "5812" }),
      }
    );
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).code, "ambiguous");
  });

  it("does not require a Motorpool session cookie when Auth is configured", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    const res = await call(handlerWithSeed(), {
      headers: { "x-approve-secret": SECRET },
      body: JSON.stringify({ vrf: "5812" }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).vrf, "5812");
  });

  it("answers OPTIONS with CORS and no secret", async () => {
    const res = await createHandler({ store: createMemoryStore(seedDocs()) })({
      httpMethod: "OPTIONS",
      headers: { origin: "https://builder.example" },
    });
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["access-control-allow-origin"], "*");
    assert.match(res.headers["access-control-allow-headers"], /X-Approve-Secret/);
  });

  it("returns 503 when the env secret is not set", async () => {
    delete process.env.APPROVE_VRF_SECRET;
    delete process.env.MOTORPOOL_APPROVE_SECRET;
    const res = await call(handlerWithSeed(), {
      headers: { authorization: "Bearer anything" },
      body: JSON.stringify({ vrf: "5812" }),
    });
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).code, "not_configured");
  });

  it("accepts MOTORPOOL_APPROVE_SECRET as the env name", async () => {
    delete process.env.APPROVE_VRF_SECRET;
    process.env.MOTORPOOL_APPROVE_SECRET = SECRET;
    const res = await call(handlerWithSeed(), {
      headers: { "x-approve-secret": SECRET },
      body: JSON.stringify({ vrf: "5812" }),
    });
    assert.equal(res.statusCode, 200);
  });

  it("does not list, reject, or edit amounts", async () => {
    const handler = handlerWithSeed();
    const get = await handler({ httpMethod: "GET", headers: { "x-approve-secret": SECRET } });
    assert.equal(get.statusCode, 405);
    const listed = await call(handler, {
      headers: { "x-approve-secret": SECRET },
      body: JSON.stringify({ action: "list" }),
    });
    assert.equal(listed.statusCode, 400);
  });
});

describe("resolveHold posted vs missing", () => {
  it("prefers already-posted over a colliding Requested hold when keyed by VRF number", () => {
    const snapshot = {
      reserves: [pendingHold()],
      ledgerRows: [{ vrf: "5812", src: "ledger" }],
    };
    assert.throws(
      () => resolveHold(snapshot, { kind: "vrf", no: "5812", bareNumber: true }),
      (err) => err.code === "already_posted"
    );
  });
});
