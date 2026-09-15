/**
 * Recruitment helpers for the CorConDev HR artifact.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * Adds Pipeline "Bulk import JSON", "Consolidate duplicates", a
 * role filter, a live search bar, and a "View 201 / application file"
 * action on the applicant editor.
 */
(function (root) {
  "use strict";

  if (root.hrRecruit && root.hrRecruit.version === "1.5.0") return;

  var api = {
    version: "1.5.0",
    attached: false,
    openAppId: "",
    roleFilter: "",
    pipelineSearch: "",
    draftStaffNotes: [],
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
        "Same person (normalized name, or the same email) updates the existing row unless you send " +
        "<span class=\"mono\">forceNew: true</span>.</div>" +
        '<div class="f"><label>JSON</label><textarea id="hr-recruit-json" style="min-height:220px" ' +
        'placeholder="{ &quot;applicants&quot;: [ { &quot;name&quot;: &quot;Dela Cruz, Juan&quot;, &quot;roleId&quot;: &quot;ro02&quot;, &quot;source&quot;: &quot;GoDaddy&quot; } ] }"></textarea></div>' +
        '<div class="lbl" id="hr-recruit-status"></div>' +
        "</div>",
      foot: '<button class="btn pri" id="hr-recruit-import" type="button">Import</button>',
    });
    bindImport();
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
    var btn =
      '<button class="btn" id="hr-recruit-file" type="button">View 201 / application file</button>';
    if (hired) {
      btn +=
        '<button class="btn" id="hr-recruit-open-201-inline" type="button">Open 201 file</button>';
    }
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

  function applicationFiles(a) {
    var d = dedupe();
    if (typeof d.collectApplicationFiles === "function") return d.collectApplicationFiles(a);
    if (typeof d.extraLinks === "function") return d.extraLinks(a);
    var out = [];
    if (a && a.resumeLink) out.push({ url: a.resumeLink, title: "CV / application", note: "resumeLink" });
    return out;
  }

  function applicationFileHtml(a) {
    var d = dedupe();
    var docs = typeof d.seedApplicantDocs === "function" ? d.seedApplicantDocs(a) : (a.docs || {});
    var items = recruitmentDocList();
    var files = applicationFiles(Object.assign({}, a, { docs: docs }));
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
        ? 'They already have a 201: use <b>Open 201 file</b> after the application PDF is linked here.'
        : "Hire still creates the employee 201. The extractor / Drive link is the file — it is not re-uploaded.") +
      "</div>";
    h +=
      '<div class="sect-h" style="margin:6px 0 0"><h2 style="font-size:12.5px">Application files</h2><span class="rule"></span></div>';
    if (files.length) {
      h += '<div class="chklist">';
      files.forEach(function (x, i) {
        h +=
          '<div class="chk"><span class="idx">' +
          String(i + 1).padStart(2, "0") +
          '</span><span class="n"><b>' +
          esc(x.title || "Application file") +
          '</b><span class="lbl">' +
          esc(x.note || (x.kind === "folder" ? "Drive folder" : "Drive / CV link")) +
          "</span></span>" +
          '<a class="btn sm pri" href="' +
          esc(x.url) +
          '" target="_blank" rel="noopener noreferrer">Open</a></div>';
      });
      h += "</div>";
    } else {
      h +=
        '<div class="note" style="border-left-color:var(--warn)"><b>No application PDF is linked yet.</b> ' +
        "If GoDaddy / Drive already holds the file, use <b>Find files in Drive</b> — the portal matches the " +
        "applicant name onto the Recruitment folder and does not copy the binary into this database.</div>";
    }
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
    h +=
      '<div class="note">TOR, certificates and the data sheet stay <b>Missing</b> until those papers exist. ' +
      "The application PDF belongs on <b>Resume / Biodata</b>.</div>";
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

  function recruitmentFolderId() {
    var list = root.GENERAL_FOLDERS || [];
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (list[i] && (list[i].k === "g08" || /recruit/i.test(list[i].n || ""))) return list[i].id;
    }
    return "1zGWUEFDsHyqYE1lOK6xNyQvGh2BW0a9j";
  }

  function escapeDriveQuery(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  async function getDriveMcp() {
    if (typeof root.getMcp === "function") {
      try {
        return await root.getMcp();
      } catch (e) {
        return null;
      }
    }
    if (root.claude && typeof root.claude.use === "function") {
      try {
        return await root.claude.use("mcp");
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function driveFilesFromResult(res) {
    if (typeof root.payloadFiles === "function") return root.payloadFiles(res) || [];
    var p = (res && res.payload) || {};
    return p.files || p.items || [];
  }

  function asDriveAttachment(f, note) {
    if (!f) return null;
    var id = f.id || "";
    var url = f.viewUrl || f.webViewLink || (id ? "https://drive.google.com/file/d/" + id + "/view" : "");
    if (!url) return null;
    return {
      title: f.title || f.name || "Application file",
      url: url,
      id: id,
      mimeType: f.mimeType || "",
      note: note || "matched in Drive by name",
    };
  }

  async function searchDriveQuery(mcp, query) {
    if (!mcp || typeof mcp.callTool !== "function") return [];
    try {
      var res = await mcp.callTool("Google Drive", "search_files", {
        query: query,
        pageSize: 50,
        excludeContentSnippets: true,
      });
      return driveFilesFromResult(res);
    } catch (e) {
      return [];
    }
  }

  async function listDriveFolderFiles(mcp, folderId, note) {
    if (!folderId) return [];
    var kids = await searchDriveQuery(mcp, "parentId = '" + escapeDriveQuery(folderId) + "'");
    return kids
      .filter(function (f) {
        return f && f.mimeType !== "application/vnd.google-apps.folder";
      })
      .map(function (f) {
        return asDriveAttachment(f, note || "from application folder");
      })
      .filter(Boolean);
  }

  async function findApplicantDriveFiles(a) {
    var d = dedupe();
    var matches = typeof d.fileMatchesApplicant === "function" ? d.fileMatchesApplicant : null;
    var last = typeof d.lastNameToken === "function" ? d.lastNameToken(a && a.name) : "";
    var mcp = await getDriveMcp();
    if (!mcp) return { files: [], reason: "drive-unavailable" };
    var seen = Object.create(null);
    var out = [];
    function take(file, note) {
      var att = asDriveAttachment(file, note);
      if (!att || seen[att.url] || seen[att.id]) return;
      var title = att.title;
      if (matches && a && a.name && !matches(title, a.name)) return;
      seen[att.url] = true;
      if (att.id) seen[att.id] = true;
      out.push(att);
    }
    var folderRefs = applicationFiles(a).filter(function (f) {
      return f && (f.kind === "folder" || /\/folders\//.test(f.url || ""));
    });
    var i;
    for (i = 0; i < folderRefs.length; i += 1) {
      var parsed = typeof d.parseDriveRef === "function" ? d.parseDriveRef(folderRefs[i].url) : null;
      var fid = (parsed && parsed.id) || folderRefs[i].id;
      var fromFolder = await listDriveFolderFiles(mcp, fid, "from linked application folder");
      fromFolder.forEach(function (f) {
        take(f, f.note);
      });
    }
    if (last) {
      var q = "title contains '" + escapeDriveQuery(last) + "' and mimeType != 'application/vnd.google-apps.folder'";
      var hits = await searchDriveQuery(mcp, q);
      hits.forEach(function (f) {
        take(f, "matched in Drive by name");
      });
      var rec = recruitmentFolderId();
      if (rec) {
        var scoped = await searchDriveQuery(
          mcp,
          "parentId = '" + rec + "' and title contains '" + escapeDriveQuery(last) + "'"
        );
        scoped.forEach(function (f) {
          if (f && f.mimeType === "application/vnd.google-apps.folder") {
            return;
          }
          take(f, "Recruitment folder");
        });
      }
    }
    return { files: out, reason: out.length ? "ok" : "none" };
  }

  function persistSeededDocs(a) {
    var d = dedupe();
    if (!a || typeof d.seedApplicantDocs !== "function") return a;
    var seeded = d.seedApplicantDocs(a);
    var before = JSON.stringify(a.docs || {});
    var after = JSON.stringify(seeded || {});
    a.docs = seeded;
    a._docsDirty = before !== after;
    return a;
  }

  async function prepareApplicationFiles(a, opts) {
    opts = opts || {};
    if (!a) return { a: a, found: 0 };
    var d = dedupe();
    persistSeededDocs(a);
    var have = applicationFiles(a).filter(function (f) {
      return f && f.kind !== "folder";
    });
    var found = [];
    if (opts.forceDrive || !have.length) {
      var result = await findApplicantDriveFiles(a);
      found = (result && result.files) || [];
      if (found.length && typeof d.attachFilesToApplicant === "function") {
        d.attachFilesToApplicant(a, found, { today: today(), note: "Drive match" });
      } else {
        persistSeededDocs(a);
      }
    }
    if (a._docsDirty || found.length) {
      delete a._docsDirty;
      await persistApplicant(a);
    }
    if (a.hiredEmpId) {
      var S = store();
      var emp = S && S.employees ? S.employees[a.hiredEmpId] : null;
      if (emp) {
        emp.applicantId = emp.applicantId || a.id;
        carryApplicantDocs(emp);
        if (typeof root.put === "function") await root.put("employees", emp.id, emp);
      }
    }
    return { a: a, found: found.length };
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
      open201.onclick = async function () {
        await prepareApplicationFiles(a, {});
        if (!openHired201(a)) toast("The 201 record is not on file yet.", "err");
      };
    }
    var save = $("#hr-recruit-file-save");
    if (save) {
      save.onclick = async function () {
        readFileEdits(a);
        persistSeededDocs(a);
        await persistApplicant(a);
        toast("Application file saved.", "ok");
        if (typeof root.appEditor === "function") root.appEditor(a.id);
      };
    }
    var find = $("#hr-recruit-drive-find");
    if (find) {
      find.onclick = async function () {
        var st = $("#hr-recruit-file-status");
        if (st) st.textContent = "Searching Drive…";
        find.disabled = true;
        try {
          var result = await prepareApplicationFiles(a, { forceDrive: true });
          if (result.found) toast("Linked " + result.found + " Drive file(s).", "ok");
          else toast("No Drive file matched this name.", "err");
          openApplicationFile(a.id, { skipPrepare: true });
        } finally {
          find.disabled = false;
        }
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
        if (!a.resumeLink) a.resumeLink = url;
        persistSeededDocs(a);
        await persistApplicant(a);
        openApplicationFile(a.id, { skipPrepare: true });
      };
    }
  }

  async function openApplicationFile(appId, opts) {
    opts = opts || {};
    var a = findApplicant(appId);
    if (!a) {
      toast("Save the applicant first, then open the application file.", "err");
      return;
    }
    if (typeof root.openModal !== "function") {
      toast("The application file is not available in this view.", "err");
      return;
    }
    if (!opts.skipPrepare) {
      var st = $("#hr-recruit-file-status");
      if (st) st.textContent = "Looking for the application file…";
      await prepareApplicationFiles(a, {});
      a = findApplicant(appId) || a;
    }
    var hired = a.hiredEmpId && store() && store().employees && store().employees[a.hiredEmpId];
    root.openModal({
      title: "Application file — " + (a.name || ""),
      wide: true,
      body: applicationFileHtml(a),
      foot:
        '<button class="btn" id="hr-recruit-file-back" type="button">Back to applicant</button>' +
        '<button class="btn" id="hr-recruit-drive-find" type="button">Find files in Drive</button>' +
        (hired
          ? '<button class="btn" id="hr-recruit-file-save" type="button">Save attachments</button>' +
            '<button class="btn pri" id="hr-recruit-open-201" type="button">Open 201 file</button>'
          : '<button class="btn pri" id="hr-recruit-file-save" type="button">Save attachments</button>'),
    });
    bindFileView(a);
  }

  function bindApplicantFileButton() {
    var btn = $("#hr-recruit-file");
    if (btn && btn.getAttribute("data-bound") !== "1") {
      btn.setAttribute("data-bound", "1");
      btn.onclick = async function () {
        var a = applicantFromEditor();
        if (!a) {
          toast("Save the applicant first, then open the application file.", "err");
          return;
        }
        var grabName = $("#a-name");
        var grabCv = $("#a-cv");
        if (grabName && grabName.value) a.name = grabName.value.trim();
        if (grabCv && grabCv.value) a.resumeLink = grabCv.value.trim();
        await openApplicationFile(a.id);
      };
    }
    var open201 = $("#hr-recruit-open-201-inline");
    if (open201 && open201.getAttribute("data-bound") !== "1") {
      open201.setAttribute("data-bound", "1");
      open201.onclick = async function () {
        var a = applicantFromEditor();
        if (!a) {
          toast("Save the applicant first, then open the application file.", "err");
          return;
        }
        await prepareApplicationFiles(a, {});
        if (!openHired201(a)) toast("The 201 record is not on file yet.", "err");
      };
    }
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
  api.applicationFiles = applicationFiles;
  api.findApplicantDriveFiles = findApplicantDriveFiles;
  api.prepareApplicationFiles = prepareApplicationFiles;
  api.duplicateGroups = duplicateGroups;
  api.mergeGroup = mergeGroup;
  api.carryApplicantDocs = carryApplicantDocs;
  api.staffNotesHtml = staffNotesHtml;
  api.appendStaffNote = appendStaffNote;
  api.mergeStaffNotes = mergeStaffNotes;
  api.normalizeStaffNote = normalizeStaffNote;
  api.injectStaffNotesPanel = injectStaffNotesPanel;
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
