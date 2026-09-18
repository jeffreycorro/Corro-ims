"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const fix = require("../public/hr-forms-fix");

function loadOnWindow(windowLike) {
  windowLike.Date = Date;
  windowLike.Promise = Promise;
  windowLike.JSON = JSON;
  windowLike.Object = Object;
  windowLike.Error = Error;
  if (!windowLike.window) windowLike.window = windowLike;
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-forms-fix.js"), "utf8");
  vm.runInNewContext(src, windowLike);
  return windowLike.hrFormsFix;
}

describe("cash advance requester identity", () => {
  it("snapshots Domingo on first save and restores him when approval swaps empId to Catherine", () => {
    const S = {
      employees: {
        eD: { id: "eD", name: "Monte, Domingo C." },
        eC: { id: "eC", name: "Largo, Catherine A." },
      },
      settings: {
        hrHead: "Domingo C. Monte Jr.",
        payrollBy: "Catherine A. Largo",
      },
    };
    const first = fix.lockAdvanceIdentity(
      { id: "ca1", empId: "eD", receivedBy: "Monte, Domingo C.", amount: 5000 },
      S,
      undefined
    );
    assert.equal(first.filedEmpId, "eD");
    assert.match(first.employeeName, /Domingo/);

    const swapped = fix.lockAdvanceIdentity(
      {
        id: "ca1",
        empId: "eC",
        receivedBy: "Monte, Domingo C.",
        filedEmpId: "eD",
        employeeName: "Monte, Domingo C.",
        amount: 5000,
        status: "Approved",
      },
      S,
      first
    );
    assert.equal(swapped.empId, "eD");
    assert.match(swapped.employeeName, /Domingo/);
    assert.match(fix.advanceDisplayName(S, swapped), /Domingo/);
  });

  it("restores a filed empId when the picker is emptied on approval", () => {
    const S = {
      employees: { eD: { id: "eD", name: "Monte, Domingo C." } },
      settings: { payrollBy: "Catherine A. Largo" },
    };
    const out = fix.lockAdvanceIdentity(
      { id: "ca1", empId: "", filedEmpId: "eD", employeeName: "Monte, Domingo C." },
      S,
      { filedEmpId: "eD", employeeName: "Monte, Domingo C.", empId: "eD" }
    );
    assert.equal(out.empId, "eD");
  });

  it("wrapPut keeps Domingo when a later put sends Catherine's empId", async () => {
    const S = {
      employees: {
        eD: { id: "eD", name: "Monte, Domingo C." },
        eC: { id: "eC", name: "Largo, Catherine A." },
      },
      advances: {
        ca1: {
          id: "ca1",
          empId: "eD",
          filedEmpId: "eD",
          employeeName: "Monte, Domingo C.",
          receivedBy: "Monte, Domingo C.",
        },
      },
      settings: { payrollBy: "Catherine A. Largo", hrHead: "Domingo C. Monte Jr." },
    };
    const host = {
      S,
      async put(coll, id, obj) {
        S[coll][id] = obj;
      },
      document: { readyState: "complete", addEventListener() {} },
    };
    const api = loadOnWindow(host);
    api.patchGlobals(host);
    await host.put("advances", "ca1", {
      id: "ca1",
      empId: "eC",
      receivedBy: "Monte, Domingo C.",
      filedEmpId: "eD",
      employeeName: "Monte, Domingo C.",
      status: "Approved",
    });
    assert.equal(S.advances.ca1.empId, "eD");
    assert.match(S.advances.ca1.employeeName, /Domingo/);
  });
});

describe("live project pickers", () => {
  it("includes a newest daily / employee project that is not on the 2025 seed list", () => {
    const S = {
      projects: {
        p1: { id: "p1", name: "24HH0103 Buhisan FMR" },
      },
      employees: {
        e1: { id: "e1", project: "26HH0099 Newest Site", dateHired: "2026-09-01" },
      },
      daily: {
        d1: { id: "d1", date: "2026-09-17", rows: { e1: { site: "26HH0099 Newest Site" } } },
      },
      advances: {},
      leaves: {},
    };
    const names = fix.liveProjectNames(S);
    assert.ok(names.includes("26HH0099 Newest Site"));
    assert.ok(names.includes("24HH0103 Buhisan FMR"));
    assert.equal(names[0], "26HH0099 Newest Site");
  });
});

describe("project-based contract + ISO letterhead", () => {
  it("ships the required definite-period wording and ISO mark helpers", () => {
    const tpl = fix.projectBasedTemplate({
      templates: {
        t_projrenew_ccd: {
          body: "## (RENEWAL)\n\n### PROJECT-BASED WITH A DEFINITE PERIOD OF EMPLOYMENT CONTRACT\n\nThis Renewal Employment Contract",
        },
      },
    });
    assert.equal(tpl.id, "t_proj_ccd");
    assert.match(tpl.formTitle, /PROJECT-BASED WITH A DEFINITE PERIOD OF EMPLOYMENT/);
    assert.match(tpl.body, /PROJECT-BASED WITH A DEFINITE PERIOD OF EMPLOYMENT/);
    assert.doesNotMatch(tpl.body, /This Renewal Employment Contract/);
    const html = fix.decoratePaperHtml('<div class="pf-head"><img alt="x"><div class="addr">addr</div></div>', {}, tpl);
    assert.match(html, /pf-iso-mark/);
    assert.match(html, /ISO 9001:2015/);
  });

  it("is loaded by the shim and not referenced from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-forms-fix\.js/);
    assert.doesNotMatch(html, /hr-forms-fix\.js/);
    assert.match(html, /id="l-proj"/);
  });
});
