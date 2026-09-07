"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadDictation(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-dictation.js"), "utf8");
  vm.runInNewContext(src, windowLike);
}

function fakeDom() {
  const nodes = new Map();
  function el(tag, attrs) {
    const node = {
      tagName: String(tag).toUpperCase(),
      attrs: Object.assign({}, attrs),
      children: [],
      parentNode: null,
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      disabled: false,
      className: "",
      textContent: "",
      innerHTML: "",
      style: {},
      getAttribute(name) {
        return this.attrs[name] == null ? null : this.attrs[name];
      },
      setAttribute(name, value) {
        this.attrs[name] = String(value);
      },
      removeAttribute(name) {
        delete this.attrs[name];
      },
      querySelector(sel) {
        if (sel.startsWith(".")) {
          const cls = sel.slice(1);
          if ((this.className || "").split(/\s+/).includes(cls)) return this;
          for (const child of this.children) {
            const hit = child.querySelector(sel);
            if (hit) return hit;
          }
        }
        return null;
      },
      listeners: {},
      addEventListener(type, fn) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(fn);
      },
      focus() {
        window.document.activeElement = this;
      },
      dispatchEvent(ev) {
        const list = this.listeners[ev.type] || [];
        list.forEach((fn) => fn(ev));
        return true;
      },
    };
    node.appendChild = function (child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    };
    node.insertBefore = function (child, before) {
      child.parentNode = node;
      const idx = node.children.indexOf(before);
      if (idx < 0) node.children.push(child);
      else node.children.splice(idx, 0, child);
      return child;
    };
    return node;
  }

  const fields = {
    "m-body": el("textarea", { id: "m-body" }),
    "ask-q": el("textarea", { id: "ask-q" }),
  };
  fields["m-body"].value = "Existing draft.";
  fields["m-body"].selectionStart = fields["m-body"].value.length;
  fields["m-body"].selectionEnd = fields["m-body"].value.length;
  const bodyHost = el("div", { class: "f" });
  const askHost = el("div", { class: "f" });
  bodyHost.appendChild(fields["m-body"]);
  askHost.appendChild(fields["ask-q"]);

  const created = [];
  const window = {
    document: {
      readyState: "loading",
      activeElement: null,
      body: el("body"),
      documentElement: el("html"),
      head: el("head"),
      getElementById(id) {
        if (id === "hr-dict-styles") return nodes.get(id) || null;
        return fields[id] || null;
      },
      querySelector(sel) {
        if (sel === 'script[data-hr-dictation="1"]') return null;
        if (sel === "#hr-dict-styles") return nodes.get("hr-dict-styles") || null;
        return null;
      },
      querySelectorAll() {
        return [];
      },
      createElement(tag) {
        const node = el(tag);
        created.push(node);
        if (tag === "style") {
          node.id = "";
          Object.defineProperty(node, "id", {
            get() {
              return this.attrs.id || "";
            },
            set(v) {
              this.attrs.id = v;
              nodes.set(v, this);
            },
          });
        }
        return node;
      },
      addEventListener() {},
    },
    Event: class FakeEvent {
      constructor(type) {
        this.type = type;
        this.bubbles = true;
      }
    },
    MutationObserver: class {
      observe() {}
    },
    navigator: { mediaDevices: null },
    claude: {
      use(name) {
        if (name === "transcribe") return Promise.resolve(null);
        return Promise.resolve(null);
      },
    },
    setTimeout,
    clearTimeout,
    console,
  };
  window.window = window;
  window.fields = fields;
  window.created = created;
  return window;
}

describe("hr-dictation companion", () => {
  it("appends dictated text at the caret with a separating space", () => {
    const w = fakeDom();
    loadDictation(w);
    const field = w.fields["m-body"];
    w.document.activeElement = field;
    const next = w.hrDictation.insertText(field, "Anyone after 7:15 is late.");
    assert.match(next, /Existing draft\. Anyone after 7:15 is late\./);
  });

  it("maps mic and API failures to staff-facing copy", () => {
    const w = fakeDom();
    loadDictation(w);
    assert.match(
      w.hrDictation.messageForError({ name: "NotAllowedError" }),
      /denied/i
    );
    assert.match(
      w.hrDictation.messageForError({ code: "rate_limited" }),
      /wait a moment/i
    );
    assert.match(
      w.hrDictation.messageForError({ code: "not_granted" }),
      /not available/i
    );
    assert.equal(w.hrDictation.messageForError({ code: "cancelled" }), "");
  });

  it("attaches hold-to-talk next to memo body and Ask the records", () => {
    const w = fakeDom();
    loadDictation(w);
    const attached = Array.from(w.hrDictation.attach(w.document)).sort();
    assert.equal(JSON.stringify(attached), JSON.stringify(["ask-q", "m-body"]));
    assert.equal(w.fields["m-body"].getAttribute("data-hr-dict"), "1");
    assert.equal(w.fields["ask-q"].parentNode.children.some((c) => c.className === "hr-dict-row"), true);
    const again = Array.from(w.hrDictation.attach(w.document));
    assert.equal(again.length, 0);
  });

  it("targets memo, reminder, and Ask fields only", () => {
    const w = fakeDom();
    loadDictation(w);
    const ids = Array.from(w.hrDictation.TARGETS).map((t) => String(t.id));
    assert.equal(ids.join(","), "m-brief,m-body,rm-brief,rm-body,ask-q");
    assert.equal(Number(w.hrDictation.MAX_MS), 90 * 1000);
  });

  it("records, transcribes, and inserts after a short hold even if the mic opens late", async () => {
    const w = fakeDom();
    w.Blob = class FakeBlob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = (opts && opts.type) || "";
        this.size = (parts || []).reduce((n, p) => n + (p && p.size != null ? p.size : String(p).length), 0);
      }
    };
    w.MediaRecorder = class FakeRecorder {
      constructor(stream, opts) {
        this.state = "inactive";
        this.mimeType = (opts && opts.mimeType) || "audio/webm";
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: { size: 8, type: this.mimeType } });
        }
        if (this.onstop) this.onstop();
      }
    };
    w.MediaRecorder.isTypeSupported = () => true;
    let opened;
    const micReady = new Promise((resolve) => {
      opened = resolve;
    });
    w.navigator.mediaDevices = {
      getUserMedia() {
        return micReady.then(() => ({ getTracks() { return [{ stop() {} }]; } }));
      },
    };
    w.claude.use = (name) => {
      if (name !== "transcribe") return Promise.resolve(null);
      return Promise.resolve(() =>
        Promise.resolve({ text: "Glory Mae was late on August 5." })
      );
    };
    loadDictation(w);
    w.hrDictation.attach(w.document);
    const row = w.fields["m-body"].parentNode.children.find((c) => c.className === "hr-dict-row");
    const btn = row.children.find((c) => String(c.className).includes("hr-dict-btn"));
    btn.dispatchEvent({ type: "pointerdown", pointerId: 1, pointerType: "mouse", button: 0, preventDefault() {} });
    btn.dispatchEvent({ type: "pointerup", pointerId: 1, pointerType: "mouse", button: 0, preventDefault() {} });
    opened();
    await new Promise((r) => setTimeout(r, 30));
    assert.match(String(w.fields["m-body"].value), /Glory Mae was late on August 5/);
  });
});
