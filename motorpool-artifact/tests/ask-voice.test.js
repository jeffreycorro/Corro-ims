"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadAskVoice(windowLike) {
  const src = fs.readFileSync(path.join(__dirname, "../public/motorpool-ask-voice.js"), "utf8");
  vm.runInNewContext(src, windowLike);
}

function fakeWindow(transcribeImpl) {
  const window = {
    document: {
      readyState: "complete",
      addEventListener() {},
      getElementById() {
        return null;
      },
      createElement() {
        return { id: "", textContent: "" };
      },
      documentElement: { appendChild() {} },
      head: { appendChild() {} },
    },
    navigator: { mediaDevices: null },
    claude: {
      use(name) {
        if (name === "transcribe") return Promise.resolve(transcribeImpl || null);
        return Promise.resolve(null);
      },
    },
    setTimeout,
    clearTimeout,
    toast() {},
  };
  window.window = window;
  return window;
}

describe("motorpool ask-voice companion", () => {
  it("exposes hold-to-talk capture/release and chatbot states", () => {
    const w = fakeWindow(null);
    loadAskVoice(w);
    assert.equal(w.mpAskVoice.attached, true);
    assert.equal(Array.from(w.mpAskVoice.STATES).join(","), "idle,listening,thinking,speaking");
    assert.equal(typeof w.mpAskVoice.capture, "function");
    assert.equal(typeof w.mpAskVoice.release, "function");
    assert.equal(typeof w.mpAskVoice.interrupt, "function");
    assert.equal(Number(w.mpAskVoice.MAX_MS), 90 * 1000);
  });

  it("maps mic and API failures to staff-facing copy", () => {
    const w = fakeWindow(null);
    loadAskVoice(w);
    assert.match(w.mpAskVoice.messageForError({ name: "NotAllowedError" }), /denied/i);
    assert.match(w.mpAskVoice.messageForError({ code: "rate_limited" }), /wait a moment/i);
    assert.match(w.mpAskVoice.messageForError({ code: "not_granted" }), /not available/i);
    assert.equal(w.mpAskVoice.messageForError({ code: "cancelled" }), "");
  });

  it("hints Filipino / Cebuano / English from the Ask language picker", () => {
    const w = fakeWindow(null);
    loadAskVoice(w);
    assert.equal(w.mpAskVoice.languageHint("fil-PH"), "fil");
    assert.equal(w.mpAskVoice.languageHint("ceb-PH"), "ceb");
    assert.equal(w.mpAskVoice.languageHint("en-PH"), "en");
  });

  it("does not start the mic when OpenAI transcribe is not granted", () => {
    const w = fakeWindow(null);
    loadAskVoice(w);
    w.MediaRecorder = function () {};
    w.navigator.mediaDevices = { getUserMedia() { return Promise.resolve({ getTracks() { return []; } }); } };
    assert.equal(w.mpAskVoice.capture({}), false);
  });

  it("records, transcribes, and returns text after a short hold even if the mic opens late", async () => {
    const w = fakeWindow(() => Promise.resolve({ text: "DT-03 last battery was in October." }));
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
    loadAskVoice(w);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(w.mpAskVoice.ready, true);
    const seen = [];
    const busy = [];
    const inp = { value: "" };
    assert.equal(
      w.mpAskVoice.capture({
        inp,
        onFinal(text) {
          seen.push(text);
        },
        setBusy(on) {
          busy.push(on);
        },
        lang: "en-PH",
      }),
      true
    );
    w.mpAskVoice.release();
    opened();
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(seen, ["DT-03 last battery was in October."]);
    assert.equal(inp.value, "DT-03 last battery was in October.");
    assert.ok(busy.includes(true));
    assert.equal(busy[busy.length - 1], false);
  });
});

describe("Ask the log artifact voice loop", () => {
  it("uses hold-to-talk states and prefers the server voice", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
    assert.match(html, /var BUILD = "2026-09-19 a"/);
    assert.match(html, /Hold to talk/);
    assert.match(html, /data-mp-ask-mic/);
    assert.match(html, /data-mp-ask-state/);
    assert.match(html, /data-mp-ask-stop/);
    assert.match(html, /Stop talking/);
    assert.match(html, /function stopTalk/);
    assert.match(html, /Listening — release to ask/);
    assert.match(html, /Speaking — press Stop talking/);
    assert.match(html, /function stopListen/);
    assert.match(html, /function bindAskTalkKeys/);
    assert.match(html, /hasServerVoice/);
    assert.match(html, /window\.mpTts\.speak/);
    assert.match(html, /window\.mpAskVoice\.capture/);
    assert.doesNotMatch(html, /mic\.addEventListener\("click",function\(\)\{/);
  });
});
