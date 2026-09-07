"use strict";

const crypto = require("node:crypto");
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { handler: authHandler } = require("../netlify/functions/auth");
const { handler: dbHandler } = require("../netlify/functions/db");
const { handler: sampleHandler } = require("../netlify/functions/sample");
const { handler: driveHandler } = require("../netlify/functions/drive");
const { parseCookieHeader, COOKIE_NAME, signSession } = require("../netlify/lib/session");
const { resetTokenCache } = require("../netlify/lib/google-drive");

function testServiceAccountJson() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    client_email: "sa@example.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
}

const SECRET = "test-hr-gate-secret-value";

describe("netlify functions", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    process.env.HR_GATE_SECRET = SECRET;
    delete process.env.SUPABASE_AUTH_ENABLED;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    resetTokenCache();
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

  it("reports AI/Drive capabilities on auth status", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    const body = JSON.parse(res.body);
    assert.equal(body.capabilities.sample, true);
    assert.equal(body.capabilities.mcp, false);
  });

  it("rejects sample and drive without a session", async () => {
    const sample = await sampleHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ prompt: "hi" }),
    });
    assert.equal(sample.statusCode, 401);
    const drive = await driveHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ tool: "search_files", args: { query: "parentId = 'x'" } }),
    });
    assert.equal(drive.statusCode, 401);
  });

  it("refuses sample/drive when keys are missing even with a session", async () => {
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const headers = { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` };
    const sample = await sampleHandler({
      httpMethod: "POST",
      headers,
      body: JSON.stringify({ prompt: "hi" }),
    });
    assert.equal(sample.statusCode, 403);
    assert.equal(JSON.parse(sample.body).code, "not_granted");
    const drive = await driveHandler({
      httpMethod: "POST",
      headers,
      body: JSON.stringify({ tool: "search_files", args: { query: "parentId = 'x'" } }),
    });
    assert.equal(drive.statusCode, 503);
    assert.equal(JSON.parse(drive.body).code, "server_not_connected");
  });

  it("calls Anthropic with the session cookie and returns { text }", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const originalFetch = global.fetch;
    let captured;
    global.fetch = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "text", text: "Memo body" }],
          stop_reason: "end_turn",
        }),
      };
    };
    try {
      const res = await sampleHandler({
        httpMethod: "POST",
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
        body: JSON.stringify({ prompt: "Draft a memo", modelTier: "default" }),
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.text, "Memo body");
      assert.equal(body.truncated, false);
      assert.match(String(captured.url), /api\.anthropic\.com/);
      const sent = JSON.parse(captured.opts.body);
      assert.equal(sent.messages[0].content, "Draft a memo");
      assert.equal(captured.opts.headers["x-api-key"], "sk-test");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("maps Drive search results into payload.files", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = testServiceAccountJson();
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "ya29.test", expires_in: 3600 }),
        };
      }
      if (href.includes("/drive/v3/files")) {
        const payload = {
          files: [
            {
              id: "f1",
              name: "Resume.pdf",
              mimeType: "application/pdf",
              webViewLink: "https://drive.google.com/file/d/f1/view",
              parents: ["p1"],
            },
          ],
          nextPageToken: "n2",
        };
        return {
          ok: true,
          text: async () => JSON.stringify(payload),
          json: async () => payload,
        };
      }
      throw new Error("unexpected fetch " + href);
    };
    try {
      const res = await driveHandler({
        httpMethod: "POST",
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
        body: JSON.stringify({
          tool: "search_files",
          args: { query: "parentId = 'p1'", pageSize: 10 },
        }),
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.payload.files[0].title, "Resume.pdf");
      assert.equal(body.payload.files[0].viewUrl, "https://drive.google.com/file/d/f1/view");
      assert.equal(body.payload.next_page_token, "n2");
      assert.equal(body.payload.nextPageToken, "n2");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("reads file text into payload.fileContent / content / text", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = testServiceAccountJson();
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("oauth2.googleapis.com/token")) {
        return { ok: true, json: async () => ({ access_token: "ya29.test", expires_in: 3600 }) };
      }
      if (href.includes("/files/doc1") && href.includes("alt=media")) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from("Attendance 05-Aug-26", "utf8"),
          text: async () => "Attendance 05-Aug-26",
        };
      }
      if (href.includes("/files/doc1")) {
        const meta = {
          id: "doc1",
          name: "05.08.2026.pdf",
          mimeType: "text/plain",
          webViewLink: "https://drive.google.com/file/d/doc1/view",
        };
        return { ok: true, text: async () => JSON.stringify(meta), json: async () => meta };
      }
      throw new Error("unexpected fetch " + href);
    };
    try {
      const res = await driveHandler({
        httpMethod: "POST",
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
        body: JSON.stringify({ tool: "read_file_content", args: { fileId: "doc1" } }),
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.payload.text, "Attendance 05-Aug-26");
      assert.equal(body.payload.content, "Attendance 05-Aug-26");
      assert.equal(body.payload.fileContent, "Attendance 05-Aug-26");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("creates a Drive folder and returns id + viewUrl", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = testServiceAccountJson();
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const href = String(url);
      if (href.includes("oauth2.googleapis.com/token")) {
        return { ok: true, json: async () => ({ access_token: "ya29.test", expires_in: 3600 }) };
      }
      if (href.includes("/drive/v3/files") && opts && opts.method === "POST") {
        const created = {
          id: "folder1",
          name: "1241 - Ada",
          mimeType: "application/vnd.google-apps.folder",
          webViewLink: "https://drive.google.com/drive/folders/folder1",
        };
        return { ok: true, text: async () => JSON.stringify(created), json: async () => created };
      }
      throw new Error("unexpected fetch " + href);
    };
    try {
      const res = await driveHandler({
        httpMethod: "POST",
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
        body: JSON.stringify({
          tool: "create_file",
          args: {
            title: "1241 - Ada",
            parentId: "parent",
            contentMimeType: "application/vnd.google-apps.folder",
          },
        }),
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.payload.id, "folder1");
      assert.equal(body.payload.viewUrl, "https://drive.google.com/drive/folders/folder1");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
