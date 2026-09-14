"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { handler: authHandler } = require("../netlify/functions/auth");
const { handler: sampleHandler } = require("../netlify/functions/sample");
const { handler: ttsHandler } = require("../netlify/functions/tts");
const { COOKIE_NAME, signSession } = require("../netlify/lib/session");

const SECRET = "test-motorpool-gate-secret-value";

describe("motorpool netlify functions", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    delete process.env.MOTORPOOL_GATE_SECRET;
    delete process.env.MOTORPOOL_GATE_PASSWORD;
    delete process.env.MOTORPOOL_GATE_REQUIRED;
    delete process.env.MOTORPOOL_OPEN_YARD;
    delete process.env.MOTORPOOL_SESSION_SECRET;
    delete process.env.SUPABASE_AUTH_ENABLED;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_VOICE_ID;
  });

  afterEach(() => {
    process.env = env;
  });

  it("reports sample and tts off on an open yard when keys are missing", async () => {
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, true);
    assert.equal(body.open, true);
    assert.deepEqual(body.methods, []);
    assert.equal(body.capabilities.sample, false);
    assert.equal(body.capabilities.tts, false);
  });

  it("closes the yard when Supabase Auth keys are configured", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, false);
    assert.equal(body.open, false);
    assert.deepEqual(body.methods, ["supabase"]);
  });

  it("reopens the yard with MOTORPOOL_OPEN_YARD even when Auth keys exist", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    process.env.MOTORPOOL_OPEN_YARD = "true";
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    const body = JSON.parse(res.body);
    assert.equal(body.authenticated, true);
    assert.equal(body.open, true);
    assert.equal(body.method, "open");
  });

  it("advertises sample and tts when those keys are set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.ELEVENLABS_API_KEY = "el-test";
    const res = await authHandler({ httpMethod: "GET", headers: {} });
    const body = JSON.parse(res.body);
    assert.equal(body.capabilities.sample, true);
    assert.equal(body.capabilities.tts, true);
  });

  it("rejects sample and tts without a session when Auth is configured", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    process.env.MOTORPOOL_GATE_SECRET = SECRET;
    const sample = await sampleHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ prompt: "hi" }),
    });
    assert.equal(sample.statusCode, 401);
    const tts = await ttsHandler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(tts.statusCode, 401);
  });

  it("refuses sample and tts when keys are missing even with a session", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    process.env.MOTORPOOL_GATE_SECRET = SECRET;
    const token = signSession({ sub: "gate", method: "password" }, SECRET);
    const headers = { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` };
    const sample = await sampleHandler({
      httpMethod: "POST",
      headers,
      body: JSON.stringify({ prompt: "hi" }),
    });
    assert.equal(sample.statusCode, 403);
    assert.equal(JSON.parse(sample.body).code, "not_granted");
    const tts = await ttsHandler({
      httpMethod: "POST",
      headers,
      body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(tts.statusCode, 403);
    assert.equal(JSON.parse(tts.body).code, "not_granted");
  });

  it("calls Anthropic with the session cookie and returns { text }", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    process.env.MOTORPOOL_GATE_SECRET = SECRET;
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
          content: [{ type: "text", text: "DT-03 last battery was in October." }],
          stop_reason: "end_turn",
        }),
      };
    };
    try {
      const res = await sampleHandler({
        httpMethod: "POST",
        headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
        body: JSON.stringify({ prompt: "DT-03 battery?", modelTier: "default" }),
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.text, "DT-03 last battery was in October.");
      assert.equal(body.truncated, false);
      assert.match(String(captured.url), /api\.anthropic\.com/);
      const sent = JSON.parse(captured.opts.body);
      assert.equal(sent.messages[0].content, "DT-03 battery?");
      assert.equal(captured.opts.headers["x-api-key"], "sk-test");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("calls ElevenLabs and returns audioBase64", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-test";
    process.env.MOTORPOOL_GATE_SECRET = SECRET;
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
        body: JSON.stringify({ text: "DT-03 is due for oil." }),
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

  it("serves sample on an open yard when Anthropic is configured", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: "Reserve is low." }],
        stop_reason: "end_turn",
      }),
    });
    try {
      const res = await sampleHandler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ prompt: "How much fuel is left?" }),
      });
      assert.equal(res.statusCode, 200);
      assert.equal(JSON.parse(res.body).text, "Reserve is low.");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
