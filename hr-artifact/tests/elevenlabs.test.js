"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_VOICE_ID,
  mapElevenLabsError,
  sanitizeSpeakText,
  synthesizeSpeech,
  ttsLimits,
} = require("../netlify/lib/elevenlabs");

describe("elevenlabs contract", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_VOICE_ID;
    delete process.env.ELEVENLABS_MODEL_ID;
  });

  afterEach(() => {
    process.env = env;
  });

  it("strips markdown and collapses whitespace", () => {
    assert.equal(sanitizeSpeakText("  **DT-03** last had a\nbattery  "), "DT-03 last had a battery");
  });

  it("maps ElevenLabs HTTP errors to artifact codes", () => {
    assert.equal(mapElevenLabsError(401, {}).code, "not_granted");
    assert.equal(mapElevenLabsError(429, {}).code, "rate_limited");
    assert.equal(mapElevenLabsError(413, {}).code, "prompt_too_large");
    assert.equal(mapElevenLabsError(500, {}).code, "upstream_error");
  });

  it("advertises a default voice and char cap", () => {
    const limits = ttsLimits();
    assert.equal(limits.defaultVoiceId, DEFAULT_VOICE_ID);
    assert.equal(limits.maxChars, 2500);
  });

  it("posts text to ElevenLabs and returns base64 audio", async () => {
    process.env.ELEVENLABS_API_KEY = "el-test";
    process.env.ELEVENLABS_VOICE_ID = "voice-1";
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
      const out = await synthesizeSpeech({ text: "DT-03 is due for oil." });
      assert.equal(out.mimeType, "audio/mpeg");
      assert.equal(out.voiceId, "voice-1");
      assert.equal(out.audioBase64, Buffer.from("fake-mp3").toString("base64"));
      assert.match(String(captured.url), /text-to-speech\/voice-1/);
      assert.equal(captured.opts.headers["xi-api-key"], "el-test");
      const sent = JSON.parse(captured.opts.body);
      assert.equal(sent.text, "DT-03 is due for oil.");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("refuses to call ElevenLabs without a key", async () => {
    await assert.rejects(() => synthesizeSpeech({ text: "hi" }), (err) => {
      assert.equal(err.code, "not_granted");
      return true;
    });
  });
});
