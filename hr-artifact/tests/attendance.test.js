"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAttendance(windowLike) {
  const src = fs.readFileSync(
    path.join(__dirname, "../public/hr-attendance.js"),
    "utf8"
  );
  vm.runInNewContext(src, windowLike);
  return windowLike.hrAttendance;
}

function emp(id, empNo, name) {
  return { id, empNo, name, project: "ADMINS" };
}

function stores() {
  return {
    employees: {
      e1250: emp("e1250", "1250", "Armenio, Toribio D."),
      e1348: emp("e1348", "1348", "Manolong, Raffy"),
      e1353: emp("e1353", "1353", "Pedrano, Jaica M."),
    },
    leaves: {},
    daily: {},
    today: "2026-08-31",
  };
}

function ctxFrom(s) {
  return {
    employees: s.employees,
    leaves: s.leaves,
    daily: s.daily,
    today: s.today,
  };
}

function sampleJson() {
  return [
    {
      date: "2026-08-29",
      preparedBy: "Timekeeper",
      approvedBy: "PIC",
      source: "08.29.2026.pdf",
      rows: [
        { empNo: "1250", status: "Present", reason: "", site: "CTU BARILI" },
        {
          empNo: "1348",
          status: "Absent",
          reason: "Approved Leave (LRF2026 - 0123)",
          site: "ADMINS",
        },
        { empNo: "1353", status: "Present/Late", reason: "traffic", site: "TAWASON" },
      ],
    },
  ];
}

describe("manpower attendance core", () => {
  let hr;
  let S;

  beforeEach(() => {
    const windowLike = { window: {}, document: undefined };
    windowLike.window = windowLike;
    hr = loadAttendance(windowLike);
    S = stores();
  });

  it("never uses toISOString for calendar day ids", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../public/hr-attendance.js"),
      "utf8"
    );
    assert.doesNotMatch(src, /toISOString\s*\(/);
    assert.equal(hr.isoDate("2026-08-29T16:40:00+08:00"), "2026-08-29");
    assert.equal(hr.dailyId("2026-08-29"), "d20260829");
    const manilaMorning = new Date("2026-08-29T17:00:00Z");
    assert.equal(hr.manilaToday(manilaMorning), "2026-08-30");
    assert.equal(manilaMorning.toISOString().slice(0, 10), "2026-08-29");
  });

  it("normalises statuses to the closed list and keeps Special Holiday", () => {
    assert.equal(hr.normStatus("Present / Late"), "Present/Late");
    assert.equal(hr.normStatus("special holiday"), "Special Holiday");
    assert.equal(hr.normStatus("Regular Holiday"), "Regular Holiday");
    assert.equal(hr.normStatus("Leave with Pay"), "Leave with Pay");
    assert.equal(hr.normStatus("not a status"), "");
    assert.ok(hr.CLOSED_STATUSES.includes("Special Holiday"));
    assert.ok(hr.CLOSED_STATUSES.includes("Leave with Pay"));
  });

  it("reads the report date from dotted, dashed and underscored filenames", () => {
    assert.equal(hr.dateFromReport("08.29.2026.pdf", ""), "2026-08-29");
    assert.equal(hr.dateFromReport("08-29-2026.pdf", ""), "2026-08-29");
    assert.equal(hr.dateFromReport("08_29_2026.pdf", ""), "2026-08-29");
    assert.equal(hr.dateFromReport("scan.pdf", "DAILY MANPOWER 29-Aug-26"), "2026-08-29");
  });

  it("parses manpower rows on the four-digit employee number only", () => {
    const text =
      "1 1250 Armenio Toribio DRIVER Present CTU BARILI " +
      "2 1348 Manolong Raffy TIMEKEEPER Absent Approved Leave (LRF2026 - 0123) ADMINS " +
      "3 1353 Pedrano Jaica OFFICE ENGINEER Present / Late traffic TAWASON " +
      "Prepared by Cassandra Approved by Jeffrey";
    const rows = hr.parseManpower(text);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].empNo, "1250");
    assert.equal(rows[0].status, "Present");
    assert.equal(rows[1].empNo, "1348");
    assert.equal(rows[1].status, "Absent");
    assert.match(rows[1].reason, /LRF2026/);
    assert.doesNotMatch(rows[1].reason, /ADMINS/);
    assert.equal(rows[2].status, "Present/Late");
    assert.equal(rows[2].reason, "traffic");
  });

  it("matches people on the four-digit emp number, never the name", () => {
    const ctx = ctxFrom(S);
    const day = {
      date: "2026-08-29",
      rows: [
        { empNo: "1250", status: "Present", reason: "", site: "X" },
        { empNo: "9999", status: "Present", reason: "", site: "X" },
        { empNo: "Toribio", status: "Present", reason: "", site: "X" },
      ],
    };
    const result = hr.commitDailyFromParsed(day, ctx);
    assert.ok(result.rec.rows.e1250);
    assert.equal(result.used, 1);
    assert.equal(result.unknown["9999"], 1);
    assert.ok(result.unknown.Toribio || result.unknown["?"]);
    assert.equal(Object.keys(result.rec.rows).length, 1);
  });

  it("1. approved leave register beats a timekeeper Absent", () => {
    S.leaves.lv1 = {
      id: "lv1",
      empId: "e1348",
      no: "LRF2026-0100",
      status: "Approved",
      type: "SL",
      from: "2026-08-28",
      to: "2026-08-29",
      pay: 1,
    };
    const ctx = ctxFrom(S);
    const st = hr.effectiveStatus("e1348", "2026-08-29", "Absent", "AWOL", ctx);
    assert.equal(st, "Leave with Pay");
    const excuse = hr.absenceExcuse("e1348", "2026-08-29", "AWOL", ctx);
    assert.equal(excuse.kind, "register");
    assert.equal(hr.dayCredit(st, { s: "Absent", r: "AWOL" }, "e1348", "2026-08-29", ctx), 1);
    S.daily.d20260829 = {
      id: "d20260829",
      date: "2026-08-29",
      rows: { e1348: { s: "Absent", r: "AWOL" } },
    };
    const people = hr.personSummaries(["2026-08"], ctx);
    const raffy = people.find((p) => p.empId === "e1348");
    assert.equal(raffy.absent, 0);
    assert.equal(raffy.leave, 1);
    assert.equal(raffy.excused, 1);
  });

  it("2. LRF citation including a wrapped 0123) line is employee-scoped", () => {
    S.daily.d20260828 = {
      id: "d20260828",
      date: "2026-08-28",
      rows: {
        e1348: { s: "Absent", r: "Approved Leave (LRF2026 - 0123)" },
        e1250: { s: "Absent", r: "no show" },
      },
    };
    S.daily.d20260829 = {
      id: "d20260829",
      date: "2026-08-29",
      rows: {
        e1348: { s: "Absent", r: "0123)" },
        e1250: { s: "Absent", r: "0123)" },
      },
    };
    const ctx = ctxFrom(S);
    hr.invalidateLrf();
    assert.equal(
      hr.effectiveStatus("e1348", "2026-08-28", "Absent", "Approved Leave (LRF2026 - 0123)", ctx),
      "Leave"
    );
    assert.equal(hr.effectiveStatus("e1348", "2026-08-29", "Absent", "0123)", ctx), "Leave");
    const wrap = hr.absenceExcuse("e1348", "2026-08-29", "0123)", ctx);
    assert.ok(wrap);
    assert.equal(wrap.kind, "report");
    assert.equal(wrap.wrapped, true);
    assert.equal(wrap.no, "LRF2026-0123");
    assert.equal(
      hr.effectiveStatus("e1250", "2026-08-29", "Absent", "0123)", ctx),
      "Absent",
      "another employee's wrapped tail must not inherit the citation"
    );
    const people = hr.personSummaries(["2026-08"], ctx);
    const raffy = people.find((p) => p.empId === "e1348");
    const toribio = people.find((p) => p.empId === "e1250");
    assert.equal(raffy.absent, 0);
    assert.equal(raffy.leave, 2);
    assert.equal(toribio.absent, 2);
    assert.equal(toribio.leave, 0);
  });

  it("3. not-filed and a bare number stay unexcused (grey / red, not leave)", () => {
    const ctx = ctxFrom(S);
    assert.equal(
      hr.effectiveStatus("e1353", "2026-08-29", "Absent", "AWOL (not filed)", ctx),
      "Absent"
    );
    assert.equal(hr.absenceExcuse("e1353", "2026-08-29", "AWOL (not filed)", ctx), null);
    assert.equal(hr.effectiveStatus("e1353", "2026-08-29", "Absent", "4567)", ctx), "Absent");
    assert.equal(hr.absenceExcuse("e1353", "2026-08-29", "4567)", ctx), null);
    assert.ok(hr.reportSaysNotFiled("sick (not filed)"));
  });

  it("4–5. coverage excludes Sunday and flags a month under 80%", () => {
    S.daily.d20260803 = { id: "d20260803", date: "2026-08-03", rows: { e1250: { s: "Present" } } };
    S.daily.d20260804 = { id: "d20260804", date: "2026-08-04", rows: { e1250: { s: "Present" } } };
    const ctx = ctxFrom(S);
    const cov = hr.dailyCoverage(2026, ctx);
    const aug = cov.find((c) => c.month === "2026-08");
    assert.ok(aug);
    assert.ok(aug.workdays >= 26 && aug.workdays <= 27, "Aug 2026 has 26 Mon–Sat days through the 31st");
    assert.ok(!aug.missing.includes("2026-08-02"), "2 Aug 2026 is a Sunday");
    assert.ok(!aug.missing.includes("2026-08-30"), "30 Aug 2026 is a Sunday");
    assert.equal(aug.filed, 2);
    assert.ok(aug.pct < 80);
    assert.equal(aug.thin, true);
    const window = hr.coverageForMonths(["2026-08"], ctx);
    assert.equal(window.thin, true);
    assert.equal(window.filed, 2);
  });

  it("6. holiday premium eligible is not granted until HR ticks hol", () => {
    assert.equal(hr.holEligible("Regular Holiday"), true);
    assert.equal(hr.holEligible("Special Holiday"), true);
    assert.equal(hr.holEligible("Present"), false);
    assert.equal(hr.holidayGranted({ s: "Regular Holiday" }), false);
    assert.equal(hr.holidayGranted({ s: "Regular Holiday", hol: true }), true);
    S.daily.d20260821 = {
      id: "d20260821",
      date: "2026-08-21",
      rows: {
        e1250: { s: "Regular Holiday", r: "", hol: false },
        e1353: { s: "Regular Holiday", r: "", hol: true },
      },
    };
    const people = hr.personSummaries(["2026-08"], ctxFrom(S));
    const a = people.find((p) => p.empId === "e1250");
    const b = people.find((p) => p.empId === "e1353");
    assert.equal(a.holiday, 1);
    assert.equal(a.holEligible, 1);
    assert.equal(a.premiumDays, 0);
    assert.equal(b.premiumDays, 1);
  });

  it("7. late is a full day of credit; payroll cannot overwrite the day field", () => {
    assert.equal(hr.dayCredit("Present/Late"), 1);
    assert.equal(hr.dayCredit("Present"), 1);
    assert.equal(hr.dayCredit("Absent"), 0);
    assert.equal(hr.dayCredit("Leave"), 0);
    assert.equal(hr.dayCredit("Leave with Pay"), 1);
    assert.equal(hr.dayCredit("Half Day"), 0.5);
    const row = { s: "Present/Late", r: "traffic", day: 1 };
    assert.equal(hr.dayVal(row), 1);
    assert.equal(hr.payrollMustNotOverride(row, 0), true);
    assert.equal(hr.applyPayrollDaysToAttendance().blocked, true);
    const merged = hr.commitDailyFromParsed(
      {
        date: "2026-08-29",
        rows: [{ empNo: "1250", status: "Present/Late", reason: "traffic", day: 0, fromPayroll: true }],
      },
      ctxFrom(S)
    );
    assert.equal(merged.rec.rows.e1250.day, undefined);
  });

  it("JSON paste uses the sample shape, maps empNo, and merges into DailyReport", async () => {
    const ctx = ctxFrom(S);
    const stats = await hr.importAttendanceJson(sampleJson(), ctx);
    assert.equal(stats.days, 1);
    assert.equal(stats.rows, 3);
    const rec = ctx.daily.d20260829;
    assert.ok(rec);
    assert.equal(rec.id, "d20260829");
    assert.equal(rec.date, "2026-08-29");
    assert.equal(rec.source, "08.29.2026.pdf");
    assert.equal(rec.fixed, true);
    assert.equal(rec.rows.e1250.s, "Present");
    assert.equal(rec.rows.e1250.site, "CTU BARILI");
    assert.equal(rec.rows.e1348.s, "Absent");
    assert.match(rec.rows.e1348.r, /LRF2026/);
    assert.equal(rec.rows.e1353.s, "Present/Late");
    assert.equal(hr.effectiveStatus("e1348", rec.date, rec.rows.e1348.s, rec.rows.e1348.r, ctx), "Leave");

    rec.rows.e1250.hol = true;
    rec.rows.e1250.ot = 2;
    const again = await hr.importAttendanceJson(
      [
        {
          date: "2026-08-29",
          rows: [{ empNo: "1250", status: "Present", reason: "updated", site: "TAWASON" }],
        },
      ],
      ctx
    );
    assert.equal(again.merged, 1);
    assert.equal(ctx.daily.d20260829.rows.e1250.r, "updated");
    assert.equal(ctx.daily.d20260829.rows.e1250.site, "TAWASON");
    assert.equal(ctx.daily.d20260829.rows.e1250.hol, true);
    assert.equal(ctx.daily.d20260829.rows.e1250.ot, 2);
    assert.equal(ctx.daily.d20260829.rows.e1348.s, "Absent");
  });

  it("twin-notice keeps late and absence on separate strands; AWOL only on consecutive filed days", () => {
    S.daily.d20260824 = {
      id: "d20260824",
      date: "2026-08-24",
      rows: { e1353: { s: "Absent", r: "" } },
    };
    S.daily.d20260825 = {
      id: "d20260825",
      date: "2026-08-25",
      rows: { e1353: { s: "Absent", r: "" } },
    };
    S.daily.d20260826 = {
      id: "d20260826",
      date: "2026-08-26",
      rows: { e1353: { s: "Absent", r: "" } },
    };
    S.daily.d20260827 = {
      id: "d20260827",
      date: "2026-08-27",
      rows: { e1353: { s: "Present/Late", r: "traffic" } },
    };
    S.daily.d20260828 = {
      id: "d20260828",
      date: "2026-08-28",
      rows: { e1353: { s: "Present/Late", r: "traffic" } },
    };
    S.daily.d20260829 = {
      id: "d20260829",
      date: "2026-08-29",
      rows: { e1353: { s: "Present/Late", r: "traffic" } },
    };
    const n = hr.noticeStrands("e1353", ["2026-08"], ctxFrom(S), {
      awolRun: 3,
      absentNTE: 1,
      lateReminder: 3,
      lateNTE: 5,
    });
    assert.equal(n.run.len, 3);
    assert.ok(n.acts.some((a) => a.strand === "absence" && a.key === "awol"));
    assert.ok(n.acts.some((a) => a.strand === "lateness" && a.doc === "MEMO"));
    assert.equal(n.lates.length, 3);
    assert.equal(n.absents.length, 3);

    delete S.daily.d20260825;
    const broken = hr.noticeStrands("e1353", ["2026-08"], ctxFrom(S), { awolRun: 3, absentNTE: 1 });
    assert.ok(broken.run.len < 3, "a day with no report does not count toward the AWOL run");
    assert.ok(!broken.acts.some((a) => a.key === "awol"));
  });

  it("name search matches both Last, First and First Last", () => {
    const e = emp("e1", "1250", "Armenio, Toribio D.");
    assert.equal(hr.nameMatches(e, "toribio armenio"), true);
    assert.equal(hr.nameMatches(e, "Armenio"), true);
    assert.equal(hr.nameMatches(e, "1250"), true);
    assert.equal(hr.nameMatches(e, "Pedrano"), false);
  });

  it("matches employees through empList when S is not on window", async () => {
    const employees = {
      e1250: emp("e1250", "1250", "Armenio, Toribio D."),
      e1348: emp("e1348", "1348", "Manolong, Raffy"),
      e1353: emp("e1353", "1353", "Pedrano, Jaica M."),
    };
    const daily = {};
    const windowLike = {
      empList() {
        return Object.values(employees);
      },
      async put(coll, id, obj) {
        if (coll === "daily") daily[id] = obj;
      },
    };
    windowLike.window = windowLike;
    const live = loadAttendance(windowLike);
    const stats = await live.importAttendanceJson(sampleJson());
    assert.equal(stats.rows, 3);
    assert.equal(stats.days, 1);
    assert.equal(daily.d20260829.rows.e1348.s, "Absent");
    assert.equal(
      live.effectiveStatus("e1348", "2026-08-29", "Absent", "Approved Leave (LRF2026 - 0123)", {
        employees,
        leaves: {},
        daily,
        today: "2026-08-31",
      }),
      "Leave"
    );
  });

  it("rejects invalid JSON paste payloads", () => {
    assert.throws(() => hr.normalizeImportPayload("not json"), /not valid JSON/);
    assert.throws(() => hr.normalizeImportPayload({ foo: 1 }), /array of daily reports/);
    assert.throws(() => hr.normalizeImportPayload([{ rows: [] }]), /no date/);
  });
});

describe("hr-attendance companion wiring", () => {
  it("is loaded by the shim and not referenced from the artifact HTML", () => {
    const shim = fs.readFileSync(path.join(__dirname, "../public/claude-shim.js"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(shim, /hr-attendance\.js/);
    assert.match(shim, /data-hr-attendance/);
    assert.doesNotMatch(html, /hr-attendance\.js/);
  });

  it("installs paste-door chrome on the daily and analytics screens", () => {
    const created = [];
    const nodes = [];
    function el(tag, attrs) {
      const node = {
        tag: String(tag).toLowerCase(),
        tagName: String(tag).toUpperCase(),
        attrs: Object.assign({}, attrs),
        children: [],
        parentNode: null,
        className: "",
        id: (attrs && attrs.id) || "",
        textContent: "",
        innerHTML: "",
        style: {},
        options: [],
        onclick: null,
        listeners: {},
        querySelector(sel) {
          if (sel.startsWith("#") && this.id === sel.slice(1)) return this;
          if (sel === "[data-dms]" && this.attrs && this.attrs["data-dms"]) return this;
          for (const child of this.children) {
            const hit = child.querySelector(sel);
            if (hit) return hit;
          }
          return null;
        },
        querySelectorAll(sel) {
          const out = [];
          if (sel.startsWith("#") && this.id === sel.slice(1)) out.push(this);
          if (sel === "[data-dms]" && this.attrs && this.attrs["data-dms"]) out.push(this);
          if (sel === ".sect-h h2" && this.tagName === "H2" && this.parentNode && String(this.parentNode.className).includes("sect-h")) {
            out.push(this);
          }
          this.children.forEach((c) => {
            out.push.apply(out, c.querySelectorAll(sel));
          });
          return out;
        },
        closest(sel) {
          let cur = this;
          while (cur) {
            if (sel === ".row" && String(cur.className).split(/\s+/).includes("row")) return cur;
            if (sel === "table" && cur.tagName === "TABLE") return cur;
            if (sel === "tr" && cur.tagName === "TR") return cur;
            if (sel === "td" && cur.tagName === "TD") return cur;
            if (sel === ".sect-h" && String(cur.className).split(/\s+/).includes("sect-h")) return cur;
            cur = cur.parentNode;
          }
          return null;
        },
        appendChild(child) {
          child.parentNode = this;
          this.children.push(child);
          return child;
        },
        insertBefore(child, before) {
          child.parentNode = this;
          const idx = this.children.indexOf(before);
          if (idx < 0) this.children.push(child);
          else this.children.splice(idx, 0, child);
          return child;
        },
        insertAdjacentElement(where, child) {
          if (where === "afterend" && this.parentNode) {
            const idx = this.parentNode.children.indexOf(this);
            child.parentNode = this.parentNode;
            this.parentNode.children.splice(idx + 1, 0, child);
          }
          return child;
        },
        addEventListener(type, fn) {
          this.listeners[type] = this.listeners[type] || [];
          this.listeners[type].push(fn);
        },
        setAttribute(name, value) {
          this.attrs[name] = String(value);
          if (name === "id") this.id = String(value);
        },
        getAttribute(name) {
          return this.attrs[name] == null ? null : this.attrs[name];
        },
      };
      if (attrs && attrs.id) node.id = attrs.id;
      nodes.push(node);
      return node;
    }

    const view = el("div", { id: "view" });
    const row = el("div", { class: "row" });
    row.className = "row";
    const date = el("input", { id: "dm-date" });
    const ia = el("button", { id: "ia-start" });
    const monthH = el("div", {});
    monthH.className = "sect-h";
    const h2 = el("h2", {});
    h2.textContent = "Month by month";
    const monthCard = el("div", {});
    monthCard.className = "card";
    monthH.appendChild(h2);
    row.appendChild(date);
    row.appendChild(ia);
    view.appendChild(row);
    view.appendChild(monthH);
    view.appendChild(monthCard);
    date.closest = function (sel) {
      return sel === ".row" ? row : null;
    };

    const byId = {
      view,
      "dm-date": date,
      "ia-start": ia,
      "hr-attendance-styles": null,
    };

    const document = {
      readyState: "complete",
      head: el("head"),
      documentElement: el("html"),
      body: el("body"),
      getElementById(id) {
        if (id === "view") return view;
        if (id === "dm-date") return date;
        if (id === "ia-start") return ia;
        if (id === "hr-attendance-styles") return byId["hr-attendance-styles"];
        if (id === "hr-att-summary") return view.querySelector("#hr-att-summary");
        return null;
      },
      querySelector(sel) {
        if (sel === "#dm-date") return date;
        if (sel === "#ia-start") return ia;
        if (sel === "#view") return view;
        if (sel === "#hr-att-summary") return view.querySelector("#hr-att-summary");
        return view.querySelector(sel);
      },
      querySelectorAll(sel) {
        if (sel === "#view [data-dms]") return [];
        if (sel === "#view .tw table") return [];
        return view.querySelectorAll(sel);
      },
      createElement(tag) {
        const node = el(tag);
        created.push(node);
        return node;
      },
      addEventListener() {},
    };

    const windowLike = {
      document,
      S: {
        ui: { view: "insights", insightMonths: 6, insightMonth: "2026-08" },
        daily: {
          d20260829: {
            id: "d20260829",
            date: "2026-08-29",
            rows: { e1250: { s: "Present", r: "" } },
          },
        },
        employees: { e1250: emp("e1250", "1250", "Armenio, Toribio D.") },
        leaves: {},
      },
      TODAY: "2026-08-31",
      lastMonths() {
        return ["2026-08"];
      },
      render() {},
    };
    windowLike.window = windowLike;

    const hr = loadAttendance(windowLike);
    hr.install(windowLike);

    assert.ok(row.children.some((c) => c.id === "hr-att-paste-daily"));
    assert.ok(row.children.some((c) => c.id === "hr-att-paste-insights"));
    const summary = view.children.find((c) => c.id === "hr-att-summary");
    assert.ok(summary, "summary table is injected on analytics");
    assert.match(summary.innerHTML, /Manpower attendance summary/);
    assert.match(summary.innerHTML, /1250/);
    assert.equal(typeof hr.openPasteDoor, "function");
  });
});
