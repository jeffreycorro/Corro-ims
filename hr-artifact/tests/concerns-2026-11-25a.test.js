"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const recruitSrc = fs.readFileSync(path.join(__dirname, "../public/hr-recruit.js"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
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
  vm.runInNewContext(recruitSrc, windowLike);
  return windowLike.hrRecruit;
}

function fakeWindow(applicants) {
  const window = {
    document: {
      getElementById() {
        return null;
      },
      createElement() {
        return { id: "", value: "", innerHTML: "", setAttribute() {}, getAttribute() { return null; } };
      },
      addEventListener() {},
      readyState: "complete",
    },
    fetch() {
      return Promise.reject(new Error("no fetch in this test"));
    },
    S: {
      applicants: applicants || {},
      roles: { ro06: { id: "ro06", title: "Helper", dept: "Site" } },
      employees: {},
      settings: { hrStaff: "Cassie", hrHead: "Domingo" },
      ui: {},
    },
    TODAY: "2026-11-25",
    async put(coll, id, obj) {
      if (coll === "applicants") window.S.applicants[id] = obj;
    },
    async drop() {},
  };
  window.window = window;
  return window;
}

function legacyInterview() {
  return {
    at: "2026-11-01T09:00",
    interviewer: "Cassie",
    notes: "Bring the CV",
    status: "Scheduled",
    updatedAt: "2026-11-01T01:00:00.000Z",
  };
}

describe("applicant reschedule 2026-11-25a", () => {
  it("is build 2026-11-25a and puts the rescheduled date on the applicant", () => {
    assert.match(html, /const BUILD = "2026-11-28a"/);
    assert.match(html, /function scheduleMark\(row\)/);
    assert.match(html, /function applicantScheduleRows\(a\)/);
    assert.match(html, /noteInterviewDate/);
    assert.match(html, /noteExamDate/);
    assert.match(recruitSrc, /Rescheduled date/);
    assert.match(recruitSrc, /data-hr-rs-open/);
    assert.match(recruitSrc, /data-rescheduled="1"/);
    const ctx = {};
    vm.runInNewContext(
      extractFunction(html, "scheduleMark") + "\n" + extractFunction(html, "applicantScheduleRows") + "\nthis.scheduleMark=scheduleMark; this.applicantScheduleRows=applicantScheduleRows;",
      ctx
    );
    assert.equal(ctx.scheduleMark(null), "");
    assert.equal(ctx.scheduleMark({ reschedules: [] }), "");
    assert.match(ctx.scheduleMark({ reschedules: [{ from: "2026-11-01", to: "2026-11-05" }] }), /data-rescheduled="1"/);
    assert.equal(JSON.stringify(ctx.applicantScheduleRows({})), "[]");
    assert.equal(
      JSON.stringify(ctx.applicantScheduleRows({ initialInterview: legacyInterview() })),
      JSON.stringify([["Initial interview", "2026-11-01T09:00"]])
    );
    const moved = ctx.applicantScheduleRows({
      initialInterview: { at: "2026-11-05T14:30", reschedules: [{ from: "2026-11-01T09:00", to: "2026-11-05T14:30" }] },
      finalInterview: { at: "2026-11-20T09:00" },
    });
    assert.equal(moved[0][0], "Initial interview");
    assert.match(moved[0][1], /2026-11-05T14:30/);
    assert.match(moved[0][1], /Rescheduled/);
    assert.equal(moved[1][1], "2026-11-20T09:00");
  });

  it("keeps reschedule history and shows the effective interview date", async () => {
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Reyes, Ana",
        position: "Helper",
        stage: "Interview",
        interviews: [],
        initialInterview: legacyInterview(),
      },
      a2: {
        id: "a2",
        name: "Cruz, Ben",
        position: "Helper",
        stage: "Interview",
        interviews: [],
        initialInterview: {
          at: "2026-11-03T09:00",
          interviewer: "Cassie",
          notes: "",
          status: "Scheduled",
          updatedAt: "2026-11-02T01:00:00.000Z",
        },
      },
    });
    const beforeInterview = JSON.stringify(w.S.applicants.a2.initialInterview);
    const hr = loadRecruit(w);
    hr.install();
    assert.equal(JSON.stringify(hr.normalizeInitialInterview(legacyInterview())), JSON.stringify(legacyInterview()));
    assert.equal(JSON.stringify(w.S.applicants.a2.initialInterview), beforeInterview);
    assert.equal(w.S.applicants.a2.initialInterview.reschedules, undefined);

    const first = await hr.rescheduleInitialInterview("a1", {
      at: "2026-11-05T14:30",
      reason: "Applicant asked",
      by: "Cassie",
    });
    assert.equal(first.ok, true);
    const iv = w.S.applicants.a1.initialInterview;
    assert.equal(iv.at, "2026-11-05T14:30");
    assert.equal(iv.originalAt, "2026-11-01T09:00");
    assert.equal(iv.status, "Rescheduled");
    assert.equal(iv.interviewer, "Cassie");
    assert.equal(iv.notes, "Bring the CV");
    assert.equal(iv.reschedules.length, 1);
    assert.equal(iv.reschedules[0].from, "2026-11-01T09:00");
    assert.equal(iv.reschedules[0].to, "2026-11-05T14:30");
    assert.equal(iv.reschedules[0].reason, "Applicant asked");
    assert.equal(iv.reschedules[0].by, "Cassie");
    assert.match(iv.reschedules[0].at, /^\d{4}-\d{2}-\d{2}T/);

    const same = await hr.rescheduleInitialInterview("a1", { at: "2026-11-05T14:30", reason: "again", by: "Cassie" });
    assert.equal(same.ok, false);
    assert.equal(same.error, "same");
    assert.equal(w.S.applicants.a1.initialInterview.reschedules.length, 1);

    const missingTime = await hr.rescheduleInitialInterview("a1", { at: "2026-11-06", by: "Cassie" });
    assert.equal(missingTime.ok, false);
    assert.equal(missingTime.error, "when");
    assert.equal(w.S.applicants.a1.initialInterview.at, "2026-11-05T14:30");

    const second = await hr.rescheduleInitialInterview("a1", {
      at: "2026-11-06T10:00",
      reason: "Office closed",
      by: "Maria",
    });
    assert.equal(second.ok, true);
    const again = w.S.applicants.a1.initialInterview;
    assert.equal(again.at, "2026-11-06T10:00");
    assert.equal(again.originalAt, "2026-11-01T09:00");
    assert.equal(again.reschedules.length, 2);
    assert.equal(again.reschedules[0].from, "2026-11-01T09:00");
    assert.equal(again.reschedules[0].to, "2026-11-05T14:30");
    assert.equal(again.reschedules[0].reason, "Applicant asked");
    assert.equal(again.reschedules[1].from, "2026-11-05T14:30");
    assert.equal(again.reschedules[1].to, "2026-11-06T10:00");
    assert.equal(again.reschedules[1].reason, "Office closed");
    assert.equal(again.reschedules[1].by, "Maria");

    const status = await hr.commitInitialStatus("a1", "Done/Passed");
    assert.equal(status.ok, true);
    assert.equal(w.S.applicants.a1.initialInterview.status, "Done/Passed");
    assert.equal(w.S.applicants.a1.initialInterview.at, "2026-11-06T10:00");
    assert.equal(w.S.applicants.a1.initialInterview.reschedules.length, 2);

    hr.setInterviewDay("all");
    const all = hr.initialInterviewsHtml();
    const ana = all.indexOf("Reyes, Ana");
    const ben = all.indexOf("Cruz, Ben");
    assert.ok(ben >= 0 && ana > ben);
    assert.match(all, /6 Nov 2026, 10:00 AM/);
    assert.match(all, /data-rescheduled="1"/);
    assert.match(all, /data-hr-rs-open="a1"/);
    assert.match(all, /was 5 Nov 2026, 2:30 PM/);
    const panel = hr.schedulePanelHtml(w.S.applicants.a1);
    assert.match(panel, /Rescheduled date/);
    assert.match(panel, /Applicant asked/);
    assert.match(panel, /Office closed/);
    assert.match(panel, /id="hr-rs-initial-at"/);
    assert.match(panel, /id="hr-rs-initial-reason"/);
    assert.match(panel, /id="hr-rs-initial-by"/);

    const dayList = (page) => {
      const at = page.indexOf('id="hr-iv-day-list"');
      const rest = page.slice(at);
      const end = rest.indexOf("Schedule an initial interview");
      return rest.slice(0, end);
    };
    hr.setInterviewDay("2026-11-01");
    const oldDay = hr.initialInterviewsHtml();
    assert.match(oldDay, /data-hr-iv-pick="2026-11-06"/);
    assert.doesNotMatch(oldDay, /data-hr-iv-pick="2026-11-01"/);
    assert.doesNotMatch(dayList(oldDay), /Reyes, Ana/);
    hr.setInterviewDay("2026-11-06");
    const newDay = hr.initialInterviewsHtml();
    assert.match(dayList(newDay), /Reyes, Ana/);
    assert.match(dayList(newDay), /data-rescheduled="1"/);
    assert.doesNotMatch(dayList(newDay), /Cruz, Ben/);

    const options = hr.applicantOptionsHtml(Object.values(w.S.applicants), "", w.S.roles, "");
    assert.match(options, /6 Nov 2026, 10:00 AM · Rescheduled/);
    assert.match(options, /Cruz, Ben · 3 Nov 2026, 9:00 AM</);
    assert.doesNotMatch(options, /Cruz, Ben · 3 Nov 2026, 9:00 AM · Rescheduled/);
  });

  it("leaves a legacy applicant unchanged until someone reschedules", async () => {
    const stored = {
      a1: {
        id: "a1",
        name: "Santos, Joy",
        position: "Helper",
        stage: "Interview",
        interviews: [{ type: "Role Interview", date: "2026-11-04", interviewer: "Cassie" }],
        exams: [{ id: "es1", title: "IQ Test", score: 30, max: 50, takenOn: "2026-11-04", on: "2026-11-04" }],
        initialInterview: legacyInterview(),
      },
    };
    const before = JSON.stringify(stored);
    const w = fakeWindow(JSON.parse(before));
    const hr = loadRecruit(w);
    hr.install();
    hr.setInterviewDay("all");
    const list = hr.initialInterviewsHtml();
    assert.match(list, /1 Nov 2026, 9:00 AM/);
    assert.match(list, /Santos, Joy/);
    assert.doesNotMatch(list, /data-rescheduled/);
    assert.equal(hr.interviewDayOf(w.S.applicants.a1), "2026-11-01");
    const seen = JSON.parse(JSON.stringify(w.S.applicants));
    delete seen.a1.__dedupeId;
    assert.equal(JSON.stringify(seen), before);
    const summary = hr.examScoresSummaryHtml(w.S.applicants.a1);
    assert.match(summary, /2026-11-04/);
    assert.doesNotMatch(summary, /data-rescheduled/);
    assert.doesNotMatch(hr.examScoreLine(w.S.applicants.a1.exams[0]), /Rescheduled/);
    const none = await hr.rescheduleInitialInterview("a1", { at: "" });
    assert.equal(none.ok, false);
    const after = JSON.parse(JSON.stringify(w.S.applicants));
    delete after.a1.__dedupeId;
    assert.equal(JSON.stringify(after), before);
  });

  it("reschedules an exam date and an interview record without a time, and keeps each history", async () => {
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Santos, Joy",
        position: "Helper",
        stage: "Written Exam",
        interviews: [{ type: "Role Interview", date: "2026-11-04", interviewer: "Cassie", overall: "3" }],
        exams: [{ id: "es1", title: "IQ Test", score: 30, max: 50, takenOn: "2026-11-04", on: "2026-11-04", notes: "First paper" }],
      },
    });
    const hr = loadRecruit(w);
    hr.install();
    const exam = await hr.rescheduleExam("a1", "es1", { at: "2026-11-12", reason: "No show", by: "Cassie" });
    assert.equal(exam.ok, true);
    const row = w.S.applicants.a1.exams[0];
    assert.equal(row.takenOn, "2026-11-12");
    assert.equal(row.on, "2026-11-12");
    assert.equal(row.originalOn, "2026-11-04");
    assert.equal(row.score, 30);
    assert.equal(row.notes, "First paper");
    assert.equal(row.reschedules.length, 1);
    assert.equal(row.reschedules[0].from, "2026-11-04");
    assert.equal(row.reschedules[0].to, "2026-11-12");
    assert.equal(row.reschedules[0].reason, "No show");
    assert.equal(row.reschedules[0].by, "Cassie");
    assert.doesNotMatch(row.reschedules[0].to, /T/);
    const examAgain = await hr.rescheduleExam("a1", "es1", { at: "2026-11-13", reason: "Storm", by: "Cassie" });
    assert.equal(examAgain.ok, true);
    assert.equal(w.S.applicants.a1.exams[0].reschedules.length, 2);
    assert.equal(w.S.applicants.a1.exams[0].reschedules[0].to, "2026-11-12");
    assert.equal(w.S.applicants.a1.exams[0].takenOn, "2026-11-13");
    assert.match(hr.examScoresSummaryHtml(w.S.applicants.a1), /2026-11-13/);
    assert.match(hr.examScoresSummaryHtml(w.S.applicants.a1), /data-rescheduled="1"/);
    assert.match(hr.examScoreLine(w.S.applicants.a1.exams[0]), /2026-11-13/);
    assert.match(hr.examScoreLine(w.S.applicants.a1.exams[0]), /Rescheduled/);
    const panel = hr.schedulePanelHtml(w.S.applicants.a1);
    assert.match(panel, /Exam · IQ Test/);
    assert.match(panel, /No show/);
    assert.match(panel, /type="date"/);

    const iv = await hr.rescheduleInterviewRecord("a1", 0, { date: "2026-11-18", reason: "Panel moved", by: "Cassie" });
    assert.equal(iv.ok, true);
    const note = w.S.applicants.a1.interviews[0];
    assert.equal(note.date, "2026-11-18");
    assert.equal(note.originalDate, "2026-11-04");
    assert.equal(note.overall, "3");
    assert.equal(note.reschedules[0].from, "2026-11-04");
    assert.equal(note.reschedules[0].to, "2026-11-18");
    assert.equal(note.reschedules[0].reason, "Panel moved");
    const ivAgain = await hr.rescheduleInterviewRecord("a1", 0, { date: "2026-11-19", reason: "Still out", by: "Maria" });
    assert.equal(ivAgain.ok, true);
    assert.equal(w.S.applicants.a1.interviews[0].reschedules.length, 2);
    assert.equal(w.S.applicants.a1.interviews[0].reschedules[0].reason, "Panel moved");
    assert.equal(w.S.applicants.a1.interviews[0].date, "2026-11-19");
    assert.match(hr.schedulePanelHtml(w.S.applicants.a1), /Interview record · Role Interview/);
    assert.match(hr.schedulePanelHtml(w.S.applicants.a1), /Panel moved/);
  });

  it("records history when a saved date is edited, and a legacy save does not invent one", async () => {
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Reyes, Ana",
        position: "Helper",
        stage: "Interview",
        interviews: [{ type: "Role Interview", date: "2026-11-04", interviewer: "Cassie" }],
        exams: [{ id: "es1", title: "IQ Test", score: 30, max: 50, takenOn: "2026-11-04" }],
        initialInterview: legacyInterview(),
      },
    });
    const hr = loadRecruit(w);
    hr.install();
    const edited = await hr.commitInitialInterview("a1", {
      at: "2026-11-08T11:15",
      interviewer: "Cassie",
      notes: "Bring the CV",
      status: "Scheduled",
    });
    assert.equal(edited.ok, true);
    assert.equal(w.S.applicants.a1.initialInterview.at, "2026-11-08T11:15");
    assert.equal(w.S.applicants.a1.initialInterview.status, "Scheduled");
    assert.equal(w.S.applicants.a1.initialInterview.originalAt, "2026-11-01T09:00");
    assert.equal(w.S.applicants.a1.initialInterview.reschedules.length, 1);
    assert.equal(w.S.applicants.a1.initialInterview.reschedules[0].from, "2026-11-01T09:00");
    assert.equal(w.S.applicants.a1.initialInterview.reschedules[0].to, "2026-11-08T11:15");
    assert.equal(w.S.applicants.a1.initialInterview.reschedules[0].by, "Cassie");

    await w.put("applicants", "a1", {
      id: "a1",
      name: "Reyes, Ana",
      stage: "Interview",
      interviews: [{ type: "Role Interview", date: "2026-11-09", interviewer: "Cassie" }],
      exams: [{ id: "es1", title: "IQ Test", score: 30, max: 50, takenOn: "2026-11-10" }],
    });
    assert.equal(w.S.applicants.a1.initialInterview.at, "2026-11-08T11:15");
    assert.equal(w.S.applicants.a1.initialInterview.reschedules.length, 1);
    assert.equal(w.S.applicants.a1.exams[0].takenOn, "2026-11-10");
    assert.equal(w.S.applicants.a1.exams[0].originalOn, "2026-11-04");
    assert.equal(w.S.applicants.a1.exams[0].reschedules[0].from, "2026-11-04");
    assert.equal(w.S.applicants.a1.exams[0].reschedules[0].to, "2026-11-10");
    assert.equal(w.S.applicants.a1.exams[0].score, 30);
    assert.equal(w.S.applicants.a1.interviews[0].date, "2026-11-09");
    assert.equal(w.S.applicants.a1.interviews[0].originalDate, "2026-11-04");
    assert.equal(w.S.applicants.a1.interviews[0].reschedules[0].from, "2026-11-04");
    assert.equal(w.S.applicants.a1.interviews[0].reschedules[0].to, "2026-11-09");

    const plain = fakeWindow({
      a9: {
        id: "a9",
        name: "Legacy, Pat",
        stage: "Applied",
        exams: [{ id: "es9", title: "IQ Test", score: 10, takenOn: "2026-08-01" }],
        interviews: [],
      },
    });
    const hrPlain = loadRecruit(plain);
    hrPlain.install();
    const snap = JSON.stringify(plain.S.applicants.a9.exams[0]);
    await plain.put("applicants", "a9", {
      id: "a9",
      name: "Legacy, Pat",
      stage: "Applied",
      exams: [{ id: "es9", title: "IQ Test", score: 11, takenOn: "2026-08-01" }],
      interviews: [],
    });
    assert.equal(plain.S.applicants.a9.exams[0].takenOn, "2026-08-01");
    assert.equal(plain.S.applicants.a9.exams[0].score, 11);
    assert.equal(plain.S.applicants.a9.exams[0].reschedules, undefined);
    assert.notEqual(JSON.stringify(plain.S.applicants.a9.exams[0]), snap);
  });
});
