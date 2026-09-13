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

function officeHashConfigured() {
  return /^[a-f0-9]{64}$/i.test(String(process.env.MOTORPOOL_OFFICE_PASS_HASH || "").trim());
}

function capabilities() {
  return {
    sample: anthropicConfigured(),
    mcp: driveConfigured(),
    transcribe: openaiConfigured(),
    officeHash: officeHashConfigured(),
  };
}

module.exports = {
  anthropicConfigured,
  capabilities,
  driveConfigured,
  officeHashConfigured,
  openaiConfigured,
};
