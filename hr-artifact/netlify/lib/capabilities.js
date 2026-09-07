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

function capabilities() {
  return {
    sample: anthropicConfigured(),
    mcp: driveConfigured(),
  };
}

module.exports = {
  anthropicConfigured,
  capabilities,
  driveConfigured,
};
