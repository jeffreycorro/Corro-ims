"use strict";

function hasText(value) {
  return Boolean(value && String(value).trim());
}

function anthropicConfigured() {
  return hasText(process.env.ANTHROPIC_API_KEY);
}

function driveConfigured() {
  return hasText(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

function openaiConfigured() {
  return hasText(process.env.OPENAI_API_KEY);
}

function capabilities() {
  return {
    sample: anthropicConfigured(),
    mcp: driveConfigured(),
    transcribe: openaiConfigured(),
  };
}

module.exports = {
  anthropicConfigured,
  capabilities,
  driveConfigured,
  openaiConfigured,
};
