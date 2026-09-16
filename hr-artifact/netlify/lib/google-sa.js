"use strict";

const fs = require("fs");
const path = require("path");
const { codedError } = require("./coded-error");

const DEFAULT_BLOB_STORE = "hr-secrets";
const DEFAULT_BLOB_KEY = "google-service-account";

let accountCache;
let testBlobLoader = null;
let lastFunctionEvent = null;

function parseServiceAccount(raw) {
  let text = String(raw || "").trim();
  if (!text) return null;
  if (!text.startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf8").trim();
    } catch {
      throw codedError("server_not_connected", "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw codedError("server_not_connected", "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!json.client_email || !json.private_key) {
    throw codedError(
      "server_not_connected",
      "GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key."
    );
  }
  json.private_key = String(json.private_key).replace(/\\n/g, "\n");
  return json;
}

function bundledRaw() {
  try {
    const gen = require("./google-sa.generated");
    return String((gen && gen.raw) || "").trim();
  } catch {
    return "";
  }
}

function fileRaw() {
  const candidates = [
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
    path.join(__dirname, ".secrets", "google-sa.json"),
    path.join(process.cwd(), "netlify", ".secrets", "google-sa.json"),
    path.join(process.cwd(), "netlify", "lib", ".secrets", "google-sa.json"),
  ].filter(Boolean);
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const text = fs.readFileSync(filePath, "utf8").trim();
      if (text && text !== "{}" && text !== "null") return text;
    } catch {
      // try the next path
    }
  }
  return "";
}

function blobStoreAndKey() {
  const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_BLOB || "").trim();
  if (raw && raw !== "1" && raw !== "true" && raw !== "yes") {
    const slash = raw.indexOf("/");
    if (slash > 0) {
      return { store: raw.slice(0, slash), key: raw.slice(slash + 1) || DEFAULT_BLOB_KEY };
    }
    return { store: raw, key: DEFAULT_BLOB_KEY };
  }
  const key = String(process.env.GOOGLE_SERVICE_ACCOUNT_BLOB_KEY || "").trim() || DEFAULT_BLOB_KEY;
  return { store: DEFAULT_BLOB_STORE, key };
}

function attachFunctionEvent(event) {
  if (!event) return;
  lastFunctionEvent = event;
  try {
    const blobs = require("@netlify/blobs");
    if (typeof blobs.connectLambda === "function") {
      blobs.connectLambda(event);
    }
  } catch {
    // Local tests and hosts without Blobs skip this.
  }
}

function onNetlifyRuntime() {
  return (
    process.env.NETLIFY === "true" ||
    process.env.NETLIFY === "1" ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.NETLIFY_BLOBS_CONTEXT) ||
    Boolean(process.env.NETLIFY_DEV) ||
    process.env.CONTEXT === "production" ||
    process.env.CONTEXT === "deploy-preview" ||
    process.env.CONTEXT === "branch-deploy"
  );
}

function shouldTryBlobs() {
  if (String(process.env.GOOGLE_SERVICE_ACCOUNT_BLOB || "").trim()) return true;
  return onNetlifyRuntime();
}

async function readBlobValue(getStore, store, key) {
  const attempts = [];
  try {
    attempts.push(getStore(store));
  } catch {
    // string form rejected
  }
  try {
    attempts.push(getStore({ name: store }));
  } catch {
    // object form rejected
  }
  for (const blobStore of attempts) {
    if (!blobStore || typeof blobStore.get !== "function") continue;
    const value = await blobStore.get(key);
    if (value) return String(value).trim();
  }
  return "";
}

async function loadFromBlobs() {
  if (typeof testBlobLoader === "function") {
    const value = await testBlobLoader();
    return value ? String(value).trim() : "";
  }
  if (!shouldTryBlobs()) return "";
  if (lastFunctionEvent) attachFunctionEvent(lastFunctionEvent);
  try {
    const { getStore } = require("@netlify/blobs");
    const { store, key } = blobStoreAndKey();
    return await readBlobValue(getStore, store, key);
  } catch {
    return "";
  }
}

function loadServiceAccountSync() {
  const fromEnv = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (fromEnv) return parseServiceAccount(fromEnv);
  const fromBundle = bundledRaw();
  if (fromBundle) return parseServiceAccount(fromBundle);
  const fromFile = fileRaw();
  if (fromFile) return parseServiceAccount(fromFile);
  return null;
}

async function loadServiceAccount() {
  if (accountCache) return accountCache;
  const sync = loadServiceAccountSync();
  if (sync) {
    accountCache = sync;
    return accountCache;
  }
  const fromBlobs = await loadFromBlobs();
  if (fromBlobs) {
    accountCache = parseServiceAccount(fromBlobs);
    return accountCache;
  }
  return null;
}

function driveHintConfigured() {
  if (String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim()) return true;
  if (bundledRaw()) return true;
  if (fileRaw()) return true;
  if (String(process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "").trim()) return true;
  if (String(process.env.GOOGLE_SERVICE_ACCOUNT_BLOB || "").trim()) return true;
  return false;
}

async function driveConfigured() {
  try {
    return Boolean(await loadServiceAccount());
  } catch {
    return false;
  }
}

function resetServiceAccountCache() {
  accountCache = undefined;
  lastFunctionEvent = null;
}

function setTestBlobLoader(fn) {
  testBlobLoader = typeof fn === "function" ? fn : null;
  resetServiceAccountCache();
}

module.exports = {
  DEFAULT_BLOB_KEY,
  DEFAULT_BLOB_STORE,
  attachFunctionEvent,
  blobStoreAndKey,
  bundledRaw,
  driveConfigured,
  driveHintConfigured,
  loadServiceAccount,
  loadServiceAccountSync,
  onNetlifyRuntime,
  parseServiceAccount,
  resetServiceAccountCache,
  setTestBlobLoader,
  shouldTryBlobs,
};
