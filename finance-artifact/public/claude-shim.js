/**
 * Claude artifact capability shim for the CorConDev Finance portal.
 * Load this file BEFORE the app script:
 *   <script src="/claude-shim.js"></script>
 *
 * window.claude.use(name) returns a Promise synchronously.
 * db is backed by Netlify Functions. The service role stays on the server.
 */
(function () {
  "use strict";

  if (window.claude && typeof window.claude.use === "function") return;

  var authReady = null;

  function api(fn, body, extra) {
    extra = extra || {};
    return fetch("/.netlify/functions/" + fn, {
      method: extra.method || "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: extra.method === "GET" ? undefined : JSON.stringify(body || {}),
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = {};
        if (text) {
          try { json = JSON.parse(text); } catch (e) { json = { error: text }; }
        }
        if (!res.ok) {
          var err = new Error((json && json.error) || fn + " failed");
          err.status = res.status;
          err.body = json;
          throw err;
        }
        return json;
      });
    });
  }

  function authStatus() {
    return fetch("/.netlify/functions/auth", { method: "GET", credentials: "include", headers: { accept: "application/json" } })
      .then(function (res) { return res.json().catch(function () { return {}; }); });
  }

  function consumeHandoffToken() {
    try {
      var hash = String(window.location.hash || "").replace(/^#/, "");
      if (!hash) return null;
      var params = new URLSearchParams(hash);
      var token = params.get("access_token") || params.get("finance_access_token");
      if (!token) return null;
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      return token;
    } catch (e) {
      return null;
    }
  }

  function showLogin(methods, presetError) {
    return new Promise(function (resolve) {
      var host = document.getElementById("finance-shim-gate");
      if (host) host.remove();
      host = document.createElement("div");
      host.id = "finance-shim-gate";
      var shadow = host.attachShadow({ mode: "closed" });
      var style = document.createElement("style");
      style.textContent =
        ":host{all:initial;position:fixed;inset:0;z-index:2147483647;font-family:system-ui,sans-serif}" +
        ".wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#102033;color:#f4f1ea;padding:24px}" +
        ".card{width:100%;max-width:420px;background:#1b3048;border-radius:12px;padding:28px 24px}" +
        "h1{font-size:1.2rem;margin:0 0 8px} p{color:#d7c4a4;margin:0 0 14px}" +
        "label{display:block;font-size:0.8rem;margin:10px 0 4px} input,button{width:100%;min-height:44px;border-radius:8px;font-size:16px}" +
        "input{border:1px solid #4a5c78;background:#102033;color:#f4f1ea;padding:10px}" +
        "button{margin-top:16px;border:0;background:#b86a1b;color:#fff;font-weight:650}" +
        ".err{color:#f0b4a8;min-height:1.2em;margin-top:8px}";
      shadow.appendChild(style);
      var wrap = document.createElement("div");
      wrap.className = "wrap";
      var usePassword = methods && methods.indexOf("password") !== -1;
      var useSupabase = !methods || !methods.length || methods.indexOf("supabase") !== -1;
      wrap.innerHTML =
        '<form class="card">' +
        "<h1>CorConDev Finance</h1>" +
        "<p>Sign in with the same email and password you use for the company portal. Finance is limited to finance and admin staff.</p>" +
        (useSupabase ? '<label>Email</label><input name="email" type="email" autocomplete="username"' + (usePassword ? ">" : " required>") : "") +
        '<label>Password</label><input name="password" type="password" autocomplete="current-password" required>' +
        '<button type="submit">Sign in</button><div class="err"></div></form>';
      shadow.appendChild(wrap);
      document.documentElement.appendChild(host);
      var err = shadow.querySelector(".err");
      if (presetError) err.textContent = presetError;
      shadow.querySelector("form").addEventListener("submit", function (event) {
        event.preventDefault();
        var email = (shadow.querySelector("[name=email]") || {}).value || "";
        var password = shadow.querySelector("[name=password]").value;
        err.textContent = "";
        api("auth", { action: "login", email: email, password: password })
          .then(function () { host.remove(); resolve(); })
          .catch(function (error) { err.textContent = error.message || "Sign-in failed."; });
      });
    });
  }

  function showSignOut() {
    if (document.getElementById("finance-shim-out")) return;
    var host = document.createElement("div");
    host.id = "finance-shim-out";
    var shadow = host.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent = ":host{position:fixed;top:8px;right:8px;z-index:30} button{min-height:36px;border-radius:8px;border:1px solid #d9d0c3;background:#fffdf8;padding:6px 10px;cursor:pointer}";
    shadow.appendChild(style);
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = "Sign out";
    button.addEventListener("click", function () {
      api("auth", { action: "logout" }).catch(function () {}).then(function () { window.location.reload(); });
    });
    shadow.appendChild(button);
    document.documentElement.appendChild(host);
  }

  function waitForAuth() {
    if (!authReady) {
      authReady = authStatus().then(function (status) {
        if (status && status.authenticated) return status;
        var token = consumeHandoffToken();
        if (token) {
          return api("auth", { action: "login", access_token: token }).catch(function (err) {
            return showLogin(status && status.methods, err.message);
          });
        }
        return showLogin(status && status.methods);
      }).then(function () {
        showSignOut();
        window.__financeAuthed = true;
        window.dispatchEvent(new Event("finance-auth"));
        return authStatus();
      });
    }
    return authReady;
  }

  function pageBuild() {
    return window.BUILD ? String(window.BUILD) : "";
  }

  function dbCall(op, extra) {
    return waitForAuth().then(function () {
      return api("db", Object.assign({ op: op, build: pageBuild() }, extra || {}));
    });
  }

  function snap(id, data, exists) {
    return {
      id: id,
      exists: exists !== false && data != null,
      data: function () { return data; },
    };
  }

  var db = {
    doc: function (path) {
      return {
        get: function () {
          return dbCall("get", { path: path }).then(function (row) {
            return snap(row.id, row.exists ? row.data : null, row.exists);
          });
        },
        set: function (data) {
          return dbCall("set", { path: path, data: data }).then(function (row) {
            return snap(row.id, row.data, true);
          });
        },
      };
    },
    collection: function (name) {
      return {
        get: function () {
          return dbCall("list", { collection: name }).then(function (res) {
            return {
              docs: (res.docs || []).map(function (row) {
                return { id: row.id, data: function () { return row.data; } };
              }),
            };
          });
        },
      };
    },
  };

  window.claude = {
    use: function (name) {
      if (name === "db") return Promise.resolve(db);
      if (name === "downloads") {
        return Promise.resolve({
          save: function (file) {
            var blob = file.data instanceof Blob ? file.data : new Blob([file.data]);
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = file.filename || "download";
            link.click();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          },
        });
      }
      return Promise.resolve(null);
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForAuth);
  else waitForAuth();
})();
