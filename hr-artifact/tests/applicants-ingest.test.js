"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { COOKIE_NAME, signSession } = require("../netlify/lib/session");
const {
  MAX_BATCH,
  STAGES,
  authorizeIngest,
  blankApplicant,
  ingestApplicants,
  ingestKey,
  normalizeItem,
  parseIngestBody,
  presentedIngestKey,
} = require("../netlify/lib/applicants-ingest");
const { createHandler } = require("../netlify/functions/applicants-ingest");

const SECRET = "test-hr-gate-secret-value";
const INGEST_KEY = "unit-test-ingest-key-not-for-production";

function memoryStore(seed = {}) {
  const docs = new Map();
  for (const [collection, rows] of Object.entries(seed)) {
    for (const [id, data] of Object.entries(rows)) {
      docs.set(`${collection}/${id}`, { collection, id, data });
    }
  }
  return {
    docs,
    async getDoc(collection, id) {
      return docs.get(`${collection}/${id}`) || null;
    },
    async setDoc(collection, id, data) {
      const row = { collection, id, data };
      docs.set(`${collection}/${id}`, row);
      return row;
    },
    async listCollection(collection) {
      const out = [];
      for (const row of docs.values()) {
        if (row.collection === collection) out.push(row);
      }
      return out;
    },
  };
}

describe("applicants ingest validation", () => {
  it("requires a JSON object with a non-empty applicants array", () => {
    assert.throws(() => parseIngestBody("{"), /JSON/);
    assert.throws(() => parseIngestBody("[]"), /applicants/);
    assert.throws(() => parseIngestBody("{}"), /applicants/);
    assert.throws(() => parseIngestBody(JSON.stringify({ applicants: [] })), /empty/);
    const ok = parseIngestBody(JSON.stringify({ applicants: [{ name: "Ada" }] }));
    assert.equal(ok.applicants.length, 1);
    assert.equal(ok.overwrite, false);
    assert.equal(ok.forceNew, false);
    assert.equal(ok.updateOnly, false);
  });

  it("treats the extractor export wrapper as updateOnly overwrite-by-id", () => {
    const parsed = parseIngestBody(
      JSON.stringify({
        asOf: "2026-09-18T13:05+08:00",
        driveFolderId: "1G1TJ5rmI_rGEQcXjKLfYfy2dx9gtZRgC",
        counts: { totalApplicants: 2, withResumeLink: 2, backfillPatched: 1, shortlist: 1 },
        applicants: [
          { id: "a_keep", name: "Ada", resumeLink: "https://drive.example/ada" },
          { id: "a_gone", name: "Bess", resumeLink: "https://drive.example/bess" },
        ],
      })
    );
    assert.equal(parsed.updateOnly, true);
    assert.equal(parsed.overwrite, true);
    assert.equal(parsed.applicants.length, 2);
  });

  it("accepts the extractor CSV and marks it updateOnly", () => {
    const csv =
      "id,name,resumeLink,patchedInBackfill,isShortlist\n" +
      'a_keep,"Lovelace, Ada",https://drive.example/ada,False,True\n';
    const parsed = parseIngestBody(csv);
    assert.equal(parsed.updateOnly, true);
    assert.equal(parsed.overwrite, true);
    assert.equal(parsed.applicants[0].id, "a_keep");
    assert.equal(parsed.applicants[0].name, "Lovelace, Ada");
    assert.equal(parsed.applicants[0].resumeLink, "https://drive.example/ada");
  });

  it("rejects batches larger than the documented max", () => {
    const applicants = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ name: `N${i}` }));
    assert.throws(() => parseIngestBody(JSON.stringify({ applicants })), /At most/);
  });

  it("accepts On Hold and Shortlisted without resetting them to Applied", () => {
    assert.ok(STAGES.includes("On Hold"));
    assert.ok(STAGES.includes("Shortlisted"));
    const hold = normalizeItem(
      { name: "Moran, Cassie", stage: "On Hold", appliedOn: "2026-09-24" },
      0,
      { today: "2026-09-25" }
    );
    const short = normalizeItem(
      { name: "Cruz, Ana", stage: "Shortlisted" },
      1,
      { today: "2026-09-25" }
    );
    assert.equal(hold.ok, true);
    assert.equal(hold.stage, "On Hold");
    assert.equal(hold.warnings && hold.warnings.length, 0);
    assert.equal(short.ok, true);
    assert.equal(short.stage, "Shortlisted");
  });

  it("requires a non-empty name and defaults stage, source, and appliedOn", () => {
    assert.equal(normalizeItem({}, 0, { today: "2026-09-14" }).error, "name is required");
    assert.equal(normalizeItem({ name: "   " }, 0, { today: "2026-09-14" }).error, "name is required");
    const row = normalizeItem({ name: "Dela Cruz, Juan" }, 0, { today: "2026-09-14" });
    assert.equal(row.ok, true);
    assert.equal(row.stage, "Applied");
    assert.equal(row.source, "Email");
    assert.equal(row.appliedOn, "2026-09-14");
    assert.equal(row.overwrite, false);
  });

  it("does not treat overwrite as allowed without an explicit id", () => {
    const row = normalizeItem({ name: "Ada", overwrite: true }, 0, { today: "2026-09-14" });
    assert.equal(row.ok, false);
    assert.match(row.error, /overwrite requires an explicit id/);
  });

  it("does not treat updateOnly as allowed without an explicit id", () => {
    const row = normalizeItem({ name: "Ada", updateOnly: true }, 0, { today: "2026-09-14" });
    assert.equal(row.ok, false);
    assert.match(row.error, /updateOnly requires an explicit id/);
  });

  it("rejects a malformed appliedOn and unknown-looking ids", () => {
    assert.match(
      normalizeItem({ name: "Ada", appliedOn: "09/14/2026" }, 0, { today: "2026-09-14" }).error,
      /YYYY-MM-DD/
    );
    assert.match(
      normalizeItem({ name: "Ada", id: "applicants/nope" }, 0, { today: "2026-09-14" }).error,
      /id must/
    );
  });

  it("blank applicant records start with empty exam, interview, history, background, and staffNotes arrays", () => {
    const doc = blankApplicant("a_test", "2026-09-14");
    assert.deepEqual(doc.exams, []);
    assert.deepEqual(doc.interviews, []);
    assert.deepEqual(doc.history, []);
    assert.deepEqual(doc.background, []);
    assert.deepEqual(doc.staffNotes, []);
    assert.equal(doc.stage, "Applied");
    assert.equal(doc.source, "Email");
  });
});

describe("applicants ingest persist", () => {
  it("creates Applied applicants with resumeLink and notes", async () => {
    const store = memoryStore({
      roles: { ro02: { id: "ro02", title: "Project Manager", dept: "Technical" } },
    });
    const result = await ingestApplicants(
      [
        {
          name: "Dela Cruz, Juan",
          email: "juan@example.com",
          roleId: "ro02",
          resumeLink: "https://drive.example/cv",
          notes: "From GoDaddy Apps inbox",
          source: "GoDaddy",
        },
      ],
      { ...store, today: "2026-09-14" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.created.length, 1);
    assert.equal(result.created[0].name, "Dela Cruz, Juan");
    const saved = store.docs.get(`applicants/${result.created[0].id}`).data;
    assert.equal(saved.stage, "Applied");
    assert.equal(saved.source, "GoDaddy");
    assert.equal(saved.appliedOn, "2026-09-14");
    assert.equal(saved.resumeLink, "https://drive.example/cv");
    assert.equal(saved.notes, "From GoDaddy Apps inbox");
    assert.equal(saved.roleId, "ro02");
    assert.equal(saved.position, "Project Manager");
    assert.equal(saved.dept, "Technical");
    assert.deepEqual(saved.exams, []);
    assert.deepEqual(saved.interviews, []);
  });

  it("does not overwrite an existing id unless overwrite is true", async () => {
    const store = memoryStore({
      applicants: {
        a_keep: {
          id: "a_keep",
          name: "Original",
          stage: "Interview",
          source: "Walk-in",
          exams: [{ examId: "x1", score: 10 }],
        },
      },
    });
    const blocked = await ingestApplicants(
      [{ id: "a_keep", name: "Replacement" }],
      { ...store, today: "2026-09-14" }
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.created.length, 0);
    assert.match(blocked.errors[0].error, /already exists/);
    assert.equal(store.docs.get("applicants/a_keep").data.name, "Original");

    const replaced = await ingestApplicants(
      [{ id: "a_keep", name: "Replacement", overwrite: true, notes: "updated" }],
      { ...store, today: "2026-09-14" }
    );
    assert.equal(replaced.ok, true);
    assert.equal(replaced.created.length, 0);
    assert.equal(replaced.updated.length, 1);
    assert.equal(replaced.updated[0].matchedBy, "id");
    const saved = store.docs.get("applicants/a_keep").data;
    assert.equal(saved.name, "Replacement");
    assert.equal(saved.notes, "updated");
    assert.equal(saved.exams[0].examId, "x1");
    assert.equal(saved.stage, "Interview");
    assert.equal(saved.source, "Walk-in");
  });

  it("updateOnly overwrites an existing id and never creates a missing id", async () => {
    const store = memoryStore({
      applicants: {
        a_keep: {
          id: "a_keep",
          name: "Original",
          stage: "Interview",
          source: "Walk-in",
          appliedOn: "2026-08-10",
          resumeLink: "",
          exams: [{ examId: "x1", score: 10 }],
        },
      },
    });
    const result = await ingestApplicants(
      [
        {
          id: "a_keep",
          name: "Original",
          resumeLink: "https://drive.example/cv",
          updateOnly: true,
        },
        {
          id: "a_missing",
          name: "Should Not Appear",
          resumeLink: "https://drive.example/nope",
          updateOnly: true,
        },
      ],
      { ...store, today: "2026-09-18", batchUpdateOnly: true }
    );
    assert.equal(result.created.length, 0);
    assert.equal(result.updated.length, 1);
    assert.equal(result.updated[0].id, "a_keep");
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /not on Pipeline/);
    assert.equal(store.docs.has("applicants/a_missing"), false);
    const saved = store.docs.get("applicants/a_keep").data;
    assert.equal(saved.resumeLink, "https://drive.example/cv");
    assert.equal(saved.stage, "Interview");
    assert.equal(saved.source, "Walk-in");
    assert.equal(saved.appliedOn, "2026-08-10");
    assert.equal(saved.exams[0].examId, "x1");
    const rows = [...store.docs.values()].filter((r) => r.collection === "applicants");
    assert.equal(rows.length, 1);
  });

  it("soft-fails a missing roleId without rejecting the rest of the batch", async () => {
    const store = memoryStore({
      roles: { ro01: { id: "ro01", title: "Operations Manager", dept: "Technical" } },
    });
    const result = await ingestApplicants(
      [
        { name: "Bad Role", roleId: "ro99" },
        { name: "Good Role", roleId: "ro01" },
        { name: "" },
      ],
      { ...store, today: "2026-09-14" }
    );
    assert.equal(result.ok, false);
    assert.equal(result.created.length, 2);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].index, 2);
    const warned = result.created.find((row) => row.name === "Bad Role");
    assert.match(warned.warning, /ro99/);
    const saved = store.docs.get(`applicants/${warned.id}`).data;
    assert.equal(saved.roleId, "");
    const ok = result.created.find((row) => row.name === "Good Role");
    assert.equal(store.docs.get(`applicants/${ok.id}`).data.roleId, "ro01");
  });

  it("updates an existing Applied row on the same normalized name instead of creating another", async () => {
    const store = memoryStore({
      applicants: {
        a_keep: {
          id: "a_keep",
          name: "Sibonga, Tristan",
          stage: "Applied",
          appliedOn: "2026-08-10",
          roleId: "ro02",
          email: "",
          notes: "First email",
          exams: [],
          interviews: [],
          history: [],
        },
      },
    });
    const result = await ingestApplicants(
      [
        {
          name: "Tristan Sibonga",
          appliedOn: "2026-08-10",
          mobile: "0917 111 1111",
          notes: "GoDaddy reload",
        },
      ],
      { ...store, today: "2026-09-15" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.created.length, 0);
    assert.equal(result.updated.length, 1);
    assert.equal(result.updated[0].id, "a_keep");
    assert.equal(result.updated[0].matchedBy, "name");
    const rows = [...store.docs.values()].filter((r) => r.collection === "applicants");
    assert.equal(rows.length, 1);
    const saved = store.docs.get("applicants/a_keep").data;
    assert.equal(saved.appliedOn, "2026-08-10");
    assert.equal(saved.mobile, "0917 111 1111");
    assert.match(saved.notes, /First email/);
    assert.match(saved.notes, /GoDaddy reload|Re-applied/);
    assert.equal(saved.stage, "Applied");
  });

  it("matches on email even when the name is written differently", async () => {
    const store = memoryStore({
      applicants: {
        a_mail: {
          id: "a_mail",
          name: "Cañete, Prince Joseph F.",
          stage: "Screening",
          appliedOn: "2026-08-01",
          email: "prince@example.com",
          resumeLink: "",
          exams: [],
          interviews: [],
          history: [],
        },
      },
    });
    const result = await ingestApplicants(
      [
        {
          name: "Prince Joseph F. Canete",
          email: "Prince@example.com",
          appliedOn: "2026-08-10",
          resumeLink: "https://drive.example/cv",
        },
      ],
      { ...store, today: "2026-09-15" }
    );
    assert.equal(result.updated[0].id, "a_mail");
    assert.equal(result.updated[0].matchedBy, "email");
    const saved = store.docs.get("applicants/a_mail").data;
    assert.equal(saved.appliedOn, "2026-08-01");
    assert.equal(saved.stage, "Screening");
    assert.equal(saved.resumeLink, "https://drive.example/cv");
  });

  it("creates a new row when forceNew is set", async () => {
    const store = memoryStore({
      applicants: {
        a_keep: {
          id: "a_keep",
          name: "Barrios, Luisa G.",
          stage: "Applied",
          appliedOn: "2026-05-15",
          exams: [],
          interviews: [],
          history: [],
        },
      },
    });
    const result = await ingestApplicants(
      [{ name: "Barrios, Luisa G.", forceNew: true, appliedOn: "2026-05-15" }],
      { ...store, today: "2026-09-15" }
    );
    assert.equal(result.created.length, 1);
    assert.equal(result.updated.length, 0);
    assert.notEqual(result.created[0].id, "a_keep");
    const rows = [...store.docs.values()].filter((r) => r.collection === "applicants");
    assert.equal(rows.length, 2);
  });

  it("does not fold two people who share a last name but have different emails", async () => {
    const store = memoryStore({
      applicants: {
        a_one: {
          id: "a_one",
          name: "Santos, Maria",
          email: "maria@example.com",
          stage: "Applied",
          appliedOn: "2026-01-01",
          exams: [],
          interviews: [],
          history: [],
        },
      },
    });
    const result = await ingestApplicants(
      [{ name: "Santos, Maria", email: "other.maria@example.com" }],
      { ...store, today: "2026-09-15" }
    );
    assert.equal(result.created.length, 1);
    assert.equal(result.updated.length, 0);
    const rows = [...store.docs.values()].filter((r) => r.collection === "applicants");
    assert.equal(rows.length, 2);
  });
});

describe("applicants ingest auth", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    process.env.HR_GATE_SECRET = SECRET;
    delete process.env.HR_APPLICANTS_INGEST_KEY;
  });

  afterEach(() => {
    process.env = env;
  });

  it("does not invent a default ingest key", () => {
    assert.equal(ingestKey(), "");
    assert.equal(presentedIngestKey({ headers: {} }), "");
  });

  it("rejects requests with no session and no ingest key", () => {
    assert.throws(() => authorizeIngest({ headers: {} }), (err) => err.statusCode === 401);
  });

  it("rejects a presented key when HR_APPLICANTS_INGEST_KEY is unset", () => {
    assert.throws(
      () =>
        authorizeIngest({
          headers: { "x-hr-ingest-key": "anything" },
        }),
      (err) => err.statusCode === 401
    );
  });

  it("rejects the wrong ingest key", () => {
    process.env.HR_APPLICANTS_INGEST_KEY = INGEST_KEY;
    assert.throws(
      () =>
        authorizeIngest({
          headers: { "X-HR-Ingest-Key": "nope" },
        }),
      (err) => err.statusCode === 401
    );
    assert.throws(
      () =>
        authorizeIngest({
          headers: { authorization: "Bearer nope" },
        }),
      (err) => err.statusCode === 401
    );
  });

  it("accepts X-HR-Ingest-Key or Authorization: Bearer when the env key is set", () => {
    process.env.HR_APPLICANTS_INGEST_KEY = INGEST_KEY;
    assert.equal(
      authorizeIngest({ headers: { "X-HR-Ingest-Key": INGEST_KEY } }).method,
      "ingest-key"
    );
    assert.equal(
      authorizeIngest({ headers: { authorization: `Bearer ${INGEST_KEY}` } }).method,
      "ingest-key"
    );
  });

  it("accepts an HR session cookie without an ingest key", () => {
    const token = signSession({ sub: "hr-1", method: "supabase", role: "hr" }, SECRET);
    const auth = authorizeIngest({
      headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
    });
    assert.equal(auth.method, "session");
    assert.equal(auth.session.sub, "hr-1");
  });
});

describe("applicants ingest function", () => {
  let env;

  beforeEach(() => {
    env = { ...process.env };
    process.env.HR_GATE_SECRET = SECRET;
    delete process.env.HR_APPLICANTS_INGEST_KEY;
  });

  afterEach(() => {
    process.env = env;
  });

  it("returns 401 without a session or ingest key", async () => {
    const handler = createHandler(memoryStore());
    const res = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ applicants: [{ name: "Ada" }] }),
    });
    assert.equal(res.statusCode, 401);
    assert.match(JSON.parse(res.body).error, /auth/i);
  });

  it("returns 401 for the wrong ingest key", async () => {
    process.env.HR_APPLICANTS_INGEST_KEY = INGEST_KEY;
    const handler = createHandler(memoryStore());
    const res = await handler({
      httpMethod: "POST",
      headers: { "x-hr-ingest-key": "wrong-key" },
      body: JSON.stringify({ applicants: [{ name: "Ada" }] }),
    });
    assert.equal(res.statusCode, 401);
  });

  it("creates applicants when the ingest key is presented", async () => {
    process.env.HR_APPLICANTS_INGEST_KEY = INGEST_KEY;
    const store = memoryStore();
    const handler = createHandler({ ...store, today: () => "2026-09-14" });
    const res = await handler({
      httpMethod: "POST",
      headers: { "X-HR-Ingest-Key": INGEST_KEY },
      body: JSON.stringify({
        applicants: [
          {
            name: "Santos, Maria",
            resumeLink: "https://drive.example/maria",
            notes: "Emailed CV",
          },
        ],
      }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.created[0].name, "Santos, Maria");
    const saved = store.docs.get(`applicants/${body.created[0].id}`).data;
    assert.equal(saved.stage, "Applied");
    assert.equal(saved.source, "Email");
    assert.equal(saved.appliedOn, "2026-09-14");
    assert.equal(saved.resumeLink, "https://drive.example/maria");
  });

  it("creates applicants when an HR session cookie is present", async () => {
    const store = memoryStore();
    const handler = createHandler({ ...store, today: () => "2026-09-14" });
    const token = signSession({ sub: "hr-1", method: "password" }, SECRET);
    const res = await handler({
      httpMethod: "POST",
      headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
      body: JSON.stringify({ applicants: [{ name: "Reyes, Ana" }] }),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).created[0].name, "Reyes, Ana");
  });

  it("does not persist when auth fails", async () => {
    process.env.HR_APPLICANTS_INGEST_KEY = INGEST_KEY;
    const store = memoryStore();
    const handler = createHandler(store);
    await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ applicants: [{ name: "Should Not Save" }] }),
    });
    assert.equal(store.docs.size, 0);
  });
});

describe("applicants ingest docs and secrets", () => {
  it("documents the extractor contract without committing a real key", () => {
    const doc = fs.readFileSync(
      path.join(__dirname, "../docs/applicants-ingest.md"),
      "utf8"
    );
    assert.match(doc, /applicants-ingest/);
    assert.match(doc, /X-HR-Ingest-Key/);
    assert.match(doc, /HR_APPLICANTS_INGEST_KEY/);
    assert.match(doc, /ro01/);
    assert.match(doc, /ro10/);
    assert.match(doc, /Operations Manager/);
    assert.match(doc, /Driver \/ Equipment Operator/);
    assert.match(doc, /forceNew/);
    assert.match(doc, /updateOnly/);
    assert.match(doc, /Overwrite from extractor/);
    assert.match(doc, /builder-latest-applicants-export/);
    assert.match(doc, /1G1TJ5rmI_rGEQcXjKLfYfy2dx9gtZRgC/);
    assert.match(doc, /1sfAgcO2aXeGsAsn1CsIDg7_36bVp_3AI/);
    assert.match(doc, /1Mpguswqx_anA5sxmJ1VvyzI0kCy3805L/);
    assert.match(doc, /Consolidate duplicates/);
    assert.match(doc, /soft-dedupe|Soft-dedupe/);
    assert.doesNotMatch(doc, /sk-|service_role|eyJhbGci/);
    const envExample = fs.readFileSync(path.join(__dirname, "../.env.example"), "utf8");
    assert.match(envExample, /HR_APPLICANTS_INGEST_KEY=/);
    assert.doesNotMatch(envExample, /HR_APPLICANTS_INGEST_KEY=\S+/);
  });
});
