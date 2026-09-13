/**
 * Document store: frozen reads → thaw before mutate.
 * Paths: master/* ledger/* ops/* reserves/* fuel/* photos/* config/app
 * Local persistence + optional Netlify/Supabase via window.claude.use("db").
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rules.js"));
  } else {
    root.MotorpoolDB = factory(root.MotorpoolRules);
  }
})(typeof self !== "undefined" ? self : this, function (rules) {
  "use strict";

  var STORAGE_KEY = "corcondev-motorpool-docs-v1";
  var COUNTER_PATH = "ledger/counter";

  function nowIso() {
    try {
      return new Date().toISOString();
    } catch (e) {
      return String(Date.now());
    }
  }

  function splitPath(path) {
    var raw = String(path || "").replace(/^\/+/, "");
    var slash = raw.indexOf("/");
    if (slash <= 0) return { collection: raw, id: "" };
    return { collection: raw.slice(0, slash), id: raw.slice(slash + 1) };
  }

  function createStore(seedMap) {
    var rows = Object.create(null);
    var revision = 0;
    var listeners = [];
    var remote = null;
    var locks = Object.create(null);
    var holderId = "mp-" + Math.random().toString(36).slice(2);

    function notify(kind, path) {
      revision += 1;
      listeners.slice().forEach(function (fn) {
        try {
          fn({ revision: revision, kind: kind, path: path });
        } catch (e) {}
      });
    }

    function putLocal(path, data) {
      rows[path] = { data: rules.freezeRead(data), updatedAt: nowIso() };
    }

    function get(path) {
      var row = rows[path];
      return row ? row.data : null;
    }

    function getThawed(path) {
      return rules.thaw(get(path));
    }

    function list(prefix) {
      var out = [];
      Object.keys(rows).forEach(function (path) {
        if (path === prefix || path.indexOf(prefix + "/") === 0 || path.indexOf(prefix) === 0) {
          out.push({ path: path, data: rows[path].data, updatedAt: rows[path].updatedAt });
        }
      });
      return out;
    }

    function listCollection(name) {
      var pre = name + "/";
      var out = [];
      Object.keys(rows).forEach(function (path) {
        if (path.indexOf(pre) === 0) {
          out.push({
            path: path,
            id: path.slice(pre.length),
            data: rows[path].data,
            updatedAt: rows[path].updatedAt,
          });
        }
      });
      return out;
    }

    function set(path, data) {
      if (path === "config/app") {
        var full = rules.thaw(data);
        if (!full || typeof full !== "object" || Array.isArray(full)) {
          throw new Error("config/app requires a full-field write");
        }
        putLocal(path, full);
        notify("set", path);
        persist();
        return get(path);
      }
      putLocal(path, rules.thaw(data));
      notify("set", path);
      persist();
      return get(path);
    }

    function del(path) {
      delete rows[path];
      notify("delete", path);
      persist();
    }

    function acquire(path, options) {
      options = options || {};
      var holder = options.holder || holderId;
      var ttl = options.ttlSeconds || 20;
      var now = Date.now();
      var cur = locks[path];
      if (cur && cur.expiresAt > now && cur.holder !== holder) {
        return { acquired: false, holder: cur.holder, expires_at: new Date(cur.expiresAt).toISOString() };
      }
      locks[path] = { holder: holder, expiresAt: now + ttl * 1000 };
      return { acquired: true, holder: holder, expires_at: new Date(locks[path].expiresAt).toISOString() };
    }

    function persist() {
      if (typeof localStorage === "undefined") return;
      try {
        var dump = {};
        Object.keys(rows).forEach(function (path) {
          dump[path] = { data: rules.thaw(rows[path].data), updatedAt: rows[path].updatedAt };
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dump));
      } catch (e) {}
    }

    function loadLocal() {
      if (typeof localStorage === "undefined") return false;
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        var dump = JSON.parse(raw);
        var keys = Object.keys(dump || {});
        if (!keys.length) return false;
        keys.forEach(function (path) {
          rows[path] = {
            data: rules.freezeRead(dump[path].data),
            updatedAt: dump[path].updatedAt || nowIso(),
          };
        });
        return true;
      } catch (e) {
        return false;
      }
    }

    function seedIfEmpty(seed) {
      if (Object.keys(rows).length) return;
      var map = seed || {};
      Object.keys(map).forEach(function (path) {
        putLocal(path, map[path]);
      });
      persist();
    }

    function onChange(fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (x) {
          return x !== fn;
        });
      };
    }

    function fingerprint() {
      var parts = Object.keys(rows)
        .sort()
        .map(function (p) {
          return p + ":" + rows[p].updatedAt;
        });
      return parts.join("|");
    }

    if (seedMap) {
      Object.keys(seedMap).forEach(function (path) {
        putLocal(path, seedMap[path]);
      });
    }

    return {
      COUNTER_PATH: COUNTER_PATH,
      acquire: acquire,
      del: del,
      fingerprint: fingerprint,
      get: get,
      getThawed: getThawed,
      holderId: holderId,
      list: list,
      listCollection: listCollection,
      loadLocal: loadLocal,
      onChange: onChange,
      persist: persist,
      remote: remote,
      revision: function () {
        return revision;
      },
      seedIfEmpty: seedIfEmpty,
      set: set,
      splitPath: splitPath,
    };
  }

  return {
    COUNTER_PATH: COUNTER_PATH,
    STORAGE_KEY: STORAGE_KEY,
    createStore: createStore,
    splitPath: splitPath,
  };
});
