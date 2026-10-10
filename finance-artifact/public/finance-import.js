(function () {
  "use strict";

  var CHUNK = 1500000;
  var KINDS = [
    ["petty", "CCD-03 Petty Cash"],
    ["checks", "CCD-04 Check Monitoring"],
    ["gcash", "GCash monitoring"],
    ["bills", "Bill Paying Checklist"],
  ];

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function peso(value) {
    if (value == null || value === "") return "—";
    var n = Math.round((Number(value) || 0) * 100) / 100;
    var neg = n < 0;
    var parts = Math.abs(n).toFixed(2).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-₱" : "₱") + parts.join(".");
  }

  function isAdmin(S) {
    return !!(S.me && String(S.me.role || "").toLowerCase() === "admin");
  }

  function owns(view) {
    return view === "imports";
  }

  function sheetApi(op, body) {
    return fetch("/.netlify/functions/sheet-import", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(Object.assign({ op: op }, body || {})),
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = {};
        if (text) {
          try { json = JSON.parse(text); } catch (e) { json = { error: text }; }
        }
        if (!res.ok) {
          var err = new Error(json.error || "Request failed");
          err.code = json.code;
          throw err;
        }
        return json;
      });
    });
  }

  function bag(S) {
    if (!S.sheetImport) S.sheetImport = { job: null, names: {}, busy: "", year: 2026 };
    return S.sheetImport;
  }

  function kindLabel(kind) {
    for (var i = 0; i < KINDS.length; i += 1) if (KINDS[i][0] === kind) return KINDS[i][1];
    return kind;
  }

  function fileLine(job, names) {
    var files = (job && job.files) || [];
    if (!files.length) return "<p class=\"sub\">No workbook staged yet. Any subset of the four exports is enough.</p>";
    return "<ul>" + files.map(function (file) {
      var name = names && names[file.kind];
      return "<li>" + esc(kindLabel(file.kind)) + (name ? " · " + esc(name) : "") + " · " + file.received + " of " + file.total + " part" + (file.total === 1 ? "" : "s") + (file.ready ? " staged" : " uploading") + "</li>";
    }).join("") + "</ul>";
  }

  function checkLine(label, row, detail) {
    if (!row) return "";
    if (!row.included) return "<p>" + esc(label) + ": not in this upload. Target " + esc(detail) + ".</p>";
    var pill = row.matches ? "ok" : "bad";
    var word = row.matches ? "Matches" : row.missing ? "Missing" : "Does not match";
    return "<p><span class=\"pill " + pill + "\">" + word + "</span> " + esc(label) + " " + esc(detail) + ".</p>";
  }

  function reconBlock(report) {
    var rec = report && report.reconciliation;
    if (!rec) return "";
    var pcb = rec.pcb35 || {};
    var gcash = rec.gcash || {};
    var sept = rec.sept2026 || {};
    var pcbDetail = pcb.included && !pcb.missing
      ? peso(pcb.cashOnHand) + " cash on hand (target " + peso(pcb.targetCash) + "), " + peso(pcb.openReleases) + " open releases (target " + peso(pcb.targetOpen) + ")"
      : peso(pcb.targetCash) + " cash on hand, " + peso(pcb.targetOpen) + " open releases";
    var gcashDetail = gcash.included && !gcash.missing
      ? peso(gcash.balance) + " (target " + peso(gcash.target) + ")"
      : peso(gcash.target);
    var septDetail = sept.included
      ? peso(sept.total) + " (target " + peso(sept.target) + ")"
      : peso(sept.target);
    return (
      "<h2>Reconciliation</h2>" +
      checkLine("PCB 35", pcb, pcbDetail) +
      checkLine("GCash balance", gcash, gcashDetail) +
      checkLine("September 2026 checks", sept, septDetail)
    );
  }

  function countsBlock(report) {
    var rows = (report && report.counts) || [];
    if (!rows.length) return "<p class=\"sub\">No rows in this upload.</p>";
    return "<div class=\"scroll\"><table><thead><tr><th>Table</th><th class=\"num\">Rows</th><th class=\"num\">New</th><th class=\"num\">Already there</th></tr></thead><tbody>" +
      rows.map(function (row) {
        return "<tr><td>" + esc(row.label || row.table) + "</td><td class=\"num\">" + esc(row.rows) + "</td><td class=\"num\">" + esc(row.create) + "</td><td class=\"num\">" + esc(row.update) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function issuesBlock(report) {
    var rows = (report && report.issues) || [];
    var count = report && report.issueCount != null ? report.issueCount : rows.length;
    if (!count) return "<p class=\"sub\">No import issues.</p>";
    return "<p class=\"sub\">" + count + " issue" + (count === 1 ? "" : "s") + (report.issuesTruncated ? ". The first 100 are on screen." : "") + "</p>" +
      "<div class=\"scroll\"><table><thead><tr><th>Source</th><th>Row</th><th>Field</th><th>Raw</th><th>Message</th></tr></thead><tbody>" +
      rows.map(function (row) {
        return "<tr><td>" + esc(row.source) + "</td><td>" + esc(row.row_no) + "</td><td>" + esc(row.field) + "</td><td>" + esc(row.raw) + "</td><td>" + esc(row.message) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function progressBlock(job) {
    if (!job || (job.status !== "running" && job.status !== "done" && job.status !== "failed")) return "";
    var total = Number(job.total) || 0;
    var cursor = Number(job.cursor) || 0;
    var width = total ? Math.max(0, Math.min(100, Math.round((cursor / total) * 100))) : job.status === "done" ? 100 : 0;
    var label = job.status === "done" ? "Import finished" : job.status === "failed" ? "Import stopped" : "Writing " + (job.phase || "rows");
    return "<h2>Progress</h2><p>" + esc(label) + " · " + cursor + " of " + total + " rows</p>" +
      "<div class=\"import-bar\"><span style=\"width:" + width + "%\"></span></div>" +
      (job.error ? "<p class=\"err\">" + esc(job.error) + "</p>" : "") +
      (job.status === "failed" ? '<button class="btn" type="button" data-import-resume>Resume</button>' : "");
  }

  function render(S) {
    var title = document.getElementById("title");
    var crumb = document.getElementById("crumb");
    if (title) title.textContent = "Import from Google Sheets";
    if (crumb) crumb.textContent = "Load CCD-03, CCD-04, GCash, and the bill checklist. Dry run writes nothing.";
    if (!isAdmin(S)) return "<div class=\"card\"><p>Only an administrator can import the Google Sheets.</p></div>";
    var state = bag(S);
    var job = state.job;
    var status = job && job.status;
    var report = job && job.report;
    return (
      '<section class="card">' +
      "<p>Upload the four exports, or any subset. Files go to the private uploads bucket in parts, then a dry run counts each table, checks PCB 35, the GCash balance, and the September 2026 check total, and lists import issues. Import updates rows that are already there.</p>" +
      '<div class="fields">' +
      KINDS.map(function (item) {
        return '<label>' + esc(item[1]) + '<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-import-file="' + item[0] + '"></label>';
      }).join("") +
      '<label>Year for month columns<input data-import-year inputmode="numeric" value="' + esc(state.year || (job && job.sheet_year) || 2026) + '"></label>' +
      "</div>" +
      fileLine(job, state.names) +
      (state.busy ? "<p class=\"sub\">" + esc(state.busy) + "</p>" : "") +
      '<div class="row"><button class="btn" type="button" data-import-dry' + (status === "running" ? " disabled" : "") + '>Dry run</button>' +
      '<button class="btn pri" type="button" data-import-go' + (status === "ready" ? "" : " disabled") + '>Import</button>' +
      '<button class="btn" type="button" data-import-csv' + (report && report.issueCount ? "" : " disabled") + '>Download issues CSV</button>' +
      '<button class="btn" type="button" data-import-new>New import</button></div>' +
      (status ? '<p><span class="pill ' + (status === "done" ? "ok" : status === "failed" ? "bad" : "warn") + '">' + esc(status) + "</span></p>" : "") +
      "</section>" +
      (report && (status === "ready" || status === "running" || status === "done" || status === "failed")
        ? '<section class="card"><h2>Counts</h2>' + countsBlock(report) + reconBlock(report) + "<h2>Import issues</h2>" + issuesBlock(report) + "</section>"
        : "") +
      progressBlock(job)
    );
  }

  function load(S) {
    if (!isAdmin(S)) return Promise.resolve();
    var state = bag(S);
    if (state.busy) return Promise.resolve();
    var body = state.job && state.job.id ? { jobId: state.job.id } : {};
    return sheetApi("importStatus", body).then(function (res) {
      if (res.job) state.job = res.job;
    });
  }

  function readSlice(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Could not read that file.")); };
      reader.readAsDataURL(blob);
    });
  }

  function ensureJob(S) {
    var state = bag(S);
    if (state.job && state.job.id && state.job.status !== "running" && state.job.status !== "done") return Promise.resolve(state.job);
    var year = yearOf();
    state.year = year;
    return sheetApi("importStart", { year: year }).then(function (res) {
      state.job = res.job;
      state.names = {};
      return res.job;
    });
  }

  function yearOf() {
    var input = document.querySelector("[data-import-year]");
    var year = Number(input && input.value);
    if (!year || year < 2000 || year > 2100) return 2026;
    return year;
  }

  function stageFile(S, kind, file) {
    var state = bag(S);
    var total = Math.max(1, Math.ceil(file.size / CHUNK));
    var index = 0;
    function next() {
      if (index >= total) return Promise.resolve();
      var slice = file.slice(index * CHUNK, Math.min(file.size, (index + 1) * CHUNK));
      var part = index;
      index += 1;
      state.busy = "Uploading " + kindLabel(kind) + " · part " + (part + 1) + " of " + total;
      if (window.FinanceImport && window.FinanceImport._ctx) window.FinanceImport._ctx.render();
      return readSlice(slice).then(function (url) {
        var comma = url.indexOf(",");
        return sheetApi("importStage", {
          jobId: state.job.id,
          kind: kind,
          index: part,
          total: total,
          dataBase64: comma >= 0 ? url.slice(comma + 1) : url,
        });
      }).then(function () { return next(); });
    }
    return ensureJob(S).then(function () {
      state.names[kind] = file.name;
      return next();
    }).then(function () {
      state.busy = "";
      return sheetApi("importStatus", { jobId: state.job.id });
    }).then(function (res) {
      state.job = res.job;
    });
  }

  function remember(host, job) {
    bag(host.S).job = job;
    bag(host.S).busy = "";
    host.render();
  }

  function fail(host, err) {
    var state = bag(host.S);
    state.busy = "";
    host.S.error = err.message || "Import failed.";
    if (state.job) state.job.error = host.S.error;
    host.render();
  }

  var pumping = false;

  function pump(host) {
    var state = bag(host.S);
    var job = state.job;
    if (!job || job.status !== "running" || pumping) return;
    pumping = true;
    sheetApi("importTick", { jobId: job.id }).then(function (res) {
      state.job = res.job;
      host.render();
      pumping = false;
      if (res.job && res.job.status === "running") setTimeout(function () { pump(host); }, 250);
    }).catch(function (err) {
      pumping = false;
      fail(host, err);
    });
  }

  function kickBackground(jobId) {
    try {
      fetch("/.netlify/functions/sheet-import-background", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "run", jobId: jobId }),
      }).catch(function () {});
    } catch (err) {}
  }

  function onClick(event, host) {
    var node = event.target && event.target.closest && event.target.closest("[data-import-dry], [data-import-go], [data-import-csv], [data-import-new], [data-import-resume]");
    if (!node || !host || !isAdmin(host.S)) return false;
    var state = bag(host.S);
    if (node.hasAttribute("data-import-new")) {
      state.job = null;
      state.names = {};
      state.busy = "";
      host.S.error = "";
      host.render();
      return true;
    }
    if (node.hasAttribute("data-import-csv")) {
      if (!state.job) return true;
      sheetApi("importIssuesCsv", { jobId: state.job.id }).then(function (res) {
        var blob = new Blob([res.csv || ""], { type: "text/csv" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = res.filename || "import-issues.csv";
        link.click();
      }).catch(function (err) { fail(host, err); });
      return true;
    }
    if (node.hasAttribute("data-import-dry")) {
      state.busy = "Dry run…";
      state.year = yearOf();
      host.render();
      ensureJob(host.S).then(function (job) {
        return sheetApi("importDryRun", { jobId: job.id, year: state.year });
      }).then(function (res) { remember(host, res.job); }).catch(function (err) { fail(host, err); });
      return true;
    }
    if (node.hasAttribute("data-import-go") || node.hasAttribute("data-import-resume")) {
      if (!state.job) return true;
      state.busy = "Importing…";
      host.render();
      var call = node.hasAttribute("data-import-resume")
        ? sheetApi("importTick", { jobId: state.job.id })
        : sheetApi("importCommit", { jobId: state.job.id });
      call.then(function (res) {
        remember(host, res.job);
        if (res.job && res.job.status === "running") {
          kickBackground(res.job.id);
          pump(host);
        }
      }).catch(function (err) { fail(host, err); });
      return true;
    }
    return false;
  }

  document.addEventListener("change", function (event) {
    var input = event.target;
    if (!input || !input.getAttribute) return;
    var kind = input.getAttribute("data-import-file");
    var year = input.getAttribute("data-import-year");
    var host = window.FinanceImport && window.FinanceImport._ctx;
    if (!kind || !host || !input.files || !input.files[0]) {
      if (year != null && host) bag(host.S).year = yearOf();
      return;
    }
    stageFile(host.S, kind, input.files[0]).then(function () { host.render(); }).catch(function (err) { fail(host, err); });
  });

  window.FinanceImport = {
    isAdmin: isAdmin,
    load: load,
    onClick: onClick,
    owns: owns,
    render: render,
  };
})();
