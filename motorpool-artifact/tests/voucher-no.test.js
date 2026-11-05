"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const voucher = require("../public/voucher-no");
const { matchFinanceVouchers, safeKey } = require("../netlify/lib/finance-voucher-match");
const { handler } = require("../netlify/functions/voucher-match");
const { COOKIE_NAME, signSession } = require("../netlify/lib/session");
const { buildMonthlyVrfReport } = require("../public/vrf-report");
const { applyReserveReopen } = require("./lib/rules");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const SECRET = "test-motorpool-gate-secret-value";

describe("voucher number normalization", () => {
  it("keeps the value as entered and stores a match key", () => {
    const pcv = voucher.normalize("  PCV-0123  ");
    assert.equal(pcv.voucherNo, "PCV-0123");
    assert.equal(pcv.voucherKey, "PCV-0123");
    assert.equal(pcv.hint, "petty");

    const digits = voucher.normalize("0123");
    assert.equal(digits.voucherNo, "0123");
    assert.equal(digits.voucherKey, "0123");
    assert.equal(digits.hint, "");

    const spaced = voucher.normalize("pc 2026-0007");
    assert.equal(spaced.voucherNo, "pc 2026-0007");
    assert.equal(spaced.voucherKey, "PC2026-0007");
    assert.equal(spaced.hint, "petty");
  });

  it("leaves a blank value empty", () => {
    assert.deepEqual(voucher.normalize("   "), { voucherNo: "", voucherKey: "", hint: "" });
    assert.deepEqual(voucher.normalize(null), { voucherNo: "", voucherKey: "", hint: "" });
    assert.deepEqual(voucher.lookupKeys(voucher.normalize("")), []);
  });

  it("infers a hint only from a known prefix", () => {
    assert.equal(voucher.normalize("2026Gcash-0004").hint, "gcash");
    assert.equal(voucher.normalize("DV2026-0008").hint, "check");
    assert.equal(voucher.normalize("BPI2026-1000274146").hint, "check");
    assert.equal(voucher.normalize("OR-99").hint, "");
    assert.equal(voucher.hintText("petty"), "Looks like a petty cash voucher.");
    assert.equal(voucher.hintText("gcash"), "Looks like a GCash voucher.");
    assert.equal(voucher.hintText("check"), "Looks like a check voucher.");
    assert.equal(voucher.hintText(""), "");
  });

  it("also tries the Finance petty-cash series when staff type PCV plus the year", () => {
    assert.deepEqual(voucher.lookupKeys(voucher.normalize("PCV2026-0007")), ["PCV2026-0007", "PC2026-0007"]);
    assert.deepEqual(voucher.lookupKeys(voucher.normalize("PC2026-0007")), ["PC2026-0007"]);
  });
});

describe("Finance voucher match is read-only", () => {
  it("looks up petty cash, GCash, check vouchers, and checks without writing", async () => {
    const calls = [];
    const rest = async (req) => {
      calls.push(req);
      if (req.path.endsWith("finance_petty_vouchers")) {
        if (/ilike\.PC2026-0007(?:&|$)/.test(req.query)) return [{ pcv_no: "PC2026-0007", status: "posted" }];
        return [];
      }
      if (req.path.endsWith("finance_wallet_expenses")) return [];
      if (req.path.endsWith("finance_vouchers")) return [];
      if (req.path.endsWith("finance_checks")) return [];
      throw new Error("unexpected table " + req.path);
    };
    const [hit] = await matchFinanceVouchers(["pcv2026-0007"], rest);
    assert.equal(hit.voucherNo, "pcv2026-0007");
    assert.equal(hit.matched, true);
    assert.equal(hit.matches.length, 1);
    assert.equal(hit.matches[0].label, "Petty cash");
    assert.equal(hit.matches[0].status, "posted");
    assert.equal(Object.prototype.hasOwnProperty.call(hit.matches[0], "amount"), false);
    assert.ok(calls.length >= 1);
    calls.forEach((call) => {
      assert.equal(call.method, "GET");
      assert.match(call.query, /select=[a-z_]+,status/);
      assert.doesNotMatch(call.query, /amount|employee|account/);
    });
    assert.ok(calls.some((call) => call.path === "/rest/v1/finance_petty_vouchers" && /PC2026-0007/.test(call.query)));
  });

  it("reports GCash and a check voucher when those registers hit", async () => {
    const rest = async (req) => {
      const q = req.query || "";
      if (req.path.endsWith("finance_wallet_expenses") && /2026GCASH-0004/i.test(q)) {
        return [{ ref_no: "2026Gcash-0004", status: "posted" }];
      }
      if (req.path.endsWith("finance_vouchers") && /DV2026-0008/i.test(q)) {
        return [{ dv_no: "DV2026-0008", status: "Released" }];
      }
      if (req.path.endsWith("finance_checks") && /BPI2026-1000274146/i.test(q)) {
        return [{ check_no: "BPI2026-1000274146", status: "cleared" }];
      }
      return [];
    };
    const [gcash] = await matchFinanceVouchers(["2026gcash-0004"], rest);
    assert.equal(gcash.matches.map((m) => m.label).join(","), "GCash");
    const [check] = await matchFinanceVouchers(["dv2026-0008"], rest);
    assert.equal(check.matches.map((m) => m.label).join(","), "Check voucher");
    const [bank] = await matchFinanceVouchers(["BPI2026-1000274146"], rest);
    assert.equal(bank.matches.map((m) => m.label).join(","), "Check");
  });

  it("does not call Finance for a blank number and skips a missing table", async () => {
    let calls = 0;
    const rest = async () => {
      calls += 1;
      return [];
    };
    const [blank] = await matchFinanceVouchers(["  "], rest);
    assert.equal(blank.matched, false);
    assert.equal(blank.lookedUp, false);
    assert.equal(calls, 0);

    const missing = async (req) => {
      if (req.path.endsWith("finance_vouchers")) {
        const err = new Error("Could not find the table");
        err.details = { code: "PGRST205" };
        throw err;
      }
      return [];
    };
    const [open] = await matchFinanceVouchers(["PC2026-0099"], missing);
    assert.equal(open.lookedUp, true);
    assert.equal(open.matched, false);
    assert.equal(safeKey("PC2026-0007"), true);
    assert.equal(safeKey("drop table"), false);
  });
});

describe("voucher-match function", () => {
  let env;
  beforeEach(() => {
    env = { ...process.env };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.MOTORPOOL_GATE_SECRET;
    delete process.env.MOTORPOOL_OPEN_YARD;
    delete process.env.SUPABASE_AUTH_ENABLED;
  });
  afterEach(() => {
    process.env = env;
  });

  it("requires a session when the yard is closed and does not look up without one", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    process.env.MOTORPOOL_GATE_SECRET = SECRET;
    const res = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ numbers: ["PC2026-0001"] }),
    });
    assert.equal(res.statusCode, 401);
  });

  it("says the lookup is unavailable when Supabase is not configured", async () => {
    const res = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ number: "PC2026-0001" }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.available, false);
    assert.deepEqual(body.results, []);
  });

  it("returns a match for a signed-in session and never posts", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    process.env.SUPABASE_SERVICE_ROLE = "service-role-test";
    process.env.MOTORPOOL_GATE_SECRET = SECRET;
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const original = global.fetch;
    const methods = [];
    global.fetch = async (url, opts) => {
      methods.push(opts && opts.method);
      const target = String(url);
      if (target.includes("finance_petty_vouchers")) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ pcv_no: "PC2026-0007", status: "posted" }]) };
      }
      return { ok: true, status: 200, text: async () => "[]" };
    };
    try {
      const res = await handler({
        httpMethod: "POST",
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
        body: JSON.stringify({ numbers: ["PC2026-0007"] }),
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.available, true);
      assert.equal(body.results[0].matched, true);
      assert.equal(body.results[0].matches[0].label, "Petty cash");
      assert.ok(methods.length > 0);
      methods.forEach((method) => assert.equal(method, "GET"));
    } finally {
      global.fetch = original;
    }
  });
});

describe("monthly report carries the voucher number", () => {
  it("copies liq.voucherNo onto the VRF row and leaves the amount alone", () => {
    const out = buildMonthlyVrfReport({
      month: "2026-09",
      now: new Date("2026-10-15T04:00:00Z"),
      reserves: [{
        no: "9",
        vrfNo: "6109",
        date: "2026-09-04",
        status: "Closed",
        veh: "DT-01",
        approvedBudget: 500,
        actual: 480,
        liquidatedAt: "2026-09-06",
        voucherNo: "PC2026-0007",
        vrfs: ["6109"],
      }],
      ledger: {
        "2026-09": [{
          vrf: "6109",
          date: "2026-09-04",
          veh: "DT-01",
          cat: "Belt",
          item: "Fan belt",
          qty: 1,
          price: 480,
          total: 480,
          vstatus: "Closed",
          reserve: "9",
          liq: { at: "2026-09-06", by: "Ana", note: "", outcome: "bought", voucherNo: "PC2026-0007", voucherKey: "PC2026-0007" },
        }],
      },
    });
    assert.equal(out.vrfs[0].vrf, "6109");
    assert.equal(out.vrfs[0].voucherNo, "PC2026-0007");
    assert.equal(out.vrfs[0].actual, 480);
  });
});

describe("reopen drops the reserve voucher number", () => {
  it("clears voucherNo with the liquidation stamp", () => {
    const reserve = {
      no: "56",
      vrfNo: "5890",
      status: "Closed",
      liquidatedAt: "2026-10-01",
      actual: 200,
      approvedBudget: 200,
      vrfs: ["5890"],
      voucherNo: "PCV-0123",
      voucherKey: "PCV-0123",
      voucherHint: "petty",
    };
    assert.equal(applyReserveReopen(reserve, "Ana", "2026-10-02", 200, { at: "2026-10-01", by: "Ana" }), true);
    assert.equal(reserve.liquidatedAt, "");
    assert.equal(reserve.voucherNo, undefined);
    assert.equal(reserve.voucherKey, undefined);
    assert.equal(reserve.voucherHint, undefined);
    assert.equal(reserve.vrfNo, "5890");
  });
});

describe("artifact HTML — optional voucher on liquidate", () => {
  it("adds one optional field, persists voucherNo, and does not require it", () => {
    assert.match(html, /src="\/voucher-no\.js"/);
    assert.match(html, /Voucher No\. \(optional\)/);
    assert.match(html, /Petty cash, GCash, or check voucher no\./);
    assert.match(html, /function applyVoucherToStamp/);
    assert.match(html, /function applyVoucherToReserve/);
    assert.match(html, /liquidateVrf\(prePlan==="seed"\?entry:target,edits,added,lby\.value\.trim\(\),lnt\.value\.trim\(\),outcome,lvc\.value\)/);
    assert.match(html, /if\(setVoucher\) applyVoucherToStamp\(stamp, voucherRaw\)/);
    assert.match(html, /Matched in Finance/);
    assert.match(html, /voucherSearchHit/);
    assert.match(html, /\["Voucher no\.", printVoucher\]/);
    assert.match(html, /h:"Voucher no\."/);
    assert.doesNotMatch(html, /lvc\.required/);
    assert.match(html, /var BUILD = "2026-11-04 a"/);
  });
});
