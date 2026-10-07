"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ALLOWED_COLLECTIONS } = require("../netlify/lib/collections");

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

function loadOt() {
  const names = [
    "isEphemeralUrl",
    "isHeavyDataUrl",
    "durableDriveUrl",
    "otSiteKey",
    "otFileKey",
    "otFormFiles",
    "otFormUrl",
    "otAttachForm",
    "otApplyForms",
    "otMarkFromServer",
    "shedOtRequest",
    "mergeOtRequest",
    "otReqNeedsRepair",
    "otRequestCovers",
    "otCovered",
    "otHoursAllowed",
    "otPaidHours",
    "otPendingApplies",
  ];
  const ctx = {
    TODAY: "2026-10-07",
    S: { settings: { otPolicy: 1 }, otreqs: {}, employees: {} },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

const FORM = "https://drive.google.com/file/d/OTFORM1/view?usp=sharing";
const FORM2 = "https://drive.google.com/file/d/OTFORM2/view";
const HEAVY = "data:application/pdf;base64," + "A".repeat(3000);

describe("2026-10-07a OT forms stay on the request", () => {
  it("is build 2026-10-07a and the shared store accepts otreqs", () => {
    assert.match(html, /const BUILD = "2026-10-07c"/);
    assert.ok(ALLOWED_COLLECTIONS.includes("otreqs"));
    assert.ok(ALLOWED_COLLECTIONS.includes("payruns"));
    assert.match(html, /Every form attached to a request stays/);
    assert.match(html, /data-otopen=/);
    const sql = fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/20261007000001_hr_otreqs_payruns.sql"),
      "utf8"
    );
    assert.match(sql, /'otreqs'/);
    assert.match(sql, /'payruns'/);
    assert.match(sql, /on conflict \(name\) do nothing/);
  });

  it("keeps the file in the browser copy until the shared row has it", () => {
    const ctx = loadOt();
    const kept = ctx.shedOtRequest({
      id: "ot1",
      formUrl: HEAVY,
      formTitle: "OT Abainza.pdf",
      empIds: ["e1"],
    });
    assert.equal(kept.formUrl, HEAVY);
    assert.equal(kept.formTitle, "OT Abainza.pdf");
    const marked = { id: "ot1", formUrl: HEAVY, formTitle: "OT Abainza.pdf", forms: [] };
    ctx.otMarkFromServer(marked);
    const shed = ctx.shedOtRequest(marked);
    assert.equal(shed.formUrl, "");
    assert.equal(shed._formOnServer, undefined);
    assert.equal(shed.shared, 1);
    assert.equal(marked.formUrl, HEAVY);
  });

  it("adds a second file without dropping the first, and a blank snapshot drops neither", () => {
    const ctx = loadOt();
    const req = { id: "ot1", formUrl: FORM, formTitle: "File 1", forms: [] };
    const files = ctx.otAttachForm(req, FORM2, "File 2");
    assert.equal(files.length, 2);
    assert.equal(files[0].url, "https://drive.google.com/file/d/OTFORM1/view");
    assert.equal(files[1].url, FORM2);
    ctx.otApplyForms(req, files);
    const again = ctx.otAttachForm(req, FORM, "File 1");
    assert.equal(again.length, 2);

    const incoming = {
      id: "ot1",
      from: "",
      to: "",
      site: "",
      status: "",
      formUrl: "",
      forms: [],
      empIds: [],
      reason: "",
    };
    const local = Object.assign({}, req, {
      from: "2026-10-06",
      to: "2026-10-06",
      status: "Filed",
      empIds: ["e9"],
      reason: "pour",
    });
    const next = ctx.mergeOtRequest(local, incoming);
    assert.equal(ctx.otFormFiles(next).length, 2);
    assert.equal(next.formUrl, "https://drive.google.com/file/d/OTFORM1/view");
    assert.equal(next.status, "Filed");
    assert.equal(next.from, "2026-10-06");
    assert.equal(next.reason, "pour");
    assert.equal(ctx.otReqNeedsRepair(local, incoming), true);
    const same = ctx.mergeOtRequest(next, next);
    assert.equal(ctx.otFormFiles(same).length, 2);
    assert.equal(ctx.otReqNeedsRepair(next, next), false);
  });

  it("counts an approved form stored only in the file list, and still withholds pay without one", () => {
    const ctx = loadOt();
    ctx.S.otreqs = {
      ot1: {
        id: "ot1",
        from: "2026-10-06",
        to: "2026-10-06",
        site: "Danlag",
        wholeSite: false,
        empIds: ["e1"],
        status: "Approved",
        formUrl: "",
        forms: [{ url: FORM2, title: "File 2", on: "2026-10-06" }],
      },
    };
    assert.equal(ctx.otCovered("e1", "2026-10-06", "Danlag"), true);
    assert.equal(ctx.otPaidHours("e1", "2026-10-06", "Danlag", 3, "2026-10-07"), 3);
    ctx.S.otreqs.ot1 = Object.assign({}, ctx.S.otreqs.ot1, { status: "Filed" });
    assert.equal(ctx.otCovered("e1", "2026-10-06", "Danlag"), false);
    assert.equal(ctx.otPaidHours("e1", "2026-10-06", "Danlag", 3, "2026-10-07"), 0);
    assert.equal(ctx.otHoursAllowed("e1", "2026-10-06", "Danlag", null, 3), 3);
    ctx.S.otreqs = {};
    assert.equal(ctx.otPaidHours("e1", "2026-10-06", "Danlag", 3, "2026-10-07"), 0);
    assert.equal(ctx.otPaidHours("e1", "2026-09-30", "Danlag", 3, "2026-09-30"), 3);
  });
});
