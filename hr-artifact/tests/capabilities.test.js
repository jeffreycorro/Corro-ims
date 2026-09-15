"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { capabilities } = require("../netlify/lib/capabilities");
const { resetServiceAccountCache, setTestBlobLoader } = require("../netlify/lib/google-sa");

describe("HR capability flags", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_BLOB;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    setTestBlobLoader(async () => "");
    resetServiceAccountCache();
  });

  afterEach(() => {
    setTestBlobLoader(null);
    resetServiceAccountCache();
    process.env = env;
  });

  it("is off when keys are absent", async () => {
    const caps = await capabilities();
    assert.equal(caps.sample, false);
    assert.equal(caps.mcp, false);
    assert.equal(caps.transcribe, false);
    assert.equal(caps.tts, false);
  });

  it("turns sample and tts on when those keys are set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.ELEVENLABS_API_KEY = "el-test";
    const caps = await capabilities();
    assert.equal(caps.sample, true);
    assert.equal(caps.tts, true);
    assert.equal(caps.mcp, false);
    assert.equal(caps.transcribe, false);
  });

  it("ignores blank keys", async () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    process.env.ELEVENLABS_API_KEY = "";
    const caps = await capabilities();
    assert.equal(caps.sample, false);
    assert.equal(caps.tts, false);
  });

  it("turns mcp on from a Blobs payload without GOOGLE_SERVICE_ACCOUNT_JSON", async () => {
    setTestBlobLoader(async () =>
      JSON.stringify({
        client_email: "sa@example.com",
        private_key: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n",
      })
    );
    const caps = await capabilities();
    assert.equal(caps.mcp, true);
  });
});
