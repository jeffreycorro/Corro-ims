"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRecruit(windowLike) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-applicant-dedupe.js"), "utf8"), windowLike);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-applicants-export.js"), "utf8"), windowLike);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/hr-recruit.js"), "utf8"), windowLike);
  return windowLike.hrRecruit;
}

function fakeWindow(applicants) {
  const document = {
    getElementById() {
      return null;
    },
    createElement() {
      return { id: "", style: {}, setAttribute() {}, appendChild() {}, insertBefore() {} };
    },
    addEventListener() {},
    readyState: "complete",
  };
  const windowLike = {
    document,
    S: { applicants: applicants || {}, roles: {}, employees: {}, ui: {} },
    TODAY: "2026-11-09",
    toasts: [],
    opened: [],
    toast(msg) {
      windowLike.toasts.push(String(msg));
    },
    open(url) {
      windowLike.opened.push(url);
    },
    atob,
    Blob,
    URL,
  };
  windowLike.window = windowLike;
  return windowLike;
}

function el(attrs, parent) {
  return {
    attrs: attrs || {},
    parentNode: parent || null,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
  };
}

function click(hr, node) {
  const ev = {
    target: node,
    currentTarget: { id: "document" },
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  hr.onProfileClick(ev);
  return ev;
}

const DRIVE_RESUME = "https://drive.google.com/file/d/1EoRUZT2lUuj9pj2GP8DZfFKuIkI1G-Fk/view";
const DRIVE_OPEN = "https://drive.google.com/open?id=1EoRUZT2lUuj9pj2GP8DZfFKuIkI1G-Fk";
const GMAIL_FILE =
  "https://mail.google.com/mail/u/0/#search/compoc/FMfcgzQhWpCDKrmxxrLLQKrzNCgsstlc?compose=new&projector=1&messagePartId=0.1";
const FORM = "https://drive.google.com/file/d/1FORMAPPLICATION0001/view";

describe("applicant profile, interview details, and files", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const recruit = fs.readFileSync(path.join(__dirname, "../public/hr-recruit.js"), "utf8");

  it("is build 2026-11-10b", () => {
    assert.match(html, /const BUILD = "2026-11-13a"/);
  });

  it("keeps Open working after the interview date list is redrawn", () => {
    assert.match(recruit, /addEventListener\("click", onProfileClick, true\)/);
    assert.match(recruit, /list\.innerHTML = interviewScheduleListHtml/);
    const w = fakeWindow({
      a_xd7kxnh6zud: { id: "a_xd7kxnh6zud", name: "Joecil O. Ricahuerta", interviews: [] },
    });
    const hr = loadRecruit(w);
    const row = el({ "data-hr-iv-day": "2026-11-06" });
    const cell = el({}, row);
    const open = el({ "data-open-app": "a_xd7kxnh6zud" }, cell);
    const name = el({ "data-open-app": "a_xd7kxnh6zud" }, cell);
    w.appEditor = function (id) {
      w.profile = id;
    };
    let ev = click(hr, open);
    assert.equal(w.profile, "a_xd7kxnh6zud");
    assert.equal(ev.stopped, true);
    w.profile = "";
    ev = click(hr, name);
    assert.equal(w.profile, "a_xd7kxnh6zud");
    const phone = el({ href: "tel:09911976330" }, cell);
    w.profile = "";
    ev = click(hr, phone);
    assert.equal(w.profile, "");
    assert.equal(ev.stopped, false);
  });

  it("opens saved interview details even when the script catalog has no guide", () => {
    assert.match(html, /saved answers/);
    assert.match(html, /prior\.answers/);
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Princess Sheryln Zata",
        interviews: [
          {
            guideId: "missing-guide",
            type: "Role Interview",
            answers: [{ q: "Tell me about yourself", c: "Screening", a: "I work on site", r: "4" }],
          },
        ],
      },
    });
    const hr = loadRecruit(w);
    w.interviewRunner = function (id, guideId, idx) {
      w.ran = { id, guideId, idx };
    };
    const btn = el({ "data-hr-iv-details": "0", "data-hr-iv-app": "a1" });
    click(hr, btn);
    assert.deepEqual(w.ran, { id: "a1", guideId: "missing-guide", idx: 0 });
    w.S.applicants.a1.initialInterview = { at: "2026-11-04T09:00", status: "Done/Passed", interviewer: "Cassie" };
    hr.setInterviewDay("all");
    const list = hr.initialInterviewsHtml();
    assert.match(list, /data-open-app="a1"/);
    assert.match(list, /Interview details/);
  });

  it("opens a resume and an application form, and does not navigate plain text or inline file bytes", () => {
    const w = fakeWindow({});
    const hr = loadRecruit(w);
    assert.equal(
      hr.durableFileUrl(DRIVE_OPEN),
      "https://drive.google.com/file/d/1EoRUZT2lUuj9pj2GP8DZfFKuIkI1G-Fk/view"
    );
    const drive = hr.fileLinkHtml(DRIVE_RESUME, "Resume");
    assert.match(drive, /target="_blank"/);
    assert.match(drive, /1EoRUZT2lUuj9pj2GP8DZfFKuIkI1G-Fk/);
    const gmail = hr.fileLinkHtml(GMAIL_FILE, "Resume");
    assert.match(gmail, /target="_blank"/);
    assert.match(gmail, /FMfcgzQhWpCDKrmxxrLLQKrzNCgsstlc/);
    assert.match(gmail, /messagePartId=0\.1/);

    const token = "UNIQUEFILEPAYLOADTOKEN";
    const dataUrl = "data:application/pdf;base64," + Buffer.from(token).toString("base64");
    const person = {
      id: "a_file",
      name: "Ada",
      resumeLink: DRIVE_RESUME,
      docs: {
        resume: {
          s: "on",
          link: DRIVE_RESUME,
          title: "CV / application",
          links: [{ url: DRIVE_RESUME, title: "CV / application", on: "2026-09-14" }],
        },
        datasheet: {
          s: "on",
          link: FORM,
          title: "Application form",
          links: [{ url: FORM, title: "Application form", on: "2026-09-14" }],
        },
      },
      linkedDocs: [],
      interviews: [],
    };
    const files = hr.collectApplicantFiles(person);
    assert.equal(files.filter((f) => f.title === "Resume").length, 1);
    assert.equal(files.filter((f) => f.title === "Application form").length, 1);
    const panel = hr.applicantFilesHtml(person);
    assert.match(panel, /id="hr-recruit-files"/);
    assert.match(panel, />Resume</);
    assert.match(panel, />Application form</);
    assert.match(panel, /1EoRUZT2lUuj9pj2GP8DZfFKuIkI1G-Fk/);
    assert.match(panel, /1FORMAPPLICATION0001/);

    person.resumeLink = dataUrl;
    person.docs.resume.link = dataUrl;
    person.docs.resume.links = [{ url: dataUrl, title: "Resume" }];
    const heavy = hr.applicantFilesHtml(person);
    assert.doesNotMatch(heavy, /UNIQUEFILEPAYLOADTOKEN/);
    assert.doesNotMatch(heavy, new RegExp(Buffer.from(token).toString("base64")));
    assert.match(heavy, /data-hr-file="/);
    const id = heavy.match(/data-hr-file="([^"]+)"/)[1];
    click(hr, el({ "data-hr-file": id }));
    assert.equal(w.opened.length, 1);
    assert.match(w.opened[0], /^blob:/);

    const text = hr.fileLinkHtml("biodata", "Resume");
    assert.doesNotMatch(text, /href=/);
    const textId = text.match(/data-hr-file="([^"]+)"/)[1];
    w.opened = [];
    click(hr, el({ "data-hr-file": textId }));
    assert.deepEqual(w.opened, []);
    assert.match(w.toasts.join(" "), /not a file link/);

    const empty = hr.applicantFilesHtml({
      id: "a_nqwb862kdbe",
      name: "Arthur Candido Ramos Gomez",
      resumeLink: "",
      stage: "Interview",
      notes: "Added when the initial interview was scheduled.",
      interviews: [],
    });
    assert.match(empty, /No resume is attached/);
    assert.match(empty, /No application form is attached/);
    assert.doesNotMatch(empty, /href=/);
  });

  it("shows the same files on the recommendation for a final interview", () => {
    assert.match(recruit, /isRecommendationModal/);
    assert.match(recruit, /injectApplicantFiles\(\)/);
    const w = fakeWindow({});
    const hr = loadRecruit(w);
    const panel = hr.applicantFilesHtml({
      id: "a_wrykrvq40rs",
      name: "Princess Sheryln Zata",
      resumeLink: GMAIL_FILE,
      docs: {
        datasheet: { link: FORM, title: "Employee Data Sheet", links: [] },
      },
      interviews: [{ guideId: "ccdg_site-engineer", type: "Role Interview", answers: [{ q: "Salary?", a: "800" }] }],
    });
    assert.match(panel, /FMfcgzQhWpCDKrmxxrLLQKrzNCgsstlc/);
    assert.match(panel, /Application form/);
    assert.match(panel, /1FORMAPPLICATION0001/);
    assert.match(panel, /Interview details/);
    assert.match(html, /data-cv-kept/);
  });
});
