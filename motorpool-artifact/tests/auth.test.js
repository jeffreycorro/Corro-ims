"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { handler: authHandler } = require("../netlify/functions/auth");
const { handler: sampleHandler } = require("../netlify/functions/sample");
const { canAccessMotorpool } = require("../netlify/lib/mp-access");
const {
  configuredMethods,
  COOKIE_NAME,
  gateOptional,
  gatePassword,
  gateRequired,
  openYard,
  signSession,
  supabaseAuthEnabled,
} = require("../netlify/lib/session");

const SECRET = "test-motorpool-gate-secret-value";

describe("motorpool access policy", () => {
  it("allows admin role and department motorpool only", () => {
    assert.equal(canAccessMotorpool({ role: "admin", department: "finance" }), true);
    assert.equal(canAccessMotorpool({ role: "staff", department: "motorpool" }), true);
    assert.equal(canAccessMotorpool({ role: "dept_lead", department: "motorpool" }), true);
    assert.equal(canAccessMotorpool({ role: "hr", department: "hr" }), false);
    assert.equal(canAccessMotorpool({ role: "staff", department: "site" }), false);
    assert.equal(canAccessMotorpool({ role: "dept_lead", department: "finance" }), false);
    assert.equal(canAccessMotorpool(null), false);
  });
});

describe("auth methods", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    process.env.MOTORPOOL_GATE_SECRET = SECRET;
    delete process.env.MOTORPOOL_GATE_REQUIRED;
    delete process.env.MOTORPOOL_GATE_PASSWORD;
    delete process.env.MOTORPOOL_OPEN_YARD;
    delete process.env.SUPABASE_AUTH_ENABLED;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    process.env = env;
  });

  it("defaults to an open yard when Auth keys are missing", () => {
    assert.equal(gateRequired(), false);
    assert.equal(gatePassword(), "");
    assert.deepEqual(configuredMethods(), []);
    assert.equal(gateOptional(), true);
    assert.equal(openYard(), false);
  });

  it("enables supabase and closes the yard when URL + anon key exist", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    assert.equal(supabaseAuthEnabled(), true);
    assert.deepEqual(configuredMethods(), ["supabase"]);
    assert.equal(gateOptional(), false);
  });

  it("keeps the yard open when MOTORPOOL_OPEN_YARD is set even with Auth keys", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.MOTORPOOL_OPEN_YARD = "true";
    assert.equal(supabaseAuthEnabled(), true);
    assert.equal(openYard(), true);
    assert.equal(gateOptional(), true);
  });

  it("keeps the shared password off even when MOTORPOOL_GATE_SECRET is set", () => {
    process.env.MOTORPOOL_GATE_SECRET = SECRET;
    assert.equal(gatePassword(), "");
    process.env.MOTORPOOL_GATE_REQUIRED = "true";
    assert.equal(gatePassword(), SECRET);
    assert.ok(configuredMethods().includes("password"));
  });
});

describe("supabase auth login", () => {
  let env;
  let originalFetch;

  beforeEach(() => {
    env = { ...process.env };
    originalFetch = global.fetch;
    process.env.MOTORPOOL_GATE_SECRET = SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    process.env.SUPABASE_SERVICE_ROLE = "service-test";
    delete process.env.MOTORPOOL_GATE_REQUIRED;
    delete process.env.MOTORPOOL_OPEN_YARD;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = env;
  });

  function mockSupabase({
    passwordOk = true,
    userId = "user-1",
    email = "motorpool@corroconstruction.com",
    profile,
  }) {
    global.fetch = async (url, opts) => {
      const href = String(url);
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      if (href.includes("/auth/v1/token")) {
        if (!passwordOk || body.password === "bad") {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error_description: "Invalid login credentials" }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            access_token: "jwt-test",
            user: { id: userId, email },
          }),
        };
      }
      if (href.includes("/auth/v1/user")) {
        return {
          ok: true,
          json: async () => ({ id: userId, email }),
        };
      }
      if (href.includes("/rest/v1/profiles")) {
        const row =
          profile === undefined
            ? { id: userId, full_name: "Yard Staff", department: "motorpool", role: "staff" }
            : profile;
        return {
          ok: true,
          text: async () => JSON.stringify(row ? [row] : []),
          json: async () => (row ? [row] : []),
        };
      }
      throw new Error("unexpected fetch " + href);
    };
  }

  it("reports a closed yard and unauthenticated status when Auth is configured", async () => {
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, false);
    assert.equal(body.open, false);
    assert.deepEqual(body.methods, ["supabase"]);
  });

  it("logs in with portal email/password and sets an httpOnly cookie", async () => {
    mockSupabase({});
    const res = await authHandler({
      httpMethod: "POST",
      headers: { "x-forwarded-proto": "https" },
      body: JSON.stringify({
        action: "login",
        email: "motorpool@corroconstruction.com",
        password: "portal-password",
      }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, true);
    assert.equal(body.method, "supabase");
    assert.equal(body.role, "staff");
    assert.equal(body.department, "motorpool");
    assert.equal(body.open, false);
    assert.match(res.headers["set-cookie"], new RegExp(`${COOKIE_NAME}=`));
    assert.match(res.headers["set-cookie"], /HttpOnly/);
    assert.match(res.headers["set-cookie"], /Secure/);
  });

  it("accepts a portal access_token handoff", async () => {
    mockSupabase({
      profile: { id: "user-1", full_name: "Admin", department: "admin", role: "admin" },
    });
    const res = await authHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ action: "login", access_token: "jwt-test" }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, true);
    assert.equal(body.role, "admin");
  });

  it("blocks a signed-in department account that is not motorpool or admin", async () => {
    mockSupabase({
      email: "site@corroconstruction.com",
      profile: { id: "user-1", full_name: "Site Staff", department: "site", role: "staff" },
    });
    const res = await authHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        action: "login",
        email: "site@corroconstruction.com",
        password: "portal-password",
      }),
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.match(body.error, /does not have Motorpool access/i);
    assert.equal(res.headers["set-cookie"], undefined);
  });

  it("rejects a bad portal password", async () => {
    mockSupabase({ passwordOk: false });
    const res = await authHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        action: "login",
        email: "motorpool@corroconstruction.com",
        password: "bad",
      }),
    });
    assert.equal(res.statusCode, 401);
  });

  it("clears the session cookie on logout", async () => {
    const res = await authHandler({
      httpMethod: "POST",
      headers: { "x-forwarded-proto": "https" },
      body: JSON.stringify({ action: "logout" }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).authenticated, false);
    assert.match(res.headers["set-cookie"], /Max-Age=0/);
  });

  it("lets sample through after a supabase session cookie is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const token = signSession({ sub: "user-1", method: "supabase" }, SECRET);
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: "DT-03 is due." }],
        stop_reason: "end_turn",
      }),
    });
    try {
      const res = await sampleHandler({
        httpMethod: "POST",
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
        body: JSON.stringify({ prompt: "DT-03?" }),
      });
      assert.equal(res.statusCode, 200);
      assert.equal(JSON.parse(res.body).text, "DT-03 is due.");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
