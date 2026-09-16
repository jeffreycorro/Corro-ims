"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  blobStoreAndKey,
  driveConfigured,
  loadServiceAccount,
  parseServiceAccount,
  resetServiceAccountCache,
  setTestBlobLoader,
  shouldTryBlobs,
} = require("../netlify/lib/google-sa");

const SAMPLE = JSON.stringify({
  client_email: "sa@example.com",
  private_key: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n",
});

describe("google service account loader", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_BLOB;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_BLOB_KEY;
    delete process.env.NETLIFY;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    delete process.env.NETLIFY_DEV;
    delete process.env.CONTEXT;
    setTestBlobLoader(null);
    resetServiceAccountCache();
  });

  afterEach(() => {
    setTestBlobLoader(null);
    resetServiceAccountCache();
    process.env = env;
  });

  it("parses raw or base64 JSON and rejects junk", () => {
    const parsed = parseServiceAccount(SAMPLE);
    assert.equal(parsed.client_email, "sa@example.com");
    assert.match(parsed.private_key, /BEGIN PRIVATE KEY/);
    assert.ok(parsed.private_key.includes("\n"));
    const b64 = Buffer.from(SAMPLE, "utf8").toString("base64");
    assert.equal(parseServiceAccount(b64).client_email, "sa@example.com");
    assert.equal(parseServiceAccount(""), null);
    assert.throws(() => parseServiceAccount("{nope"), /not valid JSON/);
  });

  it("loads from GOOGLE_SERVICE_ACCOUNT_FILE without a Functions env JSON", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-sa-"));
    const file = path.join(dir, "sa.json");
    fs.writeFileSync(file, SAMPLE);
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE = file;
    const account = await loadServiceAccount();
    assert.equal(account.client_email, "sa@example.com");
    assert.equal(await driveConfigured(), true);
  });

  it("loads from Netlify Blobs when env and file are empty", async () => {
    setTestBlobLoader(async () => SAMPLE);
    const account = await loadServiceAccount();
    assert.equal(account.client_email, "sa@example.com");
    assert.equal(await driveConfigured(), true);
  });

  it("defaults the Blobs store/key and allows store/key override", () => {
    assert.deepEqual(blobStoreAndKey(), {
      store: "hr-secrets",
      key: "google-service-account",
    });
    process.env.GOOGLE_SERVICE_ACCOUNT_BLOB = "custom-store/my-key";
    assert.deepEqual(blobStoreAndKey(), { store: "custom-store", key: "my-key" });
  });

  it("is not configured when no source is present", async () => {
    setTestBlobLoader(async () => "");
    assert.equal(await driveConfigured(), false);
  });

  it("tries Blobs on Lambda and when the tiny BLOB flag is set", () => {
    assert.equal(shouldTryBlobs(), false);
    process.env.AWS_LAMBDA_FUNCTION_NAME = "auth";
    assert.equal(shouldTryBlobs(), true);
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    process.env.GOOGLE_SERVICE_ACCOUNT_BLOB = "1";
    assert.equal(shouldTryBlobs(), true);
  });

  it("does not cache a Blobs miss so a later connectLambda can retry", async () => {
    let n = 0;
    setTestBlobLoader(async () => {
      n += 1;
      return n === 1 ? "" : SAMPLE;
    });
    assert.equal(await driveConfigured(), false);
    assert.equal(await driveConfigured(), true);
  });

  it("prepare script bundles Builds-only JSON only when forced or on Netlify", () => {
    const root = path.join(__dirname, "..");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-sa-gen-"));
    const generated = path.join(dir, "google-sa.generated.js");
    execFileSync(process.execPath, ["scripts/prepare-google-sa.js"], {
      cwd: root,
      env: {
        ...process.env,
        GOOGLE_SERVICE_ACCOUNT_JSON: SAMPLE,
        GOOGLE_SA_GENERATED_PATH: generated,
      },
      encoding: "utf8",
    });
    assert.match(fs.readFileSync(generated, "utf8"), /raw: ""/);

    execFileSync(process.execPath, ["scripts/prepare-google-sa.js"], {
      cwd: root,
      env: {
        ...process.env,
        GOOGLE_SERVICE_ACCOUNT_JSON: SAMPLE,
        FORCE_GOOGLE_SA_BUNDLE: "1",
        GOOGLE_SA_GENERATED_PATH: generated,
      },
      encoding: "utf8",
    });
    const written = fs.readFileSync(generated, "utf8");
    assert.match(written, /sa@example.com/);
    assert.match(written, /module\.exports = \{ raw:/);
  });
});
