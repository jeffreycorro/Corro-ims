/**
 * Pipeline "Import from email" for hrcorcondev@gmail.com.
 * Reuses applicants-ingest (session cookie). IMAP pull is optional and
 * configured only on Netlify — no secrets in this file.
 */
(function (root) {
  "use strict";

  var MAILBOX = "hrcorcondev@gmail.com";
  var DRIVE_FOLDER =
    "https://drive.google.com/drive/folders/1G1TJ5rmI_rGEQcXjKLfYfy2dx9gtZRgC";
  var EXPORT_JSON_URL = "https://drive.google.com/file/d/1sfAgcO2aXeGsAsn1CsIDg7_36bVp_3AI/view";
  var EXPORT_CSV_URL = "https://drive.google.com/file/d/1Mpguswqx_anA5sxmJ1VvyzI0kCy3805L/view";
  var api = {
    attached: false,
    mailbox: MAILBOX,
    driveFolder: DRIVE_FOLDER,
    exportJsonUrl: EXPORT_JSON_URL,
    exportCsvUrl: EXPORT_CSV_URL,
  };

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
      var msg = json.error || "Could not check the applications inbox (" + res.status + ")";
      if (res.status === 401) msg = "Sign in first, then Pull can check the inbox.";
      var err = new Error(msg);
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
      "<li>Ready export as of <b>18 Sep 2026</b>: 67 Pipeline applicants, all with <span class=\"mono\">resumeLink</span>. " +
      "Use <b>Overwrite from extractor (by id)</b> — it updates those ids only and will not create new Pipeline rows. " +
      "A missing id is matched by email, phone, or name instead of being created again. Notes already on the row are kept. " +
      'File: <a href="' +
      EXPORT_JSON_URL +
      '" target="_blank" rel="noopener">builder-latest-applicants-export.json</a> or <a href="' +
      EXPORT_CSV_URL +
      '" target="_blank" rel="noopener">.csv</a> ' +
      '(<a href="' +
      DRIVE_FOLDER +
      '" target="_blank" rel="noopener">Drive folder</a> or <span class="mono">/workspace/hr-applications/</span> on the extractor box). ' +
      "Shortlist 14 all have a CV link; 43 were backfill-patched (some Drive PDFs may still be stub size).</li>" +
      "<li>If the line beside Pull says <b>Inbox not connected yet — ask Jeffrey</b>, the server is missing <span class=\"mono\">HR_APPLICANTS_IMAP_USER</span> and/or <span class=\"mono\">HR_APPLICANTS_IMAP_PASS</span> on site <b>corcondev-hr</b> (Functions scope, Gmail app password). He sets those and redeploys. Do not put the password in chat or git.</li>" +
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
        '<div id="hr-email-status" style="font-size:13px;line-height:1.45">Checking inbox connection…</div>' +
        "</div>",
      foot:
        '<button class="btn" id="hr-email-mailbox" type="button">Import from the mailbox (JSON file)</button>' +
        '<button class="btn" id="hr-email-json" type="button">Bulk import JSON</button>' +
        '<button class="btn" id="hr-email-overwrite" type="button">Overwrite from extractor (by id)</button>' +
        '<span id="hr-email-pull-reason" style="align-self:center;max-width:280px;font-size:12.5px;line-height:1.35;text-align:right;color:var(--crit)"></span>' +
        '<button class="btn pri" id="hr-email-pull" type="button">Pull from ' +
        MAILBOX +
        "</button>",
    });
    var st = $("hr-email-status");
    var pullBtn = $("hr-email-pull");
    var reasonEl = $("hr-email-pull-reason");
    function showPullState(info, err) {
      if (err) {
        var msg = err.message || "Could not check the inbox.";
        if (st) st.textContent = msg;
        if (reasonEl) reasonEl.textContent = msg;
        if (pullBtn) {
          pullBtn.disabled = false;
          pullBtn.title = msg;
        }
        return;
      }
      if (!info || (info.configured !== true && info.configured !== false)) {
        var bad = "Inbox check did not return a connection status. You can still try Pull.";
        if (st) st.textContent = bad;
        if (reasonEl) reasonEl.textContent = bad;
        if (pullBtn) {
          pullBtn.disabled = false;
          pullBtn.title = bad;
        }
        return;
      }
      var off = info.configured === false;
      var why = off ? info.reason || "Inbox not connected yet — ask Jeffrey" : "";
      if (st) {
        st.textContent = off
          ? info.hint || why
          : "Inbox connected (" + (info.mailbox || MAILBOX) + "). Pull recent application emails.";
      }
      if (reasonEl) reasonEl.textContent = why;
      if (pullBtn) {
        pullBtn.disabled = off;
        pullBtn.title = off ? info.hint || why : "Pull recent application emails";
      }
    }
    getStatus()
      .then(function (info) {
        showPullState(info, null);
      })
      .catch(function (e) {
        showPullState(null, e);
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
          var body = e.body || {};
          var imapOff = body.configured === false || body.code === "imap_unconfigured";
          if (imapOff) showPullState(body.configured === false ? body : { configured: false, reason: body.reason, hint: body.hint }, null);
          else {
            showPullState(null, e);
            pullBtn.disabled = false;
          }
          toast((imapOff && (body.reason || body.error)) || e.message || String(e), "err");
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
    var overwriteBtn = $("hr-email-overwrite");
    if (overwriteBtn) {
      overwriteBtn.onclick = function () {
        if (root.hrRecruit && typeof root.hrRecruit.openOverwriteDoor === "function") {
          root.hrRecruit.openOverwriteDoor();
        } else if (root.hrRecruit && typeof root.hrRecruit.openPasteDoor === "function") {
          root.hrRecruit.openPasteDoor({ updateOnly: true, extractor: true });
        } else {
          toast("Extractor overwrite is on Pipeline after the recruit companion loads.", "err");
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
