"use strict";
/* Jeffrey 2026-11-02: staff request a cancellation, an approver decides.
   One block per spec item. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const C = require("../public/vrf-cancel");
const G = require("../netlify/lib/cancel-guard");
const { applyCancel } = require("../netlify/lib/approve-cancel");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const sqlPath = path.join(__dirname, "../supabase/migrations/20261102000002_motorpool_cancel_approval_guard.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

const rows = () => [
  { vrf: "6264", veh: "DT-12", item: "Diesel", qty: 10, price: 60, total: 600, liters: 10, vstatus: "Open", reserve: "77" },
  { vrf: "6264", veh: "DT-12", item: "Oil", qty: 1, price: 400, total: 400, vstatus: "Open", reserve: "77" },
];
const reserve = () => ({ no: 77, date: "2026-10-20", status: "Approved", vrfs: ["6264"], approvedBudget: 1000, budget: 1000 });
const mkReq = (o) => C.newCancelRequest(Object.assign({ vrf: "6264", reserveNo: 77, rows: rows(), by: "Ana", reason: "no oil", at: "2026-11-01T09:00:00", prevStatus: "Open" }, o || {}));

function memRecords(init) {
  const recs = Object.assign({}, init || {});
  return { recs, io: { readRecord: async (id) => recs[id] || null } };
}
const ledgerRec = (r) => ({ id: "ledger:6264", kind: "ledger", reserve_no: "77", vrf_no: "6264", data: { vrf: "6264", rows: r } });
const reserveRec = (d) => ({ id: "reserve:77", kind: "reserve", reserve_no: "77", vrf_no: "6264", data: d });

/* ---------- Spec 1: no direct cancel for staff; request on VRF and each line ---------- */
test("spec 1: staff see Request cancellation on the VRF and on each line, reason required, attachment optional", () => {
  assert.match(html, /"Request cancellation"/);
  assert.match(html, /lineHeads\.push\("Cancellation"\)/);
  assert.match(html, /askCancelVrf\(entry, function\(\)\{ var fresh=vrfByNo\(entry\.vrf\)\|\|entry; openVrf\(fresh,"lines"\); \}, \{line:ix\}\)/);
  assert.match(html, /A reason is required\./);
  assert.match(html, /Photo or file \(optional\)/);
  assert.match(html, /att\.accept=MEDIA_ACCEPT/);
  /* cancelApprovedVrf (the only path that sets vstatus Cancelled) is reached only from the approver's decision. */
  const calls = html.match(/cancelApprovedVrf\(/g) || [];
  assert.equal(calls.length, 2, "definition + decideCancelRequest only");
  assert.match(html, /async function decideCancelRequest[\s\S]*?await cancelApprovedVrf\(entry, by, req\.reason\)/);
  assert.doesNotMatch(html, /"Cancel approved VRF"/);
  assert.throws(() => mkReq({ reason: "  " }));
});

/* ---------- Spec 2: status Cancellation requested, nothing else changes ---------- */
test("spec 2: a request records who/when/reason/previous status and leaves the VRF as it is", () => {
  const q = mkReq({ lines: [1], attachments: [{ id: "vrf-CXL-6264__1", owner: "CXL-6264", idx: 1 }] });
  assert.equal(q.status, "Requested");
  assert.equal(q.by, "Ana");
  assert.equal(q.at, "2026-11-01T09:00:00");
  assert.equal(q.reason, "no oil");
  assert.equal(q.prevStatus, "Open");
  assert.deepStrictEqual(q.prevLineStatuses, ["Open"]);
  assert.equal(q.unit, "DT-12");
  assert.equal(q.attachments.length, 1);
  const r = C.addCancelRequest(reserve(), q);
  assert.equal(r.status, "Approved");
  assert.equal(r.approvedBudget, 1000);
  assert.match(html, /"Cancellation requested"/);
  assert.match(html, /pc\.title="Requested by "\+pq\.by\+" on "\+pq\.at\+" — "\+pq\.reason/);
});

/* ---------- Spec 3: approver list, approve/reject with note ---------- */
test("spec 3: approve sets Cancelled with approver + time; reject returns exactly to the previous status", async () => {
  const mk = () => {
    const st = { ledger: { reserve_no: "77", month: "2026-10", data: { rows: rows() } }, reserve: { year: "2026", data: C.addCancelRequest(reserve(), mkReq({ lines: [1] })) }, saved: [] };
    return {
      st,
      readLedger: async () => st.ledger,
      readReserve: async () => st.reserve,
      findReserveByVrf: async () => st.reserve,
      saveLedger: async (s) => { st.saved.push(["ledger", JSON.parse(JSON.stringify(s))]); st.ledger = { reserve_no: "77", month: s.month, data: { rows: s.rows } }; },
      putReserve: async (s) => { st.saved.push(["reserve", JSON.parse(JSON.stringify(s))]); st.reserve = { year: s.year, data: s.reserve }; },
    };
  };
  const before = rows();
  const rj = mk();
  await applyCancel(rj, { vrf: "6264", reject: true, note: "it was bought", by: "Jeffrey" });
  assert.deepStrictEqual(rj.st.ledger.data.rows, before);
  assert.equal(rj.st.reserve.data.status, "Approved");
  const rq = rj.st.reserve.data.cancelRequests[0];
  assert.equal(rq.status, "Rejected");
  assert.equal(rq.decisionNote, "it was bought");

  const ok = mk();
  await applyCancel(ok, { vrf: "6264", note: "fine, supplier out", by: "Jeffrey" });
  const q = ok.st.reserve.data.cancelRequests[0];
  assert.equal(q.status, "Approved");
  assert.equal(q.decidedBy, "Jeffrey");
  assert.ok(q.decidedAt);
  assert.equal(q.decisionNote, "fine, supplier out");
  assert.equal(ok.st.ledger.data.rows[1].vstatus, "Cancelled");
  /* The decision is saved before the cancel is applied. */
  assert.equal(ok.st.saved[0][0], "reserve");
  assert.equal(ok.st.saved[0][1].reserve.cancelRequests[0].status, "Approved");
  assert.equal(ok.st.saved[1][0], "ledger");

  assert.match(html, /hd\.appendChild\(el\("h3",null,"Cancellation requests"\)\)/);
  assert.match(html, /note\.placeholder="Decision note"/);
  assert.match(html, /Unlock Office \(the approver passcode\) to decide cancellation requests\./);
});

test("spec 3: only an approver may decide (admin, MOTORPOOL_CANCEL_APPROVERS, Office passcode)", () => {
  const oldA = process.env.MOTORPOOL_CANCEL_APPROVERS, oldH = process.env.MOTORPOOL_OFFICE_PASS_HASH;
  try {
    delete process.env.MOTORPOOL_CANCEL_APPROVERS; delete process.env.MOTORPOOL_OFFICE_PASS_HASH;
    assert.equal(G.isApprover({ role: "staff", name: "Ana" }), false);
    assert.equal(G.isApprover({ role: "admin" }), true);
    process.env.MOTORPOOL_CANCEL_APPROVERS = "jeffrey@example.com, Jeffrey Corro";
    assert.equal(G.isApprover({ email: "Jeffrey@example.com" }), true);
    assert.equal(G.isApprover({ name: "Ana" }), false);
    assert.equal(G.isApprover({ name: "Ana" }, { pass: "pass-1234", cfgPass: C.officeHash("pass-1234") }), true);
    assert.equal(G.isApprover({ name: "Ana" }, { pass: "wrong", cfgPass: C.officeHash("pass-1234") }), false);
    process.env.MOTORPOOL_OFFICE_PASS_HASH = crypto.createHash("sha256").update("pass-5678").digest("hex");
    assert.equal(G.isApprover({ name: "Ana" }, { pass: "pass-5678" }), true);
  } finally {
    if (oldA === undefined) delete process.env.MOTORPOOL_CANCEL_APPROVERS; else process.env.MOTORPOOL_CANCEL_APPROVERS = oldA;
    if (oldH === undefined) delete process.env.MOTORPOOL_OFFICE_PASS_HASH; else process.env.MOTORPOOL_OFFICE_PASS_HASH = oldH;
  }
  /* office hash matches the page's own hash() */
  assert.match(html, /function hash\(s\)\{ var h=5381,i; for\(i=0;i<s\.length;i\+\+\) h=\(\(h\*33\)\^s\.charCodeAt\(i\)\)>>>0; return "h"\+h\.toString\(36\); \}/);
  assert.match(html, /approverPass:S\.officePass/);
});

/* ---------- Spec 4: server + DB enforcement, bypass ---------- */
test("spec 4: server refuses a Cancelled line or reserve without an approved request", async () => {
  const pending = C.addCancelRequest(reserve(), mkReq({ lines: [1] }));
  const { io } = memRecords({ "reserve:77": reserveRec(pending), "ledger:6264": ledgerRec(rows()) });
  const cx = rows(); cx[1].vstatus = "Cancelled";
  await assert.rejects(G.guardCancelWrite(ledgerRec(cx), io, { approver: true }), (e) => e.code === "cancel_approval_required" && e.statusCode === 409);
  await assert.rejects(G.guardCancelWrite(reserveRec(Object.assign({}, pending, { status: "Cancelled", cancelOutcome: "cancelled" })), io, { approver: true }));
  /* not bought / duplicate closes are not cancellations */
  await G.guardCancelWrite(reserveRec(Object.assign({}, pending, { status: "Cancelled", cancelOutcome: "not-bought" })), io, {});
  await G.guardCancelWrite(reserveRec(Object.assign({}, pending, { status: "Cancelled", cancelOutcome: "duplicate" })), io, {});

  const approved = C.decideRequest(pending, pending.cancelRequests[0].id, "Approved", "Jeffrey", "2026-11-02", "");
  /* deciding needs an approver */
  await assert.rejects(G.guardCancelWrite(reserveRec(approved), io, { approver: false }), (e) => e.code === "cancel_approver_required" && e.statusCode === 403);
  await G.guardCancelWrite(reserveRec(approved), io, { approver: true });
  /* staff can file a new request */
  await G.guardCancelWrite(reserveRec(pending), memRecords({ "reserve:77": reserveRec(reserve()) }).io, { approver: false });
  /* but cannot slip in an already-approved one */
  await assert.rejects(G.guardCancelWrite(reserveRec(approved), memRecords({ "reserve:77": reserveRec(reserve()) }).io, {}));

  const after = memRecords({ "reserve:77": reserveRec(approved), "ledger:6264": ledgerRec(rows()) });
  await G.guardCancelWrite(ledgerRec(cx), after.io, {});
  const wrong = rows(); wrong[0].vstatus = "Cancelled";
  await assert.rejects(G.guardCancelWrite(ledgerRec(wrong), after.io, {}));
  /* decided requests cannot be edited or removed by staff */
  await assert.rejects(G.guardCancelWrite(reserveRec(Object.assign({}, approved, { cancelRequests: [] })), after.io, {}));
});

test("spec 4: MOTORPOOL_ALLOW_CANCEL_WITHOUT_APPROVAL=on is the documented admin repair bypass", async () => {
  const { io } = memRecords({ "reserve:77": reserveRec(reserve()), "ledger:6264": ledgerRec(rows()) });
  const cx = rows(); cx[0].vstatus = "Cancelled";
  const old = process.env.MOTORPOOL_ALLOW_CANCEL_WITHOUT_APPROVAL;
  try {
    process.env.MOTORPOOL_ALLOW_CANCEL_WITHOUT_APPROVAL = "on";
    await G.guardCancelWrite(ledgerRec(cx), io, {});
  } finally {
    if (old === undefined) delete process.env.MOTORPOOL_ALLOW_CANCEL_WITHOUT_APPROVAL; else process.env.MOTORPOOL_ALLOW_CANCEL_WITHOUT_APPROVAL = old;
  }
  await assert.rejects(G.guardCancelWrite(ledgerRec(cx), io, {}));
});

test("spec 4: writeRecord runs the guard; db.js strips approverPass", () => {
  const sb = fs.readFileSync(path.join(__dirname, "../netlify/lib/supabase.js"), "utf8");
  assert.match(sb, /async function writeRecord\(row, exists, expectUpdatedAt\) \{\n  await require\("\.\/cancel-guard"\)\.guardCancelWrite\(row, \{ readRecord \}\);/);
  const db = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");
  assert.match(db, /delete spec\.approverPass;/);
  assert.match(db, /cancelGuard\.runWithContext\(cancelCtx/);
});

test("spec 4: migration has the trigger, the bypass setting and a rollback header", () => {
  assert.match(sql, /create trigger motorpool_records_cancel_approval\s+before insert or update on public\.motorpool_records/);
  assert.match(sql, /current_setting\('motorpool\.allow_cancel_without_approval', true\)/);
  assert.match(sql, /-- Rollback:\n--   drop trigger if exists motorpool_records_cancel_approval/);
  assert.match(sql, /not in \('not-bought', 'duplicate'\)/);
});

let PGlite = null;
try { PGlite = require(require.resolve("@electric-sql/pglite", { paths: [process.cwd(), "/tmp/pgl"] })).PGlite; } catch (e) { PGlite = null; }
test("spec 4: trigger behaviour in Postgres (PGlite, skipped when not installed)", { skip: !PGlite && "@electric-sql/pglite not installed" }, async () => {
  const db = new PGlite();
  await db.exec("create table public.motorpool_records (id text primary key, kind text not null, reserve_no text, vrf_no text, live boolean not null default true, year text, month text, data jsonb not null);");
  await db.exec(sql);
  const q = (st, extra) => JSON.stringify([Object.assign({ id: "cx1", vrf: "6264", scope: "lines", lines: [1], status: st }, extra || {})]);
  const ex = (s, p) => db.query(s, p || []);
  await ex("insert into motorpool_records(id,kind,reserve_no,vrf_no,data) values('reserve:77','reserve','77','6264',$1)", [JSON.stringify({ no: 77, status: "Approved", cancelRequests: JSON.parse(q("Requested")) })]);
  await ex("insert into motorpool_records(id,kind,reserve_no,vrf_no,data) values('ledger:6264','ledger','77','6264',$1)", [JSON.stringify({ vrf: "6264", rows: [{ vstatus: "Open" }, { vstatus: "Open" }] })]);
  const setRows = (r) => ex("update motorpool_records set data=$1 where id='ledger:6264'", [JSON.stringify({ vrf: "6264", rows: r })]);
  await assert.rejects(setRows([{ vstatus: "Open" }, { vstatus: "Cancelled" }]), /approved cancellation request/);
  await assert.rejects(ex(`update motorpool_records set data=data||'{"status":"Cancelled","cancelOutcome":"cancelled"}' where id='reserve:77'`), /approved cancellation request/);
  await ex("update motorpool_records set data=jsonb_set(data,'{cancelRequests}',$1::jsonb) where id='reserve:77'", [q("Approved", { decidedBy: "Jeffrey", decidedAt: "2026-11-02" })]);
  await assert.rejects(setRows([{ vstatus: "Cancelled" }, { vstatus: "Open" }]));
  await setRows([{ vstatus: "Open" }, { vstatus: "Cancelled" }]);
  await assert.rejects(ex("update motorpool_records set data=data-'cancelRequests' where id='reserve:77'"), /already decided/);
  await db.exec(`begin; set local motorpool.allow_cancel_without_approval='on'; update motorpool_records set data='{"vrf":"6264","rows":[{"vstatus":"Cancelled"},{"vstatus":"Cancelled"}]}' where id='ledger:6264'; commit;`);
  await assert.rejects(setRows([{ vstatus: "Cancelled" }, { vstatus: "Cancelled" }, { vstatus: "Cancelled" }]));
  await db.close();
});

/* ---------- Spec 5: Cancellations log + CSV ---------- */
test("spec 5: cancellations log columns and CSV export", () => {
  const r = C.addCancelRequest(reserve(), mkReq({ lines: [1], reason: 'said "no", later' }));
  const d = C.decideRequest(r, r.cancelRequests[0].id, "Approved", "Jeffrey", "2026-11-02", "ok");
  const csv = C.cancelLogCsv(C.cancelLogEntries([d]));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], "VRF,Reserve,Lines,Unit,Amount,Requested by,Requested at,Reason,Outcome,Decided by,Decided at,Decision note,Previous status,Warnings,Attachments");
  assert.match(lines[1], /^6264,77,/);
  assert.match(lines[1], /,DT-12,400\.00,Ana,2026-11-01T09:00:00,"said ""no"", later",Approved,Jeffrey,2026-11-02,ok,Open,/);
  for (const h of ['"VRF"', '"Line"', '"Unit"', '"Amount"', '"Requested"', '"Reason"', '"Decided"', '"Note"', '"Outcome"']) assert.ok(html.includes("{h:" + h), h);
  assert.match(html, /"Export CSV"/);
  assert.match(html, /cxllog:vrfCancelLogView/);
});

/* ---------- Spec 6: fuel / money / liquidation warnings ---------- */
test("spec 6: warnings for fuel withdrawn, money released and liquidation, on the request form and the approval screen", () => {
  const entry = { vrf: "6264", status: "Open", rows: rows() };
  const w = C.riskWarnings({ entry, reserve: reserve(), withdrawals: [{ vrf: "6264", liters: 40 }, { vrf: "9999", liters: 5 }] });
  const codes = w.map((x) => x.code);
  assert.ok(codes.includes("fuel_withdrawn"));
  assert.match(w.find((x) => x.code === "fuel_withdrawn").msg, /40 L/);
  assert.ok(codes.includes("money_released"));
  assert.ok(!codes.includes("liquidated"));
  const liq = C.riskWarnings({ entry: { vrf: "6264", status: "Closed", rows: rows().map((r) => Object.assign(r, { vstatus: "Closed" })) }, reserve: Object.assign(reserve(), { status: "Closed", liquidatedAt: "2026-10-25" }) });
  assert.ok(liq.some((x) => x.code === "liquidated"));
  const none = C.riskWarnings({ entry: { vrf: "6264", status: "Requested", rows: [] }, reserve: { no: 77, status: "Requested" }, withdrawals: [] });
  assert.deepStrictEqual(none, []);
  /* request form and approval card both render them */
  assert.match(html, /function askCancelVrf[\s\S]*?cancelRiskWarnings\(entry, rsv, p\)/);
  assert.match(html, /function cancelRequestsCard[\s\S]*?\{h:"Warnings"/);
});
