"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { handler: authHandler } = require("../netlify/functions/auth");
const { canAccessHr } = require("../netlify/lib/hr-access");
const {
  configuredMethods,
  COOKIE_NAME,
  gatePassword,
  gateRequired,
  supabaseAuthEnabled,
} = require("../netlify/lib/session");

const SECRET = "test-hr-gate-secret-value";

describe("hr access policy", () => {
  it("allows admin, hr role, and department hr only", () => {
    assert.equal(canAccessHr({ role: "admin", department: "finance" }), true);
    assert.equal(canAccessHr({ role: "hr", department: "hr" }), true);
    assert.equal(canAccessHr({ role: "staff", department: "hr" }), true);
    assert.equal(canAccessHr({ role: "staff", department: "site" }), false);
    assert.equal(canAccessHr({ role: "dept_lead", department: "finance" }), false);
    assert.equal(canAccessHr(null), false);
  });
});

describe("auth methods", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    process.env.HR_GATE_SECRET = SECRET;
    delete process.env.HR_GATE_REQUIRED;
    delete process.env.HR_GATE_PASSWORD;
    delete process.env.SUPABASE_AUTH_ENABLED;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    process.env = env;
  });

  it("defaults to no gate password and supabase when keys exist", () => {
    assert.equal(gateRequired(), false);
    assert.equal(gatePassword(), "");
    assert.deepEqual(configuredMethods(), []);
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    assert.equal(supabaseAuthEnabled(), true);
    assert.deepEqual(configuredMethods(), ["supabase"]);
  });

  it("keeps the shared password off even when HR_GATE_SECRET is set", () => {
    process.env.HR_GATE_SECRET = SECRET;
    assert.equal(gatePassword(), "");
    process.env.HR_GATE_REQUIRED = "true";
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
    process.env.HR_GATE_SECRET = SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    process.env.SUPABASE_SERVICE_ROLE = "service-test";
    delete process.env.HR_GATE_REQUIRED;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = env;
  });

  function mockSupabase({ passwordOk = true, userId = "user-1", email = "hr@corroconstruction.com", profile }) {
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
        const row = profile === undefined
          ? { id: userId, full_name: "HR Officer", department: "hr", role: "hr" }
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

  it("logs in with portal email/password and sets an httpOnly cookie", async () => {
    mockSupabase({});
    const res = await authHandler({
      httpMethod: "POST",
      headers: { "x-forwarded-proto": "https" },
      body: JSON.stringify({
        action: "login",
        email: "hr@corroconstruction.com",
        password: "portal-password",
      }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, true);
    assert.equal(body.method, "supabase");
    assert.equal(body.role, "hr");
    assert.equal(body.department, "hr");
    assert.match(res.headers["set-cookie"], new RegExp(`${COOKIE_NAME}=`));
    assert.match(res.headers["set-cookie"], /HttpOnly/);
    assert.match(res.headers["set-cookie"], /Secure/);
  });

  it("accepts a portal access_token handoff", async () => {
    mockSupabase({ profile: { id: "user-1", full_name: "Admin", department: "admin", role: "admin" } });
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

  it("blocks a signed-in department account that is not HR or admin", async () => {
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
    assert.match(body.error, /does not have HR access/i);
    assert.equal(res.headers["set-cookie"], undefined);
  });

  it("rejects a bad portal password", async () => {
    mockSupabase({ passwordOk: false });
    const res = await authHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        action: "login",
        email: "hr@corroconstruction.com",
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
});
