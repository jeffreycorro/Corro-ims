"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractPdfText,
  mapFile,
  parseServiceAccount,
  translateDriveQuery,
  viewUrlFor,
} = require("../netlify/lib/google-drive");

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
