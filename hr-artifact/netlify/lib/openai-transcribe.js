"use strict";

const { codedError } = require("./coded-error");

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODELS = ["gpt-transcribe", "gpt-4o-transcribe", "whisper-1"];
const MAX_AUDIO_BYTES = 3.5 * 1024 * 1024;
const MAX_SECONDS = 90;

const DEFAULT_PROMPT =
  "Workplace dictation for HR staff at a Philippine construction company in Cebu. " +
  "Speech may mix English and Filipino or Cebuano (Taglish). " +
  "Keep Filipino personal names, place names, and employee numbers as spoken. " +
  "Use ordinary workplace wording. Do not add commentary.";

const DEFAULT_KEYWORDS = [
  "NTE",
  "201 file",
  "memorandum",
  "CorConDev",
  "Cebu",
  "Tawason",
  "Canduman",
  "Barili",
  "PhilHealth",
  "Pag-IBIG",
  "cash advance",
];

function hasText(value) {
  return Boolean(value && String(value).trim());
}

function openaiConfigured() {
  return hasText(process.env.OPENAI_API_KEY);
}

function openaiKey() {
  return String(process.env.OPENAI_API_KEY || "").trim();
}

function transcribeLimits() {
  return {
    maxSeconds: MAX_SECONDS,
    maxBytes: MAX_AUDIO_BYTES,
    models: modelChain(),
  };
}

function modelChain() {
  const override = String(process.env.OPENAI_TRANSCRIBE_MODEL || "").trim();
  if (!override) return DEFAULT_MODELS.slice();
  return [override].concat(DEFAULT_MODELS.filter((m) => m !== override));
}

function configuredLanguages() {
  const raw = String(process.env.OPENAI_TRANSCRIBE_LANGUAGES || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function configuredPrompt() {
  const raw = String(process.env.OPENAI_TRANSCRIBE_PROMPT || "").trim();
  return raw || DEFAULT_PROMPT;
}

function configuredKeywords() {
  const raw = String(process.env.OPENAI_TRANSCRIBE_KEYWORDS || "").trim();
  if (!raw) return DEFAULT_KEYWORDS.slice();
  return raw
    .split(",")
    .map((s) => String(s).trim())
    .filter((s) => s && !/[<>\r\n]/.test(s));
}

function isLegacyWhisper(model) {
  return String(model || "").trim() === "whisper-1";
}

function filenameForMime(mime, fallback) {
  if (fallback) return fallback;
  const type = String(mime || "").toLowerCase();
  if (type.includes("mp4") || type.includes("m4a")) return "dictation.m4a";
  if (type.includes("mpeg") || type.includes("mp3")) return "dictation.mp3";
  if (type.includes("ogg")) return "dictation.ogg";
  if (type.includes("wav")) return "dictation.wav";
  return "dictation.webm";
}

function decodeAudioBase64(value) {
  const s = String(value || "").replace(/\s/g, "");
  if (!s) {
    throw codedError("bad_request", "audio is required");
  }
  let buf;
  try {
    buf = Buffer.from(s, "base64");
  } catch {
    throw codedError("bad_request", "audio could not be decoded");
  }
  if (!buf.length) {
    throw codedError("bad_request", "audio is required");
  }
  if (buf.length > MAX_AUDIO_BYTES) {
    throw codedError(
      "bad_request",
      "That recording is too long. Hold the mic for under 90 seconds."
    );
  }
  return buf;
}

function readAudioFromEvent(event, body) {
  const headers = event.headers || {};
  const ct = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
  if (ct.includes("application/json") || (body && (body.audioBase64 || body.audio || body.file))) {
    const payload = body && typeof body === "object" ? body : {};
    const raw = payload.audioBase64 || payload.audio || payload.file;
    const mimeType = payload.mimeType || payload.contentType || "audio/webm";
    return {
      buffer: decodeAudioBase64(raw),
      mimeType,
      filename: filenameForMime(mimeType, payload.filename),
      language: payload.language,
    };
  }
  if (!event.body) {
    throw codedError("bad_request", "audio is required");
  }
  const buffer = event.isBase64Encoded
    ? Buffer.from(event.body, "base64")
    : Buffer.from(event.body, "binary");
  if (!buffer.length) {
    throw codedError("bad_request", "audio is required");
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw codedError(
      "bad_request",
      "That recording is too long. Hold the mic for under 90 seconds."
    );
  }
  const mimeType = ct && !ct.includes("application/json") ? ct.split(";")[0].trim() : "audio/webm";
  return {
    buffer,
    mimeType,
    filename: filenameForMime(mimeType),
    language: undefined,
  };
}

function mapOpenAiError(status, payload) {
  const message =
    (payload && payload.error && payload.error.message) ||
    (payload && payload.message) ||
    "Transcription failed";
  const lower = String(message).toLowerCase();
  if (status === 401 || status === 403) {
    return codedError("not_granted", "Dictation is not permitted on this site.");
  }
  if (status === 429) {
    return codedError("rate_limited", "Too many dictation requests. Try again in a moment.");
  }
  if (status === 413 || /too large|maximum/.test(lower)) {
    return codedError(
      "bad_request",
      "That recording is too long. Hold the mic for under 90 seconds."
    );
  }
  if (status >= 400 && status < 500) {
    return codedError("bad_request", message);
  }
  return codedError("upstream_error", "The transcription service did not finish.");
}

function modelUnavailable(status, payload) {
  const msg = JSON.stringify((payload && payload.error) || payload || "").toLowerCase();
  if (status === 404) return true;
  return (
    status === 400 &&
    /model[_ -]?not found|does not exist|unknown model|invalid model|no such model/.test(msg)
  );
}

function appendHintFields(form, model, language, { extras = true } = {}) {
  const prompt = configuredPrompt();
  if (prompt) form.append("prompt", prompt);
  if (isLegacyWhisper(model)) {
    if (language) form.append("language", String(language));
    return;
  }
  if (!extras) return;
  const languages = language ? [String(language)] : configuredLanguages();
  if (languages.length) form.append("languages", JSON.stringify(languages));
  const keywords = configuredKeywords();
  if (keywords.length) form.append("keywords", JSON.stringify(keywords));
}

async function postTranscription({ buffer, mimeType, filename, language, model, extras = true }) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type: mimeType || "application/octet-stream" }),
    filename
  );
  form.append("model", model);
  form.append("response_format", "json");
  appendHintFields(form, model, language, { extras });

  const res = await fetch(OPENAI_TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + openaiKey() },
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

function extractText(payload) {
  if (!payload) return "";
  if (typeof payload.text === "string") return payload.text;
  if (payload.transcript && typeof payload.transcript === "string") return payload.transcript;
  return "";
}

async function transcribeAudio(input) {
  if (!openaiConfigured()) {
    throw codedError("not_granted", "Dictation is not configured on this site.");
  }
  const audio = input || {};
  const buffer = audio.buffer;
  if (!buffer || !buffer.length) {
    throw codedError("bad_request", "audio is required");
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw codedError(
      "bad_request",
      "That recording is too long. Hold the mic for under 90 seconds."
    );
  }

  const chain = modelChain();
  let lastErr = null;
  for (let i = 0; i < chain.length; i += 1) {
    const model = chain[i];
    let { res, payload } = await postTranscription({
      buffer,
      mimeType: audio.mimeType,
      filename: audio.filename || filenameForMime(audio.mimeType),
      language: audio.language,
      model,
    });
    if (!res.ok && res.status >= 400 && res.status < 500 && !modelUnavailable(res.status, payload) && !isLegacyWhisper(model)) {
      ({ res, payload } = await postTranscription({
        buffer,
        mimeType: audio.mimeType,
        filename: audio.filename || filenameForMime(audio.mimeType),
        language: audio.language,
        model,
        extras: false,
      }));
    }
    if (res.ok) {
      return {
        text: String(extractText(payload) || "").trim(),
        model,
        language:
          (payload &&
            payload.languages &&
            payload.languages[0] &&
            payload.languages[0].code) ||
          payload.language ||
          undefined,
      };
    }
    if (i < chain.length - 1 && modelUnavailable(res.status, payload)) {
      lastErr = mapOpenAiError(res.status, payload);
      continue;
    }
    throw mapOpenAiError(res.status, payload);
  }
  throw lastErr || codedError("upstream_error", "The transcription service did not finish.");
}

module.exports = {
  DEFAULT_KEYWORDS,
  DEFAULT_MODELS,
  DEFAULT_PROMPT,
  MAX_AUDIO_BYTES,
  MAX_SECONDS,
  OPENAI_TRANSCRIBE_URL,
  configuredKeywords,
  configuredLanguages,
  configuredPrompt,
  decodeAudioBase64,
  filenameForMime,
  isLegacyWhisper,
  mapOpenAiError,
  modelChain,
  modelUnavailable,
  openaiConfigured,
  openaiKey,
  readAudioFromEvent,
  transcribeAudio,
  transcribeLimits,
};
