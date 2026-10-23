"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

function loadDaily() {
  const names = [
    "rowHasEnteredData",
    "canonDayStatus",
    "attendanceRowBlank",
    "savedAttendanceRow",
    "dailyOtHoursOf",
    "dailyLeaveCovering",
    "leaveRecordPays",
    "lrfDisplay",
    "dailyLeaveStatus",
    "dailyLeaveReason",
    "reasonYieldsToLeave",
    "withLrf",
    "dailyLeaveLocked",
    "applyDailyLeave",
    "dailyRow",
  ];
  const ctx = {
    S: { leaves: {}, employees: {}, daily: {} },
    STATUS_PENDING: "Has not yet arrived",
    LRF_FULL: /LRF\s*[-–]?\s*(20\d\d)\s*[-–]?\s*(\d{3,4})/i,
    DAILY_LEAVE_LIVE: { Filed: 1, "For signature": 1, Approved: 2, Availed: 2 },
    LEAVE_TYPES: [
      { k: "VL", n: "Vacation Leave", pay: 1 },
      { k: "LWOP", n: "Leave Without Pay", pay: 0 },
    ],
    leaveType(k) {
      return ctx.LEAVE_TYPES.find((t) => t.k === k) || ctx.LEAVE_TYPES[0];
    },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function emp(id) {
  return { id, empNo: "1001", name: "Monte, Domingo Jr." };
}

describe("2026-10-15a daily monitoring leave from the LRF register", () => {
  it("is build 2026-10-15a", () => {
    assert.match(html, /const BUILD = "2026-10-23a"/);
  });

  it("shows an approved paid leave, with the LRF in the reason, on a blank day", () => {
    const ctx = loadDaily();
    ctx.S.leaves.lv = {
      id: "lv",
      empId: "e1",
      no: "LRF2026-0156",
      status: "Approved",
      type: "VL",
      from: "2026-10-14",
      to: "2026-10-15",
      pay: 1,
    };
    const rec = { date: "2026-10-14", rows: {} };
    const row = ctx.dailyRow(rec, emp("e1"));
    assert.equal(row.s, "Leave with Pay");
    assert.equal(row.r, "Approved Leave (LRF2026 - 0156)");
    const next = ctx.dailyRow({ date: "2026-10-15", rows: {} }, emp("e1"));
    assert.equal(next.s, "Leave with Pay");
    assert.match(next.r, /LRF2026 - 0156/);
    const outside = ctx.dailyRow({ date: "2026-10-16", rows: {} }, emp("e1"));
    assert.equal(outside.s, "Present");
    assert.equal(outside.r, "");
  });

  it("keeps a late mark, time in, and overtime", () => {
    const ctx = loadDaily();
    ctx.S.leaves.lv = {
      empId: "e1",
      no: "LRF2026-0156",
      status: "Approved",
      type: "VL",
      from: "2026-10-14",
      to: "2026-10-14",
    };
    const rec = {
      date: "2026-10-14",
      rows: { e1: { s: "Present/Late", r: "traffic", in: "8:12 AM", out: "5:00 PM", ot: 2 } },
    };
    const row = ctx.dailyRow(rec, emp("e1"));
    assert.equal(row.s, "Present/Late");
    assert.equal(row.r, "traffic");
    assert.equal(row.in, "8:12 AM");
    assert.equal(row.ot, 2);
  });

  it("turns a blank absent into leave and does not repeat an LRF already written", () => {
    const ctx = loadDaily();
    ctx.S.leaves.lv = {
      empId: "e1",
      no: "LRF2026-0156",
      status: "Availed",
      type: "VL",
      from: "2026-10-14",
      to: "2026-10-14",
    };
    const awol = ctx.dailyRow(
      { date: "2026-10-14", rows: { e1: { s: "Absent", r: "AWOL" } } },
      emp("e1")
    );
    assert.equal(awol.s, "Leave with Pay");
    assert.equal(awol.r, "Approved Leave (LRF2026 - 0156)");
    const cited = ctx.dailyRow(
      {
        date: "2026-10-14",
        rows: { e1: { s: "Leave", r: "Approved Leave (LRF2026 - 0156)" } },
      },
      emp("e1")
    );
    assert.equal(cited.r, "Approved Leave (LRF2026 - 0156)");
    assert.equal((cited.r.match(/LRF/g) || []).length, 1);
  });

  it("shows filed leave as unpaid leave, and ignores disapproved or cancelled forms", () => {
    const ctx = loadDaily();
    ctx.S.leaves.filed = {
      empId: "e1",
      no: "LRF2026-0200",
      status: "Filed",
      type: "VL",
      from: "2026-10-14",
      to: "2026-10-14",
    };
    const filed = ctx.dailyRow({ date: "2026-10-14", rows: {} }, emp("e1"));
    assert.equal(filed.s, "Leave");
    assert.equal(filed.r, "Filed Leave (LRF2026 - 0200)");
    ctx.S.leaves.filed.status = "Disapproved";
    assert.equal(ctx.dailyRow({ date: "2026-10-14", rows: {} }, emp("e1")).s, "Present");
    ctx.S.leaves.filed.status = "Cancelled";
    assert.equal(ctx.dailyRow({ date: "2026-10-14", rows: {} }, emp("e1")).s, "Present");
  });

  it("does not pay leave without pay, and keeps a reason Cassie typed on Present", () => {
    const ctx = loadDaily();
    ctx.S.leaves.lv = {
      empId: "e1",
      no: "LRF2026-0156",
      status: "Approved",
      type: "LWOP",
      pay: 0,
      from: "2026-10-14",
      to: "2026-10-14",
    };
    const lwop = ctx.dailyRow({ date: "2026-10-14", rows: {} }, emp("e1"));
    assert.equal(lwop.s, "Leave");
    assert.match(lwop.r, /LRF2026 - 0156/);
    ctx.S.leaves.lv.type = "VL";
    ctx.S.leaves.lv.pay = 1;
    const noted = ctx.dailyRow(
      { date: "2026-10-14", rows: { e1: { s: "Present", r: "came in for a delivery" } } },
      emp("e1")
    );
    assert.equal(noted.s, "Present");
    assert.equal(noted.r, "came in for a delivery");
  });

  it("marks a half-day leave as half a day and keeps the LRF", () => {
    const ctx = loadDaily();
    ctx.S.leaves.lv = {
      empId: "e1",
      no: "LRF2026-0156",
      status: "For signature",
      type: "VL",
      half: true,
      from: "2026-10-14",
      to: "2026-10-14",
    };
    const row = ctx.dailyRow({ date: "2026-10-14", rows: {} }, emp("e1"));
    assert.equal(row.s, "Leave");
    assert.equal(row.day, 0.5);
    assert.match(row.r, /Filed Leave \(LRF2026 - 0156\)/);
  });
});
