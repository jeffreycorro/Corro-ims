"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  signSession,
  verifySession,
  parseCookieHeader,
  safeEqual,
  COOKIE_NAME,
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

  it("parses the motorpool session cookie name", () => {
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const parsed = parseCookieHeader(`${COOKIE_NAME}=${encodeURIComponent(token)}; other=1`);
    assert.equal(verifySession(parsed[COOKIE_NAME], SECRET).sub, "gate");
    assert.equal(COOKIE_NAME, "motorpool_session");
  });

  it("compares secrets without throwing on length mismatch", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "ab"), false);
  });
});
