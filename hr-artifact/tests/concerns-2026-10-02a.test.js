"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
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

function loadOt() {
  const names = [
    "isEphemeralUrl",
    "isHeavyDataUrl",
    "durableDriveUrl",
    "addDays",
    "weekStart",
    "otSiteKey",
    "otFormUrl",
    "shedOtRequest",
    "mergeOtRequest",
    "otReqNeedsRepair",
    "otRequestCovers",
    "otCovered",
    "otApprovedHours",
    "otSameHours",
    "otHoursAllowed",
    "otEachDate",
    "otHourlyOf",
    "otTrack",
    "otCsv",
  ];
  const ctx = {
    TODAY: "2026-10-02",
    S: { settings: { otPolicy: 1 }, otreqs: {}, daily: {}, employees: {} },
    isoDate(t) {
      return (
        t.getFullYear() +
        "-" +
        String(t.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(t.getDate()).padStart(2, "0")
      );
    },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

const FORM = "https://drive.google.com/file/d/OTFORM1/view?usp=sharing";

describe("2026-10-02a overtime requests", () => {
  it("is build 2026-10-02a and gates OT behind a filed request", () => {
    assert.match(html, /const BUILD = "2026-10-02a"/);
    assert.match(html, /\{k:"otreq",\s*n:"OT Requests"/);
    assert.match(html, /function viewOtRequests\(/);
    assert.match(html, /function otHoursAllowed\(/);
    assert.match(html, /No OT request on file for this date\/site/);
    assert.match(html, /data-otfile=/);
    assert.match(html, /no OT form/);
    assert.match(extractFunction(html, "dailyCollect"), /otHoursAllowed/);
    assert.match(extractFunction(html, "payLine"), /otNoForm/);
    assert.match(html, /otreqs/);
    assert.match(html, /"Filed","Approved","Rejected"/);
  });

  it("covers an approved request with a form, and keeps hours that have no form", () => {
    const ctx = loadOt();
    const whole = {
      id: "ot1",
      from: "2026-10-02",
      to: "2026-10-02",
      site: "Danlag",
      wholeSite: true,
      empIds: [],
      status: "Approved",
      formUrl: FORM,
      formTitle: "OT Danlag.pdf",
    };
    const named = {
      id: "ot2",
      from: "2026-10-02",
      to: "2026-10-03",
      site: "",
      wholeSite: false,
      empIds: ["e2"],
      status: "Approved",
      formUrl: FORM,
    };
    ctx.S.otreqs = { ot1: whole, ot2: named };
    assert.equal(ctx.otCovered("e1", "2026-10-02", "danlag"), true);
    assert.equal(ctx.otCovered("e9", "2026-10-02", "Danlag"), true);
    assert.equal(ctx.otCovered("e1", "2026-10-01", "Danlag"), false);
    assert.equal(ctx.otCovered("e1", "2026-10-02", "Tagba-o"), false);
    assert.equal(ctx.otCovered("e2", "2026-10-02", "Somewhere else"), true);
    assert.equal(ctx.otCovered("e3", "2026-10-02", "Somewhere else"), false);
    ctx.S.otreqs.ot1 = Object.assign({}, whole, { status: "Filed" });
    assert.equal(ctx.otCovered("e1", "2026-10-02", "Danlag"), false);
    ctx.S.otreqs.ot1 = Object.assign({}, whole, { status: "Rejected" });
    assert.equal(ctx.otCovered("e1", "2026-10-02", "Danlag"), false);
    ctx.S.otreqs.ot1 = Object.assign({}, whole, { status: "Approved", formUrl: "" });
    assert.equal(ctx.otCovered("e1", "2026-10-02", "Danlag"), false);
    ctx.S.otreqs.ot1 = Object.assign({}, whole, { formUrl: "blob:http://localhost/abc" });
    assert.equal(ctx.otCovered("e1", "2026-10-02", "Danlag"), false);
    ctx.S.otreqs.ot1 = whole;
    assert.equal(ctx.otHoursAllowed("e1", "2026-10-01", "Danlag", 4, 8), 4);
    assert.equal(ctx.otHoursAllowed("e1", "2026-10-01", "Danlag", null, 3), null);
    assert.equal(ctx.otHoursAllowed("e1", "2026-10-01", "Danlag", 4, 4), 4);
    assert.equal(ctx.otHoursAllowed("e1", "2026-10-02", "Danlag", 1, 3), 3);
    assert.equal(ctx.otHoursAllowed("e1", "2026-10-02", "Danlag", 2, null), null);
    assert.equal(ctx.otApprovedHours("e1", "2026-10-02", "Danlag"), null);
    ctx.S.otreqs.ot1 = Object.assign({}, whole, { hoursEach: 3 });
    assert.equal(ctx.otApprovedHours("e1", "2026-10-02", "Danlag"), 3);
  });

  it("keeps a form a blank snapshot dropped", () => {
    const ctx = loadOt();
    const local = {
      id: "ot1",
      from: "2026-10-02",
      to: "2026-10-02",
      site: "Danlag",
      wholeSite: true,
      status: "Approved",
      formUrl: FORM,
      formTitle: "File 1",
      empIds: ["e1"],
      hoursEach: 2,
      reason: "pour",
    };
    const incoming = {
      id: "ot1",
      from: "",
      to: "",
      site: "",
      status: "",
      formUrl: "",
      empIds: [],
      reason: "",
    };
    const next = ctx.mergeOtRequest(local, incoming);
    assert.equal(next.formUrl, "https://drive.google.com/file/d/OTFORM1/view");
    assert.equal(next.formTitle, "File 1");
    assert.equal(next.status, "Approved");
    assert.equal(next.from, "2026-10-02");
    assert.equal(next.site, "Danlag");
    assert.equal(next.reason, "pour");
    assert.deepEqual(Array.from(next.empIds), ["e1"]);
    assert.equal(next.hoursEach, 2);
    assert.equal(ctx.otReqNeedsRepair(local, incoming), true);
    const heavy = "data:application/pdf;base64," + "A".repeat(3000);
    const shed = ctx.shedOtRequest({ id: "ot9", formUrl: heavy, empIds: ["e1"] });
    assert.equal(shed.formUrl, "");
    assert.deepEqual(Array.from(shed.empIds), ["e1"]);
  });

  it("totals OT hours and pay by employee, site, and week", () => {
    const ctx = loadOt();
    ctx.S.employees = {
      e1: { id: "e1", empNo: "1250", name: "Ababon, Jonathan", dailyRate: 520, project: "Danlag" },
      e2: { id: "e2", empNo: "1251", name: "Santos, Ben", dailyRate: 480, project: "Tagba-o" },
    };
    ctx.S.otreqs = {
      ot1: {
        id: "ot1",
        from: "2026-10-02",
        to: "2026-10-02",
        site: "Danlag",
        wholeSite: true,
        status: "Approved",
        formUrl: FORM,
      },
      ot2: {
        id: "ot2",
        from: "2026-10-02",
        to: "2026-10-02",
        site: "",
        wholeSite: false,
        empIds: ["e2"],
        status: "Approved",
        formUrl: FORM,
      },
    };
    ctx.S.daily = {
      d1: {
        date: "2026-10-01",
        rows: { e1: { ot: 2, site: "Danlag" } },
      },
      d2: {
        date: "2026-10-02",
        rows: {
          e1: { ot: 3, site: "Danlag" },
          e2: { ot: 4, site: "Tagba-o" },
        },
      },
    };
    const report = ctx.otTrack({
      from: "2026-10-01",
      to: "2026-10-07",
      mode: "week",
    });
    assert.equal(report.requests, 2);
    assert.equal(report.buckets.length, 1);
    const b = report.buckets[0];
    assert.equal(b.key, "2026-10-01");
    assert.equal(b.hours, 9);
    assert.equal(b.noFormHours, 2);
    const e1 = b.employees.find((e) => e.id === "e1");
    const e2 = b.employees.find((e) => e.id === "e2");
    assert.equal(e1.hours, 5);
    assert.equal(e1.noFormHours, 2);
    assert.equal(e1.pay, 5 * (520 / 8));
    assert.equal(e2.hours, 4);
    assert.equal(e2.noFormHours, 0);
    assert.equal(e2.pay, 4 * (480 / 8));
    const danlag = b.sites.find((s) => s.site === "Danlag");
    const tag = b.sites.find((s) => s.site === "Tagba-o");
    assert.equal(danlag.hours, 5);
    assert.equal(danlag.noFormHours, 2);
    assert.equal(tag.hours, 4);
    assert.equal(tag.noFormHours, 0);
    const csv = ctx.otCsv(report);
    assert.equal(csv[0][0], "Period");
    assert.ok(csv.some((row) => row[1] === "Employee" && row[2] === "Ababon, Jonathan"));
    assert.ok(csv.some((row) => row[1] === "Site" && row[2] === "Danlag"));
    const month = ctx.otTrack({ from: "2026-10-01", to: "2026-10-31", mode: "month" });
    assert.equal(month.buckets.length, 1);
    assert.equal(month.buckets[0].key, "2026-10");
    assert.equal(month.buckets[0].hours, 9);
  });
});
