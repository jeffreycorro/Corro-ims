"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_MODELS,
  MAX_AUDIO_BYTES,
  decodeAudioBase64,
  filenameForMime,
  isLegacyWhisper,
  mapOpenAiError,
  modelChain,
  modelUnavailable,
  openaiConfigured,
  transcribeAudio,
  transcribeLimits,
} = require("../netlify/lib/openai-transcribe");

describe("openai transcribe contract", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_TRANSCRIBE_MODEL;
    delete process.env.OPENAI_TRANSCRIBE_LANGUAGES;
  });

  afterEach(() => {
    process.env = env;
  });

  it("is off until OPENAI_API_KEY is set", () => {
    assert.equal(openaiConfigured(), false);
    process.env.OPENAI_API_KEY = "sk-test";
    assert.equal(openaiConfigured(), true);
  });

  it("prefers gpt-transcribe then gpt-4o-transcribe then whisper-1", () => {
    assert.deepEqual(modelChain(), DEFAULT_MODELS);
    assert.equal(DEFAULT_MODELS[0], "gpt-transcribe");
    process.env.OPENAI_TRANSCRIBE_MODEL = "whisper-1";
    assert.deepEqual(modelChain(), ["whisper-1", "gpt-transcribe", "gpt-4o-transcribe"]);
  });

  it("maps filenames and treats whisper-1 as the legacy request shape", () => {
    assert.equal(filenameForMime("audio/webm;codecs=opus"), "dictation.webm");
    assert.equal(filenameForMime("audio/mp4"), "dictation.m4a");
    assert.equal(isLegacyWhisper("whisper-1"), true);
    assert.equal(isLegacyWhisper("gpt-transcribe"), false);
  });

  it("rejects empty or oversized base64 audio", () => {
    assert.throws(() => decodeAudioBase64(""), /audio is required/);
    const huge = Buffer.alloc(MAX_AUDIO_BYTES + 16, 1).toString("base64");
    assert.throws(() => decodeAudioBase64(huge), /too long/);
  });

  it("maps OpenAI HTTP errors to artifact codes", () => {
    assert.equal(mapOpenAiError(401, {}).code, "not_granted");
    assert.equal(mapOpenAiError(429, {}).code, "rate_limited");
    assert.equal(mapOpenAiError(413, {}).code, "bad_request");
    assert.equal(mapOpenAiError(500, {}).code, "upstream_error");
    assert.equal(modelUnavailable(404, { error: { message: "model not found" } }), true);
    assert.equal(modelUnavailable(400, { error: { message: "invalid model" } }), true);
    assert.equal(modelUnavailable(400, { error: { message: "unknown parameter keywords" } }), false);
    assert.equal(modelUnavailable(400, { error: { message: "file is empty" } }), false);
  });

  it("advertises duration and size limits", () => {
    const limits = transcribeLimits();
    assert.equal(limits.maxSeconds, 90);
    assert.ok(limits.maxBytes < 4 * 1024 * 1024);
  });

  it("falls back when the preferred model is missing and returns text", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const originalFetch = global.fetch;
    const models = [];
    global.fetch = async (_url, opts) => {
      const model = opts.body.get("model");
      models.push(model);
      if (model === "gpt-transcribe") {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: "model not found" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: "Glory Mae was late on August 5." }),
      };
    };
    try {
      const out = await transcribeAudio({
        buffer: Buffer.from("fake-audio"),
        mimeType: "audio/webm",
        filename: "dictation.webm",
      });
      assert.equal(out.text, "Glory Mae was late on August 5.");
      assert.equal(out.model, "gpt-4o-transcribe");
      assert.deepEqual(models, ["gpt-transcribe", "gpt-4o-transcribe"]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("retries newer models without extra hint fields after a 400", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async (_url, opts) => {
      calls += 1;
      if (opts.body.get("keywords")) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: "unknown parameter keywords" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: "Site reporting time moves to 7 AM." }),
      };
    };
    try {
      const out = await transcribeAudio({
        buffer: Buffer.from("fake-audio"),
        mimeType: "audio/webm",
        filename: "dictation.webm",
      });
      assert.equal(out.text, "Site reporting time moves to 7 AM.");
      assert.equal(out.model, "gpt-transcribe");
      assert.equal(calls, 2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
