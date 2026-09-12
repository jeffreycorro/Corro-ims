"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadMemo(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-memo.js"), "utf8");
  vm.runInNewContext(src, windowLike);
}

function el(tag, attrs) {
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs: Object.assign({}, attrs),
    children: [],
    parentNode: null,
    value: "",
    disabled: false,
    className: "",
    classList: {
      remove(name) {
        node.className = String(node.className || "")
          .split(/\s+/)
          .filter((c) => c && c !== name)
          .join(" ");
      },
    },
    textContent: "",
    innerHTML: "",
    style: {},
    listeners: {},
    getAttribute(name) {
      return this.attrs[name] == null ? null : this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    matches(sel) {
      if (sel.startsWith("#")) return this.attrs.id === sel.slice(1);
      if (sel.startsWith(".")) {
        return String(this.className || "")
          .split(/\s+/)
          .includes(sel.slice(1));
      }
      const data = /^\[data-signed="([^"]+)"\]$/.exec(sel);
      if (data) return this.attrs["data-signed"] === data[1];
      if (sel === "a[href]" || sel === "a[href]") return this.tagName === "A" && this.attrs.href;
      if (sel === "input") return this.tagName === "INPUT";
      if (sel === ".ep-q") return String(this.className || "").split(/\s+/).includes("ep-q");
      if (sel === ".note") return String(this.className || "").split(/\s+/).includes("note");
      if (sel === ".stack") return String(this.className || "").split(/\s+/).includes("stack");
      if (sel === ".modal") return String(this.className || "").split(/\s+/).includes("modal");
      if (sel === ".modal-f") return String(this.className || "").split(/\s+/).includes("modal-f");
      if (sel === ".modal-h h3") return false;
      if (sel === "h3") return this.tagName === "H3";
      return false;
    },
    querySelector(sel) {
      if (this.matches(sel)) return this;
      if (sel === ".modal-h h3") {
        const h = this.querySelector(".modal-h");
        return h ? h.querySelector("h3") : null;
      }
      for (const child of this.children) {
        const hit = child.querySelector(sel);
        if (hit) return hit;
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      if (this.matches(sel) || (sel === "a[href]" && this.tagName === "A" && this.attrs.href)) {
        out.push(this);
      }
      if (sel === ".note" && String(this.className || "").split(/\s+/).includes("note")) {
        /* already pushed via matches */
      }
      for (const child of this.children) {
        out.push.apply(out, child.querySelectorAll(sel));
      }
      return out;
    },
    addEventListener(type, fn) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    },
    click() {
      (this.listeners.click || []).forEach((fn) => fn({ preventDefault() {} }));
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
  };
  if (attrs && attrs.id) node.attrs.id = attrs.id;
  if (attrs && attrs.class) node.className = attrs.class;
  return node;
}

function fakeDom() {
  const nodes = new Map();
  const head = el("head");
  const body = el("body");
  const docEl = el("html");
  docEl.appendChild(head);
  docEl.appendChild(body);

  const document = {
    readyState: "complete",
    body,
    documentElement: docEl,
    head,
    getElementById(id) {
      if (nodes.has(id)) return nodes.get(id);
      return body.querySelector("#" + id);
    },
    querySelector(sel) {
      return body.querySelector(sel);
    },
    querySelectorAll(sel) {
      return body.querySelectorAll(sel);
    },
    createElement(tag) {
      const node = el(tag);
      Object.defineProperty(node, "id", {
        get() {
          return this.attrs.id || "";
        },
        set(v) {
          this.attrs.id = v;
          nodes.set(v, this);
        },
      });
      return node;
    },
    addEventListener() {},
  };

  const window = {
    document,
    MutationObserver: class {
      observe() {}
    },
    S: { memos: {} },
    setTimeout,
    console,
  };
  window.window = window;
  return window;
}

function issuedEditor(w, extra) {
  extra = extra || {};
  const modal = el("div", { class: "modal" });
  const head = el("div", { class: "modal-h" });
  const h3 = el("h3");
  h3.textContent = "Memo C.M. 2026 - 15";
  head.appendChild(h3);
  const body = el("div", { class: "modal-b" });
  const stack = el("div", { class: "stack" });
  const num = el("input");
  num.disabled = true;
  num.value = extra.no || "C.M. 2026 - 15";
  const date = el("input", { id: "m-date", type: "date" });
  date.attrs.id = "m-date";
  date.attrs.type = "date";
  date.value = extra.date || "2026-07-09";
  const eff = el("input", { id: "m-eff", type: "date" });
  eff.attrs.id = "m-eff";
  eff.attrs.type = "date";
  eff.value = extra.effectivity || extra.date || "2026-07-09";
  const cat = el("select", { id: "m-cat" });
  cat.attrs.id = "m-cat";
  cat.value = extra.cat || "Announcement";
  const status = el("select", { id: "m-status" });
  status.attrs.id = "m-status";
  status.value = extra.status || "Issued";
  const aud = el("select", { id: "m-aud" });
  aud.attrs.id = "m-aud";
  aud.value = extra.audience || "All";
  const subj = el("input", { id: "m-subj" });
  subj.attrs.id = "m-subj";
  subj.value = extra.subject || "";
  const briefCard = el("div", { class: "card" });
  const brief = el("textarea", { id: "m-brief" });
  brief.attrs.id = "m-brief";
  briefCard.appendChild(brief);
  const bodyTa = el("textarea", { id: "m-body" });
  bodyTa.attrs.id = "m-body";
  bodyTa.value = extra.body || "";
  const signed = el("button");
  signed.attrs["data-signed"] = "memos";
  signed.attrs["data-signedid"] = extra.id || "m15";
  signed.textContent = "Upload the signed copy";
  if (extra.fromDrive !== false) {
    const drive = el("a");
    drive.attrs.href = extra.link || "https://drive.google.com/file/d/abc/view";
    drive.textContent = "open it";
    const paper = el("div", { class: "note" });
    paper.textContent = "This memorandum was issued on paper before the portal.";
    paper.appendChild(drive);
    stack.appendChild(paper);
  }
  stack.appendChild(num);
  stack.appendChild(date);
  stack.appendChild(eff);
  stack.appendChild(cat);
  stack.appendChild(status);
  stack.appendChild(aud);
  stack.appendChild(subj);
  stack.appendChild(briefCard);
  stack.appendChild(bodyTa);
  stack.appendChild(signed);
  body.appendChild(stack);
  const foot = el("div", { class: "modal-f" });
  const save = el("button", { id: "m-save" });
  save.attrs.id = "m-save";
  save.className = "btn pri";
  save.textContent = "Save memo";
  foot.appendChild(save);
  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(foot);
  w.document.body.appendChild(modal);
  w.S.memos[extra.id || "m15"] = {
    id: extra.id || "m15",
    no: extra.no || "C.M. 2026 - 15",
    status: extra.status || "Issued",
    date: extra.date || "2026-07-09",
    effectivity: extra.effectivity || extra.date || "2026-07-09",
    cat: extra.cat || "Announcement",
    audience: extra.audience || "All",
    fromDrive: extra.fromDrive !== false,
    link: extra.link || "https://drive.google.com/file/d/abc/view",
    subject: extra.subject || "",
    body: extra.body || "",
  };
  return modal;
}

describe("hr-memo companion", () => {
  it("treats numbered, Issued, and fromDrive memos as already filed", () => {
    const w = fakeDom();
    loadMemo(w);
    assert.equal(w.hrMemo.isFiledMemo({ no: "C.M. 2026 - 15" }), true);
    assert.equal(w.hrMemo.isFiledMemo({ status: "Issued" }), true);
    assert.equal(w.hrMemo.isFiledMemo({ fromDrive: true }), true);
    assert.equal(w.hrMemo.isFiledMemo({ status: "Draft", no: "", body: "" }), false);
    assert.equal(w.hrMemo.shouldOfferDraft({ no: "C.M. 2026 - 15", body: "" }), true);
    assert.equal(w.hrMemo.shouldOfferDraft({ no: "C.M. 2026 - 15", body: "Hello" }), false);
    assert.equal(w.hrMemo.shouldLockIdentity({ fromDrive: true, no: "C.M. 2026 - 15" }), true);
    assert.equal(w.hrMemo.shouldLockIdentity({ status: "Issued", no: "C.M. 2026 - 15" }), true);
    assert.equal(w.hrMemo.shouldLockIdentity({ status: "Draft", no: "C.M. 2026 - 16" }), false);
    assert.equal(w.hrMemo.shouldLockIdentity({ status: "Draft", no: "", body: "" }), false);
  });

  it("passes the memo series number into pfISO formNo and never invents an R-number", () => {
    const w = fakeDom();
    loadMemo(w);
    assert.equal(w.hrMemo.formNoFor({ no: "C.M. 2026 - 15" }, ""), "C.M. 2026 - 15");
    assert.equal(w.hrMemo.formNoFor({}, "C.M. 2026 - 15"), "C.M. 2026 - 15");
    const opts = w.hrMemo.pfISOOpts("memo", {}, "C.M. 2026 - 15");
    assert.equal(opts.formNo, "C.M. 2026 - 15");
    assert.equal(w.hrMemo.pfISOOpts("leave", {}, "C.M. 2026 - 15").formNo, undefined);
    assert.equal(w.hrMemo.pfISOOpts("memo", { formNo: "kept" }, "C.M. 2026 - 15").formNo, "kept");
  });

  it("wraps memoPaper so pfISO receives the assigned number", () => {
    const w = fakeDom();
    const calls = [];
    w.pfISO = function (key, o) {
      calls.push({ key, o });
      return "FOOT:" + ((o && o.formNo) || "unassigned");
    };
    w.memoPaper = function (m, no) {
      return "BODY" + w.pfISO("memo");
    };
    loadMemo(w);
    w.hrMemo.patchGlobals();
    const html = w.memoPaper({ no: "C.M. 2026 - 15", body: "" }, "C.M. 2026 - 15");
    assert.match(html, /C\.M\. 2026 - 15/);
    assert.doesNotMatch(html, /unassigned/);
    assert.equal(calls[0].o.formNo, "C.M. 2026 - 15");
    assert.equal(typeof w.pfISO, "function");
    assert.equal(w.pfISO("memo", {}), "FOOT:unassigned");
  });

  it("preserveOnSave keeps filed date and effective on an issued memo, not a draft", () => {
    const w = fakeDom();
    loadMemo(w);
    const issued = w.hrMemo.preserveOnSave(
      { no: "C.M. 2026 - 15", status: "Issued", fromDrive: true, date: "2026-07-09", effectivity: "2026-07-09" },
      { no: "C.M. 2026 - 99", date: "2026-12-01", effectivity: "2026-12-25", subject: "typed" }
    );
    assert.equal(issued.no, "C.M. 2026 - 15");
    assert.equal(issued.date, "2026-07-09");
    assert.equal(issued.effectivity, "2026-07-09");
    assert.equal(issued.subject, "typed");
    const draft = w.hrMemo.preserveOnSave(
      { no: "C.M. 2026 - 16", status: "Draft", date: "2026-08-01", effectivity: "2026-08-01" },
      { no: "C.M. 2026 - 16", date: "2026-08-15", effectivity: "2026-09-01", subject: "hours" }
    );
    assert.equal(draft.date, "2026-08-15");
    assert.equal(draft.effectivity, "2026-09-01");
  });

  it("does not clear an Issued memo number on save or mint a new CM number", async () => {
    const w = fakeDom();
    const allocated = [];
    w.S.memos.m15 = { id: "m15", no: "C.M. 2026 - 15", status: "Issued", fromDrive: true, date: "2026-07-09", effectivity: "2026-07-09" };
    w.put = function (coll, id, obj) {
      return { coll, id, obj };
    };
    w.allocate = function (key, meta) {
      allocated.push({ key, meta });
      return Promise.resolve({ no: "C.M. 2026 - 99" });
    };
    loadMemo(w);
    w.hrMemo.patchGlobals();
    const saved = w.put("memos", "m15", { id: "m15", no: "", subject: "", status: "Issued", date: "2026-12-01", effectivity: "2026-12-25" });
    assert.equal(saved.obj.no, "C.M. 2026 - 15");
    assert.equal(saved.obj.date, "2026-07-09");
    assert.equal(saved.obj.effectivity, "2026-07-09");
    const reused = await w.allocate("CM", { refId: "m15", title: "" });
    assert.equal(reused.no, "C.M. 2026 - 15");
    assert.equal(allocated.length, 0);
  });

  it("hides the AI brief, shows the Drive scan, and promotes upload on an issued memo", () => {
    const w = fakeDom();
    loadMemo(w);
    const modal = issuedEditor(w);
    const result = w.hrMemo.enhance(w.document);
    assert.equal(result.no, "C.M. 2026 - 15");
    assert.match(String(modal.className), /hr-memo-filed/);
    const briefCard = modal.querySelector(".card");
    assert.match(String(briefCard.className), /hr-memo-ai/);
    assert.ok(modal.querySelector("#hr-memo-scan"));
    assert.match(modal.querySelector("#hr-memo-scan").innerHTML, /Open the Drive scan/);
    assert.ok(modal.querySelector("#hr-memo-draft"));
    const save = modal.querySelector("#m-save");
    assert.doesNotMatch(String(save.className), /\bpri\b/);
    const upload = modal.querySelector("#m-upload-signed");
    assert.ok(upload);
    assert.match(String(upload.className), /\bpri\b/);
    assert.equal(modal.querySelector("#m-date").disabled, true);
    assert.equal(modal.querySelector("#m-eff").disabled, true);
    assert.equal(modal.querySelector("#m-cat").disabled, true);
    assert.equal(modal.querySelector("#m-status").disabled, true);
    assert.equal(modal.querySelector("#m-aud").disabled, true);
    assert.equal(modal.querySelector("#m-subj").disabled, false);
    assert.match(String(modal.className), /hr-memo-locked/);
  });

  it("does not lock date or classification on a numbered draft", () => {
    const w = fakeDom();
    loadMemo(w);
    const modal = issuedEditor(w, { status: "Draft", fromDrive: false, no: "C.M. 2026 - 16", id: "m16" });
    w.S.memos.m16 = {
      id: "m16",
      no: "C.M. 2026 - 16",
      status: "Draft",
      fromDrive: false,
      date: "2026-08-01",
      effectivity: "2026-08-01",
      subject: "Site hours",
      body: "Draft body",
    };
    const result = w.hrMemo.enhance(w.document);
    assert.equal(result.no, "C.M. 2026 - 16");
    assert.equal(w.hrMemo.shouldLockIdentity(result), false);
    assert.equal(modal.querySelector("#m-date").disabled, false);
    assert.equal(modal.querySelector("#m-eff").disabled, false);
    assert.equal(modal.querySelector("#m-cat").disabled, false);
    assert.equal(modal.querySelector("#m-status").disabled, false);
    assert.equal(modal.querySelector("#m-subj").disabled, false);
    assert.doesNotMatch(String(modal.className), /hr-memo-locked/);
  });

  it("does not duplicate Drive banner or upload when the editor already has them", () => {
    const w = fakeDom();
    loadMemo(w);
    const modal = issuedEditor(w);
    const stack = modal.querySelector(".stack");
    const existing = el("div", { class: "note" });
    existing.innerHTML = '<b>This memorandum is already on file.</b> <a href="https://drive.google.com/file/d/abc/view"><b>Open the Drive scan</b></a>';
    existing.textContent = "This memorandum is already on file. Open the Drive scan";
    stack.insertBefore(existing, stack.children[0]);
    const foot = modal.querySelector(".modal-f");
    const upload = el("button", { id: "m-upload" });
    upload.attrs.id = "m-upload";
    upload.className = "btn pri";
    upload.textContent = "Upload the signed copy";
    foot.appendChild(upload);
    w.hrMemo.enhance(w.document);
    assert.equal(modal.querySelector("#hr-memo-scan"), null);
    assert.equal(modal.querySelector("#m-upload-signed"), null);
    assert.ok(modal.querySelector("#m-upload"));
  });

  it("leaves a new untitled draft alone", () => {
    const w = fakeDom();
    loadMemo(w);
    const modal = el("div", { class: "modal" });
    const stack = el("div", { class: "stack" });
    const status = el("select", { id: "m-status" });
    status.attrs.id = "m-status";
    status.value = "Draft";
    const subj = el("input", { id: "m-subj" });
    subj.attrs.id = "m-subj";
    const body = el("textarea", { id: "m-body" });
    body.attrs.id = "m-body";
    const brief = el("textarea", { id: "m-brief" });
    brief.attrs.id = "m-brief";
    const card = el("div", { class: "card" });
    card.appendChild(brief);
    const num = el("input");
    num.disabled = true;
    num.value = "assigned when you save";
    stack.appendChild(num);
    stack.appendChild(status);
    stack.appendChild(subj);
    stack.appendChild(card);
    stack.appendChild(body);
    modal.appendChild(stack);
    w.document.body.appendChild(modal);
    const result = w.hrMemo.enhance(w.document);
    assert.equal(result, null);
    assert.equal(modal.querySelector("#hr-memo-scan"), null);
    assert.doesNotMatch(String(card.className), /hr-memo-ai/);
  });
});

describe("issued memo artifact lines", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

  it("passes the memo number into pfISO formNo", () => {
    assert.match(html, /pfISO\("memo",\s*\{formNo:\s*no\|\|m\.no\|\|""\}\)/);
    assert.doesNotMatch(html, /pfISO\("memo"\);/);
  });

  it("does not ask a filed memo to describe itself unless they choose to draft", () => {
    assert.match(html, /const filed = !!\(m\.no \|\| m\.fromDrive \|\| m\.status==="Issued"\)/);
    assert.match(html, /m-want-draft/);
    assert.match(html, /Upload the signed copy/);
    assert.match(html, /Open the Drive scan/);
    assert.match(html, /if\(stored&&stored\.no\) m\.no=stored\.no/);
    assert.match(html, /const lockIdentity = !!\(m\.fromDrive \|\| m\.status==="Issued"\)/);
    assert.match(html, /id="m-date" type="date"[\s\S]*?\+lockAttr/);
    assert.match(html, /id="m-eff" type="date"[\s\S]*?\+lockAttr/);
    assert.match(html, /id="m-cat"'\+lockAttr/);
    assert.match(html, /id="m-status"'\+lockAttr/);
    assert.match(html, /id="m-aud"'\+lockAttr/);
    assert.match(html, /if\(stored&&\(stored\.fromDrive\|\|stored\.status==="Issued"\)\)/);
  });
});
