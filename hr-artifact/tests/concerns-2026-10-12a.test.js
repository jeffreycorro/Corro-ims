"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const recruitSrc = fs.readFileSync(path.join(__dirname, "../public/hr-recruit.js"), "utf8");
const emailSrc = fs.readFileSync(path.join(__dirname, "../public/hr-email-applicants.js"), "utf8");

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

function loadHelpers() {
  const stages = html.match(/const STAGES=\[[^\]]+\];/);
  if (!stages) throw new Error("STAGES missing");
  const names = [
    "canonicalApplicantStage",
    "stageLabel",
    "countApplicantsAtStage",
    "pipelineStageGroups",
    "applicantPayload",
    "keepPendingApplicants",
  ];
  const ctx = {};
  vm.runInNewContext(stages[0] + "\n" + names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

describe("2026-10-12a recruitment pipeline", () => {
  it("is build 2026-10-12a and lists Background Check with the other stages", () => {
    assert.match(html, /const BUILD = "2026-10-29b"/);
    assert.match(
      html,
      /const STAGES=\["Applied","Screening","Shortlisted","On Hold","Written Exam","Interview","Background Check","Final Interview","Offer","Hired","Rejected"\]/
    );
    assert.match(html, /id="hr-stage-counts"/);
    assert.match(html, /For Final Interview/);
    assert.match(html, /hr-pipeline-focus-row/);
    assert.match(html, /pipelineRoleFilter=""/);
    assert.match(html, /S\.ui\.pipelineFocus=a\.id/);
  });

  it("counts For Final Interview, Background Check, and Hired from the stage on each applicant", () => {
    const ctx = loadHelpers();
    const list = [
      { id: "a1", name: "New", stage: "Applied", appliedOn: "2026-10-12" },
      { id: "a2", name: "Alias", stage: "For Final Interview" },
      { id: "a3", name: "Final", stage: "Final Interview" },
      { id: "a4", name: "Check", stage: "Background Check" },
      { id: "a5", name: "Hired one", stage: "Hired" },
      { id: "a6", name: "Blank", stage: "" },
      { id: "a7", name: "Site", stage: "Site Visit" },
    ];
    assert.equal(ctx.stageLabel("Final Interview"), "For Final Interview");
    assert.equal(ctx.stageLabel("For Final Interview"), "For Final Interview");
    assert.equal(ctx.stageLabel("Background Check"), "Background Check");
    assert.equal(ctx.canonicalApplicantStage(""), "Applied");
    assert.equal(ctx.canonicalApplicantStage("For Final Interview"), "Final Interview");
    assert.equal(ctx.countApplicantsAtStage(list, "Final Interview"), 2);
    assert.equal(ctx.countApplicantsAtStage(list, "Background Check"), 1);
    assert.equal(ctx.countApplicantsAtStage(list, "Hired"), 1);
    assert.equal(ctx.countApplicantsAtStage(list, "Applied"), 2);
    const groups = ctx.pipelineStageGroups(list);
    const byStage = Object.fromEntries(
      Array.from(groups).map((g) => [g.stage, Array.from(g.rows).map((a) => a.id)])
    );
    assert.deepEqual(byStage.Applied, ["a1", "a6"]);
    assert.deepEqual(byStage["Final Interview"], ["a2", "a3"]);
    assert.deepEqual(byStage["Background Check"], ["a4"]);
    assert.deepEqual(byStage.Hired, ["a5"]);
    assert.deepEqual(byStage["Site Visit"], ["a7"]);
    assert.equal(groups[groups.length - 1].stage, "Site Visit");
  });

  it("keeps a pending applicant the shared list has not echoed", () => {
    const ctx = loadHelpers();
    const local = {
      "a-new": { id: "a-new", name: "Domingo Monte Jr.", stage: "Applied", _pendingSave: true },
      "a-old": { id: "a-old", name: "Kept", stage: "Interview", _pendingSave: true },
    };
    const next = {
      "a-old": { id: "a-old", name: "Kept", stage: "Interview" },
    };
    const kept = ctx.keepPendingApplicants(next, local);
    assert.equal(kept.map["a-new"].name, "Domingo Monte Jr.");
    assert.equal(kept.map["a-new"]._pendingSave, true);
    assert.deepEqual(Array.from(kept.retry), ["a-new"]);
    assert.equal(kept.map["a-old"]._pendingSave, undefined);
    const echoed = ctx.keepPendingApplicants(
      {
        "a-new": { id: "a-new", name: "Domingo Monte Jr.", stage: "Applied" },
        "a-old": { id: "a-old", name: "Kept", stage: "Interview" },
      },
      local
    );
    assert.equal(echoed.map["a-new"]._pendingSave, undefined);
    assert.deepEqual(Array.from(echoed.retry), []);
    const payload = ctx.applicantPayload(local["a-new"]);
    assert.equal(payload._pendingSave, undefined);
    assert.equal(local["a-new"]._pendingSave, true);
    assert.equal(payload.name, "Domingo Monte Jr.");
  });

  it("a mailbox refresh does not drop a save the shared list omitted", async () => {
    assert.match(recruitSrc, /_pendingSave/);
    assert.match(emailSrc, /_pendingSave/);
    const pending = { id: "a-new", name: "Domingo Monte Jr.", stage: "Final Interview", _pendingSave: true };
    const windowLike = {
      S: { applicants: { "a-new": pending } },
      document: { readyState: "complete", getElementById() { return null; }, addEventListener() {} },
    };
    windowLike.window = windowLike;
    windowLike.S.db = {
      collection() {
        return {
          async get() {
            return { docs: [{ id: "a-old", data() { return { id: "a-old", name: "Old", stage: "Applied" }; } }] };
          },
        };
      },
    };
    vm.runInNewContext(recruitSrc, windowLike);
    await windowLike.hrRecruit.refreshApplicants();
    assert.equal(windowLike.S.applicants["a-new"].name, "Domingo Monte Jr.");
    assert.equal(windowLike.S.applicants["a-old"].name, "Old");
  });
});
