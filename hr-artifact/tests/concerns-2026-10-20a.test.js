"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  let start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  if (src.slice(start - 6, start) === "async ") start -= 6;
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

describe("initial interviews 2026-10-20a", () => {
  it("is build 2026-10-20a and adds the Initial interviews tab without a new collection", () => {
    assert.match(html, /const BUILD = "2026-10-24a"/);
    assert.match(html, /data-rmode="initial">Initial interviews/);
    assert.match(html, /function viewInitialInterviews\(/);
    assert.match(html, /window\.hrRecruit/);
    assert.match(html, /api\.initialInterviewsHtml/);
    assert.match(html, /if\(mode==="initial"\) return h\+viewInitialInterviews\(\)/);
    assert.match(html, /id="hr-stage-counts"/);
    assert.match(html, /id="new-app"/);
    assert.match(html, /data-open-app/);
    assert.match(
      html,
      /const STAGES=\["Applied","Screening","Shortlisted","On Hold","Written Exam","Interview","Background Check","Final Interview","Offer","Hired","Rejected"\]/
    );
    const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");
    assert.match(readme, /build 2026-10-20a/);
    assert.match(readme, /No new database collection/);
    assert.match(readme, /Initial interviews/);
  });

  it("still counts pipeline stages from the applicant stage after a schedule moves someone to Interview", () => {
    const stages = html.match(/const STAGES=\[[^\]]+\];/);
    const src =
      stages[0] +
      "\n" +
      ["canonicalApplicantStage", "stageLabel", "countApplicantsAtStage", "pipelineStageGroups"]
        .map((name) => extractFunction(html, name))
        .join("\n");
    const ctx = {};
    vm.runInNewContext(src, ctx);
    const list = [
      { id: "a1", name: "Monte, Domingo Jr.", stage: "Applied" },
      { id: "a2", name: "Other", stage: "Interview" },
      { id: "a3", name: "Check", stage: "Background Check" },
      { id: "a4", name: "Final", stage: "For Final Interview" },
    ];
    assert.equal(ctx.countApplicantsAtStage(list, "Applied"), 1);
    assert.equal(ctx.countApplicantsAtStage(list, "Interview"), 1);
    assert.equal(ctx.countApplicantsAtStage(list, "Background Check"), 1);
    assert.equal(ctx.countApplicantsAtStage(list, "Final Interview"), 1);
    list[0].stage = "Interview";
    assert.equal(ctx.countApplicantsAtStage(list, "Applied"), 0);
    assert.equal(ctx.countApplicantsAtStage(list, "Interview"), 2);
    assert.equal(ctx.pipelineStageGroups(list).find((g) => g.stage === "Interview").rows.length, 2);
    assert.equal(ctx.stageLabel("Final Interview"), "For Final Interview");
  });
});
