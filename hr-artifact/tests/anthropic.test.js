"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  coalesceMessages,
  extractText,
  extractToolCalls,
  mapAnthropicError,
  modelForTier,
  normalizeMessages,
  parseJsonText,
  sampleLimits,
  toAnthropicTools,
} = require("../netlify/lib/anthropic");

describe("anthropic contract", () => {
  it("normalizes a string prompt and merges consecutive user turns", () => {
    assert.deepEqual(normalizeMessages("Hello"), [{ role: "user", content: "Hello" }]);
    const merged = normalizeMessages([
      { role: "user", content: "Rules" },
      { role: "user", content: "Who is late?" },
    ]);
    assert.equal(merged.length, 1);
    assert.match(merged[0].content, /Rules/);
    assert.match(merged[0].content, /Who is late/);
  });

  it("inserts a user turn when the first message is assistant", () => {
    const out = coalesceMessages([{ role: "assistant", content: "hi" }]);
    assert.equal(out[0].role, "user");
    assert.equal(out[1].role, "assistant");
  });

  it("maps tool schemas from inputSchema and caps the list", () => {
    const tools = toAnthropicTools([
      { name: "find_employee", description: "find", inputSchema: { type: "object" } },
      { name: "" },
    ]);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].input_schema.type, "object");
  });

  it("parses JSON even when wrapped in fences or prose", () => {
    assert.deepEqual(parseJsonText('{"a":1}'), { a: 1 });
    assert.deepEqual(parseJsonText('```json\n{"a":2}\n```'), { a: 2 });
    assert.deepEqual(parseJsonText('Here:\n{"a":3}\nThanks'), { a: 3 });
    assert.throws(() => parseJsonText("not json"), /valid JSON/);
  });

  it("extracts text and tool_use blocks from Anthropic content", () => {
    const content = [
      { type: "text", text: "Looking up" },
      { type: "tool_use", id: "t1", name: "find_employee", input: { query: "ada" } },
    ];
    assert.equal(extractText(content), "Looking up");
    assert.deepEqual(extractToolCalls(content), [
      { id: "t1", name: "find_employee", input: { query: "ada" } },
    ]);
  });

  it("maps Anthropic HTTP errors to artifact codes", () => {
    assert.equal(mapAnthropicError(401, {}).code, "not_granted");
    assert.equal(mapAnthropicError(429, {}).code, "rate_limited");
    assert.equal(mapAnthropicError(413, {}).code, "prompt_too_large");
    assert.equal(mapAnthropicError(400, { error: { message: "prompt is too long" } }).code, "prompt_too_large");
    assert.equal(mapAnthropicError(500, {}).code, "upstream_error");
  });

  it("selects models by tier and advertises tool limits", () => {
    const prev = process.env.ANTHROPIC_MODEL;
    const prevC = process.env.ANTHROPIC_MODEL_COMPLEX;
    process.env.ANTHROPIC_MODEL = "claude-sonnet-test";
    process.env.ANTHROPIC_MODEL_COMPLEX = "claude-opus-test";
    try {
      assert.equal(modelForTier("default"), "claude-sonnet-test");
      assert.equal(modelForTier("complex"), "claude-opus-test");
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_MODEL;
      else process.env.ANTHROPIC_MODEL = prev;
      if (prevC === undefined) delete process.env.ANTHROPIC_MODEL_COMPLEX;
      else process.env.ANTHROPIC_MODEL_COMPLEX = prevC;
    }
    const limits = sampleLimits();
    assert.equal(limits.tools.maxCount, 8);
  });
});
