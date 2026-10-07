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
    "addDays",
    "weekStart",
    "otSiteKey",
    "otFileKey",
    "otFormFiles",
    "otFormUrl",
    "otRequestCovers",
    "otCovered",
    "otEachDate",
    "otHourlyOf",
    "otTrack",
    "otBySiteDates",
    "otDayLabel",
    "otDayCellHtml",
    "otDayText",
    "otFormChip",
    "otBySiteSum",
    "otBySiteHtml",
    "otBySitePrint",
    "otCsv",
  ];
  const ctx = {
    TODAY: "2026-10-07",
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
      return String(s == null ? "" : s);
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

function weekData(ctx) {
  ctx.S.employees = {
    e1: { id: "e1", empNo: "1278", name: "Kiamco, Jophil P.", dailyRate: 520, project: "Danlag" },
    e2: { id: "e2", empNo: "1297", name: "Ramas, Danilo S.", dailyRate: 480, project: "Danlag" },
    e3: { id: "e3", empNo: "1272", name: "Francisco, Romar T.", dailyRate: 500, project: "Tagba-o" },
  };
  ctx.S.otreqs = {
    otFri: {
      id: "otFri",
      from: "2026-10-02",
      to: "2026-10-02",
      site: "Danlag",
      wholeSite: true,
      status: "Approved",
      formUrl: FORM,
    },
    otFiled: {
      id: "otFiled",
      from: "2026-10-03",
      to: "2026-10-03",
      site: "Danlag",
      wholeSite: false,
      empIds: ["e2"],
      status: "Filed",
      formUrl: FORM,
    },
    otNamed: {
      id: "otNamed",
      from: "2026-10-01",
      to: "2026-10-03",
      site: "",
      wholeSite: false,
      empIds: ["e3"],
      status: "Approved",
      formUrl: FORM,
    },
    otSun: {
      id: "otSun",
      from: "2026-10-04",
      to: "2026-10-04",
      site: "Tagba-o",
      wholeSite: true,
      status: "Approved",
      formUrl: FORM,
    },
  };
  ctx.S.daily = {
    d1: { date: "2026-10-01", rows: { e1: { ot: 4, site: "Danlag" }, e3: { ot: 3, site: "Tagba-o" } } },
    d2: { date: "2026-10-02", rows: { e1: { ot: 4, site: "Danlag" }, e2: { ot: 2, site: "Danlag" } } },
    d3: { date: "2026-10-03", rows: { e2: { ot: 2, site: "Danlag" }, e1: { ot: 3, site: "Tagba-o" } } },
    d4: { date: "2026-10-04", rows: { e1: { ot: 2.5, site: "Tagba-o" }, e3: { ot: 1.5, site: "Tawason" } } },
    d5: { date: "2026-10-06", rows: { e1: { ot: 1, site: "Danlag" } } },
  };
}

function trackWeek(ctx, extra) {
  return ctx.otTrack(Object.assign({ from: "2026-10-01", to: "2026-10-07", mode: "week" }, extra || {}));
}

function siteOf(bucket, name) {
  return bucket.bySite.find((s) => s.site === name);
}

function person(site, id) {
  return site.employees.find((e) => e.id === id);
}

function sumHours(list, field) {
  return (list || []).reduce((n, row) => n + Number(row[field || "hours"] || 0), 0);
}

describe("2026-10-07b overtime by site", () => {
  it("is build 2026-10-07b and keeps the employee summary on OT Requests", () => {
    assert.match(html, /const BUILD = "2026-10-07b"/);
    assert.match(html, /function viewOtRequests\(/);
    assert.match(html, /All employees/);
    assert.match(html, /<th>Employee<\/th><th>ID<\/th><th class="num">Approved h<\/th>/);
    assert.match(html, /otBySiteHtml\(b, otBySiteDates\(b, report\)\)/);
    assert.match(html, /otBySitePrint\(b, otBySiteDates\(b, report\)\)/);
    assert.match(html, /By week, those hours are also listed under each site/);
    ["otTrack", "otBySiteHtml", "otBySitePrint", "otBySiteDates", "otCsv"].forEach((name) => {
      assert.doesNotMatch(extractFunction(html, name), /\b(put|putMany|drop|lsSave)\s*\(/);
    });
    const collections = fs.readFileSync(path.join(__dirname, "../netlify/lib/collections.js"), "utf8");
    assert.doesNotMatch(collections, /otbysite|otBySite|siteEmp/);
  });

  it("groups the week under each site, with each day, and does not count a person twice", () => {
    const ctx = loadOt();
    weekData(ctx);
    const report = trackWeek(ctx);
    assert.equal(report.buckets.length, 1);
    const b = report.buckets[0];
    assert.equal(b.key, "2026-10-01");
    assert.equal(
      ctx.otBySiteDates(b, report).map(String).join(","),
      "2026-10-01,2026-10-02,2026-10-03,2026-10-04,2026-10-05,2026-10-06,2026-10-07"
    );
    assert.equal(b.bySite.map((s) => s.site).join("|"), "Danlag|Tagba-o|Tawason");

    const danlag = siteOf(b, "Danlag");
    const tagbao = siteOf(b, "Tagba-o");
    const tawason = siteOf(b, "Tawason");
    const e1d = person(danlag, "e1");
    const e2d = person(danlag, "e2");
    const e1t = person(tagbao, "e1");
    const e3t = person(tagbao, "e3");
    const e3w = person(tawason, "e3");

    assert.equal(e1d.approvedHours, 4);
    assert.equal(e1d.pendingHours, 5);
    assert.equal(e1d.hours, 9);
    assert.equal(e1d.days["2026-10-01"].pendingHours, 4);
    assert.equal(e1d.days["2026-10-01"].approvedHours, 0);
    assert.equal(e1d.days["2026-10-02"].approvedHours, 4);
    assert.equal(e1d.days["2026-10-02"].pendingHours, 0);
    assert.equal(e1d.days["2026-10-03"], undefined);
    assert.equal(e1d.days["2026-10-06"].pendingHours, 1);
    assert.equal(e1d.pay, 4 * (520 / 8));

    assert.equal(e2d.hours, 4);
    assert.equal(e2d.approvedHours, 2);
    assert.equal(e2d.pendingHours, 2);
    assert.equal(e2d.days["2026-10-03"].pendingHours, 2);

    assert.equal(e1t.hours, 5.5);
    assert.equal(e1t.approvedHours, 2.5);
    assert.equal(e1t.pendingHours, 3);
    assert.equal(e1t.days["2026-10-04"].approvedHours, 2.5);
    assert.equal(e3t.hours, 3);
    assert.equal(e3t.pendingHours, 0);
    assert.equal(e3t.approvedHours, 3);
    assert.equal(e3w.hours, 1.5);
    assert.equal(e3w.approvedHours, 0);
    assert.equal(e3w.pendingHours, 1.5);

    assert.equal(danlag.hours, 13);
    assert.equal(danlag.approvedHours, 6);
    assert.equal(danlag.pendingHours, 7);
    assert.equal(tagbao.hours, 8.5);
    assert.equal(tagbao.approvedHours, 5.5);
    assert.equal(tagbao.pendingHours, 3);
    assert.equal(tawason.hours, 1.5);
    assert.equal(tawason.pendingHours, 1.5);

    const all = ctx.otBySiteSum(b.bySite);
    assert.equal(all.hours, 23);
    assert.equal(all.approvedHours, 11.5);
    assert.equal(all.pendingHours, 11.5);
    assert.equal(all.hours, b.hours);
    assert.equal(all.approvedHours, b.approvedHours);
    assert.equal(all.pendingHours, b.pendingHours);
    assert.equal(sumHours(b.employees), b.hours);
    assert.equal(sumHours(b.sites), b.hours);
    assert.equal(sumHours(b.bySite), b.hours);

    const e1 = b.employees.find((e) => e.id === "e1");
    const e1Parts = b.bySite.flatMap((s) => s.employees.filter((e) => e.id === "e1"));
    assert.equal(e1Parts.length, 2);
    assert.equal(sumHours(e1Parts), e1.hours);
    assert.equal(e1.approvedHours, 6.5);
    assert.equal(e1.pendingHours, 8);
    assert.equal(e1.days, 5);

    b.bySite.forEach((sg) => {
      const fromDays = Object.values(sg.days).reduce((n, d) => n + d.hours, 0);
      assert.equal(fromDays, sg.hours);
      sg.employees.forEach((e) => {
        const empDays = Object.values(e.days).reduce((n, d) => n + d.hours, 0);
        assert.equal(empDays, e.hours);
      });
      assert.equal(sumHours(sg.employees), sg.hours);
    });
  });

  it("keeps a site filter and an employee filter to that site's hours only", () => {
    const ctx = loadOt();
    weekData(ctx);
    const tag = trackWeek(ctx, { site: "Tagba-o" });
    const b = tag.buckets[0];
    assert.equal(b.bySite.map((s) => s.site).join("|"), "Tagba-o");
    assert.equal(b.hours, 8.5);
    assert.equal(ctx.otBySiteSum(b.bySite).hours, b.hours);
    const only = trackWeek(ctx, { empId: "e1" });
    const one = only.buckets[0];
    assert.equal(one.bySite.map((s) => s.site).join("|"), "Danlag|Tagba-o");
    assert.equal(one.bySite.every((s) => s.employees.every((e) => e.id === "e1")), true);
    assert.equal(one.hours, 14.5);
    assert.equal(ctx.otBySiteSum(one.bySite).hours, 14.5);
    const clip = trackWeek(ctx, { from: "2026-10-02", to: "2026-10-04" });
    const days = ctx.otBySiteDates(clip.buckets[0], clip);
    assert.equal(days.map(String).join(","), "2026-10-02,2026-10-03,2026-10-04");
    const clipped = siteOf(clip.buckets[0], "Danlag");
    const e1clip = person(clipped, "e1");
    assert.equal(e1clip.hours, 4);
    assert.equal(e1clip.days["2026-10-01"], undefined);
    assert.equal(e1clip.days["2026-10-06"], undefined);
  });

  it("treats a different spelling of the same site as one site", () => {
    const ctx = loadOt();
    weekData(ctx);
    ctx.S.daily.d5.rows.e2 = { ot: 1.5, site: "danlag" };
    const b = trackWeek(ctx).buckets[0];
    const danlag = siteOf(b, "Danlag");
    assert.equal(b.bySite.filter((s) => ctx.otSiteKey(s.site) === "danlag").length, 1);
    assert.equal(person(danlag, "e2").hours, 5.5);
    assert.equal(person(danlag, "e2").pendingHours, 3.5);
    assert.equal(danlag.hours, 14.5);
    assert.equal(ctx.otBySiteSum(b.bySite).hours, b.hours);
  });

  it("marks approved and pending on the grid, the print, and the CSV", () => {
    const ctx = loadOt();
    weekData(ctx);
    const report = trackWeek(ctx);
    const b = report.buckets[0];
    const dates = ctx.otBySiteDates(b, report);
    const table = ctx.otBySiteHtml(b, dates);
    assert.match(table, /class="tw ot-by-site"/);
    assert.match(table, /data-ot-site="Danlag"/);
    assert.match(table, /Thu 1 Oct/);
    assert.match(table, /Wed 7 Oct/);
    const row = table.match(/data-ot-emp="e1" data-ot-at="Danlag"[\s\S]*?<\/tr>/)[0];
    const tds = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    assert.match(tds[0], /Jophil P\. Kiamco/);
    assert.match(tds[1], /1278/);
    assert.match(tds[2], /4\.0/);
    assert.match(tds[2], /pending/);
    assert.match(tds[3], /4\.0/);
    assert.doesNotMatch(tds[3], /pending/);
    assert.match(tds[4], /—/);
    assert.match(tds[7], /1\.0/);
    assert.match(tds[7], /pending/);
    assert.match(tds[8], /—/);
    assert.equal(tds[9], "4.0");
    assert.equal(tds[10], "5.0");
    assert.match(tds[11], /9\.0/);
    assert.match(tds[13], /Pending OT form/);
    const tagRow = table.match(/data-ot-emp="e3" data-ot-at="Tagba-o"[\s\S]*?<\/tr>/)[0];
    assert.match(tagRow, /pill ok">approved/);
    assert.doesNotMatch(tagRow, /Pending OT form/);
    const all = table.match(/data-ot-allsites="1"[\s\S]*?<\/tr>/)[0];
    assert.match(all, /23\.0/);
    assert.match(all, /11\.5/);
    const sub = table.match(/data-ot-subtotal="Tawason"[\s\S]*?<\/tr>/)[0];
    assert.match(sub, /1\.5/);

    const printed = ctx.otBySitePrint(b, dates);
    assert.match(printed, /By site/);
    assert.match(printed, /Jophil P\. Kiamco/);
    assert.match(printed, /4\.0 pending/);
    assert.match(printed, /Danlag subtotal/);
    assert.match(printed, /All sites/);

    const csv = ctx.otCsv(report);
    assert.equal(csv[0][0], "Period");
    assert.equal(csv[0][10], "Site");
    assert.ok(csv.some((r) => r[1] === "Employee" && r[2] === "Kiamco, Jophil P."));
    assert.ok(csv.some((r) => r[1] === "Site" && r[2] === "Danlag"));
    const day = csv.find((r) => r[1] === "Site day" && r[2] === "Kiamco, Jophil P." && r[11] === "2026-10-01");
    assert.equal(day[10], "Danlag");
    assert.equal(day[12], "0.0");
    assert.equal(day[13], "4.0");
    const fri = csv.find((r) => r[1] === "Site day" && r[2] === "Kiamco, Jophil P." && r[11] === "2026-10-02");
    assert.equal(fri[12], "4.0");
    assert.equal(fri[13], "0.0");
    assert.ok(csv.some((r) => r[1] === "Site employee" && r[3] === "1278" && r[10] === "Tagba-o" && r[4] === "2.5"));
    assert.ok(csv.some((r) => r[1] === "Site subtotal" && r[2] === "Danlag" && r[4] === "6.0" && r[6] === "7.0"));

    const month = ctx.otTrack({ from: "2026-10-01", to: "2026-10-31", mode: "month" });
    const monthDays = ctx.otBySiteDates(month.buckets[0], month);
    assert.equal(monthDays.includes("2026-10-05"), false);
    assert.equal(monthDays.includes("2026-10-07"), false);
    assert.equal(monthDays[0], "2026-10-01");
    assert.equal(ctx.otBySiteSum(month.buckets[0].bySite).hours, month.buckets[0].hours);
  });
});
