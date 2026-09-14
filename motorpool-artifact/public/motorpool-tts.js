/**
 * ElevenLabs readback for Ask the log.
 * Loaded by claude-shim.js. Sets window.mpTts so the artifact speak / utter /
 * hush hooks can prefer the server voice when claude.use("tts") is granted.
 */
(function () {
  "use strict";

  if (window.mpTts && window.mpTts.attached) return;

  var ttsFn = null;
  var currentAudio = null;
  var currentUrl = null;

  function hush() {
    try {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = "";
        currentAudio = null;
      }
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
      }
    } catch (e) {}
  }

  function playBase64(b64, mime) {
    hush();
    if (!b64) return Promise.resolve();
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    var blob = new Blob([bytes], { type: mime || "audio/mpeg" });
    currentUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(currentUrl);
    return currentAudio.play().catch(function () {});
  }

  function speak(text) {
    var clean = String(text || "").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim();
    if (!clean) return Promise.resolve();
    hush();
    if (!ttsFn) return Promise.resolve();
    return Promise.resolve()
      .then(function () {
        return ttsFn(clean);
      })
      .then(function (out) {
        if (!out || !out.audioBase64) return;
        return playBase64(out.audioBase64, out.mimeType);
      });
  }

  var api = {
    attached: true,
    ready: false,
    speak: speak,
    hush: hush,
  };
  window.mpTts = api;

  function boot() {
    if (!window.claude || typeof window.claude.use !== "function") return;
    window.claude
      .use("tts")
      .then(function (fn) {
        ttsFn = fn;
        api.ready = Boolean(fn);
      })
      .catch(function () {
        ttsFn = null;
        api.ready = false;
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
