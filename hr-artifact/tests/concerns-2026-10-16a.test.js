"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const supabase = require("../netlify/lib/supabase");

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

function loadIdentity() {
  const names = [
    "normNo",
    "normPersonName",
    "personMatchKey",
    "canonDayStatus",
    "attendanceRowBlank",
    "summaryPersonId",
    "savedAttendanceRow",
    "shedDailySigBytes",
    "heavySigData",
  ];
  const ctx = {
    S: { employees: {}, daily: {}, leaves: {} },
    empList() {
      return Object.values(ctx.S.employees);
    },
    flipName(n) {
      const s = String(n || "");
      const p = s.split(",");
      return p.length > 1 ? (p[1].trim() + " " + p[0].trim()) : s;
    },
  };
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

describe("2026-10-16a HR Analytics stays open for James Senining", () => {
  it("is build 2026-10-16a", () => {
    assert.match(html, /const BUILD = "2026-10-29b"/);
    assert.match(extractFunction(html, "viewInsights"), /HR Analytics/);
    assert.match(extractFunction(html, "viewInsights"), />Records</);
    assert.match(extractFunction(html, "drillRows"), /typeof r!=="object"/);
    assert.doesNotMatch(extractFunction(html, "drillRows"), /dailyGroups\(/);
    assert.match(extractFunction(html, "lsPayload"), /shedDailySigBytes/);
  });

  it("resolves James Senining by number or name and does not rescan the roster", () => {
    const ctx = loadIdentity();
    const employees = {};
    for (let i = 1; i <= 80; i += 1) {
      const id = "e" + i;
      employees[id] = {
        id,
        empNo: String(1000 + i),
        name: "Worker, Person " + i,
        project: "Site " + (i % 5),
      };
    }
    employees.e1355 = {
      id: "e1355",
      empNo: "1355",
      name: "Senining, James C.",
      project: "Admins 2",
    };
    ctx.S.employees = employees;
    assert.equal(ctx.summaryPersonId("1355", { empNo: "1355" }), "e1355");
    assert.equal(ctx.summaryPersonId("Senining, James", { name: "Senining, James" }), "e1355");
    assert.equal(ctx.summaryPersonId("e1355", { s: "Absent" }), "e1355");
    assert.equal(ctx.summaryPersonId("cfx-manolongr", { s: "Present" }), "");

    const real = ctx.personMatchKey;
    let calls = 0;
    ctx.personMatchKey = function (name) {
      calls += 1;
      return real(name);
    };
    const alias = {
      "cfx-manolongr": { s: "Present", name: "Manolong, Raffy" },
      "cfx-pedranoja": { s: "Present", name: "Pedrano, Jaica" },
      "cfCCD2023129-abellajie": { s: "Absent", name: "Abella, Jie" },
    };
    for (let d = 0; d < 40; d += 1) {
      const rows = Object.assign({}, alias);
      Object.keys(employees).forEach((id) => {
        rows[id] = { s: id === "e1355" ? "Absent" : "Present", r: "" };
      });
      const rec = { date: "2026-10-01", rows };
      Object.keys(employees).forEach((id) => {
        ctx.savedAttendanceRow(rec, employees[id]);
      });
    }
    const james = ctx.savedAttendanceRow(
      { date: "2026-10-12", rows: { e1355: { s: "Present" }, "1355": { s: "Absent", r: "AWOL / no call, no show", empNo: "1355" } } },
      employees.e1355
    );
    assert.equal(james.s, "Absent");
    assert.ok(calls < 20000, "personMatchKey calls " + calls);
  });

  it("opens James Senining's days and skips a broken row", () => {
    const ctx = {
      S: {
        employees: {
          e1355: { id: "e1355", empNo: "1355", name: "Senining, James C.", project: "Admins 2" },
        },
        daily: {},
        leaves: {},
      },
      monthKey(d) {
        return String(d || "").slice(0, 7);
      },
      dailyRowShown() {
        return true;
      },
      absenceExcuse() {
        return null;
      },
      dailyGroups() {
        throw new Error("dailyGroups should not run while opening one person's records");
      },
    };
    vm.runInNewContext(extractFunction(html, "drillRows"), ctx);
    ctx.S.daily.bad = null;
    ctx.S.daily.d20261001 = {
      date: "2026-10-01",
      rows: { e1355: null, junk: "nope" },
    };
    ctx.S.daily.d20261012 = {
      date: "2026-10-12",
      rows: {
        e1355: { s: "Absent", r: "AWOL / no call, no show", site: "Admins 2" },
        e9999: { s: "Absent", r: "other person" },
      },
    };
    ctx.S.daily.d20261011 = {
      date: "2026-10-11",
      rows: { e1355: { s: "Rest Day", r: "", site: "Admins 2" } },
    };
    ctx.S.daily.d20260914 = {
      date: "2026-09-14",
      rows: { e1355: { s: "Absent", r: "Sick (excused)", site: "Admins 2" } },
    };
    const rows = ctx.drillRows({
      kind: "all",
      empId: "e1355",
      months: ["2026-09", "2026-10"],
    });
    assert.equal(rows.map((r) => r.date).join(","), "2026-10-12,2026-09-14");
    assert.equal(rows[0].name, "Senining, James C.");
    assert.equal(rows[0].site, "Admins 2");
    assert.equal(rows[0].reason, "AWOL / no call, no show");
    const absent = ctx.drillRows({ kind: "absent", empId: "e1355", months: ["2026-10"] });
    assert.equal(absent.length, 1);
    assert.equal(absent[0].date, "2026-10-12");
  });

  it("drops heavy daily signature bytes from a copy and leaves the live record", () => {
    const ctx = loadIdentity();
    const big = "data:image/png;base64," + "A".repeat(5000);
    const rec = {
      id: "d20260924",
      date: "2026-09-24",
      rows: { e1355: { s: "Absent" } },
      hrSigData: big,
      hrSigs: { approved: { data: big, link: "" }, prepared: { link: "https://drive.example/sig" } },
      _dmDirty: true,
    };
    const copy = ctx.shedDailySigBytes(rec);
    assert.equal(rec.hrSigData, big);
    assert.equal(rec.hrSigs.approved.data, big);
    assert.equal(rec._dmDirty, true);
    assert.equal(copy.hrSigData, undefined);
    assert.equal(copy.hrSigs.approved, undefined);
    assert.equal(copy.hrSigs.prepared.link, "https://drive.example/sig");
    assert.equal(copy.rows.e1355.s, "Absent");
    assert.equal(copy._dmDirty, true);
    const small = ctx.shedDailySigBytes({ hrSigData: "data:image/png;base64,AAA", rows: {} });
    assert.equal(small.hrSigData, "data:image/png;base64,AAA");
  });

  it("pages a collection list and keeps stored signatures when a save omits them", async () => {
    const big = "data:image/png;base64," + "B".repeat(5000);
    const stored = {
      date: "2026-09-24",
      rows: { e1355: { s: "Absent" } },
      hrSigData: big,
      hrSigs: { approved: { data: big } },
      _dmDirty: true,
    };
    const shed = supabase.shedDailySignatureBytes(stored);
    assert.equal(stored.hrSigData, big);
    assert.equal(shed.hrSigData, undefined);
    assert.equal(shed.hrSigs, undefined);
    assert.equal(shed.rows.e1355.s, "Absent");

    const saved = { date: "2026-09-24", rows: { e1355: { s: "Absent", r: "AWOL" } }, hrSigs: { prepared: { link: "https://drive.example/new" } } };
    const kept = supabase.preserveDailySignatures(stored, saved);
    assert.equal(kept.hrSigData, big);
    assert.equal(kept.hrSigs.approved.data, big);
    assert.equal(kept.hrSigs.prepared.link, "https://drive.example/new");
    assert.equal(kept.rows.e1355.r, "AWOL");
    assert.equal(kept._dmDirty, undefined);
    const replaced = "data:image/png;base64," + "C".repeat(5000);
    const fresh = supabase.preserveDailySignatures(stored, { hrSigData: replaced, hrSigs: { approved: { data: replaced } } });
    assert.equal(fresh.hrSigData, replaced);
    assert.equal(fresh.hrSigs.approved.data, replaced);

    const prevUrl = process.env.SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE;
    const prevFetch = global.fetch;
    process.env.SUPABASE_URL = "https://example.test";
    process.env.SUPABASE_SERVICE_ROLE = "service-role-test";
    const seen = [];
    global.fetch = async (url, opts) => {
      const range = opts.headers.Range;
      seen.push(range);
      const start = Number(String(range).split("-")[0]);
      if (start >= 1000) {
        return { ok: false, status: 416, text: async () => JSON.stringify({ message: "range" }) };
      }
      const rows = [];
      for (let i = 0; i < 500 && start + i < 1000; i += 1) {
        rows.push({ collection: "daily", id: "d" + (start + i), data: { n: start + i }, updated_at: null });
      }
      return { ok: true, status: 206, text: async () => JSON.stringify(rows) };
    };
    try {
      const rows = await supabase.listCollection("daily");
      assert.equal(rows.length, 1000);
      assert.equal(rows[0].id, "d0");
      assert.equal(rows[999].id, "d999");
      assert.deepEqual(seen.slice(0, 2), ["0-499", "500-999"]);
    } finally {
      global.fetch = prevFetch;
      if (prevUrl == null) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = prevUrl;
      if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE;
      else process.env.SUPABASE_SERVICE_ROLE = prevKey;
    }
  });
});
