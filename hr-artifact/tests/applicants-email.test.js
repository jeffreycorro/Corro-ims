"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { signSession, COOKIE_NAME } = require("../netlify/lib/session");
const {
  parseFrom,
  applicantFromEmail,
  parseImapFetch,
  imapConfigured,
  mailboxAddress,
} = require("../netlify/lib/applicants-email");
const { createHandler } = require("../netlify/functions/applicants-email");

const SECRET = "test-hr-session-secret-value";

function cookieHeader() {
  const token = signSession({ sub: "hr-1", method: "supabase", role: "hr", email: "cassie@corcondev.com" }, SECRET);
  return `${COOKIE_NAME}=${token}`;
}

describe("application email parse", () => {
  it("reads name, email, mobile and position from a typical application", () => {
    const row = applicantFromEmail(
      {
        from: "Juan Dela Cruz <juan@example.com>",
        subject: "Application for Site Engineer",
        body: "Good day. I am applying for Site Engineer. Mobile 0917 555 1212.",
        date: "2026-09-18",
      },
      "2026-09-18"
    );
    assert.equal(row.name, "Juan Dela Cruz");
    assert.equal(row.email, "juan@example.com");
    assert.match(row.mobile, /0917/);
    assert.match(row.position, /Site Engineer/i);
    assert.equal(row.source, mailboxAddress());
    assert.equal(row.appliedOn, "2026-09-18");
  });

  it("parses IMAP FETCH header blocks", () => {
    const raw =
      "* 1 FETCH (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {70}\n" +
      "From: Ana Reyes <ana@example.com>\nSubject: Applying for Driver\nDate: 18 Sep 2026\n\n" +
      " BODY[TEXT] {20}\nI can start Monday.\n)\nA1 OK Fetch completed\n";
    const msgs = parseImapFetch(raw);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].from, /Ana Reyes/);
    assert.match(msgs[0].subject, /Driver/);
  });

  it("parseFrom accepts bare addresses", () => {
    assert.deepEqual(parseFrom("hrcorcondev@gmail.com"), {
      name: "",
      email: "hrcorcondev@gmail.com",
    });
  });
});

describe("applicants-email function", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    process.env.HR_SESSION_SECRET = SECRET;
    delete process.env.HR_APPLICANTS_IMAP_USER;
    delete process.env.HR_APPLICANTS_IMAP_PASS;
  });

  afterEach(() => {
    process.env = env;
  });

  it("rejects pull without a session", async () => {
    const handler = createHandler({
      fetchMailboxEmails: async () => [],
    });
    const res = await handler({ httpMethod: "GET", headers: {} });
    assert.equal(res.statusCode, 401);
  });

  it("reports unconfigured IMAP to a signed-in user", async () => {
    assert.equal(imapConfigured(), false);
    const handler = createHandler();
    const res = await handler({
      httpMethod: "GET",
      headers: { cookie: cookieHeader() },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.configured, false);
    assert.match(body.mailbox, /hrcorcondev@gmail.com/);
  });

  it("POST without IMAP env returns 503 and does not invent secrets", async () => {
    const handler = createHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { cookie: cookieHeader() },
      body: "{}",
    });
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.code, "imap_unconfigured");
    assert.match(body.hint, /IMAP|inbox/i);
    assert.doesNotMatch(JSON.stringify(body), /xxxx-xxxx|app-password-value/i);
  });

  it("ingests pulled messages through applicants-ingest when IMAP is stubbed", async () => {
    const docs = {};
    const handler = createHandler({
      async fetchMailboxEmails() {
        return [
          {
            from: "Maria Santos <maria@example.com>",
            subject: "Application for Safety Officer",
            body: "Please consider me.",
            date: "2026-09-18",
          },
        ];
      },
      async getDoc() {
        return null;
      },
      async setDoc(collection, id, data) {
        docs[`${collection}/${id}`] = data;
      },
      async listCollection() {
        return [];
      },
      today: () => "2026-09-18",
    });
    process.env.HR_APPLICANTS_IMAP_USER = "hrcorcondev@gmail.com";
    process.env.HR_APPLICANTS_IMAP_PASS = "xxxx-xxxx-xxxx-xxxx";
    const res = await handler({
      httpMethod: "POST",
      headers: { cookie: cookieHeader() },
      body: "{}",
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.pulled, 1);
    assert.equal(body.created.length, 1);
    assert.match(body.created[0].name, /Maria Santos/);
    const stored = Object.values(docs)[0];
    assert.equal(stored.name, "Maria Santos");
    assert.equal(stored.source, "hrcorcondev@gmail.com");
  });

  it("is wired from the shim and documented for Cassie", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const ui = fs.readFileSync(path.join(__dirname, "../public/hr-email-applicants.js"), "utf8");
    const docs = fs.readFileSync(path.join(__dirname, "../docs/applicants-ingest.md"), "utf8");
    assert.match(shim, /hr-email-applicants\.js/);
    assert.match(ui, /Import from email/);
    assert.match(ui, /hrcorcondev@gmail.com/);
    assert.match(ui, /Overwrite from extractor \(by id\)/);
    assert.match(ui, /1G1TJ5rmI_rGEQcXjKLfYfy2dx9gtZRgC/);
    assert.match(ui, /builder-latest-applicants-export/);
    assert.match(docs, /Cassie: Import from email/);
    assert.match(docs, /updateOnly/);
    assert.match(docs, /Overwrite from extractor/);
    assert.doesNotMatch(ui, /xxxx-xxxx/);
  });
});
