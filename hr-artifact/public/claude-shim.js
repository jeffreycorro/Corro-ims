/**
 * Claude artifact capability shim for the CorConDev HR portal.
 * Load this file BEFORE the artifact's own scripts:
 *   <script src="/claude-shim.js"></script>
 *
 * window.claude.use(name) returns a Promise synchronously.
 * db is backed by Netlify Functions → Supabase (service role stays on the server).
 * sample (Anthropic), mcp (Google Drive), and transcribe (OpenAI Whisper /
 * gpt-transcribe) are served the same way when their keys are set.
 * Secrets stay on the server.
 */
(function () {
  "use strict";

  if (window.claude && typeof window.claude.use === "function") {
    return;
  }

  var cache = Object.create(null);
  var authReady = null;
  var holderId = null;

  function randomHolder() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    return "hr-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getHolder() {
    if (holderId) return holderId;
    try {
      holderId = sessionStorage.getItem("hr-shim-holder") || randomHolder();
      sessionStorage.setItem("hr-shim-holder", holderId);
    } catch (e) {
      holderId = randomHolder();
    }
    return holderId;
  }

  function api(fn, body, extra) {
    extra = extra || {};
    var opts = {
      method: extra.method || "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: extra.method === "GET" ? undefined : JSON.stringify(body || {}),
    };
    if (extra.signal) opts.signal = extra.signal;
    return fetch("/.netlify/functions/" + fn, opts).then(function (res) {
      return res.text().then(function (text) {
        var json = {};
        if (text) {
          try {
            json = JSON.parse(text);
          } catch (e) {
            json = { error: text };
          }
        }
        if (!res.ok) {
          var err = new Error(json.error || json.message || fn + " failed (" + res.status + ")");
          err.status = res.status;
          err.body = json;
          err.code = json.code;
          err.text = json.text;
          throw err;
        }
        return json;
      });
    }).catch(function (err) {
      if (err && (err.name === "AbortError" || (extra.signal && extra.signal.aborted))) {
        var cancelled = new Error("cancelled");
        cancelled.code = "cancelled";
        throw cancelled;
      }
      throw err;
    });
  }

  function authStatus() {
    return fetch("/.netlify/functions/auth", {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    }).then(function (res) {
      return res.json().catch(function () {
        return {};
      });
    });
  }

  function ensureGateStyles(shadow) {
    var style = document.createElement("style");
    style.textContent =
      ":host{all:initial;position:fixed;inset:0;z-index:2147483647;font-family:system-ui,sans-serif}" +
      "*{box-sizing:border-box}" +
      ".wrap{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;" +
      "background:#1b2430;color:#f4f1ea;padding:max(24px,env(safe-area-inset-top,0px)) max(24px,env(safe-area-inset-right,0px)) max(24px,env(safe-area-inset-bottom,0px)) max(24px,env(safe-area-inset-left,0px))}" +
      ".card{width:100%;max-width:420px;background:#243044;border:1px solid #3a4a63;" +
      "border-radius:12px;padding:28px 24px}" +
      "h1{font-size:1.2rem;margin:0 0 6px;font-weight:650}" +
      "p{margin:0 0 16px;color:#c5c0b5;font-size:0.95rem;line-height:1.45}" +
      "label{display:block;font-size:0.8rem;margin:10px 0 4px;color:#ddd8cc}" +
      "input{width:100%;min-height:44px;padding:10px 12px;border-radius:8px;border:1px solid #4a5c78;" +
      "background:#1b2430;color:#f4f1ea;font-size:16px}" +
      "button{margin-top:16px;width:100%;min-height:44px;padding:10px 12px;border:0;border-radius:8px;" +
      "background:#c45c26;color:#fff;font-weight:650;cursor:pointer;font-size:16px}" +
      "button:disabled{opacity:0.6;cursor:not-allowed}" +
      ".err{color:#f0b4a8;min-height:1.2em;font-size:0.85rem;margin-top:10px}" +
      ".note{font-size:0.78rem;color:#9aa3b2;margin-top:14px}";
    shadow.appendChild(style);
  }

  function showLoginGate(methods) {
    return new Promise(function (resolve) {
      function mount() {
        var host = document.getElementById("hr-shim-gate-host");
        if (host) host.remove();
        host = document.createElement("div");
        host.id = "hr-shim-gate-host";
        var shadow = host.attachShadow({ mode: "closed" });
        ensureGateStyles(shadow);
        var wrap = document.createElement("div");
        wrap.className = "wrap";
        var usePassword = !methods || methods.indexOf("password") !== -1;
        var useSupabase = methods && methods.indexOf("supabase") !== -1;
        wrap.innerHTML =
          '<form class="card" autocomplete="on">' +
          "<h1>CorConDev HR</h1>" +
          "<p>This site is private. Sign in to open the HR artifact. " +
          "The access check runs on the server; the page cannot bypass it.</p>" +
          (useSupabase
            ? '<label for="hr-shim-email">Email</label>' +
              '<input id="hr-shim-email" name="email" type="email" autocomplete="username">'
            : "") +
          '<label for="hr-shim-password">Password</label>' +
          '<input id="hr-shim-password" name="password" type="password" autocomplete="current-password" required>' +
          "<button type=\"submit\">Continue</button>" +
          '<div class="err" id="hr-shim-err"></div>' +
          '<p class="note">Netlify visitor password protection, if enabled, is an extra layer in front of this gate.</p>' +
          "</form>";
        shadow.appendChild(wrap);
        document.documentElement.appendChild(host);
        var form = shadow.querySelector("form");
        var errEl = shadow.getElementById("hr-shim-err");
        form.addEventListener("submit", function (ev) {
          ev.preventDefault();
          var btn = form.querySelector("button");
          btn.disabled = true;
          errEl.textContent = "";
          var payload = { action: "login" };
          var pw = shadow.getElementById("hr-shim-password").value;
          payload.password = pw;
          if (useSupabase) {
            var emailEl = shadow.getElementById("hr-shim-email");
            if (emailEl && emailEl.value) payload.email = emailEl.value;
          }
          api("auth", payload)
            .then(function (out) {
              if (!out.authenticated) throw new Error("Sign-in failed");
              host.remove();
              resolve(out);
            })
            .catch(function (err) {
              errEl.textContent = err.message || "Sign-in failed";
              btn.disabled = false;
            });
        });
      }
      if (document.documentElement) mount();
      else document.addEventListener("DOMContentLoaded", mount);
    });
  }

  function waitForAuth() {
    if (authReady) return authReady;
    authReady = authStatus()
      .then(function (status) {
        if (status && status.authenticated) return status;
        return showLoginGate(status && status.methods);
      })
      .catch(function () {
        return showLoginGate(["password"]);
      });
    return authReady;
  }

  function makeDocSnap(id, payload, exists) {
    var present = exists !== false && payload != null;
    return {
      id: id,
      exists: present,
      data: function () {
        return present ? payload : undefined;
      },
    };
  }

  function makeColSnap(docs) {
    var list = docs.slice();
    list.docs = list;
    list.empty = list.length === 0;
    list.size = list.length;
    list.forEach = Array.prototype.forEach;
    return list;
  }

  function gatedCall(fn, body, extra) {
    extra = extra || {};
    return waitForAuth().then(function () {
      return api(fn, body, extra).catch(function (err) {
        if (err.status === 401) {
          authReady = null;
          return waitForAuth().then(function () {
            return api(fn, body, extra);
          });
        }
        throw err;
      });
    });
  }

  function dbCall(op, extra) {
    return gatedCall("db", Object.assign({ op: op }, extra || {}));
  }

  function capabilityOn(status, name) {
    return Boolean(status && status.capabilities && status.capabilities[name]);
  }

  function createDb() {
    var db = {
      doc: function (path, maybeId) {
        var pathArg = maybeId != null ? String(path) + "/" + String(maybeId) : String(path);
        return {
          get: function () {
            return dbCall("get", { path: pathArg }).then(function (row) {
              return makeDocSnap(row.id || pathArg.split("/").slice(1).join("/"), row.data, row.exists);
            });
          },
          set: function (data, options) {
            return dbCall("set", {
              path: pathArg,
              data: data,
              merge: Boolean(options && options.merge),
            }).then(function (row) {
              return makeDocSnap(row.id, row.data, true);
            });
          },
          update: function (data) {
            return dbCall("set", { path: pathArg, data: data, merge: true }).then(function (row) {
              return makeDocSnap(row.id, row.data, true);
            });
          },
          delete: function () {
            return dbCall("delete", { path: pathArg }).then(function () {
              return { ok: true };
            });
          },
          acquire: function (options) {
            var holder = (options && options.holder) || getHolder();
            return dbCall("acquire", { path: pathArg, holder: holder, ttlSeconds: options && options.ttlSeconds }).then(
              function (row) {
                return {
                  acquired: row.acquired === true,
                  holder: row.holder,
                  expiresAt: row.expires_at,
                  expires_at: row.expires_at,
                };
              }
            );
          },
        };
      },
      collection: function (name) {
        return {
          get: function () {
            return dbCall("list", { collection: name }).then(function (row) {
              var docs = (row.docs || []).map(function (d) {
                return makeDocSnap(d.id, d.data, d.exists);
              });
              return makeColSnap(docs);
            });
          },
          onSnapshot: function (observer) {
            var cancelled = false;
            var cb = typeof observer === "function" ? observer : observer && observer.next;
            this.get()
              .then(function (snap) {
                if (!cancelled && cb) cb(snap);
              })
              .catch(function (err) {
                if (!cancelled && observer && observer.error) observer.error(err);
              });
            return function unsubscribe() {
              cancelled = true;
            };
          },
        };
      },
    };
    return Object.freeze(db);
  }

  function createDownloads() {
    return Object.freeze({
      save: function (input) {
        var filename = (input && input.filename) || "download";
        var data = input && input.data;
        var blob;
        if (data instanceof Blob) blob = data;
        else if (typeof Blob !== "undefined" && data instanceof ArrayBuffer)
          blob = new Blob([data]);
        else if (typeof Uint8Array !== "undefined" && data instanceof Uint8Array)
          blob = new Blob([data]);
        else if (typeof data === "string")
          blob = new Blob([data], { type: "text/plain;charset=utf-8" });
        else if (data && typeof data === "object" && data.content != null)
          blob = new Blob([data.content], {
            type: data.mimeType || data.type || "application/octet-stream",
          });
        else
          blob = new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json;charset=utf-8",
          });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1500);
        return Promise.resolve({ ok: true, filename: filename });
      },
    });
  }

  function normalizeClientMessages(promptOrMessages) {
    if (typeof promptOrMessages === "string") {
      return [{ role: "user", content: promptOrMessages }];
    }
    if (Array.isArray(promptOrMessages)) {
      return promptOrMessages.map(function (m) {
        if (typeof m === "string") return { role: "user", content: m };
        return {
          role: m && m.role === "assistant" ? "assistant" : "user",
          content: m && m.content != null ? m.content : "",
        };
      });
    }
    if (promptOrMessages && promptOrMessages.role) {
      return [promptOrMessages];
    }
    return [{ role: "user", content: String(promptOrMessages || "") }];
  }

  function toolDefs(tools) {
    if (!tools || !tools.length) return [];
    return tools.map(function (t) {
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema || t.input_schema,
      };
    });
  }

  function runToolCalls(toolCalls, tools, signal) {
    var byName = Object.create(null);
    (tools || []).forEach(function (t) {
      if (t && t.name) byName[t.name] = t;
    });
    return Promise.all(
      (toolCalls || []).map(function (call) {
        var tool = byName[call.name];
        if (!tool || typeof tool.execute !== "function") {
          return Promise.resolve({
            type: "tool_result",
            tool_use_id: call.id,
            content: "Unknown tool: " + call.name,
            is_error: true,
          });
        }
        return Promise.resolve()
          .then(function () {
            return tool.execute(call.input || {}, { signal: signal });
          })
          .then(function (result) {
            return {
              type: "tool_result",
              tool_use_id: call.id,
              content: typeof result === "string" ? result : JSON.stringify(result),
            };
          })
          .catch(function (err) {
            return {
              type: "tool_result",
              tool_use_id: call.id,
              content: (err && err.message) || "tool failed",
              is_error: true,
            };
          });
      })
    );
  }

  function createSample() {
    function sample(promptOrMessages, options) {
      options = options || {};
      var messages = normalizeClientMessages(promptOrMessages);
      var tools = options.tools || [];
      var round = 0;

      function once(msgs) {
        if (options.signal && options.signal.aborted) {
          var cancelled = new Error("cancelled");
          cancelled.code = "cancelled";
          return Promise.reject(cancelled);
        }
        if (round++ > 8) {
          var loop = new Error("Too many tool rounds");
          loop.code = "tool_error";
          return Promise.reject(loop);
        }
        return gatedCall(
          "sample",
          {
            messages: msgs,
            modelTier: options.modelTier || "default",
            tools: toolDefs(tools),
            cache: options.cache,
          },
          { signal: options.signal }
        ).then(function (out) {
          if (out && out.toolCalls && out.toolCalls.length) {
            var next = msgs.slice();
            next.push({
              role: "assistant",
              content: out.assistantContent || out.toolCalls,
            });
            return runToolCalls(out.toolCalls, tools, options.signal).then(function (results) {
              next.push({ role: "user", content: results });
              return once(next);
            });
          }
          var text = (out && out.text) || "";
          if (typeof options.onText === "function") {
            try {
              options.onText({ text: text });
            } catch (e) {}
          }
          return { text: text, truncated: Boolean(out && out.truncated) };
        });
      }

      return once(messages);
    }

    sample.json = function (prompt, options) {
      options = options || {};
      return gatedCall(
        "sample",
        {
          prompt: typeof prompt === "string" ? prompt : undefined,
          messages: typeof prompt === "string" ? undefined : normalizeClientMessages(prompt),
          modelTier: (options && options.modelTier) || "default",
          mode: "json",
        },
        { signal: options && options.signal }
      ).then(function (out) {
        if (out && out.json && typeof out.json === "object") return out.json;
        var err = new Error("The model did not return valid JSON");
        err.code = "tool_error";
        throw err;
      });
    };

    sample.limits = function () {
      return Promise.resolve({
        tools: { maxCount: 8 },
        modelTiers: ["default", "complex"],
        maxOutputTokens: 8192,
      });
    };

    return sample;
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      if (!blob) {
        reject(new Error("audio is required"));
        return;
      }
      if (typeof FileReader === "undefined") {
        reject(new Error("This browser cannot encode audio for dictation."));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        var idx = s.indexOf(",");
        resolve(idx >= 0 ? s.slice(idx + 1) : s);
      };
      reader.onerror = function () {
        reject(new Error("Could not read the recording."));
      };
      reader.readAsDataURL(blob);
    });
  }

  function filenameForMime(mime) {
    var type = String(mime || "").toLowerCase();
    if (type.indexOf("mp4") !== -1 || type.indexOf("m4a") !== -1) return "dictation.m4a";
    if (type.indexOf("mpeg") !== -1 || type.indexOf("mp3") !== -1) return "dictation.mp3";
    if (type.indexOf("ogg") !== -1) return "dictation.ogg";
    if (type.indexOf("wav") !== -1) return "dictation.wav";
    return "dictation.webm";
  }

  function createTranscribe() {
    function transcribe(input, options) {
      options = options || {};
      var blob = input && input.audio ? input.audio : input;
      if (!blob) {
        return Promise.reject(Object.assign(new Error("audio is required"), { code: "bad_request" }));
      }
      var mime = (input && input.mimeType) || blob.type || "audio/webm";
      var filename = (input && input.filename) || filenameForMime(mime);
      var language = (input && input.language) || options.language;
      var signal = (input && input.signal) || options.signal;
      return blobToBase64(blob).then(function (audioBase64) {
        return gatedCall(
          "transcribe",
          {
            audioBase64: audioBase64,
            mimeType: mime,
            filename: filename,
            language: language,
          },
          { signal: signal }
        );
      }).then(function (out) {
        return {
          text: (out && out.text) || "",
          language: out && out.language,
          model: out && out.model,
        };
      });
    }

    transcribe.limits = function () {
      return Promise.resolve({
        maxSeconds: 90,
        maxBytes: 3.5 * 1024 * 1024,
      });
    };

    return transcribe;
  }

  var ONESHOT_B64 = 3.2 * 1024 * 1024;
  var CHUNK_B64 = 4 * Math.floor((256 * 1024) / 3);

  function base64DecodedLength(data) {
    var s = String(data || "").replace(/\s/g, "");
    if (!s) return 0;
    var pad = 0;
    if (s.slice(-2) === "==") pad = 2;
    else if (s.slice(-1) === "=") pad = 1;
    return Math.floor((s.length * 3) / 4) - pad;
  }

  function createMcp() {
    function driveCall(payload) {
      return gatedCall("drive", payload);
    }

    function createFileMaybeChunked(args) {
      args = args || {};
      var mime = args.contentMimeType || "";
      if (mime === "application/vnd.google-apps.folder" || !args.base64Content) {
        return driveCall({ tool: "create_file", server: "Google Drive", args: args });
      }
      var b64 = String(args.base64Content).replace(/\s/g, "");
      if (b64.length <= ONESHOT_B64) {
        return driveCall({ tool: "create_file", server: "Google Drive", args: args });
      }
      return driveCall({
        tool: "create_file_init",
        server: "Google Drive",
        args: {
          title: args.title,
          parentId: args.parentId,
          contentMimeType: mime,
          size: base64DecodedLength(b64),
          disableConversionToGoogleType: args.disableConversionToGoogleType,
        },
      }).then(function (init) {
        var token = init.uploadToken;
        function send(offset) {
          var slice = b64.slice(offset, offset + CHUNK_B64);
          var next = offset + slice.length;
          var last = next >= b64.length;
          return driveCall({
            tool: "create_file_chunk",
            server: "Google Drive",
            args: { uploadToken: token, data: slice, last: last },
          }).then(function (out) {
            if (out && out.payload) return out;
            if (out && out.uploadToken) token = out.uploadToken;
            if (last) return out;
            return send(next);
          });
        }
        return send(0);
      });
    }

    return Object.freeze({
      callTool: function (server, toolName, args) {
        if (String(server) !== "Google Drive") {
          var missing = new Error("This portal is not set up to reach that connector.");
          missing.code = "server_not_found";
          return Promise.reject(missing);
        }
        if (toolName === "create_file") {
          return createFileMaybeChunked(args);
        }
        return driveCall({
          tool: toolName,
          server: "Google Drive",
          args: args || {},
        });
      },
    });
  }

  var dbSingleton = null;
  var downloadsSingleton = null;
  var sampleSingleton = null;
  var mcpSingleton = null;
  var transcribeSingleton = null;

  function resolveName(name) {
    if (name === "db") {
      waitForAuth();
      if (!dbSingleton) dbSingleton = createDb();
      return Promise.resolve(dbSingleton);
    }
    if (name === "downloads") {
      if (!downloadsSingleton) downloadsSingleton = createDownloads();
      return Promise.resolve(downloadsSingleton);
    }
    if (name === "sample") {
      return waitForAuth()
        .then(function (status) {
          if (!capabilityOn(status, "sample")) return null;
          if (!sampleSingleton) sampleSingleton = createSample();
          return sampleSingleton;
        })
        .catch(function () {
          return null;
        });
    }
    if (name === "mcp") {
      return waitForAuth()
        .then(function (status) {
          if (!capabilityOn(status, "mcp")) return null;
          if (!mcpSingleton) mcpSingleton = createMcp();
          return mcpSingleton;
        })
        .catch(function () {
          return null;
        });
    }
    if (name === "transcribe") {
      return waitForAuth()
        .then(function (status) {
          if (!capabilityOn(status, "transcribe")) return null;
          if (!transcribeSingleton) transcribeSingleton = createTranscribe();
          return transcribeSingleton;
        })
        .catch(function () {
          return null;
        });
    }
    return Promise.resolve(null);
  }

  function loadCompanion(src, flag) {
    try {
      if (typeof document === "undefined") return;
      if (document.querySelector && document.querySelector('script[' + flag + '="1"]')) return;
      var parent = document.head || document.documentElement;
      if (!parent || !document.createElement) return;
      var s = document.createElement("script");
      s.src = src;
      s.defer = true;
      if (s.setAttribute) s.setAttribute(flag, "1");
      parent.appendChild(s);
    } catch (e) {}
  }

  function loadDictationCompanion() {
    loadCompanion("/hr-dictation.js", "data-hr-dictation");
    loadCompanion("/hr-memo.js", "data-hr-memo");
  }

  var apiObj = {
    use: function (name) {
      var key = String(name || "");
      if (!cache[key]) cache[key] = resolveName(key);
      return cache[key];
    },
  };

  Object.freeze(apiObj);
  window.claude = apiObj;
  loadDictationCompanion();
})();
