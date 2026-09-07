"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { handler: authHandler } = require("../netlify/functions/auth");
const { handler: dbHandler } = require("../netlify/functions/db");
const { parseCookieHeader, COOKIE_NAME } = require("../netlify/lib/session");

const SECRET = "test-hr-gate-secret-value";

describe("netlify functions", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    process.env.HR_GATE_SECRET = SECRET;
    delete process.env.SUPABASE_AUTH_ENABLED;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE;
  });

  afterEach(() => {
    process.env = env;
  });

  it("rejects db ops without a session", async () => {
    const res = await dbHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ op: "get", path: "employees/1" }),
    });
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.match(body.error, /auth/i);
  });

  it("logs in with the gate password and sets an httpOnly cookie", async () => {
    const res = await authHandler({
      httpMethod: "POST",
      headers: { "x-forwarded-proto": "https" },
      body: JSON.stringify({ action: "login", password: SECRET }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, true);
    assert.match(res.headers["set-cookie"], new RegExp(`${COOKIE_NAME}=`));
    assert.match(res.headers["set-cookie"], /HttpOnly/);
    assert.match(res.headers["set-cookie"], /Secure/);
  });

  it("rejects the wrong password", async () => {
    const res = await authHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ action: "login", password: "nope" }),
    });
    assert.equal(res.statusCode, 401);
  });

  it("reports unauthenticated status and password method", async () => {
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, false);
    assert.deepEqual(body.methods, ["password"]);
    assert.equal(body.timezone, "Asia/Manila");
  });

  it("does not treat acquire as always true when holder is missing", async () => {
    const login = await authHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ action: "login", password: SECRET }),
    });
    const cookie = parseCookieHeader(
      login.headers["set-cookie"].split(";")[0]
    );
    const res = await dbHandler({
      httpMethod: "POST",
      headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(cookie[COOKIE_NAME])}` },
      body: JSON.stringify({ op: "acquire", path: "employees/1" }),
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.acquired, false);
  });
});
