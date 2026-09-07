/**
 * Claude artifact capability shim for the CorConDev HR portal.
 * Load this file BEFORE the artifact's own scripts:
 *   <script src="/claude-shim.js"></script>
 *
 * window.claude.use(name) returns a Promise synchronously.
 * db is backed by Netlify Functions → Supabase (service role stays on the server).
 * sample and mcp resolve to null (AI hidden; Drive off).
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

  function api(fn, body) {
    return fetch("/.netlify/functions/" + fn, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
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
          throw err;
        }
        return json;
      });
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
      ".wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;" +
      "background:#1b2430;color:#f4f1ea;padding:24px}" +
      ".card{width:100%;max-width:420px;background:#243044;border:1px solid #3a4a63;" +
      "border-radius:12px;padding:28px 24px}" +
      "h1{font-size:1.15rem;margin:0 0 6px;font-weight:650}" +
      "p{margin:0 0 16px;color:#c5c0b5;font-size:0.92rem;line-height:1.45}" +
      "label{display:block;font-size:0.8rem;margin:10px 0 4px;color:#ddd8cc}" +
      "input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #4a5c78;" +
      "background:#1b2430;color:#f4f1ea;font-size:1rem}" +
      "button{margin-top:16px;width:100%;padding:10px 12px;border:0;border-radius:8px;" +
      "background:#c45c26;color:#fff;font-weight:650;cursor:pointer}" +
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

  function dbCall(op, extra) {
    return waitForAuth().then(function () {
      var body = Object.assign({ op: op }, extra || {});
      return api("db", body).catch(function (err) {
        if (err.status === 401) {
          authReady = null;
          return waitForAuth().then(function () {
            return api("db", body);
          });
        }
        throw err;
      });
    });
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

  var dbSingleton = null;
  var downloadsSingleton = null;

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
      return Promise.resolve(null);
    }
    if (name === "mcp") {
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
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
})();
