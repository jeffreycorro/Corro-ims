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

function loadRecruit(windowLike) {
  loadDedupe(windowLike);
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
  it("is loaded by the shim after the shared name-key module, not from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-applicant-dedupe\.js/);
    assert.match(shim, /hr-recruit\.js/);
    assert.match(shim, /data-hr-recruit/);
    assert.ok(shim.indexOf("hr-applicant-dedupe.js") < shim.indexOf("hr-recruit.js"));
    assert.doesNotMatch(html, /hr-recruit\.js/);
    assert.doesNotMatch(html, /hr-applicant-dedupe\.js/);
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

  it("injects All roles chips on Pipeline next to Log an applicant", () => {
    const w = fakeWindow(applicants);
    const hr = loadRecruit(w);
    hr.injectButton();
    const bar = hr.injectRoleFilter();
    assert.equal(bar.id, "hr-recruit-role-filter");
    assert.match(bar.innerHTML, /All roles/);
    assert.match(bar.innerHTML, /Procurement Officer/);
    assert.match(bar.innerHTML, /data-role-filter="ro06"/);
    assert.match(bar.innerHTML, /Project \/ Site Engineer/);
  });
});
