/**
 * Push-to-talk dictation for the CorConDev HR artifact.
 * Loaded by claude-shim.js. Uses window.claude.use("transcribe") — never
 * talks to OpenAI from the browser. Inserts text into memo / Ask fields.
 */
(function () {
  "use strict";

  if (window.hrDictation && window.hrDictation.attached) return;

  var MAX_MS = 90 * 1000;
  var TARGETS = [
    { id: "m-brief", label: "memo notes" },
    { id: "m-body", label: "memo body" },
    { id: "rm-brief", label: "reminder notes" },
    { id: "rm-body", label: "reminder body" },
    { id: "ask-q", label: "question" },
  ];

  var transcribeFn = null;
  var transcribeTried = false;
  var session = null;

  function ensureStyles() {
    if (document.getElementById("hr-dict-styles")) return;
    var style = document.createElement("style");
    style.id = "hr-dict-styles";
    style.textContent =
      ".hr-dict-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px}" +
      ".hr-dict-btn{touch-action:none;-webkit-user-select:none;user-select:none}" +
      ".hr-dict-btn[data-state=\"recording\"]{background:var(--crit,#9c3131);border-color:var(--crit,#9c3131);color:#fff}" +
      ".hr-dict-status{font-size:11px;color:var(--ink3,#969999);min-height:1.2em}" +
      ".hr-dict-status[data-kind=\"err\"]{color:var(--crit,#9c3131)}" +
      ".hr-dict-status[data-kind=\"ok\"]{color:var(--ok,#2f7d55)}" +
      ".hr-dict-dot{width:7px;height:7px;border-radius:50%;background:currentColor;display:inline-block}";
    (document.head || document.documentElement).appendChild(style);
  }

  function insertText(el, text) {
    text = String(text || "").trim();
    if (!el || !text) return "";
    var cur = el.value == null ? "" : String(el.value);
    var start = typeof el.selectionStart === "number" ? el.selectionStart : cur.length;
    var end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
    if (document.activeElement !== el) {
      start = end = cur.length;
    }
    var before = cur.slice(0, start);
    var after = cur.slice(end);
    var padBefore = before && !/\s$/.test(before) ? " " : "";
    var padAfter = after && !/^\s/.test(after) ? " " : "";
    var next = before + padBefore + text + padAfter + after;
    el.value = next;
    var pos = (before + padBefore + text).length;
    try {
      el.focus();
      el.selectionStart = el.selectionEnd = pos;
    } catch (e) {}
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (e) {}
    return next;
  }

  function messageForError(err) {
    if (!err) return "Dictation failed.";
    var code = err.code || (err.body && err.body.code);
    if (code === "cancelled") return "";
    if (code === "not_granted") return "Dictation is not available on this site.";
    if (code === "rate_limited") return "Too many dictation requests — wait a moment.";
    if (code === "bad_request" && err.message) return err.message;
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return "Microphone access was denied. Allow the mic for this site and try again.";
    }
    if (err.name === "NotFoundError") return "No microphone was found on this device.";
    if (err.name === "NotReadableError") return "The microphone is busy in another app.";
    if (err.name === "SecurityError") return "This page cannot use the microphone over an insecure connection.";
    return err.message || "Dictation failed.";
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

  function getTranscribe() {
    if (transcribeTried) return Promise.resolve(transcribeFn);
    transcribeTried = true;
    if (!window.claude || typeof window.claude.use !== "function") {
      return Promise.resolve(null);
    }
    return window.claude.use("transcribe").then(function (fn) {
      transcribeFn = fn;
      return fn;
    }).catch(function () {
      transcribeFn = null;
      return null;
    });
  }

  function setStatus(row, text, kind) {
    if (!row) return;
    var status = row.querySelector(".hr-dict-status");
    if (!status) return;
    status.textContent = text || "";
    if (kind) status.setAttribute("data-kind", kind);
    else status.removeAttribute("data-kind");
  }

  function setButton(row, state, label) {
    var btn = row && row.querySelector(".hr-dict-btn");
    if (!btn) return;
    btn.setAttribute("data-state", state || "idle");
    btn.setAttribute("aria-pressed", state === "recording" ? "true" : "false");
    btn.disabled = state === "busy";
    var text = btn.querySelector(".hr-dict-label");
    if (text) text.textContent = label || "Hold to dictate";
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
        } catch (e) {}
      });
    }
  }

  function startRecording(field, row) {
    if (session) return Promise.resolve();
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus(row, "Dictation needs a recent Chrome or Safari with a microphone.", "err");
      return Promise.resolve();
    }
    var mime = pickMime();
    session = {
      field: field,
      row: row,
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
    setButton(row, "recording", "Recording… release to stop");
    setStatus(row, "Listening. Release the button to transcribe.", "");
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!session || session.field !== field) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        return;
      }
      var chunks = session.chunks;
      var rec;
      try {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch (e) {
        stream.getTracks().forEach(function (t) { t.stop(); });
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
        if (session && session.field === field) {
          setStatus(row, "Stopped at the time limit — transcribing what was captured.", "err");
          stopRecording(field, row, { timedOut: true });
        }
      }, MAX_MS);
      rec.start(250);
      if (session.stopWhenReady) return stopRecording(field, row);
    }).catch(function (err) {
      releaseSession();
      setButton(row, "idle", "Hold to dictate");
      setStatus(row, messageForError(err), "err");
    });
  }

  function blobFromChunks(chunks, mime) {
    if (!chunks.length) return null;
    return new Blob(chunks, { type: mime || chunks[0].type || "audio/webm" });
  }

  function stopRecording(field, row, extra) {
    extra = extra || {};
    if (!session || session.field !== field) return Promise.resolve();
    if (session.pending) {
      session.stopWhenReady = true;
      return Promise.resolve();
    }
    if (session.stopping) return Promise.resolve();
    session.stopping = true;
    var rec = session.recorder;
    var chunks = session.chunks;
    var mime = session.mime;
    setButton(row, "busy", "Transcribing…");
    if (!extra.timedOut) setStatus(row, "Transcribing…", "");

    function finish(blob) {
      releaseSession();
      if (!blob || !blob.size) {
        setButton(row, "idle", "Hold to dictate");
        setStatus(row, "Nothing was captured. Hold the button and speak.", "err");
        return;
      }
      return getTranscribe().then(function (fn) {
        if (!fn) {
          setButton(row, "idle", "Hold to dictate");
          setStatus(row, "Dictation is not available on this site.", "err");
          return;
        }
        return fn({ audio: blob, mimeType: mime || blob.type }).then(function (out) {
          var text = (out && out.text) || "";
          if (text) insertText(field, text);
          setButton(row, "idle", "Hold to dictate");
          setStatus(
            row,
            text
              ? extra.timedOut
                ? "Inserted. Recording hit the 90-second limit."
                : "Inserted."
              : "No words were recognised. Try again closer to the mic.",
            text ? "ok" : "err"
          );
        });
      }).catch(function (err) {
        setButton(row, "idle", "Hold to dictate");
        setStatus(row, messageForError(err), "err");
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

  function bindControl(field, row) {
    var btn = row.querySelector(".hr-dict-btn");
    if (!btn || btn.getAttribute("data-hr-dict-bound") === "1") return;
    btn.setAttribute("data-hr-dict-bound", "1");

    var activePointer = null;
    var usedPointer = false;
    var lastGesture = 0;

    function markGesture() {
      lastGesture = Date.now();
    }

    function begin(ev) {
      if (session) return;
      if (ev && ev.button != null && ev.button !== 0) return;
      if (ev) {
        ev.preventDefault();
        if (ev.pointerId != null) {
          activePointer = ev.pointerId;
          try {
            btn.setPointerCapture(ev.pointerId);
          } catch (e) {}
        }
      }
      markGesture();
      startRecording(field, row);
    }

    function end(ev) {
      if (ev && activePointer != null && ev.pointerId != null && ev.pointerId !== activePointer) return;
      activePointer = null;
      markGesture();
      if (session && session.field === field) stopRecording(field, row);
    }

    btn.addEventListener("pointerdown", function (ev) {
      usedPointer = true;
      begin(ev);
    });
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", end);
    btn.addEventListener("lostpointercapture", function () {
      if (session && session.field === field && !session.stopping) stopRecording(field, row);
    });
    btn.addEventListener("mousedown", function (ev) {
      if (usedPointer) return;
      begin(ev);
    });
    btn.addEventListener("mouseup", function (ev) {
      if (usedPointer) return;
      end(ev);
    });
    btn.addEventListener("touchstart", function (ev) {
      if (usedPointer) return;
      begin(ev);
    }, { passive: false });
    btn.addEventListener("touchend", function (ev) {
      if (usedPointer) return;
      end(ev);
    });
    btn.addEventListener("keydown", function (ev) {
      if (ev.key !== " " && ev.key !== "Enter") return;
      ev.preventDefault();
      if (!session) begin();
    });
    btn.addEventListener("keyup", function (ev) {
      if (ev.key !== " " && ev.key !== "Enter") return;
      ev.preventDefault();
      end();
    });
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (Date.now() - lastGesture < 400) return;
      if (session && session.field === field) stopRecording(field, row);
      else startRecording(field, row);
    });
    btn.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
    });
  }

  function attachOne(field) {
    if (!field || field.getAttribute("data-hr-dict") === "1") return null;
    var host = field.parentNode;
    if (!host) return null;
    field.setAttribute("data-hr-dict", "1");
    var row = document.createElement("div");
    row.className = "hr-dict-row";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn sm hr-dict-btn";
    btn.setAttribute("data-state", "idle");
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("title", "Hold to dictate");
    var dot = document.createElement("span");
    dot.className = "hr-dict-dot";
    dot.setAttribute("aria-hidden", "true");
    var label = document.createElement("span");
    label.className = "hr-dict-label";
    label.textContent = "Hold to dictate";
    btn.appendChild(dot);
    btn.appendChild(label);
    var status = document.createElement("span");
    status.className = "hr-dict-status";
    status.setAttribute("aria-live", "polite");
    row.appendChild(btn);
    row.appendChild(status);
    if (field.nextSibling) host.insertBefore(row, field.nextSibling);
    else host.appendChild(row);
    bindControl(field, row);
    return row;
  }

  function attach(root) {
    ensureStyles();
    var scope = root && root.querySelectorAll ? root : document;
    var attached = [];
    TARGETS.forEach(function (t) {
      var el = scope.getElementById ? scope.getElementById(t.id) : document.getElementById(t.id);
      if (!el && scope.querySelector) el = scope.querySelector("#" + t.id);
      if (el) {
        var row = attachOne(el);
        if (row) attached.push(t.id);
      }
    });
    return attached;
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
    getTranscribe().then(function (fn) {
      if (!fn) return;
      attach(document);
      observe();
    });
  }

  var api = {
    TARGETS: TARGETS,
    MAX_MS: MAX_MS,
    insertText: insertText,
    messageForError: messageForError,
    attach: attach,
    pickMime: pickMime,
    attached: true,
  };
  window.hrDictation = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
