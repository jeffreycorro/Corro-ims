"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseApplicantsExport,
  looksLikeCsv,
  looksLikeExtractor,
  DRIVE_FOLDER_ID,
  DRIVE_FOLDER_URL,
  EXPORT_JSON,
  EXPORT_JSON_ID,
  EXPORT_CSV_ID,
  EXPORT_JSON_URL,
  EXPORT_CSV_URL,
} = require("../public/hr-applicants-export");

describe("hr-applicants-export", () => {
  it("detects extractor JSON and forces updateOnly", () => {
    const data = {
      asOf: "2026-09-18T13:05+08:00",
      driveFolderId: DRIVE_FOLDER_ID,
      driveFolderUrl: DRIVE_FOLDER_URL,
      counts: { totalApplicants: 2, withResumeLink: 2, backfillPatched: 1, shortlist: 1 },
      notes: ["Overwrite-by-id only — do not create new rows."],
      applicants: [
        { id: "a_one", name: "One", resumeLink: "https://drive.example/1" },
        { id: "a_two", name: "Two", resumeLink: "https://drive.example/2" },
      ],
    };
    assert.equal(looksLikeExtractor(data), true);
    const parsed = parseApplicantsExport(JSON.stringify(data));
    assert.equal(parsed.updateOnly, true);
    assert.equal(parsed.overwrite, true);
    assert.equal(parsed.extractor, true);
    assert.equal(parsed.applicants.length, 2);
    assert.equal(parsed.driveFolderId, DRIVE_FOLDER_ID);
    assert.match(EXPORT_JSON, /builder-latest-applicants-export\.json/);
    assert.equal(EXPORT_JSON_ID, "1sfAgcO2aXeGsAsn1CsIDg7_36bVp_3AI");
    assert.equal(EXPORT_CSV_ID, "1Mpguswqx_anA5sxmJ1VvyzI0kCy3805L");
    assert.match(EXPORT_JSON_URL, /1sfAgcO2aXeGsAsn1CsIDg7_36bVp_3AI/);
    assert.match(EXPORT_CSV_URL, /1Mpguswqx_anA5sxmJ1VvyzI0kCy3805L/);
  });

  it("parses quoted CSV names and resume links", () => {
    const csv =
      "id,name,resumeLink,patchedInBackfill,isShortlist\n" +
      'a_keep,"Dela Cruz, Juan",https://drive.google.com/file/d/FILE/view,True,False\n';
    assert.equal(looksLikeCsv(csv), true);
    const parsed = parseApplicantsExport(csv);
    assert.equal(parsed.updateOnly, true);
    assert.equal(parsed.fromCsv, true);
    assert.equal(parsed.applicants[0].id, "a_keep");
    assert.equal(parsed.applicants[0].name, "Dela Cruz, Juan");
    assert.equal(parsed.applicants[0].resumeLink, "https://drive.google.com/file/d/FILE/view");
    assert.equal(parsed.applicants[0].patchedInBackfill, undefined);
  });

  it("does not treat a name-only JSON array as updateOnly", () => {
    const parsed = parseApplicantsExport('[{"name":"Walk-in"}]');
    assert.equal(parsed.updateOnly, false);
    assert.equal(parsed.overwrite, false);
    assert.equal(parsed.applicants[0].name, "Walk-in");
  });
});
