"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PUBLIC_FILES = [
  "index.html",
  "hr-payroll-sheet.js",
  "hr-project-pay.js",
  "hr-ot-forms.js",
  "hr-decision-info.js",
  "separated-roster.json",
];

const SEEDS = [
  "payRunLines",
  "payPrintOptions",
  "payRelease",
  "payHasTime",
  "payPeople",
  "payDates",
  "signatorySig",
  "payRunKey",
  "companyPrintBlocked",
];

const ALLOW = /^(pay|ot|daily|emp|ca|hol|gov|stat|contrib|signatory|findHr|hrSig|leaveCa|companyPrint|cassie|fold|week|semi|addDays|addMonths|norm|person|summary|row|day|status|live|known|docSlot|clock|session|dateInput|hrStaff|namesClose|sigBlob|employeeSig|companySig|canon|leaver|recent|manpower|logStamp|recoverable|payroll|mergeDaily|effective|dayCredit|dayVal|holCode|holRate|holEligible|holiday|cmpEmp|daysFrom|longDate)/;

const PRELUDE = [
  "const isoDate = t => t.getFullYear()+\"-\"+String(t.getMonth()+1).padStart(2,\"0\")+\"-\"+String(t.getDate()).padStart(2,\"0\");",
  "const pesoCeil = n => Math.ceil(Number(n||0) - 1e-9);",
  "const flipName = n => { const p=String(n||\"\").split(\",\"); return p.length>1 ? (p[1].trim()+\" \"+p[0].trim()) : String(n||\"\"); };",
  "const HOL_PREMIUM = 0.3;",
  "const CA_PAY_CLOSED=[\"Cancelled\",\"Disapproved\",\"Liquidated\",\"Recovered\",\"Recovered from pay\"];",
  "function num(n,d){ const x=Number(n)||0; const p=d==null?2:d; return x.toFixed(p); }",
  "function esc(s){ return String(s==null?\"\":s).replace(/[&<>\"']/g, c => ({\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",'\"':\"&quot;\",\"'\":\"&#39;\"}[c])); }",
].join("\n");

function publicFile(name) {
  const candidates = [
    path.join(__dirname, "../../public", name),
    path.join(process.cwd(), "public", name),
    path.join(process.cwd(), "hr-artifact/public", name),
  ];
  if (process.env.LAMBDA_TASK_ROOT) {
    candidates.push(path.join(process.env.LAMBDA_TASK_ROOT, "public", name));
    candidates.push(path.join(process.env.LAMBDA_TASK_ROOT, name));
  }
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i] && fs.existsSync(candidates[i])) return candidates[i];
  }
  throw new Error("HR file is not in the function bundle: " + name);
}

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  if (start < 0) return "";
  if (src.slice(Math.max(0, start - 6), start).includes("async")) return "";
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
  return "";
}

function statementAt(src, start) {
  let depth = 0;
  let quote = "";
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    else if ((ch === ";" || ch === "\n") && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

function extractConst(src, name) {
  const needle = "const " + name + " =";
  let from = 0;
  while (from < src.length) {
    const at = src.indexOf(needle, from);
    if (at < 0) return "";
    const prev = at === 0 ? "\n" : src[at - 1];
    if (prev === "\n" || prev === ";" || prev === " ") {
      return statementAt(src, at);
    }
    from = at + needle.length;
  }
  return "";
}

function bareCalls(code) {
  const out = [];
  const re = /(^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let match;
  while ((match = re.exec(code))) out.push(match[2]);
  return out;
}

function closureSource(html) {
  const functions = new Set();
  const re = /function ([A-Za-z0-9_]+)\(/g;
  let found;
  while ((found = re.exec(html))) functions.add(found[1]);
  const haveFn = new Set();
  const skipped = new Set();
  const fnParts = [];
  const queue = SEEDS.slice();
  while (queue.length) {
    const name = queue.pop();
    if (haveFn.has(name) || skipped.has(name) || !functions.has(name)) continue;
    if (SEEDS.indexOf(name) < 0 && !ALLOW.test(name)) {
      skipped.add(name);
      continue;
    }
    const code = extractFunction(html, name);
    if (!code || code.length > 60000) {
      skipped.add(name);
      continue;
    }
    haveFn.add(name);
    fnParts.push(code);
    bareCalls(code).forEach(function (id) {
      if (functions.has(id) && !haveFn.has(id) && !skipped.has(id)) queue.push(id);
    });
  }
  /* Helpers the allow-list skipped, such as nameLastFirst, still run when
     payroll sorts or prices a line. Pull the small ones the loaded
     functions call, and the small ones those call, and stop there. */
  let grew = true;
  while (grew) {
    grew = false;
    const called = new Set();
    fnParts.forEach(function (code) {
      bareCalls(code).forEach(function (id) { called.add(id); });
    });
    called.forEach(function (id) {
      if (haveFn.has(id) || !functions.has(id)) return;
      const code = extractFunction(html, id);
      if (!code || code.length > 8000) return;
      haveFn.add(id);
      fnParts.push(code);
      grew = true;
    });
    fnParts.forEach(function (code) {
      const words = code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
      words.forEach(function (id) {
        if (haveFn.has(id) || !functions.has(id)) return;
        const extra = extractFunction(html, id);
        if (!extra || extra.length > 8000) return;
        haveFn.add(id);
        fnParts.push(extra);
        grew = true;
      });
    });
  }
  const body = fnParts.join("\n");
  const constParts = ["HOLIDAY_FIXED", "STATUS_PENDING"].map(function (id) {
    return extractConst(html, id);
  }).filter(Boolean);
  return {
    source: PRELUDE + "\n" + constParts.join("\n") + "\n" + body,
    functions: haveFn.size,
  };
}

function loadRoster(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const map = {};
    (data.employees || []).forEach(function (row) {
      const no = String((row && row.empNo) || "").replace(/[^0-9]/g, "");
      if (!no) return;
      map[no] = {
        separatedOn: (row && row.separatedOn) || "",
        separationReason: (row && row.separationReason) || "",
      };
    });
    return map;
  } catch (e) {
    return null;
  }
}

function blankStore() {
  return {
    employees: {},
    daily: {},
    settings: {},
    advances: {},
    leaves: {},
    projects: {},
    payruns: {},
    otplans: {},
    otreps: {},
    otreqs: {},
    ui: {},
  };
}

let cached = null;

function loadEngine() {
  if (cached) return cached;
  const html = fs.readFileSync(publicFile("index.html"), "utf8");
  const built = closureSource(html);
  const ctx = {
    console: console,
    Buffer: Buffer,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    Intl: Intl,
    Date: Date,
    Math: Math,
    JSON: JSON,
    Number: Number,
    String: String,
    Object: Object,
    Array: Array,
    RegExp: RegExp,
    isNaN: isNaN,
    parseFloat: parseFloat,
    parseInt: parseInt,
    S: blankStore(),
    TODAY: "",
    KNOWN_SEP: loadRoster(publicFile("separated-roster.json")),
    SNAP_GEN: 0,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.global = ctx;
  function run(file) {
    vm.runInNewContext(fs.readFileSync(publicFile(file), "utf8"), ctx, { filename: file });
  }
  run("hr-payroll-sheet.js");
  run("hr-decision-info.js");
  run("hr-project-pay.js");
  run("hr-ot-forms.js");
  vm.runInNewContext('"use strict";\n' + built.source, ctx, { filename: "payroll-engine.js" });
  if (typeof ctx.payRunLines !== "function") {
    throw new Error("Payroll engine did not load payRunLines.");
  }
  cached = ctx;
  cached._functionCount = built.functions;
  return cached;
}

function useStore(engine, store, today) {
  engine.S = store || blankStore();
  engine.S.ui = engine.S.ui || {};
  engine.S.settings = engine.S.settings || {};
  engine.S.employees = engine.S.employees || {};
  engine.S.daily = engine.S.daily || {};
  engine.S.advances = engine.S.advances || {};
  engine.S.projects = engine.S.projects || {};
  engine.S.payruns = engine.S.payruns || {};
  engine.S.otplans = engine.S.otplans || {};
  engine.S.otreps = engine.S.otreps || {};
  engine.TODAY = today || engine.TODAY || "";
}

function linesFor(store, kind, from, to, today) {
  const engine = loadEngine();
  useStore(engine, store, today);
  const per = { from: from, to: to };
  const dates = engine.payDates(from, to);
  const saved = (store.payruns && store.payruns[engine.payRunKey(kind, from, to)]) || null;
  const all = engine.payRunLines(kind, per, dates, saved) || [];
  return all.filter(engine.payHasTime);
}

function printHtmlFor(store, kind, per, lines, run, today) {
  const engine = loadEngine();
  useStore(engine, store, today);
  const release = engine.payRelease(kind, per);
  const options = engine.payPrintOptions(kind, per, lines, release, run);
  return engine.hrPaySheet.printHTML(options);
}

function printBlocked(store, today) {
  const engine = loadEngine();
  useStore(engine, store, today);
  if (typeof engine.companyPrintBlocked !== "function") return "";
  const settings = store.settings || {};
  const keys = [settings.payrollBy ? "evaluated" : "dept", "signatory"];
  return engine.companyPrintBlocked(keys) || "";
}

module.exports = {
  loadEngine,
  linesFor,
  printBlocked,
  printHtmlFor,
  publicFile,
};
