"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyGroup,
  emailKey,
  findIngestMatch,
  furthestStage,
  groupApplicants,
  mergeApplicantRecords,
  nameKey,
  seedApplicantDocs,
} = require("../public/hr-applicant-dedupe");

describe("applicant name keys", () => {
  it("collapses Last, First and First Last, case, punctuation, and initials", () => {
    assert.equal(nameKey("Barrios, Luisa G."), nameKey("Luisa Barrios"));
    assert.equal(nameKey("Sibonga, Tristan"), nameKey("Tristan Sibonga"));
    assert.equal(nameKey("Prince Joseph F. Cañete"), nameKey("Cañete, Prince Joseph F."));
    assert.equal(nameKey("Dela Cerna, Yvette Lea Mae D."), nameKey("Yvette Lea Mae Dela Cerna"));
    assert.equal(nameKey("Canete, Prince Joseph"), nameKey("Cañete, Prince Joseph F."));
  });

  it("does not treat similar-but-different people as the same key", () => {
    assert.notEqual(nameKey("Alquizalas, John Mark"), nameKey("Alquizalas, John Louie"));
    assert.notEqual(nameKey("Barrios, Luisa G."), nameKey("Barrios, Luis"));
  });

  it("normalizes email case and rejects junk", () => {
    assert.equal(emailKey("Prince@Example.com"), "prince@example.com");
    assert.equal(emailKey("not-an-email"), "");
    assert.equal(emailKey(""), "");
  });
});

describe("applicant duplicate groups", () => {
  it("groups exact normalized-name copies and marks same/blank role as auto-safe", () => {
    const groups = groupApplicants([
      { id: "a1", name: "Tristan Sibonga", roleId: "ro02", stage: "Applied", appliedOn: "2026-08-10" },
      { id: "a2", name: "Sibonga, Tristan", roleId: "ro02", stage: "Applied", appliedOn: "2026-08-10" },
      { id: "a3", name: "Barrios, Luisa G.", roleId: "", stage: "Applied", appliedOn: "2026-05-15" },
      { id: "a4", name: "Barrios, Luisa G.", roleId: "ro06", stage: "Applied", appliedOn: "2026-05-15" },
      { id: "a5", name: "Unrelated Person", roleId: "ro01", stage: "Applied", appliedOn: "2026-01-01" },
    ]);
    assert.equal(groups.length, 2);
    const tristan = groups.find((g) => /sibonga/i.test(g.name));
    const luisa = groups.find((g) => /barrios/i.test(g.name));
    assert.equal(tristan.autoSafe, true);
    assert.equal(tristan.reason, "same-name-same-role");
    assert.equal(tristan.applicants.length, 2);
    assert.equal(luisa.autoSafe, true);
    assert.equal(luisa.reason, "same-name-blank-role");
  });

  it("requires confirm when the same name has two different roles or emails", () => {
    const roles = classifyGroup([
      { name: "Dela Cerna, Yvette Lea Mae D.", roleId: "ro02", email: "" },
      { name: "Yvette Lea Mae Dela Cerna", roleId: "ro06", email: "" },
    ]);
    assert.equal(roles.autoSafe, false);
    assert.equal(roles.reason, "conflicting-roles");

    const emails = classifyGroup([
      { name: "Santos, Maria", roleId: "ro01", email: "a@x.com" },
      { name: "Maria Santos", roleId: "ro01", email: "b@x.com" },
    ]);
    assert.equal(emails.autoSafe, false);
    assert.equal(emails.reason, "conflicting-emails");
  });

  it("links same-email rows with unlike names as a confirm group", () => {
    const groups = groupApplicants([
      { id: "a1", name: "Juan Dela Cruz", email: "shared@x.com", roleId: "ro01" },
      { id: "a2", name: "Johnny Cruz", email: "shared@x.com", roleId: "ro01" },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].autoSafe, false);
    assert.equal(groups[0].reason, "same-email-different-names");
  });
});

describe("applicant merge", () => {
  it("keeps earliest appliedOn, furthest stage, and non-empty contact fields", () => {
    const result = mergeApplicantRecords(
      [
        {
          id: "old",
          name: "Barrios, Luisa G.",
          appliedOn: "2026-05-15",
          stage: "Applied",
          email: "",
          mobile: "0917 000 0000",
          resumeLink: "",
          roleId: "",
          notes: "Walk-in May",
          exams: [],
          interviews: [],
          history: [],
        },
        {
          id: "new",
          name: "Barrios, Luisa G.",
          appliedOn: "2026-08-10",
          stage: "Interview",
          email: "luisa@example.com",
          mobile: "",
          resumeLink: "https://drive.example/luisa",
          roleId: "ro06",
          notes: "Emailed CV",
          exams: [{ examId: "x1", score: 40 }],
          interviews: [],
          history: [],
        },
      ],
      { today: "2026-09-15" }
    );
    assert.equal(result.keeper.id, "new");
    assert.equal(result.keeper.appliedOn, "2026-05-15");
    assert.deepEqual(result.keeper.appliedDates, ["2026-05-15", "2026-08-10"]);
    assert.equal(result.keeper.stage, "Interview");
    assert.equal(result.keeper.email, "luisa@example.com");
    assert.equal(result.keeper.mobile, "0917 000 0000");
    assert.equal(result.keeper.resumeLink, "https://drive.example/luisa");
    assert.equal(result.keeper.roleId, "ro06");
    assert.match(result.keeper.notes, /Walk-in May/);
    assert.match(result.keeper.notes, /Emailed CV/);
    assert.match(result.keeper.notes, /2026-05-15/);
    assert.equal(result.keeper.exams.length, 1);
    assert.equal(result.extras[0].id, "old");
  });

  it("ranks Hired above Interview and Rejected above Applied", () => {
    assert.equal(furthestStage(["Applied", "Interview", "Hired"]), "Hired");
    assert.equal(furthestStage(["Rejected", "Applied"]), "Rejected");
  });
});

describe("ingest match", () => {
  const existing = [
    { id: "a1", name: "Sibonga, Tristan", email: "", stage: "Applied", appliedOn: "2026-08-10" },
    { id: "a2", name: "Someone Else", email: "else@x.com", stage: "Applied", appliedOn: "2026-01-01" },
  ];

  it("finds a name match and skips when forceNew is set", () => {
    const hit = findIngestMatch({ name: "Tristan Sibonga" }, existing);
    assert.equal(hit.id, "a1");
    assert.equal(findIngestMatch({ name: "Tristan Sibonga" }, existing, { forceNew: true }), null);
  });
});

describe("application-file seeding", () => {
  it("promotes resumeLink onto the Recruitment resume row", () => {
    const docs = seedApplicantDocs({
      resumeLink: "https://drive.example/cv",
      appliedOn: "2026-05-15",
      exams: [{ examId: "iq", takenOn: "2026-06-01" }],
      interviews: [{ date: "2026-06-02" }],
    });
    assert.equal(docs.resume.link, "https://drive.example/cv");
    assert.equal(docs.resume.s, "on");
    assert.equal(docs.iqtest.s, "on");
    assert.equal(docs.initint.s, "on");
  });
});
