"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { capabilities } = require("../netlify/lib/capabilities");

describe("Motorpool capability flags", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.MOTORPOOL_OFFICE_PASS_HASH;
  });

  afterEach(() => {
    process.env = env;
  });

  it("is off when keys are absent", () => {
    const caps = capabilities();
    assert.equal(caps.sample, false);
    assert.equal(caps.mcp, false);
    assert.equal(caps.transcribe, false);
    assert.equal(caps.tts, false);
    assert.equal(caps.officeHash, false);
  });

  it("turns sample and tts on when those keys are set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.ELEVENLABS_API_KEY = "el-test";
    const caps = capabilities();
    assert.equal(caps.sample, true);
    assert.equal(caps.tts, true);
    assert.equal(caps.mcp, false);
    assert.equal(caps.transcribe, false);
  });

  it("turns transcribe on when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const caps = capabilities();
    assert.equal(caps.transcribe, true);
    assert.equal(caps.sample, false);
    assert.equal(caps.tts, false);
  });

  it("ignores blank keys", () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    process.env.ELEVENLABS_API_KEY = "";
    const caps = capabilities();
    assert.equal(caps.sample, false);
    assert.equal(caps.tts, false);
  });
});
