/**
 * Recruitment helpers for the CorConDev HR artifact.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * Adds "Bulk import JSON" on Recruitment → Pipeline. Staff use the
 * existing HR session cookie; the extractor bot uses the ingest key.
 */
(function (root) {
  "use strict";

  if (root.hrRecruit && root.hrRecruit.version) return;

  var api = { version: "1.0.0", attached: false };

  function $(sel, r) {
    return (r || document).querySelector(sel);
  }

  function parsePaste(text) {
    var raw = String(text || "").trim();
    if (!raw) throw new Error("Paste a JSON array or { \"applicants\": [ … ] }.");
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error("That is not valid JSON.");
    }
    if (Array.isArray(data)) return { applicants: data };
    if (data && Array.isArray(data.applicants)) return data;
    throw new Error("JSON must be { \"applicants\": [ … ] } or an array of applicants.");
  }

  function toast(msg, kind) {
    if (typeof root.toast === "function") root.toast(msg, kind);
  }

  function store() {
    return root.S || null;
  }

  async function refreshApplicants() {
    var S = store();
    if (!S || !S.db || !S.db.collection) return;
    var snap = await S.db.collection("applicants").get();
    var next = {};
    (snap.docs || []).forEach(function (d) {
      var data = typeof d.data === "function" ? d.data() : d.data;
      next[d.id] = data;
    });
    S.applicants = next;
    if (typeof S.lsSaveSoon === "function") S.lsSaveSoon();
    else if (typeof root.lsSaveSoon === "function") root.lsSaveSoon();
  }

  async function postIngest(payload) {
    var res = await fetch("/.netlify/functions/applicants-ingest", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    var json = {};
    try {
      json = await res.json();
    } catch (e) {
      json = {};
    }
    if (!res.ok) {
      var err = new Error(json.error || "Ingest failed (" + res.status + ")");
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  function bindImport() {
    var go = $("#hr-recruit-import");
    if (!go || go.getAttribute("data-bound") === "1") return;
    go.setAttribute("data-bound", "1");
    go.onclick = async function () {
      var ta = $("#hr-recruit-json");
      var st = $("#hr-recruit-status");
      var raw = ta ? ta.value : "";
      try {
        var payload = parsePaste(raw);
        go.disabled = true;
        if (st) st.textContent = "Saving…";
        var result = await postIngest(payload);
        var n = (result.created || []).length;
        var failed = (result.errors || []).length;
        var msg = n + " applicant" + (n === 1 ? "" : "s") + " imported";
        if (failed) msg += " · " + failed + " row" + (failed === 1 ? "" : "s") + " skipped";
        toast(msg, failed && !n ? "err" : "ok");
        if (st) st.textContent = msg;
        await refreshApplicants();
        if (typeof root.closeModal === "function") root.closeModal();
        if (typeof root.render === "function") root.render();
      } catch (e) {
        if (st) st.textContent = e.message || String(e);
        toast(e.message || String(e), "err");
      } finally {
        go.disabled = false;
      }
    };
  }

  function openPasteDoor() {
    if (typeof root.openModal !== "function") {
      toast("The import door is not available in this view.", "err");
      return;
    }
    root.openModal({
      title: "Bulk import applicants",
      wide: true,
      body:
        '<div class="stack">' +
        '<div class="note">Paste JSON from the extractor: <span class="mono">{ "applicants": [ { "name": "…" } ] }</span> ' +
        "or a bare array. Required field is <b>name</b>. Optional: email, mobile, roleId (ro01–ro10), " +
        "position, dept, resumeLink, notes, source (default Email), appliedOn. " +
        "Existing ids are not overwritten.</div>" +
        '<div class="f"><label>JSON</label><textarea id="hr-recruit-json" style="min-height:220px" ' +
        'placeholder="{ &quot;applicants&quot;: [ { &quot;name&quot;: &quot;Dela Cruz, Juan&quot;, &quot;roleId&quot;: &quot;ro02&quot;, &quot;source&quot;: &quot;GoDaddy&quot; } ] }"></textarea></div>' +
        '<div class="lbl" id="hr-recruit-status"></div>' +
        "</div>",
      foot: '<button class="btn pri" id="hr-recruit-import" type="button">Import</button>',
    });
    bindImport();
  }

  function injectButton() {
    if (typeof document === "undefined") return null;
    var log = document.getElementById("new-app");
    if (!log || !log.parentNode) return null;
    if (document.getElementById("hr-recruit-bulk")) return document.getElementById("hr-recruit-bulk");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn sm";
    btn.id = "hr-recruit-bulk";
    btn.textContent = "Bulk import JSON";
    log.parentNode.insertBefore(btn, log.nextSibling);
    btn.onclick = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      openPasteDoor();
    };
    return btn;
  }

  function injectChrome() {
    try {
      injectButton();
    } catch (e) {}
  }

  function attach() {
    if (api.attached) return api;
    if (typeof root.render === "function" && !root.render.__hrRecruit) {
      var orig = root.render;
      root.render = function () {
        var out = orig.apply(this, arguments);
        injectChrome();
        return out;
      };
      root.render.__hrRecruit = true;
    }
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", injectChrome);
      } else {
        injectChrome();
      }
    }
    api.attached = true;
    return api;
  }

  api.parsePaste = parsePaste;
  api.injectButton = injectButton;
  api.openPasteDoor = openPasteDoor;
  api.install = attach;
  root.hrRecruit = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
