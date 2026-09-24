"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  createFile,
  createFileInit,
  delegatedUser,
  extractPdfText,
  getAccessToken,
  mapDriveHttpError,
  mapTokenHttpError,
  mapFile,
  parseServiceAccount,
  resetTokenCache,
  signServiceJwt,
  translateDriveQuery,
  viewUrlFor,
} = require("../netlify/lib/google-drive");
const { resetServiceAccountCache } = require("../netlify/lib/google-sa");

describe("google drive contract", () => {
  it("translates Claude Drive queries into Drive API q=", () => {
    assert.equal(
      translateDriveQuery("parentId = 'abc123'"),
      "('abc123' in parents) and trashed = false"
    );
    assert.equal(
      translateDriveQuery(
        "parentId = 'abc' and mimeType = 'application/vnd.google-apps.folder'"
      ),
      "('abc' in parents and mimeType = 'application/vnd.google-apps.folder') and trashed = false"
    );
    assert.equal(
      translateDriveQuery("parentId = 'p' and title contains '1241 - '"),
      "('p' in parents and name contains '1241 - ') and trashed = false"
    );
    assert.equal(
      translateDriveQuery(
        "title contains 'Contract No.' and mimeType = 'application/pdf'"
      ),
      "(name contains 'Contract No.' and mimeType = 'application/pdf') and trashed = false"
    );
    assert.equal(
      translateDriveQuery(
        "title contains 'NTE' and mimeType != 'application/vnd.google-apps.folder'"
      ),
      "(name contains 'NTE' and mimeType != 'application/vnd.google-apps.folder') and trashed = false"
    );
    assert.match(translateDriveQuery("title contains 'foo\\'s'"), /foo\\'s/);
  });

  it("maps Drive files to the payload the artifact already parses", () => {
    const mapped = mapFile({
      id: "1",
      name: "Resume.pdf",
      mimeType: "application/pdf",
      webViewLink: "https://drive.google.com/file/d/1/view",
      parents: ["parent"],
      modifiedTime: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(mapped, {
      id: "1",
      title: "Resume.pdf",
      mimeType: "application/pdf",
      viewUrl: "https://drive.google.com/file/d/1/view",
      parentId: "parent",
      modifiedTime: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(
      viewUrlFor({ id: "f", mimeType: "application/vnd.google-apps.folder" }),
      "https://drive.google.com/drive/folders/f"
    );
  });

  it("extracts simple PDF text operators", () => {
    const pdf = Buffer.from("%PDF-1.1\nBT\n(Hello) Tj\n[(World)] TJ\nET\n");
    assert.match(extractPdfText(pdf), /Hello/);
    assert.match(extractPdfText(pdf), /World/);
  });

  it("accepts raw or base64 service-account JSON and rejects junk", () => {
    const raw = JSON.stringify({
      client_email: "sa@example.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n",
    });
    const parsed = parseServiceAccount(raw);
    assert.equal(parsed.client_email, "sa@example.com");
    assert.match(parsed.private_key, /BEGIN PRIVATE KEY/);
    assert.ok(parsed.private_key.includes("\n"));
    const b64 = Buffer.from(raw, "utf8").toString("base64");
    assert.equal(parseServiceAccount(b64).client_email, "sa@example.com");
    assert.equal(parseServiceAccount(""), null);
    assert.throws(() => parseServiceAccount("{nope"), /not valid JSON/);
  });
});

function decodeJwtPayload(token) {
  const part = String(token || "").split(".")[1];
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function testAccount() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    client_email: "sa@example.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

describe("drive delegation and quota", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    delete process.env.GOOGLE_DRIVE_DELEGATED_USER;
    delete process.env.GOOGLE_DRIVE_IMPERSONATE;
    delete process.env.GOOGLE_IMPERSONATE_USER;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_BLOB;
    resetTokenCache();
    resetServiceAccountCache();
  });

  afterEach(() => {
    resetTokenCache();
    resetServiceAccountCache();
    process.env = env;
    global.fetch = envFetch;
  });

  const envFetch = global.fetch;

  it("puts sub on the service-account JWT when GOOGLE_DRIVE_DELEGATED_USER is set", () => {
    const account = testAccount();
    process.env.GOOGLE_DRIVE_DELEGATED_USER = "hr@example.com";
    const claims = decodeJwtPayload(signServiceJwt(account));
    assert.equal(claims.iss, "sa@example.com");
    assert.equal(claims.sub, "hr@example.com");
    assert.equal(claims.scope, "https://www.googleapis.com/auth/drive");
    assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  });

  it("omits sub when no delegated mailbox is configured", () => {
    const claims = decodeJwtPayload(signServiceJwt(testAccount()));
    assert.equal(claims.sub, undefined);
  });

  it("accepts impersonation aliases and prefers the canonical env name", () => {
    process.env.GOOGLE_DRIVE_IMPERSONATE = "alias@example.com";
    assert.equal(delegatedUser(), "alias@example.com");
    assert.equal(decodeJwtPayload(signServiceJwt(testAccount())).sub, "alias@example.com");

    delete process.env.GOOGLE_DRIVE_IMPERSONATE;
    process.env.GOOGLE_IMPERSONATE_USER = '"other@example.com"';
    assert.equal(delegatedUser(), "other@example.com");

    process.env.GOOGLE_DRIVE_DELEGATED_USER = "canonical@example.com";
    assert.equal(delegatedUser(), "canonical@example.com");
    assert.equal(decodeJwtPayload(signServiceJwt(testAccount())).sub, "canonical@example.com");
  });

  it("refreshes a cached token when the delegated subject appears", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(testAccount());
    const assertions = [];
    global.fetch = async (_url, opts) => {
      assertions.push(new URLSearchParams(opts.body).get("assertion"));
      return { ok: true, json: async () => ({ access_token: "tok-" + assertions.length, expires_in: 3600 }) };
    };
    assert.equal(await getAccessToken(), "tok-1");
    assert.equal(decodeJwtPayload(assertions[0]).sub, undefined);
    process.env.GOOGLE_DRIVE_DELEGATED_USER = "hr@example.com";
    assert.equal(await getAccessToken(), "tok-2");
    assert.equal(decodeJwtPayload(assertions[1]).sub, "hr@example.com");
    assert.equal(await getAccessToken(), "tok-2");
    assert.equal(assertions.length, 2);
  });

  it("uploads Leave/CA files with supportsAllDrives on the delegated token", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(testAccount());
    process.env.GOOGLE_DRIVE_DELEGATED_USER = "hr@example.com";
    const urls = [];
    let assertion = "";
    global.fetch = async (url, opts) => {
      const href = String(url);
      urls.push(href + " " + (opts && opts.method));
      if (href.includes("oauth2.googleapis.com/token")) {
        assertion = new URLSearchParams(opts.body).get("assertion");
        return { ok: true, json: async () => ({ access_token: "ya29.delegated", expires_in: 3600 }) };
      }
      if (href.includes("/upload/drive/v3/files") && opts && opts.method === "POST") {
        const created = {
          id: "file1",
          name: "1001-LEAVE SIGNED.pdf",
          mimeType: "application/pdf",
          webViewLink: "https://drive.google.com/file/d/file1/view",
          parents: ["inbox"],
        };
        return {
          ok: true,
          status: 200,
          headers: { get: () => "https://upload.example/session" },
          json: async () => created,
        };
      }
      throw new Error("unexpected fetch " + href);
    };
    const created = await createFile({
      title: "1001-LEAVE SIGNED.pdf",
      parentId: "inbox",
      base64Content: Buffer.from("%PDF").toString("base64"),
      contentMimeType: "application/pdf",
    });
    assert.equal(created.payload.viewUrl, "https://drive.google.com/file/d/file1/view");
    assert.equal(decodeJwtPayload(assertion).sub, "hr@example.com");
    assert.match(urls.find((u) => u.includes("uploadType=multipart")), /supportsAllDrives=true/);

    await createFileInit(
      {
        title: "1002-CASH ADVANCE SIGNED.pdf",
        parentId: "inbox",
        contentMimeType: "application/pdf",
        size: 12,
      },
      "upload-secret"
    );
    assert.match(urls.find((u) => u.includes("uploadType=resumable")), /supportsAllDrives=true/);
  });

  it("maps storageQuotaExceeded and uploadQuotaExceeded to an operator message", () => {
    const storage = mapDriveHttpError(403, {
      error: {
        message: "The user's Drive storage quota has been exceeded.",
        errors: [{ reason: "storageQuotaExceeded" }],
      },
    });
    assert.equal(storage.code, "quota_exceeded");
    assert.match(storage.message, /service account's My Drive is full/);
    assert.match(storage.message, /GOOGLE_DRIVE_DELEGATED_USER/);
    assert.match(storage.message, /does not use the owner's quota/);
    assert.match(storage.message, /https:\/\/www\.googleapis\.com\/auth\/drive/);
    assert.match(storage.message, /corcondev-hr/);
    assert.match(storage.message, /all contexts/i);
    assert.match(storage.message, /jeffreycorro@corroconstruction\.com/);

    const upload = mapDriveHttpError(403, {
      error: {
        message: "The file upload quota has been reached",
        errors: [{ reason: "uploadQuotaExceeded" }],
      },
    });
    assert.equal(upload.code, "quota_exceeded");
    assert.match(upload.message, /service account's My Drive is full/);

    process.env.GOOGLE_DRIVE_DELEGATED_USER = "hr@example.com";
    const delegated = mapDriveHttpError(403, {
      error: {
        message: "Service Accounts do not have storage quota.",
        errors: [{ reason: "storageQuotaExceeded" }],
      },
    });
    assert.match(delegated.message, /hr@example\.com/);
    assert.match(delegated.message, /GOOGLE_DRIVE_DELEGATED_USER/);
  });

  it("names domain-wide delegation when Google rejects the impersonated token", () => {
    process.env.GOOGLE_DRIVE_DELEGATED_USER = "hr@example.com";
    const refused = mapTokenHttpError(401, {
      error: "unauthorized_client",
      error_description: "Client is unauthorized to retrieve access tokens using this method",
    });
    assert.equal(refused.code, "tool_error");
    assert.match(refused.message, /domain-wide delegation/);
    assert.match(refused.message, /client_id/);
    assert.match(refused.message, /https:\/\/www\.googleapis\.com\/auth\/drive/);

    delete process.env.GOOGLE_DRIVE_DELEGATED_USER;
    const plain = mapTokenHttpError(401, { error: "invalid_grant", error_description: "bad key" });
    assert.equal(plain.code, "needs_reauth");
  });
});
