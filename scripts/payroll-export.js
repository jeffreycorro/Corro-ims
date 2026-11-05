#!/usr/bin/env node
"use strict";

/**
 * Read-only company payroll export.
 *
 * Loads the HR portal engine (hr-artifact/public/index.html + hr-payroll-sheet.js)
 * and a public.docs snapshot, then writes the same workbook the portal's Excel
 * button writes. It does not boot the portal, so it does not seed, migrate, or
 * call put/putMany. Nothing is saved, finalized, or published.
 *
 *   node scripts/payroll-export.js --snapshot hr_docs_snapshot.json --out ./payroll-parallel
 *
 * The three runs are weekly 15–21 Oct 2026, weekly 22–28 Oct 2026, and
 * semi-monthly 13–27 Oct 2026. A period that is still open on --as-of is
 * priced from the attendance in the snapshot and marked as in progress.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PORTAL = path.join(ROOT, "hr-artifact", "public");

const RUNS = [
  { kind: "weekly", from: "2026-10-15", to: "2026-10-21", file: "WEEKLY-PAYROLL-2026-10-15.xlsx" },
  { kind: "weekly", from: "2026-10-22", to: "2026-10-28", file: "WEEKLY-PAYROLL-2026-10-22.xlsx" },
  { kind: "semi", from: "2026-10-13", to: "2026-10-27", file: "ADMIN-PAYROLL-2026-10-13.xlsx" },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return fallback;
  return v;
}

function makeEl() {
  return {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    hidden: false,
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    children: [],
    childNodes: [],
    lastElementChild: { textContent: "" },
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) { return child; },
    removeChild(child) { return child; },
    remove() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    blur() {},
    click() {},
    select() {},
    setSelectionRange() {},
    dispatchEvent() { return true; },
    getBoundingClientRect() {
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    },
  };
}

function makeDocument() {
  return {
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return makeEl(); },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); },
    createTextNode(text) { return { textContent: text }; },
    body: makeEl(),
    head: makeEl(),
    documentElement: makeEl(),
    readyState: "complete",
  };
}

function portalSource() {
  const html = fs.readFileSync(path.join(PORTAL, "index.html"), "utf8");
  const sheetTag = html.indexOf('<script src="/hr-payroll-sheet.js"></script>');
  const open = html.indexOf("<script>", sheetTag);
  const strict = html.indexOf('"use strict";', open);
  const boot = html.indexOf("(async function boot(){", strict);
  if (strict < 0 || boot < 0) throw new Error("Could not find the portal script.");
  return html.slice(strict, boot);
}

function loadEngine() {
  const document = makeDocument();
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Intl,
    structuredClone,
    document,
    navigator: { userAgent: "payroll-export" },
    location: { hostname: "snapshot.local", href: "http://snapshot.local/", search: "" },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    addEventListener() {},
    removeEventListener() {},
    fetch: async (url) => {
      const u = String(url || "");
      if (u.indexOf("separated-roster.json") >= 0) {
        const body = fs.readFileSync(path.join(PORTAL, "separated-roster.json"), "utf8");
        return { ok: true, status: 200, json: async () => JSON.parse(body) };
      }
      throw new Error("Read-only export refused to fetch " + u);
    },
  };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(PORTAL, "hr-payroll-sheet.js"), "utf8"), context, {
    filename: "hr-payroll-sheet.js",
  });
  vm.runInContext(portalSource(), context, { filename: "index.html" });
  if (!context.hrPaySheet || typeof context.hrPaySheet.workbook !== "function") {
    throw new Error("Company workbook did not load.");
  }
  vm.runInContext(
    `
    put = function(){ throw new Error("Read-only export blocked put"); };
    putMany = function(){ throw new Error("Read-only export blocked putMany"); };
    drop = function(){ throw new Error("Read-only export blocked drop"); };
    putSettings = function(){ throw new Error("Read-only export blocked putSettings"); };
    `,
    context
  );
  return context;
}

function loadSnapshot(context, file) {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(rows)) throw new Error("Snapshot must be a list of {collection,id,data}.");
  const bags = {};
  let settings = null;
  rows.forEach((row) => {
    if (!row || !row.collection || row.id == null) return;
    if (row.collection === "meta" && String(row.id) === "settings") {
      settings = row.data || {};
      return;
    }
    const bag = bags[row.collection] || (bags[row.collection] = {});
    const data = row.data && typeof row.data === "object" ? row.data : { value: row.data };
    if (!data.id) data.id = row.id;
    bag[row.id] = data;
  });
  context.__snap = bags;
  context.__settings = settings;
  const loaded = vm.runInContext(
    `
    const loaded = {};
    Object.keys(__snap).forEach(function(coll){
      if(!S[coll] || typeof S[coll] !== "object" || Array.isArray(S[coll])) return;
      const bag = __snap[coll];
      Object.keys(bag).forEach(function(id){ S[coll][id] = bag[id]; });
      loaded[coll] = Object.keys(bag).length;
    });
    if(__settings && typeof __settings === "object") S.settings = Object.assign(S.settings, __settings);
    S.db = null;
    S.ready = true;
    loaded;
    `,
    context
  );
  return { loaded, settings: settings || null, rows: rows.length };
}

function money(n, digits) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function mdCell(v) {
  return String(v == null ? "" : v).replace(/\|/g, "/").replace(/\n/g, " ");
}

function exceptionCodes(line) {
  const codes = {};
  (line.exceptions || []).forEach((ex) => {
    codes[ex.code || "other"] = (codes[ex.code || "other"] || 0) + 1;
  });
  return codes;
}

function runOne(context, spec, asOf) {
  const check = vm.runInContext(
    `payPeriod(${JSON.stringify(spec.kind)}, ${JSON.stringify(spec.from)})`,
    context
  );
  if (!check || check.from !== spec.from || check.to !== spec.to) {
    throw new Error(
      "Requested " + spec.kind + " " + spec.from + "–" + spec.to +
      " is not the portal period for that start (" + (check && check.from) + "–" + (check && check.to) + ")."
    );
  }
  const pack = vm.runInContext(
    `
    (function(){
      const kind = ${JSON.stringify(spec.kind)};
      const per = { from: ${JSON.stringify(spec.from)}, to: ${JSON.stringify(spec.to)} };
      const dates = payDates(per.from, per.to);
      const saved = payRunGet(kind, per.from, per.to);
      const all = payRunLines(kind, per, dates, saved);
      const lines = all.filter(payHasTime);
      const release = payRelease(kind, per) || "";
      const runId = payRunKey(kind, per.from, per.to);
      const missing = dates.filter(function(d){ return !dailyGet(d); });
      const filed = dates.filter(function(d){ return !!dailyGet(d); });
      const book = hrPaySheet.workbook({
        kind: kind, from: per.from, to: per.to, release: release,
        lines: lines, runId: runId
      });
      const bytes = hrPaySheet.toXlsx(book);
      const open = hrPaySheet.openExceptions(lines, {});
      return { lines: lines, release: release, runId: runId, missing: missing, filed: filed, dates: dates, bytes: bytes, open: open, saved: !!saved };
    })()
    `,
    context
  );
  const inProgress = spec.from <= asOf && asOf < spec.to;
  return Object.assign({ spec, inProgress }, pack);
}

function loggedOt(line) {
  return (Number(line.ot) || 0) + (Number(line.otNoForm != null ? line.otNoForm : line.otPending) || 0);
}

function lineRow(line) {
  return [
    mdCell(line.name || ""),
    mdCell(line.empNo || ""),
    money(line.days, 2),
    money(line.ot, 2),
    money(loggedOt(line), 2),
    money(line.gross, 2),
    money(line.late, 2),
    money(line.ca, 2),
    money(line.uniform, 2),
    money(line.sssLoan, 2),
    money(line.hdmfLoan, 2),
    money(line.sss, 2),
    money(line.phic, 2),
    money(line.hdmf, 2),
    money(line.ded, 2),
    money(line.net, 0),
  ].join(" | ");
}

function assumptions(report) {
  const s = report.settings || {};
  const ded = (s.ded) || { sss: 325, phic: 131.25, hdmf: 100 };
  const lines = [];
  lines.push("# Payroll comparison assumptions");
  lines.push("");
  lines.push("Read-only pass of HR build **" + report.build + "** (company sheet " + report.sheetVersion + ") against the public.docs snapshot" + (report.snapshotNote ? " " + report.snapshotNote : "") + ". Nothing was saved, finalized, or written back.");
  lines.push("");
  lines.push("The workbook is the portal Excel button: `payRunLines`, then people with days or overtime, then `hrPaySheet.workbook` / `toXlsx`, including the Audit sheet. Saved pay runs in the snapshot: **" + (report.payruns || 0) + "**.");
  lines.push("");
  lines.push("## Default statutory amounts");
  lines.push("");
  lines.push("Settings on the snapshot (`meta/settings`) are SSS **" + money(ded.sss, 2) + "**, PhilHealth **" + money(ded.phic, 2) + "**, Pag-IBIG **" + money(ded.hdmf, 2) + "** per semi-monthly period. A weekly run uses half of that, with the centavo dropped: **" + money(Math.floor(Number(ded.sss) / 2 * 100) / 100, 2) + "** / **" + money(Math.floor(Number(ded.phic) / 2 * 100) / 100, 2) + "** / **" + money(Math.floor(Number(ded.hdmf) / 2 * 100) / 100, 2) + "**. A blank 201 uses these figures. An explicit amount on the employee, including 0, wins. A signed refusal (govrefuse, kasabutan, or benefack) with no explicit amount is 0. Overtime multiplier `otPolicy` is **" + (s.otPolicy != null ? s.otPolicy : 1) + "** (100% of daily rate ÷ 8).");
  lines.push("");
  lines.push("No employee in this snapshot has `govEnroll` set. " + report.explicitDed + " employee record" + (report.explicitDed === 1 ? " has" : "s have") + " an explicit `ded` amount.");
  lines.push("");
  lines.push("## Late rule");
  lines.push("");
  lines.push("Time in after 8:15 counts from 8:00 at ₱1 per minute. Time in after 1:15 counts from 1:00 at ₱1. Seconds are dropped. A non-blank reason that is not marked \"(not excused)\" is ₱0. Undertime on a full day (credit at least 1) out before 17:00 is ₱1 per minute up to 60 minutes; past 60 minutes it is the nearest hour times the hourly rate. Net pay is ROUNDUP of gross minus deductions to the next peso.");
  lines.push("");
  lines.push("## Government-deduction skip");
  lines.push("");
  lines.push("A weekly period that contains the 27th pays SSS, PhilHealth, and Pag-IBIG at 0 unless that run has a typed statutory amount (`statTouched`). Semi-monthly runs do not use this skip. **Weekly 22–28 Oct 2026 contains 27 Oct**, so those three columns are 0 on that workbook. Weekly 15–21 Oct does not contain the 27th, so the weekly half applies. There is no saved pay run, so nothing was typed over.");
  lines.push("");
  lines.push("## Pay type inferred where blank");
  lines.push("");
  lines.push("Every employee record in the snapshot has a blank `payType` (" + report.blankPayType + " of " + report.employees + "). The portal then uses rate type: Monthly → semi-monthly, anything else → weekly. Employee IDs were blank too; the sheet shows CCD plus the digits of the employee number when there is one. Proposed ID numbers were not applied.");
  lines.push("");
  report.runs.forEach((run) => {
    lines.push("### " + run.title);
    lines.push("");
    if (run.inProgress) {
      lines.push("This period is still open on " + report.asOf + ". Attendance is whatever the snapshot already had. Days after that, and any day with no manpower file, pay nothing.");
      lines.push("");
    }
    lines.push("Release date " + (run.release || "(none)") + ". People with time: **" + run.lines.length + "**. Days with a manpower file: " + (run.filed.join(", ") || "none") + ". Days with no file: " + (run.missing.join(", ") || "none") + ".");
    lines.push("");
    lines.push("Pay type was inferred for all " + run.lines.length + " people on this run (" + run.inferred + " from rate type, " + run.explicitPayType + " from a stored pay type).");
    lines.push("");
    if (run.separated.length) {
      lines.push("Separated staff with pay in this period. A stored last day flags later paid days. A live status such as Project-based still keeps those days on the run:");
      lines.push("");
      run.separated.forEach((p) => {
        lines.push("- " + p);
      });
      lines.push("");
    } else {
      lines.push("No separated staff have pay on this run.");
      lines.push("");
    }
    lines.push("Open exceptions (not acknowledged; this export does not acknowledge or finalize): **" + run.open.length + "**.");
    lines.push("");
    Object.keys(run.byCode).sort().forEach((code) => {
      lines.push("- " + code + ": " + run.byCode[code]);
    });
    if (!Object.keys(run.byCode).length) lines.push("- none");
    lines.push("");
    if (run.byCode["missing-day"]) {
      lines.push("Each missing manpower day is flagged once per person on the run. The dates are listed above.");
      lines.push("");
    }
    if (run.sites.length) {
      lines.push("Unknown site strings (the attendance text is not exactly a project name; ADMINS is accepted):");
      lines.push("");
      run.sites.forEach((s) => lines.push("- " + mdCell(s.name) + ": " + s.n + " day flags"));
      lines.push("");
    }
    if (run.otPeople.length) {
      lines.push("OT with no approved request and form (logged hours, paid at 0):");
      lines.push("");
      run.otPeople.forEach((p) => lines.push("- " + mdCell(p.name) + ": " + p.n + " day" + (p.n === 1 ? "" : "s") + ", " + money(p.hours, 2) + " h"));
      lines.push("");
    }
    if (run.rateMissing.length) {
      lines.push("No rate in force: " + run.rateMissing.map(mdCell).join("; "));
      lines.push("");
    }
    if (run.caPeople.length) {
      lines.push("Cash advance deducted on this run: " + run.caPeople.map((p) => mdCell(p.name) + " " + money(p.amount, 2)).join("; ") + ".");
      lines.push("");
    }
    const govLabel = run.title.indexOf("Semi-monthly") === 0 ? "the semi-monthly figure" : "the weekly half";
    lines.push("Government columns: " + run.govHalf + " people at " + govLabel + ", " + run.govZero + " at 0" + (run.govOther ? ", " + run.govOther + " at another amount" : "") + ".");
    lines.push("");
    lines.push("| Employee | No. | Days | OT paid | OT logged | Gross | Late | CA | Uniform | SSS loan | Pag-IBIG loan | SSS | PhilHealth | Pag-IBIG | Deductions | Net |");
    lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    run.lines.forEach((line) => lines.push("| " + lineRow(line) + " |"));
    const T = run.totals;
    lines.push("| **Total** | | " + money(T.days, 2) + " | " + money(T.ot, 2) + " | " + money(run.logged, 2) + " | " + money(T.gross, 2) + " | " + money(T.late, 2) + " | " + money(T.ca, 2) + " | " + money(T.uniform, 2) + " | " + money(T.sssLoan, 2) + " | " + money(T.hdmfLoan, 2) + " | " + money(T.sss, 2) + " | " + money(T.phic, 2) + " | " + money(T.hdmf, 2) + " | " + money(T.ded, 2) + " | " + money(T.net, 0) + " |");
    lines.push("");
  });
  lines.push("## Notes that are not formula changes");
  lines.push("");
  lines.push("- The snapshot has no `payruns` documents. These three workbooks are parallel, not sequential: an approved advance with no plan rate is deducted again on every run that person appears on, because no earlier run has recorded the deduction. Do not add the cash-advance columns across the two weekly files.");
  lines.push("- Weekly manpower rows in this snapshot are mostly blank for time in and time out, so late and undertime are 0 except where a clock was typed. The semi-monthly late amount is that typed clock.");
  lines.push("- OT hrs on the company sheet are paid hours. Logged hours with no approved form stay in the Audit sheet at 0 pay. Paid OT on all three runs is 0.");
  lines.push("- The project list in the snapshot does not include 24HH0142 Labangon Chapel (Package B). A site string that is not exactly a project name flags unknown-site. The live portal would add that one project the next time it boots; this export does not.");
  lines.push("- The separated-roster file is consulted the same way the portal consults it (`loadKnownSep`) and is not written onto employee records.");
  lines.push("");
  return lines.join("\n");
}

function describeRun(context, result) {
  const lines = result.lines || [];
  const byCode = {};
  const sites = {};
  const otPeople = {};
  const rateMissing = {};
  (result.open || []).forEach((ex) => {
    const code = ex.code || "other";
    byCode[code] = (byCode[code] || 0) + 1;
    if (code === "unknown-site") {
      const m = /[“"]([^”"]+)[”"]/.exec(ex.text || "");
      const name = m ? m[1] : (ex.text || "");
      sites[name] = (sites[name] || 0) + 1;
    } else if (code === "ot-no-form") {
      const name = ex.name || "";
      const bag = otPeople[name] || (otPeople[name] = { name, n: 0 });
      bag.n += 1;
    } else if (code === "rate-missing") {
      rateMissing[ex.name || ""] = 1;
    }
  });
  const separated = [];
  const caPeople = [];
  let inferred = 0;
  let explicitPayType = 0;
  let logged = 0;
  let govHalf = 0;
  let govZero = 0;
  let govOther = 0;
  const fullSss = result.spec.kind === "weekly" ? 162.5 : 325;
  lines.forEach((line) => {
    logged += loggedOt(line);
    const sss = Number(line.sss) || 0;
    const phic = Number(line.phic) || 0;
    const hdmf = Number(line.hdmf) || 0;
    if (sss === 0 && phic === 0 && hdmf === 0) govZero += 1;
    else if (Math.abs(sss - fullSss) < 0.001) govHalf += 1;
    else govOther += 1;
    if ((Number(line.ca) || 0) > 0) caPeople.push({ name: line.name || "", amount: Number(line.ca) || 0 });
    const otBag = otPeople[line.name || ""];
    if (otBag) otBag.hours = loggedOt(line);
    const emp = vm.runInContext("S.employees[" + JSON.stringify(line.empId) + "]", context) || {};
    const stored = String(emp.payType || "").trim();
    if (stored) explicitPayType += 1;
    else inferred += 1;
    const status = String(emp.status || "");
    const sep = String(emp.separatedOn || "").slice(0, 10);
    const separatedStatus = /separat|resign/i.test(status);
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(sep);
    if ((separatedStatus || dated) && ((Number(line.gross) || 0) > 0 || (Number(line.days) || 0) > 0 || (Number(line.ot) || 0) > 0)) {
      separated.push(
        mdCell(line.name) +
        " — status " + (status || "(blank)") +
        (dated ? ", last day " + sep : ", no last day on the 201") +
        ", days " + money(line.days, 2) +
        ", gross " + money(line.gross, 2) +
        ", net " + money(line.net, 0)
      );
    }
  });
  const kindLabel = result.spec.kind === "semi" ? "Semi-monthly" : "Weekly";
  return {
    title: kindLabel + " " + result.spec.from + " to " + result.spec.to,
    inProgress: result.inProgress,
    release: result.release,
    lines,
    filed: result.filed,
    missing: result.missing,
    open: result.open || [],
    byCode,
    sites: Object.keys(sites).sort().map((name) => ({ name, n: sites[name] })),
    otPeople: Object.keys(otPeople).sort().map((name) => otPeople[name]),
    rateMissing: Object.keys(rateMissing).filter(Boolean).sort(),
    caPeople,
    logged,
    govHalf,
    govZero,
    govOther,
    separated,
    inferred,
    explicitPayType,
    totals: vm.runInContext("payLineSum(" + JSON.stringify(lines.map((L) => ({
      days: L.days, ot: L.ot, gross: L.gross, ded: L.ded, net: L.net, late: L.late, ca: L.ca,
      uniform: L.uniform, sssLoan: L.sssLoan, hdmfLoan: L.hdmfLoan, sss: L.sss, phic: L.phic, hdmf: L.hdmf,
      allowance: L.allowance, otPending: L.otPending
    }))) + ")", context),
  };
}

async function main() {
  const snapshot = arg("--snapshot", "");
  const outDir = arg("--out", path.join(process.cwd(), "payroll-parallel"));
  const snapshotNote = arg("--snapshot-note", "");
  if (!snapshot) {
    console.error("Usage: node scripts/payroll-export.js --snapshot <file.json> --out <dir> [--as-of YYYY-MM-DD] [--snapshot-note text]");
    process.exit(1);
  }
  const context = loadEngine();
  const asOf = arg("--as-of", "") || vm.runInContext("TODAY", context);
  const loaded = loadSnapshot(context, snapshot);
  await vm.runInContext("loadKnownSep()", context);
  fs.mkdirSync(outDir, { recursive: true });
  const runs = [];
  for (const spec of RUNS) {
    const result = runOne(context, spec, asOf);
    const file = path.join(outDir, spec.file);
    fs.writeFileSync(file, Buffer.from(result.bytes));
    const described = describeRun(context, result);
    runs.push(described);
    console.log(spec.file, described.lines.length, "people", "exceptions", described.open.length, "bytes", result.bytes.length);
  }
  const counts = vm.runInContext(
    `({
      build: BUILD,
      sheet: hrPaySheet.version,
      employees: Object.keys(S.employees).length,
      payruns: Object.keys(S.payruns||{}).length,
      blankPayType: Object.keys(S.employees).filter(function(id){ return !String((S.employees[id]&&S.employees[id].payType)||"").trim(); }).length,
      explicitDed: Object.keys(S.employees).filter(function(id){
        const d = S.employees[id] && S.employees[id].ded;
        return !!(d && (d.sss!=null && d.sss!=="" || d.phic!=null && d.phic!=="" || d.hdmf!=null && d.hdmf!==""));
      }).length,
      settings: S.settings
    })`,
    context
  );
  const md = assumptions({
    build: counts.build,
    sheetVersion: counts.sheet,
    snapshotNote,
    asOf,
    settings: counts.settings,
    employees: counts.employees,
    blankPayType: counts.blankPayType,
    explicitDed: counts.explicitDed,
    payruns: counts.payruns,
    runs,
  });
  const mdPath = path.join(outDir, "ASSUMPTIONS.md");
  fs.writeFileSync(mdPath, md);
  console.log("wrote", mdPath);
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
