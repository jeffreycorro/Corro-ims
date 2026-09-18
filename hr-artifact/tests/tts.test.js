"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadTts(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/hr-tts.js"), "utf8");
  vm.runInNewContext(src, windowLike);
}

function el(tag, attrs) {
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs: Object.assign({}, attrs),
    children: [],
    parentNode: null,
    className: "",
    textContent: "",
    value: "",
    getAttribute(name) {
      return this.attrs[name] == null ? null : this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    addEventListener() {},
    querySelector(sel) {
      if (sel === ".lbl") {
        return this.children.find((c) => (c.className || "").split(/\s+/).includes("lbl")) || null;
      }
      if (sel === "div[style*=pre-wrap]") {
        return this.children.find((c) => c.tagName === "DIV" && /pre-wrap/.test(c.style || "")) || null;
      }
      for (const child of this.children) {
        if (child.querySelector) {
          const hit = child.querySelector(sel);
          if (hit) return hit;
        }
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === "#ask-thread .card" || sel === ".card") {
        return this.children.filter((c) => (c.className || "").split(/\s+/).includes("card"));
      }
      return [];
    },
  };
  node.appendChild = function (child) {
    child.parentNode = node;
    node.children.push(child);
    return child;
  };
  node.insertBefore = function (child, before) {
    child.parentNode = node;
    const idx = this.children.indexOf(before);
    if (idx < 0) this.children.push(child);
    else this.children.splice(idx, 0, child);
    return child;
  };
  return node;
}

function fakeWindow(ttsImpl) {
  const askGo = el("button", { id: "ask-go" });
  const row = el("div", {});
  row.appendChild(askGo);
  const thread = el("div", { id: "ask-thread" });
  const card = el("div", {});
  card.className = "card";
  const lbl = el("span", {});
  lbl.className = "lbl";
  lbl.textContent = "From the records";
  const body = el("div", {});
  body.style = "white-space:pre-wrap";
  body.textContent = "Glory Mae was late on August 5.";
  card.appendChild(lbl);
  card.appendChild(body);
  thread.appendChild(card);

  const nodes = {
    "ask-go": askGo,
    "ask-thread": thread,
    "m-body": el("textarea", { id: "m-body" }),
  };

  const window = {
    localStorage: {
      _d: {},
      getItem(k) {
        return this._d[k] || null;
      },
      setItem(k, v) {
        this._d[k] = String(v);
      },
    },
    document: {
      readyState: "complete",
      body: row,
      head: { appendChild() {} },
      documentElement: { appendChild() {} },
      getElementById(id) {
        return nodes[id] || null;
      },
      querySelector(sel) {
        if (sel === "#ask-go") return askGo;
        if (sel === "#ask-thread") return thread;
        if (sel === "#m-body") return nodes["m-body"];
        if (sel === "#hr-tts-styles") return null;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === "#ask-thread .card") return [card];
        return [];
      },
      createElement(tag) {
        return el(tag, {});
      },
      addEventListener() {},
    },
    URL: {
      createObjectURL() {
        return "blob:tts";
      },
      revokeObjectURL() {},
    },
    Blob: class FakeBlob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = (opts && opts.type) || "";
      }
    },
    Audio: class FakeAudio {
      constructor(url) {
        this.url = url;
        this.src = url;
        this.onended = null;
        this.onerror = null;
      }
      play() {
        const self = this;
        return Promise.resolve().then(() => {
          if (typeof self.onended === "function") self.onended();
        });
      }
      pause() {}
    },
    speechSynthesis: {
      cancelCount: 0,
      cancel() {
        this.cancelCount += 1;
      },
    },
    atob(s) {
      return Buffer.from(s, "base64").toString("binary");
    },
    Uint8Array,
    MutationObserver: class {
      observe() {}
    },
    claude: {
      use(name) {
        if (name === "tts") return Promise.resolve(ttsImpl);
        return Promise.resolve(null);
      },
    },
  };
  window.window = window;
  return window;
}

describe("HR tts companion", () => {
  it("reads the latest Ask the records reply", async () => {
    const seen = [];
    const tts = async (text) => {
      seen.push(text);
      return { audioBase64: Buffer.from("mp3").toString("base64"), mimeType: "audio/mpeg" };
    };
    const w = fakeWindow(tts);
    loadTts(w);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(w.hrTts.attached, true);
    assert.match(w.hrTts.latestAssistantText(w.document), /Glory Mae/);
    await w.hrTts.speak("  **Late** on August 5.  ");
    assert.deepEqual(seen, ["Late on August 5."]);
    assert.equal(w.hrTts.speaking, false);
  });

  it("hush interrupts playback and shows Stop talking while speaking", async () => {
    const w = fakeWindow(async () => {
      return { audioBase64: Buffer.from("mp3").toString("base64"), mimeType: "audio/mpeg" };
    });
    w.Audio = class HoldAudio {
      constructor(url) {
        this.url = url;
        this.src = url;
        this.onended = null;
        this.paused = false;
      }
      play() {
        return new Promise(() => {});
      }
      pause() {
        this.paused = true;
      }
    };
    loadTts(w);
    await new Promise((r) => setTimeout(r, 0));
    const pending = w.hrTts.speak("Hold this");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(w.hrTts.speaking, true);
    w.hrTts.hush();
    assert.equal(w.hrTts.speaking, false);
    assert.ok(w.speechSynthesis.cancelCount >= 1);
    await pending;
  });
});
