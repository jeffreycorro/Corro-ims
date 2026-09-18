/**
 * Pipeline "Import from email" for hrcorcondev@gmail.com.
 * Reuses applicants-ingest (session cookie). IMAP pull is optional and
 * configured only on Netlify — no secrets in this file.
 */
(function (root) {
  "use strict";

  var MAILBOX = "hrcorcondev@gmail.com";
  var api = { attached: false, mailbox: MAILBOX };

  function $(id) {
    return typeof document !== "undefined" ? document.getElementById(id) : null;
  }

  function store() {
    if (root.__hrS) return root.__hrS;
    if (root.S && (root.S.applicants || root.S.employees)) return root.S;
    return root.S || {};
  }

  function toast(msg, kind) {
    if (typeof root.toast === "function") root.toast(msg, kind);
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

  async function getStatus() {
    var res = await fetch("/.netlify/functions/applicants-email", {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    });
    var json = {};
    try {
      json = await res.json();
    } catch (e) {
      json = {};
    }
    if (!res.ok) {
      var err = new Error(json.error || "Could not check the applications inbox (" + res.status + ")");
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  async function pullInbox() {
    var res = await fetch("/.netlify/functions/applicants-email", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{}",
    });
    var json = {};
    try {
      json = await res.json();
    } catch (e) {
      json = {};
    }
    if (!res.ok) {
      var err = new Error(json.error || "Inbox pull failed (" + res.status + ")");
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  function cassieSteps(status) {
    var box = (status && status.mailbox) || MAILBOX;
    return (
      '<div class="note"><b>How Cassie runs this</b>' +
      "<ol style=\"margin:8px 0 0 18px;padding:0\">" +
      "<li>Open <b>Recruitment → Pipeline</b> and sign in (same HR login).</li>" +
      "<li>Click <b>Import from email</b>.</li>" +
      "<li>Click <b>Pull from " +
      box +
      "</b>. New people land at Applied; the same name or email updates the existing row.</li>" +
      "<li>If Pull says the inbox is not connected, tell Jeffrey — he sets <span class=\"mono\">HR_APPLICANTS_IMAP_USER</span> / <span class=\"mono\">HR_APPLICANTS_IMAP_PASS</span> on site <b>corcondev-hr</b> (Gmail app password, Functions scope) and redeploys. Do not put the password in chat or git.</li>" +
      "<li>Until IMAP is on: use <b>Import from the mailbox</b> (Mac <span class=\"mono\">applications.json</span>) or <b>Bulk import JSON</span> — both write through the same Pipeline ingest.</li>" +
      "</ol></div>"
    );
  }

  function openEmailDoor() {
    if (typeof root.openModal !== "function") {
      toast("Open Pipeline in the portal to import from email.", "err");
      return;
    }
    root.openModal({
      title: "Import from email",
      wide: true,
      body:
        '<div class="stack">' +
        '<div class="note">Applications sent to <b class="mono">' +
        MAILBOX +
        "</b> should appear on Pipeline. This pull uses your signed-in HR session and the existing applicants ingest — it does not store a mailbox password in the browser.</div>" +
        cassieSteps(null) +
        '<div class="lbl" id="hr-email-status">Checking inbox connection…</div>' +
        "</div>",
      foot:
        '<button class="btn" id="hr-email-mailbox" type="button">Import from the mailbox (JSON file)</button>' +
        '<button class="btn" id="hr-email-json" type="button">Bulk import JSON</button>' +
        '<button class="btn pri" id="hr-email-pull" type="button">Pull from ' +
        MAILBOX +
        "</button>",
    });
    var st = $("hr-email-status");
    var pullBtn = $("hr-email-pull");
    getStatus()
      .then(function (info) {
        if (st) {
          st.textContent = info.configured
            ? "Inbox connected (" + (info.mailbox || MAILBOX) + "). Pull recent application emails."
            : info.hint || "Inbox is not connected on the server yet. Use JSON import until Jeffrey sets the IMAP env vars.";
        }
        if (pullBtn) pullBtn.disabled = !info.configured;
      })
      .catch(function (e) {
        if (st) st.textContent = e.message || String(e);
        if (e.status === 401) toast("Sign in first, then pull the inbox.", "err");
      });
    if (pullBtn) {
      pullBtn.onclick = async function () {
        try {
          pullBtn.disabled = true;
          if (st) st.textContent = "Pulling…";
          var result = await pullInbox();
          var n = (result.created || []).length;
          var u = (result.updated || []).length;
          var failed = (result.errors || []).length;
          var msg = (result.pulled || 0) + " read · " + n + " new · " + u + " updated";
          if (failed) msg += " · " + failed + " skipped";
          toast(msg, failed && !n && !u ? "err" : "ok");
          if (st) st.textContent = msg;
          await refreshApplicants();
          if (typeof root.closeModal === "function") root.closeModal();
          if (typeof root.render === "function") root.render();
        } catch (e) {
          if (st) st.textContent = e.message || String(e);
          toast(e.message || String(e), "err");
          pullBtn.disabled = false;
        }
      };
    }
    var jsonBtn = $("hr-email-json");
    if (jsonBtn) {
      jsonBtn.onclick = function () {
        if (root.hrRecruit && typeof root.hrRecruit.openPasteDoor === "function") {
          root.hrRecruit.openPasteDoor();
        } else {
          toast("Bulk import JSON is on Pipeline after the recruit companion loads.", "err");
        }
      };
    }
    var mailBtn = $("hr-email-mailbox");
    if (mailBtn) {
      mailBtn.onclick = function () {
        if (typeof root.importAppsDialog === "function") root.importAppsDialog();
        else if (typeof root.closeModal === "function") {
          root.closeModal();
          var existing = $("imp-apps");
          if (existing && existing.onclick) existing.onclick();
        }
      };
    }
  }

  function injectButton() {
    if (typeof document === "undefined") return null;
    var existing = document.getElementById("hr-email-import");
    if (existing) return existing;
    var log = document.getElementById("new-app");
    var mailbox = document.getElementById("imp-apps");
    var parent = (mailbox && mailbox.parentNode) || (log && log.parentNode);
    if (!parent) return null;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn sm pri";
    btn.id = "hr-email-import";
    btn.textContent = "Import from email";
    btn.title = "Pull applications from " + MAILBOX + " into Pipeline";
    if (mailbox && mailbox.nextSibling) parent.insertBefore(btn, mailbox.nextSibling);
    else if (log) parent.insertBefore(btn, log);
    else parent.appendChild(btn);
    btn.onclick = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      openEmailDoor();
    };
    return btn;
  }

  function injectChrome() {
    try {
      injectButton();
    } catch (e) {}
  }

  function attach() {
    if (api.attached) {
      injectChrome();
      return api;
    }
    if (typeof root.render === "function" && !root.render._hrEmailApps) {
      var orig = root.render;
      root.render = function () {
        var out = orig.apply(this, arguments);
        injectChrome();
        return out;
      };
      root.render._hrEmailApps = true;
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

  api.attach = attach;
  api.install = attach;
  api.injectButton = injectButton;
  api.openEmailDoor = openEmailDoor;
  api.getStatus = getStatus;
  api.pullInbox = pullInbox;
  root.hrEmailApplicants = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
