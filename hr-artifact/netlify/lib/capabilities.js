"use strict";

const { attachFunctionEvent, driveConfigured } = require("./google-sa");

function hasText(value) {
  return Boolean(value && String(value).trim());
}

function anthropicConfigured() {
  return hasText(process.env.ANTHROPIC_API_KEY);
}

function openaiConfigured() {
  return hasText(process.env.OPENAI_API_KEY);
}

function elevenlabsConfigured() {
  return hasText(process.env.ELEVENLABS_API_KEY);
}

async function capabilities(event) {
  if (event) attachFunctionEvent(event);
  return {
    sample: anthropicConfigured(),
    mcp: await driveConfigured(),
    transcribe: openaiConfigured(),
    tts: elevenlabsConfigured(),
  };
}

module.exports = {
  anthropicConfigured,
  capabilities,
  driveConfigured,
  elevenlabsConfigured,
  openaiConfigured,
};
