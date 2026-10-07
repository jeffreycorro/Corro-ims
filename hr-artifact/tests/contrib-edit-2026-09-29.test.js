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

function loadPay() {
  const ctx = {
    S: {
      employees: {},
      daily: {},
      settings: { ded: { sss: 325, phic: 131.25, hdmf: 100 }, otPolicy: 1 },
      advances: {},
    },
    TODAY: "2026-09-29",
    KNOWN_SEP: null,
    STATUS_PENDING: "Has not yet arrived",
    num(n, d) {
      const x = Number(n) || 0;
      const p = d == null ? 2 : d;
      return x.toFixed(p);
    },
    normNo(v) {
      return String(v == null ? "" : v).replace(/[^0-9]/g, "");
    },
    empList() {
      return Object.values(ctx.S.employees);
    },
    isoDate(t) {
      return (
        t.getFullYear() +
        "-" +
        String(t.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(t.getDate()).padStart(2, "0")
      );
    },
    payDates(from, to) {
      const out = [];
      let d = from;
      while (d && d <= to) {
        out.push(d);
        d = ctx.addDays(d, 1);
      }
      return out;
    },
    dailyGet(d) {
      return ctx.S.daily["d" + String(d).replace(/-/g, "")] || null;
    },
    dayVal(r, k, fallback) {
      return r && r[k] != null && r[k] !== "" ? Number(r[k]) : fallback;
    },
    holCode() {
      return 0;
    },
    holRate() {
      return 0;
    },
    holEligible() {
      return false;
    },
    effectiveStatus(empId, date, raw) {
      return raw || "Present";
    },
    dailyPeople() {
      return [];
    },
    payCaDue() {
      return 0;
    },
    pesoCeil(n) {
      return Math.ceil(Number(n || 0) - 1e-9);
    },
    flipName(n) {
      const s = String(n || "");
      if (s.indexOf(",") < 0) return s;
      const p = s.split(",");
      return (p.slice(1).join(",") + " " + p[0]).replace(/\s+/g, " ").trim();
    },
  };
  const names = [
    "addDays",
    "weekStart",
    "semiPeriod",
    "payPeriod",
    "statusTextIsSeparated",
    "empStatusIsLive",
    "empStatusIsSeparated",
    "knownSepRec",
    "empSeparatedAsOf",
    "empHireDate",
    "empSeparationDate",
    "empNotYetHired",
    "rowHasEnteredData",
    "dailyRowShown",
    "dayCredit",
    "dailyId",
    "mergeDailyRowKeep",
    "normPersonName",
    "personMatchKey",
    "summaryPersonId",
    "dailyRecordFor",
    "dailyRowForEmp",
    "logStampKey",
    "otAmountFromHistory",
    "dailyOtEvents",
    "recoverableDailyOt",
    "payrollOtHours",
    "clockMinutes",
    "sessionIsHalf",
    "payDayBeforeHire",
    "payDayAmount",
    "payDayAfterSeparation",
    "summaryDayOt",
    "payDayRow",
    "dailyMonitorTotals",
    "payDaysFor",
    "manpowerPayTally",
    "payRate",
    "docSlotRefused",
    "govDeductionRefused",
    "empStatSet",
    "empStat",
    "contribSaveValue",
    "contribDedFromBoxes",
    "contribSource",
    "contribSourceLabel",
    "contribSourceClass",
    "payRunStatValue",
    "payStatKept",
    "payStat",
    "payStatForLine",
    "payTotals",
    "payLine",
    "contribHoldMatches",
    "keepContribHold",
    "contribByAttr",
    "contribBoxesFor",
    "contribSyncBoxes",
    "contribRemember",
    "contribPaintRow",
    "isHeavyImage",
    "settingsHasImage",
    "employeePersist",
  ];
  vm.runInNewContext(names.map((n) => extractFunction(html, n)).join("\n"), ctx);
  return ctx;
}

function box(cf, value, set) {
  return {
    value: value,
    dataset: { cf: cf, set: set ? "1" : "0" },
    className: "",
    textContent: "",
    getAttribute(name) {
      if (name === "data-cf") return cf;
      return null;
    },
  };
}

function mount(ctx, id, values) {
  const fields = {
    sss: box(id + "|sss", values.sss == null ? "" : String(values.sss), !!values.setSss),
    phic: box(id + "|phic", values.phic == null ? "" : String(values.phic), !!values.setPhic),
    hdmf: box(id + "|hdmf", values.hdmf == null ? "" : String(values.hdmf), !!values.setHdmf),
  };
  const pill = {
    className: "pill mut",
    textContent: "company figure",
    getAttribute(name) {
      return name === "data-csrc" ? id : null;
    },
  };
  const week = {
    textContent: "",
    getAttribute(name) {
      return name === "data-cweek" ? id : null;
    },
  };
  const nodes = [fields.sss, fields.phic, fields.hdmf, pill, week];
  ctx.document = {
    activeElement: values.focus || null,
    querySelectorAll(sel) {
      if (sel === "[data-cf]") return [fields.sss, fields.phic, fields.hdmf];
      if (sel === "[data-csrc]") return [pill];
      if (sel === "[data-cweek]") return [week];
      return [];
    },
  };
  ctx._fields = fields;
  ctx._pill = pill;
  ctx._week = week;
  ctx._nodes = nodes;
  return fields;
}

describe("2026-09-29b contributions — standing figures can be typed", () => {
  it("is build 2026-10-05a and the boxes are editable standing figures", () => {
    assert.match(html, /const BUILD = "2026-10-07b"/);
    const view = extractFunction(html, "viewContrib");
    assert.match(view, /data-cf=/);
    assert.match(view, /type="number"/);
    assert.match(view, /placeholder=/);
    assert.match(view, /contribSourceLabel/);
    assert.match(view, /Save standing figures/);
    assert.match(view, /Payroll Maker/);
    assert.match(view, /standing/);
    assert.match(view, /contribEngaged/);
    assert.match(view, /engaged/);
    assert.doesNotMatch(view, /activeEmps\(\)/);
    assert.doesNotMatch(view, /payRosterInclude/);
    assert.match(view, /id="c-save-msg"/);
    assert.doesNotMatch(view, /disabled/);
    assert.doesNotMatch(view, /readonly/);
    assert.match(html, /input\[data-cf\]::placeholder/);
    assert.match(extractFunction(html, "render"), /#view \[data-cf\]/);
    assert.match(extractFunction(html, "render"), /view==="contrib"/);
    assert.match(html, /on\("\[data-cf\]","input"/);
    assert.match(html, /contributions were not saved/);
    assert.match(html, /ok===false/);
    assert.match(extractFunction(html, "wireListFilter"), /style\.display/);
    assert.doesNotMatch(extractFunction(html, "wireListFilter"), /render\(/);
    assert.match(extractFunction(html, "employeePersist"), /_contribHold/);
    assert.match(extractFunction(html, "mergeIncomingDoc"), /keepContribHold/);
    assert.match(html, /function govDeductionRefused/);
  });

  it("keeps a typed amount, a clear, and an explicit 0, and payroll uses the standing figure", () => {
    const ctx = loadPay();
    const domingo = {
      id: "dom",
      empNo: "1101",
      name: "Monte Jr., Domingo",
      status: "Regular",
      rateType: "Daily",
      dailyRate: 570,
    };
    ctx.S.employees.dom = domingo;
    assert.equal(ctx.empStatSet(domingo, "sss"), false);
    assert.equal(ctx.empStat(domingo, "sss"), 325);
    assert.equal(ctx.empStat(domingo, "phic"), 131.25);
    assert.equal(ctx.empStat(domingo, "hdmf"), 100);
    assert.equal(ctx.contribSource(domingo), "company");
    assert.equal(ctx.contribSourceLabel("company"), "company figure");
    assert.equal(ctx.payStat("weekly", "sss", domingo) + ctx.payStat("weekly", "phic", domingo) + ctx.payStat("weekly", "hdmf", domingo), 278.12);

    const plain = (v) => JSON.parse(JSON.stringify(v));
    assert.deepEqual(
      plain(ctx.contribDedFromBoxes(null, {
        sss: { value: "", wasSet: false },
        phic: { value: "", wasSet: false },
        hdmf: { value: "", wasSet: false },
      })),
      {}
    );
    assert.deepEqual(
      plain(ctx.contribDedFromBoxes(null, {
        sss: { value: "200", wasSet: false },
        phic: { value: "40", wasSet: false },
        hdmf: { value: "0", wasSet: false },
      })),
      { sss: 200, phic: 40, hdmf: 0 }
    );
    assert.deepEqual(
      plain(ctx.contribDedFromBoxes(
        { sss: 200 },
        {
          sss: { value: "", wasSet: true },
          phic: { value: "", wasSet: false },
          hdmf: { value: "", wasSet: false },
        }
      )),
      { sss: 0 }
    );

    mount(ctx, "dom", { sss: "200", phic: "40", hdmf: "0" });
    assert.equal(ctx.contribRemember("dom"), true);
    assert.equal(domingo.ded.sss, 200);
    assert.equal(domingo.ded.phic, 40);
    assert.equal(domingo.ded.hdmf, 0);
    assert.equal(ctx.contribSource(domingo), "own");
    assert.equal(ctx._pill.textContent, "manual — standing");
    assert.equal(ctx._pill.className, "pill acc");
    assert.equal(ctx._fields.sss.value, "200");
    assert.equal(ctx._fields.hdmf.value, "0");
    assert.equal(ctx._fields.hdmf.dataset.set, "1");

    const fresh = ctx.payLine(domingo, "weekly", [], null);
    assert.equal(fresh.sss, 100);
    assert.equal(fresh.phic, 20);
    assert.equal(fresh.hdmf, 0);

    const semi = ctx.payLine(domingo, "semi", [], null);
    assert.equal(semi.sss, 200);
    assert.equal(semi.phic, 40);
    assert.equal(semi.hdmf, 0);

    const runOnly = ctx.payLine(domingo, "weekly", [], {
      statTouched: true,
      sss: 10,
      phic: 11,
      hdmf: 12,
    });
    assert.equal(runOnly.sss, 10);
    assert.equal(runOnly.phic, 11);
    assert.equal(runOnly.hdmf, 12);

    const storedRun = ctx.payLine(domingo, "semi", [], { sss: 1, phic: 2, hdmf: 3 });
    assert.equal(storedRun.sss, 1);
    assert.equal(storedRun.phic, 2);
    assert.equal(storedRun.hdmf, 3);
  });

  it("does not let a stale snapshot or a refusal rule wipe a standing edit", () => {
    const ctx = loadPay();
    const local = {
      id: "dom",
      status: "Regular",
      ded: { sss: 200, phic: 40, hdmf: 0 },
      _contribHold: { sss: 200, phic: 40, hdmf: 0 },
    };
    const stale = ctx.keepContribHold({ id: "dom", status: "Regular", name: "Monte Jr., Domingo" }, local);
    assert.equal(stale.ded.sss, 200);
    assert.equal(stale.ded.phic, 40);
    assert.equal(stale.ded.hdmf, 0);
    assert.equal(stale.status, "Regular");
    assert.ok(stale._contribHold);

    const caught = ctx.keepContribHold(
      { id: "dom", status: "Project-based", ded: { sss: 200, phic: 40, hdmf: 0 } },
      local
    );
    assert.equal(caught._contribHold, undefined);
    assert.equal(caught.ded.hdmf, 0);
    assert.equal(caught.status, "Project-based");

    const cleared = ctx.keepContribHold(
      { id: "dom", status: "Regular", ded: { sss: 325, phic: 131.25, hdmf: 100 } },
      { _contribHold: { _cleared: 1 } }
    );
    assert.equal(cleared.ded, undefined);
    assert.ok(cleared._contribHold);

    const emp = {
      id: "dom",
      name: "Monte Jr., Domingo",
      ded: { sss: 200, phic: 40, hdmf: 0 },
      _contribHold: { sss: 200 },
    };
    const stored = ctx.employeePersist(emp);
    assert.equal(stored._contribHold, undefined);
    assert.equal(stored.ded.sss, 200);
    assert.equal(emp._contribHold.sss, 200);

    const refused = {
      id: "kas",
      empNo: "9",
      name: "Kas, Aba",
      status: "Regular",
      rateType: "Daily",
      dailyRate: 500,
      docs: { kasabutan: { s: "on" } },
    };
    assert.equal(ctx.govDeductionRefused(refused), true);
    assert.equal(ctx.empStat(refused, "sss"), 0);
    assert.equal(ctx.contribSource(refused), "refused");
    assert.equal(ctx.contribSourceLabel("refused"), "refused (Kasabutan)");
    const line = ctx.payLine(refused, "weekly", [], { sss: 162.5, phic: 65.62, hdmf: 50 });
    assert.equal(line.sss, 0);
    assert.equal(line.phic, 0);
    assert.equal(line.hdmf, 0);

    refused.ded = { sss: 15, phic: 0, hdmf: 0 };
    assert.equal(ctx.contribSource(refused), "own");
    assert.equal(ctx.payLine(refused, "weekly", [], null).sss, 7.5);
    assert.equal(ctx.payLine(refused, "weekly", [], null).phic, 0);
  });
});
