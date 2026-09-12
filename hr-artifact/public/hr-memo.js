/**
 * Issued / on-paper Company Memoranda for the CorConDev HR artifact.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * Opening a memo that already has a number (or status Issued, or fromDrive)
 * must not look like a new draft. Print footer Form No. uses that number,
 * never "unassigned". Saving must not clear m.no.
 *
 * Issued / Drive-imported paper memos also lock number, date and effective
 * date in the editor — the remaining action is upload the signed copy.
 */
(function () {
  "use strict";

  if (window.hrMemo && window.hrMemo.attached) return;

  function isFiledMemo(m) {
    if (!m || typeof m !== "object") return false;
    return !!(String(m.no || "").trim() || m.fromDrive || m.status === "Issued");
  }

  /* Numbered drafts stay editable. Only issued / on-paper / Drive-scan
     records lock their filed identity fields. */
  function shouldLockIdentity(m) {
    if (!m || typeof m !== "object") return false;
    return !!(m.fromDrive || m.status === "Issued");
  }

  function formNoFor(m, no) {
    var n = String(no || "").trim();
    if (n && n !== "unassigned") return n;
    n = String((m && m.no) || "").trim();
    return n || "";
  }

  function pfISOOpts(key, o, formNo) {
    o = o || {};
    if (key === "memo" && formNo && !o.formNo) {
      return Object.assign({}, o, { formNo: formNo });
    }
    return o;
  }

  function preserveOnSave(prev, next) {
    next = next && typeof next === "object" ? next : {};
    if (!prev) return next;
    if (prev.no && !String(next.no || "").trim()) next.no = prev.no;
    if (prev.fromDrive && next.fromDrive == null) next.fromDrive = prev.fromDrive;
    if (prev.link && !next.link) next.link = prev.link;
    if (prev.fileTitle && !next.fileTitle) next.fileTitle = prev.fileTitle;
    if (shouldLockIdentity(prev)) {
      if (prev.no) next.no = prev.no;
      if (prev.date) next.date = prev.date;
      if (prev.effectivity) next.effectivity = prev.effectivity;
    }
    return next;
  }

  function shouldOfferDraft(m) {
    return isFiledMemo(m) && !String((m && m.body) || "").trim();
  }

  function closestClass(el, cls) {
    var cur = el;
    while (cur && cur !== document && cur !== document.documentElement) {
      var names = String(cur.className || "").split(/\s+/);
      if (names.indexOf(cls) !== -1) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  function textOf(el) {
    if (!el) return "";
    var own = el.textContent != null ? String(el.textContent) : "";
    if (own) return own;
    var bits = [];
    var kids = el.children || [];
    var i;
    for (i = 0; i < kids.length; i += 1) bits.push(textOf(kids[i]));
    return bits.join(" ");
  }

  function findEditor(root) {
    var scope = root && root.querySelector ? root : document;
    var body = scope.querySelector ? scope.querySelector("#m-body") : null;
    var status = scope.querySelector ? scope.querySelector("#m-status") : null;
    var subj = scope.querySelector ? scope.querySelector("#m-subj") : null;
    if (!body || !status || !subj) return null;
    return closestClass(body, "modal") || scope;
  }

  function findPreview(root) {
    var scope = root && root.querySelector ? root : document;
    var back = scope.querySelector ? scope.querySelector("#mp-back") : null;
    if (!back) return null;
    return closestClass(back, "modal") || scope;
  }

  function readDisabledNumber(editor) {
    var inputs = editor.querySelectorAll ? editor.querySelectorAll("input") : [];
    var i;
    for (i = 0; i < inputs.length; i += 1) {
      var el = inputs[i];
      if (!el.disabled) continue;
      var v = String(el.value || "").trim();
      if (!v || v === "assigned when you save" || v === "All Employees") continue;
      return v;
    }
    return "";
  }

  function memoFromEditor(editor) {
    var signed = editor.querySelector
      ? editor.querySelector('[data-signed="memos"]')
      : null;
    var id = signed ? signed.getAttribute("data-signedid") : "";
    var stored =
      id && window.S && window.S.memos && window.S.memos[id]
        ? window.S.memos[id]
        : null;
    var statusEl = editor.querySelector("#m-status");
    var bodyEl = editor.querySelector("#m-body");
    var subjEl = editor.querySelector("#m-subj");
    var fromDrive =
      !!(stored && stored.fromDrive) || /issued on paper/i.test(textOf(editor));
    var link = (stored && stored.link) || "";
    if (!link) {
      var anchors = editor.querySelectorAll ? editor.querySelectorAll("a[href]") : [];
      var a;
      for (a = 0; a < anchors.length; a += 1) {
        var href = anchors[a].getAttribute("href") || "";
        if (/drive\.google\.com|docs\.google\.com/i.test(href)) {
          link = href;
          break;
        }
      }
    }
    return {
      id: id || (stored && stored.id) || "",
      no: (stored && stored.no) || readDisabledNumber(editor),
      status:
        (stored && stored.status) || (statusEl && statusEl.value) || "",
      body: (stored && stored.body) || (bodyEl && bodyEl.value) || "",
      subject: (stored && stored.subject) || (subjEl && subjEl.value) || "",
      fromDrive: fromDrive,
      link: link,
      signedLink: stored && stored.signedLink,
    };
  }

  function ensureStyles() {
    if (document.getElementById("hr-memo-styles")) return;
    var style = document.createElement("style");
    style.id = "hr-memo-styles";
    style.textContent =
      ".hr-memo-filed .hr-memo-ai{display:none}" +
      ".hr-memo-filed.hr-memo-drafting .hr-memo-ai{display:block}" +
      ".hr-memo-scan{border-left-color:var(--accent,#2aa0c0)}" +
      ".hr-memo-offer{margin:0}" +
      ".hr-memo-locked input,.hr-memo-locked select{background:var(--surface2,#f4f1ea);color:var(--ink2,#5c584f)}";
    (document.head || document.documentElement).appendChild(style);
  }

  function hideAiCard(editor) {
    var brief = editor.querySelector("#m-brief");
    var card = brief ? closestClass(brief, "card") : null;
    if (card) {
      card.className = String(card.className || "") + " hr-memo-ai";
      return card;
    }
    var notes = editor.querySelectorAll ? editor.querySelectorAll(".note") : [];
    var i;
    for (i = 0; i < notes.length; i += 1) {
      if (/AI drafting is not available/i.test(textOf(notes[i]))) {
        notes[i].className = String(notes[i].className || "") + " hr-memo-ai";
        return notes[i];
      }
    }
    return null;
  }

  function insertScanBanner(editor, m) {
    if (!m.link || editor.querySelector("#hr-memo-scan")) return null;
    if (/Open the Drive scan|already on file/i.test(textOf(editor))) return null;
    var stack = editor.querySelector(".stack") || editor;
    var note = document.createElement("div");
    note.id = "hr-memo-scan";
    note.className = "note hr-memo-scan";
    note.innerHTML =
      "<b>This memorandum is already on file.</b> " +
      (m.no ? "Number <b>" + escapeHtml(m.no) + "</b>. " : "") +
      '<a href="' +
      escapeAttr(m.link) +
      '" target="_blank" rel="noopener noreferrer"><b>Open the Drive scan</b></a>' +
      " — that scan is the original. Type a subject when you can so the register is searchable. " +
      "The next step is to upload the signed copy.";
    if (stack.firstChild) stack.insertBefore(note, stack.firstChild);
    else stack.appendChild(note);
    return note;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function offerDraftToggle(editor, m) {
    if (!shouldOfferDraft(m) || editor.querySelector("#hr-memo-draft") || editor.querySelector("#m-want-draft")) return null;
    var brief = editor.querySelector("#m-brief");
    var host = brief
      ? closestClass(brief, "card") || brief.parentNode
      : editor.querySelector(".stack");
    if (!host || !host.parentNode) return null;
    var offer = document.createElement("div");
    offer.id = "hr-memo-draft";
    offer.className = "note hr-memo-offer";
    offer.innerHTML =
      "Need a typed body in the portal? " +
      '<button type="button" class="btn sm" id="hr-memo-draft-btn">Draft a text copy</button>' +
      " The paper original stays the record.";
    host.parentNode.insertBefore(offer, host);
    var btn = offer.querySelector("#hr-memo-draft-btn");
    if (btn) {
      btn.addEventListener("click", function () {
        editor.className = String(editor.className || "") + " hr-memo-drafting";
        offer.style.display = "none";
      });
    }
    return offer;
  }

  function lockIdentityFields(editor) {
    var ids = ["m-date", "m-eff", "m-cat", "m-status", "m-aud", "m-detail"];
    var i;
    for (i = 0; i < ids.length; i += 1) {
      var el = editor.querySelector ? editor.querySelector("#" + ids[i]) : null;
      if (el) el.disabled = true;
    }
    var inputs = editor.querySelectorAll ? editor.querySelectorAll("input") : [];
    for (i = 0; i < inputs.length; i += 1) {
      var typ = String(inputs[i].getAttribute ? inputs[i].getAttribute("type") || "" : "").toLowerCase();
      if (typ === "date") inputs[i].disabled = true;
    }
    var picks = editor.querySelectorAll ? editor.querySelectorAll(".ep-q") : [];
    for (i = 0; i < picks.length; i += 1) picks[i].disabled = true;
    editor.className = String(editor.className || "") + " hr-memo-locked";
    return editor;
  }

  function promoteSigned(editor) {
    var foot =
      editor.querySelector(".modal-f") ||
      (document.querySelector && document.querySelector(".modal-f"));
    var save = editor.querySelector("#m-save") || document.getElementById("m-save");
    var upload = editor.querySelector('[data-signed="memos"]');
    if (save && save.classList && save.classList.remove) save.classList.remove("pri");
    else if (save) {
      save.className = String(save.className || "")
        .split(/\s+/)
        .filter(function (c) {
          return c && c !== "pri";
        })
        .join(" ");
    }
    if (!foot || !upload || editor.querySelector("#m-upload-signed") || editor.querySelector("#m-upload")) return null;
    if (/Replace/i.test(textOf(upload))) return null;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "m-upload-signed";
    btn.className = "btn pri";
    btn.textContent = "Upload the signed copy";
    btn.addEventListener("click", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (typeof upload.click === "function") upload.click();
    });
    foot.appendChild(btn);
    return btn;
  }

  function softenPreview(preview) {
    var title = preview.querySelector ? preview.querySelector(".modal-h h3") : null;
    var titled = textOf(title);
    if (/not yet numbered/i.test(titled)) return null;
    var notes = preview.querySelectorAll ? preview.querySelectorAll(".note") : [];
    var i;
    for (i = 0; i < notes.length; i += 1) {
      var t = textOf(notes[i]);
      if (!/no body/i.test(t)) continue;
      if (/no subject/i.test(t)) {
        notes[i].innerHTML = t
          .replace(/\s*and no body/i, "")
          .replace(/no body and\s*/i, "");
      } else {
        notes[i].style.display = "none";
      }
      notes[i].setAttribute("data-hr-memo-soft", "1");
      return notes[i];
    }
    return null;
  }

  function enhanceEditor(editor, memo) {
    var m = memo || memoFromEditor(editor);
    if (!isFiledMemo(m)) return null;
    if (editor.getAttribute && editor.getAttribute("data-hr-memo") === "1") {
      return m;
    }
    if (editor.setAttribute) editor.setAttribute("data-hr-memo", "1");
    editor.className = String(editor.className || "") + " hr-memo-filed";
    hideAiCard(editor);
    insertScanBanner(editor, m);
    offerDraftToggle(editor, m);
    promoteSigned(editor);
    if (shouldLockIdentity(m)) lockIdentityFields(editor);
    return m;
  }

  function enhance(root) {
    ensureStyles();
    var preview = findPreview(root);
    if (preview && !(preview.getAttribute && preview.getAttribute("data-hr-memo-preview") === "1")) {
      if (preview.setAttribute) preview.setAttribute("data-hr-memo-preview", "1");
      softenPreview(preview);
    }
    var editor = findEditor(root);
    if (!editor) return null;
    return enhanceEditor(editor);
  }

  function wrapMemoPaper() {
    var orig = window.memoPaper;
    if (typeof orig !== "function" || orig._hrMemo) return false;
    window.memoPaper = function (m, no) {
      var formNo = formNoFor(m, no);
      var origPf = window.pfISO;
      if (typeof origPf === "function") {
        window.pfISO = function (key, o) {
          return origPf.call(this, key, pfISOOpts(key, o, formNo));
        };
      }
      try {
        return orig.call(this, m, no);
      } finally {
        if (origPf) window.pfISO = origPf;
      }
    };
    window.memoPaper._hrMemo = true;
    return true;
  }

  function wrapPut() {
    var orig = window.put;
    if (typeof orig !== "function" || orig._hrMemo) return false;
    window.put = function (coll, id, obj) {
      if (coll === "memos" && obj) {
        var prev = window.S && window.S.memos && window.S.memos[id];
        obj = preserveOnSave(prev, obj);
        arguments[2] = obj;
      }
      return orig.apply(this, arguments);
    };
    window.put._hrMemo = true;
    return true;
  }

  function wrapAllocate() {
    var orig = window.allocate;
    if (typeof orig !== "function" || orig._hrMemo) return false;
    window.allocate = function (key, meta) {
      if (String(key) === "CM" && meta && meta.refId && window.S && window.S.memos) {
        var existing = window.S.memos[meta.refId];
        if (existing && existing.no) {
          return Promise.resolve({ no: existing.no, reused: true });
        }
      }
      return orig.apply(this, arguments);
    };
    window.allocate._hrMemo = true;
    return true;
  }

  function wrapMemoDraw() {
    var orig = window.memoDraw;
    if (typeof orig !== "function" || orig._hrMemo) return false;
    window.memoDraw = function (m) {
      if (m && window.S && window.S.memos && m.id && window.S.memos[m.id]) {
        preserveOnSave(window.S.memos[m.id], m);
      }
      var ret = orig.apply(this, arguments);
      return Promise.resolve(ret).then(function (v) {
        enhance(document);
        return v;
      });
    };
    window.memoDraw._hrMemo = true;
    return true;
  }

  function patchGlobals() {
    return {
      memoPaper: wrapMemoPaper(),
      put: wrapPut(),
      allocate: wrapAllocate(),
      memoDraw: wrapMemoDraw(),
    };
  }

  var observing = false;
  function observe() {
    if (observing || typeof MutationObserver === "undefined") return;
    observing = true;
    var obs = new MutationObserver(function () {
      patchGlobals();
      enhance(document);
    });
    var start = function () {
      if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  }

  function boot() {
    ensureStyles();
    patchGlobals();
    enhance(document);
    observe();
  }

  var api = {
    isFiledMemo: isFiledMemo,
    shouldLockIdentity: shouldLockIdentity,
    lockIdentityFields: lockIdentityFields,
    formNoFor: formNoFor,
    pfISOOpts: pfISOOpts,
    preserveOnSave: preserveOnSave,
    shouldOfferDraft: shouldOfferDraft,
    memoFromEditor: memoFromEditor,
    enhance: enhance,
    enhanceEditor: enhanceEditor,
    patchGlobals: patchGlobals,
    attached: true,
  };
  window.hrMemo = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
