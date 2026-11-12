"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const readme = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");

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

function load(names, extra) {
  const ctx = Object.assign(
    {
      S: { settings: {}, otreqs: {}, daily: {}, employees: {} },
      TODAY: "2026-11-06",
      isoDate(t) {
        return (
          t.getFullYear() +
          "-" +
          String(t.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(t.getDate()).padStart(2, "0")
        );
      },
    },
    extra || {}
  );
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

const OT_NAMES = [
  "isEphemeralUrl",
  "durableDriveUrl",
  "addDays",
  "otSiteKey",
  "otFileKey",
  "otFormFiles",
  "otFormUrl",
  "otRequestCovers",
  "otCovered",
  "otFormGateWaived",
  "otPendingApplies",
  "otPaidHours",
  "otEachDate",
  "otHourlyOf",
  "otManilaDay",
  "otLoggedHours",
  "otSiteIndex",
  "otResolvedSite",
  "otTrack",
];

const ACCESS_NAMES = [
  "normActorId",
  "hrActor",
  "dailyInOutEditorList",
  "actorMatchesInOutEditor",
  "canEditDailyInOut",
  "dailyInOutLocked",
  "applyDailyInOutGuard",
  "dailyDiff",
];

const CASSIE = {
  email: "moranmariatrinacassandra@gmail.com",
  role: "staff",
  department: "site",
  sub: "not-a-real-uid",
};
const OTHER = {
  email: "finance@corroconstruction.com",
  role: "dept_lead",
  department: "finance",
  sub: "d36c801f-9f59-4cca-84f6-36774e0b579e",
};

describe("2026-11-09a OT form gate waiver and Cassie time in/out", () => {
  it("is build 2026-11-10b and documents a reversible waiver with no end date", () => {
    assert.match(html, /const BUILD = "2026-11-12a"/);
    assert.match(html, /otFormGateWaived:true/);
    assert.match(html, /function otFormGateWaived\(/);
    assert.match(html, /data-set-flag="otFormGateWaived"/);
    assert.match(html, /No end date/);
    assert.match(html, /moranmariatrinacassandra@gmail.com/);
    assert.match(html, /does not grant admin/i);
    assert.match(readme, /build 2026-11-09a/);
    assert.match(readme, /otFormGateWaived/);
    assert.match(readme, /moranmariatrinacassandra@gmail.com/);
    assert.match(readme, /no end date/i);
    assert.doesNotMatch(extractFunction(html, "otPaidHours"), /status\s*=\s*"Approved"/);
    assert.doesNotMatch(extractFunction(html, "otTrack"), /status\s*=\s*"Approved"/);
  });

  it("pays recorded OT while the waiver is on and withholds it when the flag is off", () => {
    const ctx = load(OT_NAMES);
    const filed = {
      id: "ot-filed",
      from: "2026-11-04",
      to: "2026-11-04",
      site: "Danlag",
      wholeSite: true,
      status: "Filed",
      formUrl: "",
      empIds: ["e1"],
    };
    ctx.S.otreqs = { "ot-filed": filed };
    ctx.S.employees = {
      e1: { id: "e1", name: "Ababon, Jonathan", empNo: "1250", dailyRate: 520 },
    };
    ctx.S.daily = {
      d1: { id: "d1", date: "2026-11-04", rows: { e1: { ot: 3, site: "Danlag" } } },
    };
    assert.equal(ctx.otFormGateWaived(), false);
    assert.equal(ctx.otCovered("e1", "2026-11-04", "Danlag"), false);
    assert.equal(ctx.otPaidHours("e1", "2026-11-04", "Danlag", 3, "2026-11-05"), 0);

    ctx.S.settings.otFormGateWaived = true;
    assert.equal(ctx.otFormGateWaived(), true);
    assert.equal(ctx.otPaidHours("e1", "2026-11-04", "Danlag", 3, "2026-11-05"), 3);
    assert.equal(ctx.otPaidHours("e1", "2026-11-04", "Danlag", 0, "2026-11-05"), 0);
    assert.equal(filed.status, "Filed");
    assert.equal(ctx.S.otreqs["ot-filed"].status, "Filed");
    assert.equal(ctx.S.otreqs["ot-filed"].formUrl, "");

    const paid = ctx.otTrack({ from: "2026-11-04", to: "2026-11-04", mode: "range" });
    const bucket = paid.buckets[0];
    const person = bucket.employees.find((e) => e.id === "e1");
    assert.equal(person.hours, 3);
    assert.equal(person.pendingHours, 3);
    assert.equal(person.approvedHours, 0);
    assert.equal(person.pay, 3 * (520 / 8));
    assert.equal(person.pendingPay, 0);
    assert.equal(filed.status, "Filed");

    ctx.S.settings.otFormGateWaived = false;
    assert.equal(ctx.otPaidHours("e1", "2026-11-04", "Danlag", 3, "2026-11-05"), 0);
    const held = ctx.otTrack({ from: "2026-11-04", to: "2026-11-04", mode: "range" });
    const heldPerson = held.buckets[0].employees.find((e) => e.id === "e1");
    assert.equal(heldPerson.pay, 0);
    assert.equal(heldPerson.pendingHours, 3);
    assert.equal(ctx.S.otreqs["ot-filed"].status, "Filed");
  });

  it("lets Cassie's 201 email and an allowlisted uid edit time in/out, and blocks another user", () => {
    const ctx = load(ACCESS_NAMES, {
      S: { settings: {}, employees: {} },
      DAILY_FIELD: {
        s: "status",
        r: "reason",
        site: "area",
        in: "time in",
        out: "time out",
        ot: "overtime hours",
        day: "day credit",
        hol: "holiday premium",
        rk: "reason type",
        ex: "excused",
      },
    });
    assert.equal(ctx.canEditDailyInOut(CASSIE), true);
    assert.equal(ctx.canEditDailyInOut({ email: "MoranMariaTrinaCassandra@gmail.com", role: "staff" }), true);
    assert.equal(ctx.canEditDailyInOut(OTHER), false);
    assert.equal(ctx.canEditDailyInOut({ email: "hrcorcondev@gmail.com", role: "staff", department: "site" }), false);
    assert.equal(ctx.canEditDailyInOut({ role: "admin", email: "jeffreycorro@corroconstruction.com", department: "admin" }), true);
    assert.equal(ctx.canEditDailyInOut({ role: "hr", email: "hr@corroconstruction.com", department: "hr" }), true);
    assert.equal(ctx.canEditDailyInOut({ email: "", role: "", sub: "" }), false);
    assert.equal(ctx.canEditDailyInOut(null), false);

    ctx.S.settings.dailyInOutEditors = [{ uid: "cassie-uid-when-created" }];
    const byUid = { email: "someone-else@example.com", role: "staff", department: "site", sub: "cassie-uid-when-created" };
    assert.equal(ctx.canEditDailyInOut(byUid), true);
    assert.equal(ctx.canEditDailyInOut({ ...byUid, sub: "other-uid" }), false);

    assert.equal(ctx.dailyInOutLocked(null), false);
    assert.equal(ctx.dailyInOutLocked({ method: "password", sub: "gate" }), false);
    assert.equal(ctx.dailyInOutLocked(CASSIE), false);
    assert.equal(ctx.dailyInOutLocked(OTHER), true);

    const prev = { in: "8:00 AM", out: "5:00 PM", s: "Present" };
    const typed = { in: "8:22 AM", out: "6:10 PM", s: "Present/Late" };
    const kept = ctx.applyDailyInOutGuard(prev, typed, CASSIE);
    assert.equal(kept.in, "8:22 AM");
    assert.equal(kept.out, "6:10 PM");
    assert.equal(kept.s, "Present/Late");
    const blocked = ctx.applyDailyInOutGuard(prev, typed, OTHER);
    assert.equal(blocked.in, "8:00 AM");
    assert.equal(blocked.out, "5:00 PM");
    assert.equal(blocked.s, "Present/Late");

    const before = { rows: { e1: { in: "8:00 AM", out: "5:00 PM", s: "Present", ot: 1 } } };
    const after = { rows: { e1: { in: "8:22 AM", out: "6:10 PM", s: "Present", ot: 1 } } };
    const changes = ctx.dailyDiff(before, after);
    const fields = changes.map((c) => c.f).sort();
    assert.equal(fields.length, 2);
    assert.equal(fields[0], "in");
    assert.equal(fields[1], "out");
    assert.equal(changes.find((c) => c.f === "in").from, "8:00 AM");
    assert.equal(changes.find((c) => c.f === "in").to, "8:22 AM");
    assert.equal(changes.find((c) => c.f === "out").to, "6:10 PM");
  });
});
