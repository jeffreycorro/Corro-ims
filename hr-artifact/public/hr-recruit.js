/**
 * Recruitment helpers for the CorConDev HR artifact.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * Adds Pipeline "Bulk import JSON", "Consolidate duplicates", a
 * role filter, a live search bar, applicant exam-score rows, and a
 * "View 201 / application file" action on the applicant editor.
 */
(function (root) {
  "use strict";

  if (root.hrRecruit && root.hrRecruit.version === "1.6.0") return;

  var api = {
    version: "1.6.0",
    attached: false,
    openAppId: "",
    roleFilter: "",
    pipelineSearch: "",
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

  function store() {
    return root.S || null;
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
        "<b>Overwrite by stable id only</b> — this does not create new Pipeline rows. Unknown ids are skipped. " +
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
        "Same person (normalized name, or the same email) updates the existing row unless you send " +
        '<span class="mono">forceNew: true</span>. An extractor export (asOf / Drive folder / all rows have id) ' +
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
    return q.split(/\s+/).every(function (word) {
      return hay.indexOf(word) >= 0;
    });
  }

  function applicantMatchesPipeline(a, filter, query, roles) {
    return applicantMatchesRole(a, filter, roles) && applicantMatchesSearch(a, query, roles);
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
      var active = !!filter || !!String(query).trim();
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
        if (opts && isApplicantEditorModal(opts)) injectStaffNotesPanel();
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
        } catch (e) {}
      }
      return orig.apply(this, arguments);
    };
    root.put.__hrRecruitDocs = true;
  }

  function injectChrome() {
    try {
      wrapOpenModal();
      wrapAppEditor();
      wrapPut();
      injectButton();
      injectConsolidateButton();
      injectSearch();
      injectRoleFilter();
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
  api.searchHaystack = searchHaystack;
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
