"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadDedupe(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-applicant-dedupe.js"), "utf8");
  vm.runInNewContext(src, windowLike);
  return windowLike.hrApplicantDedupe;
}

function loadExport(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-applicants-export.js"), "utf8");
  vm.runInNewContext(src, windowLike);
  return windowLike.hrApplicantsExport;
}

function loadRecruit(windowLike) {
  loadDedupe(windowLike);
  loadExport(windowLike);
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-recruit.js"), "utf8");
  vm.runInNewContext(src, windowLike);
  return windowLike.hrRecruit;
}

function fakeWindow(applicants) {
  const created = [];
  const byId = {};
  const parent = {
    insertBefore(el, _ref) {
      created.push(el);
      if (el.id) byId[el.id] = el;
      el.parentNode = parent;
      return el;
    },
    appendChild(el) {
      return parent.insertBefore(el, null);
    },
    removeChild(el) {
      const i = created.indexOf(el);
      if (i >= 0) created.splice(i, 1);
      if (el.id) delete byId[el.id];
      return el;
    },
  };
  const newApp = {
    id: "new-app",
    parentNode: parent,
    nextSibling: null,
  };
  byId["new-app"] = newApp;
  const document = {
    getElementById(id) {
      return byId[id] || null;
    },
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        className: "",
        id: "",
        type: "",
        textContent: "",
        innerHTML: "",
        onclick: null,
        style: {},
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
    },
    TODAY: "2026-09-15",
    DOCS: [
      { k: "resume", n: "Resume / Biodata", g: "Recruitment" },
      { k: "tor", n: "TOR", g: "Recruitment" },
      { k: "datasheet", n: "Employee Data Sheet", g: "Recruitment" },
      { k: "govid", n: "Gov / Valid ID", g: "Identification" },
    ],
    dropped: [],
    async put(coll, id, obj) {
      if (coll === "applicants") window.S.applicants[id] = obj;
      if (coll === "employees") window.S.employees[id] = obj;
    },
    async drop(coll, id) {
      window.dropped.push({ coll, id });
      if (coll === "applicants") delete window.S.applicants[id];
    },
  };
  window.window = window;
  window.created = created;
  return window;
}

describe("hr-recruit companion wiring", () => {
  it("lets the applicant editor keep several named exam scores", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /Exam scores/);
    assert.match(html, /Add exam score/);
    assert.match(html, /id="ax-title"/);
    assert.match(html, /id="ax-max"/);
    assert.match(html, /data-edex/);
    assert.match(html, /No exam scores yet/);
    assert.match(html, /pfBand\("TEST RESULTS"\)/);
    assert.match(html, /r\.title\|\|x\.title\|\|"Examination"/);
  });

  it("is loaded by the shim after the shared name-key module, not from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-applicant-dedupe\.js/);
    assert.match(shim, /hr-applicants-export\.js/);
    assert.match(shim, /hr-recruit\.js/);
    assert.match(shim, /data-hr-recruit/);
    assert.ok(shim.indexOf("hr-applicant-dedupe.js") < shim.indexOf("hr-applicants-export.js"));
    assert.ok(shim.indexOf("hr-applicants-export.js") < shim.indexOf("hr-recruit.js"));
    assert.doesNotMatch(html, /hr-recruit\.js/);
    assert.doesNotMatch(html, /hr-applicant-dedupe\.js/);
    assert.doesNotMatch(html, /hr-applicants-export\.js/);
  });
});

describe("hr-recruit paste door", () => {
  it("accepts a wrapped object or a bare array", () => {
    const hr = loadRecruit(fakeWindow());
    const wrapped = hr.parsePaste('{"applicants":[{"name":"Ada"}]}');
    assert.equal(wrapped.applicants.length, 1);
    assert.equal(wrapped.applicants[0].name, "Ada");
    const bare = hr.parsePaste('[{"name":"Ada"}]');
    assert.equal(bare.applicants.length, 1);
    assert.equal(bare.applicants[0].name, "Ada");
    assert.throws(() => hr.parsePaste(""), /Paste/);
    assert.throws(() => hr.parsePaste("{"), /not valid JSON/);
    assert.throws(() => hr.parsePaste("{}"), /applicants/);
  });

  it("parses the extractor JSON wrapper and CSV as overwrite-by-id only", () => {
    const hr = loadRecruit(fakeWindow());
    const json = hr.parsePaste(
      JSON.stringify({
        asOf: "2026-09-18T13:05+08:00",
        driveFolderId: "1G1TJ5rmI_rGEQcXjKLfYfy2dx9gtZRgC",
        counts: { totalApplicants: 1, withResumeLink: 1, backfillPatched: 0, shortlist: 1 },
        notes: ["Overwrite-by-id only — do not create new rows."],
        applicants: [
          {
            id: "a_keep",
            name: "Culpa, Cyrel",
            resumeLink: "https://drive.google.com/file/d/abc/view",
            patchedInBackfill: false,
            isShortlist: true,
          },
        ],
      })
    );
    assert.equal(json.updateOnly, true);
    assert.equal(json.overwrite, true);
    assert.equal(json.extractor, true);
    assert.equal(json.applicants[0].id, "a_keep");
    assert.equal(json.applicants[0].resumeLink, "https://drive.google.com/file/d/abc/view");

    const csv = hr.parsePaste(
      "id,name,resumeLink,patchedInBackfill,isShortlist\r\n" +
        'a_keep,"Antonino, Vince Michael B.",https://drive.google.com/file/d/xyz/view,False,False\r\n'
    );
    assert.equal(csv.updateOnly, true);
    assert.equal(csv.fromCsv, true);
    assert.equal(csv.applicants[0].id, "a_keep");
    assert.equal(csv.applicants[0].name, "Antonino, Vince Michael B.");
    assert.equal(typeof hr.openOverwriteDoor, "function");
  });

  it("injects Bulk import JSON next to Log an applicant", () => {
    const w = fakeWindow();
    const hr = loadRecruit(w);
    const btn = hr.injectButton();
    assert.equal(btn.id, "hr-recruit-bulk");
    assert.match(btn.textContent, /Bulk import JSON/);
    assert.equal(hr.injectButton(), btn);
  });
});

describe("hr-recruit consolidate", () => {
  it("shows Consolidate duplicates only when groups exist", () => {
    const empty = fakeWindow();
    const hrEmpty = loadRecruit(empty);
    hrEmpty.injectButton();
    assert.equal(hrEmpty.injectConsolidateButton(), null);

    const w = fakeWindow({
      a1: { id: "a1", name: "Tristan Sibonga", roleId: "ro02", stage: "Applied", appliedOn: "2026-08-10" },
      a2: { id: "a2", name: "Sibonga, Tristan", roleId: "ro02", stage: "Applied", appliedOn: "2026-08-10" },
    });
    const hr = loadRecruit(w);
    hr.injectButton();
    const btn = hr.injectConsolidateButton();
    assert.equal(btn.id, "hr-recruit-dedupe");
    assert.match(btn.textContent, /Consolidate duplicates \(1\)/);
  });

  it("merges a group into one record and drops extras", async () => {
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Barrios, Luisa G.",
        roleId: "ro06",
        stage: "Applied",
        appliedOn: "2026-05-15",
        email: "",
        notes: "May walk-in",
        exams: [],
        interviews: [],
        history: [],
      },
      a2: {
        id: "a2",
        name: "Barrios, Luisa G.",
        roleId: "ro06",
        stage: "Applied",
        appliedOn: "2026-05-15",
        email: "luisa@example.com",
        resumeLink: "https://drive.example/luisa",
        notes: "Copy",
        exams: [],
        interviews: [],
        history: [],
      },
    });
    const hr = loadRecruit(w);
    const groups = hr.duplicateGroups();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].autoSafe, true);
    const result = await hr.mergeGroup(groups[0]);
    assert.ok(result.keeper.email === "luisa@example.com" || result.keeper.resumeLink);
    assert.equal(result.extras.length, 1);
    assert.equal(Object.keys(w.S.applicants).length, 1);
    assert.equal(w.dropped.length, 1);
  });
});

describe("hr-recruit application file", () => {
  it("adds View 201 / application file on the applicant editor foot", () => {
    const hr = loadRecruit(fakeWindow());
    const foot = hr.decorateApplicantFoot(
      '<button class="btn" id="a-hire">Hire and create the 201</button><button class="btn pri" id="a-save">Save</button>',
      { id: "a1", hiredEmpId: "" }
    );
    assert.match(foot, /hr-recruit-file/);
    assert.match(foot, /View 201 \/ application file/);
    assert.match(foot, /id="a-hire"/);
    const hired = hr.decorateApplicantFoot(
      '<button class="btn pri" id="a-save">Save</button>',
      { id: "a1", hiredEmpId: "e9" }
    );
    assert.match(hired, /Open 201 file/);
  });

  it("renders the Recruitment checklist and resume link without requiring a 201", () => {
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Barrios, Luisa G.",
        roleId: "ro06",
        stage: "Applied",
        resumeLink: "https://drive.example/luisa",
        hiredEmpId: "",
      },
    });
    const hr = loadRecruit(w);
    const html = hr.applicationFileHtml(w.S.applicants.a1);
    assert.match(html, /Resume \/ Biodata/);
    assert.match(html, /Employee Data Sheet/);
    assert.match(html, /TOR/);
    assert.doesNotMatch(html, /Gov \/ Valid ID/);
    assert.match(html, /https:\/\/drive\.example\/luisa/);
    assert.match(html, /application file, not a hired 201/);
  });
});

describe("hr-recruit role filter", () => {
  const applicants = {
    a1: { id: "a1", name: "Barrios, Luisa G.", roleId: "ro06", position: "Procurement Officer" },
    a2: { id: "a2", name: "Tristan Sibonga", roleId: "ro02", position: "Project Manager" },
    a3: { id: "a3", name: "Unlinked Person", roleId: "", position: "Project / Site Engineer" },
    a4: { id: "a4", name: "No Role", roleId: "", position: "" },
  };

  it("keys chips by roleId or title so the same job is one tap", () => {
    const w = fakeWindow(applicants);
    const hr = loadRecruit(w);
    const roles = w.S.roles;
    assert.equal(hr.roleFilterKey(applicants.a1, roles), "ro06");
    assert.equal(hr.roleFilterKey({ roleId: "", position: "Procurement Officer" }, roles), "ro06");
    assert.equal(hr.roleFilterKey(applicants.a3, roles), "title:project / site engineer");
    assert.equal(hr.roleFilterKey(applicants.a4, roles), "unlinked");
    assert.equal(hr.applicantMatchesRole(applicants.a1, "", roles), true);
    assert.equal(hr.applicantMatchesRole(applicants.a1, "ro06", roles), true);
    assert.equal(hr.applicantMatchesRole(applicants.a2, "ro06", roles), false);
    assert.equal(hr.applicantMatchesRole({ roleId: "", position: "Procurement Officer" }, "ro06", roles), true);
    assert.equal(hr.applicantMatchesRole(applicants.a3, "title:project / site engineer", roles), true);
    const opts = hr.roleFilterOptions(Object.values(applicants), roles);
    const labels = opts.map((o) => o.label);
    assert.ok(labels.includes("Procurement Officer"));
    assert.ok(labels.includes("Project Manager"));
    assert.ok(labels.includes("Project / Site Engineer"));
    assert.ok(labels.includes("Unlinked"));
    assert.equal(opts.find((o) => o.key === "ro06").count, 1);
  });

  it("injects All roles chips in the Pipeline header next to Log an applicant", () => {
    const w = fakeWindow(applicants);
    const hr = loadRecruit(w);
    hr.injectButton();
    const bar = hr.injectRoleFilter();
    const log = w.document.getElementById("new-app");
    assert.equal(bar.id, "hr-recruit-role-filter");
    assert.equal(bar.parentNode, log.parentNode);
    assert.match(bar.innerHTML, /All roles/);
    assert.match(bar.innerHTML, /Procurement Officer/);
    assert.match(bar.innerHTML, /data-role-filter="ro06"/);
    assert.match(bar.innerHTML, /Project \/ Site Engineer/);
  });
});

describe("hr-recruit pipeline search", () => {
  const applicants = {
    a1: {
      id: "a1",
      name: "Barrios, Luisa G.",
      roleId: "ro06",
      position: "Procurement Officer",
      email: "luisa@example.com",
      mobile: "0917 000 0000",
    },
    a2: {
      id: "a2",
      name: "Tristan Sibonga",
      roleId: "ro02",
      position: "Project Manager",
      email: "tristan@example.com",
      mobile: "0918 111 2222",
    },
    a3: {
      id: "a3",
      name: "Unlinked Person",
      roleId: "",
      position: "Project / Site Engineer",
      email: "",
      mobile: "",
    },
  };

  it("matches name, Last-First flip, email, mobile, and role title", () => {
    const w = fakeWindow(applicants);
    const hr = loadRecruit(w);
    const roles = w.S.roles;
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "", roles), true);
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "luisa", roles), true);
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "Luisa Barrios", roles), true);
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "luisa@example", roles), true);
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "Barrios,", roles), true);
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "!!!", roles), false);
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "0917", roles), true);
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "09170000000", roles), true);
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "procurement", roles), true);
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "tristan", roles), false);
    assert.equal(hr.applicantMatchesSearch(applicants.a2, "project manager", roles), true);
    assert.equal(hr.applicantMatchesSearch(applicants.a3, "site engineer", roles), true);
  });

  it("ANDs search words and ANDs with the role filter", () => {
    const w = fakeWindow(applicants);
    const hr = loadRecruit(w);
    const roles = w.S.roles;
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "luisa barrios", roles), true);
    assert.equal(hr.applicantMatchesSearch(applicants.a1, "luisa tristan", roles), false);
    assert.equal(hr.applicantMatchesPipeline(applicants.a1, "ro06", "luisa", roles), true);
    assert.equal(hr.applicantMatchesPipeline(applicants.a1, "ro02", "luisa", roles), false);
    assert.equal(hr.applicantMatchesPipeline(applicants.a2, "ro06", "tristan", roles), false);
    assert.equal(hr.applicantMatchesPipeline(applicants.a2, "", "tristan", roles), true);
  });

  it("injects a clearable search input in the Pipeline header", () => {
    const w = fakeWindow(applicants);
    const hr = loadRecruit(w);
    hr.injectButton();
    const wrap = hr.injectSearch();
    assert.equal(wrap.id, "hr-recruit-search-wrap");
    assert.match(wrap.innerHTML, /id="hr-recruit-search"/);
    assert.match(wrap.innerHTML, /Search name, email, mobile, role/);
    assert.match(wrap.innerHTML, /hr-recruit-search-clear/);
    assert.match(wrap.innerHTML, /hidden/);
    assert.equal(hr.injectSearch(), wrap);
  });

  it("persists the query and clears it", () => {
    const w = fakeWindow(applicants);
    const hr = loadRecruit(w);
    hr.setPipelineSearch("luisa");
    assert.equal(hr.currentSearch(), "luisa");
    assert.equal(w.S.ui.pipelineSearch, "luisa");
    hr.setPipelineSearch("");
    assert.equal(hr.currentSearch(), "");
  });
});

describe("hr-recruit applicant exam scores", () => {
  it("normalizes free-form exam name, score, date, and notes", () => {
    const w = fakeWindow();
    const hr = loadRecruit(w);
    const row = hr.normalizeExamScore({
      title: "IQ Test",
      score: "42",
      max: "50",
      takenOn: "2026-09-10",
      notes: "First sitting",
    });
    assert.ok(row);
    assert.match(row.id, /^es_/);
    assert.equal(row.title, "IQ Test");
    assert.equal(row.score, 42);
    assert.equal(row.max, 50);
    assert.equal(row.takenOn, "2026-09-10");
    assert.equal(row.notes, "First sitting");
    assert.equal(row.examId, "");
  });

  it("fills title from the catalog when only examId is stored", () => {
    const w = fakeWindow();
    w.S.exams = {
      x001: { id: "x001", kind: "exam", title: "IQ and General Aptitude Test", maxScore: 50, passing: 30 },
    };
    const hr = loadRecruit(w);
    const row = hr.normalizeExamScore({ examId: "x001", score: 40, takenOn: "2026-06-01" });
    assert.equal(row.title, "IQ and General Aptitude Test");
    assert.equal(row.max, 50);
    assert.equal(row.score, 40);
  });

  it("adds, edits, and removes several scores on one applicant", () => {
    const w = fakeWindow({
      a1: { id: "a1", name: "Barrios, Luisa G.", exams: [] },
    });
    const hr = loadRecruit(w);
    const a = w.S.applicants.a1;
    const first = hr.appendExamScore(a, { title: "IQ Test", score: 42, max: 50, notes: "Walk-in" });
    const second = hr.appendExamScore(a, { title: "Safety Knowledge", score: 28, max: 30, takenOn: "2026-09-12" });
    assert.equal(a.exams.length, 2);
    assert.equal(a.exams[0].title, "IQ Test");
    assert.equal(a.exams[1].title, "Safety Knowledge");
    assert.equal(a.exams[1].takenOn, "2026-09-12");
    const edited = hr.updateExamScore(a, first.id, { score: 45, notes: "Retake" });
    assert.equal(edited.score, 45);
    assert.equal(edited.notes, "Retake");
    assert.equal(edited.title, "IQ Test");
    assert.equal(a.exams.length, 2);
    assert.equal(hr.removeExamScore(a, second.id), true);
    assert.equal(a.exams.length, 1);
    assert.equal(a.exams[0].id, first.id);
  });

  it("keeps exam rows when Save puts an editor copy without them", async () => {
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Barrios, Luisa G.",
        exams: [{ id: "es_keep", title: "IQ Test", score: 42, max: 50, takenOn: "2026-09-10" }],
      },
    });
    const hr = loadRecruit(w);
    hr.install();
    await w.put("applicants", "a1", { id: "a1", name: "Barrios, Luisa G.", notes: "Walk-in" });
    assert.equal(w.S.applicants.a1.exams.length, 1);
    assert.equal(w.S.applicants.a1.exams[0].title, "IQ Test");
    assert.equal(w.S.applicants.a1.notes, "Walk-in");
  });

  it("lists every score on the application file, not only the first", () => {
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Barrios, Luisa G.",
        roleId: "ro06",
        stage: "Written Exam",
        exams: [
          { id: "es1", title: "IQ Test", score: 42, max: 50, takenOn: "2026-09-10" },
          { id: "es2", title: "Safety Knowledge", score: 21, max: 30, takenOn: "2026-09-12", notes: "Retake" },
        ],
      },
    });
    const hr = loadRecruit(w);
    const html = hr.applicationFileHtml(w.S.applicants.a1);
    assert.match(html, /Exam scores/);
    assert.match(html, /IQ Test/);
    assert.match(html, /Safety Knowledge/);
    assert.match(html, /Retake/);
    assert.match(html, /42/);
    assert.match(html, /21/);
    assert.match(hr.examScoreLine(w.S.applicants.a1.exams[1]), /Safety Knowledge: 21 \/ 30 \(2026-09-12\) — Retake/);
  });
});

describe("hr-recruit applicant staff notes", () => {
  it("renders a dated Background check / Observations log", () => {
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Barrios, Luisa G.",
        staffNotes: [
          { id: "sn1", kind: "background", text: "Rang previous employer — confirmed dates.", on: "2026-09-14", by: "Domingo" },
          { id: "sn2", kind: "observation", text: "Arrived 20 minutes late.", on: "2026-09-15", by: "Maria" },
        ],
      },
    });
    w.S.settings = { hrHead: "Domingo C. Monte Jr." };
    const hr = loadRecruit(w);
    const html = hr.staffNotesHtml(w.S.applicants.a1);
    assert.match(html, /Background check and observations/);
    assert.match(html, /Background check/);
    assert.match(html, /Rang previous employer/);
    assert.match(html, /Observation/);
    assert.match(html, /Arrived 20 minutes late/);
    assert.match(html, /hr-recruit-staff-add/);
    assert.match(html, /does not overwrite Internal notes/);
  });

  it("appends dated entries without overwriting earlier ones", () => {
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Barrios, Luisa G.",
        staffNotes: [{ id: "sn1", kind: "background", text: "First call", on: "2026-09-14", by: "A" }],
      },
    });
    w.S.settings = { hrStaff: "Maria" };
    const hr = loadRecruit(w);
    const a = w.S.applicants.a1;
    const added = hr.appendStaffNote(a, "observation", "Second look", "Maria");
    assert.ok(added);
    assert.equal(a.staffNotes.length, 2);
    assert.equal(a.staffNotes[0].text, "First call");
    assert.equal(a.staffNotes[1].kind, "observation");
    assert.equal(a.staffNotes[1].text, "Second look");
    assert.equal(a.staffNotes[1].on, "2026-09-15");
    assert.equal(a.staffNotes[1].by, "Maria");
  });

  it("keeps staffNotes when Save puts an editor copy without the log", async () => {
    const w = fakeWindow({
      a1: {
        id: "a1",
        name: "Barrios, Luisa G.",
        notes: "Walk-in",
        staffNotes: [{ id: "sn1", kind: "background", text: "NBI clear", on: "2026-09-14", by: "HR" }],
      },
    });
    const hr = loadRecruit(w);
    hr.install();
    await w.put("applicants", "a1", { id: "a1", name: "Barrios, Luisa G.", notes: "Walk-in" });
    assert.equal(w.S.applicants.a1.staffNotes.length, 1);
    assert.equal(w.S.applicants.a1.staffNotes[0].text, "NBI clear");
    assert.equal(w.S.applicants.a1.notes, "Walk-in");
  });
});

describe("hr-recruit initial interviews", () => {
  const people = {
    a1: {
      id: "a1",
      name: "Monte, Domingo Jr.",
      roleId: "ro02",
      position: "Project Manager",
      stage: "Applied",
      email: "domingo@example.com",
      interviews: [],
    },
    a2: {
      id: "a2",
      name: "Barrios, Luisa G.",
      roleId: "ro06",
      position: "Procurement Officer",
      stage: "Screening",
      interviews: [],
    },
    a3: {
      id: "a3",
      name: "Santos, Ana",
      roleId: "",
      position: "Project Manager",
      stage: "Background Check",
      interviews: [{ date: "2026-10-01", overall: "4" }],
    },
    a4: {
      id: "a4",
      name: "Reyes, Paolo",
      roleId: "",
      position: "",
      stage: "For Final Interview",
      interviews: [],
    },
    a5: {
      id: "a5",
      name: "Hired Person",
      roleId: "ro06",
      position: "Procurement Officer",
      stage: "Hired",
      interviews: [],
    },
  };

  function copyPeople() {
    return JSON.parse(JSON.stringify(people));
  }

  it("moves early stages to Interview and leaves later stages on the applicant", async () => {
    const w = fakeWindow(copyPeople());
    const hr = loadRecruit(w);
    assert.equal(
      hr.INITIAL_STATUSES.join("|"),
      "Scheduled|Done/Passed|No-show|Rescheduled|Failed"
    );
    assert.equal(hr.stageAfterSchedule("Applied"), "Interview");
    assert.equal(hr.stageAfterSchedule("Screening"), "Interview");
    assert.equal(hr.stageAfterSchedule("Shortlisted"), "Interview");
    assert.equal(hr.stageAfterSchedule("On Hold"), "Interview");
    assert.equal(hr.stageAfterSchedule("Written Exam"), "Interview");
    assert.equal(hr.stageAfterSchedule(""), "Interview");
    assert.equal(hr.stageAfterSchedule("Interview"), "Interview");
    assert.equal(hr.stageAfterSchedule("Background Check"), "Background Check");
    assert.equal(hr.stageAfterSchedule("For Final Interview"), "For Final Interview");
    assert.equal(hr.stageAfterSchedule("Offer"), "Offer");
    assert.equal(hr.stageAfterSchedule("Hired"), "Hired");
    assert.equal(hr.stageAfterSchedule("Rejected"), "Rejected");

    const saved = await hr.commitInitialInterview("a1", {
      at: "2026-10-21T09:30",
      interviewer: "Cassie",
      notes: "Bring the CV",
      status: "Scheduled",
    });
    assert.equal(saved.ok, true);
    assert.equal(w.S.applicants.a1.stage, "Interview");
    assert.equal(w.S.applicants.a1.initialInterview.at, "2026-10-21T09:30");
    assert.equal(w.S.applicants.a1.initialInterview.interviewer, "Cassie");
    assert.equal(w.S.applicants.a1.initialInterview.notes, "Bring the CV");
    assert.equal(w.S.applicants.a1.initialInterview.status, "Scheduled");
    assert.equal(w.S.applicants.a1.interviews.length, 0);
    assert.equal(hr.applicantMatchesPipeline(w.S.applicants.a1, "ro02", "domingo", w.S.roles), true);

    const later = await hr.commitInitialInterview("a3", {
      at: "2026-10-22 14:00",
      status: "Done/Passed",
    });
    assert.equal(later.ok, true);
    assert.equal(w.S.applicants.a3.stage, "Background Check");
    assert.equal(w.S.applicants.a3.initialInterview.at, "2026-10-22T14:00");
    assert.equal(w.S.applicants.a3.initialInterview.status, "Done/Passed");
    assert.equal(w.S.applicants.a3.interviews.length, 1);

    const alias = await hr.commitInitialInterview("a4", { at: "2026-10-23T08:00", status: "No-show" });
    assert.equal(alias.ok, true);
    assert.equal(w.S.applicants.a4.stage, "For Final Interview");

    const missingTime = await hr.commitInitialInterview("a2", { interviewer: "Cassie" });
    assert.equal(missingTime.ok, false);
    assert.equal(w.S.applicants.a2.stage, "Screening");
    assert.equal(w.S.applicants.a2.initialInterview, undefined);
  });

  it("lists scheduled interviews under the position and keeps a status change after reload", async () => {
    const w = fakeWindow(copyPeople());
    const hr = loadRecruit(w);
    await hr.commitInitialInterview("a1", { at: "2026-10-21T09:30", interviewer: "Cassie", notes: "Panel room", status: "Scheduled" });
    await hr.commitInitialInterview("a2", { at: "2026-10-21T11:00", status: "Rescheduled" });
    await hr.commitInitialInterview("a3", { at: "2026-10-22T14:00", status: "Failed" });
    const reloaded = fakeWindow(JSON.parse(JSON.stringify(w.S.applicants)));
    const hr2 = loadRecruit(reloaded);
    const html = hr2.initialInterviewsHtml();
    assert.match(html, /id="hr-initial-interviews"/);
    assert.match(html, /Project Manager/);
    assert.match(html, /Procurement Officer/);
    assert.match(html, /Monte, Domingo Jr\./);
    assert.match(html, /21 Oct 2026, 9:30 AM/);
    assert.match(html, /Cassie/);
    assert.match(html, /Panel room/);
    assert.match(html, /Barrios, Luisa G\./);
    assert.match(html, /data-hr-iv-status="a1"/);
    assert.match(html, /Done\/Passed/);
    assert.match(html, /No-show/);
    assert.match(html, /Failed/);
    const list = html.split('id="hr-iv-save"')[1] || "";
    const proc = list.indexOf(">Procurement Officer<");
    const proj = list.indexOf(">Project Manager<");
    assert.ok(proc >= 0 && proj > proc);
    const monte = list.indexOf("Monte, Domingo Jr.");
    const ana = list.indexOf("Santos, Ana");
    assert.ok(monte > proj && ana > monte);
    assert.doesNotMatch(html, /Hired Person/);

    const changed = await hr2.commitInitialStatus("a1", "No-show");
    assert.equal(changed.ok, true);
    assert.equal(reloaded.S.applicants.a1.initialInterview.status, "No-show");
    assert.equal(reloaded.S.applicants.a1.initialInterview.at, "2026-10-21T09:30");
    assert.equal(reloaded.S.applicants.a1.stage, "Interview");
    const again = hr2.initialInterviewsHtml();
    assert.match(again, /data-hr-iv-status="a1"[\s\S]*No-show/);
    assert.doesNotMatch(hr2.applicantOptionsHtml(
      Object.values(reloaded.S.applicants).filter((a) => a.stage !== "Hired"),
      "",
      reloaded.S.roles,
      "domingo"
    ), /Hired Person/);
    assert.match(hr2.applicantOptionsHtml(
      Object.values(reloaded.S.applicants).filter((a) => a.stage !== "Hired"),
      "",
      reloaded.S.roles,
      ""
    ), /optgroup label="Project Manager"/);
  });

  it("keeps the schedule when an editor save omits it, and a newer save wins", async () => {
    const w = fakeWindow(copyPeople());
    const hr = loadRecruit(w);
    await hr.commitInitialInterview("a1", { at: "2026-10-21T09:30", interviewer: "Cassie", status: "Scheduled" });
    const stamped = w.S.applicants.a1.initialInterview.updatedAt;
    hr.install();
    await w.put("applicants", "a1", { id: "a1", name: "Monte, Domingo Jr.", stage: "Applied", notes: "Walk-in" });
    assert.equal(w.S.applicants.a1.initialInterview.at, "2026-10-21T09:30");
    assert.equal(w.S.applicants.a1.initialInterview.updatedAt, stamped);
    assert.equal(w.S.applicants.a1.stage, "Applied");
    assert.equal(w.S.applicants.a1.notes, "Walk-in");
    await w.put("applicants", "a1", {
      id: "a1",
      name: "Monte, Domingo Jr.",
      stage: "Interview",
      initialInterview: {
        at: "2026-10-24T15:00",
        interviewer: "Maria",
        notes: "",
        status: "Rescheduled",
        updatedAt: "2099-01-01T00:00:00.000Z",
      },
    });
    assert.equal(w.S.applicants.a1.initialInterview.at, "2026-10-24T15:00");
    assert.equal(w.S.applicants.a1.initialInterview.status, "Rescheduled");
    await w.put("applicants", "a1", {
      id: "a1",
      name: "Monte, Domingo Jr.",
      stage: "Interview",
      initialInterview: {
        at: "2026-10-01T08:00",
        status: "Scheduled",
        updatedAt: "2000-01-01T00:00:00.000Z",
      },
    });
    assert.equal(w.S.applicants.a1.initialInterview.at, "2026-10-24T15:00");
    assert.equal(w.S.applicants.a1.initialInterview.status, "Rescheduled");
  });

  it("adds Schedule beside Open on the pipeline and opens that applicant", () => {
    const w = fakeWindow(copyPeople());
    const open = w.document.createElement("button");
    open.setAttribute("data-open-app", "a1");
    const td = {
      child: null,
      appendChild(el) {
        this.child = el;
        el.parentNode = this;
        return el;
      },
      querySelector(sel) {
        if (sel.indexOf("data-hr-iv-open") >= 0 && this.child && this.child.getAttribute("data-hr-iv-open") === "a1") {
          return this.child;
        }
        return null;
      },
    };
    open.parentNode = td;
    w.document.querySelectorAll = function (sel) {
      if (sel === "[data-open-app]") return [open];
      return [];
    };
    w.openModal = function (opts) {
      w.modal = opts;
    };
    const hr = loadRecruit(w);
    hr.injectScheduleButtons();
    hr.injectScheduleButtons();
    assert.equal(td.child.textContent, "Schedule");
    assert.equal(td.child.getAttribute("data-hr-iv-open"), "a1");
    const opened = hr.openScheduleModal("a1");
    assert.equal(opened.id, "a1");
    assert.match(w.modal.title, /Monte, Domingo Jr\./);
    assert.match(w.modal.body, /data-hr-iv-for="a1"/);
    assert.match(w.modal.body, /Project Manager/);
    assert.match(hr.schedulePanelHtml(w.S.applicants.a1), /id="hr-recruit-iv-panel"/);
    assert.match(hr.schedulePanelHtml(w.S.applicants.a1), /Not scheduled yet/);
  });

  it("schedules a name stored as Last, First and adds someone who is not on the pipeline", async () => {
    const w = fakeWindow(copyPeople());
    w.S.applicants.a6 = {
      id: "a6",
      name: "Lagamon, Cyrence",
      roleId: "",
      position: "Helper",
      stage: "Applied",
      interviews: [],
    };
    w.S.applicants.a7 = {
      id: "a7",
      name: "Lagamon, Cyrence",
      roleId: "",
      position: "Helper",
      stage: "Screening",
      interviews: [],
    };
    const hr = loadRecruit(w);
    assert.equal(hr.exactNameMatches("Cyrence Lagamon").length, 2);
    assert.equal(hr.resolveInterviewTarget("", "", "Cyrence Lagamon").error, "several");
    delete w.S.applicants.a7;

    const found = hr.resolveInterviewTarget("", "", "Cyrence Lagamon");
    assert.equal(found.create, false);
    assert.equal(found.id, "a6");
    assert.equal(hr.applicantMatchesSearch(w.S.applicants.a6, "Lagamon,", w.S.roles), true);
    assert.equal(hr.applicantFuzzyMatch(w.S.applicants.a6, "Cyrene Lagamon", w.S.roles), true);
    const hired = hr.resolveInterviewTarget("", "", "Hired Person");
    assert.equal(hired.id, "a5");
    const partial = hr.resolveInterviewTarget("", "", "Lagamon");
    assert.equal(partial.error, "close");
    assert.equal(Object.keys(w.S.applicants).length, 6);

    const scheduled = await hr.commitManualInterview(
      { name: "Cyrence Lagamon", position: "Helper", mobile: "0917 111 2222" },
      { at: "2026-10-23T09:00", interviewer: "Cassie", status: "Scheduled" }
    );
    assert.equal(scheduled.ok, true);
    assert.equal(scheduled.created, false);
    assert.equal(w.S.applicants.a6.initialInterview.at, "2026-10-23T09:00");
    assert.equal(w.S.applicants.a6.stage, "Interview");
    assert.equal(Object.keys(w.S.applicants).filter((id) => /lagamon/i.test(w.S.applicants[id].name)).length, 1);

    const missingDate = await hr.commitManualInterview({ name: "Nobody On File" }, { interviewer: "Cassie" });
    assert.equal(missingDate.ok, false);
    assert.equal(missingDate.error, "when");
    assert.equal(hr.exactNameMatches("Nobody On File").length, 0);

    const created = await hr.commitManualInterview(
      { name: "Nobody On File", position: "Procurement Officer", mobile: "0918 000 1111", email: "nobody@example.com" },
      { at: "2026-10-23T09:00", interviewer: "Cassie", notes: "Walk-in", status: "Scheduled" }
    );
    assert.equal(created.ok, true);
    assert.equal(created.created, true);
    assert.equal(created.applicant.stage, "Interview");
    assert.equal(created.applicant.source, "Walk-in");
    assert.equal(created.applicant.roleId, "ro06");
    assert.equal(created.applicant.dept, "Procurement");
    assert.equal(created.applicant.mobile, "0918 000 1111");
    assert.equal(created.applicant.email, "nobody@example.com");
    assert.equal(created.applicant.notes, "Added when the initial interview was scheduled.");
    assert.equal(w.S.applicants[created.applicant.id].initialInterview.status, "Scheduled");
    const again = await hr.commitManualInterview(
      { name: "Nobody On File", position: "Other" },
      { at: "2026-10-24T10:00", status: "Rescheduled" }
    );
    assert.equal(again.created, false);
    assert.equal(again.applicant.id, created.applicant.id);
    assert.equal(again.applicant.position, "Procurement Officer");
    assert.match(hr.initialInterviewsHtml(), /Nobody On File/);
    assert.match(hr.initialInterviewsHtml(), /id="hr-iv-new-name"/);
    assert.match(hr.initialInterviewsHtml(), /Add someone who is not on the pipeline/);

    const sel = w.document.createElement("select");
    sel.setAttribute("id", "hr-iv-app");
    sel.value = "";
    const hint = w.document.createElement("span");
    hint.setAttribute("id", "hr-iv-find-hint");
    const name = w.document.createElement("input");
    name.setAttribute("id", "hr-iv-new-name");
    name.value = "";
    hr.filterApplicantSelect("Cyrence Lagamon");
    assert.equal(sel.value, "a6");
    assert.match(hint.textContent, /Lagamon, Cyrence/);
    hr.filterApplicantSelect("Totally Unknown Person");
    assert.equal(sel.value, "");
    assert.equal(name.value, "Totally Unknown Person");
    assert.equal(name.getAttribute("data-from-find"), "1");
  });
});
