"use strict";

/* PR: block stale saves from resetting approvals (VRF 6264, 2026-10-30). */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const guard = require("../public/vrf-save-guard.js");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const sql = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20261101000001_motorpool_stale_save_guard.sql"),
  "utf8"
);

describe("vrf-save-guard rules", () => {
  it("refuses Approved/Open/Closed/Cancelled back to Requested or draft", () => {
    ["Approved", "Open", "Closed", "Cancelled"].forEach((prev) => {
      ["Requested", "Draft", ""].forEach((next) => {
        const ref = guard.checkReserveWrite({ status: prev, vrfNo: "6264" }, { status: next, vrfNo: "6264" });
        assert.ok(ref, prev + "->" + next);
        assert.equal(ref.code, "vrf_changed_elsewhere");
        assert.match(ref.message, /approved\/changed elsewhere/);
        assert.match(ref.message, /reload/i);
      });
    });
  });

  it("allows forward moves and same-status edits", () => {
    assert.equal(guard.checkReserveWrite({ status: "Requested" }, { status: "Approved" }), null);
    assert.equal(guard.checkReserveWrite({ status: "Approved" }, { status: "Closed" }), null);
    assert.equal(guard.checkReserveWrite({ status: "Approved", rev: 3 }, { status: "Approved", rev: 3 }), null);
    assert.equal(guard.checkReserveWrite(null, { status: "Requested" }), null);
  });

  it("refuses a save based on an older revision", () => {
    const ref = guard.checkReserveWrite({ status: "Requested", rev: 4 }, { status: "Requested", rev: 3 });
    assert.equal(ref.reason, "stale_rev");
  });

  it("ledger: refuses explicit Requested lines over an Open VRF, ignores blank-status new lines", () => {
    const prev = { rows: [{ vrf: "6264", vstatus: "Open", rev: 2 }] };
    assert.equal(guard.checkLedgerWrite(prev, [{ vrf: "6264", vstatus: "Requested", rev: 2 }]).reason, "downgrade");
    assert.equal(guard.checkLedgerWrite(prev, [{ vrf: "6264", vstatus: "Open", rev: 2 }, { vrf: "6264" }]), null);
    assert.equal(guard.checkLedgerWrite(prev, [{ vrf: "6264", vstatus: "Open", rev: 1 }]).reason, "stale_rev");
    assert.equal(guard.checkLedgerWrite(prev, [{ vrf: "6264", vstatus: "Requested" }], "append"), null);
  });
});

describe("server enforcement in netlify/lib/supabase.js", () => {
  const saved = {};
  let store;
  let calls;
  beforeEach(() => {
    ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE", "SUPABASE_SERVICE_ROLE_KEY"].forEach((k) => (saved[k] = process.env[k]));
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE = "test-only-not-a-secret";
    saved.fetch = global.fetch;
    calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), opts });
      const u = new URL(String(url));
      const id = decodeURIComponent((u.searchParams.get("id") || "").replace(/^eq\./, ""));
      if (opts.method === "GET") {
        return { ok: true, status: 200, text: async () => JSON.stringify(store[id] ? [store[id]] : []) };
      }
      if (opts.method === "PATCH") {
        const want = u.searchParams.get("updated_at");
        if (want && store[id] && "eq." + store[id].updated_at !== want) {
          return { ok: true, status: 200, text: async () => "[]" };
        }
        store[id] = Object.assign({}, store[id], JSON.parse(opts.body), { updated_at: "t2" });
        return { ok: true, status: 200, text: async () => JSON.stringify([store[id]]) };
      }
      store[JSON.parse(opts.body).id] = JSON.parse(opts.body);
      return { ok: true, status: 201, text: async () => "" };
    };
  });
  afterEach(() => {
    global.fetch = saved.fetch;
    Object.keys(saved).forEach((k) => {
      if (k === "fetch") return;
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it("refuses the 6264 reset: an old tab saving Requested over Approved", async () => {
    const db = require("../netlify/lib/supabase");
    store = {
      "reserve:90": { id: "reserve:90", kind: "reserve", reserve_no: "90", vrf_no: "6264", live: true, year: "2026",
        month: null, updated_at: "t1", data: { no: "90", vrfNo: "6264", status: "Approved", rev: 2 } },
    };
    await assert.rejects(
      db.putReserveRecord({ year: "2026", reserve: { no: "90", vrfNo: "6264", status: "Requested" } }),
      (err) => err.code === "vrf_changed_elsewhere" && err.statusCode === 409 && /reload/i.test(err.message)
    );
    assert.equal(store["reserve:90"].data.status, "Approved");
    assert.equal(calls.filter((c) => c.opts.method === "PATCH").length, 0);
  });

  it("bumps rev and writes with an updated_at compare-and-set", async () => {
    const db = require("../netlify/lib/supabase");
    store = {
      "reserve:91": { id: "reserve:91", kind: "reserve", reserve_no: "91", vrf_no: "6300", live: true, year: "2026",
        month: null, updated_at: "t1", data: { no: "91", vrfNo: "6300", status: "Approved", rev: 2, note: "a" } },
    };
    const out = await db.putReserveRecord({ year: "2026", reserve: { no: "91", vrfNo: "6300", status: "Approved", rev: 2, note: "b" } });
    assert.equal(out.wrote, true);
    assert.equal(store["reserve:91"].data.rev, 3);
    const patch = calls.find((c) => c.opts.method === "PATCH");
    assert.match(patch.url, /updated_at=eq\.t1/);
    await assert.rejects(
      db.putReserveRecord({ year: "2026", reserve: { no: "91", vrfNo: "6300", status: "Approved", rev: 2, note: "c" } }),
      (err) => err.code === "vrf_changed_elsewhere"
    );
  });

  it("ledger replace returns the new rev and refuses a stale copy", async () => {
    const db = require("../netlify/lib/supabase");
    store = {
      "ledger:6264": { id: "ledger:6264", kind: "ledger", vrf_no: "6264", month: "2026-10", updated_at: "t1",
        data: { month: "2026-10", vrf: "6264", rows: [{ vrf: "6264", vstatus: "Open", total: 100, rev: 1 }] } },
    };
    const ok = await db.saveLedgerVrf({ vrf: "6264", month: "2026-10", rows: [{ vrf: "6264", vstatus: "Open", total: 120, rev: 1 }] });
    assert.equal(ok.rev, 2);
    await assert.rejects(
      db.saveLedgerVrf({ vrf: "6264", month: "2026-10", rows: [{ vrf: "6264", vstatus: "Open", total: 90, rev: 1 }] }),
      (err) => err.code === "vrf_changed_elsewhere"
    );
    await assert.rejects(
      db.saveLedgerVrf({ vrf: "6264", month: "2026-10", rows: [{ vrf: "6264", vstatus: "Requested", total: 120, rev: 2 }] }),
      (err) => err.code === "vrf_changed_elsewhere"
    );
  });

  it("maps the trigger error to a 409 vrf_changed_elsewhere", async () => {
    const db = require("../netlify/lib/supabase");
    store = {
      "reserve:92": { id: "reserve:92", kind: "reserve", reserve_no: "92", vrf_no: "1", year: "2026", updated_at: "t1",
        data: { no: "92", vrfNo: "1", status: "Requested" } },
    };
    const inner = global.fetch;
    global.fetch = async (url, opts) => {
      if (opts.method === "PATCH") {
        return { ok: false, status: 400, text: async () => JSON.stringify({ code: "P0409", message: "vrf_changed_elsewhere: VRF 1 is Approved" }) };
      }
      return inner(url, opts);
    };
    await assert.rejects(
      db.putReserveRecord({ year: "2026", reserve: { no: "92", vrfNo: "1", status: "Requested", note: "x" } }),
      (err) => err.code === "vrf_changed_elsewhere" && err.statusCode === 409 && /approved\/changed elsewhere/.test(err.message)
    );
  });
});

describe("migration and browser wiring", () => {
  it("adds a before-update trigger with downgrade and revision checks", () => {
    assert.match(sql, /create trigger motorpool_records_stale_guard\s+before update on public\.motorpool_records/);
    assert.match(sql, /motorpool_vrf_status_protected/);
    assert.match(sql, /'requested', 'draft'/);
    assert.match(sql, /new_rev < old_rev/);
    assert.match(sql, /motorpool\.allow_status_downgrade/);
    assert.match(sql, /NOT run against production/);
  });

  it("loads the guard, checks reserves before saving, and shows a reload message", () => {
    assert.match(html, /<script src="\/vrf-save-guard\.js"><\/script>/);
    assert.match(html, /function staleSaveNotice\(e\)/);
    assert.match(html, /approved\/changed elsewhere/);
    assert.match(html, /Reload now/);
    assert.match(html, /VrfSaveGuard\.checkReserveWrite\(srv, mineR\)/);
    assert.match(html, /stampLedgerRev\(month, no, ack\.rev\)/);
  });
});
