"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");
const checklist = require("../public/hr-201-checklist");

const BASE_DOCS = [
  { k: "resume", n: "Resume / Biodata", g: "Recruitment" },
  { k: "govid", n: "Gov / Valid ID", g: "Identification" },
  { k: "brgy", n: "Barangay / Police Clearance", g: "Clearances", exp: 1 },
  { k: "sss", n: "SSS", g: "Statutory" },
  { k: "hdmf", n: "Pag-IBIG", g: "Statutory" },
  { k: "phic", n: "PhilHealth", g: "Statutory" },
  { k: "tin", n: "TIN", g: "Statutory" },
  { k: "contract", n: "Employment Contract", g: "Employment" },
  { k: "benefack", n: "Gov Benefit Deduction — acknowledged", g: "Employment" },
  { k: "leaveform", n: "Leave Request Form", g: "Records on file", opt: 1 },
  { k: "resign", n: "Resignation Letter", g: "Separation", opt: 1 },
  { k: "resignacc", n: "Acceptance of Resignation", g: "Separation", opt: 1 },
  { k: "exitint", n: "Exit Interview", g: "Separation", opt: 1 },
  { k: "notterm", n: "Notice of Termination", g: "Separation", opt: 1 },
  { k: "clearance", n: "Employee Clearance Form", g: "Separation", opt: 1 },
  { k: "govrefuse", n: "Refusal of Government-mandated Deductions", g: "Statutory", opt: 1 },
];

function emp(extra) {
  return Object.assign(
    {
      id: "e1",
      empNo: "1401",
      name: "Nuevo, Ana",
      status: "Regular",
      docs: {},
    },
    extra || {}
  );
}

function on(keys) {
  const docs = {};
  (keys || []).forEach((k) => {
    docs[k] = { s: "on", link: "", links: [], filed: "2026-09-01" };
  });
  return docs;
}

describe("hr-201-checklist companion wiring", () => {
  it("is loaded by the shim and not referenced from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-201-checklist\.js/);
    assert.match(shim, /data-hr-201-checklist/);
    assert.ok(shim.indexOf("hr-201-file.js") < shim.indexOf("hr-201-checklist.js"));
    assert.doesNotMatch(html, /hr-201-checklist\.js/);
  });

  it("loads onto window.hr201Checklist", () => {
    const src = fs.readFileSync(path.join(__dirname, "../public/hr-201-checklist.js"), "utf8");
    const w = { window: {}, document: undefined };
    w.window = w;
    vm.runInNewContext(src, w);
    assert.equal(typeof w.hr201Checklist.complianceOf, "function");
    assert.ok(w.hr201Checklist.EXTRA_DOCS.some((d) => d.k === "nbi"));
  });
});

describe("201 categories Cassie asked for", () => {
  it("appends COE (CCD), COE (from employee), requirement checklist, and NBI, and keeps one refusal row", () => {
    const docs = checklist.ensureCatalog(
      BASE_DOCS.concat([
        { k: "kasabutan", n: "KASABUTAN sa dili pagperma sa Government Mandated Benefits", g: "Statutory" },
      ]).slice()
    );
    const keys = docs.map((d) => d.k);
    assert.ok(keys.includes("coeccd"));
    assert.ok(keys.includes("coeemp"));
    assert.ok(keys.includes("reqcheck"));
    assert.ok(keys.includes("nbi"));
    assert.equal(keys.filter((k) => k === "govrefuse" || k === "kasabutan").length, 1);
    assert.equal(docs.find((d) => d.k === "coeccd").n, "COE (CCD)");
    assert.equal(docs.find((d) => d.k === "coeemp").n, "COE (from employee)");
    assert.equal(docs.find((d) => d.k === "govrefuse").n, "Refusal of Government-mandated Deductions (Kasabutan)");
    assert.equal(docs.find((d) => d.k === "govrefuse").opt, undefined);
    assert.equal(docs.find((d) => d.k === "nbi").g, "Clearances");
    assert.equal(docs.find((d) => d.k === "nbi").n, "NBI Clearance");
  });

  it("does not duplicate keys when ensureCatalog runs twice", () => {
    const docs = checklist.ensureCatalog(BASE_DOCS.slice());
    const n = docs.length;
    checklist.ensureCatalog(docs);
    assert.equal(docs.length, n);
    assert.equal(docs.filter((d) => d.k === "nbi").length, 1);
  });

  it("ships the new rows on the live artifact DOCS list", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /k:"coeccd"/);
    assert.match(html, /COE \(CCD\)/);
    assert.match(html, /k:"coeemp"/);
    assert.match(html, /COE \(from employee\)/);
    assert.match(html, /k:"reqcheck"/);
    assert.match(html, /Employee requirement checklist/);
    assert.match(html, /k:"govrefuse"/);
    assert.match(html, /Refusal of Government-mandated Deductions \(Kasabutan\)/);
    assert.doesNotMatch(html, /k:"kasabutan"/);
    assert.match(html, /k:"nbi"/);
    assert.match(html, /NBI Clearance/);
    assert.match(html, /on\("nbi"\)/);
    assert.match(html, /on\("coeccd"\)/);
  });
});

describe("201 completion percentage — N/A counts", () => {
  it("counts N/A and NA as complete, not as excluded from the denominator", () => {
    const e = emp({
      docs: {
        resume: { s: "on" },
        govid: { s: "na" },
        brgy: { s: "NA" },
        sss: { s: "N/A" },
        hdmf: { s: "miss" },
        phic: { s: "on" },
        tin: { s: "n.a." },
        contract: { s: "on" },
        benefack: { s: "on" },
      },
    });
    const c = checklist.complianceOf(e, BASE_DOCS);
    assert.ok(c.need >= 9);
    assert.deepEqual(
      c.missing.map((d) => d.k),
      ["hdmf"]
    );
    assert.ok(c.na >= 4);
    assert.ok(c.have > c.onFile);
    assert.ok(c.pct > 50);
    assert.ok(c.pct < 100);
  });

  it("counts the new Cassie categories when they sit on the live catalog", () => {
    const docs = checklist.ensureCatalog(BASE_DOCS.slice());
    const e = emp({
      docs: Object.fromEntries(docs.map((d) => [d.k, { s: d.g === "Separation" ? "na" : "on" }])),
    });
    const c = checklist.complianceOf(e, docs);
    assert.ok(docs.some((d) => d.k === "nbi"));
    assert.equal(c.missing.length, 0);
    assert.equal(c.pct, 100);
  });

  it("does not drop a required row that is marked N/A from need", () => {
    const allNa = emp({
      docs: Object.fromEntries(BASE_DOCS.filter((d) => !d.opt || d.g === "Separation").map((d) => [d.k, { s: "na" }])),
    });
    const c = checklist.complianceOf(allNa, BASE_DOCS);
    assert.equal(c.missing.length, 0);
    assert.equal(c.pct, 100);
    assert.ok(c.need > 0);
    assert.equal(c.have, c.need);
  });
});

describe("201 completion percentage — Separations when not Separated", () => {
  it("treats the Separations section as N/A and counts it for an active employee", () => {
    const requiredOn = ["resume", "govid", "brgy", "sss", "hdmf", "phic", "tin", "contract", "benefack"];
    const e = emp({ status: "Project-based", docs: on(requiredOn) });
    const c = checklist.complianceOf(e, BASE_DOCS);
    const sep = BASE_DOCS.filter((d) => d.g === "Separation");
    assert.ok(sep.length >= 4);
    assert.ok(c.need >= requiredOn.length + sep.length);
    assert.equal(c.missing.length, 0);
    assert.equal(c.pct, 100);
    assert.ok(c.na >= sep.length);
  });

  it("keeps Separations outstanding once the person is Separated", () => {
    const e = emp({
      status: "Separated",
      docs: on(["resume", "govid", "brgy", "sss", "hdmf", "phic", "tin", "contract", "benefack"]),
    });
    const c = checklist.complianceOf(e, BASE_DOCS);
    assert.ok(c.missing.some((d) => d.k === "resign"));
    assert.ok(c.missing.some((d) => d.k === "clearance"));
    assert.ok(c.pct < 100);
  });

  it("writes N/A onto empty Separation rows for an active employee", () => {
    const e = emp({ status: "Regular", docs: {} });
    checklist.applyActiveSeparations(e, BASE_DOCS);
    assert.equal(e.docs.resign.s, "na");
    assert.equal(e.docs.clearance.s, "na");
    e.docs.resign.s = "on";
    e.docs.resign.link = "https://drive.example/resign";
    checklist.applyActiveSeparations(e, BASE_DOCS);
    assert.equal(e.docs.resign.s, "on");
  });
});

describe("refusal attachment completes statutory rows", () => {
  it("marks SSS / Pag-IBIG / PhilHealth / TIN on when the refusal row has a file", () => {
    const e = emp({
      docs: {
        govrefuse: { s: "on", link: "https://drive.example/kasabutan.pdf", links: [{ url: "https://drive.example/kasabutan.pdf" }] },
        sss: { s: "miss" },
        hdmf: { s: "miss" },
        phic: { s: "miss" },
        tin: { s: "miss" },
      },
    });
    checklist.applyRefusalToStatutory(e, "2026-09-18");
    assert.equal(e.docs.sss.s, "on");
    assert.equal(e.docs.hdmf.s, "on");
    assert.equal(e.docs.phic.s, "on");
    assert.equal(e.docs.tin.s, "on");
    assert.equal(e.docs.sss.filed, "2026-09-18");
    const c = checklist.complianceOf(e, BASE_DOCS);
    assert.ok(!c.missing.some((d) => ["sss", "hdmf", "phic", "tin"].includes(d.k)));
  });

  it("does the same when the KASABUTAN row holds the attachment", () => {
    const e = emp({
      docs: {
        kasabutan: { s: "miss", links: [{ url: "https://drive.example/kasabutan.jpg" }] },
        sss: { s: "miss" },
        tin: { s: "exp" },
      },
    });
    checklist.applyRefusalToStatutory(e, "2026-09-18");
    assert.equal(e.docs.sss.s, "on");
    assert.equal(e.docs.tin.s, "on");
    assert.equal(e.docs.kasabutan, undefined);
    assert.ok(checklist.hasAttachment(e.docs.govrefuse));
    assert.equal(e.docs.govrefuse.s, "on");
    assert.equal(e.docs.govrefuse.filed, "2026-09-18");
  });

  it("keeps both links and the fuller status when both old rows have data", () => {
    const e = emp({
      docs: {
        govrefuse: {
          s: "on",
          link: "https://drive.example/gov.pdf",
          links: [{ url: "https://drive.example/gov.pdf", title: "Refusal" }],
          filed: "2026-08-01",
        },
        kasabutan: {
          s: "miss",
          link: "https://drive.example/kasa.jpg",
          links: [{ url: "https://drive.example/kasa.jpg", title: "Kasabutan" }],
          filed: "2026-09-02",
        },
      },
    });
    checklist.mergeGovRefusal(e);
    assert.equal(e.docs.kasabutan, undefined);
    assert.equal(e.docs.govrefuse.s, "on");
    assert.equal(e.docs.govrefuse.filed, "2026-08-01");
    assert.equal(e.docs.govrefuse.link, "https://drive.example/gov.pdf");
    assert.deepEqual(
      e.docs.govrefuse.links.map((x) => x.url).sort(),
      ["https://drive.example/gov.pdf", "https://drive.example/kasa.jpg"].sort()
    );
  });

  it("moves a date and file that exist only on KASABUTAN onto the merged row", () => {
    const e = emp({
      docs: {
        govrefuse: { s: "miss", link: "", links: [] },
        kasabutan: {
          s: "na",
          link: "https://drive.example/only-kasa.pdf",
          links: [{ url: "https://drive.example/only-kasa.pdf" }],
          filed: "2026-09-03",
        },
      },
    });
    checklist.mergeGovRefusal(e);
    assert.equal(e.docs.kasabutan, undefined);
    assert.equal(e.docs.govrefuse.s, "na");
    assert.equal(e.docs.govrefuse.filed, "2026-09-03");
    assert.equal(e.docs.govrefuse.link, "https://drive.example/only-kasa.pdf");
  });

  it("counts the refusal once even when the catalog still lists both old rows", () => {
    const docs = [
      { k: "resume", n: "Resume / Biodata", g: "Recruitment" },
      { k: "govrefuse", n: "Refusal of Government-mandated Deductions", g: "Statutory", opt: 1 },
      { k: "kasabutan", n: "KASABUTAN sa dili pagperma sa Government Mandated Benefits", g: "Statutory" },
    ];
    const empty = emp({ docs: { resume: { s: "on" } } });
    const missing = checklist.complianceOf(empty, docs);
    const refusal = missing.missing.filter((d) => d.k === "govrefuse" || d.k === "kasabutan");
    assert.equal(refusal.length, 1);
    assert.equal(refusal[0].k, "govrefuse");
    assert.equal(refusal[0].n, "Refusal of Government-mandated Deductions (Kasabutan)");
    assert.equal(missing.need, 2);

    const filed = emp({
      docs: {
        resume: { s: "on" },
        kasabutan: {
          s: "miss",
          link: "https://drive.example/kasa.pdf",
          links: [{ url: "https://drive.example/kasa.pdf" }],
          filed: "2026-09-01",
        },
      },
    });
    const done = checklist.complianceOf(filed, docs);
    assert.equal(done.missing.filter((d) => d.k === "govrefuse" || d.k === "kasabutan").length, 0);
    assert.equal(filed.docs.kasabutan.link, "https://drive.example/kasa.pdf");
    assert.equal(done.pct, 100);
  });

  it("does not mutate the live employee when only computing the percentage", () => {
    const e = emp({
      status: "Regular",
      docs: { resign: { s: "miss" }, sss: { s: "miss" } },
    });
    checklist.complianceOf(e, BASE_DOCS);
    assert.equal(e.docs.resign.s, "miss");
    assert.equal(e.docs.sss.s, "miss");
  });

  it("does not invent a statutory completion when the refusal row has no file", () => {
    const e = emp({
      docs: {
        govrefuse: { s: "on", link: "", links: [] },
        sss: { s: "miss" },
        hdmf: { s: "miss" },
        phic: { s: "miss" },
        tin: { s: "miss" },
      },
    });
    checklist.applyRefusalToStatutory(e);
    assert.equal(e.docs.sss.s, "miss");
    assert.equal(e.docs.tin.s, "miss");
  });

  it("leaves an already-on statutory row alone", () => {
    const e = emp({
      docs: {
        govrefuse: { s: "on", link: "https://drive.example/x" },
        sss: { s: "on", link: "https://drive.example/sss", filed: "2026-01-01" },
        hdmf: { s: "miss" },
      },
    });
    checklist.applyRefusalToStatutory(e, "2026-09-18");
    assert.equal(e.docs.sss.link, "https://drive.example/sss");
    assert.equal(e.docs.sss.filed, "2026-01-01");
    assert.equal(e.docs.hdmf.s, "on");
  });
});

describe("Drive filename guesses for the new rows", () => {
  it("routes NBI, KASABUTAN, COE, and the requirement checklist", () => {
    const guess = [
      [/barangay|police\s*clearance|\bnbi\b/i, "brgy"],
      [/contract|kasabutan|employment\s*agreement/i, "contract"],
    ];
    checklist.ensureGuess(guess);
    function hit(name) {
      const t = String(name).replace(/[_\-.]+/g, " ");
      for (const [re, k] of guess) if (re.test(t)) return k;
      return "";
    }
    assert.equal(hit("1401-NBI-Clearance.pdf"), "nbi");
    assert.equal(hit("1401 barangay clearance.pdf"), "brgy");
    assert.equal(hit("KASABUTAN sa dili pagperma.pdf"), "govrefuse");
    assert.equal(hit("Refusal of Government-mandated Deductions.pdf"), "govrefuse");
    assert.equal(hit("COE from employee - previous.pdf"), "coeemp");
    assert.equal(hit("COE CCD Pedrano.pdf"), "coeccd");
    assert.equal(hit("Employee Requirement Checklist R39.pdf"), "reqcheck");
  });
});
