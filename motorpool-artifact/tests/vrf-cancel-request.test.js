"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const C = require("../public/vrf-cancel");
const { applyCancel } = require("../netlify/lib/approve-cancel");
const { createHandler } = require("../netlify/functions/approve-cancel");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const rows = () => [
  { vrf: "6264", month: "2026-10", item: "Diesel", qty: 10, price: 60, total: 600, liters: 10, vstatus: "Approved" },
  { vrf: "6264", month: "2026-10", item: "Oil", qty: 1, price: 400, total: 400, vstatus: "Approved" },
];
const reserve = () => ({ no: 77, date: "2026-10-20", status: "Approved", vrfs: ["6264"], approvedBudget: 1000, budget: 1000 });

function memStore(extra) {
  const st = { ledger: { "6264": { reserve_no: "77", month: "2026-10", data: { rows: rows() } } }, reserve: { year: "2026", data: reserve() }, saved: [] };
  Object.assign(st, extra || {});
  return {
    st,
    readLedger: async (v) => st.ledger[v] || null,
    readReserve: async () => st.reserve,
    findReserveByVrf: async () => st.reserve,
    saveLedger: async (s) => { st.saved.push(["ledger", s]); st.ledger[s.vrf] = { reserve_no: "77", month: s.month, data: { rows: s.rows } }; },
    putReserve: async (s) => { st.saved.push(["reserve", s]); st.reserve = { year: s.year, data: s.reserve }; },
  };
}

test("a request needs a reason and a name, and changes no amounts", () => {
  assert.throws(() => C.newCancelRequest({ vrf: "6264", reserveNo: 77, rows: rows(), by: "Ana", reason: "" }));
  assert.throws(() => C.newCancelRequest({ vrf: "6264", reserveNo: 77, rows: rows(), by: "", reason: "x" }));
  const q = C.newCancelRequest({ vrf: "6264", reserveNo: 77, rows: rows(), lines: [1], by: "Ana", reason: "no oil", at: "2026-11-01" });
  assert.equal(q.scope, "lines");
  assert.equal(q.amount, 400);
  const r = C.addCancelRequest(reserve(), q);
  assert.equal(r.approvedBudget, 1000);
  assert.equal(C.pendingCancel(r, "6264").id, q.id);
  assert.throws(() => C.addCancelRequest(r, q), /already/);
});

test("server approve of a line cancel zeroes only those lines and lowers the budget", async () => {
  const s = memStore();
  s.st.reserve.data = C.addCancelRequest(reserve(), C.newCancelRequest({ vrf: "6264", reserveNo: 77, rows: rows(), lines: [1], by: "Ana", reason: "no oil", at: "2026-11-01" }));
  const out = await applyCancel(s, { vrf: "6264" });
  assert.equal(out.decision, "Approved");
  assert.equal(out.amount, 400);
  const lr = s.st.ledger["6264"].data.rows;
  assert.equal(lr[0].total, 600);
  assert.equal(lr[1].total, 0);
  assert.equal(s.st.reserve.data.approvedBudget, 600);
  assert.equal(C.pendingCancel(s.st.reserve.data, "6264"), null);
});

test("server whole-VRF cancel with no request needs a reason, then cancels the reserve", async () => {
  const s = memStore();
  await assert.rejects(applyCancel(s, { vrf: "6264" }));
  const out = await applyCancel(memStore(), { vrf: "6264", reason: "supplier had none" });
  assert.equal(out.scope, "vrf");
  assert.equal(out.amount, 1000);
  assert.equal(out.reserveStatus, "Cancelled");
});

test("reject leaves amounts alone and logs the decision", async () => {
  const s = memStore();
  s.st.reserve.data = C.addCancelRequest(reserve(), C.newCancelRequest({ vrf: "6264", reserveNo: 77, rows: rows(), by: "Ana", reason: "x", at: "2026-11-01" }));
  const out = await applyCancel(s, { vrf: "6264", reject: true, note: "it was bought" });
  assert.equal(out.decision, "Rejected");
  assert.equal(s.st.saved.filter((x) => x[0] === "ledger").length, 0);
  const log = C.cancelLogEntries([s.st.reserve.data]);
  assert.equal(log[0].status, "Rejected");
});

test("approve-cancel is secret gated", async () => {
  const old = process.env.APPROVE_VRF_SECRET;
  process.env.APPROVE_VRF_SECRET = "test-secret-not-real";
  try {
    const h = createHandler({ store: memStore() });
    assert.equal((await h({ httpMethod: "POST", headers: {}, body: "{}" })).statusCode, 401);
    const ok = await h({ httpMethod: "POST", headers: { authorization: "Bearer test-secret-not-real" }, body: JSON.stringify({ vrf: "6264", lines: [0], reason: "no diesel" }) });
    assert.equal(ok.statusCode, 200);
    assert.equal(JSON.parse(ok.body).amount, 600);
  } finally {
    if (old === undefined) delete process.env.APPROVE_VRF_SECRET; else process.env.APPROVE_VRF_SECRET = old;
  }
});

test("index.html wires request, approver card and the cancellations log", () => {
  assert.match(html, /<script src="\/vrf-cancel.js"><\/script>/);
  assert.match(html, /function requestVrfCancel/);
  assert.match(html, /function cancelRequestsCard/);
  assert.match(html, /cxllog:vrfCancelLogView/);
  assert.match(html, /"Cancellations Log"/);
  assert.match(html, /"Cancellation requested"/);
  assert.doesNotMatch(html, /"Cancel approved VRF"/);
});
