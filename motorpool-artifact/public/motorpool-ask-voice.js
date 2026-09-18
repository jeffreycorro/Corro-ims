/**
 * Hold-to-talk loop for Motorpool Ask the log.
 * Loaded by claude-shim.js. Uses window.claude.use("transcribe") — never
 * talks to OpenAI from the browser. The artifact calls capture/release
 * from the mic / Space hold; this records, transcribes, then hands text
 * back so send() can ask and mpTts can speak the answer.
 */
(function () {
  "use strict";

  if (window.mpAskVoice && window.mpAskVoice.attached) return;

  var MAX_MS = 90 * 1000;
  var transcribeFn = null;
  var transcribeTried = false;
  var session = null;
  var pending = null;

  function ensureStyles() {
    if (document.getElementById("mp-ask-voice-styles")) return;
    var style = document.createElement("style");
    style.id = "mp-ask-voice-styles";
    style.textContent =
      "[data-mp-ask-mic='1']{touch-action:none;-webkit-user-select:none;user-select:none;min-width:7.5em}" +
      "[data-mp-ask-mic='1'][data-mp-ask-phase='listening']{border-color:var(--danger,#9c3131)!important;color:var(--danger,#9c3131)}" +
      "[data-mp-ask-mic='1'][data-mp-ask-phase='speaking']{border-color:var(--accent,#2aa0c0)!important}" +
      "[data-mp-ask-stop='1']{min-width:7.5em}" +
      "[data-mp-ask-state='1'][data-phase='listening']{color:var(--danger,#9c3131)}" +
      "[data-mp-ask-state='1'][data-phase='thinking']{color:var(--warn,#b5811a)}" +
      "[data-mp-ask-state='1'][data-phase='speaking']{color:var(--accent,#2aa0c0)}";
    (document.head || document.documentElement).appendChild(style);
  }

  function messageForError(err) {
    if (!err) return "Could not hear that — try again.";
    var code = err.code || (err.body && err.body.code);
    if (code === "cancelled") return "";
    if (code === "not_granted") return "Voice typing is not available on this site.";
    if (code === "rate_limited") return "Too many voice requests — wait a moment.";
    if (code === "bad_request" && err.message) return err.message;
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return "Microphone access was denied. Allow the mic for this site and try again.";
    }
    if (err.name === "NotFoundError") return "No microphone was found on this device.";
    if (err.name === "NotReadableError") return "The microphone is busy in another app.";
    if (err.name === "SecurityError") {
      return "This page cannot use the microphone over an insecure connection.";
    }
    return err.message || "Could not hear that — try again.";
  }

  function pickMime() {
    var types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    if (typeof MediaRecorder === "undefined") return "";
    if (typeof MediaRecorder.isTypeSupported !== "function") return "audio/webm";
    for (var i = 0; i < types.length; i += 1) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return "";
  }

  function languageHint(lang) {
    var raw = String(lang || "").trim();
    if (!raw) return "";
    if (/^fil/i.test(raw) || /^tl/i.test(raw)) return "fil";
    if (/^ceb/i.test(raw)) return "ceb";
    if (/^en/i.test(raw)) return "en";
    return raw.slice(0, 2).toLowerCase();
  }

  function getTranscribe() {
    if (transcribeTried) return Promise.resolve(transcribeFn);
    transcribeTried = true;
    if (!window.claude || typeof window.claude.use !== "function") {
      return Promise.resolve(null);
    }
    return window.claude
      .use("transcribe")
      .then(function (fn) {
        transcribeFn = fn;
        api.ready = Boolean(fn);
        return fn;
      })
      .catch(function () {
        transcribeFn = null;
        api.ready = false;
        return null;
      });
  }

  function canRecord() {
    return (
      typeof MediaRecorder !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    );
  }

  function releaseSession() {
    if (!session) return;
    var rec = session.recorder;
    var stream = session.stream;
    var timer = session.timer;
    session = null;
    if (timer) clearTimeout(timer);
    try {
      if (rec && rec.state === "recording") rec.stop();
    } catch (e) {}
    if (stream) {
      stream.getTracks().forEach(function (t) {
        try {
          t.stop();
        } catch (e2) {}
      });
    }
  }

  function blobFromChunks(chunks, mime) {
    if (!chunks.length) return null;
    return new Blob(chunks, { type: mime || chunks[0].type || "audio/webm" });
  }

  function startRecording(opts) {
    if (session) return Promise.resolve(true);
    if (!canRecord()) return Promise.resolve(false);
    pending = opts || {};
    var mime = pickMime();
    session = {
      opts: pending,
      pending: true,
      stopWhenReady: false,
      stopping: false,
      chunks: [],
      stream: null,
      recorder: null,
      mime: mime || "audio/webm",
      started: Date.now(),
      timer: null,
    };
    if (typeof pending.setBusy === "function") pending.setBusy(true);
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!session || session.opts !== pending) {
        stream.getTracks().forEach(function (t) {
          t.stop();
        });
        return;
      }
      var chunks = session.chunks;
      var rec;
      try {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch (e) {
        stream.getTracks().forEach(function (t) {
          t.stop();
        });
        throw e;
      }
      rec.ondataavailable = function (ev) {
        if (ev && ev.data && ev.data.size) chunks.push(ev.data);
      };
      session.pending = false;
      session.stream = stream;
      session.recorder = rec;
      session.mime = rec.mimeType || mime || "audio/webm";
      session.timer = setTimeout(function () {
        if (session) stopRecording({ timedOut: true });
      }, MAX_MS);
      rec.start(250);
      if (session.stopWhenReady) return stopRecording({});
    }).catch(function (err) {
      releaseSession();
      if (pending && typeof pending.setBusy === "function") pending.setBusy(false);
      var msg = messageForError(err);
      if (msg && pending && pending.inp && pending.inp.ownerDocument) {
        try {
          if (typeof window.toast === "function") window.toast(msg);
        } catch (e) {}
      }
      pending = null;
    });
  }

  function stopRecording(extra) {
    extra = extra || {};
    if (!session) return Promise.resolve();
    if (session.pending) {
      session.stopWhenReady = true;
      return Promise.resolve();
    }
    if (session.stopping) return Promise.resolve();
    session.stopping = true;
    var rec = session.recorder;
    var chunks = session.chunks;
    var mime = session.mime;
    var opts = session.opts || pending || {};

    function finish(blob) {
      releaseSession();
      if (!blob || !blob.size) {
        if (typeof opts.setBusy === "function") opts.setBusy(false);
        pending = null;
        return;
      }
      return getTranscribe()
        .then(function (fn) {
          if (!fn) {
            if (typeof opts.setBusy === "function") opts.setBusy(false);
            pending = null;
            return;
          }
          return fn({
            audio: blob,
            mimeType: mime || blob.type,
            language: languageHint(opts.lang),
          }).then(function (out) {
            var text = (out && out.text) || "";
            if (opts.inp && text) opts.inp.value = text;
            if (typeof opts.setBusy === "function") opts.setBusy(false);
            if (text && typeof opts.onFinal === "function") opts.onFinal(text);
            else if (!text && typeof window.toast === "function") {
              window.toast("Did not catch anything — try again.");
            }
          });
        })
        .catch(function (err) {
          if (typeof opts.setBusy === "function") opts.setBusy(false);
          var msg = messageForError(err);
          if (msg && typeof window.toast === "function") window.toast(msg);
        })
        .then(function () {
          pending = null;
        });
    }

    return new Promise(function (resolve) {
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        resolve(finish(blobFromChunks(chunks, mime)));
      }
      if (rec) rec.onstop = done;
      try {
        if (rec && rec.state === "recording") rec.stop();
        else done();
      } catch (e) {
        done();
      }
      setTimeout(done, 1500);
    });
  }

  function capture(opts) {
    opts = opts || {};
    if (!canRecord()) return false;
    if (!transcribeFn) {
      if (!transcribeTried) getTranscribe();
      return false;
    }
    if (window.mpTts && typeof window.mpTts.hush === "function") {
      try {
        window.mpTts.hush();
      } catch (e) {}
    }
    startRecording(opts);
    return true;
  }

  function release() {
    if (!session && !pending) return false;
    stopRecording({});
    return true;
  }

  function interrupt() {
    if (window.mpTts && typeof window.mpTts.hush === "function") {
      try {
        window.mpTts.hush();
      } catch (e) {}
    }
    if (session) stopRecording({ discard: true });
  }

  var api = {
    attached: true,
    ready: false,
    MAX_MS: MAX_MS,
    STATES: ["idle", "listening", "thinking", "speaking"],
    capture: capture,
    release: release,
    interrupt: interrupt,
    messageForError: messageForError,
    pickMime: pickMime,
    languageHint: languageHint,
    setState: function () {},
  };
  window.mpAskVoice = api;

  function boot() {
    ensureStyles();
    getTranscribe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
