"use strict";

const { json, requireSession } = require("../lib/session");
const { capabilities } = require("../lib/capabilities");
const { codedError, errorBody } = require("../lib/coded-error");
const { createLimiter } = require("../lib/rate-limit");
const { formatManilaIso } = require("../lib/manila");
const {
  elevenlabsConfigured,
  synthesizeSpeech,
  ttsLimits,
} = require("../lib/elevenlabs");

const limitTts = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: "Too many voice requests. Try again in a moment.",
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
      return json(200, envelope({ available: elevenlabsConfigured(), limits: ttsLimits() }));
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    if (!elevenlabsConfigured()) {
      throw codedError("not_granted", "Voice readback is not configured on this site.");
    }

    limitTts(event);

    const body = JSON.parse(event.body || "{}");
    const result = await synthesizeSpeech({
      text: body.text != null ? body.text : body.prompt,
      voiceId: body.voiceId || body.voice,
    });

    return json(200, envelope(result));
  } catch (err) {
    const status = err.statusCode || (err instanceof SyntaxError ? 400 : 500);
    return json(status, errorBody(err));
  }
};
