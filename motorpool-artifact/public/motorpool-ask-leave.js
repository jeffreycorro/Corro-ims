/**
 * Client leave lookup for Motorpool Ask the log.
 * Calls /.netlify/functions/hr-leave — admin / HR only.
 * Loaded by claude-shim.js.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.mpAskLeave = api;
  if (typeof window !== "undefined" && window) window.mpAskLeave = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function lookupLeave(query) {
    var q = query == null ? "" : String(query).trim();
    if (!q) {
      return Promise.resolve({
        error: "Give a name, employee number, or leave number (LRF…).",
      });
    }
    return fetch("/.netlify/functions/hr-leave", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: q }),
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
          return {
            available: false,
            error: json.error || json.message || "Leave lookup failed.",
          };
        }
        return json;
      });
    }).catch(function () {
      return {
        available: false,
        error:
          "Could not reach the HR leave lookup. Ask the same question in the HR portal.",
      };
    });
  }

  return {
    attached: true,
    lookupLeave: lookupLeave,
  };
});
