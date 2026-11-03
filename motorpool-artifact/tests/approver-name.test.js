"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveApprover, DEFAULT_APPROVERS } = require("../netlify/lib/approvers");
const { approvePendingVrf, createMemoryStore } = require("../netlify/lib/approve-from-hold");
const { createHandler } = require("../netlify/functions/approve-vrf");

function pendingHold() {
  return {
    no: "12",
    vrfNo: "5812",
    date: "2026-09-21",
    kind: "job",
    veh: "MC-01",
    work: "PM",
    project: "HH",
    budget: 12500,
    requestedBy: "Jun Cruz",
    status: "Requested",
    approvedBudget: null,
    approvedBy: "",
    approvedAt: "",
    vrfs: [],
    draftLines: [{ cat: "FILTER — Oil", item: "Oil filter", qty: 1, price: 12500, unit: "pc", supplier: "315", work: "PM" }],
  };
}

function store() {
  return createMemoryStore({
    "reserves/index": { years: ["2026"] },
    "reserves/2026": { year: "2026", rows: [pendingHold()] },
    "ledger/index": { months: ["2026-09"] },
    "ledger/2026-09": { month: "2026-09", rows: [] },
    "config/app": { nextVrf: 5813, nextReserve: 13, varianceTol: 0.1 },
    "master/vehicles": { rows: [{ code: "MC-01", desc: "Hilux" }] },
    "master/parts": { rows: [] },
  });
}

describe("approver names", () => {
  it("accepts Jeffrey and stores his full name with a timestamp and via api", async () => {
    const out = await approvePendingVrf(
      store(),
      { vrf: "5812", approvedBy: "Jeffrey", approverNote: "yes" },
      { now: "2026-09-21" }
    );
    assert.equal(out.approvedBy, "Jeffrey James M. Corro");
    assert.equal(out.via, "api");
    assert.equal(out.approvedVia, "api");
    assert.equal(out.approvedAt, "2026-09-21T00:00:00+08:00");
    const hold = (await store().get("reserves", "2026")).rows;
    assert.ok(hold);
  });

  it("records the canonical name on the reserve and the audit", async () => {
    const mem = store();
    await approvePendingVrf(mem, { vrf: "5812", approvedBy: "Jeffrey Corro" }, { now: "2026-09-21T16:05:00+08:00" });
    const hold = (await mem.get("reserves", "2026")).rows[0];
    assert.equal(hold.approvedBy, "Jeffrey James M. Corro");
    assert.equal(hold.approvedAt, "2026-09-21T16:05:00+08:00");
    assert.equal(hold.via, "api");
    const note = (hold.audit || []).find((n) => n.field === "status");
    assert.equal(note.by, "Jeffrey James M. Corro");
    assert.equal(note.at, "2026-09-21T16:05:00+08:00");
    assert.equal(note.via, "api");
    assert.notEqual(hold.approvedBy, "api");
  });

  it("accepts Carmel", async () => {
    const mem = store();
    const out = await approvePendingVrf(mem, { vrf: "5812", approvedBy: "Carmel" }, { now: "2026-09-21" });
    assert.equal(out.approvedBy, "Carmel");
    const hold = (await mem.get("reserves", "2026")).rows[0];
    assert.equal(hold.approvedBy, "Carmel");
    assert.match(hold.approvedAt, /2026-09-21T/);
    assert.equal((hold.audit || []).find((n) => n.field === "status").by, "Carmel");
  });

  it("rejects a missing name and any other name, including api", async () => {
    await assert.rejects(
      () => approvePendingVrf(store(), { vrf: "5812" }, { now: "2026-09-21" }),
      (err) => err.statusCode === 400 && err.code === "approver_required"
    );
    await assert.rejects(
      () => approvePendingVrf(store(), { vrf: "5812", approvedBy: "api" }, { now: "2026-09-21" }),
      (err) => err.statusCode === 400 && err.code === "approver_not_allowed" && /cannot be "api"/.test(err.message)
    );
    await assert.rejects(
      () => approvePendingVrf(store(), { vrf: "5812", approvedBy: "Noah" }, { now: "2026-09-21" }),
      (err) => err.statusCode === 400 && err.code === "approver_not_allowed"
    );
    const untouched = await store().get("reserves", "2026");
    assert.equal(untouched.rows[0].status, "Requested");
    assert.equal(resolveApprover("Office").ok, false);
    assert.equal(DEFAULT_APPROVERS[1].name, "Carmel");
  });

  it("returns 400 from the function when the approver is missing", async () => {
    process.env.APPROVE_VRF_SECRET = "approver-name-test-secret";
    const handler = createHandler({ store: store() });
    const res = await handler({
      httpMethod: "POST",
      headers: { "x-approve-secret": "approver-name-test-secret" },
      body: JSON.stringify({ vrf: "5812", approvedBy: "api" }),
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "approver_not_allowed");
    delete process.env.APPROVE_VRF_SECRET;
  });
});
