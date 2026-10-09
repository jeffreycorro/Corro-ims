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

function loadOt() {
  const names = [
    "dateInputValue",
    "addDays",
    "weekStart",
    "otSiteKey",
    "otManilaDay",
    "otLoggedHours",
    "otSiteIndex",
    "otResolvedSite",
    "otFileKey",
    "otFormFiles",
    "otFormUrl",
    "otRequestCovers",
    "otCovered",
    "otEachDate",
    "otHourlyOf",
    "otTrack",
    "otEmptyNote",
    "otBySiteDates",
    "otBySiteSum",
  ];
  const ctx = {
    TODAY: "2026-10-08",
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
    esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    },
    num(n, d) {
      return (Number(n) || 0).toFixed(d == null ? 2 : d);
    },
    flipName(n) {
      const p = String(n || "").split(",");
      return p.length > 1 ? p[1].trim() + " " + p[0].trim() : String(n || "");
    },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

const FORM = "https://drive.google.com/file/d/OTFORM1/view?usp=sharing";

function people(ctx) {
  ctx.S.employees = {
    e1: { id: "e1", empNo: "1401", name: "Santos, Ana", dailyRate: 480, project: "Tagba-o" },
    e2: { id: "e2", empNo: "1402", name: "Reyes, Mark", dailyRate: 520, project: "Tagba-o" },
  };
  ctx.S.otreqs = {};
  ctx.S.daily = {};
}

function track(ctx, extra) {
  return ctx.otTrack(
    Object.assign({ from: "2026-10-08", to: "2026-10-14", mode: "week", site: "Danao SPLPA" }, extra || {})
  );
}

describe("2026-10-08a overtime tracking reads Daily Manpower hours", () => {
  it("is build 2026-10-08a and does not write overtime or manpower records", () => {
    assert.match(html, /const BUILD = "2026-10-08a"/);
    assert.match(html, /No overtime hours in this window\./);
    assert.match(extractFunction(html, "viewOtRequests"), /if\(!report\.buckets\.length\)/);
    assert.match(extractFunction(html, "viewOtRequests"), /otEmptyNote\(/);
    assert.match(html, /data-otjump/);
    assert.match(html, /Show the previous week/);
    ["otTrack", "otEmptyNote", "otManilaDay", "otLoggedHours", "otResolvedSite", "otSiteIndex", "otBySiteHtml"].forEach(
      (name) => {
        assert.doesNotMatch(extractFunction(html, name), /\b(put|putMany|drop|lsSave)\s*\(/);
      }
    );
  });

  it("shows Danao SPLPA hours as pending when no OT request exists", () => {
    const ctx = loadOt();
    people(ctx);
    ctx.S.daily.d20261008 = {
      id: "d20261008",
      date: "2026-10-08",
      rows: {
        e1: { ot: 3, site: "Danao SPLPA" },
        e2: { ot: 2, site: "Tagba-o" },
      },
    };
    const before = JSON.stringify(ctx.S.daily);
    const report = track(ctx);
    assert.equal(JSON.stringify(ctx.S.daily), before, "reading the report must not change stored days");
    assert.equal(report.requests, 0);
    assert.equal(report.buckets.length, 1);
    const b = report.buckets[0];
    assert.equal(b.hours, 3);
    assert.equal(b.pendingHours, 3);
    assert.equal(b.approvedHours, 0);
    assert.equal(b.bySite.length, 1);
    assert.equal(ctx.otSiteKey(b.bySite[0].site), "danao splpa");
    const ana = b.bySite[0].employees.find((e) => e.id === "e1");
    assert.equal(ana.hours, 3);
    assert.equal(ana.pendingHours, 3);
    assert.equal(ana.approvedHours, 0);
    assert.equal(ana.days["2026-10-08"].pendingHours, 3);
    const listed = b.employees.find((e) => e.id === "e1");
    assert.equal(listed.hours, 3);
    assert.equal(listed.pendingHours, 3);
    assert.equal(b.employees.some((e) => e.id === "e2"), false);

    const everyone = track(ctx, { site: "" });
    assert.equal(everyone.buckets[0].hours, 5);
    assert.equal(everyone.buckets[0].bySite.length, 2);
    assert.equal(everyone.buckets[0].employees.length, 2);
  });

  it("marks the same hours approved only when a signed approved request covers them", () => {
    const ctx = loadOt();
    people(ctx);
    ctx.S.daily.d20261009 = {
      id: "d20261009",
      date: "2026-10-09",
      rows: { e1: { ot: 4, site: "Danao SPLPA" }, e2: { ot: 1.5, site: "Danao SPLPA" } },
    };
    ctx.S.otreqs.filed = {
      id: "filed",
      from: "2026-10-09",
      to: "2026-10-09",
      site: "Danao SPLPA",
      wholeSite: true,
      status: "Filed",
      formUrl: FORM,
    };
    let b = track(ctx).buckets[0];
    assert.equal(b.hours, 5.5);
    assert.equal(b.pendingHours, 5.5);
    assert.equal(b.approvedHours, 0);
    assert.equal(b.requests, 1);

    ctx.S.otreqs.filed.status = "Approved";
    delete ctx.S.otreqs.filed.formUrl;
    b = track(ctx).buckets[0];
    assert.equal(b.pendingHours, 5.5, "approved with no form still waits");

    ctx.S.otreqs.filed.formUrl = FORM;
    b = track(ctx).buckets[0];
    assert.equal(b.approvedHours, 5.5);
    assert.equal(b.pendingHours, 0);
    assert.equal(b.employees.find((e) => e.id === "e2").approvedHours, 1.5);
  });

  it("treats a different spelling of Danao SPLPA as the filtered site", () => {
    const ctx = loadOt();
    people(ctx);
    ctx.S.daily.d20261008 = {
      id: "d20261008",
      date: "2026-10-08",
      rows: {
        e1: { ot: 2, site: "Danao-SPLPA" },
        e2: { otHours: 1.5, site: "DANAO  SPLPA" },
      },
    };
    const b = track(ctx).buckets[0];
    assert.equal(b.bySite.length, 1);
    assert.equal(ctx.otSiteKey(b.bySite[0].site), "danao splpa");
    assert.equal(b.hours, 3.5);
    assert.equal(b.pendingHours, 3.5);
    assert.equal(b.employees.length, 2);
  });

  it("uses the last Daily Manpower area when today's row left site blank", () => {
    const ctx = loadOt();
    people(ctx);
    ctx.S.daily.d20261007 = {
      id: "d20261007",
      date: "2026-10-07",
      rows: { e1: { ot: 2, site: "Danao SPLPA" } },
    };
    ctx.S.daily.d20261008 = {
      id: "d20261008",
      date: "2026-10-08",
      rows: { e1: { ot: 3, site: "" } },
    };
    const report = track(ctx);
    assert.equal(report.buckets.length, 1);
    const b = report.buckets[0];
    assert.equal(b.key, "2026-10-08");
    assert.equal(b.hours, 3);
    assert.equal(b.pendingHours, 3);
    assert.equal(ctx.otSiteKey(b.bySite[0].site), "danao splpa");
    assert.equal(b.employees[0].id, "e1");
    const prev = ctx.otTrack({ from: "2026-10-01", to: "2026-10-07", mode: "week", site: "Danao SPLPA" });
    assert.equal(prev.buckets[0].hours, 2);
    assert.equal(prev.buckets[0].employees[0].days["2026-10-08"], undefined);
  });

  it("keeps a day whose date is only on the document id, or a Manila timestamp", () => {
    const ctx = loadOt();
    people(ctx);
    ctx.S.daily.d20261008 = {
      id: "d20261008",
      rows: { e1: { ot: 1.5, site: "Danao SPLPA" } },
    };
    ctx.S.daily["early-thu"] = {
      id: "early-thu",
      date: "2026-10-07T16:00:00.000Z",
      rows: { e2: { ot: 2, site: "Danao SPLPA" } },
    };
    const b = track(ctx).buckets[0];
    assert.equal(b.hours, 3.5);
    assert.equal(b.pendingHours, 3.5);
    const danao = b.bySite[0];
    assert.equal(danao.employees.find((e) => e.id === "e1").days["2026-10-08"].hours, 1.5);
    assert.equal(danao.employees.find((e) => e.id === "e2").days["2026-10-08"].hours, 2);
    assert.equal(b.employees.find((e) => e.id === "e1").hours, 1.5);
    assert.equal(b.employees.find((e) => e.id === "e2").hours, 2);
    const wed = ctx.otTrack({ from: "2026-10-01", to: "2026-10-07", mode: "week", site: "Danao SPLPA" });
    assert.equal(wed.buckets.length, 0);
  });

  it("points an empty new week at the previous week, and at other sites in this window", () => {
    const ctx = loadOt();
    people(ctx);
    ctx.S.daily.d20261006 = {
      id: "d20261006",
      date: "2026-10-06",
      rows: { e1: { ot: 4, site: "Danao SPLPA" } },
    };
    ctx.S.daily.d20261007 = {
      id: "d20261007",
      date: "2026-10-07",
      rows: { e2: { ot: 1, site: "Danao SPLPA" } },
    };
    ctx.S.otreqs.old = {
      id: "old",
      from: "2026-10-06",
      to: "2026-10-06",
      site: "Danao SPLPA",
      wholeSite: true,
      status: "Approved",
      formUrl: FORM,
    };
    const empty = track(ctx);
    assert.equal(empty.buckets.length, 0);
    assert.equal(empty.requests, 0);
    const note = ctx.otEmptyNote({
      from: "2026-10-08",
      to: "2026-10-14",
      site: "Danao SPLPA",
      mode: "week",
    });
    assert.match(note, /data-ot-empty-note="1"/);
    assert.match(note, /2026-10-01 to 2026-10-07/);
    assert.match(note, /5\.0 overtime hours at Danao SPLPA/);
    assert.match(note, /1 OT request/);
    assert.match(note, /data-otjump="2026-10-01"/);
    assert.match(note, /data-otjumpto="2026-10-07"/);
    assert.match(note, /Show the previous week/);

    ctx.S.daily.d20261010 = {
      id: "d20261010",
      date: "2026-10-10",
      rows: { e2: { ot: 2, site: "Tagba-o" } },
    };
    const still = track(ctx);
    assert.equal(still.buckets.length, 0, "Tagba-o hours do not fill a Danao filter");
    const wider = ctx.otEmptyNote({
      from: "2026-10-08",
      to: "2026-10-14",
      site: "Danao SPLPA",
      mode: "week",
    });
    assert.match(wider, /Other sites in this window/);
    assert.match(wider, /Tagba-o/);
    assert.match(wider, /data-otclear="site"/);

    const quiet = ctx.otEmptyNote({ from: "2026-09-03", to: "2026-09-09", site: "", mode: "week" });
    assert.equal(quiet, "");
  });
});
