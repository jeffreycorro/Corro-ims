/**
 * Claude artifact capability shim for the CorConDev Motorpool portal.
 * Load BEFORE app scripts:
 *   <script src="/claude-shim.js"></script>
 *
 * window.claude.use(name) returns a Promise synchronously.
 * db is backed by Netlify Functions → Supabase when configured.
 * sample (Anthropic), transcribe (OpenAI), and tts (ElevenLabs) are
 * granted when auth advertises those capabilities. Local static preview
 * works without functions (yard stays open).
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
    return "mp-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getHolder() {
    if (holderId) return holderId;
    try {
      holderId = sessionStorage.getItem("mp-shim-holder") || randomHolder();
      sessionStorage.setItem("mp-shim-holder", holderId);
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

  function closedGateStatus() {
    return { authenticated: false, methods: ["supabase"], open: false };
  }

  function hasSupabaseMethod(status) {
    return Boolean(status && status.methods && status.methods.indexOf("supabase") !== -1);
  }

  function publishAuth(status) {
    try {
      window.__mpAuth = {
        authenticated: Boolean(status && status.authenticated),
        name: status && status.name ? String(status.name) : "",
        email: status && status.email ? String(status.email) : "",
        role: status && status.role ? String(status.role) : "",
        department: status && status.department ? String(status.department) : "",
      };
    } catch (e) {}
    return status;
  }

  function authStatus() {
    return fetch("/.netlify/functions/auth", {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    }).then(function (res) {
      // Static preview (`npx serve public`, python http.server) has no functions.
      // A 404 HTML body is not a closed gate — open the yard on the local store.
      if (res.status === 404) {
        return { open: true, local: true, offline: true };
      }
      if (!res.ok) {
        return closedGateStatus();
      }
      return res.json().catch(function () {
        return closedGateStatus();
      }).then(publishAuth);
    }).catch(function () {
      return publishAuth(closedGateStatus());
    });
  }

  function consumeHandoffToken() {
    try {
      var loc = window.location;
      if (!loc) return null;
      var hash = String(loc.hash || "").replace(/^#/, "");
      if (!hash) return null;
      var params = new URLSearchParams(hash);
      var token = params.get("access_token") || params.get("mp_access_token");
      if (!token) return null;
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", (loc.pathname || "/") + (loc.search || ""));
      }
      return token;
    } catch (e) {
      return null;
    }
  }

  function ensureGateStyles(shadow) {
    var style = document.createElement("style");
    style.textContent =
      ":host{all:initial;position:fixed;inset:0;z-index:2147483647;font-family:Archivo,system-ui,sans-serif}" +
      "*{box-sizing:border-box}" +
      ".wrap{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;" +
      "background:#f2f2f3;color:#2e2e2e;padding:max(24px,env(safe-area-inset-top,0px)) 24px}" +
      ".card{width:100%;max-width:420px;background:#fbfbfc;border:1px solid #d3d5d5;" +
      "border-radius:4px;padding:28px 24px}" +
      "h1{font-size:1.2rem;margin:0 0 6px;font-weight:650}" +
      "p{margin:0 0 16px;color:#5b5e5e;font-size:0.95rem;line-height:1.45}" +
      "label{display:block;font-size:0.8rem;margin:10px 0 4px;color:#5b5e5e}" +
      "input{width:100%;min-height:44px;padding:10px 12px;border-radius:4px;border:1px solid #b5b8b8;" +
      "background:#fff;color:#2e2e2e;font-size:16px;-webkit-text-size-adjust:100%}" +
      "button{margin-top:16px;width:100%;min-height:44px;padding:10px 12px;border:0;border-radius:4px;" +
      "background:#2aa0c0;color:#fff;font-weight:650;cursor:pointer;font-size:16px}" +
      "button:disabled{opacity:0.6;cursor:not-allowed}" +
      ".err{color:#9c3131;min-height:1.2em;font-size:0.85rem;margin-top:10px}" +
      ".note{font-size:0.78rem;color:#969999;margin-top:14px}";
    shadow.appendChild(style);
  }

  function removeSessionChrome() {
    try {
      var existing = document.getElementById("mp-shim-session-host");
      if (existing) existing.remove();
    } catch (e) {}
  }

  function leaveSignedOutSession() {
    authReady = null;
    cache = Object.create(null);
    removeSessionChrome();
    try {
      sessionStorage.removeItem("mp-shim-holder");
    } catch (e) {}
    try {
      window.location.replace("/");
    } catch (e1) {
      try {
        window.location.reload();
      } catch (e2) {}
    }
  }

  function showSessionChrome() {
    try {
      removeSessionChrome();
      var host = document.createElement("div");
      host.id = "mp-shim-session-host";
      var shadow = host.attachShadow({ mode: "closed" });
      var style = document.createElement("style");
      style.textContent =
        ":host{all:initial;position:fixed;top:max(8px,env(safe-area-inset-top,0px));" +
        "right:max(8px,env(safe-area-inset-right,0px));z-index:2147483646;font-family:Archivo,system-ui,sans-serif}" +
        "button{min-height:44px;min-width:44px;padding:8px 14px;border:1px solid #d3d5d5;border-radius:4px;" +
        "background:#fbfbfc;color:#2e2e2e;font-size:14px;font-weight:650;cursor:pointer}" +
        "button:disabled{opacity:0.6}";
      shadow.appendChild(style);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Sign out";
      btn.addEventListener("click", function () {
        btn.disabled = true;
        var left = false;
        function leave() {
          if (left) return;
          left = true;
          leaveSignedOutSession();
        }
        api("auth", { action: "logout" })
          .catch(function () {})
          .then(leave);
        setTimeout(leave, 2000);
      });
      shadow.appendChild(btn);
      (document.documentElement || document.body).appendChild(host);
    } catch (e) {}
  }

  function showLoginGate(methods, presetError) {
    return new Promise(function (resolve) {
      function mount() {
        var host = document.getElementById("mp-shim-gate-host");
        if (host) host.remove();
        host = document.createElement("div");
        host.id = "mp-shim-gate-host";
        var shadow = host.attachShadow({ mode: "closed" });
        ensureGateStyles(shadow);
        var wrap = document.createElement("div");
        wrap.className = "wrap";
        var useSupabase = !methods || methods.length === 0 || methods.indexOf("supabase") !== -1;
        var usePassword = methods && methods.indexOf("password") !== -1;
        wrap.innerHTML =
          '<form class="card" autocomplete="on">' +
          "<h1>CorConDev Motorpool</h1>" +
          "<p>Sign in with the same email and password you use for the company portal. " +
          "Motorpool is limited to motorpool and admin staff.</p>" +
          (useSupabase
            ? '<label for="mp-shim-email">Email</label>' +
              '<input id="mp-shim-email" name="email" type="email" inputmode="email" ' +
              'autocomplete="username" autocapitalize="none" autocorrect="off" ' +
              'spellcheck="false" enterkeyhint="next"' +
              (usePassword ? ">" : " required>")
            : "") +
          '<label for="mp-shim-password">Password</label>' +
          '<input id="mp-shim-password" name="password" type="password" ' +
          'autocomplete="current-password" enterkeyhint="go" required>' +
          '<button type="submit">Sign in</button>' +
          '<div class="err" id="mp-shim-err"></div>' +
          '<p class="note">Your session stays on this device until you sign out.</p>' +
          "</form>";
        shadow.appendChild(wrap);
        document.documentElement.appendChild(host);
        var form = shadow.querySelector("form");
        var errEl = shadow.getElementById("mp-shim-err");
        if (errEl && presetError) errEl.textContent = presetError;
        if (!form) return;
        form.addEventListener("submit", function (ev) {
          ev.preventDefault();
          var btn = form.querySelector("button");
          btn.disabled = true;
          errEl.textContent = "";
          var payload = { action: "login" };
          var pw = shadow.getElementById("mp-shim-password").value;
          payload.password = pw;
          if (useSupabase) {
            var emailEl = shadow.getElementById("mp-shim-email");
            var email = emailEl && emailEl.value ? String(emailEl.value).trim() : "";
            if (email) payload.email = email;
            else if (!usePassword) {
              errEl.textContent = "Enter your company portal email.";
              btn.disabled = false;
              return;
            }
          }
          api("auth", payload)
            .then(function (out) {
              if (!out.authenticated) throw new Error("Sign-in failed");
              publishAuth(out);
              host.remove();
              showSessionChrome();
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
        if (status && status.offline) {
          if (status.open === false || hasSupabaseMethod(status)) {
            return showLoginGate(status.methods || ["supabase"]);
          }
          return { authenticated: true, method: "open", local: true, offline: true };
        }
        if (status && status.authenticated) {
          publishAuth(status);
          if (status.method !== "open") showSessionChrome();
          return status;
        }
        if (status && status.open) {
          return { authenticated: true, method: "open", local: true };
        }
        var token = consumeHandoffToken();
        if (token) {
          return api("auth", { action: "login", access_token: token })
            .then(function (out) {
              if (!out.authenticated) throw new Error("Sign-in failed");
              publishAuth(out);
              showSessionChrome();
              return out;
            })
            .catch(function (err) {
              return showLoginGate(status && status.methods, err && err.message);
            });
        }
        return showLoginGate(status && status.methods);
      })
      .catch(function () {
        return showLoginGate(["supabase"]);
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
    return waitForAuth().then(function (status) {
      if (status && status.offline) {
        var err = new Error("offline");
        err.status = 0;
        throw err;
      }
      return api(fn, body, extra).catch(function (err) {
        // One re-auth only. A 401 after waitForAuth must not recurse
        // (GET /auth still "authenticated" + db 401 used to retry forever).
        if (err.status === 401 && !extra._authRetry) {
          extra._authRetry = true;
          authReady = null;
          return waitForAuth().then(function (next) {
            if (next && next.offline) throw err;
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
    return Object.freeze({
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
        function applyWhere(docs, filters) {
          return (docs || []).filter(function (doc) {
            var data = (doc && typeof doc.data === "function" ? doc.data() : null) || {};
            return (filters || []).every(function (f) {
              var actual = f.field === "id" ? String((doc && doc.id) || "") : data[f.field];
              var have = actual == null ? "" : String(actual);
              var want = f.value == null ? "" : String(f.value);
              if (f.op === "like") {
                var re = new RegExp(
                  "^" +
                    want.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/%/g, ".*") +
                    "$"
                );
                return re.test(have);
              }
              return have === want;
            });
          });
        }
        function query(filters) {
          return {
            where: function (field, op, value) {
              var next = filters.concat([
                { field: String(field || ""), op: op === "==" ? "eq" : String(op || "eq"), value: value },
              ]);
              return query(next);
            },
            get: function () {
              return dbCall("list", { collection: name, filters: filters })
                .then(function (row) {
                  var docs = (row.docs || []).map(function (d) {
                    return makeDocSnap(d.id, d.data, d.exists);
                  });
                  return makeColSnap(applyWhere(docs, filters));
                })
                .catch(function (err) {
                  if (name === "builds") return makeColSnap([]);
                  throw err;
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
        }
        return query([]);
      },
    });
  }

  function createDownloads() {
    return Object.freeze({
      save: function (input) {
        var filename = (input && input.filename) || "download";
        var data = input && input.data;
        var blob;
        if (data instanceof Blob) blob = data;
        else if (typeof data === "string")
          blob = new Blob([data], { type: "text/html;charset=utf-8" });
        else
          blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
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
      return blobToBase64(blob)
        .then(function (audioBase64) {
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
        })
        .then(function (out) {
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

  function createTts() {
    function tts(text, options) {
      options = options || {};
      return gatedCall(
        "tts",
        {
          text: text == null ? "" : String(text),
          voiceId: options.voiceId || options.voice,
        },
        { signal: options.signal }
      ).then(function (out) {
        return {
          audioBase64: (out && out.audioBase64) || "",
          mimeType: (out && out.mimeType) || "audio/mpeg",
          voiceId: out && out.voiceId,
          text: (out && out.text) || String(text || ""),
        };
      });
    }

    tts.speak = function (text, options) {
      return tts(text, options);
    };

    tts.limits = function () {
      return gatedCall("tts", {}, { method: "GET" }).then(function (out) {
        return (out && out.limits) || { maxChars: 2500 };
      });
    };

    return tts;
  }

  var sampleSingleton = null;
  var transcribeSingleton = null;
  var ttsSingleton = null;

  function resolveName(name) {
    if (name === "db") {
      return waitForAuth().then(function (status) {
        if (status && status.offline) return null;
        return createDb();
      });
    }
    if (name === "downloads") {
      return Promise.resolve(createDownloads());
    }
    if (name === "sample") {
      return waitForAuth()
        .then(function (status) {
          if (status && status.offline) return null;
          if (!capabilityOn(status, "sample")) return null;
          if (!sampleSingleton) sampleSingleton = createSample();
          return sampleSingleton;
        })
        .catch(function () {
          return null;
        });
    }
    if (name === "transcribe") {
      return waitForAuth()
        .then(function (status) {
          if (status && status.offline) return null;
          if (!capabilityOn(status, "transcribe")) return null;
          if (!transcribeSingleton) transcribeSingleton = createTranscribe();
          return transcribeSingleton;
        })
        .catch(function () {
          return null;
        });
    }
    if (name === "tts" || name === "speak") {
      return waitForAuth()
        .then(function (status) {
          if (status && status.offline) return null;
          if (!capabilityOn(status, "tts")) return null;
          if (!ttsSingleton) ttsSingleton = createTts();
          return ttsSingleton;
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
      if (document.querySelector && document.querySelector("script[" + flag + '="1"]')) return;
      var parent = document.head || document.documentElement;
      if (!parent || !document.createElement) return;
      var s = document.createElement("script");
      s.src = src;
      s.defer = true;
      if (s.setAttribute) s.setAttribute(flag, "1");
      parent.appendChild(s);
    } catch (e) {}
  }

  window.claude = Object.freeze({
    use: function (name) {
      var key = String(name || "");
      if (!cache[key]) cache[key] = resolveName(key);
      return cache[key];
    },
  });
  loadCompanion("/motorpool-host.js", "data-mp-host");
  loadCompanion("/motorpool-tts.js", "data-mp-tts");
  loadCompanion("/motorpool-ask-voice.js", "data-mp-ask-voice");
})();

