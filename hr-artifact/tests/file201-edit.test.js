"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

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

function loadPersist() {
  const names = ["isHeavyImage", "settingsHasImage", "employeePersist", "govNoFilled", "govField", "docShown", "empComplianceStamp"];
  const src = names.map((name) => extractFunction(html, name)).join("\n");
  const ctx = { S: { settings: {} } };
  vm.runInNewContext(src, ctx);
  return ctx;
}

describe("201 edit stays responsive", () => {
  it("is build 2026-09-26c", () => {
    assert.match(html, /const BUILD = "2026-09-26c"/);
  });

  it("debounces 201 writes and says Saved or Not saved", () => {
    assert.match(html, /function queueEmpSave\(/);
    assert.match(html, /function flushEmpSaves\(/);
    assert.match(html, /setTimeout\(\(\)=>\{ EMP_SAVE_T=null; flushEmpSaves\(\); \}, 450\)/);
    assert.match(html, /id="emp-savestate"/);
    assert.match(html, /noteEmpSave\("Editing…"\)/);
    assert.match(html, /noteEmpSave\("Saving…"\)/);
    assert.match(html, /noteEmpSave\(failed \|\| pending \? "Not saved" : "Saved"\)/);
    assert.match(html, /on\("\[data-ef\]","input"/);
    const start = html.indexOf("/* field bindings */");
    const end = html.indexOf('on("[data-ob]"', start);
    const block = html.slice(start, end);
    assert.match(block, /queueEmpSave\(S\.ui\.emp\)/);
    assert.match(block, /queueEmpSave\(emp\.id\)/);
    assert.doesNotMatch(block, /await put\("employees"/);
    assert.match(html, /function copyEmp\(/);
    assert.match(html, /COMP_CACHE/);
    assert.match(html, /if\(hit && hit\.stamp===stamp\) return hit\.c/);
    assert.match(html, /S\.ui\.view==="employees" && ALERTS_MEM/);
  });

  it("does not resend a photo or e-signature that already lives elsewhere", () => {
    const ctx = loadPersist();
    const big = "data:image/png;base64," + "A".repeat(5000);
    const only = "data:image/jpeg;base64," + "B".repeat(5000);
    ctx.S.settings = {
      hrSigData: big,
      hrSigs: { prepared: { data: big } },
    };
    const emp = {
      id: "e1",
      name: "Daasin, Cristy",
      sssNo: "09 - 4348404 - 2",
      sigData: big,
      sigLink: "https://drive.example/sig",
      photoData: big,
      photoLink: "https://drive.example/photo",
      photo: only,
      docs: { sss: { s: "miss", link: "https://drive.example/sss" } },
      notes: "keep me",
    };
    const slim = ctx.employeePersist(emp);
    assert.equal(slim.sigData, undefined);
    assert.equal(slim.photoData, undefined);
    assert.equal(slim.photo, undefined);
    assert.equal(slim.sigLink, emp.sigLink);
    assert.equal(slim.notes, "keep me");
    assert.equal(slim.docs.sss.link, emp.docs.sss.link);
    assert.equal(emp.sigData, big);

    const linkedOnly = ctx.employeePersist({
      id: "e2",
      sigData: only,
      sigLink: "https://drive.example/only",
    });
    assert.equal(linkedOnly.sigData, undefined);
    assert.equal(linkedOnly.sigLink, "https://drive.example/only");

    const unique = ctx.employeePersist({ id: "e3", sigData: only });
    assert.equal(unique.sigData, only);

    const small = ctx.employeePersist({ id: "e4", sigData: "data:image/png;base64,QQ" });
    assert.equal(small.sigData, "data:image/png;base64,QQ");
  });

  it("uses the same government-number rule as the checklist", () => {
    const ctx = loadPersist();
    assert.equal(ctx.govNoFilled("09 - 4348404 - 2"), true);
    assert.equal(ctx.govNoFilled("663 - 590 - 790 - 000"), true);
    assert.equal(ctx.govNoFilled("20 - 251398879 - 8"), true);
    assert.equal(ctx.govNoFilled("1213 - 6105 - 3738"), true);
    assert.equal(ctx.govNoFilled("-"), false);
    assert.equal(ctx.govNoFilled("N/A"), false);
    assert.equal(ctx.govNoFilled(""), false);
    const e = { sssNo: "09 - 4348404 - 2", tinNo: "-", docs: {} };
    assert.equal(ctx.docShown(e, "sss", { s: "miss" }), "on");
    assert.equal(ctx.docShown(e, "tin", { s: "miss" }), "miss");
    assert.equal(ctx.docShown(e, "tin", { s: "on", link: "https://drive.example/tin" }), "on");
    assert.equal(ctx.docShown({ sssNo: "" }, "resume", { s: "miss" }), "miss");
    const stamped = ctx.empComplianceStamp(e);
    e.sssNo = "10 - 1";
    assert.notEqual(ctx.empComplianceStamp(e), stamped);
  });
});
