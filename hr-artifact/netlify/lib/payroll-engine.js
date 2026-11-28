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

/* Supplied on the sandbox. Redeclaring them would hide the values loadEngine sets. */
const INJECTED = new Set(["S", "TODAY", "KNOWN_SEP", "SNAP_GEN"]);

const KEYWORDS = new Set(
  ("break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield await async of get set static from as true false null undefined NaN Infinity").split(" ")
);

const BUILTINS = new Set(
  ("Object Function Array String Number Boolean Symbol BigInt Math Date JSON Reflect Proxy Promise Map Set WeakMap WeakSet RegExp Error TypeError RangeError SyntaxError ReferenceError Intl eval isNaN isFinite parseInt parseFloat encodeURI encodeURIComponent decodeURI decodeURIComponent escape unescape Infinity NaN undefined console Buffer process TextEncoder TextDecoder URL URLSearchParams fetch Headers Request Response AbortController queueMicrotask structuredClone atob btoa setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame document window localStorage sessionStorage navigator location alert confirm prompt history screen performance crypto indexedDB FileReader Blob FormData Image Option Event CustomEvent DOMParser XMLHttpRequest MutationObserver getComputedStyle matchMedia addEventListener removeEventListener postMessage self global globalThis require module exports").split(" ")
);

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

function isIdentStart(ch) {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$";
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function regexAllowed(tokens) {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token.type === "ident") {
      return token.value === "return" || token.value === "typeof" || token.value === "case"
        || token.value === "throw" || token.value === "else" || token.value === "void"
        || token.value === "delete" || token.value === "in" || token.value === "of"
        || token.value === "yield" || token.value === "await" || token.value === "new"
        || token.value === "do" || token.value === "instanceof";
    }
    if (token.type === "punct") {
      return token.value !== ")" && token.value !== "]" && token.value !== "}";
    }
    return false;
  }
  return true;
}

function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  function push(type, value, start, end) {
    tokens.push({ type: type, value: value, start: start, end: end == null ? i : end });
  }
  function readString(quote) {
    const start = i;
    i += 1;
    while (i < n) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === quote) { i += 1; break; }
      i += 1;
    }
    push("string", "", start);
  }
  function readTemplate() {
    const start = i;
    i += 1;
    while (i < n) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "`") { i += 1; break; }
      if (src[i] === "$" && src[i + 1] === "{") {
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          if (src[i] === "'" || src[i] === '"') { readString(src[i]); continue; }
          if (src[i] === "`") { readTemplate(); continue; }
          if (src[i] === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i += 1; continue; }
          if (src[i] === "/" && src[i + 1] === "*") {
            i += 2;
            while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
            i += 2;
            continue;
          }
          if (src[i] === "{") depth += 1;
          else if (src[i] === "}") depth -= 1;
          if (depth > 0) i += 1;
        }
        if (src[i] === "}") i += 1;
        continue;
      }
      i += 1;
    }
    push("string", "", start);
  }
  function readRegex() {
    const start = i;
    i += 1;
    let klass = false;
    while (i < n) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "[") klass = true;
      else if (src[i] === "]") klass = false;
      else if (src[i] === "/" && !klass) { i += 1; break; }
      else if (src[i] === "\n") break;
      i += 1;
    }
    while (i < n && /[a-z]/i.test(src[i])) i += 1;
    push("regex", "", start);
  }
  while (i < n) {
    const ch = src[i];
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") { i += 1; continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i += 1; continue; }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') { readString(ch); continue; }
    if (ch === "`") { readTemplate(); continue; }
    if (ch === "/" && regexAllowed(tokens)) { readRegex(); continue; }
    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < n && isIdentPart(src[i])) i += 1;
      push("ident", src.slice(start, i), start);
      continue;
    }
    if ((ch >= "0" && ch <= "9") || (ch === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const start = i;
      i += 1;
      while (i < n && /[0-9a-fxoA-FXO._]/.test(src[i])) i += 1;
      push("number", "", start);
      continue;
    }
    push("punct", ch, i, i + 1);
    i += 1;
  }
  return tokens;
}

function inlineScript(html) {
  const marker = '<script src="/hr-bot-approve.js"></script>';
  const after = html.indexOf(marker);
  const open = html.indexOf("<script>", after < 0 ? 0 : after);
  const start = html.indexOf(">", open) + 1;
  const end = html.lastIndexOf("</script>");
  if (open < 0 || end <= start) throw new Error("The HR page script was not found.");
  return html.slice(start, end);
}

function topLevelStatements(script) {
  const tokens = tokenize(script);
  const statements = [];
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  function depth() { return brace + paren + bracket; }
  function bump(token, dir) {
    const value = token.value;
    if (value === "{" || value === "}") brace += dir;
    else if (value === "(" || value === ")") paren += dir;
    else if (value === "[" || value === "]") bracket += dir;
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "punct" && (token.value === "}" || token.value === ")" || token.value === "]")) {
      bump(token, -1);
      continue;
    }
    if (depth() === 0 && token.type === "ident") {
      let kind = "";
      let nameAt = i;
      if (token.value === "async" && tokens[i + 1] && tokens[i + 1].value === "function") {
        kind = "function";
        nameAt = i + 2;
      } else if (token.value === "function" || token.value === "class") {
        kind = token.value;
        nameAt = i + 1;
      } else if (token.value === "const" || token.value === "let" || token.value === "var") {
        kind = token.value;
        nameAt = i + 1;
      }
      if (kind && tokens[nameAt] && tokens[nameAt].type === "ident") {
        const start = token.start;
        let end = script.length;
        const openDepth = depth();
        i = nameAt;
        if (kind === "function" || kind === "class") {
          while (i < tokens.length && !(tokens[i].type === "punct" && tokens[i].value === "{")) {
            if (tokens[i].type === "punct") bump(tokens[i], tokens[i].value === "}" || tokens[i].value === ")" || tokens[i].value === "]" ? -1 : 1);
            i += 1;
          }
        }
        for (; i < tokens.length; i += 1) {
          const cur = tokens[i];
          if (cur.type === "punct" && (cur.value === "{" || cur.value === "(" || cur.value === "[")) bump(cur, 1);
          else if (cur.type === "punct" && (cur.value === "}" || cur.value === ")" || cur.value === "]")) bump(cur, -1);
          if (kind === "function" || kind === "class") {
            if (depth() === openDepth && cur.type === "punct" && cur.value === "}") {
              end = cur.end;
              break;
            }
          } else if (depth() === openDepth && cur.type === "punct" && cur.value === ";") {
            end = cur.end;
            break;
          }
        }
        const code = script.slice(start, end);
        const names = declaratorNames(tokens, nameAt, kind);
        statements.push({ names: names, code: code, start: start });
      }
    }
    if (token.type === "punct" && (token.value === "{" || token.value === "(" || token.value === "[")) bump(token, 1);
  }
  return statements;
}

function declaratorNames(tokens, nameAt, kind) {
  if (kind === "function" || kind === "class") return [tokens[nameAt].value];
  const names = [];
  let i = nameAt;
  let depth = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === "punct" && (token.value === "(" || token.value === "[" || token.value === "{")) depth += 1;
    else if (token.type === "punct" && (token.value === ")" || token.value === "]" || token.value === "}")) depth -= 1;
    else if (depth === 0 && token.type === "punct" && (token.value === "=" || token.value === ";" || token.value === ")")) {
      if (token.value !== ",") break;
    }
    if (depth === 0 && token.type === "ident" && (i === nameAt || (tokens[i - 1] && tokens[i - 1].value === ","))) {
      names.push(token.value);
    }
    if (depth === 0 && token.type === "punct" && token.value === ";") break;
    if (depth === 0 && token.type === "punct" && token.value === "=") {
      while (i < tokens.length) {
        const cur = tokens[i];
        if (cur.type === "punct" && (cur.value === "(" || cur.value === "[" || cur.value === "{")) depth += 1;
        else if (cur.type === "punct" && (cur.value === ")" || cur.value === "]" || cur.value === "}")) depth -= 1;
        else if (depth === 0 && cur.type === "punct" && (cur.value === "," || cur.value === ";")) break;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return names.length ? names : [tokens[nameAt].value];
}

function identifiers(code) {
  const tokens = tokenize(code);
  const names = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== "ident" || KEYWORDS.has(token.value)) continue;
    const prev = i > 0 ? tokens[i - 1] : null;
    if (prev && prev.type === "punct" && prev.value === ".") continue;
    names.push(token.value);
  }
  return names;
}

function companionNames() {
  const names = new Set();
  ["hr-project-pay.js", "hr-ot-forms.js"].forEach(function (file) {
    let src = "";
    try { src = fs.readFileSync(publicFile(file), "utf8"); } catch (e) { return; }
    const re = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
    const cre = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=/g;
    let match;
    while ((match = re.exec(src))) names.add(match[1]);
    while ((match = cre.exec(src))) names.add(match[1]);
  });
  return names;
}

function closureSource(html) {
  const script = inlineScript(html);
  const statements = topLevelStatements(script);
  const byName = new Map();
  statements.forEach(function (stmt) {
    stmt.names.forEach(function (name) {
      if (!byName.has(name)) byName.set(name, stmt);
    });
  });
  const included = [];
  const seenStmt = new Set();
  const seenName = new Set();
  const queue = SEEDS.slice();
  while (queue.length) {
    const name = queue.pop();
    if (seenName.has(name) || INJECTED.has(name)) continue;
    seenName.add(name);
    const stmt = byName.get(name);
    if (!stmt || seenStmt.has(stmt)) continue;
    if (stmt.names.every(function (n) { return INJECTED.has(n); })) continue;
    seenStmt.add(stmt);
    included.push(stmt);
    identifiers(stmt.code).forEach(function (id) {
      if (!seenName.has(id)) queue.push(id);
    });
  }
  if (!included.length) {
    throw new Error("No payroll statements indexed. declarations=" + statements.length + " map=" + byName.size + " firstFunctionDepth=" + firstFunctionDepth);
  }
  included.sort(function (a, b) { return a.start - b.start; });
  const names = [];
  included.forEach(function (stmt) {
    stmt.names.forEach(function (name) {
      if (!INJECTED.has(name)) names.push(name);
    });
  });
  const defined = new Set(names);
  INJECTED.forEach(function (name) { defined.add(name); });
  BUILTINS.forEach(function (name) { defined.add(name); });
  companionNames().forEach(function (name) { defined.add(name); });
  const unresolved = [];
  const seenFree = new Set();
  included.forEach(function (stmt) {
    identifiers(stmt.code).forEach(function (id) {
      if (defined.has(id) || seenFree.has(id)) return;
      seenFree.add(id);
      unresolved.push(id);
    });
  });
  return {
    source: included.map(function (stmt) { return stmt.code; }).join("\n"),
    functions: names.length,
    names: names,
    unresolved: unresolved.filter(function (id) { return byName.has(id); }).sort(),
    huge: included.filter(function (stmt) { return stmt.code.length > 15000; }).map(function (stmt) {
      return stmt.names[0] + ":" + stmt.code.length;
    }),
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
  cached._bindings = built.names;
  cached._unresolved = built.unresolved;
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
