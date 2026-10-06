"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { mergeStoredOtRequest, otFileList } = require("../netlify/lib/ot-merge");

const FORM_A = "https://drive.google.com/file/d/DANAO1/view";
const FORM_B = "https://drive.google.com/file/d/DANAO2/view?usp=sharing";

describe("stored OT request merge", () => {
  it("keeps a stored form when a blank shell is saved over it", () => {
    const stored = {
      id: "ot1",
      from: "2026-10-05",
      to: "2026-10-05",
      site: "Danao SPLPA",
      wholeSite: true,
      status: "Approved",
      reason: "- Hauling, - Backfilling",
      formUrl: FORM_A,
      formTitle: "DANAO OT REQUEST 10.05.2026.jpg",
      empIds: ["e1"],
      hoursEach: 3,
    };
    const next = mergeStoredOtRequest(stored, {
      id: "ot1",
      from: "",
      status: "",
      formUrl: "",
      files: [],
      _otShared: true,
    });
    assert.equal(next.formUrl, FORM_A);
    assert.equal(next.formTitle, "DANAO OT REQUEST 10.05.2026.jpg");
    assert.equal(next.status, "Approved");
    assert.equal(next.from, "2026-10-05");
    assert.equal(next.site, "Danao SPLPA");
    assert.equal(next.reason, "- Hauling, - Backfilling");
    assert.equal(next.hoursEach, 3);
    assert.deepEqual(next.empIds, ["e1"]);
    assert.equal(next._otShared, undefined);
    assert.equal(otFileList(next).length, 1);
  });

  it("unions a second file and does not drop the one already stored", () => {
    const stored = {
      from: "2026-10-05",
      status: "Approved",
      formUrl: FORM_A,
      formTitle: "DANAO OT REQUEST 10.05.2026.jpg",
      files: [{ url: FORM_A, title: "DANAO OT REQUEST 10.05.2026.jpg" }],
    };
    const next = mergeStoredOtRequest(stored, {
      from: "2026-10-05",
      status: "Approved",
      reason: "",
      formUrl: FORM_B,
      formTitle: "second page.jpg",
      files: [{ url: FORM_B, title: "second page.jpg" }],
    });
    const urls = otFileList(next).map((f) => f.url);
    assert.deepEqual(urls, [FORM_A, "https://drive.google.com/file/d/DANAO2/view"]);
    assert.equal(next.reason, "");
    assert.equal(next.formUrl, "https://drive.google.com/file/d/DANAO2/view");
  });

  it("does not drop an already-normalized link when it is also the form url", () => {
    const data = "data:image/jpeg;base64," + "A".repeat(20);
    const next = mergeStoredOtRequest(
      { from: "2026-10-05", status: "Filed", formUrl: data, formTitle: "scan.jpg", files: [{ url: data, title: "scan.jpg" }] },
      { from: "2026-10-05", status: "Filed", formUrl: data, formTitle: "scan.jpg" }
    );
    assert.equal(otFileList(next).length, 1);
    assert.equal(next.formUrl, data);
  });

  it("the db set path merges otreqs and the allowlist names the collection", () => {
    const db = fs.readFileSync(path.join(__dirname, "../netlify/functions/db.js"), "utf8");
    const sql = fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/20261007000001_hr_otreqs_payruns.sql"),
      "utf8"
    );
    assert.match(db, /mergeStoredOtRequest/);
    assert.match(db, /collection === "otreqs"/);
    assert.match(sql, /'otreqs'/);
    assert.match(sql, /'payruns'/);
    assert.match(sql, /on conflict \(name\) do nothing/i);
    assert.doesNotMatch(sql, /delete from/i);
  });
});
