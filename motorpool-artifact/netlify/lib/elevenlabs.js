"use strict";

const { codedError } = require("./coded-error");

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
// Sarah — warmer conversational default for Ask the log (not a flat announcer).
// Override on Netlify corcondev-motorpool with ELEVENLABS_VOICE_ID.
// Previous default was Rachel 21m00Tcm4TlvDq8ikWAM (set that env to roll back).
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
// eleven_multilingual_v2 keeps English / Filipino / Cebuano. For snappier
// English-only replies you can set ELEVENLABS_MODEL_ID=eleven_turbo_v2_5.
const DEFAULT_MODEL = "eleven_multilingual_v2";
const MAX_CHARS = 2500;

function elevenlabsKey() {
  return String(process.env.ELEVENLABS_API_KEY || "").trim();
}

function elevenlabsConfigured() {
  return Boolean(elevenlabsKey());
}

function defaultVoiceId() {
  return String(process.env.ELEVENLABS_VOICE_ID || "").trim() || DEFAULT_VOICE_ID;
}

function defaultModelId() {
  return String(process.env.ELEVENLABS_MODEL_ID || "").trim() || DEFAULT_MODEL;
}

function clamped01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function voiceSettings() {
  // Slightly lower stability = more spoken, less "read this memo".
  // Optional Netlify overrides: ELEVENLABS_STABILITY / ELEVENLABS_SIMILARITY.
  return {
    stability: clamped01(process.env.ELEVENLABS_STABILITY, 0.42),
    similarity_boost: clamped01(process.env.ELEVENLABS_SIMILARITY, 0.82),
  };
}

function ttsLimits() {
  return {
    maxChars: MAX_CHARS,
    defaultVoiceId: defaultVoiceId(),
    modelId: defaultModelId(),
    voiceSettings: voiceSettings(),
  };
}

function sanitizeSpeakText(text) {
  return String(text || "")
    .replace(/[*_#`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mapElevenLabsError(status, json) {
  const detail = json && json.detail;
  const msg =
    (detail && (detail.message || (typeof detail === "string" ? detail : ""))) ||
    (json && (json.message || json.error)) ||
    `ElevenLabs ${status}`;
  if (status === 401 || status === 403) {
    return codedError("not_granted", "Voice readback is not permitted.");
  }
  if (status === 429) {
    return codedError("rate_limited", "Too many voice requests. Try again in a moment.");
  }
  if (status === 413) {
    return codedError("prompt_too_large", "That text is too long to read aloud.");
  }
  if (status >= 500) {
    return codedError("upstream_error", "The voice service did not answer.");
  }
  return codedError("tool_error", String(msg));
}

async function synthesizeSpeech({ text, voiceId, signal }) {
  const key = elevenlabsKey();
  if (!key) {
    throw codedError("not_granted", "Voice readback is not configured on this site.");
  }

  const clean = sanitizeSpeakText(text);
  if (!clean) {
    throw codedError("bad_request", "text is required");
  }
  if (clean.length > MAX_CHARS) {
    throw codedError("prompt_too_large", "That text is too long to read aloud.");
  }

  const voice = String(voiceId || "").trim() || defaultVoiceId();
  const url = `${ELEVENLABS_URL}/${encodeURIComponent(voice)}`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "audio/mpeg",
        "xi-api-key": key,
      },
      body: JSON.stringify({
        text: clean,
        model_id: defaultModelId(),
        voice_settings: voiceSettings(),
      }),
      signal,
    });
  } catch (err) {
    if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
      throw codedError("cancelled", "cancelled");
    }
    throw codedError("upstream_error", "The voice service did not answer.");
  }

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw mapElevenLabsError(res.status, json);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) {
    throw codedError("upstream_error", "The voice service returned empty audio.");
  }

  return {
    audioBase64: buf.toString("base64"),
    mimeType: "audio/mpeg",
    voiceId: voice,
    text: clean,
  };
}

module.exports = {
  DEFAULT_VOICE_ID,
  ELEVENLABS_URL,
  MAX_CHARS,
  defaultModelId,
  defaultVoiceId,
  elevenlabsConfigured,
  elevenlabsKey,
  mapElevenLabsError,
  sanitizeSpeakText,
  synthesizeSpeech,
  ttsLimits,
  voiceSettings,
};
