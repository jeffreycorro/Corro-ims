"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadTts(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/motorpool-tts.js"), "utf8");
  vm.runInNewContext(src, windowLike);
}

function fakeWindow(ttsImpl) {
  const window = {
    document: {
      readyState: "complete",
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
    atob(s) {
      return Buffer.from(s, "base64").toString("binary");
    },
    Uint8Array,
    claude: {
      use(name) {
        if (name === "tts") return Promise.resolve(ttsImpl);
        return Promise.resolve(null);
      },
    },
    speechSynthesis: {
      cancelCount: 0,
      cancel() {
        this.cancelCount += 1;
      },
    },
  };
  window.window = window;
  return window;
}

describe("motorpool tts companion", () => {
  it("exposes mpTts.speak that posts through claude.use(\"tts\")", async () => {
    const seen = [];
    const tts = async (text) => {
      seen.push(text);
      return { audioBase64: Buffer.from("mp3").toString("base64"), mimeType: "audio/mpeg" };
    };
    const w = fakeWindow(tts);
    loadTts(w);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(w.mpTts.attached, true);
    assert.equal(w.mpTts.ready, true);
    await w.mpTts.speak("**DT-03** is due");
    assert.deepEqual(seen, ["DT-03 is due"]);
    assert.equal(w.mpTts.speaking, false);
  });

  it("hush interrupts playback and clears speaking", async () => {
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
    const pending = w.mpTts.speak("Hold this");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(w.mpTts.speaking, true);
    w.mpTts.hush();
    assert.equal(w.mpTts.speaking, false);
    assert.ok(w.speechSynthesis.cancelCount >= 1);
    await pending;
  });

  it("does not attach a second time", () => {
    const w = fakeWindow(null);
    loadTts(w);
    const first = w.mpTts;
    loadTts(w);
    assert.equal(w.mpTts, first);
  });
});
