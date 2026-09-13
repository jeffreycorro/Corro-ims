"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  signSession,
  verifySession,
  parseCookieHeader,
  safeEqual,
  sessionSecret,
  COOKIE_NAME,
  MAX_AGE_MS,
} = require("../netlify/lib/session");

const SECRET = "unit-test-secret-key-32chars-min";

describe("session", () => {
  it("signs and verifies a gate cookie", () => {
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const payload = verifySession(token, SECRET);
    assert.equal(payload.sub, "gate");
    assert.equal(payload.method, "password");
    assert.ok(payload.exp > Date.now());
  });

  it("rejects tampered tokens and the wrong secret", () => {
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    assert.equal(verifySession(token + "x", SECRET), null);
    assert.equal(verifySession(token, "other-secret-key-32chars-long"), null);
    assert.equal(verifySession("", SECRET), null);
  });

  it("rejects expired tokens", () => {
    const token = signSession(
      { sub: "gate", method: "password", exp: Date.now() - 1000 },
      SECRET
    );
    assert.equal(verifySession(token, SECRET), null);
  });

  it("parses the session cookie name", () => {
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const parsed = parseCookieHeader(`${COOKIE_NAME}=${encodeURIComponent(token)}; other=1`);
    assert.equal(verifySession(parsed[COOKIE_NAME], SECRET).sub, "gate");
  });

  it("compares secrets without throwing on length mismatch", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "ab"), false);
    assert.equal(safeEqual("", "x"), false);
  });

  it("keeps a multi-day session so the PWA stays signed in", () => {
    assert.ok(MAX_AGE_MS >= 7 * 24 * 60 * 60 * 1000);
    const token = signSession({ sub: "user-1", method: "supabase" }, SECRET);
    const payload = verifySession(token, SECRET);
    assert.ok(payload.exp - Date.now() > 6 * 24 * 60 * 60 * 1000);
  });

  it("can sign cookies without treating HR_GATE_SECRET as a login password", () => {
    const prevGate = process.env.HR_GATE_SECRET;
    const prevRole = process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.HR_GATE_SECRET;
    process.env.SUPABASE_SERVICE_ROLE = "service-role-for-hmac";
    try {
      const derived = sessionSecret();
      assert.ok(derived);
      const token = signSession({ sub: "user-1", method: "supabase" });
      assert.equal(verifySession(token).sub, "user-1");
    } finally {
      if (prevGate == null) delete process.env.HR_GATE_SECRET;
      else process.env.HR_GATE_SECRET = prevGate;
      if (prevRole == null) delete process.env.SUPABASE_SERVICE_ROLE;
      else process.env.SUPABASE_SERVICE_ROLE = prevRole;
    }
  });
});
