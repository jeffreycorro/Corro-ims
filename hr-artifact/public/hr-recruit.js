/**
 * Recruitment helpers for the CorConDev HR artifact.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * Adds Pipeline "Bulk import JSON", "Consolidate duplicates", a
 * role filter, a live search bar, applicant exam-score rows, a
 * "View 201 / application file" action on the applicant editor, and
 * Initial interviews: a date and time on the applicant, listed by position.
 * The schedule opens on today's interviews (Asia/Manila). Another date,
 * All dates, or Unscheduled is one click. A name that is not on the
 * pipeline can be typed in and is added there.
 * Open roles, re-applicants, and per-position metrics read the same
 * applicant and role records. A manpower request is stored on the role.
 */
(function (root) {
  "use strict";

  if (root.hrRecruit && root.hrRecruit.version === "1.10.0") return;

  var api = {
    version: "1.10.0",
    attached: false,
    openAppId: "",
    roleFilter: "",
    pipelineSearch: "",
    interviewDay: "",
    pipelineScheduleDay: "",
    pipelineInterviewLimit: false,
    draftStaffNotes: [],
    draftExamScores: [],
  };

  var STAFF_NOTE_KINDS = [
    { key: "background", label: "Background check" },
    { key: "observation", label: "Observation" },
    { key: "other", label: "Other" },
  ];

  function dedupe() {
    return (
      root.hrApplicantDedupe ||
      (typeof window !== "undefined" && window.hrApplicantDedupe) ||
      (typeof globalThis !== "undefined" && globalThis.hrApplicantDedupe) ||
      {}
    );
  }

  function $(sel, r) {
    return (r || document).querySelector(sel);
  }

  function $$(sel, r) {
    return Array.prototype.slice.call((r || document).querySelectorAll(sel));
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function exportApi() {
    return (
      root.hrApplicantsExport ||
      (typeof window !== "undefined" && window.hrApplicantsExport) ||
      (typeof globalThis !== "undefined" && globalThis.hrApplicantsExport) ||
      {}
    );
  }

  function parsePaste(text, opts) {
    var exp = exportApi();
    if (typeof exp.parseApplicantsExport === "function") {
      return exp.parseApplicantsExport(text, opts);
    }
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

  /* Artifact state is `const S`, a lexical binding. Filters and a mailbox
     refresh miss a person who was just logged until this binds that store. */
  function bindStore() {
    if (root.__hrS && root.__hrS.applicants) {
      root.S = root.__hrS;
      return root.__hrS;
    }
    if (root.S && root.S.applicants) return root.S;
    try {
      if (typeof document !== "undefined" && document.documentElement && typeof document.createElement === "function") {
        var s = document.createElement("script");
        s.textContent = "window.__hrS=S;window.S=S;";
        document.documentElement.appendChild(s);
        if (s.parentNode) s.parentNode.removeChild(s);
      }
    } catch (e0) {}
    if (root.__hrS) {
      root.S = root.__hrS;
      return root.__hrS;
    }
    return root.S || null;
  }

  function store() {
    return bindStore();
  }

  function today() {
    if (root.TODAY) return String(root.TODAY);
    var t = new Date();
    return (
      t.getFullYear() +
      "-" +
      String(t.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(t.getDate()).padStart(2, "0")
    );
  }

  function applicantList() {
    var S = store();
    if (!S || !S.applicants) return [];
    return Object.keys(S.applicants).map(function (id) {
      var row = S.applicants[id];
      if (!row) return null;
      if (!row.id) row.id = id;
      return row;
    }).filter(Boolean);
  }

  function findApplicant(id) {
    var S = store();
    if (!S || !S.applicants || !id) return null;
    return S.applicants[id] || null;
  }

  async function persistApplicant(a) {
    if (!a || !a.id) return;
    var S = store();
    if (S && S.applicants) S.applicants[a.id] = a;
    if (typeof root.put === "function") await root.put("applicants", a.id, a);
  }

  function newExamScoreId() {
    return "es_" + Math.random().toString(36).slice(2, 10);
  }

  function catalogExam(examId) {
    var S = store() || {};
    if (!examId || !S.exams) return null;
    return S.exams[examId] || null;
  }

  function normalizeExamScore(raw) {
    if (raw == null) return null;
    if (typeof raw !== "object") return null;
    var catalog = catalogExam(raw.examId);
    var title = String(raw.title || raw.name || (catalog && catalog.title) || "").trim();
    var scoreNum = raw.score === "" || raw.score == null ? NaN : Number(raw.score);
    if (!title && !Number.isFinite(scoreNum) && !raw.examId) return null;
    var maxNum = raw.max != null && raw.max !== "" ? Number(raw.max) : raw.maxScore != null && raw.maxScore !== "" ? Number(raw.maxScore) : NaN;
    if (!Number.isFinite(maxNum) && catalog && catalog.maxScore != null) maxNum = Number(catalog.maxScore);
    var rec = {
      id: String(raw.id || newExamScoreId()),
      examId: String(raw.examId || ""),
      title: title || "Exam",
      score: Number.isFinite(scoreNum) ? scoreNum : raw.score,
      takenOn: String(raw.takenOn || raw.on || today()),
      notes: String(raw.notes || "").trim(),
    };
    if (Number.isFinite(maxNum)) rec.max = maxNum;
    if (raw.form) rec.form = raw.form;
    if (raw.minutes != null) rec.minutes = raw.minutes;
    if (raw.byCat) rec.byCat = raw.byCat;
    if (raw.passing != null) rec.passing = raw.passing;
    if (raw.on && !raw.takenOn) rec.on = raw.on;
    return rec;
  }

  function mergeExamScores() {
    var out = [];
    var seen = Object.create(null);
    Array.prototype.forEach.call(arguments, function (list) {
      (list || []).forEach(function (raw) {
        var n = normalizeExamScore(raw);
        if (!n) return;
        if (seen[n.id]) {
          var i;
          for (i = 0; i < out.length; i += 1) {
            if (out[i].id === n.id) {
              out[i] = Object.assign({}, out[i], n);
              return;
            }
          }
        }
        seen[n.id] = true;
        out.push(n);
      });
    });
    return out;
  }

  function examScoresOf(a) {
    return mergeExamScores((a && a.exams) || [], api.draftExamScores || []);
  }

  function appendExamScore(a, fields) {
    var entry = normalizeExamScore(
      Object.assign(
        {
          id: newExamScoreId(),
          takenOn: today(),
        },
        fields || {}
      )
    );
    if (!entry) return null;
    if (a && a.id && findApplicant(a.id)) {
      a.exams = mergeExamScores(a.exams, [entry]);
    } else {
      api.draftExamScores = mergeExamScores(api.draftExamScores, [entry]);
    }
    return entry;
  }

  function updateExamScore(a, id, fields) {
    var list = a && a.id && findApplicant(a.id) ? a.exams || [] : api.draftExamScores || [];
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (String(list[i].id) === String(id)) {
        var next = normalizeExamScore(Object.assign({}, list[i], fields || {}, { id: list[i].id }));
        if (!next) return null;
        list[i] = Object.assign({}, list[i], next);
        if (a && a.id && findApplicant(a.id)) a.exams = list;
        else api.draftExamScores = list;
        return list[i];
      }
    }
    return null;
  }

  function removeExamScore(a, id) {
    function drop(list) {
      return (list || []).filter(function (row) {
        return String(row.id) !== String(id);
      });
    }
    if (a && a.id && findApplicant(a.id)) {
      var before = (a.exams || []).length;
      a.exams = drop(a.exams);
      return a.exams.length !== before;
    }
    var prev = (api.draftExamScores || []).length;
    api.draftExamScores = drop(api.draftExamScores);
    return api.draftExamScores.length !== prev;
  }

  function examScoreLine(r) {
    var n = normalizeExamScore(r) || r || {};
    var max = n.max != null ? n.max : n.maxScore;
    return (
      String(n.title || "Exam") +
      ": " +
      (n.score == null || n.score === "" ? "—" : String(n.score)) +
      (max != null && max !== "" ? " / " + max : "") +
      (n.takenOn ? " (" + n.takenOn + ")" : "") +
      (n.notes ? " — " + n.notes : "")
    );
  }

  function examScoresSummaryHtml(a) {
    var list = examScoresOf(a || {});
    if (!list.length) {
      return '<div class="lbl" id="hr-recruit-exam-summary-empty">No exam scores on this application.</div>';
    }
    return (
      '<div class="sect-h" style="margin:10px 0 0"><h2 style="font-size:12.5px">Exam scores</h2><span class="rule"></span></div>' +
      '<div class="chklist" id="hr-recruit-exam-summary">' +
      list
        .map(function (n, i) {
          return (
            '<div class="chk"><span class="idx">' +
            String(i + 1).padStart(2, "0") +
            '</span><span class="n"><b>' +
            esc(n.title || "Exam") +
            "</b><span>" +
            esc(n.takenOn || "") +
            (n.notes ? " · " + esc(n.notes) : "") +
            '</span></span><span class="mono">' +
            esc(n.score == null || n.score === "" ? "—" : String(n.score)) +
            (n.max != null ? " / " + esc(String(n.max)) : "") +
            "</span></div>"
          );
        })
        .join("") +
      "</div>"
    );
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
    Object.keys(S.applicants || {}).forEach(function (id) {
      var row = S.applicants[id];
      if (!row || !row._pendingSave || next[id]) return;
      next[id] = row;
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

  function bindImport(opts) {
    opts = opts || {};
    var go = $("#hr-recruit-import");
    if (!go || go.getAttribute("data-bound") === "1") return;
    go.setAttribute("data-bound", "1");
    var ta = $("#hr-recruit-json");
    var file = $("#hr-recruit-file");
    var st = $("#hr-recruit-status");
    if (file) {
      file.onchange = function () {
        var chosen = file.files && file.files[0];
        if (!chosen || typeof FileReader === "undefined") return;
        var reader = new FileReader();
        reader.onload = function () {
          if (ta) ta.value = String(reader.result || "");
          if (st) st.textContent = chosen.name + " loaded";
        };
        reader.readAsText(chosen);
      };
    }
    go.onclick = async function () {
      var raw = ta ? ta.value : "";
      var box = $("#hr-recruit-update-only");
      var updateOnly = opts.updateOnly === true || (box && box.checked);
      try {
        var payload = parsePaste(raw, { updateOnly: updateOnly });
        if (updateOnly) {
          payload.overwrite = true;
          payload.updateOnly = true;
        }
        go.disabled = true;
        if (st) st.textContent = "Saving…";
        var result = await postIngest(payload);
        var n = (result.created || []).length;
        var u = (result.updated || []).length;
        var failed = (result.errors || []).length;
        var msg = n + " new · " + u + " updated";
        if (failed) msg += " · " + failed + " skipped";
        toast(msg, failed && !n && !u ? "err" : "ok");
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

  function openPasteDoor(opts) {
    if (typeof root.openModal !== "function") {
      toast("The import door is not available in this view.", "err");
      return;
    }
    opts = opts || {};
    var exp = exportApi();
    var updateOnly = opts.updateOnly === true || opts.extractor === true;
    var folder = (exp && exp.DRIVE_FOLDER_URL) || "https://drive.google.com/drive/folders/1G1TJ5rmI_rGEQcXjKLfYfy2dx9gtZRgC";
    var jsonUrl = (exp && exp.EXPORT_JSON_URL) || "https://drive.google.com/file/d/1sfAgcO2aXeGsAsn1CsIDg7_36bVp_3AI/view";
    var csvUrl = (exp && exp.EXPORT_CSV_URL) || "https://drive.google.com/file/d/1Mpguswqx_anA5sxmJ1VvyzI0kCy3805L/view";
    var note = updateOnly
      ? '<div class="note">Ready export as of <b>18 Sep 2026</b>: 67 Pipeline applicants, all with <span class="mono">resumeLink</span>. ' +
        "<b>Overwrite by id</b> — this does not create new Pipeline rows. An id that is no longer on Pipeline is matched by email, phone, then name, and skipped when nothing matches. Notes are merged, not replaced. " +
        "Shortlist 14 all have a CV link; 43 were backfill-patched (some Drive PDFs may still be stub size). " +
        'Download <a href="' +
        esc(jsonUrl) +
        '" target="_blank" rel="noopener">builder-latest-applicants-export.json</a> or <a href="' +
        esc(csvUrl) +
        '" target="_blank" rel="noopener">.csv</a> ' +
        '(<a href="' +
        esc(folder) +
        '" target="_blank" rel="noopener">Drive folder</a> or <span class="mono">/workspace/hr-applications/</span> on the extractor box), then paste or choose the file.</div>'
      : '<div class="note">Paste JSON from the extractor: <span class="mono">{ "applicants": [ { "name": "…" } ] }</span> ' +
        "or a bare array, or the extractor CSV (<span class=\"mono\">id,name,resumeLink</span>). Required field is <b>name</b>. " +
        "Optional: email, mobile, roleId (ro01–ro10), position, dept, resumeLink, notes, source (default Email), appliedOn. " +
        "Same person (email, phone, or normalized name) updates the existing row unless you send " +
        '<span class="mono">forceNew: true</span>. An id that is not on Pipeline is not reused. ' +
        "An extractor export (asOf / Drive folder / all rows have id) " +
        "overwrites those ids only and will not mint new rows.</div>";
    root.openModal({
      title: updateOnly ? "Overwrite Pipeline from extractor" : "Bulk import applicants",
      wide: true,
      body:
        '<div class="stack">' +
        note +
        '<div class="f"><label>File</label><input type="file" id="hr-recruit-file" accept=".json,.csv,application/json,text/csv"></div>' +
        '<div class="f"><label>JSON or CSV</label><textarea id="hr-recruit-json" style="min-height:220px" ' +
        'placeholder="{ &quot;applicants&quot;: [ { &quot;id&quot;: &quot;a_…&quot;, &quot;name&quot;: &quot;Dela Cruz, Juan&quot;, &quot;resumeLink&quot;: &quot;https://drive.google.com/…&quot; } ] }"></textarea></div>' +
        '<label class="chk" style="display:flex;gap:8px;align-items:flex-start">' +
        '<input type="checkbox" id="hr-recruit-update-only"' +
        (updateOnly ? " checked disabled" : "") +
        ">" +
        "<span>Overwrite existing Pipeline rows by <b>id</b> only — do not create new rows</span></label>" +
        '<div class="lbl" id="hr-recruit-status"></div>' +
        "</div>",
      foot:
        '<button class="btn pri" id="hr-recruit-import" type="button">' +
        (updateOnly ? "Overwrite existing by id" : "Import") +
        "</button>",
    });
    bindImport({ updateOnly: updateOnly });
  }

  function openOverwriteDoor() {
    return openPasteDoor({ updateOnly: true, extractor: true });
  }

  function reasonLabel(reason) {
    return (
      {
        "same-name-same-role": "Same name, same role — safe to merge",
        "same-name-blank-role": "Same name, blank or matching role — safe to merge",
        "conflicting-roles": "Same name, different roles — confirm they are one person",
        "conflicting-emails": "Same name, different emails — confirm they are one person",
        "same-email-different-names": "Same email, different names — confirm they are one person",
        "similar-names": "Names overlap (extra middle name or suffix) — confirm they are one person",
      }[reason] || "Needs a look before merging"
    );
  }

  function roleTitle(a) {
    var S = store() || {};
    var ro = a && a.roleId && S.roles ? S.roles[a.roleId] : null;
    return (ro && ro.title) || (a && a.position) || "—";
  }

  function rolesMap() {
    var S = store() || {};
    return S.roles || {};
  }

  function displayRoleTitle(a, roles) {
    roles = roles || rolesMap();
    var ro = a && a.roleId ? roles[a.roleId] : null;
    var title = (ro && ro.title) || (a && a.position) || "";
    return String(title).trim();
  }

  function roleFilterKey(a, roles) {
    roles = roles || rolesMap();
    if (a && a.roleId && roles[a.roleId]) return String(a.roleId);
    var title = displayRoleTitle(a, roles);
    if (title) {
      var ids = Object.keys(roles);
      var i;
      for (i = 0; i < ids.length; i += 1) {
        if (roles[ids[i]] && String(roles[ids[i]].title || "").trim() === title) {
          return ids[i];
        }
      }
      return "title:" + title.toLowerCase();
    }
    return "unlinked";
  }

  function applicantMatchesRole(a, filter, roles) {
    roles = roles || rolesMap();
    var want = String(filter == null ? "" : filter);
    if (!want || want === "all") return true;
    if (want === "unlinked") return roleFilterKey(a, roles) === "unlinked";
    if (want.indexOf("title:") === 0) return roleFilterKey(a, roles) === want;
    if (a && String(a.roleId || "") === want) return true;
    var titled = roles[want] && String(roles[want].title || "").trim();
    if (titled && displayRoleTitle(a, roles) === titled) return true;
    return false;
  }

  function searchHaystack(a, roles) {
    roles = roles || rolesMap();
    var name = String((a && a.name) || "");
    var flipped = "";
    if (name.indexOf(",") >= 0) {
      flipped = name
        .split(",")
        .map(function (part) {
          return part.trim();
        })
        .filter(Boolean)
        .reverse()
        .join(" ");
    }
    var nameLoose = name.replace(/[.,]/g, " ");
    var mobile = String((a && a.mobile) || "");
    var mobileLoose = mobile.replace(/[\s().+-]/g, "");
    return [
      name,
      nameLoose,
      flipped,
      a && a.email,
      mobile,
      mobileLoose,
      a && a.position,
      displayRoleTitle(a, roles),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function applicantMatchesSearch(a, query, roles) {
    var q = String(query == null ? "" : query)
      .trim()
      .toLowerCase();
    if (!q) return true;
    var hay = searchHaystack(a, roles);
    var words = q.split(/\s+/).map(function (word) {
      return word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    }).filter(Boolean);
    if (!words.length) return false;
    return words.every(function (word) {
      return hay.indexOf(word) >= 0;
    });
  }

  function applicantMatchesPipeline(a, filter, query, roles) {
    if (!applicantMatchesRole(a, filter, roles) || !applicantMatchesSearch(a, query, roles)) return false;
    if (!pipelineInterviewLimitOn()) return true;
    return applicantMatchesInterviewView(a, currentPipelineScheduleDay());
  }

  function roleFilterOptions(list, roles) {
    roles = roles || rolesMap();
    var seen = Object.create(null);
    var out = [];
    (list || []).forEach(function (a) {
      var key = roleFilterKey(a, roles);
      if (seen[key]) {
        seen[key].count += 1;
        return;
      }
      seen[key] = {
        key: key,
        label: key === "unlinked" ? "Unlinked" : displayRoleTitle(a, roles) || "Unlinked",
        count: 1,
      };
      out.push(seen[key]);
    });
    out.sort(function (a, b) {
      if (a.key === "unlinked") return 1;
      if (b.key === "unlinked") return -1;
      return a.label.localeCompare(b.label);
    });
    return out;
  }

  function currentRoleFilter() {
    var S = store();
    if (S && S.ui && S.ui.pipelineRoleFilter != null) return String(S.ui.pipelineRoleFilter);
    return String(api.roleFilter || "");
  }

  function currentSearch() {
    var S = store();
    if (S && S.ui && S.ui.pipelineSearch != null) return String(S.ui.pipelineSearch);
    return String(api.pipelineSearch || "");
  }

  function setRoleFilter(key) {
    var want = String(key == null ? "" : key);
    if (want === "all") want = "";
    api.roleFilter = want;
    var S = store();
    if (S) {
      S.ui = S.ui || {};
      S.ui.pipelineRoleFilter = want;
    }
    applyPipelineFilters();
    paintRoleFilter();
  }

  function setPipelineSearch(query) {
    var next = String(query == null ? "" : query);
    api.pipelineSearch = next;
    var S = store();
    if (S) {
      S.ui = S.ui || {};
      S.ui.pipelineSearch = next;
    }
    applyPipelineFilters();
  }

  function pipelineStageBlocks(doc) {
    doc = doc || document;
    var log = doc.getElementById && doc.getElementById("new-app");
    if (!log) return [];
    var sect = log.parentNode;
    var blocks = [];
    var el = sect && sect.nextElementSibling;
    while (el) {
      if (el.id === "hr-recruit-role-filter" || el.id === "hr-recruit-search-wrap") {
        el = el.nextElementSibling;
        continue;
      }
      var cls = String(el.className || "");
      if (cls.indexOf("sect-h") >= 0) {
        var card = el.nextElementSibling;
        if (card && String(card.className || "").indexOf("card") >= 0) {
          blocks.push({
            header: el,
            card: card,
            pill: el.querySelector ? el.querySelector(".pill") : null,
          });
          el = card.nextElementSibling;
          continue;
        }
      }
      el = el.nextElementSibling;
    }
    return blocks;
  }

  function applyPipelineFilters(doc) {
    doc = doc || document;
    if (!doc || !doc.getElementById || !doc.getElementById("new-app")) return 0;
    var filter = currentRoleFilter();
    var query = currentSearch();
    var roles = rolesMap();
    var shown = 0;
    var total = 0;
    pipelineStageBlocks(doc).forEach(function (block) {
      var rows = block.card.querySelectorAll
        ? Array.prototype.slice.call(block.card.querySelectorAll("tbody tr"))
        : [];
      var visible = 0;
      rows.forEach(function (tr) {
        var btn = tr.querySelector ? tr.querySelector("[data-open-app]") : null;
        var id = btn && btn.getAttribute ? btn.getAttribute("data-open-app") : "";
        var a = findApplicant(id);
        total += 1;
        var ok = !a || applicantMatchesPipeline(a, filter, query, roles);
        if (ok) {
          visible += 1;
          shown += 1;
        }
        if (tr.style) tr.style.display = ok ? "" : "none";
      });
      var hide = rows.length > 0 && visible === 0;
      if (block.header && block.header.style) block.header.style.display = hide ? "none" : "";
      if (block.card && block.card.style) block.card.style.display = hide ? "none" : "";
      if (block.pill) block.pill.textContent = String(visible);
    });
    var note = doc.getElementById("hr-recruit-role-count");
    if (note) {
      var active = !!filter || !!String(query).trim() || pipelineInterviewLimitOn();
      note.textContent = active
        ? "Showing " + shown + " of " + total
        : total
          ? total + " on pipeline"
          : "";
    }
    var clear = doc.getElementById("hr-recruit-search-clear");
    if (clear) clear.hidden = !String(query).trim();
    return shown;
  }

  function applyRoleFilter(doc) {
    return applyPipelineFilters(doc);
  }

  function paintRoleFilter(bar) {
    bar = bar || (typeof document !== "undefined" && document.getElementById("hr-recruit-role-filter"));
    if (!bar) return bar;
    var filter = currentRoleFilter();
    var chips = bar.querySelectorAll ? bar.querySelectorAll("[data-role-filter]") : [];
    Array.prototype.forEach.call(chips, function (chip) {
      var key = chip.getAttribute("data-role-filter");
      var on = (key || "") === (filter || "");
      var cls = String(chip.className || "").replace(/\bon\b/g, "").replace(/\s+/g, " ").trim();
      chip.className = on ? cls + " on" : cls;
    });
    return bar;
  }

  function roleFilterHtml() {
    var options = roleFilterOptions(applicantList(), rolesMap());
    var filter = currentRoleFilter();
    var total = applicantList().length;
    var chips =
      '<button type="button" class="btn sm' +
      (!filter ? " on" : "") +
      '" data-role-filter="">All roles</button>';
    options.forEach(function (opt) {
      chips +=
        '<button type="button" class="btn sm' +
        (filter === opt.key ? " on" : "") +
        '" data-role-filter="' +
        esc(opt.key) +
        '">' +
        esc(opt.label) +
        " (" +
        opt.count +
        ")</button>";
    });
    return (
      '<span class="lbl">Role</span>' +
      chips +
      '<span class="lbl" id="hr-recruit-role-count">' +
      (filter ? "" : total ? total + " on pipeline" : "") +
      "</span>"
    );
  }

  function bindRoleFilterClicks(doc) {
    doc = doc || document;
    if (!doc || doc.__hrRoleFilterClicks) return;
    doc.__hrRoleFilterClicks = true;
    if (!doc.addEventListener) return;
    doc.addEventListener(
      "click",
      function (ev) {
        var t = ev && ev.target;
        while (t && t !== doc) {
          if (t.getAttribute && t.getAttribute("data-role-filter") !== null && t.tagName) {
            if (ev.preventDefault) ev.preventDefault();
            setRoleFilter(t.getAttribute("data-role-filter"));
            return;
          }
          t = t.parentNode;
        }
      },
      false
    );
  }

  function bindSearchEvents(doc) {
    doc = doc || document;
    if (!doc || doc.__hrSearchEvents) return;
    doc.__hrSearchEvents = true;
    if (!doc.addEventListener) return;
    doc.addEventListener(
      "input",
      function (ev) {
        var t = ev && ev.target;
        if (t && t.id === "hr-recruit-search") setPipelineSearch(t.value);
      },
      false
    );
    doc.addEventListener(
      "click",
      function (ev) {
        var t = ev && ev.target;
        if (!t || t.id !== "hr-recruit-search-clear") return;
        if (ev.preventDefault) ev.preventDefault();
        var input = doc.getElementById("hr-recruit-search");
        if (input) input.value = "";
        setPipelineSearch("");
        if (input && input.focus) input.focus();
      },
      false
    );
  }

  function searchHtml(query) {
    query = String(query == null ? "" : query);
    return (
      '<input type="search" id="hr-recruit-search" class="search" placeholder="Search name, email, mobile, role…" autocomplete="off" aria-label="Search applicants" value="' +
      esc(query) +
      '">' +
      '<button type="button" class="btn sm ghost" id="hr-recruit-search-clear"' +
      (query.trim() ? "" : " hidden") +
      ">Clear</button>"
    );
  }

  function injectSearch() {
    if (typeof document === "undefined") return null;
    var log = document.getElementById("new-app");
    if (!log || !log.parentNode) {
      var leftover = document.getElementById("hr-recruit-search-wrap");
      if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
      return null;
    }
    bindSearchEvents(document);
    var wrap = document.getElementById("hr-recruit-search-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "hr-recruit-search-wrap";
      wrap.className = "row";
      wrap.setAttribute("data-hr-search", "1");
      log.parentNode.insertBefore(wrap, log);
    }
    var q = currentSearch();
    var input = document.getElementById("hr-recruit-search");
    var focused = input && typeof document.activeElement !== "undefined" && document.activeElement === input;
    if (!input) {
      wrap.innerHTML = searchHtml(q);
    } else if (!focused) {
      input.value = q;
    }
    var clear = document.getElementById("hr-recruit-search-clear");
    if (clear) clear.hidden = !String(q).trim();
    if (wrap.style) {
      wrap.style.flex = "1 1 220px";
      wrap.style.minWidth = "180px";
      wrap.style.maxWidth = "420px";
      wrap.style.gap = "6px";
      wrap.style.alignItems = "center";
      wrap.style.margin = "0";
    }
    return wrap;
  }

  function injectRoleFilter() {
    if (typeof document === "undefined") return null;
    var log = document.getElementById("new-app");
    if (!log || !log.parentNode) {
      var stale = document.getElementById("hr-recruit-role-filter");
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
      return null;
    }
    bindRoleFilterClicks(document);
    var sect = log.parentNode;
    if (sect && sect.style) {
      sect.style.flexWrap = "wrap";
      sect.style.alignItems = "center";
      sect.style.rowGap = "8px";
    }
    var bar = document.getElementById("hr-recruit-role-filter");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "hr-recruit-role-filter";
      bar.className = "row";
      bar.setAttribute("data-hr-role-filter", "1");
    }
    if (bar.parentNode !== sect || bar.nextSibling !== log) {
      sect.insertBefore(bar, log);
    }
    bar.innerHTML = roleFilterHtml();
    if (bar.style) {
      bar.style.flex = "1 1 280px";
      bar.style.flexWrap = "wrap";
      bar.style.gap = "6px";
      bar.style.margin = "0";
      bar.style.alignItems = "center";
      bar.style.minWidth = "200px";
    }
    applyRoleFilter(document);
    paintRoleFilter(bar);
    return bar;
  }

  function duplicateGroups() {
    var fn = dedupe().groupApplicants;
    if (typeof fn !== "function") return [];
    return fn(applicantList());
  }

  function groupPreviewHtml(g) {
    var rows = (g.applicants || [])
      .map(function (a) {
        return (
          "<tr>" +
          '<td class="nm">' +
          esc(a.name || "—") +
          '</td><td>' +
          esc(roleTitle(a)) +
          '</td><td class="mono">' +
          esc(a.appliedOn || "—") +
          "</td><td>" +
          esc(a.stage || "—") +
          "</td><td class=\"mono\">" +
          esc(a.id || "") +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="card" style="margin:0 0 12px" data-dedupe-group="' +
      esc(g.key) +
      '">' +
      '<div class="card-h"><label style="display:flex;align-items:center;gap:8px;font-weight:600">' +
      '<input type="checkbox" data-dedupe-pick="' +
      esc(g.key) +
      '"' +
      (g.autoSafe ? " checked" : "") +
      "> " +
      esc(g.name || "Unnamed") +
      " ×" +
      g.applicants.length +
      "</label>" +
      '<span class="pill ' +
      (g.autoSafe ? "ok" : "warn") +
      '">' +
      (g.autoSafe ? "auto-safe" : "confirm") +
      "</span></div>" +
      '<div class="card-b"><div class="lbl" style="margin-bottom:8px">' +
      esc(reasonLabel(g.reason)) +
      '</div><div class="tw"><table><thead><tr><th>Name on file</th><th>Role</th><th>Applied</th><th>Stage</th><th>Id</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div></div></div>"
    );
  }

  async function mergeGroup(g, opts) {
    var d = dedupe();
    if (!g || typeof d.mergeApplicantRecords !== "function") return null;
    var result = d.mergeApplicantRecords(g.applicants, {
      today: today(),
      keeperId: opts && opts.keeperId,
    });
    if (!result || !result.keeper) return null;
    await persistApplicant(result.keeper);
    var i;
    for (i = 0; i < result.extras.length; i += 1) {
      var extra = result.extras[i];
      if (!extra || !extra.id) continue;
      if (typeof root.drop === "function") await root.drop("applicants", extra.id);
      else {
        var S = store();
        if (S && S.applicants) delete S.applicants[extra.id];
      }
    }
    return result;
  }

  function bindConsolidate() {
    var go = $("#hr-recruit-merge");
    if (!go || go.getAttribute("data-bound") === "1") return;
    go.setAttribute("data-bound", "1");
    go.onclick = async function () {
      var st = $("#hr-recruit-dedupe-status");
      var picks = $$("[data-dedupe-pick]").filter(function (el) {
        return el.checked;
      }).map(function (el) {
        return el.getAttribute("data-dedupe-pick");
      });
      var groups = duplicateGroups().filter(function (g) {
        return picks.indexOf(g.key) >= 0;
      });
      if (!groups.length) {
        toast("Tick at least one group.", "err");
        return;
      }
      var unsafe = groups.filter(function (g) {
        return !g.autoSafe;
      });
      if (unsafe.length) {
        var ok =
          typeof root.askConfirm === "function"
            ? await root.askConfirm(
                "Merge " +
                  unsafe.length +
                  " group" +
                  (unsafe.length === 1 ? "" : "s") +
                  " that need confirmation? Only do this if they are the same person."
              )
            : true;
        if (!ok) return;
      }
      go.disabled = true;
      if (st) st.textContent = "Merging…";
      var merged = 0;
      var extras = 0;
      try {
        var i;
        for (i = 0; i < groups.length; i += 1) {
          var result = await mergeGroup(groups[i]);
          if (result) {
            merged += 1;
            extras += result.extras.length;
          }
        }
        var msg =
          merged +
          " group" +
          (merged === 1 ? "" : "s") +
          " consolidated · " +
          extras +
          " extra record" +
          (extras === 1 ? "" : "s") +
          " removed";
        toast(msg, "ok");
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

  function openConsolidateDoor() {
    if (typeof root.openModal !== "function") {
      toast("The consolidate door is not available in this view.", "err");
      return;
    }
    var groups = duplicateGroups();
    if (!groups.length) {
      toast("No duplicate applicants on the pipeline.", "ok");
      return;
    }
    var autoN = groups.filter(function (g) {
      return g.autoSafe;
    }).length;
    var confirmN = groups.length - autoN;
    var body =
      '<div class="stack">' +
      '<div class="note"><b>' +
      groups.length +
      " duplicate group" +
      (groups.length === 1 ? "" : "s") +
      "</b> — " +
      autoN +
      " auto-safe (same normalized name, same or blank role). " +
      (confirmN
        ? confirmN +
          " need a tick from you (different roles, different emails, or the same email on unlike names). "
        : "") +
      "Each merge keeps the earliest applied date, the furthest stage, non-empty contact/CV fields, and combined notes. Extra records are deleted.</div>" +
      groups.map(groupPreviewHtml).join("") +
      '<div class="lbl" id="hr-recruit-dedupe-status"></div></div>';
    root.openModal({
      title: "Consolidate duplicate applicants",
      wide: true,
      body: body,
      foot:
        '<button class="btn" id="hr-recruit-merge-cancel" type="button">Leave them</button>' +
        '<button class="btn pri" id="hr-recruit-merge" type="button">Merge selected</button>',
    });
    var cancel = $("#hr-recruit-merge-cancel");
    if (cancel) {
      cancel.onclick = function () {
        if (typeof root.closeModal === "function") root.closeModal();
      };
    }
    bindConsolidate();
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

  function injectConsolidateButton() {
    if (typeof document === "undefined") return null;
    var bulk = document.getElementById("hr-recruit-bulk") || injectButton();
    var existing = document.getElementById("hr-recruit-dedupe");
    var groups = duplicateGroups();
    if (!groups.length) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return null;
    }
    if (existing) {
      existing.textContent = "Consolidate duplicates (" + groups.length + ")";
      return existing;
    }
    if (!bulk || !bulk.parentNode) return null;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn sm";
    btn.id = "hr-recruit-dedupe";
    btn.textContent = "Consolidate duplicates (" + groups.length + ")";
    bulk.parentNode.insertBefore(btn, bulk.nextSibling);
    btn.onclick = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      openConsolidateDoor();
    };
    return btn;
  }

  function isApplicantEditorModal(opts) {
    var title = String((opts && opts.title) || "");
    return /^Applicant —/.test(title) || title === "Log an applicant";
  }

  function applicantFromEditor() {
    var id = api.openAppId;
    if (id) return findApplicant(id);
    var title = "";
    var h = document.querySelector && document.querySelector(".modal h2, .modal .modal-h, #modal h2");
    if (h) title = h.textContent || "";
    var m = String(title).match(/^Applicant —\s*(.+)$/);
    if (!m) return null;
    var want = m[1].trim();
    return applicantList().find(function (a) {
      return a.name === want;
    }) || null;
  }

  function decorateApplicantFoot(foot, applicant) {
    var html = String(foot || "");
    if (html.indexOf("hr-recruit-file") >= 0) return html;
    var hired = applicant && applicant.hiredEmpId;
    var label = hired ? "Open 201 file" : "View 201 / application file";
    var btn =
      '<button class="btn" id="hr-recruit-file" type="button">' + esc(label) + "</button>";
    if (html.indexOf('id="a-hire"') >= 0) {
      return html.replace('<button class="btn" id="a-hire"', btn + '<button class="btn" id="a-hire"');
    }
    if (html.indexOf('id="a-save"') >= 0) {
      return html.replace('<button class="btn pri" id="a-save"', btn + '<button class="btn pri" id="a-save"');
    }
    return html + btn;
  }

  function recruitmentDocList() {
    var d = dedupe();
    if (typeof d.recruitmentDocs === "function") return d.recruitmentDocs(root.DOCS);
    return d.RECRUITMENT_DOCS || [];
  }

  function fileLinks(v) {
    var d = dedupe();
    if (typeof d.extraLinks === "function" && v && v.__asApplicant) {
      return d.extraLinks(v);
    }
    var out = [];
    var seen = {};
    function push(url, title) {
      url = String(url || "").trim();
      if (!url || seen[url]) return;
      seen[url] = true;
      out.push({ url: url, title: title || "File" });
    }
    if (!v) return out;
    push(v.link, v.title);
    (v.links || []).forEach(function (x) {
      if (typeof x === "string") push(x, "");
      else if (x) push(x.url, x.title);
    });
    return out;
  }

  function applicationFileHtml(a) {
    var d = dedupe();
    var docs = typeof d.seedApplicantDocs === "function" ? d.seedApplicantDocs(a) : (a.docs || {});
    var items = recruitmentDocList();
    var extras = typeof d.extraLinks === "function" ? d.extraLinks(Object.assign({}, a, { docs: docs })) : [];
    var hired = a.hiredEmpId && store() && store().employees && store().employees[a.hiredEmpId];
    var h =
      '<div class="stack" id="hr-recruit-file-body" data-app="' +
      esc(a.id) +
      '">' +
      '<div class="note">Recruitment paperwork for <b>' +
      esc(a.name || "this applicant") +
      "</b> — " +
      esc(roleTitle(a)) +
      " · " +
      esc(a.stage || "Applied") +
      ". This is the application file, not a hired 201. " +
      (hired
        ? 'They already have a 201: use <b>Open 201 file</b>.'
        : "Hire still creates the employee 201. Attach Drive links here for reference.") +
      "</div>";
    if (a.resumeLink) {
      h +=
        '<div class="row"><a class="btn sm pri" href="' +
        esc(a.resumeLink) +
        '" target="_blank" rel="noopener noreferrer">Open CV / documents</a>' +
        '<span class="lbl mono">' +
        esc(a.resumeLink) +
        "</span></div>";
    }
    h += examScoresSummaryHtml(a);
    h +=
      '<div class="sect-h" style="margin:6px 0 0"><h2 style="font-size:12.5px">Recruitment checklist</h2><span class="rule"></span></div>' +
      '<div class="chklist">';
    items.forEach(function (doc, i) {
      var v = docs[doc.k] || { s: "miss", link: "", links: [], filed: "" };
      var links = fileLinks(v);
      h +=
        '<div class="chk" data-appdoc="' +
        esc(doc.k) +
        '"><span class="idx">' +
        String(i + 1).padStart(2, "0") +
        "</span><span class=\"n\"><b>" +
        esc(doc.n) +
        "</b>";
      if (links.length) {
        h +=
          '<span style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">' +
          links
            .map(function (x) {
              return (
                '<a class="pill acc" href="' +
                esc(x.url) +
                '" target="_blank" rel="noopener noreferrer">' +
                esc(x.title || "Open") +
                "</a>"
              );
            })
            .join("") +
          "</span>";
      } else {
        h += '<span class="lbl">no file linked</span>';
      }
      h +=
        "</span>" +
        '<select data-appdoc-s="' +
        esc(doc.k) +
        '">' +
        ["miss", "on", "na"]
          .map(function (k) {
            var label = { miss: "Missing", on: "On file", na: "N/A" }[k];
            return (
              '<option value="' +
              k +
              '"' +
              (v.s === k ? " selected" : "") +
              ">" +
              label +
              "</option>"
            );
          })
          .join("") +
        "</select>" +
        '<input type="url" data-appdoc-link="' +
        esc(doc.k) +
        '" placeholder="paste Drive link" value="' +
        esc(v.link || "") +
        '"></div>';
    });
    h += "</div>";
    if (extras.length) {
      h +=
        '<div class="sect-h" style="margin:10px 0 0"><h2 style="font-size:12.5px">Links on this application</h2><span class="rule"></span></div><div class="chklist">';
      extras.forEach(function (x, i) {
        h +=
          '<div class="chk"><span class="idx">' +
          String(i + 1).padStart(2, "0") +
          '</span><span class="n"><b>' +
          esc(x.title) +
          "</b><span class=\"lbl\">" +
          esc(x.note || "") +
          '</span></span><a class="btn sm" href="' +
          esc(x.url) +
          '" target="_blank" rel="noopener noreferrer">Open</a></div>';
      });
      h += "</div>";
    }
    h +=
      '<div class="f"><label>Add another Drive / application link</label>' +
      '<div class="row"><input id="hr-recruit-extra-title" placeholder="Label (e.g. TOR scan)">' +
      '<input id="hr-recruit-extra-url" type="url" placeholder="https://drive.google.com/…">' +
      '<button class="btn" id="hr-recruit-extra-add" type="button">Attach</button></div></div>' +
      '<div class="lbl" id="hr-recruit-file-status"></div></div>';
    return h;
  }

  function readFileEdits(a) {
    var docs = Object.assign({}, a.docs || {});
    $$("[data-appdoc]").forEach(function (row) {
      var k = row.getAttribute("data-appdoc");
      if (!k) return;
      var cur = Object.assign({ s: "miss", link: "", links: [], filed: "" }, docs[k] || {});
      var sel = row.querySelector("[data-appdoc-s]");
      var inp = row.querySelector("[data-appdoc-link]");
      if (sel) cur.s = sel.value || cur.s;
      if (inp) {
        var url = String(inp.value || "").trim();
        if (url && url !== cur.link) {
          cur.link = url;
          cur.links = [{ url: url, title: k, on: today() }].concat(
            (cur.links || []).filter(function (x) {
              return (x.url || x) !== url;
            })
          );
          if (cur.s === "miss") cur.s = "on";
          cur.filed = cur.filed || today();
        }
      }
      docs[k] = cur;
    });
    a.docs = docs;
    var resume = docs.resume;
    if (resume && resume.link && !a.resumeLink) a.resumeLink = resume.link;
    return a;
  }

  function openHired201(a) {
    if (!a || !a.hiredEmpId) return false;
    if (typeof root.closeModal === "function") root.closeModal();
    if (typeof root.go === "function") {
      root.go("employees", a.hiredEmpId, "docs");
      return true;
    }
    return false;
  }

  function bindFileView(a) {
    var back = $("#hr-recruit-file-back");
    if (back) {
      back.onclick = function () {
        if (typeof root.appEditor === "function") root.appEditor(a.id);
      };
    }
    var open201 = $("#hr-recruit-open-201");
    if (open201) {
      open201.onclick = function () {
        if (!openHired201(a)) toast("The 201 record is not on file yet.", "err");
      };
    }
    var save = $("#hr-recruit-file-save");
    if (save) {
      save.onclick = async function () {
        readFileEdits(a);
        await persistApplicant(a);
        toast("Application file saved.", "ok");
        if (typeof root.appEditor === "function") root.appEditor(a.id);
      };
    }
    var add = $("#hr-recruit-extra-add");
    if (add) {
      add.onclick = async function () {
        var title = ($("#hr-recruit-extra-title") || {}).value || "Attachment";
        var url = String(($("#hr-recruit-extra-url") || {}).value || "").trim();
        var st = $("#hr-recruit-file-status");
        if (!url) {
          if (st) st.textContent = "Paste a Drive link first.";
          return;
        }
        a.linkedDocs = (a.linkedDocs || []).concat([
          { title: title, url: url, added: today(), note: "application file" },
        ]);
        await persistApplicant(a);
        openApplicationFile(a.id);
      };
    }
  }

  function openApplicationFile(appId) {
    var a = findApplicant(appId);
    if (!a) {
      toast("Save the applicant first, then open the application file.", "err");
      return;
    }
    if (typeof root.openModal !== "function") {
      toast("The application file is not available in this view.", "err");
      return;
    }
    var hired = a.hiredEmpId && store() && store().employees && store().employees[a.hiredEmpId];
    root.openModal({
      title: "Application file — " + (a.name || ""),
      wide: true,
      body: applicationFileHtml(a),
      foot:
        '<button class="btn" id="hr-recruit-file-back" type="button">Back to applicant</button>' +
        (hired
          ? '<button class="btn pri" id="hr-recruit-open-201" type="button">Open 201 file</button>'
          : '<button class="btn pri" id="hr-recruit-file-save" type="button">Save attachments</button>'),
    });
    bindFileView(a);
  }

  function bindApplicantFileButton() {
    var btn = $("#hr-recruit-file");
    if (!btn || btn.getAttribute("data-bound") === "1") return;
    btn.setAttribute("data-bound", "1");
    btn.onclick = async function () {
      var a = applicantFromEditor();
      if (!a) {
        toast("Save the applicant first, then open the application file.", "err");
        return;
      }
      if (a.hiredEmpId && store() && store().employees && store().employees[a.hiredEmpId]) {
        openHired201(a);
        return;
      }
      var grabName = $("#a-name");
      var grabCv = $("#a-cv");
      if (grabName && grabName.value) a.name = grabName.value.trim();
      if (grabCv && grabCv.value) a.resumeLink = grabCv.value.trim();
      if (typeof root.put === "function") await persistApplicant(a);
      openApplicationFile(a.id);
    };
  }

  function staffNoteKindLabel(kind) {
    var i;
    for (i = 0; i < STAFF_NOTE_KINDS.length; i += 1) {
      if (STAFF_NOTE_KINDS[i].key === kind) return STAFF_NOTE_KINDS[i].label;
    }
    return "Note";
  }

  function currentAuthor() {
    var S = store() || {};
    var st = S.settings || {};
    return String(st.hrStaff || st.hrHead || "").trim();
  }

  function newStaffNoteId() {
    return "sn_" + Math.random().toString(36).slice(2, 10);
  }

  function normalizeStaffNote(raw) {
    if (!raw || typeof raw !== "object") return null;
    var text = String(raw.text || "").trim();
    if (!text) return null;
    var kind = raw.kind === "observation" || raw.kind === "other" ? raw.kind : "background";
    return {
      id: String(raw.id || newStaffNoteId()),
      kind: kind,
      text: text,
      on: String(raw.on || today()),
      by: String(raw.by || "").trim(),
    };
  }

  function mergeStaffNotes() {
    var out = [];
    var seen = Object.create(null);
    Array.prototype.forEach.call(arguments, function (list) {
      (list || []).forEach(function (raw) {
        var n = normalizeStaffNote(raw);
        if (!n || seen[n.id]) return;
        seen[n.id] = true;
        out.push(n);
      });
    });
    out.sort(function (a, b) {
      return String(a.on).localeCompare(String(b.on)) || String(a.id).localeCompare(String(b.id));
    });
    return out;
  }

  function staffNotesOf(a) {
    return mergeStaffNotes((a && a.staffNotes) || [], api.draftStaffNotes || []);
  }

  function appendStaffNote(a, kind, text, by) {
    var entry = normalizeStaffNote({
      kind: kind,
      text: text,
      by: by == null ? currentAuthor() : by,
      on: today(),
      id: newStaffNoteId(),
    });
    if (!entry) return null;
    if (a && a.id && findApplicant(a.id)) {
      a.staffNotes = mergeStaffNotes(a.staffNotes, [entry]);
    } else {
      api.draftStaffNotes = mergeStaffNotes(api.draftStaffNotes, [entry]);
    }
    return entry;
  }

  function staffNoteEntriesHtml(list) {
    if (!list || !list.length) {
      return '<div class="lbl" id="hr-recruit-staff-log-empty" style="padding:4px 0">No background-check comments or observations yet.</div>';
    }
    return (
      '<div class="chklist" id="hr-recruit-staff-log">' +
      list
        .map(function (n) {
          return (
            '<div class="chk"><span class="idx">' +
            esc(n.on) +
            '</span><span class="n"><b>' +
            esc(staffNoteKindLabel(n.kind)) +
            "</b>" +
            (n.by ? '<span class="lbl">by ' + esc(n.by) + "</span>" : "") +
            "<span>" +
            esc(n.text) +
            "</span></span></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function staffNotesHtml(a) {
    var list = staffNotesOf(a || {});
    var by = currentAuthor();
    var kinds = STAFF_NOTE_KINDS.map(function (k) {
      return '<option value="' + esc(k.key) + '">' + esc(k.label) + "</option>";
    }).join("");
    return (
      '<div class="stack" id="hr-recruit-staff-notes" data-hr-staff-notes="1">' +
      '<div class="sect-h" style="margin:10px 0 0"><h2 style="font-size:12.5px">Background check and observations</h2><span class="rule"></span></div>' +
      '<div class="note">A dated log — add a background-check comment or an observation. Earlier entries stay; this does not overwrite Internal notes.</div>' +
      staffNoteEntriesHtml(list) +
      '<div class="grid2">' +
      '<div class="f"><label>Kind</label><select id="hr-recruit-staff-kind">' +
      kinds +
      "</select></div>" +
      '<div class="f"><label>Recorded by</label><input id="hr-recruit-staff-by" value="' +
      esc(by) +
      '" placeholder="Your name"></div></div>' +
      '<div class="f"><label>New entry</label><textarea id="hr-recruit-staff-text" style="min-height:72px" placeholder="What you found, or what you observed."></textarea></div>' +
      '<div class="row"><button type="button" class="btn" id="hr-recruit-staff-add">Add to log</button>' +
      '<span class="lbl" id="hr-recruit-staff-status"></span></div></div>'
    );
  }

  function refreshStaffNotesPanel(a) {
    var panel = document.getElementById("hr-recruit-staff-notes");
    if (!panel) return;
    var list = staffNotesOf(a || applicantFromEditor() || {});
    var slot = document.getElementById("hr-recruit-staff-log") || document.getElementById("hr-recruit-staff-log-empty");
    if (slot) slot.outerHTML = staffNoteEntriesHtml(list);
  }

  async function addStaffNoteFromForm() {
    var textEl = $("#hr-recruit-staff-text");
    var kindEl = $("#hr-recruit-staff-kind");
    var byEl = $("#hr-recruit-staff-by");
    var st = $("#hr-recruit-staff-status");
    var text = textEl ? String(textEl.value || "").trim() : "";
    if (!text) {
      if (st) st.textContent = "Write the comment first.";
      return null;
    }
    var a = applicantFromEditor();
    var entry = appendStaffNote(a, kindEl ? kindEl.value : "background", text, byEl ? byEl.value : "");
    if (!entry) {
      if (st) st.textContent = "Could not add that note.";
      return null;
    }
    if (a && a.id && findApplicant(a.id)) {
      await persistApplicant(a);
    }
    if (textEl) textEl.value = "";
    refreshStaffNotesPanel(a);
    if (st) st.textContent = "Added " + entry.on + ".";
    toast("Note added to the applicant log.", "ok");
    return entry;
  }

  function bindStaffNotes() {
    var add = $("#hr-recruit-staff-add");
    if (!add || add.getAttribute("data-bound") === "1") return;
    add.setAttribute("data-bound", "1");
    add.onclick = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      addStaffNoteFromForm();
    };
  }

  function injectStaffNotesPanel() {
    if (typeof document === "undefined") return null;
    if (document.getElementById("hr-recruit-staff-notes")) {
      bindStaffNotes();
      return document.getElementById("hr-recruit-staff-notes");
    }
    var notes = document.getElementById("a-notes");
    if (!notes) return null;
    var host = notes.closest ? notes.closest(".f") : notes.parentNode;
    var panel = document.createElement("div");
    panel.innerHTML = staffNotesHtml(applicantFromEditor() || {});
    var node = panel.firstChild;
    if (!node) return null;
    if (host && host.parentNode) host.parentNode.insertBefore(node, host.nextSibling);
    else if (notes.parentNode) notes.parentNode.appendChild(node);
    bindStaffNotes();
    return document.getElementById("hr-recruit-staff-notes");
  }

  function wrapOpenModal() {
    if (typeof root.openModal !== "function" || root.openModal.__hrRecruitFile) return;
    var orig = root.openModal;
    root.openModal = function (opts) {
      if (opts && isApplicantEditorModal(opts)) {
        var next = {};
        var k;
        for (k in opts) {
          if (Object.prototype.hasOwnProperty.call(opts, k)) next[k] = opts[k];
        }
        next.foot = decorateApplicantFoot(next.foot, applicantFromEditor());
        opts = next;
      }
      var out = orig.call(this, opts);
      try {
        bindApplicantFileButton();
        if (opts && isApplicantEditorModal(opts)) {
          injectStaffNotesPanel();
          injectSchedulePanel();
          injectReapplicantEditorNote();
        }
      } catch (e) {}
      return out;
    };
    root.openModal.__hrRecruitFile = true;
  }

  function wrapAppEditor() {
    if (typeof root.appEditor !== "function" || root.appEditor.__hrRecruitFile) return;
    var orig = root.appEditor;
    root.appEditor = function (id) {
      api.openAppId = id && typeof id === "object" ? id.id : id || "";
      return orig.apply(this, arguments);
    };
    root.appEditor.__hrRecruitFile = true;
  }

  function carryApplicantDocs(emp) {
    if (!emp || !emp.applicantId) return emp;
    var a = findApplicant(emp.applicantId);
    if (!a) return emp;
    var d = dedupe();
    var seeded = typeof d.seedApplicantDocs === "function" ? d.seedApplicantDocs(a) : a.docs;
    if (typeof d.mergeDocs === "function") {
      emp.docs = d.mergeDocs([emp.docs || {}, seeded || {}]);
    } else if (seeded && !emp.docs) {
      emp.docs = seeded;
    }
    if (a.resumeLink && !(emp.linkedDocs || []).some(function (x) {
      return x && x.url === a.resumeLink;
    })) {
      emp.linkedDocs = (emp.linkedDocs || []).concat([
        {
          title: "CV / application documents",
          url: a.resumeLink,
          added: today(),
          note: "carried over from the application file",
        },
      ]);
    }
    (a.linkedDocs || []).forEach(function (x) {
      if (!x || !x.url) return;
      emp.linkedDocs = emp.linkedDocs || [];
      if (emp.linkedDocs.some(function (y) { return y && y.url === x.url; })) return;
      emp.linkedDocs.push(x);
    });
    return emp;
  }

  function wrapPut() {
    if (typeof root.put !== "function" || root.put.__hrRecruitDocs) return;
    var orig = root.put;
    root.put = function (coll, id, obj) {
      if (coll === "employees" && obj && obj.applicantId) {
        try {
          carryApplicantDocs(obj);
        } catch (e) {}
      }
      if (coll === "applicants" && obj) {
        try {
          var S = store();
          var cur = S && S.applicants ? S.applicants[id] : null;
          obj.staffNotes = mergeStaffNotes(
            cur && cur.staffNotes,
            obj.staffNotes,
            api.draftStaffNotes
          );
          if (api.draftStaffNotes && api.draftStaffNotes.length) api.draftStaffNotes = [];
          if (Array.isArray(obj.exams)) {
            obj.exams = mergeExamScores(obj.exams, api.draftExamScores);
          } else if (cur && Array.isArray(cur.exams)) {
            obj.exams = mergeExamScores(cur.exams, api.draftExamScores);
          } else {
            obj.exams = mergeExamScores(api.draftExamScores);
          }
          if (api.draftExamScores && api.draftExamScores.length) api.draftExamScores = [];
          var mergedIv = mergeInitialInterview(cur && cur.initialInterview, obj.initialInterview);
          if (mergedIv) obj.initialInterview = mergedIv;
        } catch (e) {}
      }
      return orig.apply(this, arguments);
    };
    root.put.__hrRecruitDocs = true;
  }

  var INITIAL_STATUSES = ["Scheduled", "Done/Passed", "No-show", "Rescheduled", "Failed"];
  var PAGE_FIELDS = { at: "hr-iv-at", by: "hr-iv-by", notes: "hr-iv-notes", status: "hr-iv-status" };
  var EDIT_FIELDS = { at: "hr-iv-edit-at", by: "hr-iv-edit-by", notes: "hr-iv-edit-notes", status: "hr-iv-edit-status" };
  var MODAL_FIELDS = { at: "hr-iv-modal-at", by: "hr-iv-modal-by", notes: "hr-iv-modal-notes", status: "hr-iv-modal-status" };
  var WHEN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function canonicalStage(stage) {
    var s = String(stage == null ? "" : stage).trim();
    if (!s) return "Applied";
    if (s === "For Final Interview") return "Final Interview";
    return s;
  }

  function stageText(stage) {
    var s = canonicalStage(stage);
    if (s === "Final Interview") return "For Final Interview";
    return s;
  }

  function normalizeWhen(value) {
    var raw = String(value == null ? "" : value).trim();
    var m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return "";
    var hh = Number(m[2]);
    var mm = Number(m[3]);
    if (hh > 23 || mm > 59) return "";
    return m[1] + "T" + m[2] + ":" + m[3];
  }

  function normalizeStatus(status) {
    var s = String(status == null ? "" : status).trim().toLowerCase();
    var i;
    for (i = 0; i < INITIAL_STATUSES.length; i += 1) {
      if (INITIAL_STATUSES[i].toLowerCase() === s) return INITIAL_STATUSES[i];
    }
    return "Scheduled";
  }

  function normalizeInitialInterview(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var at = normalizeWhen(raw.at || raw.when || "");
    if (!at && raw.date) at = normalizeWhen(String(raw.date) + "T" + (raw.time || "00:00"));
    if (!at) return null;
    return {
      at: at,
      interviewer: String(raw.interviewer || "").trim(),
      notes: String(raw.notes || "").trim(),
      status: normalizeStatus(raw.status),
      updatedAt: String(raw.updatedAt || "").trim(),
    };
  }

  function mergeInitialInterview(current, incoming) {
    var a = normalizeInitialInterview(current);
    var b = normalizeInitialInterview(incoming);
    if (!a) return b;
    if (!b) return a;
    var as = String((current && current.updatedAt) || "");
    var bs = String((incoming && incoming.updatedAt) || "");
    if (bs > as) return b;
    if (bs < as) return a;
    return b;
  }

  function stageAfterSchedule(stage) {
    var raw = String(stage == null ? "" : stage).trim();
    var s = canonicalStage(raw);
    if (
      !raw ||
      s === "Applied" ||
      s === "Screening" ||
      s === "Shortlisted" ||
      s === "On Hold" ||
      s === "Written Exam"
    ) {
      return "Interview";
    }
    return raw;
  }

  function stampNow() {
    return new Date().toISOString();
  }

  function scheduleInitialInterview(applicant, fields) {
    if (!applicant || typeof applicant !== "object") return null;
    var iv = normalizeInitialInterview(fields || {});
    if (!iv) return null;
    iv.updatedAt = stampNow();
    applicant.initialInterview = iv;
    applicant.stage = stageAfterSchedule(applicant.stage);
    return applicant;
  }

  function setInitialInterviewStatus(applicant, status) {
    if (!applicant) return null;
    var iv = normalizeInitialInterview(applicant.initialInterview);
    if (!iv) return null;
    iv.status = normalizeStatus(status);
    iv.updatedAt = stampNow();
    applicant.initialInterview = iv;
    return applicant;
  }

  function formatWhen(at) {
    var m = String(at || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return "—";
    var hh = Number(m[4]);
    var ap = hh >= 12 ? "PM" : "AM";
    var h12 = hh % 12 || 12;
    var mon = WHEN_MONTHS[Number(m[2]) - 1] || m[2];
    return Number(m[3]) + " " + mon + " " + m[1] + ", " + h12 + ":" + m[5] + " " + ap;
  }

  function statusPillClass(status) {
    if (status === "Done/Passed") return "ok";
    if (status === "Failed") return "crit";
    if (status === "No-show" || status === "Rescheduled") return "warn";
    return "acc";
  }

  function statusOptions(selected) {
    var current = normalizeStatus(selected);
    return INITIAL_STATUSES.map(function (s) {
      return '<option value="' + esc(s) + '"' + (s === current ? " selected" : "") + ">" + esc(s) + "</option>";
    }).join("");
  }

  function defaultInterviewer() {
    var S = store() || {};
    var settings = S.settings || {};
    return String(settings.hrHead || settings.hrStaff || "").trim();
  }

  function groupApplicantsByPosition(list, roles) {
    roles = roles || rolesMap();
    var map = Object.create(null);
    var order = [];
    (list || []).forEach(function (a) {
      if (!a) return;
      var key = roleFilterKey(a, roles);
      var label = displayRoleTitle(a, roles) || "Unlinked";
      if (!map[key]) {
        map[key] = { key: key, label: label, rows: [] };
        order.push(map[key]);
      }
      map[key].rows.push(a);
    });
    order.sort(function (a, b) {
      if (a.key === "unlinked") return 1;
      if (b.key === "unlinked") return -1;
      return a.label.localeCompare(b.label);
    });
    order.forEach(function (g) {
      g.rows.sort(function (a, b) {
        return String(a.name || "").localeCompare(String(b.name || "")) || String(a.id || "").localeCompare(String(b.id || ""));
      });
    });
    return order;
  }

  function scheduledInterviewGroups(list, roles) {
    roles = roles || rolesMap();
    var scheduled = (list || []).filter(function (a) {
      return !!normalizeInitialInterview(a && a.initialInterview);
    });
    var groups = groupApplicantsByPosition(scheduled, roles);
    groups.forEach(function (g) {
      g.rows.sort(function (a, b) {
        var av = normalizeInitialInterview(a.initialInterview);
        var bv = normalizeInitialInterview(b.initialInterview);
        return (
          String(av.at).localeCompare(String(bv.at)) ||
          String(a.name || "").localeCompare(String(b.name || ""))
        );
      });
    });
    return groups;
  }

  function foldText(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function nameTokens(s) {
    return foldText(s).split(" ").filter(function (t) {
      return t.length >= 2;
    });
  }

  function editDistance(a, b) {
    if (a === b) return 0;
    var la = a.length;
    var lb = b.length;
    if (Math.abs(la - lb) > 2) return 3;
    var prev = [];
    var i;
    var j;
    for (j = 0; j <= lb; j += 1) prev[j] = j;
    for (i = 1; i <= la; i += 1) {
      var cur = [i];
      var rowMin = i;
      for (j = 1; j <= lb; j += 1) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > 2) return 3;
      prev = cur;
    }
    return prev[lb];
  }

  function tokenClose(a, b) {
    if (a === b) return true;
    if (a.length < 5 || b.length < 5) return false;
    return editDistance(a, b) <= 1;
  }

  function applicantFuzzyMatch(a, query, roles) {
    if (applicantMatchesSearch(a, query, roles)) return true;
    var qTokens = nameTokens(query);
    if (!qTokens.length) return false;
    var hay = [a && a.name, a && a.position, displayRoleTitle(a, roles)].filter(Boolean).join(" ");
    return qTokens.every(function (qt) {
      return nameTokens(hay).some(function (ht) {
        return tokenClose(qt, ht);
      });
    });
  }

  function nameTokenKey(s) {
    return nameTokens(s).slice().sort().join(" ");
  }

  function exactNameMatches(name) {
    var want = nameTokenKey(name);
    if (!want) return [];
    return applicantList().filter(function (a) {
      return nameTokenKey(a && a.name) === want;
    });
  }

  function isClosedStage(a) {
    var s = canonicalStage(a && a.stage);
    return s === "Hired" || s === "Rejected";
  }

  function applicantsForSchedule(query) {
    var q = String(query == null ? "" : query).trim();
    var roles = rolesMap();
    var all = applicantList();
    if (!q) return schedulableApplicants();
    var open = all.filter(function (a) {
      return !isClosedStage(a);
    });
    var hit = open.filter(function (a) {
      return applicantMatchesSearch(a, q, roles);
    });
    if (hit.length) return hit;
    hit = open.filter(function (a) {
      return applicantFuzzyMatch(a, q, roles);
    });
    if (hit.length) return hit;
    return all.filter(function (a) {
      return isClosedStage(a) && (applicantMatchesSearch(a, q, roles) || applicantFuzzyMatch(a, q, roles));
    });
  }

  function newApplicantId() {
    if (typeof root.uid === "function") return root.uid("a");
    return "a_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function roleForPosition(position) {
    var want = String(position || "").trim().toLowerCase();
    if (!want) return null;
    var roles = rolesMap();
    var id;
    for (id in roles) {
      if (!Object.prototype.hasOwnProperty.call(roles, id)) continue;
      var role = roles[id];
      var title = String((role && role.title) || "").trim().toLowerCase();
      if (title && title === want) return { id: id, role: role };
    }
    return null;
  }

  function manualApplicant(fields) {
    fields = fields || {};
    var position = String(fields.position || "").trim();
    var linked = roleForPosition(position);
    var S = store() || {};
    var settings = S.settings || {};
    return {
      id: newApplicantId(),
      name: String(fields.name || "").trim(),
      roleId: linked ? linked.id : "",
      position: position,
      dept: (linked && linked.role && linked.role.dept) || "Technical",
      source: "Walk-in",
      appliedOn: today(),
      stage: "Applied",
      mobile: String(fields.mobile || "").trim(),
      email: String(fields.email || "").trim(),
      resumeLink: "",
      expected: "",
      notes: "Added when the initial interview was scheduled.",
      exams: [],
      interviews: [],
      aiSummary: "",
      aiVerdict: "",
      aiOn: "",
      education: "",
      years: "",
      history: [],
      background: [],
      rffiNote: "",
      hrVerdict: "",
      hrRating: "3",
      hrNotes: "",
      hrBy: String(settings.hrHead || ""),
      hrOn: "",
      hiredEmpId: "",
    };
  }

  async function commitManualInterview(fields, interview) {
    fields = fields || {};
    var name = String(fields.name || "").trim();
    if (!name) return { ok: false, error: "name" };
    var exact = exactNameMatches(name);
    if (exact.length > 1) return { ok: false, error: "several" };
    if (exact.length === 1) {
      var existing = await commitInitialInterview(exact[0].id, interview || {});
      if (existing.ok) existing.created = false;
      return existing;
    }
    var created = manualApplicant(fields);
    if (!scheduleInitialInterview(created, interview || {})) return { ok: false, error: "when" };
    await persistApplicant(created);
    return { ok: true, created: true, applicant: created };
  }

  function resolveInterviewTarget(selectedId, manualName, findText) {
    var selected = String(selectedId || "").trim();
    if (selected && findApplicant(selected)) return { ok: true, id: selected, create: false };
    var typed = String(manualName || "").trim();
    var find = String(findText || "").trim();
    if (typed) {
      var exactTyped = exactNameMatches(typed);
      if (exactTyped.length === 1) return { ok: true, id: exactTyped[0].id, create: false };
      if (exactTyped.length > 1) return { ok: false, error: "several" };
      return { ok: true, create: true, name: typed };
    }
    if (find) {
      var exactFind = exactNameMatches(find);
      if (exactFind.length === 1) return { ok: true, id: exactFind[0].id, create: false };
      if (exactFind.length > 1) return { ok: false, error: "several" };
      if (applicantsForSchedule(find).length) return { ok: false, error: "close" };
      return { ok: true, create: true, name: find };
    }
    return { ok: false, error: "missing" };
  }

  function applicantOptionsHtml(list, selectedId, roles, query) {
    roles = roles || rolesMap();
    var filtered = (list || []).filter(function (a) {
      return applicantMatchesSearch(a, query, roles);
    });
    var html = '<option value="">— choose an applicant —</option>';
    var seen = Object.create(null);
    groupApplicantsByPosition(filtered, roles).forEach(function (g) {
      html += '<optgroup label="' + esc(g.label) + '">';
      g.rows.forEach(function (a) {
        seen[a.id] = true;
        var iv = normalizeInitialInterview(a.initialInterview);
        var suffix = iv ? " · " + formatWhen(iv.at) : "";
        html +=
          '<option value="' +
          esc(a.id) +
          '"' +
          (a.id === selectedId ? " selected" : "") +
          ">" +
          esc(a.name || "(no name)") +
          esc(suffix) +
          "</option>";
      });
      html += "</optgroup>";
    });
    if (selectedId && !seen[selectedId]) {
      var cur = findApplicant(selectedId);
      if (cur) {
        html +=
          '<option value="' +
          esc(cur.id) +
          '" selected>' +
          esc(cur.name || "(no name)") +
          "</option>";
      }
    }
    return html;
  }

  function scheduleFieldsHtml(iv, ids) {
    iv = iv || {};
    ids = ids || PAGE_FIELDS;
    var status = iv.status || "Scheduled";
    return (
      '<div class="f"><label>Date and time</label><input id="' +
      ids.at +
      '" type="datetime-local" value="' +
      esc(iv.at || "") +
      '"></div>' +
      '<div class="f"><label>Interviewer</label><input id="' +
      ids.by +
      '" value="' +
      esc(iv.interviewer || "") +
      '" placeholder="Optional"></div>' +
      '<div class="f"><label>Status</label><select id="' +
      ids.status +
      '">' +
      statusOptions(status) +
      "</select></div>" +
      '<div class="f"><label>Notes</label><input id="' +
      ids.notes +
      '" value="' +
      esc(iv.notes || "") +
      '" placeholder="Optional"></div>'
    );
  }

  function schedulableApplicants() {
    return applicantList().filter(function (a) {
      return canonicalStage(a.stage) !== "Hired";
    });
  }

  function isIsoDate(value) {
    var m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    var t = new Date(y, mo - 1, d);
    return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d;
  }

  function manilaToday(now) {
    var clock = now || root.__hrNow || new Date();
    if (!(clock instanceof Date)) {
      var parsed = new Date(clock);
      clock = isNaN(parsed.getTime()) ? new Date() : parsed;
    }
    try {
      var fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      var parts = {};
      fmt.formatToParts(clock).forEach(function (p) {
        if (p.type !== "literal") parts[p.type] = p.value;
      });
      if (parts.year && parts.month && parts.day) return parts.year + "-" + parts.month + "-" + parts.day;
    } catch (e) {}
    return (
      clock.getFullYear() +
      "-" +
      String(clock.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(clock.getDate()).padStart(2, "0")
    );
  }

  function shiftIsoDate(iso, days) {
    var base = isIsoDate(iso) ? String(iso) : manilaToday();
    var p = base.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var t = new Date(Number(p[1]), Number(p[2]) - 1, Number(p[3]));
    t.setDate(t.getDate() + (Number(days) || 0));
    return (
      t.getFullYear() +
      "-" +
      String(t.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(t.getDate()).padStart(2, "0")
    );
  }

  function formatDayLabel(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "";
    var mon = WHEN_MONTHS[Number(m[2]) - 1] || m[2];
    return Number(m[3]) + " " + mon + " " + m[1];
  }

  function interviewDay(applicant) {
    var iv = normalizeInitialInterview(applicant && applicant.initialInterview);
    if (!iv) return "";
    return String(iv.at).slice(0, 10);
  }

  function readStoredDay(key) {
    var S = store();
    if (S && S.ui && Object.prototype.hasOwnProperty.call(S.ui, key)) return String(S.ui[key] == null ? "" : S.ui[key]);
    if (api[key] != null && api[key] !== "") return String(api[key]);
    return "";
  }

  function writeStoredDay(key, stored) {
    api[key] = stored;
    var S = store();
    if (!S) return;
    S.ui = S.ui || {};
    if (stored === "") delete S.ui[key];
    else S.ui[key] = stored;
  }

  function interpretDay(stored) {
    stored = String(stored == null ? "" : stored);
    if (stored === "all" || stored === "none") return stored;
    if (isIsoDate(stored)) return stored;
    return manilaToday();
  }

  function normalizeDayInput(raw) {
    raw = raw == null ? "" : String(raw).trim();
    if (raw === "" || raw === "default") return "";
    if (raw === "today") return manilaToday();
    if (raw === "all" || raw === "none") return raw;
    if (isIsoDate(raw)) return raw;
    return null;
  }

  function currentInterviewDay() {
    return interpretDay(readStoredDay("interviewDay"));
  }

  function currentPipelineScheduleDay() {
    return interpretDay(readStoredDay("pipelineScheduleDay"));
  }

  function pipelineInterviewLimitOn() {
    var S = store();
    if (S && S.ui && S.ui.pipelineInterviewLimit != null) return !!S.ui.pipelineInterviewLimit;
    return !!api.pipelineInterviewLimit;
  }

  function setInterviewDay(day) {
    var next = normalizeDayInput(day);
    if (next == null) return currentInterviewDay();
    writeStoredDay("interviewDay", next);
    paintInterviewSchedule();
    return currentInterviewDay();
  }

  function setPipelineScheduleDay(day) {
    var next = normalizeDayInput(day);
    if (next == null) return currentPipelineScheduleDay();
    writeStoredDay("pipelineScheduleDay", next);
    paintPipelineSchedule();
    return currentPipelineScheduleDay();
  }

  function setPipelineInterviewLimit(on) {
    var next = !!on;
    api.pipelineInterviewLimit = next;
    var S = store();
    if (S) {
      S.ui = S.ui || {};
      S.ui.pipelineInterviewLimit = next;
    }
    paintPipelineSchedule();
    return next;
  }

  function stepInterviewDay(delta) {
    var cur = currentInterviewDay();
    var base = isIsoDate(cur) ? cur : manilaToday();
    return setInterviewDay(shiftIsoDate(base, delta));
  }

  function stepPipelineScheduleDay(delta) {
    var cur = currentPipelineScheduleDay();
    var base = isIsoDate(cur) ? cur : manilaToday();
    return setPipelineScheduleDay(shiftIsoDate(base, delta));
  }

  function applicantMatchesInterviewView(a, mode) {
    mode = interpretDay(mode);
    var day = interviewDay(a);
    if (mode === "all") return !!day;
    if (mode === "none") {
      if (day) return false;
      var stage = canonicalStage(a && a.stage);
      return stage !== "Hired" && stage !== "Rejected";
    }
    return day === mode;
  }

  function applicantsForInterviewView(mode) {
    return applicantList().filter(function (a) {
      return applicantMatchesInterviewView(a, mode);
    });
  }

  function scheduledDays(list) {
    var seen = Object.create(null);
    var days = [];
    (list || applicantList()).forEach(function (a) {
      var day = interviewDay(a);
      if (!day || seen[day]) return;
      seen[day] = true;
      days.push(day);
    });
    days.sort();
    return days;
  }

  function dayButtonHtml(id, label, on, attr) {
    var style = on ? ' style="font-weight:600;box-shadow:inset 0 0 0 2px var(--brass)"' : "";
    return (
      '<button type="button" class="btn sm' +
      (on ? " on" : "") +
      '"' +
      (id ? ' id="' + id + '"' : "") +
      style +
      (attr || "") +
      ">" +
      esc(label) +
      "</button>"
    );
  }

  function dayChipsHtml(days, mode, attrName) {
    var focus = isIsoDate(mode) ? mode : manilaToday();
    var shown = days || [];
    if (shown.length > 16) {
      var idx = shown.indexOf(focus);
      if (idx < 0) {
        idx = 0;
        shown.forEach(function (d, i) {
          if (d <= focus) idx = i;
        });
      }
      var start = Math.max(0, idx - 7);
      var end = Math.min(shown.length, start + 15);
      start = Math.max(0, end - 15);
      shown = shown.slice(start, end);
    }
    return shown
      .map(function (d) {
        return dayButtonHtml("", formatDayLabel(d), mode === d, " " + attrName + '="' + esc(d) + '"');
      })
      .join("");
  }

  function interviewDayCountText(mode) {
    var count = applicantsForInterviewView(mode).length;
    if (mode === "all") return count + " on the schedule";
    if (mode === "none") return count + " not scheduled";
    return count + " on " + formatDayLabel(mode);
  }

  function interviewDayControlsHtml(prefix, mode, pickAttr) {
    var today = manilaToday();
    var dateValue = isIsoDate(mode) ? mode : "";
    var days = scheduledDays();
    var inputId = prefix === "hr-pipe-iv" ? "hr-pipe-iv-day" : "hr-iv-day";
    var html =
      '<div class="row" style="flex-wrap:wrap;gap:6px;align-items:flex-end">' +
      '<div class="f" style="margin:0"><label for="' +
      inputId +
      '">Interview date</label>' +
      '<input type="date" id="' +
      inputId +
      '" aria-label="Show interviews on this date" value="' +
      esc(dateValue) +
      '"></div>' +
      dayButtonHtml(prefix + "-prev", "‹", false, ' aria-label="Previous day"') +
      dayButtonHtml(prefix + "-next", "›", false, ' aria-label="Next day"') +
      dayButtonHtml(prefix + "-today", "Today", mode === today) +
      dayButtonHtml(prefix + "-all", "All dates", mode === "all") +
      dayButtonHtml(prefix + "-none", "Unscheduled", mode === "none") +
      '<span class="lbl" id="' +
      prefix +
      '-count">' +
      esc(interviewDayCountText(mode)) +
      "</span></div>";
    if (days.length) {
      html +=
        '<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px">' +
        dayChipsHtml(days, mode, pickAttr) +
        "</div>";
    }
    return html;
  }

  function interviewDayBarInnerHtml() {
    return interviewDayControlsHtml("hr-iv-day", currentInterviewDay(), "data-hr-iv-pick");
  }

  function interviewTableHtml(groups, mode) {
    if (!groups.length) {
      if (mode === "none") {
        return '<div class="card"><div class="empty">Everyone still in play already has an initial interview. Choose All dates to see the schedule.</div></div>';
      }
      if (mode === "all") {
        return '<div class="card"><div class="empty">No initial interviews scheduled yet. Pick an applicant above, or type a name, and set the date and time.</div></div>';
      }
      return (
        '<div class="card"><div class="empty">No one is scheduled on ' +
        esc(formatDayLabel(mode)) +
        ". Pick another date, or choose All dates.</div></div>"
      );
    }
    var h = "";
    groups.forEach(function (g) {
      h +=
        '<div class="sect-h" style="margin:16px 0 9px"><h2 style="font-size:13px">' +
        esc(g.label) +
        '</h2><span class="rule"></span><span class="pill acc">' +
        g.rows.length +
        "</span></div>" +
        '<div class="card"><div class="tw"><table><thead><tr><th>Applicant</th><th>' +
        (mode === "none" ? "Stage" : "Scheduled") +
        "</th>" +
        (mode === "none" ? "" : "<th>Interviewer</th><th>Status</th><th>Stage</th>") +
        "<th></th></tr></thead><tbody>";
      g.rows.forEach(function (a) {
        var iv = normalizeInitialInterview(a.initialInterview);
        var day = iv ? String(iv.at).slice(0, 10) : "";
        if (mode === "none" || !iv) {
          h +=
            '<tr data-hr-iv-day=""><td class="nm">' +
            esc(a.name || "(no name)") +
            reapplicantBadgeHtml(a) +
            "</td><td>" +
            esc(stageText(a.stage)) +
            '</td><td><button class="btn sm" type="button" data-open-app="' +
            esc(a.id) +
            '">Open</button></td></tr>';
          return;
        }
        h +=
          '<tr data-hr-iv-day="' +
          esc(day) +
          '"><td class="nm">' +
          esc(a.name || "(no name)") +
          reapplicantBadgeHtml(a) +
          (iv.notes
            ? '<div style="font-size:11px;color:var(--ink3);font-weight:400">' + esc(iv.notes) + "</div>"
            : "") +
          '</td><td class="mono">' +
          esc(formatWhen(iv.at)) +
          "</td><td>" +
          esc(iv.interviewer || "—") +
          '</td><td><span class="pill ' +
          statusPillClass(iv.status) +
          '">' +
          esc(iv.status) +
          '</span> <select data-hr-iv-status="' +
          esc(a.id) +
          '" aria-label="Status for ' +
          esc(a.name || "applicant") +
          '">' +
          statusOptions(iv.status) +
          "</select></td><td>" +
          esc(stageText(a.stage)) +
          '</td><td><button class="btn sm" type="button" data-open-app="' +
          esc(a.id) +
          '">Open</button></td></tr>';
      });
      h += "</tbody></table></div></div>";
    });
    return h;
  }

  function interviewScheduleListHtml(mode) {
    var roles = rolesMap();
    var people = applicantsForInterviewView(mode);
    var groups =
      mode === "none" ? groupApplicantsByPosition(people, roles) : scheduledInterviewGroups(people, roles);
    return interviewTableHtml(groups, mode);
  }

  function paintInterviewSchedule() {
    if (typeof document === "undefined" || !document.getElementById) return;
    var bar = document.getElementById("hr-iv-day-bar");
    var list = document.getElementById("hr-iv-day-list");
    if (bar) bar.innerHTML = interviewDayBarInnerHtml();
    if (list) list.innerHTML = interviewScheduleListHtml(currentInterviewDay());
  }

  function pipelineScheduleCardHtml() {
    var mode = currentPipelineScheduleDay();
    var limitOn = pipelineInterviewLimitOn();
    return (
      '<div class="card" style="margin:12px 0"><div class="card-h"><h3>Initial interviews</h3></div><div class="card-b">' +
      '<div class="note">Philippines time. This list opens on today. Pick a date, or a day that already has someone scheduled. All dates shows every scheduled interview. Unscheduled shows applicants still in play who have no initial interview yet. The pipeline below stays the full list unless you limit it.</div>' +
      '<div id="hr-pipe-iv-bar">' +
      interviewDayControlsHtml("hr-pipe-iv", mode, "data-hr-pipe-pick") +
      "</div>" +
      '<div class="row" style="margin-top:8px">' +
      dayButtonHtml(
        "hr-pipe-iv-limit",
        limitOn ? "Show everyone in the pipeline" : "Limit the pipeline to this view",
        limitOn
      ) +
      "</div>" +
      '<div id="hr-pipe-iv-list">' +
      interviewScheduleListHtml(mode) +
      "</div></div></div>"
    );
  }

  function paintPipelineSchedule() {
    if (typeof document === "undefined" || !document.getElementById) return;
    var host = document.getElementById("hr-pipeline-iv-day");
    if (host) host.innerHTML = pipelineScheduleCardHtml();
    if (document.getElementById("new-app")) applyPipelineFilters(document);
    try {
      injectScheduleButtons();
    } catch (e) {}
  }

  function injectPipelineSchedule() {
    if (typeof document === "undefined" || !document.getElementById || !document.createElement) return null;
    var log = document.getElementById("new-app");
    var existing = document.getElementById("hr-pipeline-iv-day");
    if (!log || !log.parentNode) {
      if (existing && existing.parentNode && existing.parentNode.removeChild) existing.parentNode.removeChild(existing);
      return null;
    }
    if (!existing) {
      existing = document.createElement("div");
      existing.setAttribute("id", "hr-pipeline-iv-day");
      var sect = log.parentNode;
      if (sect.parentNode && sect.parentNode.insertBefore) sect.parentNode.insertBefore(existing, sect.nextSibling || null);
      else if (sect.appendChild) sect.appendChild(existing);
    }
    existing.innerHTML = pipelineScheduleCardHtml();
    return existing;
  }

  function initialInterviewsHtml() {
    clearReappMap();
    var roles = rolesMap();
    var scheduledTotal = applicantList().filter(function (a) {
      return !!normalizeInitialInterview(a && a.initialInterview);
    }).length;
    var h =
      '<div id="hr-initial-interviews">' +
      '<div class="note">Philippines time. The list opens on today. Pick a date, the day before or after, or a day that already has someone scheduled. All dates shows every scheduled interview. Unscheduled shows applicants still in play who have no initial interview yet.</div>' +
      '<div class="sect-h"><h2>Who is scheduled</h2><span class="rule"></span>' +
      '<span class="lbl">' +
      scheduledTotal +
      " on the schedule</span></div>" +
      '<div id="hr-iv-day-bar">' +
      interviewDayBarInnerHtml() +
      "</div>" +
      '<div id="hr-iv-day-list">' +
      interviewScheduleListHtml(currentInterviewDay()) +
      "</div>" +
      '<div class="sect-h" style="margin-top:16px"><h2>Schedule an initial interview</h2><span class="rule"></span></div>' +
      '<div class="note">Pick someone already on the pipeline, or type a name under Add someone who is not on the pipeline. ' +
      "Saving moves Applied, Screening, Shortlisted, On Hold, and Written Exam to Interview. " +
      "Someone already at Interview, Background Check, For Final Interview, Offer, Hired, or Rejected stays on that stage. " +
      "Change the status on the list when the interview is done, missed, moved, or failed.</div>" +
      '<div class="card"><div class="card-b"><div class="stack">' +
      '<div class="f"><label>Find an applicant</label>' +
      '<input type="search" id="hr-iv-find" class="search" placeholder="Name, email, mobile, or position" aria-label="Find an applicant" autocomplete="off">' +
      '<span class="lbl" id="hr-iv-find-hint"></span></div>' +
      '<div class="grid3">' +
      '<div class="f"><label>Applicant</label><select id="hr-iv-app">' +
      applicantOptionsHtml(schedulableApplicants(), "", roles, "") +
      "</select></div>" +
      scheduleFieldsHtml({ interviewer: defaultInterviewer(), status: "Scheduled" }, PAGE_FIELDS) +
      "</div>" +
      '<div class="f" id="hr-iv-manual" style="margin-top:8px"><label>Add someone who is not on the pipeline</label>' +
      '<div class="grid3">' +
      '<div class="f"><label>Name</label><input id="hr-iv-new-name" placeholder="Full name" autocomplete="off"></div>' +
      '<div class="f"><label>Position</label><input id="hr-iv-new-pos" placeholder="Optional" autocomplete="off"></div>' +
      '<div class="f"><label>Mobile</label><input id="hr-iv-new-mob" placeholder="Optional" autocomplete="off"></div>' +
      '<div class="f"><label>Email</label><input id="hr-iv-new-email" placeholder="Optional" autocomplete="off"></div>' +
      "</div>" +
      '<span class="hint">Leave this blank to schedule someone already chosen above. A name here is added to the pipeline when you save, unless that exact name is already on file.</span></div>' +
      '<div class="row"><button class="btn pri" id="hr-iv-save" type="button">Save schedule</button>' +
      '<span class="lbl" id="hr-iv-form-status"></span></div>' +
      "</div></div></div></div>";
    return h;
  }

  function schedulePanelHtml(a) {
    a = a || {};
    var iv = normalizeInitialInterview(a.initialInterview);
    var summary = iv
      ? formatWhen(iv.at) + " · " + iv.status + (iv.interviewer ? " · " + iv.interviewer : "")
      : "Not scheduled yet.";
    var formIv = iv || { at: "", interviewer: defaultInterviewer(), notes: "", status: "Scheduled" };
    return (
      '<div id="hr-recruit-iv-panel">' +
      '<div class="sect-h" style="margin:10px 0 0"><h2 style="font-size:12.5px">Initial interview</h2><span class="rule"></span>' +
      '<span class="lbl">' +
      esc(summary) +
      "</span></div>" +
      '<div class="note">Philippines time. Saving moves Applied, Screening, Shortlisted, On Hold, and Written Exam to Interview. Later stages stay as they are.</div>' +
      '<div class="grid3">' +
      scheduleFieldsHtml(formIv, EDIT_FIELDS) +
      "</div>" +
      '<div class="row"><button class="btn pri" id="hr-iv-edit-save" type="button">Save initial interview</button>' +
      '<span class="lbl" id="hr-iv-edit-status"></span></div></div>'
    );
  }

  async function commitInitialInterview(applicantId, fields) {
    var a = findApplicant(applicantId);
    if (!a) return { ok: false, error: "missing" };
    if (!scheduleInitialInterview(a, fields || {})) return { ok: false, error: "when" };
    await persistApplicant(a);
    return { ok: true, applicant: a };
  }

  async function commitInitialStatus(applicantId, status) {
    var a = findApplicant(applicantId);
    if (!a || !normalizeInitialInterview(a.initialInterview)) return { ok: false, error: "none" };
    var next = normalizeStatus(status);
    if (normalizeInitialInterview(a.initialInterview).status === next && String(a.initialInterview.status || "") === next) {
      return { ok: true, applicant: a, unchanged: true };
    }
    if (!setInitialInterviewStatus(a, next)) return { ok: false, error: "none" };
    await persistApplicant(a);
    return { ok: true, applicant: a };
  }

  function fieldValue(id) {
    if (typeof document === "undefined" || !document.getElementById) return "";
    var el = document.getElementById(id);
    return el ? String(el.value || "") : "";
  }

  function reflectStageSelect(applicant) {
    if (!applicant || typeof document === "undefined" || !document.getElementById) return;
    if (api.openAppId && api.openAppId !== applicant.id) return;
    var sel = document.getElementById("a-stage");
    if (!sel) return;
    sel.value = canonicalStage(applicant.stage);
  }

  function formError(kind) {
    if (kind === "when") return "Set the date and time.";
    if (kind === "name") return "Type the applicant's name.";
    if (kind === "several") return "More than one applicant has that name. Choose them in the list.";
    if (kind === "close") return "Choose the applicant in the list, or type the full name under Add someone who is not on the pipeline.";
    if (kind === "missing") return "Pick an applicant, or type a name to add someone who is not on the pipeline.";
    return "Could not save that interview.";
  }

  async function savePageSchedule() {
    var st = typeof document !== "undefined" && document.getElementById("hr-iv-form-status");
    var target = resolveInterviewTarget(fieldValue("hr-iv-app"), fieldValue("hr-iv-new-name"), fieldValue("hr-iv-find"));
    if (!target.ok) {
      var early = formError(target.error);
      if (st) st.textContent = early;
      toast(early, "err");
      return;
    }
    var fields = {
      at: fieldValue("hr-iv-at"),
      interviewer: fieldValue("hr-iv-by"),
      notes: fieldValue("hr-iv-notes"),
      status: fieldValue("hr-iv-status"),
    };
    var result = target.create
      ? await commitManualInterview(
          {
            name: target.name,
            position: fieldValue("hr-iv-new-pos"),
            mobile: fieldValue("hr-iv-new-mob"),
            email: fieldValue("hr-iv-new-email"),
          },
          fields
        )
      : await commitInitialInterview(target.id, fields);
    if (!result.ok) {
      var msg = formError(result.error);
      if (st) st.textContent = msg;
      toast(msg, "err");
      return;
    }
    if (result.created) toast((result.applicant.name || "That applicant") + " is on the pipeline and the interview is saved.", "ok");
    else toast("Initial interview saved.", "ok");
    reflectStageSelect(result.applicant);
    if (typeof root.render === "function") root.render();
  }

  async function saveEditorSchedule() {
    var st = typeof document !== "undefined" && document.getElementById("hr-iv-edit-status");
    var a = applicantFromEditor();
    if (!a) {
      if (st) st.textContent = "Save the applicant first.";
      toast("Save the applicant first, then schedule the interview.", "err");
      return;
    }
    var result = await commitInitialInterview(a.id, {
      at: fieldValue("hr-iv-edit-at"),
      interviewer: fieldValue("hr-iv-edit-by"),
      notes: fieldValue("hr-iv-edit-notes"),
      status: fieldValue("hr-iv-edit-status"),
    });
    if (!result.ok) {
      var msg = formError(result.error);
      if (st) st.textContent = msg;
      toast(msg, "err");
      return;
    }
    reflectStageSelect(result.applicant);
    toast("Initial interview saved.", "ok");
    var panel = typeof document !== "undefined" && document.getElementById("hr-recruit-iv-panel");
    if (panel && panel.parentNode) {
      var holder = document.createElement("div");
      holder.innerHTML = schedulePanelHtml(result.applicant);
      if (holder.firstChild) panel.parentNode.replaceChild(holder.firstChild, panel);
    }
  }

  function openScheduleModal(appId) {
    var a = findApplicant(appId);
    if (!a) {
      toast("That applicant is not on the pipeline.", "err");
      return null;
    }
    if (typeof root.openModal !== "function") return null;
    var iv = normalizeInitialInterview(a.initialInterview) || {
      at: "",
      interviewer: defaultInterviewer(),
      notes: "",
      status: "Scheduled",
    };
    root.openModal({
      title: "Initial interview — " + (a.name || "applicant"),
      body:
        '<div id="hr-iv-modal" data-hr-iv-for="' +
        esc(a.id) +
        '"><div class="note">' +
        esc(a.name || "") +
        " · " +
        esc(displayRoleTitle(a) || "Unlinked") +
        ". Philippines time. Saving moves an early stage to Interview.</div><div class=\"grid3\">" +
        scheduleFieldsHtml(iv, MODAL_FIELDS) +
        "</div></div>",
      foot:
        '<button class="btn" id="hr-iv-modal-cancel" type="button">Cancel</button>' +
        '<button class="btn pri" id="hr-iv-modal-save" type="button">Save schedule</button>',
    });
    return a;
  }

  async function saveModalSchedule() {
    if (typeof document === "undefined" || !document.getElementById) return;
    var host = document.getElementById("hr-iv-modal");
    var id = host && host.getAttribute ? host.getAttribute("data-hr-iv-for") : "";
    var result = await commitInitialInterview(id, {
      at: fieldValue("hr-iv-modal-at"),
      interviewer: fieldValue("hr-iv-modal-by"),
      notes: fieldValue("hr-iv-modal-notes"),
      status: fieldValue("hr-iv-modal-status"),
    });
    if (!result.ok) {
      toast(formError(result.error), "err");
      return;
    }
    toast("Initial interview saved.", "ok");
    reflectStageSelect(result.applicant);
    if (typeof root.closeModal === "function") root.closeModal();
    if (typeof root.render === "function") root.render();
  }

  function setFindHint(text) {
    if (typeof document === "undefined" || !document.getElementById) return;
    var hint = document.getElementById("hr-iv-find-hint");
    if (hint) hint.textContent = text || "";
  }

  function clearAutoName() {
    if (typeof document === "undefined" || !document.getElementById) return;
    var nameBox = document.getElementById("hr-iv-new-name");
    if (nameBox && nameBox.getAttribute && nameBox.getAttribute("data-from-find") === "1") {
      nameBox.value = "";
      if (nameBox.removeAttribute) nameBox.removeAttribute("data-from-find");
    }
  }

  function filterApplicantSelect(query) {
    if (typeof document === "undefined" || !document.getElementById) return;
    var sel = document.getElementById("hr-iv-app");
    if (!sel) return;
    var trimmed = String(query == null ? "" : query).trim();
    var roles = rolesMap();
    var list = applicantsForSchedule(trimmed);
    var ids = Object.create(null);
    list.forEach(function (a) {
      ids[a.id] = true;
    });
    var keep = String(sel.value || "");
    if (keep && !ids[keep]) keep = "";
    var exact = trimmed ? exactNameMatches(trimmed) : [];
    var substring = trimmed
      ? list.filter(function (a) {
          return applicantMatchesSearch(a, trimmed, roles);
        })
      : [];
    var pick = keep;
    if (exact.length === 1) pick = exact[0].id;
    else if (substring.length === 1) pick = substring[0].id;
    else if (list.length === 1 && substring.length === 0) pick = "";
    sel.innerHTML = applicantOptionsHtml(list, pick, roles, "");
    sel.value = pick;
    if (!trimmed) {
      setFindHint("");
      return;
    }
    if (exact.length === 1 || substring.length === 1) {
      var chosen = exact.length === 1 ? exact[0] : substring[0];
      clearAutoName();
      setFindHint("Matched " + (chosen.name || "that applicant") + " on the pipeline.");
      return;
    }
    if (list.length === 1) {
      clearAutoName();
      setFindHint(
        "Closest name is " +
          (list[0].name || "someone on the pipeline") +
          ". Choose them in the list, or type a new name below."
      );
      return;
    }
    if (list.length > 1) {
      clearAutoName();
      setFindHint("Several people match. Open the list and choose one.");
      return;
    }
    var nameBox = document.getElementById("hr-iv-new-name");
    if (nameBox && nameBox.getAttribute && nameBox.getAttribute("data-from-find") !== "typed") {
      nameBox.value = trimmed;
      if (nameBox.setAttribute) nameBox.setAttribute("data-from-find", "1");
    }
    setFindHint("No one on the pipeline has that name. Save schedule will add them.");
  }

  function fillPageForm(applicantId) {
    if (typeof document === "undefined" || !document.getElementById) return;
    var a = findApplicant(applicantId);
    var iv = a && normalizeInitialInterview(a.initialInterview);
    var at = document.getElementById("hr-iv-at");
    var by = document.getElementById("hr-iv-by");
    var notes = document.getElementById("hr-iv-notes");
    var status = document.getElementById("hr-iv-status");
    if (at) at.value = iv ? iv.at : "";
    if (by) by.value = iv ? iv.interviewer : defaultInterviewer();
    if (notes) notes.value = iv ? iv.notes : "";
    if (status) status.value = iv ? iv.status : "Scheduled";
  }

  function bindInitialInterviewEvents(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc || doc.__hrInitialIv || !doc.addEventListener) return;
    doc.__hrInitialIv = true;
    doc.addEventListener(
      "click",
      function (ev) {
        var t = ev && ev.target;
        var id = "";
        var pick = "";
        var pipePick = "";
        while (t && t !== doc) {
          if (
            t.id === "hr-iv-save" ||
            t.id === "hr-iv-edit-save" ||
            t.id === "hr-iv-modal-save" ||
            t.id === "hr-iv-modal-cancel" ||
            t.id === "hr-iv-day-today" ||
            t.id === "hr-iv-day-all" ||
            t.id === "hr-iv-day-none" ||
            t.id === "hr-iv-day-prev" ||
            t.id === "hr-iv-day-next" ||
            t.id === "hr-pipe-iv-today" ||
            t.id === "hr-pipe-iv-all" ||
            t.id === "hr-pipe-iv-none" ||
            t.id === "hr-pipe-iv-prev" ||
            t.id === "hr-pipe-iv-next" ||
            t.id === "hr-pipe-iv-limit"
          ) {
            id = t.id;
            break;
          }
          if (t.getAttribute && t.getAttribute("data-hr-iv-open")) {
            id = "open";
            break;
          }
          if (t.getAttribute && t.getAttribute("data-hr-iv-pick") != null) {
            id = "pick";
            pick = t.getAttribute("data-hr-iv-pick");
            break;
          }
          if (t.getAttribute && t.getAttribute("data-hr-pipe-pick") != null) {
            id = "pipe-pick";
            pipePick = t.getAttribute("data-hr-pipe-pick");
            break;
          }
          t = t.parentNode;
        }
        if (!id) return;
        if (ev.preventDefault) ev.preventDefault();
        if (id === "hr-iv-save") savePageSchedule();
        else if (id === "hr-iv-edit-save") saveEditorSchedule();
        else if (id === "hr-iv-modal-save") saveModalSchedule();
        else if (id === "hr-iv-modal-cancel") {
          if (typeof root.closeModal === "function") root.closeModal();
        } else if (id === "hr-iv-day-today") setInterviewDay("today");
        else if (id === "hr-iv-day-all") setInterviewDay("all");
        else if (id === "hr-iv-day-none") setInterviewDay("none");
        else if (id === "hr-iv-day-prev") stepInterviewDay(-1);
        else if (id === "hr-iv-day-next") stepInterviewDay(1);
        else if (id === "pick") setInterviewDay(pick);
        else if (id === "hr-pipe-iv-today") setPipelineScheduleDay("today");
        else if (id === "hr-pipe-iv-all") setPipelineScheduleDay("all");
        else if (id === "hr-pipe-iv-none") setPipelineScheduleDay("none");
        else if (id === "hr-pipe-iv-prev") stepPipelineScheduleDay(-1);
        else if (id === "hr-pipe-iv-next") stepPipelineScheduleDay(1);
        else if (id === "pipe-pick") setPipelineScheduleDay(pipePick);
        else if (id === "hr-pipe-iv-limit") setPipelineInterviewLimit(!pipelineInterviewLimitOn());
        else if (t && t.getAttribute) {
          if (ev.stopPropagation) ev.stopPropagation();
          openScheduleModal(t.getAttribute("data-hr-iv-open"));
        }
      },
      false
    );
    doc.addEventListener(
      "change",
      function (ev) {
        var t = ev && ev.target;
        if (!t) return;
        if (t.id === "hr-iv-app") {
          fillPageForm(t.value);
          return;
        }
        if (t.id === "hr-iv-day") {
          setInterviewDay(t.value || "all");
          return;
        }
        if (t.id === "hr-pipe-iv-day") {
          setPipelineScheduleDay(t.value || "all");
          return;
        }
        if (t.getAttribute && t.getAttribute("data-hr-iv-status") != null) {
          var appId = t.getAttribute("data-hr-iv-status");
          commitInitialStatus(appId, t.value).then(function (result) {
            if (!result || !result.ok) {
              toast("Could not update that status.", "err");
              return;
            }
            if (result.unchanged) return;
            toast("Status saved.", "ok");
            if (typeof root.render === "function") root.render();
          });
        }
      },
      false
    );
    doc.addEventListener(
      "input",
      function (ev) {
        var t = ev && ev.target;
        if (t && t.id === "hr-iv-day") setInterviewDay(t.value || "all");
        if (t && t.id === "hr-pipe-iv-day") setPipelineScheduleDay(t.value || "all");
        if (t && t.id === "hr-iv-find") filterApplicantSelect(t.value);
        if (t && t.id === "hr-iv-new-name") {
          if (String(t.value || "").trim()) {
            if (t.setAttribute) t.setAttribute("data-from-find", "typed");
          } else if (t.removeAttribute) t.removeAttribute("data-from-find");
        }
      },
      false
    );
  }

  function injectScheduleButtons() {
    if (typeof document === "undefined" || !document.getElementById || !document.querySelectorAll) return;
    if (!document.getElementById("new-app")) return;
    var buttons = document.querySelectorAll("[data-open-app]");
    Array.prototype.forEach.call(buttons || [], function (openBtn) {
      if (!openBtn || !openBtn.getAttribute || !openBtn.parentNode) return;
      if (openBtn.closest && openBtn.closest("#hr-initial-interviews")) return;
      var id = openBtn.getAttribute("data-open-app");
      if (!id) return;
      var inDayCard = openBtn.closest && openBtn.closest("#hr-pipeline-iv-day");
      var person = findApplicant(id);
      var iv = person && normalizeInitialInterview(person.initialInterview);
      var when =
        openBtn.parentNode.querySelector && openBtn.parentNode.querySelector('[data-hr-iv-when="' + id + '"]');
      if (!inDayCard && iv) {
        if (!when && document.createElement) {
          when = document.createElement("div");
          when.className = "lbl";
          when.setAttribute("data-hr-iv-when", id);
          if (when.style) {
            when.style.fontWeight = "400";
            when.style.textTransform = "none";
            when.style.letterSpacing = "0";
            when.style.fontFamily = "var(--f-ui)";
            when.style.fontSize = "11px";
            when.style.marginTop = "4px";
            when.style.whiteSpace = "normal";
          }
          openBtn.parentNode.appendChild(when);
        }
        if (when) when.textContent = "Initial " + formatWhen(iv.at);
      } else if (when && when.parentNode && when.parentNode.removeChild) {
        when.parentNode.removeChild(when);
      }
      if (openBtn.parentNode.querySelector && openBtn.parentNode.querySelector('[data-hr-iv-open="' + id + '"]')) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn sm";
      btn.setAttribute("data-hr-iv-open", id);
      btn.title = "Schedule an initial interview";
      btn.textContent = "Schedule";
      if (btn.style) btn.style.marginLeft = "6px";
      openBtn.parentNode.appendChild(btn);
    });
  }

  function injectSchedulePanel() {
    if (typeof document === "undefined" || !document.getElementById) return null;
    if (document.getElementById("hr-recruit-iv-panel")) return document.getElementById("hr-recruit-iv-panel");
    var anchor = document.getElementById("a-anyguide");
    if (!anchor) return null;
    var row = anchor.parentNode;
    var sect = row;
    while (sect && String(sect.className || "").indexOf("sect-h") < 0) sect = sect.previousElementSibling;
    var panel = document.createElement("div");
    panel.innerHTML = schedulePanelHtml(applicantFromEditor() || {});
    var node = panel.firstChild;
    if (!node) return null;
    if (sect && sect.parentNode) sect.parentNode.insertBefore(node, sect);
    else if (row && row.parentNode) row.parentNode.insertBefore(node, row);
    return document.getElementById("hr-recruit-iv-panel");
  }

  var WEEK_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var WEEK_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var SHOWED_STATUS = { "Done/Passed": true, Failed: true };

  function identityNameKey(name) {
    var d = dedupe();
    if (typeof d.nameKey === "function") return d.nameKey(name);
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join("|");
  }

  function identityEmailKey(email) {
    var d = dedupe();
    if (typeof d.emailKey === "function") return d.emailKey(email);
    var s = String(email || "").trim().toLowerCase();
    if (!s || s.indexOf("@") < 1) return "";
    return s;
  }

  function identityPhoneKey(phone) {
    var d = dedupe();
    if (typeof d.phoneKey === "function") return d.phoneKey(phone);
    var digits = String(phone || "").replace(/\D/g, "");
    if (digits.length >= 10) return digits.slice(-10);
    if (digits.length >= 7) return digits;
    return "";
  }

  function isoDate(value) {
    var m = String(value == null ? "" : value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (!m || !isIsoDate(m[1])) return "";
    return m[1];
  }

  function daysBetween(start, end) {
    var a = isoDate(start);
    var b = isoDate(end);
    if (!a || !b) return null;
    var ap = a.split("-");
    var bp = b.split("-");
    var utcA = Date.UTC(Number(ap[0]), Number(ap[1]) - 1, Number(ap[2]));
    var utcB = Date.UTC(Number(bp[0]), Number(bp[1]) - 1, Number(bp[2]));
    return Math.round((utcB - utcA) / 86400000);
  }

  function formatIsoLong(iso) {
    var m = String(isoDate(iso)).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "";
    var mon = WHEN_MONTHS[Number(m[2]) - 1] || m[2];
    return Number(m[3]) + " " + mon + " " + m[1];
  }

  function openForLabel(days) {
    if (days == null) return "—";
    if (days < 0) return "not open yet";
    if (days === 0) return "opened today";
    if (days === 1) return "1 day";
    return days + " days";
  }

  function hireSpanLabel(days) {
    if (days == null) return "—";
    if (days <= 0) return "same day";
    if (days === 1) return "1 day";
    return days + " days";
  }

  function averageDays(list) {
    if (!list || !list.length) return null;
    var sum = 0;
    var i;
    for (i = 0; i < list.length; i += 1) sum += list[i];
    return Math.round(sum / list.length);
  }

  function weekdayIndex(iso) {
    var d = isoDate(iso);
    if (!d) return -1;
    var p = d.split("-");
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay();
  }

  function blankWeek() {
    return [0, 0, 0, 0, 0, 0, 0];
  }

  function cloneRole(role) {
    var next = {};
    Object.keys(role || {}).forEach(function (k) {
      next[k] = role[k];
    });
    return next;
  }

  function isHiredApplicant(a) {
    if (!a) return false;
    if (canonicalStage(a.stage) === "Hired") return true;
    return !!String(a.hiredEmpId || "").trim();
  }

  function hireDateOf(a) {
    var direct = isoDate(a && (a.hiredOn || a.dateHired));
    if (direct) return direct;
    var id = a && a.hiredEmpId;
    var S = store();
    var emp = id && S && S.employees ? S.employees[id] : null;
    return isoDate(emp && emp.dateHired);
  }

  function isFinalType(interview) {
    var t = String((interview && interview.type) || "")
      .trim()
      .toLowerCase();
    return t === "final" || t.indexOf("final interview") >= 0;
  }

  function initialOf(a) {
    return normalizeInitialInterview(a && a.initialInterview);
  }

  function finalOf(a) {
    return normalizeInitialInterview(a && a.finalInterview);
  }

  function applicantFinalScheduled(a) {
    if (!a) return false;
    if (finalOf(a)) return true;
    var interviews = a.interviews || [];
    var i;
    for (i = 0; i < interviews.length; i += 1) {
      if (isFinalType(interviews[i])) return true;
    }
    var stage = canonicalStage(a.stage);
    return stage === "Final Interview" || stage === "Offer";
  }

  function applicantFinalShowed(a) {
    if (!a) return false;
    var fv = finalOf(a);
    if (fv && SHOWED_STATUS[fv.status]) return true;
    var interviews = a.interviews || [];
    var i;
    for (i = 0; i < interviews.length; i += 1) {
      if (isFinalType(interviews[i]) && isoDate(interviews[i].date)) return true;
    }
    return canonicalStage(a.stage) === "Offer";
  }

  function applicantShowed(a) {
    var iv = initialOf(a);
    if (iv && SHOWED_STATUS[iv.status]) return true;
    return applicantFinalShowed(a);
  }

  function showUpDates(a) {
    var seen = Object.create(null);
    var out = [];
    function add(value) {
      var d = isoDate(value);
      if (!d || seen[d]) return;
      seen[d] = true;
      out.push(d);
    }
    var iv = initialOf(a);
    if (iv && SHOWED_STATUS[iv.status]) add(iv.at);
    var fv = finalOf(a);
    if (fv && SHOWED_STATUS[fv.status]) add(fv.at);
    (a && a.interviews ? a.interviews : []).forEach(function (n) {
      if (isFinalType(n)) add(n.date);
    });
    return out;
  }

  function earliestApplied(list) {
    var best = "";
    (list || []).forEach(function (a) {
      var d = isoDate(a && a.appliedOn);
      if (d && (!best || d < best)) best = d;
    });
    return best;
  }

  function isOpenRole(role) {
    return String((role && role.status) || "") === "Open";
  }

  function roleRecords() {
    var roles = rolesMap();
    return Object.keys(roles)
      .map(function (id) {
        var role = roles[id];
        if (!role) return null;
        if (!role.id) role.id = id;
        return role;
      })
      .filter(Boolean);
  }

  function positionBuckets() {
    var roles = rolesMap();
    var map = Object.create(null);
    var order = [];
    function ensure(key, title, dept, role) {
      if (!map[key]) {
        map[key] = {
          key: key,
          title: title || "Untitled role",
          dept: dept || "",
          role: role || null,
          applicants: [],
        };
        order.push(map[key]);
      } else if (role && !map[key].role) map[key].role = role;
      return map[key];
    }
    roleRecords().forEach(function (role) {
      ensure(String(role.id), role.title, role.dept, role);
    });
    applicantList().forEach(function (a) {
      var key = roleFilterKey(a, roles);
      if (!map[key]) {
        ensure(
          key,
          displayRoleTitle(a, roles) || "No position on the application",
          (a && a.dept) || "",
          roles[key] || null
        );
      }
      map[key].applicants.push(a);
    });
    return order.filter(function (bucket) {
      return bucket.applicants.length || isOpenRole(bucket.role);
    });
  }

  function recruitmentSpan(bucket) {
    var role = bucket && bucket.role;
    var explicit = isoDate(role && role.openedOn);
    var inferred = earliestApplied(bucket && bucket.applicants);
    var start = explicit || inferred;
    var end = today();
    var status = String((role && role.status) || "");
    if (status === "Filled" || status === "Closed") {
      var hires = [];
      (bucket.applicants || []).forEach(function (a) {
        if (!isHiredApplicant(a)) return;
        var d = hireDateOf(a);
        if (d) hires.push(d);
      });
      hires.sort();
      if (isoDate(role && role.closedOn)) end = isoDate(role.closedOn);
      else if (hires.length) end = hires[hires.length - 1];
    }
    return {
      start: start,
      end: start ? end : "",
      days: start ? daysBetween(start, end) : null,
      explicit: !!explicit,
      inferred: !explicit && !!inferred,
    };
  }

  function timeToHireList(applicants) {
    var out = [];
    (applicants || []).forEach(function (a) {
      if (!isHiredApplicant(a)) return;
      var applied = isoDate(a.appliedOn);
      var hired = hireDateOf(a);
      if (!applied || !hired) return;
      var days = daysBetween(applied, hired);
      if (days == null || days < 0) return;
      out.push(days);
    });
    return out;
  }

  function funnelSteps(counts) {
    return [
      { key: "applied", label: "Applied", n: counts.applied },
      { key: "initialScheduled", label: "Scheduled for initial", n: counts.initialScheduled },
      { key: "initialShowed", label: "Showed for initial", n: counts.initialShowed },
      { key: "finalScheduled", label: "Scheduled for final", n: counts.finalScheduled },
      { key: "finalShowed", label: "Showed for final", n: counts.finalShowed },
      { key: "hired", label: "Hired", n: counts.hired },
    ];
  }

  function leakOf(steps) {
    var best = null;
    var i;
    for (i = 1; i < steps.length; i += 1) {
      var lost = steps[i - 1].n - steps[i].n;
      if (lost <= 0) continue;
      if (!best || lost > best.lost) {
        best = {
          from: steps[i - 1].label,
          to: steps[i].label,
          fromKey: steps[i - 1].key,
          toKey: steps[i].key,
          fromN: steps[i - 1].n,
          toN: steps[i].n,
          lost: lost,
        };
      }
    }
    return best;
  }

  function improvementText(m) {
    if (!m || !m.applied) {
      return "No applications yet. The funnel starts once someone is logged against this position.";
    }
    var parts = [];
    if (m.leak && m.leak.lost) {
      var rate = m.leak.fromN ? Math.round((m.leak.toN / m.leak.fromN) * 100) : 0;
      parts.push(
        m.leak.lost +
          (m.leak.lost === 1 ? " person drops" : " people drop") +
          " off between " +
          m.leak.from.toLowerCase() +
          " and " +
          m.leak.to.toLowerCase() +
          " (" +
          rate +
          "% continue). That is where this position loses people."
      );
      if (m.leak.toKey === "initialShowed") {
        parts.push(
          "Confirm the appointment the day before" +
            (m.showDay && m.showDay.label
              ? ", and offer " + m.showDay.label + " — that is when people already show up."
              : ".")
        );
      } else if (m.leak.toKey === "initialScheduled") {
        parts.push("Applications are waiting before an initial interview is set.");
      } else if (m.leak.toKey === "finalScheduled") {
        parts.push("People who pass the initial interview are not being moved to a final interview.");
      } else if (m.leak.toKey === "finalShowed" || m.leak.toKey === "hired") {
        parts.push("People who reach this step are not being taken on. Review the interview result and the offer.");
      }
    } else if (m.hired) {
      parts.push("No step on record is losing people. Keep the same path on the next opening.");
    } else {
      parts.push("The dates on file do not show a drop yet. Set interview results so show-up can be measured.");
    }
    if (m.hired > m.finalShowed) {
      var gap = m.hired - m.finalShowed;
      parts.push(
        gap +
          (gap === 1 ? " hire has" : " hires have") +
          " no final interview on the record, so that step is only partly measured."
      );
    }
    if (m.span && m.span.days != null && m.span.days >= 21 && !m.hired && isOpenRole(m.role)) {
      parts.push("The role has been open " + m.span.days + " days with no hire.");
    }
    return parts.join(" ");
  }

  function modeWeekday(week) {
    var best = 0;
    var days = [];
    var i;
    for (i = 0; i < 7; i += 1) {
      if (week[i] > best) {
        best = week[i];
        days = [i];
      } else if (week[i] === best && best > 0) days.push(i);
    }
    if (!best) return { label: "", short: "", count: 0, days: [] };
    return {
      label: days
        .map(function (d) {
          return WEEK_LONG[d];
        })
        .join(" and "),
      short: days
        .map(function (d) {
          return WEEK_SHORT[d];
        })
        .join(", "),
      count: best,
      days: days,
    };
  }

  function positionMetrics(bucket) {
    var applicants = (bucket && bucket.applicants) || [];
    var counts = {
      applied: applicants.length,
      initialScheduled: 0,
      initialShowed: 0,
      initialNoShow: 0,
      finalScheduled: 0,
      finalShowed: 0,
      showed: 0,
      hired: 0,
    };
    var week = blankWeek();
    applicants.forEach(function (a) {
      var iv = initialOf(a);
      if (iv) {
        counts.initialScheduled += 1;
        if (SHOWED_STATUS[iv.status]) counts.initialShowed += 1;
        if (iv.status === "No-show") counts.initialNoShow += 1;
      }
      if (applicantFinalScheduled(a)) counts.finalScheduled += 1;
      if (applicantFinalShowed(a)) counts.finalShowed += 1;
      if (applicantShowed(a)) counts.showed += 1;
      if (isHiredApplicant(a)) counts.hired += 1;
      showUpDates(a).forEach(function (d) {
        var idx = weekdayIndex(d);
        if (idx >= 0) week[idx] += 1;
      });
    });
    var hireDays = timeToHireList(applicants);
    var steps = funnelSteps(counts);
    var metrics = {
      key: bucket.key,
      title: bucket.title,
      dept: bucket.dept,
      role: bucket.role,
      status: (bucket.role && bucket.role.status) || "",
      applied: counts.applied,
      initialScheduled: counts.initialScheduled,
      initialShowed: counts.initialShowed,
      initialNoShow: counts.initialNoShow,
      finalScheduled: counts.finalScheduled,
      finalShowed: counts.finalShowed,
      showed: counts.showed,
      hired: counts.hired,
      span: recruitmentSpan(bucket),
      avgHire: averageDays(hireDays),
      hireSamples: hireDays.length,
      hireDayList: hireDays,
      week: week,
      showDay: modeWeekday(week),
      steps: steps,
      leak: leakOf(steps),
    };
    metrics.improvement = improvementText(metrics);
    return metrics;
  }

  function metricsReport() {
    var rows = positionBuckets()
      .map(positionMetrics)
      .sort(function (a, b) {
        var ao = isOpenRole(a.role) ? 0 : 1;
        var bo = isOpenRole(b.role) ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return String(a.dept || "").localeCompare(String(b.dept || "")) || String(a.title || "").localeCompare(String(b.title || ""));
      });
    var summary = {
      positions: rows.length,
      applied: 0,
      initialScheduled: 0,
      showed: 0,
      hired: 0,
      week: blankWeek(),
      hireDayList: [],
    };
    var biggest = null;
    rows.forEach(function (m) {
      summary.applied += m.applied;
      summary.initialScheduled += m.initialScheduled;
      summary.showed += m.showed;
      summary.hired += m.hired;
      summary.hireDayList = summary.hireDayList.concat(m.hireDayList);
      m.week.forEach(function (n, i) {
        summary.week[i] += n;
      });
      if (m.leak && (!biggest || m.leak.lost > biggest.leak.lost)) biggest = m;
    });
    summary.avgHire = averageDays(summary.hireDayList);
    summary.showDay = modeWeekday(summary.week);
    summary.biggest = biggest;
    return { rows: rows, summary: summary };
  }

  function safeUrl(link) {
    var s = String(link || "").trim();
    if (/^https?:\/\//i.test(s)) return s;
    return "";
  }

  function normalizeManpowerRequest(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var title = String(raw.title || "").trim();
    var link = String(raw.link || raw.url || "").trim();
    var ref = String(raw.ref || raw.number || raw.formNo || "").trim();
    var note = String(raw.note || raw.notes || "").trim();
    var attachedOn = isoDate(raw.attachedOn || raw.date);
    if (!title && !link && !ref && !note) return null;
    return {
      title: title || "Manpower request",
      link: link,
      ref: ref,
      note: note,
      attachedOn: attachedOn,
    };
  }

  function registerManpower(role) {
    if (!role) return null;
    var S = store() || {};
    var docs = S.docreg || {};
    var wanted = String(role.manpowerRequestId || role.mrfId || "");
    var fallback = null;
    var id;
    for (id in docs) {
      if (!Object.prototype.hasOwnProperty.call(docs, id)) continue;
      var doc = docs[id];
      if (!doc) continue;
      var title = String(doc.title || "");
      var moduleName = String(doc.module || "");
      var isMrf = moduleName === "mrf" || moduleName === "manpower" || /manpower request/i.test(title);
      if (!isMrf && wanted && (doc.id === wanted || id === wanted)) isMrf = true;
      if (!isMrf) continue;
      if (wanted && (id === wanted || doc.id === wanted)) return doc;
      if (doc.refId === role.id || doc.roleId === role.id) return doc;
      if (
        !fallback &&
        role.title &&
        title.toLowerCase().indexOf(String(role.title).toLowerCase()) >= 0
      ) {
        fallback = doc;
      }
    }
    return fallback;
  }

  function manpowerFromRegister(doc) {
    if (!doc) return null;
    return normalizeManpowerRequest({
      title: doc.title || "Manpower request",
      link: doc.link || doc.url || doc.fileUrl || "",
      ref: doc.no || doc.ref || "",
      note: doc.note || "",
      attachedOn: doc.date || doc.attachedOn || "",
    });
  }

  function manpowerRequestOf(role) {
    var direct = normalizeManpowerRequest(role && role.manpowerRequest);
    if (direct) return direct;
    return manpowerFromRegister(registerManpower(role));
  }

  function manpowerFromFields(fields) {
    fields = fields || {};
    var link = String(fields.link || "").trim();
    var ref = String(fields.ref || "").trim();
    var note = String(fields.note || "").trim();
    var title = String(fields.title || "").trim();
    if (link && !safeUrl(link)) return { ok: false, error: "link" };
    if (!link && !ref && !note) return { ok: false, error: "empty" };
    return {
      ok: true,
      request: {
        title: title || "Manpower request",
        link: link,
        ref: ref,
        note: note,
        attachedOn: isoDate(fields.attachedOn),
      },
    };
  }

  function mrfError(kind) {
    if (kind === "link") return "The form link has to start with http:// or https://.";
    if (kind === "empty") return "Add the form link or its number.";
    if (kind === "missing") return "That role is not on file.";
    return "Could not save the manpower request.";
  }

  async function commitRole(roleId, next) {
    var S = store();
    if (!S || !S.roles || !S.roles[roleId]) return { ok: false, error: "missing" };
    S.roles[roleId] = next;
    var saved = true;
    if (typeof root.put === "function") saved = await root.put("roles", roleId, next);
    if (saved === false) return { ok: false, error: "save", role: next, local: true };
    return { ok: true, role: next };
  }

  async function saveOpenedOn(roleId, value) {
    var S = store();
    var cur = S && S.roles ? S.roles[roleId] : null;
    if (!cur) return { ok: false, error: "missing" };
    var date = String(value || "").trim();
    if (date && !isoDate(date)) {
      toast("Use a real date for when the role opened.", "err");
      return { ok: false, error: "date" };
    }
    date = date ? isoDate(date) : "";
    if (String(cur.openedOn || "") === date) return { ok: true, unchanged: true, role: cur };
    var next = cloneRole(cur);
    if (date) next.openedOn = date;
    else delete next.openedOn;
    var result = await commitRole(roleId, next);
    if (!result.ok && result.error === "missing") {
      toast(mrfError("missing"), "err");
      return result;
    }
    if (result.ok) toast(date ? "Opened date saved." : "Opened date cleared.", "ok");
    if (typeof root.render === "function") root.render();
    return result;
  }

  async function saveManpowerRequest(roleId, fields) {
    var S = store();
    var cur = S && S.roles ? S.roles[roleId] : null;
    if (!cur) return { ok: false, error: "missing" };
    var next = cloneRole(cur);
    if (fields == null) {
      delete next.manpowerRequest;
      delete next.manpowerRequestId;
      delete next.mrfId;
    } else {
      var built = manpowerFromFields(fields);
      if (!built.ok) return built;
      next.manpowerRequest = built.request;
    }
    return commitRole(roleId, next);
  }

  function parentOf(parents, id) {
    var guard = 0;
    while (parents[id] !== id && guard < 10000) {
      parents[id] = parents[parents[id]];
      id = parents[id];
      guard += 1;
    }
    return id;
  }

  function unionIds(parents, a, b) {
    if (!a || !b) return;
    var pa = parentOf(parents, a);
    var pb = parentOf(parents, b);
    if (pa !== pb) parents[pb] = pa;
  }

  function reapplicantReason(recs) {
    var names = Object.create(null);
    var emails = Object.create(null);
    var phones = Object.create(null);
    recs.forEach(function (a) {
      var nk = identityNameKey(a && a.name);
      var ek = identityEmailKey(a && a.email);
      var pk = identityPhoneKey(a && (a.mobile || a.phone));
      if (nk) names[nk] = true;
      if (ek) emails[ek] = true;
      if (pk) phones[pk] = true;
    });
    var bits = [];
    var nameN = Object.keys(names).length;
    if (nameN === 1) bits.push("same name");
    if (Object.keys(emails).length === 1) bits.push("same email");
    if (Object.keys(phones).length === 1) bits.push("same mobile");
    if (!bits.length) bits.push("similar names");
    return bits.join(", ");
  }

  function reapplicantGroups(list) {
    var rows = (list || applicantList()).filter(function (a) {
      return a && (a.id || a.name || a.email || a.mobile);
    });
    var parents = Object.create(null);
    var ids = rows.map(function (a, i) {
      var id = String(a.id || "idx:" + i);
      parents[id] = id;
      return id;
    });
    var byName = Object.create(null);
    var byEmail = Object.create(null);
    var byPhone = Object.create(null);
    rows.forEach(function (a, i) {
      var id = ids[i];
      var nk = identityNameKey(a.name);
      var ek = identityEmailKey(a.email);
      var pk = identityPhoneKey(a.mobile || a.phone);
      if (nk) {
        if (byName[nk]) unionIds(parents, byName[nk], id);
        else byName[nk] = id;
      }
      if (ek) {
        if (byEmail[ek]) unionIds(parents, byEmail[ek], id);
        else byEmail[ek] = id;
      }
      if (pk) {
        if (byPhone[pk]) unionIds(parents, byPhone[pk], id);
        else byPhone[pk] = id;
      }
    });
    var nameKeys = Object.keys(byName);
    nameKeys.forEach(function (aKey) {
      nameKeys.forEach(function (bKey) {
        if (aKey >= bKey) return;
        var aTok = aKey.split("|");
        var bTok = bKey.split("|");
        var small = aTok.length < bTok.length ? aTok : bTok;
        var large = aTok.length < bTok.length ? bTok : aTok;
        if (small.length < 2 || small.length === large.length) return;
        var subset = small.every(function (token) {
          return large.indexOf(token) >= 0;
        });
        if (subset) unionIds(parents, byName[aKey], byName[bKey]);
      });
    });
    var buckets = Object.create(null);
    rows.forEach(function (a, i) {
      var rootId = parentOf(parents, ids[i]);
      (buckets[rootId] = buckets[rootId] || []).push(a);
    });
    var groups = [];
    Object.keys(buckets).forEach(function (rootId) {
      var recs = buckets[rootId];
      if (recs.length < 2) return;
      recs.sort(function (a, b) {
        return String(a.appliedOn || "").localeCompare(String(b.appliedOn || "")) || String(a.id || "").localeCompare(String(b.id || ""));
      });
      var name = "";
      recs.forEach(function (a) {
        var n = String(a.name || "").trim();
        if (n.length > name.length) name = n;
      });
      groups.push({
        key: rootId,
        name: name || "Unnamed applicant",
        reason: reapplicantReason(recs),
        applicants: recs,
      });
    });
    groups.sort(function (a, b) {
      return b.applicants.length - a.applicants.length || String(a.name).localeCompare(String(b.name));
    });
    return groups;
  }

  function reapplicantCount() {
    return reapplicantGroups().length;
  }

  function reapplicantMap() {
    if (api.__reappMap) return api.__reappMap;
    var map = Object.create(null);
    reapplicantGroups().forEach(function (g) {
      g.applicants.forEach(function (a) {
        if (a && a.id) map[a.id] = g;
      });
    });
    api.__reappMap = map;
    return map;
  }

  function clearReappMap() {
    api.__reappMap = null;
  }

  function reapplicantBadgeHtml(a) {
    if (!a || !a.id) return "";
    var g = reapplicantMap()[a.id];
    if (!g) return "";
    var n = g.applicants.length;
    return (
      ' <span class="pill warn" data-hr-reapp="' +
      esc(a.id) +
      '" title="' +
      esc(n + " applications on file. " + (g.reason || "")) +
      '">Re-applicant · ' +
      n +
      "</span>"
    );
  }

  function tileHtml(value, label, sub, sev) {
    return (
      '<div class="tile ' +
      esc(sev || "") +
      '"><div class="v">' +
      esc(value) +
      '</div><div class="k">' +
      esc(label) +
      "</div>" +
      (sub ? '<div class="sub">' + esc(sub) + "</div>" : "") +
      "</div>"
    );
  }

  function manpowerCellHtml(role) {
    var mrf = manpowerRequestOf(role);
    var button =
      '<button type="button" class="btn sm" data-hr-mrf="' +
      esc(role.id) +
      '">' +
      (mrf ? "Change" : "Attach form") +
      "</button>";
    if (!mrf) return button + '<div class="lbl">No manpower request on this role yet.</div>';
    var url = safeUrl(mrf.link);
    var label = esc(mrf.title || "Manpower request");
    if (mrf.ref) label += ' <span class="mono">' + esc(mrf.ref) + "</span>";
    var body = url
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + label + "</a>"
      : label;
    if (mrf.attachedOn) body += '<div class="lbl">' + esc(formatIsoLong(mrf.attachedOn)) + "</div>";
    if (mrf.note) body += '<div class="lbl">' + esc(mrf.note) + "</div>";
    return body + '<div style="margin-top:6px">' + button + "</div>";
  }

  function openForCell(metrics) {
    var span = metrics && metrics.span;
    if (!span || span.days == null) return "—";
    var text = openForLabel(span.days);
    if (span.inferred) text += '<div class="lbl">from the first application</div>';
    return text;
  }

  function showedTitle(metrics) {
    var bits = [];
    if (metrics.initialNoShow) bits.push(metrics.initialNoShow + " no-show");
    var waiting = metrics.initialScheduled - metrics.initialShowed - metrics.initialNoShow;
    if (waiting > 0) bits.push(waiting + " still scheduled or moved");
    return bits.join(", ");
  }

  function openRolesHtml() {
    clearReappMap();
    var byKey = Object.create(null);
    metricsReport().rows.forEach(function (m) {
      byKey[m.key] = m;
    });
    var rows = roleRecords()
      .filter(isOpenRole)
      .map(function (role) {
        return {
          role: role,
          metrics:
            byKey[String(role.id)] ||
            positionMetrics({
              key: String(role.id),
              title: role.title,
              dept: role.dept,
              role: role,
              applicants: [],
            }),
        };
      })
      .sort(function (a, b) {
        return (
          String(a.role.dept || "").localeCompare(String(b.role.dept || "")) ||
          String(a.role.title || "").localeCompare(String(b.role.title || ""))
        );
      });
    var withForm = rows.filter(function (row) {
      return !!manpowerRequestOf(row.role);
    }).length;
    var reN = reapplicantCount();
    var h =
      '<div id="hr-open-roles">' +
      '<div class="note">Open roles are the ones marked Open on the role. Days open use the date saved here. If that date is blank, the count uses the first application and says so. Showed up means the initial interview is Done/Passed or Failed, or a final interview was actually held. Hired is the Hired stage or an application already linked to a 201 file. There is no manpower-request form in the portal, so attach the Drive link or the form number.</div>' +
      '<div class="strip">' +
      tileHtml(rows.length, "Open roles", "currently hiring", rows.length ? "acc" : "ok") +
      tileHtml(withForm, "Manpower request attached", rows.length - withForm + " still to attach", withForm && withForm === rows.length ? "ok" : "warn") +
      tileHtml(reN, "Re-applicants", "people who applied more than once", reN ? "warn" : "ok") +
      "</div>";
    if (!rows.length) {
      return (
        h +
        '<div class="card"><div class="empty">No role is marked Open. Set the status on Roles when hiring starts.</div></div></div>'
      );
    }
    h +=
      '<div class="sect-h"><h2>Current open roles</h2><span class="rule"></span></div>' +
      '<div class="card"><div class="tw"><table><thead><tr>' +
      "<th>Role</th><th>Opened</th><th>Manpower request</th><th>Open for</th>" +
      '<th class="num">Initial scheduled</th><th class="num">Initial showed</th>' +
      '<th class="num">Final scheduled</th><th class="num">Final showed</th><th class="num">Hired</th>' +
      "</tr></thead><tbody>";
    rows.forEach(function (row) {
      var role = row.role;
      var m = row.metrics;
      var opened = isoDate(role.openedOn);
      h +=
        '<tr data-hr-open-role="' +
        esc(role.id) +
        '"><td class="nm">' +
        esc(role.title || "Untitled role") +
        '<div class="lbl">' +
        esc(role.dept || "No department") +
        " · headcount " +
        esc(String(role.headcount || 1)) +
        "</div></td><td>" +
        '<input type="date" data-hr-opened="' +
        esc(role.id) +
        '" value="' +
        esc(opened) +
        '" aria-label="Date ' +
        esc(role.title || "this role") +
        ' opened">' +
        (m.span && m.span.inferred
          ? '<div class="lbl">First application ' + esc(formatIsoLong(m.span.start)) + ". Set the opened date to keep it.</div>"
          : "") +
        "</td><td>" +
        manpowerCellHtml(role) +
        "</td><td>" +
        openForCell(m) +
        '</td><td class="num">' +
        m.initialScheduled +
        '</td><td class="num"' +
        (showedTitle(m) ? ' title="' + esc(showedTitle(m)) + '"' : "") +
        ">" +
        m.initialShowed +
        '</td><td class="num">' +
        m.finalScheduled +
        '</td><td class="num">' +
        m.finalShowed +
        '</td><td class="num">' +
        m.hired +
        "</td></tr>";
    });
    h += "</tbody></table></div></div></div>";
    return h;
  }

  function reapplicantsHtml() {
    clearReappMap();
    var groups = reapplicantGroups();
    var applications = groups.reduce(function (n, g) {
      return n + g.applicants.length;
    }, 0);
    var h =
      '<div id="hr-reapplicants">' +
      '<div class="note">A re-applicant is someone already on the pipeline who applies again. Matches use the same name (including Last, First), the same email, or the same mobile. The badge on the applicant uses this list. Merging duplicates under Consolidate still keeps one record.</div>' +
      '<div class="strip">' +
      tileHtml(groups.length, "Re-applicants", "people with more than one application", groups.length ? "warn" : "ok") +
      tileHtml(applications, "Applications", "from those people", applications ? "acc" : "ok") +
      tileHtml(
        Math.max(0, applications - groups.length),
        "Extra applications",
        "beyond the first one",
        applications > groups.length ? "warn" : "ok"
      ) +
      "</div>";
    if (!groups.length) {
      return (
        h +
        '<div class="card"><div class="empty">No one on the pipeline has applied more than once.</div></div></div>'
      );
    }
    h +=
      '<div class="sect-h"><h2>Who applied again</h2><span class="rule"></span></div>' +
      '<div class="card"><div class="tw"><table><thead><tr><th>Applicant</th><th>Why they match</th><th>Applications</th></tr></thead><tbody>';
    groups.forEach(function (g) {
      var lines = g.applicants
        .map(function (a) {
          return (
            '<div style="margin:0 0 6px">' +
            esc(a.appliedOn || "no date") +
            " · " +
            esc(displayRoleTitle(a) || a.position || "No position") +
            " · " +
            esc(stageText(a.stage)) +
            (a.email ? " · " + esc(a.email) : "") +
            (a.mobile ? " · " + esc(a.mobile) : "") +
            ' <button type="button" class="btn sm" data-open-app="' +
            esc(a.id) +
            '">Open</button></div>'
          );
        })
        .join("");
      h +=
        "<tr><td class=\"nm\">" +
        esc(g.name) +
        reapplicantBadgeHtml(g.applicants[0]) +
        "</td><td>" +
        esc(g.reason) +
        "</td><td>" +
        lines +
        "</td></tr>";
    });
    h += "</tbody></table></div></div></div>";
    return h;
  }

  function weekdayBarHtml(week, showDay) {
    var peak = 0;
    week.forEach(function (n) {
      if (n > peak) peak = n;
    });
    if (!peak) {
      return '<div class="lbl">No show-up recorded yet. A show-up is an initial interview marked Done/Passed or Failed, or a final interview with a date.</div>';
    }
    var order = [1, 2, 3, 4, 5, 6, 0];
    var cells = order
      .map(function (idx) {
        var hot = week[idx] && week[idx] === peak;
        return (
          '<span class="pill ' +
          (hot ? "ok" : "mut") +
          '">' +
          esc(WEEK_SHORT[idx]) +
          " " +
          week[idx] +
          "</span>"
        );
      })
      .join(" ");
    return (
      "<div>" +
      cells +
      '<div class="lbl" style="margin-top:8px">Applicants mostly show up on ' +
      esc(showDay && showDay.label ? showDay.label : "—") +
      " (" +
      (showDay ? showDay.count : 0) +
      ").</div></div>"
    );
  }

  function funnelHtml(steps, leak) {
    var max = 0;
    steps.forEach(function (step) {
      if (step.n > max) max = step.n;
    });
    if (!max) max = 1;
    return (
      '<div class="chklist">' +
      steps
        .map(function (step, i) {
          var prev = i ? steps[i - 1] : null;
          var width = Math.max(2, Math.round((step.n / max) * 100));
          var conv = prev && prev.n ? Math.round((step.n / prev.n) * 100) : null;
          var dropHere = leak && leak.toKey === step.key;
          return (
            '<div class="chk"><span class="idx">' +
            String(i + 1).padStart(2, "0") +
            '</span><span class="n"><b>' +
            esc(step.label) +
            "</b><span>" +
            step.n +
            (conv == null ? "" : " · " + conv + "% of the previous step") +
            "</span></span>" +
            '<span style="width:88px"><span class="meter"><i style="width:' +
            width +
            '%"></i></span></span>' +
            (dropHere ? '<span class="pill warn">drops here</span>' : "") +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function metricsHtml() {
    clearReappMap();
    var report = metricsReport();
    var summary = report.summary;
    var showLabel = summary.showDay && summary.showDay.label ? summary.showDay.label : "no show-ups yet";
    var h =
      '<div id="hr-recruit-metrics">' +
      '<div class="note">Counts come from the pipeline. Scheduled is an interview with a date. Showed up for an initial interview is Done/Passed or Failed. A final interview counts when the stage is For Final Interview or Offer, a final script is on the file, or a final interview date is saved. Time to hire is the applied date to the hire date. The longest drop between those steps is where that position can improve.</div>' +
      '<div class="strip">' +
      tileHtml(summary.positions, "Positions", "open roles and roles with applicants", "acc") +
      tileHtml(summary.applied, "Applied", "applications on record", summary.applied ? "acc" : "ok") +
      tileHtml(summary.showed, "Showed up", "initial or final", summary.showed ? "ok" : "warn") +
      tileHtml(summary.hired, "Hired", "stage Hired or a 201 file", "ok") +
      tileHtml(summary.avgHire == null ? "—" : hireSpanLabel(summary.avgHire), "Average time to hire", "applied date to hire date", "acc") +
      tileHtml(showLabel, "Mostly show up", summary.showDay && summary.showDay.count ? summary.showDay.count + " on that day" : "once a show-up is recorded", summary.showDay && summary.showDay.count ? "ok" : "mut") +
      "</div>";
    if (summary.biggest && summary.biggest.leak) {
      h +=
        '<div class="note" style="border-left-color:var(--warn)"><b>Largest gap: ' +
        esc(summary.biggest.title) +
        ".</b> " +
        esc(summary.biggest.improvement) +
        "</div>";
    }
    h +=
      '<div class="sect-h"><h2>Show-up by day of the week</h2><span class="rule"></span></div>' +
      '<div class="card"><div class="card-b">' +
      weekdayBarHtml(summary.week, summary.showDay) +
      "</div></div>";
    if (!report.rows.length) {
      return h + '<div class="card"><div class="empty">No open role and no applications yet.</div></div></div>';
    }
    h +=
      '<div class="sect-h"><h2>Every position</h2><span class="rule"></span></div>' +
      '<div class="card"><div class="tw"><table><thead><tr>' +
      "<th>Position</th><th class=\"num\">Applied</th><th class=\"num\">Initial scheduled</th><th class=\"num\">Showed up</th>" +
      "<th class=\"num\">Final scheduled</th><th class=\"num\">Final showed</th><th class=\"num\">Hired</th>" +
      "<th>Recruitment</th><th>Avg time to hire</th><th>Show-up day</th><th>Where it drops</th>" +
      "</tr></thead><tbody>";
    report.rows.forEach(function (m) {
      var where = m.leak ? m.leak.from + " → " + m.leak.to + " (" + m.leak.lost + ")" : m.applied ? "no drop on record" : "—";
      h +=
        '<tr data-hr-metrics="' +
        esc(m.key) +
        '"><td class="nm">' +
        esc(m.title) +
        '<div class="lbl">' +
        esc(m.dept || (m.status ? m.status : "")) +
        "</div></td><td class=\"num\">" +
        m.applied +
        '</td><td class="num">' +
        m.initialScheduled +
        '</td><td class="num">' +
        m.showed +
        '</td><td class="num">' +
        m.finalScheduled +
        '</td><td class="num">' +
        m.finalShowed +
        '</td><td class="num">' +
        m.hired +
        "</td><td>" +
        (m.span && m.span.days != null
          ? esc(openForLabel(m.span.days)) +
            (m.span.start ? '<div class="lbl">' + esc(formatIsoLong(m.span.start)) + " – " + esc(formatIsoLong(m.span.end)) + "</div>" : "")
          : "—") +
        "</td><td>" +
        esc(m.avgHire == null ? "—" : hireSpanLabel(m.avgHire)) +
        (m.hireSamples ? '<div class="lbl">' + m.hireSamples + (m.hireSamples === 1 ? " hire" : " hires") + "</div>" : "") +
        "</td><td>" +
        esc(m.showDay && m.showDay.short ? m.showDay.short : "—") +
        "</td><td>" +
        esc(where) +
        "</td></tr>";
    });
    h += "</tbody></table></div></div>";
    report.rows.forEach(function (m) {
      if (!m.applied) return;
      h +=
        '<div class="card" style="margin-top:12px" data-hr-metrics-card="' +
        esc(m.key) +
        '"><div class="card-h"><h3>' +
        esc(m.title) +
        "</h3>" +
        (m.status ? '<span class="pill ' + (m.status === "Open" ? "warn" : "mut") + '">' + esc(m.status) + "</span>" : "") +
        "</div><div class=\"card-b\">" +
        funnelHtml(m.steps, m.leak) +
        '<div style="margin-top:10px">' +
        weekdayBarHtml(m.week, m.showDay) +
        '</div><div class="note" style="margin-top:10px">' +
        esc(m.improvement) +
        "</div></div></div>";
    });
    h += "</div>";
    return h;
  }

  function reapplicantEditorNoteHtml(a) {
    if (!a || !a.id) return "";
    clearReappMap();
    var g = reapplicantMap()[a.id];
    if (!g) return "";
    var lines = g.applicants
      .map(function (row) {
        return (
          "<div>" +
          esc(row.appliedOn || "no date") +
          " · " +
          esc(displayRoleTitle(row) || row.position || "No position") +
          " · " +
          esc(stageText(row.stage)) +
          (row.id === a.id ? " · this record" : "") +
          "</div>"
        );
      })
      .join("");
    return (
      '<div class="note" id="hr-reapp-editor" style="border-left-color:var(--warn)"><b>Re-applicant · ' +
      g.applicants.length +
      " applications.</b> " +
      esc(g.reason) +
      "." +
      lines +
      "</div>"
    );
  }

  function injectReapplicantBadges() {
    if (typeof document === "undefined" || !document.querySelectorAll) return;
    clearReappMap();
    var map = reapplicantMap();
    Array.prototype.forEach.call(document.querySelectorAll("[data-open-app]"), function (btn) {
      if (!btn || !btn.getAttribute) return;
      var id = btn.getAttribute("data-open-app");
      var tr = btn;
      while (tr && tr.tagName !== "TR") tr = tr.parentNode;
      if (!tr || !tr.querySelector) return;
      var cell = tr.querySelector("td.nm");
      if (!cell) return;
      var badge = cell.querySelector("[data-hr-reapp]");
      var g = map[id];
      if (!g) {
        if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
        return;
      }
      var label = "Re-applicant · " + g.applicants.length;
      if (!badge && document.createElement) {
        badge = document.createElement("span");
        badge.className = "pill warn";
        badge.setAttribute("data-hr-reapp", id);
        if (badge.style) badge.style.marginLeft = "6px";
        cell.appendChild(badge);
      }
      if (!badge) return;
      badge.textContent = label;
      badge.title = g.applicants.length + " applications on file. " + (g.reason || "");
    });
  }

  function injectReapplicantPipelineNote() {
    if (typeof document === "undefined" || !document.getElementById || !document.createElement) return;
    var log = document.getElementById("new-app");
    var existing = document.getElementById("hr-reapp-pipeline-note");
    if (!log || !log.parentNode) {
      if (existing && existing.parentNode && existing.parentNode.removeChild) existing.parentNode.removeChild(existing);
      return;
    }
    var groups = reapplicantGroups();
    if (!groups.length) {
      if (existing && existing.parentNode && existing.parentNode.removeChild) existing.parentNode.removeChild(existing);
      return;
    }
    var applications = groups.reduce(function (n, g) {
      return n + g.applicants.length;
    }, 0);
    if (!existing) {
      existing = document.createElement("div");
      existing.id = "hr-reapp-pipeline-note";
      existing.className = "note";
      var sect = log.parentNode;
      if (sect.parentNode && sect.parentNode.insertBefore) sect.parentNode.insertBefore(existing, sect);
      else if (sect.insertBefore) sect.insertBefore(existing, log);
    }
    existing.innerHTML =
      "<b>" +
      groups.length +
      " re-applicant" +
      (groups.length === 1 ? "" : "s") +
      "</b> — " +
      applications +
      " applications share a name, email, or mobile. " +
      '<button type="button" class="btn sm" id="hr-reapp-open">Open the list</button>';
  }

  function injectReapplicantEditorNote() {
    if (typeof document === "undefined" || !document.getElementById || !document.createElement) return;
    var name = document.getElementById("a-name");
    var existing = document.getElementById("hr-reapp-editor");
    if (!name) return;
    var applicant = applicantFromEditor();
    var html = reapplicantEditorNoteHtml(applicant);
    if (!html) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    if (existing) {
      var holder = document.createElement("div");
      holder.innerHTML = html;
      if (holder.firstChild && existing.parentNode) existing.parentNode.replaceChild(holder.firstChild, existing);
      return;
    }
    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    var node = wrap.firstChild;
    if (!node) return;
    var grid = name.parentNode;
    while (grid && String(grid.className || "").indexOf("grid3") < 0) grid = grid.parentNode;
    if (grid && grid.parentNode) grid.parentNode.insertBefore(node, grid);
    else if (name.parentNode) name.parentNode.insertBefore(node, name);
  }

  function openRecruitMode(mode) {
    var S = store();
    if (S) {
      S.ui = S.ui || {};
      S.ui.view = "recruit";
      S.ui.rmode = mode;
    }
    if (typeof root.render === "function") root.render();
  }

  function openManpowerRequest(roleId) {
    var role = rolesMap()[roleId];
    if (!role || typeof root.openModal !== "function") {
      toast("That role is not on file.", "err");
      return;
    }
    var mrf = normalizeManpowerRequest(role.manpowerRequest) || {
      title: "Manpower request",
      link: "",
      ref: "",
      note: "",
      attachedOn: today(),
    };
    root.openModal({
      title: "Manpower request — " + (role.title || "role"),
      body:
        '<div class="stack" id="hr-mrf-form" data-hr-mrf-for="' +
        esc(role.id) +
        '"><div class="note">Paste the link to the manpower request, or its form number. The portal does not keep a separate manpower-request file, so this attachment stays on the open role.</div>' +
        '<div class="f"><label>Title</label><input id="hr-mrf-title" value="' +
        esc(mrf.title || "Manpower request") +
        '"></div>' +
        '<div class="grid2"><div class="f"><label>Form link</label><input id="hr-mrf-link" type="url" value="' +
        esc(mrf.link || "") +
        '" placeholder="https://"></div>' +
        '<div class="f"><label>Form number</label><input id="hr-mrf-ref" value="' +
        esc(mrf.ref || "") +
        '" placeholder="MRF-2026-014"></div></div>' +
        '<div class="f"><label>Date of the request</label><input id="hr-mrf-on" type="date" value="' +
        esc(mrf.attachedOn || "") +
        '"></div>' +
        '<div class="f"><label>Note</label><input id="hr-mrf-note" value="' +
        esc(mrf.note || "") +
        '"></div></div>',
      foot:
        '<button class="btn danger" id="hr-mrf-clear" type="button">Remove</button>' +
        '<button class="btn" id="hr-mrf-cancel" type="button">Cancel</button>' +
        '<button class="btn pri" id="hr-mrf-save" type="button">Save attachment</button>',
    });
  }

  async function saveManpowerFromModal() {
    if (typeof document === "undefined" || !document.getElementById) return;
    var host = document.getElementById("hr-mrf-form");
    var roleId = host && host.getAttribute ? host.getAttribute("data-hr-mrf-for") : "";
    var result = await saveManpowerRequest(roleId, {
      title: fieldValue("hr-mrf-title"),
      link: fieldValue("hr-mrf-link"),
      ref: fieldValue("hr-mrf-ref"),
      note: fieldValue("hr-mrf-note"),
      attachedOn: fieldValue("hr-mrf-on"),
    });
    if (!result.ok) {
      toast(mrfError(result.error), "err");
      return;
    }
    toast("Manpower request attached.", "ok");
    if (typeof root.closeModal === "function") root.closeModal();
    if (typeof root.render === "function") root.render();
  }

  async function clearManpowerFromModal() {
    if (typeof document === "undefined" || !document.getElementById) return;
    var host = document.getElementById("hr-mrf-form");
    var roleId = host && host.getAttribute ? host.getAttribute("data-hr-mrf-for") : "";
    var result = await saveManpowerRequest(roleId, null);
    if (!result.ok) {
      toast(mrfError(result.error), "err");
      return;
    }
    toast("Manpower request removed from this role.", "ok");
    if (typeof root.closeModal === "function") root.closeModal();
    if (typeof root.render === "function") root.render();
  }

  function bindRecruitDesk(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc || doc.__hrRecruitDesk || !doc.addEventListener) return;
    doc.__hrRecruitDesk = true;
    doc.addEventListener(
      "change",
      function (ev) {
        var t = ev && ev.target;
        if (!t || !t.getAttribute) return;
        var roleId = t.getAttribute("data-hr-opened");
        if (roleId == null) return;
        saveOpenedOn(roleId, t.value);
      },
      false
    );
    doc.addEventListener(
      "click",
      function (ev) {
        var t = ev && ev.target;
        var id = "";
        var roleId = "";
        while (t && t !== doc) {
          if (t.id === "hr-reapp-open" || t.id === "hr-mrf-save" || t.id === "hr-mrf-clear" || t.id === "hr-mrf-cancel") {
            id = t.id;
            break;
          }
          if (t.getAttribute && t.getAttribute("data-hr-mrf") != null) {
            id = "mrf";
            roleId = t.getAttribute("data-hr-mrf");
            break;
          }
          t = t.parentNode;
        }
        if (!id) return;
        if (ev.preventDefault) ev.preventDefault();
        if (id === "hr-reapp-open") openRecruitMode("reapplicants");
        else if (id === "mrf") openManpowerRequest(roleId);
        else if (id === "hr-mrf-save") saveManpowerFromModal();
        else if (id === "hr-mrf-clear") clearManpowerFromModal();
        else if (id === "hr-mrf-cancel" && typeof root.closeModal === "function") root.closeModal();
      },
      false
    );
  }

  function refreshDeskView() {
    var S = store();
    if (!S || !S.ui || S.ui.view !== "recruit") return;
    var mode = S.ui.rmode;
    var hostId =
      mode === "openroles" ? "hr-open-roles" : mode === "reapplicants" ? "hr-reapplicants" : mode === "metrics" ? "hr-recruit-metrics" : "";
    if (!hostId) return;
    if (typeof document !== "undefined" && document.getElementById && document.getElementById(hostId)) return;
    if (typeof root.render === "function") root.render();
  }

  function refreshInitialView() {
    var S = store();
    if (!S || !S.ui || S.ui.view !== "recruit" || S.ui.rmode !== "initial") return;
    if (typeof document !== "undefined" && document.getElementById && document.getElementById("hr-initial-interviews")) return;
    if (typeof root.render === "function") root.render();
  }

  function injectChrome() {
    try {
      wrapOpenModal();
      wrapAppEditor();
      wrapPut();
      bindInitialInterviewEvents();
      injectButton();
      injectConsolidateButton();
      injectSearch();
      injectRoleFilter();
      injectPipelineSchedule();
      injectScheduleButtons();
      bindRecruitDesk();
      injectReapplicantBadges();
      injectReapplicantPipelineNote();
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
    try {
      refreshInitialView();
      refreshDeskView();
    } catch (e1) {}
    return api;
  }

  api.parsePaste = parsePaste;
  api.openOverwriteDoor = openOverwriteDoor;
  api.injectButton = injectButton;
  api.injectConsolidateButton = injectConsolidateButton;
  api.injectRoleFilter = injectRoleFilter;
  api.injectSearch = injectSearch;
  api.applyRoleFilter = applyRoleFilter;
  api.applyPipelineFilters = applyPipelineFilters;
  api.setRoleFilter = setRoleFilter;
  api.setPipelineSearch = setPipelineSearch;
  api.currentSearch = currentSearch;
  api.roleFilterKey = roleFilterKey;
  api.roleFilterOptions = roleFilterOptions;
  api.applicantMatchesRole = applicantMatchesRole;
  api.applicantMatchesSearch = applicantMatchesSearch;
  api.applicantMatchesPipeline = applicantMatchesPipeline;
  api.applicantFuzzyMatch = applicantFuzzyMatch;
  api.searchHaystack = searchHaystack;
  api.exactNameMatches = exactNameMatches;
  api.applicantsForSchedule = applicantsForSchedule;
  api.manualApplicant = manualApplicant;
  api.commitManualInterview = commitManualInterview;
  api.resolveInterviewTarget = resolveInterviewTarget;
  api.filterApplicantSelect = filterApplicantSelect;
  api.openPasteDoor = openPasteDoor;
  api.openConsolidateDoor = openConsolidateDoor;
  api.openApplicationFile = openApplicationFile;
  api.decorateApplicantFoot = decorateApplicantFoot;
  api.applicationFileHtml = applicationFileHtml;
  api.duplicateGroups = duplicateGroups;
  api.mergeGroup = mergeGroup;
  api.carryApplicantDocs = carryApplicantDocs;
  api.staffNotesHtml = staffNotesHtml;
  api.appendStaffNote = appendStaffNote;
  api.mergeStaffNotes = mergeStaffNotes;
  api.normalizeStaffNote = normalizeStaffNote;
  api.injectStaffNotesPanel = injectStaffNotesPanel;
  api.normalizeExamScore = normalizeExamScore;
  api.mergeExamScores = mergeExamScores;
  api.appendExamScore = appendExamScore;
  api.updateExamScore = updateExamScore;
  api.removeExamScore = removeExamScore;
  api.examScoresOf = examScoresOf;
  api.examScoreLine = examScoreLine;
  api.examScoresSummaryHtml = examScoresSummaryHtml;
  api.INITIAL_STATUSES = INITIAL_STATUSES;
  api.normalizeWhen = normalizeWhen;
  api.normalizeStatus = normalizeStatus;
  api.normalizeInitialInterview = normalizeInitialInterview;
  api.mergeInitialInterview = mergeInitialInterview;
  api.stageAfterSchedule = stageAfterSchedule;
  api.scheduleInitialInterview = scheduleInitialInterview;
  api.setInitialInterviewStatus = setInitialInterviewStatus;
  api.commitInitialInterview = commitInitialInterview;
  api.commitInitialStatus = commitInitialStatus;
  api.formatWhen = formatWhen;
  api.manilaToday = manilaToday;
  api.shiftIsoDate = shiftIsoDate;
  api.interviewDayOf = interviewDay;
  api.currentInterviewDay = currentInterviewDay;
  api.setInterviewDay = setInterviewDay;
  api.currentPipelineScheduleDay = currentPipelineScheduleDay;
  api.setPipelineScheduleDay = setPipelineScheduleDay;
  api.pipelineInterviewLimitOn = pipelineInterviewLimitOn;
  api.setPipelineInterviewLimit = setPipelineInterviewLimit;
  api.applicantMatchesInterviewView = applicantMatchesInterviewView;
  api.scheduledInterviewGroups = scheduledInterviewGroups;
  api.applicantOptionsHtml = applicantOptionsHtml;
  api.initialInterviewsHtml = initialInterviewsHtml;
  api.pipelineScheduleCardHtml = pipelineScheduleCardHtml;
  api.injectPipelineSchedule = injectPipelineSchedule;
  api.schedulePanelHtml = schedulePanelHtml;
  api.openScheduleModal = openScheduleModal;
  api.injectScheduleButtons = injectScheduleButtons;
  api.injectSchedulePanel = injectSchedulePanel;
  api.refreshApplicants = refreshApplicants;
  api.openRolesHtml = openRolesHtml;
  api.reapplicantsHtml = reapplicantsHtml;
  api.metricsHtml = metricsHtml;
  api.reapplicantGroups = reapplicantGroups;
  api.reapplicantCount = reapplicantCount;
  api.reapplicantBadgeHtml = reapplicantBadgeHtml;
  api.reapplicantEditorNoteHtml = reapplicantEditorNoteHtml;
  api.metricsReport = metricsReport;
  api.positionMetrics = positionMetrics;
  api.manpowerRequestOf = manpowerRequestOf;
  api.normalizeManpowerRequest = normalizeManpowerRequest;
  api.saveManpowerRequest = saveManpowerRequest;
  api.saveOpenedOn = saveOpenedOn;
  api.daysBetween = daysBetween;
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
