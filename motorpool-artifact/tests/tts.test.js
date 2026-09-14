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
      }
      play() {
        return Promise.resolve();
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
  });

  it("does not attach a second time", () => {
    const w = fakeWindow(null);
    loadTts(w);
    const first = w.mpTts;
    loadTts(w);
    assert.equal(w.mpTts, first);
  });
});
