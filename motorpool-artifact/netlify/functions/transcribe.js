"use strict";

const { json, requireSession } = require("../lib/session");
const { capabilities, openaiConfigured } = require("../lib/capabilities");
const { codedError, errorBody } = require("../lib/coded-error");
const { createLimiter } = require("../lib/rate-limit");
const { formatManilaIso } = require("../lib/manila");
const {
  readAudioFromEvent,
  transcribeAudio,
  transcribeLimits,
} = require("../lib/openai-transcribe");

const limitTranscribe = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: "Too many dictation requests. Try again in a moment.",
});

function envelope(extra) {
  return {
    timezone: "Asia/Manila",
    serverTime: formatManilaIso(),
    capabilities: capabilities(),
    ...extra,
  };
}

function parseJsonBody(event) {
  const headers = event.headers || {};
  const ct = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
  if (!ct.includes("application/json")) return {};
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    throw codedError("bad_request", "Request body is not valid JSON");
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, body: "" };
    }

    requireSession(event);

    if (event.httpMethod === "GET") {
      return json(200, envelope({ available: openaiConfigured(), limits: transcribeLimits() }));
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    if (!openaiConfigured()) {
      throw codedError("not_granted", "Dictation is not configured on this site.");
    }

    limitTranscribe(event);

    const body = parseJsonBody(event);
    const audio = readAudioFromEvent(event, body);
    const result = await transcribeAudio(audio);

    return json(
      200,
      envelope({
        text: result.text,
        model: result.model,
        language: result.language,
      })
    );
  } catch (err) {
    const status = err.statusCode || (err instanceof SyntaxError ? 400 : 500);
    return json(status, errorBody(err));
  }
};
