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

function loadSigs() {
  const ctx = {
    S: { settings: {}, employees: {}, ui: {}, templates: {} },
    TODAY: "2026-09-24",
    toasts: [],
    toast(msg, kind) {
      ctx.toasts.push({ msg: msg, kind: kind });
    },
    dailyGet() {
      return null;
    },
    esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    },
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
    },
    flipName(n) {
      const p = String(n || "").split(",");
      return p.length > 1 ? p[1].trim() + " " + p[0].trim() : String(n || "");
    },
  };
  ctx.nameLastFirst = function (n) {
    const s = String(n || "").trim();
    if (s.indexOf(",") >= 0) {
      const p = s.split(",");
      return { last: p[0].trim(), first: p.slice(1).join(",").trim() };
    }
    const parts = s.split(/\s+/);
    return { last: parts[parts.length - 1] || "", first: parts.slice(0, -1).join(" ") };
  };
  const names = [
    "hrSigSrc",
    "foldSigName",
    "hrSigSlotDefs",
    "matchHrSigFilename",
    "hrStaffName",
    "namesClose",
    "signatorySig",
    "cassieSig",
    "sigBlob",
    "employeeSigLine",
    "leaveCaEvaluators",
    "findHrSig",
    "leaveCaSig",
    "companySigForColumn",
    "companySigForChain",
    "companySigForPlain",
    "companyPrintBlocked",
    "blockCompanyPrint",
    "templateCompanySigNeeds",
    "pfSign",
    "pfSignPlain",
    "memoChain",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function fullSettings() {
  return {
    hrStaff: "Maria Trina Cassandra A. Moran",
    hrHead: "Domingo C. Monte Jr.",
    hrTitle: "HR Officer",
    payrollBy: "Catherine A. Largo",
    payrollTitle: "Safety Officer",
    financeHead: "",
    financeTitle: "Finance Officer",
    signatory: "Jeffrey James M. Corro",
    signatoryTitle: "CEO / President",
    president: "Jeffrey James M. Corro",
    presidentTitle: "CEO / President",
    adminHead: "Marian U. Corro",
    adminTitle: "Administrative Head",
    hrSigs: {
      cassie: { data: "data:image/png;base64,CASSIE", title: "cassie.jpg", slot: "cassie" },
      prepared: { data: "data:image/png;base64,PREP", title: "prepared.jpg", slot: "prepared" },
      approved: { data: "data:image/png;base64,DOMINGO", title: "domingo.jpg", slot: "approved" },
      evaluated: { data: "data:image/png;base64,CATHERINE", title: "catherine.jpg", slot: "evaluated" },
      signatory: { data: "data:image/png;base64,JEFFREY", title: "jeffrey.jpg", slot: "signatory" },
    },
  };
}

describe("HR e-signatures on printable forms", () => {
  it("gives Cassie her own slot and keeps the other filename matches", () => {
    const ctx = loadSigs();
    ctx.S.settings = fullSettings();
    ctx.S.employees = {};
    assert.equal(ctx.matchHrSigFilename("cassie.jpg").slot, "cassie");
    assert.equal(ctx.matchHrSigFilename("casey.png").slot, "cassie");
    assert.equal(ctx.matchHrSigFilename("daily-manpower.jpg").slot, "cassie");
    assert.equal(ctx.matchHrSigFilename("attendance.jpg").slot, "cassie");
    assert.equal(ctx.matchHrSigFilename("moran.jpg").slot, "cassie");
    assert.equal(ctx.matchHrSigFilename("prepared.jpg").slot, "prepared");
    assert.equal(ctx.matchHrSigFilename("domingo.jpg").slot, "approved");
    assert.equal(ctx.matchHrSigFilename("catherine.jpg").slot, "evaluated");
    assert.equal(ctx.matchHrSigFilename("jeffrey.jpg").slot, "signatory");
    const cassie = ctx.hrSigSlotDefs().find((s) => s.k === "cassie");
    assert.ok(cassie);
    assert.ok(cassie.aliases.includes("casey"));
    assert.ok(cassie.aliases.includes("manpower"));
    assert.equal(ctx.cassieSig(), "data:image/png;base64,CASSIE");
    assert.notEqual(ctx.cassieSig(), "data:image/png;base64,PREP");
    assert.notEqual(ctx.leaveCaSig("dept"), "data:image/png;base64,CASSIE");
  });

  it("still finds an older Cassie file that was stored on Prepared by", () => {
    const ctx = loadSigs();
    ctx.S.settings = fullSettings();
    delete ctx.S.settings.hrSigs.cassie;
    assert.equal(ctx.cassieSig(), "data:image/png;base64,PREP");
    const miss = ctx.companyPrintBlocked(["cassie"]);
    assert.equal(miss, "");
  });

  it("blocks Daily Manpower print until Cassie is attached, and names the filename", () => {
    const ctx = loadSigs();
    ctx.S.settings = fullSettings();
    delete ctx.S.settings.hrSigs.cassie;
    delete ctx.S.settings.hrSigs.prepared;
    const miss = ctx.companyPrintBlocked(["cassie"]);
    assert.match(miss, /Cannot print this/);
    assert.match(miss, /Cassie \(Maria Trina Cassandra A\. Moran\)/);
    assert.match(miss, /cassie, casey, moran, manpower, or attendance/);
    assert.match(miss, /Settings → HR e-signatures/);
    assert.equal(ctx.blockCompanyPrint(["cassie"]), true);
    assert.match(html, /function printDaily[\s\S]{0,400}blockCompanyPrint\(\["cassie"\]\)/);
    assert.match(html, /data-hrsig-slot/);
    assert.match(html, /const BUILD = "2026-09-24d"/);
  });

  it("stamps company lines and leaves the employee, supervisor, finance image, and final approval blank", () => {
    const ctx = loadSigs();
    ctx.S.settings = fullSettings();
    const sheet = ctx.pfSign([
      { who: "Immediate Supervisor", name: "Site Lead", role: "Signature" },
      { who: "Employee (Ratee)", name: "Ana Cruz", role: "Signature over printed name" },
      { who: "Received by", name: "Ana Cruz", role: "Signature over printed name" },
      { who: "Evaluated by", name: "Catherine A. Largo", role: "Safety Officer" },
      { who: "Department Head", name: "Domingo C. Monte Jr.", role: "HR Officer" },
      { who: "Finance", name: "", role: "Finance Officer", missing: "Finance officer name — Settings" },
      { who: "Approved by", name: "Jeffrey James M. Corro", role: "CEO / President" },
      { who: "Final Approval (Management)", name: "Jeffrey James M. Corro", role: "Signature" },
    ]);
    assert.match(sheet, /Finance officer name — Settings/);
    const inks = sheet.match(/<td class="ink">[\s\S]*?<\/td>/g);
    assert.equal(inks.length, 8);
    assert.doesNotMatch(inks[0], /base64/);
    assert.doesNotMatch(inks[1], /base64/);
    assert.doesNotMatch(inks[2], /base64/);
    assert.match(inks[3], /base64,CATHERINE/);
    assert.match(inks[4], /base64,DOMINGO/);
    assert.doesNotMatch(inks[5], /base64/);
    assert.doesNotMatch(inks[6], /base64/);
    assert.doesNotMatch(inks[7], /base64/);

    const payroll = ctx.pfSign([
      { who: "Prepared by", name: "Catherine A. Largo", role: "Safety Officer" },
      { who: "Approved by", name: "Jeffrey James M. Corro", role: "CEO / President", stampFinal: true },
      { who: "Received by", name: "Ana Cruz", role: "Signature over printed name" },
    ]);
    const payInks = payroll.match(/<td class="ink">[\s\S]*?<\/td>/g);
    assert.match(payInks[0], /base64,CATHERINE/);
    assert.match(payInks[1], /base64,JEFFREY/);
    assert.doesNotMatch(payInks[2], /base64/);
  });

  it("stamps COE, memos and Daily Manpower on the company lines only", () => {
    const ctx = loadSigs();
    ctx.S.settings = fullSettings();
    const coe = ctx.memoChain([
      ["Prepared by:", "Domingo C. Monte Jr.", "HR"],
      ["Approved by:", "Marian U. Corro", "Admin Head / Corp. Secretary"],
      ["Noted by:", "Jeffrey James M. Corro", "CEO"],
    ]);
    assert.match(coe, /base64,DOMINGO/);
    assert.match(coe, /base64,JEFFREY/);
    const admin = coe.slice(coe.indexOf("Approved by:"), coe.indexOf("Noted by:"));
    assert.doesNotMatch(admin, /<img /);

    const memo = ctx.memoChain([
      ["Prepared by:", "Maria Trina Cassandra A. Moran", "HR Staff"],
      ["Confirmed by:", "Domingo C. Monte Jr.", "HR Dept. Head"],
      ["Noted by:", "Marian U. Corro", "Administrative Head / Corp. Secretary"],
      ["Conformed:", "Jeffrey James M. Corro", "CEO"],
    ]);
    assert.ok(memo.indexOf("base64,CASSIE") < memo.indexOf("base64,DOMINGO"));
    assert.ok(memo.indexOf("base64,DOMINGO") < memo.indexOf("base64,JEFFREY"));
    const noted = memo.slice(memo.indexOf("Noted by:"), memo.indexOf("Conformed:"));
    assert.doesNotMatch(noted, /<img /);

    const daily = ctx.memoChain([
      ["Prepared by:", "Maria Trina Cassandra A. Moran", "HR Staff", ctx.cassieSig()],
      ["Approved by:", "Domingo C. Monte Jr.", "HR Officer", ctx.leaveCaSig("dept")],
    ]);
    assert.match(daily, /base64,CASSIE/);
    assert.match(daily, /base64,DOMINGO/);
    assert.doesNotMatch(daily, /base64,JEFFREY/);
  });

  it("stamps contract and NTE company lines and leaves the employee, witness and notary blank", () => {
    const ctx = loadSigs();
    ctx.S.settings = fullSettings();
    const parties = ctx.pfSignPlain([
      ["Jeffrey James M. Corro", "CEO / Corporate President — for the COMPANY"],
      ["Ana Cruz", "Name of Employee — the EMPLOYEE"],
    ]);
    assert.doesNotMatch(parties, /base64/);

    const hr = ctx.pfSignPlain([["Domingo C. Monte Jr.", "HR Officer"]]);
    assert.match(hr, /base64,DOMINGO/);

    const nte = ctx.pfSignPlain([
      ["Domingo C. Monte Jr.", "Immediate Supervisor / HR"],
      ["Ana Cruz", "Employee — signature over printed name and date received"],
    ]);
    assert.match(nte, /base64,DOMINGO/);
    const emp = nte.slice(nte.indexOf("Ana Cruz"));
    assert.doesNotMatch(emp, /base64/);

    const quit = ctx.pfSignPlain([["Ana Cruz", "Affiant"]]);
    assert.doesNotMatch(quit, /base64/);
    const witnesses = ctx.pfSignPlain([
      ["", "Witness"],
      ["", "NOTARY PUBLIC"],
    ]);
    assert.doesNotMatch(witnesses, /base64/);

    const needs = (body) => Array.from(ctx.templateCompanySigNeeds(body));
    assert.deepEqual(needs("@SIGN {{FULL_NAME}}|Affiant"), []);
    assert.deepEqual(
      needs("@SIGN {{PRESIDENT}}|CEO / Corporate President — for the COMPANY ;; {{FULL_NAME}}|Name of Employee — the EMPLOYEE"),
      []
    );
    assert.deepEqual(needs("@SIGN {{HR_HEAD}}|{{HR_TITLE}}"), ["dept"]);
    assert.deepEqual(
      needs("@SIGN {{HR_HEAD}}|Immediate Supervisor / HR\n@SIGN {{FULL_NAME}}|Employee"),
      ["dept"]
    );
  });

  it("does not require the employee when a company signatory is missing", () => {
    const ctx = loadSigs();
    ctx.S.settings = fullSettings();
    delete ctx.S.settings.hrSigs.approved;
    const miss = ctx.companyPrintBlocked(["dept"]);
    assert.match(miss, /Department Head — Domingo C\. Monte Jr\./);
    assert.match(miss, /domingo, monte, hr-head, or approved/);
    assert.doesNotMatch(miss, /employee/i);
    assert.doesNotMatch(miss, /Ana Cruz/);
    const clearance = ctx.pfSign([
      { who: "Certified by", name: "Domingo C. Monte Jr.", role: "HR Manager / Authorized Signature" },
    ]);
    assert.doesNotMatch(clearance, /base64/);
    ctx.S.settings.hrSigs.approved = fullSettings().hrSigs.approved;
    const stamped = ctx.pfSign([
      { who: "Certified by", name: "Domingo C. Monte Jr.", role: "HR Manager / Authorized Signature" },
      { who: "Employee", name: "Ana Cruz", role: "Signature over printed name and date" },
    ]);
    const inks = stamped.match(/<td class="ink">[\s\S]*?<\/td>/g);
    assert.match(inks[0], /base64,DOMINGO/);
    assert.doesNotMatch(inks[1], /base64/);
  });
});
