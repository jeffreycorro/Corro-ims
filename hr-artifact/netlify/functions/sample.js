"use strict";

const { json, requireSession } = require("../lib/session");
const { anthropicConfigured, capabilities } = require("../lib/capabilities");
const { codedError, errorBody } = require("../lib/coded-error");
const { createLimiter } = require("../lib/rate-limit");
const {
  callAnthropic,
  normalizeMessages,
  parseJsonText,
  sampleLimits,
} = require("../lib/anthropic");
const { formatManilaIso } = require("../lib/manila");

const limitSample = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many AI requests. Try again in a moment.",
});

function envelope(extra) {
  return {
    timezone: "Asia/Manila",
    serverTime: formatManilaIso(),
    capabilities: capabilities(),
    ...extra,
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, body: "" };
    }

    requireSession(event);

    if (event.httpMethod === "GET") {
      return json(200, envelope({ available: anthropicConfigured(), limits: sampleLimits() }));
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    if (!anthropicConfigured()) {
      throw codedError("not_granted", "AI drafting is not configured on this site.");
    }

    limitSample(event);

    const body = JSON.parse(event.body || "{}");
    const messages = normalizeMessages(body.messages != null ? body.messages : body.prompt);
    const result = await callAnthropic({
      messages,
      tools: body.tools,
      modelTier: body.modelTier || body.tier || "default",
      mode: body.mode,
    });

    if (body.mode === "json") {
      const parsed = parseJsonText(result.text);
      return json(200, envelope({ json: parsed, text: result.text, truncated: result.truncated }));
    }

    return json(
      200,
      envelope({
        text: result.text,
        truncated: result.truncated,
        toolCalls: result.toolCalls,
        assistantContent: result.assistantContent,
      })
    );
  } catch (err) {
    const status = err.statusCode || (err instanceof SyntaxError ? 400 : 500);
    return json(status, errorBody(err));
  }
};
