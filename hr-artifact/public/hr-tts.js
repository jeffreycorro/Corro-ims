/**
 * ElevenLabs readback for Ask the records and memo draft text.
 * Loaded by claude-shim.js. Uses window.claude.use("tts") — never talks to
 * ElevenLabs from the browser. Speaks assistant replies when voice is on.
 */
(function () {
  "use strict";

  if (window.hrTts && window.hrTts.attached) return;

  var STORAGE_KEY = "hr_voice";
  var ttsFn = null;
  var ttsTried = false;
  var currentAudio = null;
  var currentUrl = null;
  var lastSpoken = "";
  var voiceOn = false;
  var speaking = false;
  var playGen = 0;

  try {
    voiceOn = localStorage.getItem(STORAGE_KEY) === "1";
  } catch (e) {}

  function ensureStyles() {
    if (document.getElementById("hr-tts-styles")) return;
    var style = document.createElement("style");
    style.id = "hr-tts-styles";
    style.textContent =
      ".hr-tts-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
      ".hr-tts-status{font-size:11px;color:var(--ink3,#969999);min-height:1.2em}" +
      ".hr-tts-stop{font-weight:600}";
    (document.head || document.documentElement).appendChild(style);
  }

  function paintStop() {
    var btn = document.getElementById("hr-tts-stop");
    if (!btn) return;
    btn.hidden = !speaking;
    btn.disabled = !speaking;
    btn.textContent = "Stop talking";
    if (speaking) {
      btn.style.background = "var(--danger,#9c3131)";
      btn.style.borderColor = "var(--danger,#9c3131)";
      btn.style.color = "#fff";
    } else {
      btn.style.background = "";
      btn.style.borderColor = "";
      btn.style.color = "";
    }
    var play = document.getElementById("hr-tts-play");
    if (play) play.textContent = speaking ? "Stop talking" : "Play reply";
  }

  function setSpeaking(on) {
    on = !!on;
    if (speaking === on) {
      paintStop();
      return;
    }
    speaking = on;
    api.speaking = on;
    paintStop();
  }

  function hush() {
    playGen += 1;
    var ended = null;
    try {
      if (currentAudio) {
        ended = currentAudio.onended;
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
    try {
      if (typeof speechSynthesis !== "undefined" && speechSynthesis.cancel) {
        speechSynthesis.cancel();
      }
    } catch (e2) {}
    setSpeaking(false);
    if (typeof ended === "function") {
      try {
        ended();
      } catch (e3) {}
    }
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

  function getTts() {
    if (ttsTried) return Promise.resolve(ttsFn);
    ttsTried = true;
    if (!window.claude || typeof window.claude.use !== "function") {
      return Promise.resolve(null);
    }
    return window.claude
      .use("tts")
      .then(function (fn) {
        ttsFn = fn;
        return fn;
      })
      .catch(function () {
        ttsFn = null;
        return null;
      });
  }

  function speak(text) {
    var clean = String(text || "").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim();
    if (!clean) return Promise.resolve();
    lastSpoken = clean;
    hush();
    var myGen = playGen;
    return getTts().then(function (fn) {
      if (!fn || myGen !== playGen) return;
      return fn(clean).then(function (out) {
        if (myGen !== playGen) return;
        if (!out || !out.audioBase64) return;
        return playBase64(out.audioBase64, out.mimeType);
      });
    });
  }

  function persistVoice() {
    try {
      localStorage.setItem(STORAGE_KEY, voiceOn ? "1" : "");
    } catch (e) {}
  }

  function setToggleLabel(btn) {
    if (!btn) return;
    btn.textContent = voiceOn ? "Reading aloud" : "Silent";
    btn.setAttribute("aria-pressed", voiceOn ? "true" : "false");
  }

  function latestAssistantText(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var cards = scope.querySelectorAll ? scope.querySelectorAll("#ask-thread .card") : [];
    var i;
    var text = "";
    for (i = 0; i < cards.length; i += 1) {
      var lbl = cards[i].querySelector ? cards[i].querySelector(".lbl") : null;
      if (!lbl || !/from the records/i.test(lbl.textContent || "")) continue;
      var body = cards[i].querySelector("div[style*=pre-wrap]");
      if (body && String(body.textContent || "").trim()) text = String(body.textContent).trim();
    }
    return text;
  }

  function attachAsk(root) {
    var go = root && root.querySelector ? root.querySelector("#ask-go") : document.getElementById("ask-go");
    if (!go || go.getAttribute("data-hr-tts") === "1") return null;
    var host = go.parentNode;
    if (!host) return null;
    go.setAttribute("data-hr-tts", "1");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn hr-tts-toggle";
    btn.id = "hr-tts-toggle";
    setToggleLabel(btn);
    btn.addEventListener("click", function () {
      voiceOn = !voiceOn;
      persistVoice();
      setToggleLabel(btn);
      if (!voiceOn) hush();
      else {
        var text = latestAssistantText(document);
        if (text) speak(text);
      }
    });
    if (go.nextSibling) host.insertBefore(btn, go.nextSibling);
    else host.appendChild(btn);
    var play = document.createElement("button");
    play.type = "button";
    play.className = "btn hr-tts-play";
    play.id = "hr-tts-play";
    play.textContent = "Play reply";
    play.addEventListener("click", function () {
      if (speaking) {
        hush();
        return;
      }
      var text = latestAssistantText(document);
      if (text) speak(text);
    });
    host.insertBefore(play, btn.nextSibling);
    var stop = document.createElement("button");
    stop.type = "button";
    stop.className = "btn hr-tts-stop";
    stop.id = "hr-tts-stop";
    stop.setAttribute("data-hr-ask-stop-talk", "1");
    stop.textContent = "Stop talking";
    stop.hidden = true;
    stop.disabled = true;
    stop.addEventListener("click", function () {
      hush();
    });
    host.insertBefore(stop, play.nextSibling);
    paintStop();
    return btn;
  }

  function attachMemo(root) {
    var body = root && root.querySelector ? root.querySelector("#m-body") : document.getElementById("m-body");
    if (!body || body.getAttribute("data-hr-tts") === "1") return null;
    var host = body.parentNode;
    if (!host) return null;
    body.setAttribute("data-hr-tts", "1");
    var row = document.createElement("div");
    row.className = "hr-tts-row";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn sm hr-tts-memo";
    btn.textContent = "Read memo aloud";
    btn.addEventListener("click", function () {
      speak(body.value || body.textContent || "");
    });
    row.appendChild(btn);
    if (body.nextSibling) host.insertBefore(row, body.nextSibling);
    else host.appendChild(row);
    return row;
  }

  function maybeSpeakAsk() {
    if (!voiceOn) return;
    var text = latestAssistantText(document);
    if (!text || text === lastSpoken) return;
    if (/^reading the records/i.test(text) || /^looking up/i.test(text)) return;
    speak(text);
  }

  function attach(root) {
    ensureStyles();
    attachAsk(root);
    attachMemo(root);
    maybeSpeakAsk();
  }

  var observing = false;
  function observe() {
    if (observing || typeof MutationObserver === "undefined") return;
    observing = true;
    var obs = new MutationObserver(function () {
      attach(document);
    });
    var start = function () {
      if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  }

  function boot() {
    ensureStyles();
    getTts().then(function (fn) {
      if (!fn) return;
      attach(document);
      observe();
    });
  }

  var api = {
    attached: true,
    speaking: false,
    speak: speak,
    hush: hush,
    latestAssistantText: latestAssistantText,
    attach: attach,
  };
  window.hrTts = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
