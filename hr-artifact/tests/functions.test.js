"use strict";

const crypto = require("node:crypto");
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { handler: authHandler } = require("../netlify/functions/auth");
const { handler: dbHandler } = require("../netlify/functions/db");
const { handler: sampleHandler } = require("../netlify/functions/sample");
const { handler: driveHandler } = require("../netlify/functions/drive");
const { handler: transcribeHandler } = require("../netlify/functions/transcribe");
const { handler: ttsHandler } = require("../netlify/functions/tts");
const { COOKIE_NAME, signSession } = require("../netlify/lib/session");
const { resetTokenCache } = require("../netlify/lib/google-drive");
const { resetServiceAccountCache, setTestBlobLoader } = require("../netlify/lib/google-sa");

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
    delete process.env.HR_GATE_REQUIRED;
    delete process.env.HR_GATE_PASSWORD;
    delete process.env.SUPABASE_AUTH_ENABLED;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_BLOB;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_TRANSCRIBE_MODEL;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_VOICE_ID;
    setTestBlobLoader(async () => "");
    resetServiceAccountCache();
    resetTokenCache();
  });

  afterEach(() => {
    setTestBlobLoader(null);
    resetTokenCache();
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

  it("does not accept the deprecated gate password unless HR_GATE_REQUIRED is set", async () => {
    const res = await authHandler({
      httpMethod: "POST",
      headers: { "x-forwarded-proto": "https" },
      body: JSON.stringify({ action: "login", password: SECRET }),
    });
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.match(body.error, /SUPABASE_URL/i);
  });

  it("optionally logs in with the gate password when HR_GATE_REQUIRED=true", async () => {
    process.env.HR_GATE_REQUIRED = "true";
    const res = await authHandler({
      httpMethod: "POST",
      headers: { "x-forwarded-proto": "https" },
      body: JSON.stringify({ action: "login", password: SECRET }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, true);
    assert.equal(body.method, "password");
    assert.match(res.headers["set-cookie"], new RegExp(`${COOKIE_NAME}=`));
    assert.match(res.headers["set-cookie"], /HttpOnly/);
    assert.match(res.headers["set-cookie"], /Secure/);
  });

  it("rejects the wrong optional gate password", async () => {
    process.env.HR_GATE_REQUIRED = "true";
    const res = await authHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ action: "login", password: "nope" }),
    });
    assert.equal(res.statusCode, 401);
  });

  it("reports unauthenticated status without a mandatory password method", async () => {
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, false);
    assert.deepEqual(body.methods, []);
    assert.equal(body.gateRequired, false);
    assert.equal(body.timezone, "Asia/Manila");
  });

  it("advertises supabase when URL + anon key are set", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    const body = JSON.parse(res.body);
    assert.deepEqual(body.methods, ["supabase"]);
  });

  it("does not treat acquire as always true when holder is missing", async () => {
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const res = await dbHandler({
      httpMethod: "POST",
      headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
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
    assert.equal(body.mcp, false);
    assert.equal(body.sample, true);
    assert.equal(body.capabilities.transcribe, false);
    assert.equal(body.capabilities.tts, false);
  });

  it("reports tts capability when ELEVENLABS_API_KEY is set", async () => {
    process.env.ELEVENLABS_API_KEY = "el-test";
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    const body = JSON.parse(res.body);
    assert.equal(body.capabilities.tts, true);
    assert.equal(body.tts, true);
    assert.equal(body.capabilities.sample, false);
  });

  it("advertises top-level mcp when a Drive service account file is present", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-sa-auth-"));
    const file = path.join(dir, "sa.json");
    fs.writeFileSync(file, testServiceAccountJson());
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE = file;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    const body = JSON.parse(res.body);
    assert.equal(body.capabilities.mcp, true);
    assert.equal(body.mcp, true);
  });

  it("rejects sample, drive, and transcribe without a session", async () => {
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
    const transcribe = await transcribeHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ audioBase64: "ZmFrZQ==", mimeType: "audio/webm" }),
    });
    assert.equal(transcribe.statusCode, 401);
    const tts = await ttsHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(tts.statusCode, 401);
  });

  it("refuses sample/drive/transcribe when keys are missing even with a session", async () => {
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
    const transcribe = await transcribeHandler({
      httpMethod: "POST",
      headers,
      body: JSON.stringify({ audioBase64: "ZmFrZQ==", mimeType: "audio/webm" }),
    });
    assert.equal(transcribe.statusCode, 403);
    assert.equal(JSON.parse(transcribe.body).code, "not_granted");
    const tts = await ttsHandler({
      httpMethod: "POST",
      headers,
      body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(tts.statusCode, 403);
    assert.equal(JSON.parse(tts.body).code, "not_granted");
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

  it("loads Drive from a file when Functions env JSON is absent", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-sa-fn-"));
    const file = path.join(dir, "sa.json");
    fs.writeFileSync(file, testServiceAccountJson());
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE = file;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("oauth2.googleapis.com/token")) {
        return { ok: true, json: async () => ({ access_token: "ya29.test", expires_in: 3600 }) };
      }
      if (href.includes("/drive/v3/files")) {
        const payload = {
          files: [
            {
              id: "f1",
              name: "FromFile.pdf",
              mimeType: "application/pdf",
              webViewLink: "https://drive.google.com/file/d/f1/view",
              parents: ["p1"],
            },
          ],
        };
        return { ok: true, text: async () => JSON.stringify(payload), json: async () => payload };
      }
      throw new Error("unexpected fetch " + href);
    };
    try {
      const res = await driveHandler({
        httpMethod: "POST",
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
        body: JSON.stringify({
          tool: "search_files",
          args: { query: "parentId = 'p1'" },
        }),
      });
      assert.equal(res.statusCode, 200);
      assert.equal(JSON.parse(res.body).payload.files[0].title, "FromFile.pdf");
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

  it("reports dictation capability when OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    const body = JSON.parse(res.body);
    assert.equal(body.capabilities.transcribe, true);
  });

  it("calls OpenAI transcriptions with the session cookie and returns { text }", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const originalFetch = global.fetch;
    let captured;
    global.fetch = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: "Site reporting time moves to 7:00 AM." }),
      };
    };
    try {
      const res = await transcribeHandler({
        httpMethod: "POST",
        headers: {
          cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          audioBase64: Buffer.from("fake-audio").toString("base64"),
          mimeType: "audio/webm",
          filename: "dictation.webm",
        }),
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.text, "Site reporting time moves to 7:00 AM.");
      assert.match(String(captured.url), /api\.openai\.com\/v1\/audio\/transcriptions/);
      assert.equal(captured.opts.headers.Authorization, "Bearer sk-test");
      assert.equal(captured.opts.body.get("model"), "gpt-transcribe");
      assert.ok(captured.opts.body.get("file"));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("calls ElevenLabs with the session cookie and returns audioBase64", async () => {
    process.env.ELEVENLABS_API_KEY = "el-test";
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const originalFetch = global.fetch;
    let captured;
    global.fetch = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from("fake-mp3"),
      };
    };
    try {
      const res = await ttsHandler({
        httpMethod: "POST",
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
        body: JSON.stringify({ text: "Glory Mae was late on August 5." }),
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.audioBase64, Buffer.from("fake-mp3").toString("base64"));
      assert.equal(body.mimeType, "audio/mpeg");
      assert.match(String(captured.url), /api\.elevenlabs\.io\/v1\/text-to-speech\//);
      assert.equal(captured.opts.headers["xi-api-key"], "el-test");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
