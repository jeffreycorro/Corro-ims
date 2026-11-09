"use strict";

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const approversSrc = fs.readFileSync(path.join(__dirname, "../public/approvers.js"), "utf8");

function pageScript() {
  const open = html.indexOf("<script>\n(function(){");
  const end = html.lastIndexOf("})();");
  if (open < 0 || end < 0) throw new Error("page script not found");
  let src = html.slice(open + "<script>\n".length, end);
  const cut = src.indexOf("/* ============================ chrome ============================ */");
  if (cut < 0) throw new Error("chrome marker missing");
  src = src.slice(0, cut);
  src = src.replace(
    "function toast(msg){",
    "function toast(msg){ try{ globalThis.__toasts.push(String(msg)); }catch(e){} "
  );
  src += `
    globalThis.__api = {
      openReserve: openReserve,
      getS: function(){ return S; }
    };
  })();
  `;
  return src;
}

function createElement(tag) {
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    nodeType: 1,
    style: {},
    children: [],
    parentNode: null,
    attrs: {},
    listeners: {},
    className: "",
    id: "",
    textContent: "",
    innerHTML: "",
    value: "",
    placeholder: "",
    type: "",
    disabled: false,
    checked: false,
    hidden: false,
    title: "",
    name: "",
    src: "",
    href: "",
    alt: "",
    step: "",
    isConnected: false,
  };
  node.classList = {
    add() {},
    remove() {},
    toggle() {},
    contains(name) {
      return String(node.className || "").split(/\s+/).indexOf(name) >= 0;
    },
  };
  node.appendChild = (child) => {
    if (child == null) return child;
    node.children.push(child);
    child.parentNode = node;
    return child;
  };
  node.removeChild = (child) => {
    node.children = node.children.filter((item) => item !== child);
    if (child) child.parentNode = null;
    return child;
  };
  node.insertBefore = (child) => node.appendChild(child);
  node.addEventListener = (type, fn) => {
    node.listeners[type] = node.listeners[type] || [];
    node.listeners[type].push(fn);
  };
  node.removeEventListener = () => {};
  node.setAttribute = (name, value) => {
    node.attrs[name] = String(value);
    if (name === "id") node.id = String(value);
  };
  node.getAttribute = (name) => {
    if (Object.prototype.hasOwnProperty.call(node.attrs, name)) return node.attrs[name];
    if (name === "id") return node.id || null;
    return null;
  };
  node.remove = () => {
    if (node.parentNode) node.parentNode.removeChild(node);
  };
  node.replaceWith = (next) => {
    const parent = node.parentNode;
    if (!parent) return;
    const at = parent.children.indexOf(node);
    if (at >= 0) parent.children.splice(at, 1, next);
    else parent.children.push(next);
    if (next) next.parentNode = parent;
    node.parentNode = null;
  };
  node.focus = () => {};
  node.click = () => {
    if (node.disabled) return Promise.resolve(false);
    const ev = {
      type: "click",
      target: node,
      currentTarget: node,
      preventDefault() {},
      stopPropagation() {},
    };
    const fns = (node.listeners.click || []).slice();
    return Promise.all(fns.map((fn) => Promise.resolve().then(() => fn(ev)))).then(() => true);
  };
  node.dispatch = (type) => {
    const ev = {
      type: type,
      target: node,
      currentTarget: node,
      preventDefault() {},
      stopPropagation() {},
    };
    (node.listeners[type] || []).slice().forEach((fn) => fn(ev));
  };
  node.querySelector = (sel) => find(node, sel, false);
  node.querySelectorAll = (sel) => collect(node, sel);
  node.contains = (other) => {
    let cur = other;
    while (cur) {
      if (cur === node) return true;
      cur = cur.parentNode;
    }
    return false;
  };
  node.closest = () => null;
  node.cloneNode = () => createElement(tag);
  node.getContext = () => null;
  return node;
}

function matchSel(node, sel) {
  sel = String(sel || "");
  if (sel.charAt(0) === "#") return node.id === sel.slice(1);
  const attr = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(sel);
  if (attr) {
    const value = node.getAttribute(attr[1]);
    if (attr[2] == null) return value != null && value !== "";
    return value === attr[2];
  }
  if (sel.charAt(0) === ".") {
    return String(node.className || "").split(/\s+/).indexOf(sel.slice(1)) >= 0;
  }
  return node.tagName === sel.toUpperCase();
}

function collect(root, sel) {
  const out = [];
  (root.children || []).forEach((child) => {
    if (!child || !child.tagName) return;
    if (matchSel(child, sel)) out.push(child);
    collect(child, sel).forEach((hit) => out.push(hit));
  });
  return out;
}

function find(root, sel) {
  return collect(root, sel)[0] || null;
}

function walk(node, fn) {
  fn(node);
  (node.children || []).forEach((child) => {
    if (child && child.tagName) walk(child, fn);
  });
}

function memoryStorage() {
  const data = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    clear() {
      Object.keys(data).forEach((key) => delete data[key]);
    },
  };
}

function browser() {
  const document = {
    readyState: "complete",
    createElement,
    createTextNode(text) {
      const node = createElement("#text");
      node.textContent = String(text == null ? "" : text);
      return node;
    },
    addEventListener() {},
    getElementById(id) {
      let found = null;
      walk(document.documentElement, (node) => {
        if (!found && node.id === id) found = node;
      });
      return found;
    },
    querySelector(sel) {
      return find(document.documentElement, sel);
    },
    querySelectorAll(sel) {
      return collect(document.documentElement, sel);
    },
  };
  document.documentElement = createElement("html");
  document.head = createElement("head");
  document.body = createElement("body");
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);
  const realSetTimeout = setTimeout;
  const realClearTimeout = clearTimeout;
  const sandbox = {
    document,
    console,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    setTimeout(fn, ms, ...args) {
      return realSetTimeout(() => {
        try {
          fn(...args);
        } catch (err) {
          sandbox.__lateErrors.push(err);
        }
      }, ms);
    },
    clearTimeout: realClearTimeout,
    setInterval() {
      return 0;
    },
    clearInterval() {},
    URL,
    URLSearchParams,
    Map,
    Set,
    Option(text, value) {
      const node = createElement("option");
      node.textContent = text;
      node.value = value == null ? text : value;
      return node;
    },
    Image() {
      return createElement("img");
    },
    location: { hostname: "example.test", pathname: "/", search: "", hash: "" },
    navigator: { userAgent: "test" },
    __toasts: [],
    __lateErrors: [],
    __mpAuth: {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

function reserve(over) {
  return Object.assign(
    {
      no: "12",
      vrfNo: "6412",
      date: "2026-11-09",
      kind: "job",
      veh: "DT-09",
      work: "REP",
      project: "Yard",
      scope: "Fan belt",
      budget: 2500,
      requestedBy: "Ana Cruz",
      status: "Requested",
      approvedBudget: null,
      approvedBy: "",
      approvedAt: "",
      decisionNote: "",
      vrfs: [],
      draftLines: [
        { cat: "Belt", item: "Fan belt", qty: 1, price: 2500, unit: "pc", supplier: "Auto Parts", work: "REP" },
      ],
    },
    over || {}
  );
}

function buttons(root) {
  const out = [];
  walk(root, (node) => {
    if (node.tagName === "BUTTON") out.push(node);
  });
  return out;
}

function decisionButton(root) {
  return buttons(root).find((node) => node.getAttribute("data-approve-decision") === "1") || null;
}

function field(root, placeholder) {
  let found = null;
  walk(root, (node) => {
    if (!found && node.tagName === "INPUT" && node.placeholder === placeholder) found = node;
  });
  return found;
}

function reason(root) {
  let found = null;
  walk(root, (node) => {
    if (!found && node.getAttribute && node.getAttribute("data-approve-reason") === "1") found = node;
  });
  return found;
}

let page;
let approvers;

describe("Motorpool Approve click", () => {
  before(() => {
    page = browser();
    vm.runInNewContext(approversSrc, page, { filename: "approvers.js" });
    approvers = page.MotorpoolApprovers;
    vm.runInNewContext(pageScript(), page, { filename: "index.html" });
  });

  beforeEach(() => {
    page.MotorpoolApprovers = approvers;
    page.__mpAuth = {};
    page.__toasts.length = 0;
    page.__lateErrors.length = 0;
    page.localStorage.clear();
    const sheet = page.document.getElementById("rsvSheet");
    if (sheet) sheet.remove();
    const state = page.__api.getS();
    state.db = null;
    state.office = true;
    state.officePass = "kept-secret";
    state.view = "yard";
    state.ready = true;
    state.reserves = [reserve()];
    state.ledger = {};
    state.vehicles = [{ code: "DT-09", desc: "Dump truck" }];
    state.parts = [];
    state.suppliers = [];
    state.projects = [];
    state.worktypes = [];
    state.issued = { numbers: {} };
    state.photoCounts = {};
    state.rsvYears = ["2026"];
    state.cfg = { nextVrf: 6413, nextReserve: 13, pass: "h-office", varianceTol: 0.1, driveFolder: "" };
    state.esigs = {};
    state._approvingRsv = "";
  });

  it("loads the approver roster before the page that calls it", () => {
    const inlineAt = html.indexOf("<script>\n(function(){");
    const head = html.slice(0, inlineAt);
    assert.match(head, /<script src="\/approvers\.js"><\/script>/);
    const inline = html.slice(inlineAt);
    assert.match(inline, /function namedApprover\(raw\)/);
    const helper = inline.slice(inline.indexOf("function namedApprover"), inline.indexOf("function appendVarianceApproval"));
    assert.equal((inline.match(/MotorpoolApprovers\.resolveApprover/g) || []).length, 2);
    assert.equal((helper.match(/MotorpoolApprovers\.resolveApprover/g) || []).length, 2);
    assert.match(inline, /namedApprover\(aw\.value\)/);
    assert.match(inline, /namedApprover\(name\.value\)/);
    assert.equal(page.MotorpoolApprovers.resolveApprover("Jeffrey").name, "Jeffrey James M. Corro");
    assert.equal(page.MotorpoolApprovers.resolveApprover("Carmel").name, "Carmel");
  });

  it("the old direct call threw and saved nothing when the roster script was missing", async () => {
    await assert.rejects(
      vm.runInNewContext(
        `(async function(){ "use strict"; return MotorpoolApprovers.resolveApprover("Jeffrey"); })()`,
        vm.createContext({}),
        { filename: "old-approve-click.js" }
      ),
      (err) => err && err.name === "ReferenceError"
    );
  });

  it("keeps Approve disabled until the name is Jeffrey or Carmel and the budget is above zero", () => {
    page.__api.openReserve("12", true);
    const root = page.document.getElementById("rsvSheet");
    const ok = decisionButton(root);
    const why = reason(root);
    assert.ok(ok);
    assert.equal(ok.disabled, true);
    assert.match(why.textContent, /Jeffrey James M\. Corro or Carmel/);
    assert.match(why.textContent, /Approved by/);

    const name = field(root, "Jeffrey James M. Corro or Carmel");
    name.value = "Noah";
    name.dispatch("input");
    assert.equal(ok.disabled, true);
    assert.match(why.textContent, /cannot approve/);

    name.value = "api";
    name.dispatch("input");
    assert.equal(ok.disabled, true);
    assert.match(why.textContent, /cannot be "api"/);

    name.value = "Jeffrey";
    name.dispatch("input");
    assert.equal(ok.disabled, false);
    assert.match(why.textContent, /Ready to approve as Jeffrey James M\. Corro/);

    const budget = collect(root, "input").find((node) => node.type === "number");
    budget.value = "0";
    budget.dispatch("input");
    assert.equal(ok.disabled, true);
    assert.match(why.textContent, /approved budget above zero/);
    assert.equal(page.__api.getS().reserves[0].status, "Requested");
  });

  it("does not offer Approve on the yard sheet", () => {
    page.__api.openReserve("12", false);
    const root = page.document.getElementById("rsvSheet");
    assert.equal(decisionButton(root), null);
    assert.equal(page.__api.getS().reserves[0].status, "Requested");
  });

  it("approves as Jeffrey when the roster is loaded, and stores his canonical name", async () => {
    page.__api.openReserve("12", true);
    const root = page.document.getElementById("rsvSheet");
    const ok = decisionButton(root);
    const name = field(root, "Jeffrey James M. Corro or Carmel");
    name.value = "Jeffrey Corro";
    name.dispatch("input");
    assert.equal(ok.disabled, false);
    const clicked = await ok.click();
    assert.equal(clicked, true);
    const saved = page.__api.getS().reserves.find((row) => String(row.no) === "12");
    assert.equal(saved.status, "Approved");
    assert.equal(saved.approvedBy, "Jeffrey James M. Corro");
    assert.equal(saved.approvedBudget, 2500);
    assert.match(saved.approvedAt, /^2026-11-09T/);
    assert.notEqual(saved.approvedBy, "api");
    const lines = page.__api.getS().ledger["2026-11"] || [];
    assert.equal(lines.length, 1);
    assert.equal(lines[0].vrf, "6412");
    assert.equal(lines[0].vstatus, "Open");
    assert.match(page.__toasts.join("\n"), /Approved at/);
  });

  it("approves as Carmel and does not approve a refused name", async () => {
    page.__api.getS().reserves = [reserve({ no: "13", vrfNo: "6413", budget: 800 })];
    page.__api.openReserve("13", true);
    let root = page.document.getElementById("rsvSheet");
    let ok = decisionButton(root);
    let name = field(root, "Jeffrey James M. Corro or Carmel");
    name.value = "Noah";
    name.dispatch("input");
    assert.equal(await ok.click(), false);
    assert.equal(page.__api.getS().reserves[0].status, "Requested");
    assert.equal(page.__api.getS().reserves[0].approvedBy, "");

    name.value = "Carmel";
    name.dispatch("input");
    assert.equal(ok.disabled, false);
    await ok.click();
    const saved = page.__api.getS().reserves.find((row) => String(row.no) === "13");
    assert.equal(saved.status, "Approved");
    assert.equal(saved.approvedBy, "Carmel");
    assert.equal(saved.approvedBudget, 800);
  });

  it("prefills a signed-in Jeffrey or Carmel and still requires the click", async () => {
    page.__mpAuth = { email: "jeffrey@corroconstruction.com" };
    page.__api.openReserve("12", true);
    const root = page.document.getElementById("rsvSheet");
    const name = field(root, "Jeffrey James M. Corro or Carmel");
    const ok = decisionButton(root);
    assert.equal(name.value, "Jeffrey James M. Corro");
    assert.equal(ok.disabled, false);
    assert.equal(page.__api.getS().reserves[0].status, "Requested");
    await ok.click();
    assert.equal(page.__api.getS().reserves.find((row) => row.no === "12").approvedBy, "Jeffrey James M. Corro");
  });

  it("does not prefill or enable Approve for a signed-in name that cannot approve", () => {
    page.__mpAuth = { name: "Noah", email: "noah@corroconstruction.com" };
    page.__api.openReserve("12", true);
    const root = page.document.getElementById("rsvSheet");
    const name = field(root, "Jeffrey James M. Corro or Carmel");
    assert.equal(name.value, "");
    assert.equal(decisionButton(root).disabled, true);
    assert.equal(page.__api.getS().reserves[0].status, "Requested");
  });

  it("refuses the click when the approver check is missing and does not approve", async () => {
    page.MotorpoolApprovers = undefined;
    page.__api.openReserve("12", true);
    const root = page.document.getElementById("rsvSheet");
    const ok = decisionButton(root);
    const name = field(root, "Jeffrey James M. Corro or Carmel");
    name.value = "Jeffrey";
    name.dispatch("input");
    assert.equal(ok.disabled, true);
    assert.match(reason(root).textContent, /Approver check did not load/);
    assert.equal(await ok.click(), false);
    ok.disabled = false;
    await ok.click();
    assert.equal(page.__api.getS().reserves[0].status, "Requested");
    assert.match(page.__toasts.join("\n"), /Nothing was approved/);
    assert.equal((page.__api.getS().ledger["2026-11"] || []).length, 0);
  });

  it("reads a peso-formatted asked amount into the budget field", () => {
    page.__api.getS().reserves = [reserve({ budget: "₱ 1,250.00" })];
    page.__api.openReserve("12", true);
    const root = page.document.getElementById("rsvSheet");
    const budget = collect(root, "input").find((node) => node.type === "number");
    assert.equal(budget.value, "1250");
    const name = field(root, "Jeffrey James M. Corro or Carmel");
    name.value = "Carmel";
    name.dispatch("input");
    assert.equal(decisionButton(root).disabled, false);
  });
});
