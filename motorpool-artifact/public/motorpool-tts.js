/**
 * ElevenLabs readback for Ask the log.
 * Loaded by claude-shim.js. Sets window.mpTts so the artifact speak / utter /
 * hush hooks can prefer the server voice when claude.use("tts") is granted.
 *
 * speaking is true only while audio is playing. hush() / interrupt() stop
 * playback immediately so a tap can cut the answer and listen again.
 */
(function () {
  "use strict";

  if (window.mpTts && window.mpTts.attached) return;

  var ttsFn = null;
  var currentAudio = null;
  var currentUrl = null;
  var playGen = 0;
  var speaking = false;
  var listeners = [];

  function notify() {
    var snap = { speaking: speaking, ready: api.ready };
    listeners.slice().forEach(function (fn) {
      try {
        fn(snap);
      } catch (e) {}
    });
  }

  function setSpeaking(on) {
    on = !!on;
    if (speaking === on) return;
    speaking = on;
    api.speaking = on;
    notify();
  }

  function hush() {
    playGen += 1;
    try {
      if (currentAudio) {
        currentAudio.onended = null;
        currentAudio.onerror = null;
        currentAudio.pause();
        currentAudio.src = "";
        currentAudio = null;
      }
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
      }
    } catch (e) {}
    setSpeaking(false);
  }

  function prime() {
    try {
      var a = new Audio();
      a.muted = true;
      var p = a.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
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
    var myGen = playGen;
    return new Promise(function (resolve) {
      function done() {
        if (myGen !== playGen) {
          resolve();
          return;
        }
        setSpeaking(false);
        resolve();
      }
      currentAudio.onended = done;
      currentAudio.onerror = done;
      setSpeaking(true);
      currentAudio.play().then(null, function () {
        done();
      });
    });
  }

  function speak(text) {
    var clean = String(text || "").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim();
    if (!clean) return Promise.resolve();
    hush();
    if (!ttsFn) return Promise.resolve();
    var myGen = playGen;
    return Promise.resolve()
      .then(function () {
        return ttsFn(clean);
      })
      .then(function (out) {
        if (myGen !== playGen) return;
        if (!out || !out.audioBase64) return;
        return playBase64(out.audioBase64, out.mimeType);
      })
      .catch(function () {
        if (myGen === playGen) setSpeaking(false);
      });
  }

  var api = {
    attached: true,
    ready: false,
    speaking: false,
    speak: speak,
    hush: hush,
    interrupt: hush,
    prime: prime,
    onState: function (fn) {
      if (typeof fn === "function") listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (x) {
          return x !== fn;
        });
      };
    },
  };
  window.mpTts = api;

  function boot() {
    if (!window.claude || typeof window.claude.use !== "function") return;
    window.claude
      .use("tts")
      .then(function (fn) {
        ttsFn = fn;
        api.ready = Boolean(fn);
        notify();
      })
      .catch(function () {
        ttsFn = null;
        api.ready = false;
        notify();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
