"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const checklist = require("../public/hr-201-checklist");

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

function extractConst(src, name) {
  const needle = "const " + name + " = ";
  const start = src.indexOf(needle);
  if (start < 0) throw new Error("missing " + name);
  const end = src.indexOf(";", start);
  if (end < 0) throw new Error("unclosed " + name);
  return src.slice(start, end + 1);
}

function load(names) {
  const gStart = html.indexOf("const GUESS = [");
  const gEnd = html.indexOf("/* Underscores, dashes, and accents");
  if (gStart < 0 || gEnd < gStart) throw new Error("GUESS block missing");
  const ctx = {
    TODAY: "2026-10-09",
    DOCS: [
      { k: "resume", n: "Resume / Biodata", g: "Recruitment" },
      { k: "tor", n: "TOR/Diploma", aka: "Transcript of Records or Diploma", g: "Recruitment", cond: 1 },
      { k: "certs", n: "Certificates", g: "Recruitment", cond: 1 },
    ],
    S: { settings: {}, db: null, employees: {}, onboarding: { keep: { id: "keep", items: { r001: { done: true } } } } },
    puts: [],
    async put(coll, id, obj) {
      ctx.puts.push({ coll, id, obj });
      ctx.S[coll][id] = obj;
      return true;
    },
    clone(o) {
      return JSON.parse(JSON.stringify(o));
    },
    async getMcp() {
      return null;
    },
    async uploadToDrive() {
      throw new Error("Drive should not be called when it is not connected");
    },
    async fileToDataUrl(file) {
      return "data:" + (file.type || "application/octet-stream") + ";base64," + String(file.body || "");
    },
    MAX_UPLOAD_MB: 80,
  };
  const src =
    extractConst(html, "INLINE_LOCAL_MAX") +
    "\n" +
    extractConst(html, "CHECKLIST_INLINE_MAX") +
    "\n" +
    html.slice(gStart, gEnd) +
    "\n" +
    names.map((n) => extractFunction(html, n)).join("\n");
  vm.runInNewContext(src, ctx);
  return ctx;
}

const NAMES = [
  "isEphemeralUrl",
  "isHeavyDataUrl",
  "durableDriveUrl",
  "docFiles",
  "docSetFiles",
  "docAddLink",
  "copyDocMap",
  "docSlotBlank",
  "docSlotStamp",
  "docSlotScore",
  "mergeDocLinks",
  "laterIso",
  "mergeDocSlot",
  "mergeChecklistDocs",
  "foldFileName",
  "fileMentionsEmployee",
  "guessDoc",
  "blankDocs",
  "checklistFileOk",
  "storeChecklistFile",
  "checklistSlot",
  "attachChecklistFiles",
  "shedDocSlotLocal",
];

describe("2026-10-09a TOR/Diploma onboarding requirement", () => {
  it("is build 2026-10-09a and keeps one tor row named TOR/Diploma", () => {
    assert.match(html, /const BUILD = "2026-10-09a"/);
    assert.equal(html.match(/k:"tor"/g).length, 1);
    assert.match(html, /n:"TOR\/Diploma", aka:"Transcript of Records or Diploma"/);
    assert.match(html, /Onboarding requirements/);
    assert.match(html, /onboardingRequirementBlock\(e\)/);
    assert.match(extractFunction(html, "pickFor"), /el\.multiple=true/);
    assert.match(extractFunction(html, "attachChecklistFiles"), /docAddLink\(/);
    assert.doesNotMatch(extractFunction(html, "attachChecklistFiles"), /onboarding/);
    assert.doesNotMatch(extractFunction(html, "checklistSlot"), /c\.docs\s*=\s*\[\s*\]/);
  });

  it("renames an existing TOR or Transcript row in place and does not add a second one", () => {
    const docs = [
      { k: "resume", n: "Resume / Biodata", g: "Recruitment" },
      { k: "tor", n: "TOR", g: "Recruitment", cond: 1 },
      { k: "tor", n: "Transcript", g: "Recruitment" },
      { k: "certs", n: "Certificates", g: "Recruitment", cond: 1 },
    ];
    checklist.ensureCatalog(docs);
    const tors = docs.filter((d) => d.k === "tor");
    assert.equal(tors.length, 1);
    assert.equal(tors[0].n, "TOR/Diploma");
    assert.equal(tors[0].aka, "Transcript of Records or Diploma");
    assert.equal(tors[0].cond, 1);
    assert.equal(docs.find((d) => d.k === "certs").n, "Certificates");
    const before = docs.length;
    checklist.ensureCatalog(docs);
    assert.equal(docs.filter((d) => d.k === "tor").length, 1);
    assert.equal(docs.length, before);
  });

  it("does not invent a tor row on a catalog that never had one", () => {
    const docs = checklist.ensureCatalog([{ k: "resume", n: "Resume / Biodata", g: "Recruitment" }]);
    assert.equal(docs.filter((d) => d.k === "tor").length, 0);
  });

  it("files a transcript or diploma on tor and leaves a training certificate on Certificates", () => {
    const ctx = load(NAMES);
    const emp = { empNo: "1269", name: "Monte, Domingo C." };
    assert.equal(ctx.guessDoc("tor diploma - Domingo Monte Jr.JPG", emp), "tor");
    assert.equal(ctx.guessDoc("TOR.pdf", emp), "tor");
    assert.equal(ctx.guessDoc("Transcript of Records.pdf", emp), "tor");
    assert.equal(ctx.guessDoc("Diploma.jpg", emp), "tor");
    assert.equal(ctx.guessDoc("Certificate of Training.pdf", emp), "certs");
    assert.equal(ctx.guessDoc("OJT certificate.pdf", emp), "certs");
  });

  it("keeps stored tor scans when a shared snapshot arrives empty", () => {
    const ctx = load(NAMES);
    const jpg = "https://drive.google.com/file/d/TORJPG/view";
    const pdf = "/.netlify/functions/files?path=" + encodeURIComponent("201/1269/tor.pdf");
    const local = {
      resume: { s: "on", link: "https://drive.google.com/file/d/CV/view", links: [], filed: "2023-10-09", expiry: "" },
      tor: {
        s: "on",
        link: jpg,
        links: [
          { url: jpg, title: "tor diploma - Domingo Monte Jr.JPG", on: "2026-10-09" },
          { url: pdf, title: "Diploma.pdf", on: "2026-10-09" },
        ],
        filed: "2026-10-09",
        expiry: "",
      },
    };
    const merged = ctx.mergeChecklistDocs(local, {});
    assert.equal(merged.docs.resume.s, "on");
    assert.equal(merged.docs.resume.link, "https://drive.google.com/file/d/CV/view");
    const files = ctx.docFiles(merged.docs.tor).map((x) => x.url).sort();
    assert.deepEqual(JSON.parse(JSON.stringify(files)), [jpg, pdf].sort());
    assert.equal(merged.docs.tor.s, "on");
    const naSnap = ctx.mergeDocSlot(local.tor, { s: "na", link: "", links: [], filed: "", expiry: "" });
    assert.equal(ctx.docFiles(naSnap).length, 2);
    assert.equal(naSnap.s, "on");
  });

  it("attaches more than one scan to tor without clearing the rest of the 201", async () => {
    const ctx = load(NAMES);
    const onboardingBefore = JSON.stringify(ctx.S.onboarding);
    ctx.S.employees.e1269 = {
      id: "e1269",
      empNo: "1269",
      name: "Monte, Domingo C.",
      docs: {
        resume: {
          s: "on",
          link: "https://drive.google.com/file/d/CV/view",
          links: [{ url: "https://drive.google.com/file/d/CV/view", title: "CV", on: "2023-10-09" }],
          filed: "2023-10-09",
          expiry: "",
        },
        tor: { s: "na", link: "", links: [], filed: "", expiry: "" },
      },
    };
    const stored = await ctx.attachChecklistFiles("e1269", "tor", [
      { name: "tor diploma - Domingo Monte Jr.JPG", type: "image/jpeg", size: 80, body: "QQ" },
      { name: "Diploma.pdf", type: "application/pdf", size: 90, body: "UU" },
    ]);
    assert.equal(stored.length, 2);
    const emp = ctx.S.employees.e1269;
    assert.equal(emp.docs.resume.link, "https://drive.google.com/file/d/CV/view");
    assert.equal(emp.docs.resume.s, "on");
    assert.equal(emp.docs.tor.s, "on");
    assert.equal(emp.docs.tor.filed, "2026-10-09");
    const titles = ctx.docFiles(emp.docs.tor).map((x) => x.title).sort();
    assert.deepEqual(JSON.parse(JSON.stringify(titles)), ["Diploma.pdf", "tor diploma - Domingo Monte Jr.JPG"]);
    assert.equal(ctx.puts.length, 2);
    assert.equal(ctx.puts[0].coll, "employees");
    assert.equal(JSON.stringify(ctx.S.onboarding), onboardingBefore);
    assert.equal(Object.keys(ctx.S.onboarding.keep.items).length, 1);
  });

  it("does not replace a saved checklist with a blank one when only tor is new", () => {
    const ctx = load(NAMES);
    const emp = {
      id: "e1",
      docs: {
        resume: { s: "on", link: "https://drive.google.com/file/d/CV/view", links: [], filed: "2024-01-01" },
      },
    };
    const c = ctx.checklistSlot(emp, "tor");
    assert.equal(c.docs.resume.s, "on");
    assert.equal(c.docs.resume.link, "https://drive.google.com/file/d/CV/view");
    assert.equal(c.docs.tor.s, "miss");
    assert.equal(c.docs.tor.links.length, 0);
  });

  it("keeps a modest inline scan in this browser until the shared row has it", () => {
    const ctx = load(NAMES);
    const url = "data:image/jpeg;base64," + "A".repeat(3000);
    const slot = { s: "on", link: url, links: [{ url, title: "scan.jpg", on: "2026-10-09" }], filed: "2026-10-09", expiry: "" };
    const kept = ctx.shedDocSlotLocal(slot, false);
    assert.equal(ctx.docFiles(kept)[0].url, url);
    assert.equal(kept.title, "scan.jpg");
    const shed = ctx.shedDocSlotLocal(slot, true);
    assert.equal(ctx.docFiles(shed).length, 0);
    const huge = "data:image/jpeg;base64," + "B".repeat(200000);
    const dropped = ctx.shedDocSlotLocal(
      { s: "on", link: huge, links: [{ url: huge, title: "big.jpg" }], filed: "2026-10-09" },
      false
    );
    assert.equal(ctx.docFiles(dropped).length, 0);
  });

  it("refuses an oversized scan when Drive is not connected", async () => {
    const ctx = load(NAMES);
    await assert.rejects(
      () =>
        ctx.storeChecklistFile(
          { id: "e1269", empNo: "1269" },
          "tor",
          { name: "big.jpg", type: "image/jpeg", size: 200 * 1024, body: "Z" }
        ),
      (err) => err.code === "bad_request" && /120 KB/.test(err.message)
    );
  });
});
