"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");

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

function loadRecruit(windowLike) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-applicant-dedupe.js"), "utf8"), windowLike);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-applicants-export.js"), "utf8"), windowLike);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-recruit.js"), "utf8"), windowLike);
  return windowLike.hrRecruit;
}

function fakeWindow(applicants) {
  const byId = {};
  const document = {
    getElementById(id) {
      return byId[id] || null;
    },
    createElement() {
      const el = {
        id: "",
        value: "",
        textContent: "",
        attrs: {},
        getAttribute(name) {
          if (name === "id") return this.id;
          return this.attrs[name] == null ? null : this.attrs[name];
        },
        setAttribute(name, value) {
          this.attrs[name] = String(value);
          if (name === "id") {
            this.id = String(value);
            byId[this.id] = this;
          }
        },
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      };
      return el;
    },
    addEventListener() {},
    readyState: "complete",
  };
  const window = {
    document,
    fetch() {
      return Promise.reject(new Error("no fetch in this test"));
    },
    S: {
      applicants: applicants || {},
      roles: {
        ro06: { id: "ro06", title: "Procurement Officer", dept: "Procurement" },
        ro02: { id: "ro02", title: "Project Manager", dept: "Technical" },
      },
      employees: {},
      ui: { pipelineRoleFilter: "ro02", pipelineSearch: "hide-new", pipelineFocus: "" },
    },
    TODAY: "2026-10-27",
    async put(coll, id, obj) {
      if (coll === "applicants") window.S.applicants[id] = obj;
    },
    async drop() {},
  };
  window.window = window;
  return window;
}

function box(w, id, value) {
  const el = w.document.createElement("input");
  el.setAttribute("id", id);
  el.value = value;
  return el;
}

describe("Cassie concerns 2026-10-27a", () => {
  it("is build 2026-10-27a and keeps the interview on the applicant record", () => {
    assert.match(html, /const BUILD = "2026-10-27a"/);
    assert.match(html, /data-rmode="initial">Initial interviews/);
    assert.match(html, /HR adds the applicant on that screen/);
    assert.match(readme, /build 2026-10-27a/);
    assert.match(readme, /build 2026-10-26a/);
    assert.match(readme, /No new database collection/);
    assert.match(readme, /same email, the same mobile, or the same name and position/i);
    const recruit = fs.readFileSync(path.join(__dirname, "../public/hr-recruit.js"), "utf8");
    assert.match(recruit, /id="hr-iv-new-name"/);
    assert.match(recruit, /id="hr-iv-new-pos"/);
    assert.match(recruit, /id="hr-iv-new-email"/);
    assert.match(recruit, /id="hr-iv-new-mob"/);
    assert.match(recruit, /Position applied for/);
    assert.match(recruit, /Add someone who is not on the pipeline/);
    assert.match(recruit, /id="hr-iv-app"/);
    assert.match(recruit, /Add an applicant and schedule the initial interview/);
    const migration = fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/20260907000002_hr_artifact_docs.sql"),
      "utf8"
    );
    assert.match(migration, /\('applicants'\)/);
  });

  it("adds an applicant from Initial interviews onto the pipeline at Interview without a duplicate", async () => {
    const stages = html.match(/const STAGES=\[[^\]]+\];/);
    const pipeline = {};
    vm.runInNewContext(
      stages[0] +
        "\n" +
        ["canonicalApplicantStage", "stageLabel", "countApplicantsAtStage", "pipelineStageGroups"]
          .map((name) => extractFunction(html, name))
          .join("\n"),
      pipeline
    );
    const w = fakeWindow({
      a_email: {
        id: "a_email",
        name: "Lagamon, Cyrence",
        email: "cyrence@example.com",
        mobile: "",
        position: "Helper",
        stage: "Applied",
        interviews: [],
      },
      a_helper: {
        id: "a_helper",
        name: "Reyes, Ana",
        email: "",
        mobile: "09171234567",
        position: "Helper",
        stage: "Screening",
        interviews: [],
      },
      a_pm: {
        id: "a_pm",
        name: "Reyes, Ana",
        email: "ana.pm@example.com",
        mobile: "09998887777",
        position: "Project Manager",
        roleId: "ro02",
        stage: "Applied",
        interviews: [],
      },
    });
    const hr = loadRecruit(w);
    const before = Object.keys(w.S.applicants).length;

    const created = await hr.commitManualInterview(
      {
        name: "Dela Cruz, Juan",
        position: "Procurement Officer",
        mobile: "0918 000 1111",
        email: "juan@example.com",
        source: "Walk-in",
      },
      { at: "2026-10-27T09:30", interviewer: "Cassie", notes: "Bring the CV", status: "Scheduled" }
    );
    assert.equal(created.ok, true);
    assert.equal(created.created, true);
    assert.equal(created.applicant.stage, "Interview");
    assert.equal(created.applicant.position, "Procurement Officer");
    assert.equal(created.applicant.roleId, "ro06");
    assert.equal(created.applicant.dept, "Procurement");
    assert.equal(created.applicant.email, "juan@example.com");
    assert.equal(created.applicant.mobile, "0918 000 1111");
    assert.equal(created.applicant.source, "Walk-in");
    assert.equal(created.applicant.appliedOn, "2026-10-27");
    assert.equal(created.applicant.initialInterview.at, "2026-10-27T09:30");
    assert.equal(created.applicant.initialInterview.status, "Scheduled");
    assert.equal(created.applicant.initialInterview.interviewer, "Cassie");
    assert.equal(w.S.applicants[created.applicant.id], created.applicant);
    assert.equal(w.S.ui.pipelineFocus, created.applicant.id);
    assert.equal(w.S.ui.pipelineRoleFilter, "");
    assert.equal(w.S.ui.pipelineSearch, "");
    assert.equal(hr.roleFilter, "");
    assert.equal(hr.pipelineSearch, "");

    const interviewRows = pipeline.pipelineStageGroups(Object.values(w.S.applicants)).find((g) => g.stage === "Interview");
    assert.ok(interviewRows);
    assert.ok(interviewRows.rows.some((a) => a.id === created.applicant.id && a.position === "Procurement Officer"));
    assert.equal(pipeline.countApplicantsAtStage(Object.values(w.S.applicants), "Interview"), 1);
    assert.equal(pipeline.stageLabel("Interview"), "Interview");
    assert.match(hr.initialInterviewsHtml(), /Dela Cruz, Juan/);
    assert.match(hr.initialInterviewsHtml(), /Procurement Officer/);

    const byEmail = await hr.commitManualInterview(
      { name: "Cyrence Lagamon", email: "CYRENCE@example.com", position: "Driver", mobile: "09170000000" },
      { at: "2026-10-28T10:00", status: "Scheduled" }
    );
    assert.equal(byEmail.ok, true);
    assert.equal(byEmail.created, false);
    assert.equal(byEmail.matchedBy, "email");
    assert.equal(byEmail.applicant.id, "a_email");
    assert.equal(byEmail.applicant.name, "Lagamon, Cyrence");
    assert.equal(byEmail.applicant.position, "Helper");
    assert.equal(byEmail.applicant.mobile, "09170000000");
    assert.equal(byEmail.applicant.stage, "Interview");
    assert.equal(byEmail.applicant.initialInterview.at, "2026-10-28T10:00");
    assert.equal(Object.values(w.S.applicants).filter((a) => /lagamon|cyrence/i.test(a.name)).length, 1);

    const byPhone = await hr.commitManualInterview(
      { name: "Ana R.", mobile: "+63 917 123 4567", position: "Helper" },
      { at: "2026-10-28T11:00", status: "Rescheduled" }
    );
    assert.equal(byPhone.created, false);
    assert.equal(byPhone.matchedBy, "phone");
    assert.equal(byPhone.applicant.id, "a_helper");
    assert.equal(byPhone.applicant.stage, "Interview");
    assert.equal(byPhone.applicant.name, "Reyes, Ana");

    const byPos = await hr.commitManualInterview(
      { name: "Ana Reyes", position: "Project Manager" },
      { at: "2026-10-28T13:00", status: "Scheduled" }
    );
    assert.equal(byPos.created, false);
    assert.equal(byPos.matchedBy, "name-position");
    assert.equal(byPos.applicant.id, "a_pm");
    assert.equal(byPos.applicant.stage, "Interview");
    assert.equal(byPos.applicant.email, "ana.pm@example.com");
    assert.equal(byPos.applicant.position, "Project Manager");

    const other = await hr.commitManualInterview(
      { name: "Ana Reyes", email: "other.ana@example.com", position: "Helper", mobile: "09181112222" },
      { at: "2026-10-28T14:00", status: "Scheduled" }
    );
    assert.equal(other.created, true);
    assert.equal(other.applicant.stage, "Interview");
    assert.equal(other.applicant.position, "Helper");
    assert.equal(other.applicant.email, "other.ana@example.com");
    assert.notEqual(other.applicant.id, "a_helper");
    assert.notEqual(other.applicant.id, "a_pm");

    const several = await hr.commitManualInterview({ name: "Ana Reyes" }, { at: "2026-10-28T15:00", status: "Scheduled" });
    assert.equal(several.ok, false);
    assert.equal(several.error, "several");

    const welder = await hr.commitManualInterview(
      { name: "Ana Reyes", position: "Welder" },
      { at: "2026-10-28T15:30", status: "Scheduled" }
    );
    assert.equal(welder.created, true);
    assert.equal(welder.applicant.position, "Welder");
    assert.equal(welder.applicant.stage, "Interview");
    assert.equal(welder.applicant.roleId, "");

    const count = Object.keys(w.S.applicants).length;
    const noPos = await hr.commitManualInterview(
      { name: "Brand New Person", email: "brand@example.com" },
      { at: "2026-10-28T16:00", status: "Scheduled" }
    );
    assert.equal(noPos.ok, false);
    assert.equal(noPos.error, "position");
    assert.equal(Object.keys(w.S.applicants).length, count);
    assert.ok(Object.keys(w.S.applicants).length > before);

    const picked = hr.resolveInterviewTarget("a_pm", "", "");
    assert.equal(picked.create, false);
    assert.equal(picked.id, "a_pm");
    const again = await hr.commitInitialInterview("a_pm", { at: "2026-10-29T09:00", interviewer: "Cassie", status: "Scheduled" });
    assert.equal(again.ok, true);
    assert.equal(w.S.applicants.a_pm.stage, "Interview");
    assert.equal(w.S.applicants.a_pm.initialInterview.at, "2026-10-29T09:00");
    assert.equal(Object.keys(w.S.applicants).length, count);

    const typedOverSelection = hr.resolveInterviewTarget("a_pm", "Totally New Applicant", "", {
      position: "Helper",
      email: "totally@example.com",
    });
    assert.equal(typedOverSelection.create, true);
    assert.equal(typedOverSelection.name, "Totally New Applicant");

    box(w, "hr-iv-new-name", "Santos, Pedro");
    box(w, "hr-iv-new-pos", "");
    box(w, "hr-iv-new-role", "ro06");
    box(w, "hr-iv-new-mob", "09190001111");
    box(w, "hr-iv-new-email", "pedro@example.com");
    box(w, "hr-iv-new-src", "Referral");
    box(w, "hr-iv-app", "a_pm");
    box(w, "hr-iv-find", "");
    box(w, "hr-iv-at", "2026-10-29T08:15");
    box(w, "hr-iv-by", "Cassie");
    box(w, "hr-iv-notes", "Walk-in");
    box(w, "hr-iv-status", "Scheduled");
    w.S.ui.pipelineRoleFilter = "ro02";
    w.S.ui.pipelineSearch = "nope";
    w.rendered = 0;
    w.render = function () {
      w.rendered += 1;
    };
    await hr.savePageSchedule();
    const pedro = Object.values(w.S.applicants).find((a) => a.email === "pedro@example.com");
    assert.ok(pedro);
    assert.equal(pedro.name, "Santos, Pedro");
    assert.equal(pedro.position, "Procurement Officer");
    assert.equal(pedro.roleId, "ro06");
    assert.equal(pedro.dept, "Procurement");
    assert.equal(pedro.source, "Referral");
    assert.equal(pedro.stage, "Interview");
    assert.equal(pedro.initialInterview.at, "2026-10-29T08:15");
    assert.notEqual(pedro.id, "a_pm");
    assert.equal(w.S.ui.pipelineFocus, pedro.id);
    assert.equal(w.S.ui.pipelineRoleFilter, "");
    assert.equal(w.S.ui.pipelineSearch, "");
    assert.equal(w.rendered, 1);
    assert.equal(
      pipeline.pipelineStageGroups(Object.values(w.S.applicants)).find((g) => g.stage === "Interview").rows.some((a) => a.id === pedro.id),
      true
    );

    w.document.getElementById("hr-iv-new-name").value = "";
    w.document.getElementById("hr-iv-new-email").value = "pedro@example.com";
    w.document.getElementById("hr-iv-app").value = "a_email";
    w.document.getElementById("hr-iv-at").value = "2026-10-30T15:45";
    const ids = Object.keys(w.S.applicants).length;
    await hr.savePageSchedule();
    assert.equal(Object.keys(w.S.applicants).length, ids);
    assert.equal(w.S.applicants.a_email.initialInterview.at, "2026-10-30T15:45");
    assert.equal(w.S.applicants.a_email.stage, "Interview");
    assert.equal(w.S.ui.pipelineFocus, "a_email");
  });
});
