/* Corcondev Motorpool Portal — yard + office SPA */
(function () {
  "use strict";

  var R = window.MotorpoolRules;
  var WT = window.MotorpoolWorktypes;
  var SEED = window.MotorpoolSeed;
  var MDB = window.MotorpoolDB;

  var store = MDB.createStore();
  var remoteDb = null;
  var state = {
    view: "board",
    zone: "yard",
    unitId: "",
    lens: "",
    filters: {},
    officeUnlocked: false,
    newActivity: false,
    lastFp: "",
    railOpen: true,
    drafts: {},
    confirm: null,
    typeahead: "",
  };
  var navStack = [];

  var VIEW_META = {
    board: { zone: "yard", title: "Yard board", back: "Yard board" },
    ask: { zone: "yard", title: "Ask the log", back: "Ask the log" },
    reminders: { zone: "yard", title: "Reminders", back: "Reminders" },
    reserves: { zone: "yard", title: "Reserves", back: "Reserves" },
    vrf: { zone: "yard", title: "New VRF", back: "New VRF" },
    "fuel-reserve": { zone: "yard", title: "Fuel reserve", back: "Fuel reserve" },
    workshop: { zone: "yard", title: "Workshop", back: "Workshop" },
    tasks: { zone: "yard", title: "Tasks", back: "Tasks" },
    store: { zone: "yard", title: "Store", back: "Store" },
    "vrf-log": { zone: "yard", title: "VRF log", back: "VRF log" },
    history: { zone: "yard", title: "History", back: "History" },
    fleet: { zone: "yard", title: "Fleet", back: "Fleet" },
    "yard-fuel": { zone: "yard", title: "Yard fuel", back: "Yard fuel" },
    approvals: { zone: "office", title: "Approvals", back: "Approvals" },
    spend: { zone: "office", title: "Spend", back: "Spend" },
    "fuel-econ": { zone: "office", title: "Fuel economics", back: "Fuel economics" },
    consumption: { zone: "office", title: "Consumption", back: "Consumption" },
    inventory: { zone: "office", title: "Inventory", back: "Inventory" },
    maint: { zone: "office", title: "Maintenance plan", back: "Maintenance plan" },
    health: { zone: "office", title: "Data health", back: "Data health" },
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uid(prefix) {
    return (prefix || "id") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function manilaDate(d) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d || new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function manilaYear() {
    return Number(manilaDate().slice(0, 4));
  }

  function manilaIso() {
    var p = manilaDate();
    var t = new Date();
    var hh = String(t.getHours()).padStart(2, "0");
    var mm = String(t.getMinutes()).padStart(2, "0");
    return p + "T" + hh + ":" + mm + "+08:00";
  }

  function cfg() {
    return store.getThawed("config/app") || R.defaultConfig();
  }

  function writeConfig(next) {
    var full = Object.assign(R.defaultConfig(), cfg(), next || {});
    store.set("config/app", full);
    syncRemote("config/app", full);
    return full;
  }

  function units() {
    var doc = store.get("master/units");
    return (doc && doc.units) || [];
  }

  function unitById(id) {
    return units().filter(function (u) {
      return u.id === id;
    })[0];
  }

  function worktypes() {
    var doc = store.get("master/worktypes");
    return (doc && doc.types) || WT.TYPES;
  }

  function families() {
    var doc = store.get("master/worktypes");
    return (doc && doc.families) || WT.FAMILIES;
  }

  function projects() {
    var doc = store.get("master/projects");
    return (doc && doc.projects) || [];
  }

  function suppliers() {
    var doc = store.get("master/suppliers");
    return (doc && doc.suppliers) || [];
  }

  function reserves() {
    return store.listCollection("reserves").map(function (r) {
      return Object.assign({ id: r.id, path: r.path }, R.thaw(r.data));
    });
  }

  function jos() {
    return store.listCollection("ops").filter(function (r) {
      return r.id.indexOf("jo-") === 0 || (r.data && r.data.docType === "jo");
    }).map(function (r) {
      return Object.assign({ id: r.id, path: r.path }, R.thaw(r.data));
    });
  }

  function tasks() {
    return store.listCollection("ops").filter(function (r) {
      return r.id.indexOf("task-") === 0 || (r.data && r.data.docType === "task");
    }).map(function (r) {
      return Object.assign({ id: r.id, path: r.path }, R.thaw(r.data));
    });
  }

  function reminderList() {
    return store.listCollection("ops").filter(function (r) {
      return r.id.indexOf("reminder-") === 0;
    }).map(function (r) {
      return Object.assign({ id: r.id, path: r.path }, R.thaw(r.data));
    });
  }

  function activities() {
    return store.listCollection("ops").filter(function (r) {
      return r.id.indexOf("activity-") === 0;
    }).map(function (r) {
      return Object.assign({ id: r.id, path: r.path }, R.thaw(r.data));
    }).sort(function (a, b) {
      return String(b.at || "").localeCompare(String(a.at || ""));
    });
  }

  function fuels() {
    return store.listCollection("fuel").map(function (r) {
      return Object.assign({ id: r.id, path: r.path }, R.thaw(r.data));
    });
  }

  function storeMoves() {
    return store.listCollection("ops").filter(function (r) {
      return r.id.indexOf("store-") === 0;
    }).map(function (r) {
      return Object.assign({ id: r.id, path: r.path }, R.thaw(r.data));
    });
  }

  function logActivity(action, path, note) {
    var id = uid("activity");
    var row = { docType: "activity", at: manilaIso(), action: action, path: path, note: note || "" };
    store.set("ops/" + id, row);
    syncRemote("ops/" + id, row);
  }

  function syncRemote(path, data) {
    if (!remoteDb) return;
    remoteDb.doc(path).set(data).catch(function () {});
  }

  function snapshot() {
    return {
      view: state.view,
      unitId: state.unitId,
      lens: state.lens,
      filters: Object.assign({}, state.filters),
      scroll: window.scrollY || 0,
      title: (VIEW_META[state.view] || {}).back || state.view,
    };
  }

  function go(view, opts, flags) {
    opts = opts || {};
    flags = flags || {};
    if (VIEW_META[view] && VIEW_META[view].zone === "office" && !state.officeUnlocked) {
      state.view = "office-gate";
      state.zone = "office";
      state.pendingOffice = view;
      paint();
      return;
    }
    if (!flags.silent && !flags.replace && !flags.refresh) {
      navStack.push(snapshot());
    }
    if (flags.replace) navStack = [];
    state.view = view;
    state.zone = (VIEW_META[view] && VIEW_META[view].zone) || "yard";
    if (opts.unitId !== undefined) state.unitId = opts.unitId;
    if (opts.lens !== undefined) state.lens = opts.lens;
    if (opts.filters) state.filters = Object.assign({}, opts.filters);
    if (opts.id !== undefined) state.filters.id = opts.id;
    state.confirm = null;
    paint();
    if (opts.scroll != null) window.scrollTo(0, opts.scroll);
    else window.scrollTo(0, 0);
  }

  function back() {
    var prev = navStack.pop();
    if (!prev) {
      go("board", {}, { replace: true });
      return;
    }
    state.view = prev.view;
    state.zone = (VIEW_META[prev.view] && VIEW_META[prev.view].zone) || "yard";
    state.unitId = prev.unitId;
    state.lens = prev.lens;
    state.filters = prev.filters || {};
    paint();
    window.scrollTo(0, prev.scroll || 0);
  }

  function refreshView() {
    state.newActivity = false;
    state.lastFp = store.fingerprint();
    paint();
  }

  function peso(n) {
    var v = Number(n) || 0;
    return "₱" + v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function statusPill(s) {
    var map = {
      Requested: "warn",
      Approved: "ok",
      Rejected: "crit",
      Flagged: "warn",
      Closed: "mut",
      Open: "acc",
      "In progress": "acc",
      "For verification": "warn",
      Reopened: "warn",
      Done: "ok",
    };
    return '<span class="pill ' + (map[s] || "mut") + '">' + esc(s) + "</span>";
  }

  function missingBlock(missing) {
    if (!missing || !missing.length) return "";
    return '<ul class="missing">' + missing.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>";
  }

  function actionBtn(label, action, extra, missing) {
    extra = extra || "";
    var dis = missing && missing.length;
    return (
      '<button class="btn ' + extra + '" data-act="' + esc(action) + '"' +
      (dis ? " disabled" : "") + ">" + esc(label) + "</button>" +
      (dis ? missingBlock(missing) : "")
    );
  }

  function unitLabel(u) {
    if (!u) return "";
    return (u.code || u.id) + " · " + (u.name || "") + (u.plate ? " · " + u.plate : "");
  }

  function unitTypeahead(valueId, inputName) {
    var q = state.typeahead;
    var list = units().filter(function (u) {
      if (u.status === "sold") return true;
      return true;
    });
    if (q) {
      var qq = q.toLowerCase();
      list = list.filter(function (u) {
        return unitLabel(u).toLowerCase().indexOf(qq) !== -1;
      });
    }
    var selected = unitById(valueId);
    var shown = (q !== "" && q !== undefined) ? q : selected ? unitLabel(selected) : "";
    return (
      '<div class="f typeahead"><label>Unit</label>' +
      '<input name="' + inputName + '" autocomplete="off" value="' + esc(shown) + '" data-typeahead="unit" placeholder="Type code, name, or plate">' +
      (q !== "" ? '<div class="dd">' + (list.length ? list.slice(0, 12).map(function (u) {
        return '<button type="button" data-act="pick-unit" data-id="' + esc(u.id) + '">' + esc(unitLabel(u)) + "</button>";
      }).join("") : '<div class="empty">No units match</div>') + "</div>" : "") +
      (selected ? '<div class="hint">' + esc(unitLabel(selected)) + "</div>" : '<div class="hint">' + units().length + " units in master</div>") +
      "</div>"
    );
  }

  function attachInput(kind, current) {
    current = current || [];
    return (
      '<div class="f"><label>Attachments (' + (kind === "photo" ? "photo" : "photo or link") + ")</label>" +
      '<input type="file" accept="image/*" data-photo="' + esc(kind) + '">' +
      '<input name="linkUrl" placeholder="https://… or Drive link">' +
      (current.length ? "<div class=\"hint\">" + current.length + " on file</div>" : "") +
      "</div>"
    );
  }

  async function fileToPhoto(file, ref) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var id = uid("photo");
        var row = { kind: "photo", mime: file.type, dataUrl: reader.result, ref: ref, at: manilaIso() };
        store.set("photos/" + id, row);
        syncRemote("photos/" + id, row);
        resolve(id);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function addLink(url, ref) {
    if (!url) return null;
    var id = uid("link");
    var row = { kind: "link", url: url, ref: ref, at: manilaIso() };
    store.set("photos/" + id, row);
    syncRemote("photos/" + id, row);
    return id;
  }

  function allocateVrfNo() {
    var acquired = false;
    var holder = store.holderId;
    for (var i = 0; i < 8; i++) {
      var lock = store.acquire("ledger/counter", { holder: holder, ttlSeconds: 20 });
      if (lock.acquired) {
        acquired = true;
        break;
      }
    }
    if (!acquired) throw new Error("Could not reserve a VRF number. Try again.");
    var cur = store.getThawed("ledger/counter") || { year: 0, next: 1 };
    var year = manilaYear();
    if (cur.year !== year) {
      cur.year = year;
      cur.next = 1;
    }
    var no = "VRF-" + cur.year + "-" + String(cur.next).padStart(4, "0");
    cur.next += 1;
    store.set("ledger/counter", cur);
    syncRemote("ledger/counter", cur);
    return no;
  }

  function saveReserve(doc) {
    var id = doc.id || uid("rsv");
    doc.id = id;
    doc.updatedAt = manilaIso();
    store.set("reserves/" + id, doc);
    syncRemote("reserves/" + id, doc);
    logActivity("reserve", "reserves/" + id, doc.status + " " + (doc.vrfNo || id));
    return id;
  }

  function vrfPrintHtml(doc, unit) {
    var lines = (doc.lines || []).map(function (ln, i) {
      return "<tr><td>" + (i + 1) + "</td><td>" + esc(ln.description || ln.item || "") +
        "</td><td>" + esc(ln.scope || "") + "</td><td>" + esc(ln.supplier || "") +
        "</td><td>" + esc(ln.litres != null && ln.litres !== "" ? ln.litres + " L" : ln.qty || "") +
        "</td><td>" + esc(doc._office ? peso(R.lineAmount(ln)) : "") + "</td></tr>";
    }).join("");
    var inferred = R.inferJob(doc.lines || [], worktypes());
    var job = doc.jobTypeId ? worktypes().filter(function (t) { return t.id === doc.jobTypeId; })[0] : inferred.workType;
    var jobLabel = job ? job.name + (inferred.inferred && !doc.jobTypeId ? " (inferred)" : "") : "—";
    return "<!doctype html><html><head><meta charset=utf-8><title>" + esc(doc.vrfNo || "VRF") +
      "</title><style>body{font:12pt Times,serif;color:#000;background:#fff;padding:18px}h1{text-align:center;letter-spacing:.04em}table{width:100%;border-collapse:collapse}td,th{border:1px solid #000;padding:4px 6px}.sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:36px}.sign div{border-top:1px solid #000;padding-top:8px;min-height:64px;text-align:center}</style></head><body>" +
      "<h1>VEHICLE REQUEST FORM</h1><p style='text-align:center'>Corro Const. Development and Trade Corp. · Cebu City</p>" +
      "<p><b>" + esc(doc.vrfNo || "DRAFT") + "</b> · " + esc(doc.kind || "job") + " · " + esc(doc.status || "") + "</p>" +
      "<p>Date: " + esc(doc.date || "") + " · Unit: " + esc(unit ? unitLabel(unit) : doc.unitId || "") +
      " · Project: " + esc(doc.project || "") + "</p>" +
      "<p>Money ref: " + esc(doc.moneyRef || "—") + " · Work ref: " + esc(workRefLabel(doc.workRef) || "—") + "</p>" +
      "<p>Type of job: " + esc(jobLabel) + " · Meter: " + esc(doc.meter || "") + " · Requested by: " + esc(doc.requestedBy || "") + "</p>" +
      "<p>Purpose: " + esc(doc.purpose || "") + "</p>" +
      "<table><thead><tr><th>#</th><th>Item</th><th>Scope</th><th>Supplier</th><th>Qty / L</th><th></th></tr></thead><tbody>" +
      (lines || "<tr><td colspan=6>No lines</td></tr>") + "</tbody></table>" +
      "<div class='sign'><div>Requested by<br>" + esc(doc.requestedBy || "") + "</div><div>Approved by<br>" + esc(doc.approvedBy || "") + "</div><div>Received / Liquidated<br>" + esc(doc.closedBy || "") + "</div></div>" +
      "</body></html>";
  }

  function workRefLabel(ref) {
    if (!ref) return "";
    if (typeof ref === "string") return ref;
    var kind = ref.type || ref.kind;
    var id = ref.id || "";
    if (kind === "jo") {
      var jo = jos().filter(function (j) { return j.id === id; })[0];
      return jo ? "JO " + (jo.title || id) : "JO " + id;
    }
    if (kind === "task") {
      var t = tasks().filter(function (j) { return j.id === id; })[0];
      return t ? "Task " + (t.title || id) : "Task " + id;
    }
    return id;
  }

  function moneyRefsForUnit(unitId) {
    return reserves().filter(function (r) {
      return r.status === "Approved" && (!unitId || r.unitId === unitId);
    });
  }

  function workRefsForUnit(unitId) {
    var settings = cfg();
    var allowed = R.workRefStates(settings);
    var list = [];
    jos().forEach(function (j) {
      if (j.state === "Closed") return;
      if (allowed.indexOf(j.state) === -1) return;
      if (!j.unitId || j.kind === "Admin" || j.unitId === unitId) list.push({ type: "jo", id: j.id, title: j.title, state: j.state, admin: j.kind === "Admin" });
    });
    tasks().forEach(function (t) {
      if (t.state === "Done") return;
      if (!t.unitId || t.unitId === unitId) list.push({ type: "task", id: t.id, title: t.title, state: t.state });
    });
    return list;
  }

  function renderBoard() {
    var off = jos().filter(function (j) { return j.offRoad && j.state !== "Closed"; });
    var pend = reserves().filter(function (r) { return r.status === "Requested"; });
    var openT = tasks().filter(function (t) { return t.state !== "Done"; });
    var due = reminderList().filter(function (r) { return !r.done && r.due && r.due <= manilaDate(); });
    var flagged = reserves().filter(function (r) { return r.status === "Flagged"; });
    return (
      '<div class="strip">' +
      tile(off.length, "Off-road", "Open workshop JOs", off.length ? "crit" : "ok") +
      tile(pend.length, "Reserves waiting", "Owner has not approved", pend.length ? "warn" : "ok") +
      tile(openT.length, "Open tasks", "", "acc") +
      tile(due.length, "Reminders due", "", due.length ? "warn" : "ok") +
      tile(flagged.length, "Flagged notices", "Office — over 10%", flagged.length ? "warn" : "mut") +
      "</div>" +
      '<div class="sect-h"><h2>Off-road</h2><div class="rule"></div></div>' +
      (off.length ? table(["Unit", "JO", "Days down", "State"], off.map(function (j) {
        var u = unitById(j.unitId);
        return [u ? u.code : "—", j.title || j.id, j.daysDown || "—", j.state];
      }), function (j) { return "data-act='open-jo' data-id='" + esc(j.id) + "'"; }, off) : '<div class="empty card">No units off-road.</div>') +
      '<div class="sect-h"><h2>Waiting on owner</h2><div class="rule"></div></div>' +
      (pend.length ? table(["Reserve", "Unit", "Kind", "Purpose"], pend.map(function (r) {
        var u = unitById(r.unitId);
        return [r.id, u ? u.code : r.unitId, r.kind, r.purpose || ""];
      })) : '<div class="empty card">No requested reserves.</div>')
    );
  }

  function tile(v, k, sub, cls) {
    return '<div class="tile ' + (cls || "") + '"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + "</div>" +
      (sub ? '<div class="sub">' + esc(sub) + "</div>" : "") + "</div>";
  }

  function table(headers, rows, trAttr, source) {
    var head = headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("");
    var body = rows.length ? rows.map(function (cols, i) {
      var attr = "";
      if (typeof trAttr === "function" && source) attr = " " + trAttr(source[i], i);
      return "<tr" + attr + ">" + cols.map(function (c) { return "<td>" + (String(c).indexOf("<") === 0 ? c : esc(c)) + "</td>"; }).join("") + "</tr>";
    }).join("") : "";
    return '<div class="card tw"><table><thead><tr>' + head + "</tr></thead><tbody>" +
      (body || '<tr><td class="empty" colspan="' + headers.length + '">Nothing here yet.</td></tr>') +
      "</tbody></table></div>";
  }

  function renderAsk() {
    var q = (state.filters.q || "").toLowerCase();
    var rows = [];
    reserves().forEach(function (r) {
      rows.push({ kind: "Reserve", id: r.id, unit: r.unitId, text: (r.purpose || "") + " " + (r.vrfNo || "") + " " + r.status, go: "reserves", status: r.status });
    });
    jos().forEach(function (j) {
      rows.push({ kind: "JO", id: j.id, unit: j.unitId || "admin", text: (j.title || "") + " " + (j.resolution || ""), go: "workshop", status: j.state });
    });
    tasks().forEach(function (t) {
      rows.push({ kind: "Task", id: t.id, unit: t.unitId || "", text: t.title || "", go: "tasks", status: t.state });
    });
    if (q) {
      rows = rows.filter(function (r) {
        return (r.kind + r.id + r.unit + r.text + r.status).toLowerCase().indexOf(q) !== -1;
      });
    }
    return (
      '<div class="card"><div class="card-h"><h3>Search the operational log</h3></div><div class="card-b">' +
      '<div class="f"><label>Find</label><input name="askQ" value="' + esc(state.filters.q || "") + '" placeholder="Unit, VRF, purpose, JO…"></div>' +
      '<p class="hint">Yard search — no peso totals. Hints use real counts: ' + reserves().length + " reserves, " + jos().length + " job orders, " + tasks().length + " tasks.</p>" +
      "</div></div><div class='gap'></div>" +
      table(["Kind", "Id", "Unit", "Status", "Text"], rows.slice(0, 80).map(function (r) {
        return [r.kind, r.id, r.unit || "—", r.status || "", r.text];
      }))
    );
  }

  function renderReminders() {
    var list = reminderList();
    var open = list.filter(function (r) { return !r.done; });
    var done = list.filter(function (r) { return r.done; });
    return (
      '<div class="card"><div class="card-h"><h3>New reminder</h3></div><div class="card-b">' +
      '<div class="grid2">' +
      '<div class="f"><label>Title</label><input name="remTitle"></div>' +
      '<div class="f"><label>Due</label><input type="date" name="remDue"></div>' +
      unitTypeahead(state.unitId, "remUnit") +
      '<div class="f"><label>Note</label><input name="remNote"></div></div>' +
      actionBtn("Add reminder", "add-reminder", "pri", []) +
      "</div></div>" +
      '<div class="sect-h"><h2>Open (' + open.length + ")</h2><div class='rule'></div></div>" +
      (open.length ? open.map(function (r) {
        return '<div class="card" style="margin-bottom:8px"><div class="card-b row"><div><b>' + esc(r.title) + "</b><div class='hint'>Due " + esc(r.due || "—") + (r.unitId ? " · " + esc(r.unitId) : "") + "</div></div>" +
          actionBtn("Mark done", "done-reminder:" + r.id, "sm") + "</div></div>";
      }).join("") : '<div class="empty card">No open reminders.</div>') +
      (done.length ? '<div class="sect-h"><h2>Done</h2><div class="rule"></div></div>' + table(["Title", "Due", "Unit"], done.map(function (r) { return [r.title, r.due || "", r.unitId || ""]; })) : "")
    );
  }

  function draftReserve(kind) {
    var d = state.drafts.reserve || {
      kind: kind || "job",
      date: manilaDate(),
      unitId: state.unitId || "",
      project: "",
      jobTypeId: "",
      purpose: "",
      requestedBy: "",
      scope: "",
      meter: "",
      lines: [{ id: uid("ln"), description: "", scope: "", qty: "", litres: "", unitPrice: "", supplier: "", workTypeId: "" }],
      gauge: "",
      gaugePhotoId: "",
      overrideReason: "",
    };
    if (kind) d.kind = kind;
    state.drafts.reserve = d;
    return d;
  }

  function renderReserveForm(kind) {
    var d = draftReserve(kind);
    var fuel = d.kind === "fuel-issue" || d.kind === "fuel-bulk";
    var u = unitById(d.unitId);
    var miss = R.missingReserveFields(d);
    if (fuel) {
      d.lines[0] = d.lines[0] || {};
      if (!d.lines[0].description) d.lines[0].description = d.kind === "fuel-bulk" ? "DIESEL-BULK" : "DIESEL-ISSUE";
    }
    var hist = fuels().filter(function (f) { return f.unitId === d.unitId; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var gates = fuel && u ? R.fuelGates({
      litres: d.lines[0] && d.lines[0].litres,
      meter: d.meter,
      meterKind: R.meterKindForUnit(u),
    }, hist, cfg()) : { issues: [] };
    var gateMiss = [];
    if (gates.needsOverride && !String(d.overrideReason || "").trim()) gateMiss.push("Override reason (fuel gate)");
    if (gates.blocked) gateMiss.push("Meter hard stop is on (owner setting) — fix the meter");
    var allMiss = miss.concat(gateMiss);
    var lineEditor = fuel ? (
      '<div class="grid2">' +
      '<div class="f"><label>Litres</label><input name="fuelLitres" inputmode="decimal" value="' + esc((d.lines[0] && d.lines[0].litres) || "") + '"><div class="hint">Litres field only — never qty</div></div>' +
      '<div class="f"><label>Commodity</label><input name="fuelItem" value="' + esc((d.lines[0] && d.lines[0].description) || "") + '"><div class="hint">isFuel requires a dash (e.g. DIESEL-BULK)</div></div>' +
      '<div class="f"><label>Gauge level</label><input name="gauge" value="' + esc(d.gauge || "") + '" placeholder="e.g. 1/4"></div>' +
      '<div class="f"><label>Gauge photo</label><input type="file" accept="image/*" data-photo="gauge">' +
      (d.gaugePhotoId ? '<div class="hint">Photo on file</div>' : "") + "</div></div>" +
      (gates.issues.length ? '<div class="banner warn">Gates: ' + gates.issues.map(function (i) { return esc(i.label); }).join(" · ") + "</div>" +
        '<div class="f"><label>Override reason</label><input name="overrideReason" value="' + esc(d.overrideReason || "") + '"></div>' : "") +
      (cfg().meterReadingHardStop ? '<div class="open-decision">Owner setting: meter reading hard stop is ON. Reverse / no-move blocks the request.</div>' : '<div class="open-decision">Open decision: meter reading hard stop is off (default). Owner has not decided.</div>')
    ) : (
      lineTable(d.lines, false)
    );
    return (
      '<div class="card"><div class="card-h"><h3>' + (fuel ? "Fuel reserve" : "Job reserve") + "</h3>" +
      '<div class="sp">' + statusPill("Requested") + '</div></div><div class="card-b">' +
      '<p class="hint">Staff raise a reserve. Owner approves once in Office → Approvals and a VRF number is assigned. No second approval.</p>' +
      '<div class="grid2">' +
      '<div class="f"><label>Date</label><input type="date" name="rsvDate" value="' + esc(d.date) + '"></div>' +
      (fuel ? '<div class="f"><label>Kind</label><select name="rsvKind"><option value="fuel-issue"' + (d.kind === "fuel-issue" ? " selected" : "") + ">fuel-issue</option><option value='fuel-bulk'" + (d.kind === "fuel-bulk" ? " selected" : "") + ">fuel-bulk</option></select></div>" : "") +
      unitTypeahead(d.unitId, "rsvUnit") +
      '<div class="f"><label>Project</label><input name="rsvProject" value="' + esc(d.project || "") + '" list="proj-list"><div class="hint">' + projects().length + " projects in master (empty is allowed)</div></div>" +
      (!fuel ? '<div class="f"><label>Type of job</label><select name="rsvJob">' + wtOptions(d.jobTypeId) + "</select></div>" : "") +
      '<div class="f"><label>Meter (' + (u ? R.meterKindForUnit(u) : "km or hr") + ")</label><input name='rsvMeter' inputmode='decimal' value='" + esc(d.meter || "") + "'></div>" +
      '<div class="f"><label>Requested by</label><input name="rsvBy" value="' + esc(d.requestedBy || "") + '"></div>' +
      '<div class="f"><label>Purpose</label><input name="rsvPurpose" value="' + esc(d.purpose || "") + '"></div>' +
      '<div class="f"><label>Scope</label><input name="rsvScope" value="' + esc(d.scope || "") + '"></div>' +
      "</div><div class='gap'></div>" + lineEditor +
      '<div class="gap"></div>' + actionBtn("Submit reserve", "submit-reserve", "pri", allMiss) +
      "</div></div>" + datalists()
    );
  }

  function wtOptions(selected) {
    var html = '<option value="">—</option>';
    families().forEach(function (f) {
      html += '<optgroup label="' + esc(f.name) + '">';
      worktypes().filter(function (t) { return t.familyId === f.id; }).forEach(function (t) {
        html += '<option value="' + esc(t.id) + '"' + (selected === t.id ? " selected" : "") + ">" + esc(t.name) + "</option>";
      });
      html += "</optgroup>";
    });
    return html;
  }

  function lineTable(lines, office) {
    var rows = (lines || []).map(function (ln, i) {
      return "<tr>" +
        '<td><input data-line="' + i + '" data-k="description" value="' + esc(ln.description || "") + '" placeholder="Item / material"></td>' +
        '<td><input data-line="' + i + '" data-k="scope" value="' + esc(ln.scope || "") + '" placeholder="Scope"></td>' +
        '<td><select data-line="' + i + '" data-k="workTypeId">' + wtOptions(ln.workTypeId) + "</select></td>" +
        (ln.litres != null && ln.litres !== "" || (ln.description && R.isFuel(ln.description))
          ? '<td><input data-line="' + i + '" data-k="litres" inputmode="decimal" value="' + esc(ln.litres || "") + '" placeholder="L"></td>'
          : '<td><input data-line="' + i + '" data-k="qty" inputmode="decimal" value="' + esc(ln.qty || "") + '"></td>') +
        (office ? '<td><input data-line="' + i + '" data-k="unitPrice" inputmode="decimal" value="' + esc(ln.unitPrice || "") + '"></td>' : "<td></td>") +
        '<td><input data-line="' + i + '" data-k="supplier" value="' + esc(ln.supplier || "") + '" list="sup-list"></td>' +
        '<td><button class="btn sm danger" data-act="del-line" data-i="' + i + '">Remove</button></td></tr>';
    }).join("");
    var inferred = R.inferJob(lines || [], worktypes());
    return (
      '<div class="card"><div class="card-h"><h3>Lines</h3><div class="sp">' +
      '<button class="btn sm" data-act="add-line">Add line</button></div></div>' +
      '<div class="tw"><table><thead><tr><th>Item</th><th>Scope</th><th>Work type</th><th>Qty / L</th><th>' + (office ? "Price" : "") + "</th><th>Supplier</th><th></th></tr></thead><tbody>" +
      (rows || '<tr><td colspan="7" class="empty">Add a line.</td></tr>') + "</tbody></table></div>" +
      (inferred.workType ? '<div class="card-b"><span class="pill acc">Inferred job: ' + esc(inferred.workType.name) + "</span> <span class='hint'>key category 3 · supporting 1 · longest phrase · labour/fasteners score 0</span></div>" : "") +
      "</div>"
    );
  }

  function datalists() {
    return '<datalist id="proj-list">' + projects().map(function (p) { return '<option value="' + esc(p.name || p.id) + '">'; }).join("") + "</datalist>" +
      '<datalist id="sup-list">' + suppliers().map(function (s) { return '<option value="' + esc(s.name) + '">'; }).join("") + "</datalist>";
  }

  function renderReserves() {
    var list = reserves().slice().sort(function (a, b) { return String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")); });
    var lens = state.lens || "open";
    var shown = list.filter(function (r) {
      if (lens === "all") return true;
      if (lens === "open") return r.status === "Requested" || r.status === "Approved";
      return r.status === lens;
    });
    return (
      '<div class="row" style="margin-bottom:12px">' +
      '<button class="btn pri" data-act="new-reserve">New job reserve</button>' +
      '<button class="tab-btn btn sm' + (lens === "open" ? " pri" : "") + '" data-act="lens:open">Open</button>' +
      '<button class="btn sm' + (lens === "Approved" ? " pri" : "") + '" data-act="lens:Approved">Approved</button>' +
      '<button class="btn sm' + (lens === "all" ? " pri" : "") + '" data-act="lens:all">All</button></div>' +
      (state.lens === "form" ? renderReserveForm("job") : "") +
      table(["Reserve", "VRF", "Unit", "Kind", "Status", "Purpose"], shown.map(function (r) {
        var u = unitById(r.unitId);
        return [r.id, r.vrfNo || "—", u ? u.code : r.unitId, r.kind, statusPill(r.status), r.purpose || ""];
      }), function (r) { return "data-act='open-vrf' data-id='" + esc(r.id) + "'"; }, shown)
    );
  }

  function renderNewVrf() {
    var id = state.filters.id;
    var doc = id ? store.getThawed("reserves/" + id) : null;
    if (doc) doc.id = id;
    var d = doc || state.drafts.vrf || draftReserve("job");
    if (doc) state.drafts.vrf = doc;
    else state.drafts.vrf = d;
    var u = unitById(d.unitId);
    var money = moneyRefsForUnit(d.unitId);
    var work = workRefsForUnit(d.unitId);
    var inferred = R.inferJob(d.lines || [], worktypes());
    var canClose = d.status === "Approved" || d.status === "Flagged";
    var closeMiss = canClose ? R.missingVrfCloseFields(Object.assign({}, d, { closedBy: d.closedBy || d.liquidatedBy })) : ["Approve in Office first"];
    return (
      '<div class="card"><div class="card-h"><h3>Vehicle Request Form</h3><div class="sp">' +
      statusPill(d.status || "Draft") + (d.vrfNo ? '<span class="pill acc">' + esc(d.vrfNo) + "</span>" : "") +
      "</div></div><div class='card-b'>" +
      '<p class="hint">Every movement of money is a VRF. Number is assigned when the owner approves the reserve. Staff may add lines and suppliers while liquidating.</p>' +
      '<div class="grid2">' +
      '<div class="f"><label>Date</label><input type="date" name="vrfDate" value="' + esc(d.date || manilaDate()) + '"></div>' +
      unitTypeahead(d.unitId, "vrfUnit") +
      '<div class="f"><label>Project</label><input name="vrfProject" value="' + esc(d.project || "") + '" list="proj-list"></div>' +
      '<div class="f"><label>Money ref</label><select name="moneyRef"><option value="">— none (' + money.length + " approved reserves" + (d.unitId ? " for this unit" : "") + ")</option>" +
      money.map(function (r) { return '<option value="' + esc(r.id) + '"' + (d.moneyRef === r.id ? " selected" : "") + ">" + esc((r.vrfNo || r.id) + " · " + (r.purpose || r.kind)) + "</option>"; }).join("") +
      "</select><div class='hint'>Independent of work ref. " + money.length + " approved reserves.</div></div>" +
      '<div class="f"><label>Work ref</label><select name="workRef"><option value="">— none (' + work.length + " open JO/tasks; admin always listed)</option>" +
      work.map(function (w) { return '<option value="' + esc(w.type + ":" + w.id) + '"' + (d.workRef && d.workRef.id === w.id ? " selected" : "") + ">" + esc((w.type === "jo" ? "JO" : "Task") + " · " + (w.title || w.id) + (w.admin ? " · admin" : "") + " · " + (w.state || "")) + "</option>"; }).join("") +
      "</select><div class='hint'>Open JOs/tasks. Default includes In progress + For verification, excludes Closed (owner setting).</div></div>" +
      '<div class="f"><label>Type of job</label><select name="vrfJob">' + wtOptions(d.jobTypeId) + "</select>" +
      (inferred.workType ? '<div class="hint">Inferred: ' + esc(inferred.workType.name) + "</div>" : "") + "</div>" +
      '<div class="f"><label>Odo / hour meter</label><input name="vrfMeter" value="' + esc(d.meter || "") + '"></div>' +
      '<div class="f"><label>Requested by</label><input name="vrfBy" value="' + esc(d.requestedBy || "") + '"></div>' +
      '<div class="f"><label>Purpose</label><input name="vrfPurpose" value="' + esc(d.purpose || "") + '"></div>' +
      "</div></div></div><div class='gap'></div>" +
      lineTable(d.lines || [], false) +
      '<div class="gap"></div><div class="row">' +
      actionBtn("Save draft lines", "save-vrf-lines", "", []) +
      (canClose ? actionBtn("Close / liquidate", "close-vrf", "pri", closeMiss) : "") +
      '<button class="btn" data-act="show-print">On-screen form</button>' +
      '<button class="btn" data-act="dl-vrf">Download HTML</button></div>' +
      (state.lens === "print" ? '<div class="gap"></div><div class="pf-sheet">' + vrfPrintHtml(d, u) + "</div>" : "") +
      datalists()
    );
  }

  function renderFuelReserve() {
    return renderReserveForm(state.drafts.reserve && (state.drafts.reserve.kind === "fuel-bulk") ? "fuel-bulk" : "fuel-issue");
  }

  function renderWorkshop() {
    var list = jos();
    var lens = state.lens || "open";
    var shown = list.filter(function (j) {
      if (lens === "archive") return j.state === "Closed";
      if (lens === "form" || lens === "detail") return true;
      return j.state !== "Closed";
    });
    var id = state.filters.id;
    var jo = id ? list.filter(function (j) { return j.id === id; })[0] : null;
    return (
      '<div class="row" style="margin-bottom:12px">' +
      '<button class="btn pri" data-act="new-jo">New job order</button>' +
      '<button class="btn sm' + (lens === "open" ? " pri" : "") + '" data-act="lens:open">Open</button>' +
      '<button class="btn sm' + (lens === "archive" ? " pri" : "") + '" data-act="lens:archive">Completed archive</button>' +
      '<input name="joSearch" placeholder="Search archive" value="' + esc(state.filters.q || "") + '" style="min-height:40px;padding:8px"></div>' +
      (state.lens === "form" ? renderJoForm(null) : "") +
      (jo && lens !== "form" ? renderJoForm(jo) : "") +
      table(["JO", "Kind", "Unit", "State", "Off-road", "Title"], shown.filter(function (j) {
        if (lens === "archive" && state.filters.q) return (j.title + j.resolution + (j.id || "")).toLowerCase().indexOf(state.filters.q.toLowerCase()) !== -1;
        return true;
      }).map(function (j) {
        return [j.id, j.kind, j.unitId || "—", statusPill(j.state), j.offRoad ? "yes" : "", j.title || ""];
      }), function (j) { return "data-act='open-jo' data-id='" + esc(j.id) + "'"; }, shown)
    );
  }

  function renderJoForm(jo) {
    var d = jo || state.drafts.jo || {
      kind: "Workshop",
      state: "Open",
      unitId: state.unitId || "",
      title: "",
      offRoad: true,
      offRoadFrom: manilaDate(),
      daysDown: "",
      checklist: (WT.CHECKLISTS.Workshop || []).map(function (c) { return Object.assign({ done: false, who: "", when: "" }, c); }),
      proofs: [],
      resolution: "",
      closerName: "",
      openedBy: "",
      costVrfNos: [],
    };
    if (!jo) state.drafts.jo = d;
    var miss = R.missingJoCloseFields(d);
    var same = d.closerName && d.openedBy && d.closerName.trim().toLowerCase() === d.openedBy.trim().toLowerCase();
    var checks = (d.checklist || []).map(function (c, i) {
      return '<label class="chk' + (c.done && (!c.who || !c.when) ? " miss" : "") + '"><input type="checkbox" data-chk="' + i + '" ' + (c.done ? "checked" : "") + ">" +
        '<div class="n"><b>' + esc(c.label) + "</b></div>" +
        '<input placeholder="Who" data-chk-who="' + i + '" value="' + esc(c.who || "") + '" style="max-width:120px">' +
        '<input type="date" data-chk-when="' + i + '" value="' + esc(c.when || "") + '"></label>';
    }).join("");
    return (
      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + (jo ? esc(jo.id) : "New JO") + "</h3><div class='sp'>" + statusPill(d.state || "Open") + "</div></div><div class='card-b'>" +
      '<div class="grid2">' +
      '<div class="f"><label>Kind</label><select name="joKind"><option' + (d.kind === "Workshop" ? " selected" : "") + ">Workshop</option><option" + (d.kind === "Admin" ? " selected" : "") + ">Admin</option></select></div>" +
      '<div class="f"><label>State</label><select name="joState">' + ["Open", "In progress", "For verification", "Closed", "Reopened"].map(function (s) {
        return '<option' + (d.state === s ? " selected" : "") + ">" + s + "</option>";
      }).join("") + "</select></div>" +
      unitTypeahead(d.unitId, "joUnit") +
      '<div class="f"><label>Title</label><input name="joTitle" value="' + esc(d.title || "") + '"></div>' +
      '<div class="f"><label>Opened by</label><input name="joOpenedBy" value="' + esc(d.openedBy || "") + '"></div>' +
      '<div class="f"><label>Off-road</label><select name="joOff"><option value="yes"' + (d.offRoad ? " selected" : "") + ">Yes — unit off-road</option><option value='no'" + (!d.offRoad ? " selected" : "") + ">No</option></select></div>" +
      '<div class="f"><label>Off-road from</label><input type="date" name="joOffFrom" value="' + esc(d.offRoadFrom || "") + '"></div>' +
      '<div class="f"><label>Days down</label><input name="joDays" inputmode="numeric" value="' + esc(d.daysDown || "") + '"></div>' +
      '<div class="f"><label>Resolution</label><textarea name="joRes">' + esc(d.resolution || "") + "</textarea></div>" +
      '<div class="f"><label>Closer name</label><input name="joCloser" value="' + esc(d.closerName || "") + '"></div>' +
      "</div>" +
      (same ? '<div class="banner warn">Same person warning — closer matches opener.</div>' : "") +
      '<div class="sect-h"><h2>Checklist</h2><div class="rule"></div></div><div class="chklist">' + checks + "</div>" +
      '<div class="gap"></div>' + attachInput("proof", d.proofs) +
      (d.costVrfNos && d.costVrfNos.length ? '<p class="hint">What it cost: ' + d.costVrfNos.map(esc).join(", ") + "</p>" : '<p class="hint">What it cost — VRF numbers stamp here after liquidate.</p>') +
      '<div class="row">' + actionBtn("Save JO", "save-jo", "pri", []) +
      actionBtn("Close JO", "close-jo", "", miss) +
      (d.state === "Closed" ? actionBtn("Reopen", "reopen-jo", "") : "") +
      "</div></div></div>"
    );
  }

  function renderTasks() {
    var list = tasks();
    var lens = state.lens || "open";
    var shown = list.filter(function (t) {
      if (lens === "archive") return t.state === "Done";
      return t.state !== "Done";
    });
    var id = state.filters.id;
    var cur = id ? list.filter(function (t) { return t.id === id; })[0] : null;
    var d = cur || state.drafts.task || { title: "", unitId: state.unitId || "", notes: "", photos: [], links: [], state: "Open", closerName: "", costVrfNos: [] };
    if (!cur) state.drafts.task = d;
    var miss = R.missingTaskCloseFields(d);
    var del = state.confirm === "del-task";
    return (
      '<div class="row" style="margin-bottom:12px">' +
      '<button class="btn sm' + (lens === "open" ? " pri" : "") + '" data-act="lens:open">Open</button>' +
      '<button class="btn sm' + (lens === "archive" ? " pri" : "") + '" data-act="lens:archive">Completed archive</button></div>' +
      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>' + (cur ? "Task" : "New task") + "</h3></div><div class='card-b'>" +
      '<p class="hint">Full record — not a one-click Done. Photos stored here; videos and docs as links.</p>' +
      '<div class="grid2">' +
      '<div class="f"><label>Title</label><input name="taskTitle" value="' + esc(d.title || "") + '"></div>' +
      unitTypeahead(d.unitId, "taskUnit") +
      '<div class="f"><label>Notes</label><textarea name="taskNotes">' + esc(d.notes || "") + "</textarea></div>" +
      '<div class="f"><label>Closer name</label><input name="taskCloser" value="' + esc(d.closerName || "") + '"></div></div>' +
      attachInput("task", [].concat(d.photos || [], d.links || [])) +
      (d.costVrfNos && d.costVrfNos.length ? '<p class="hint">What it cost: ' + d.costVrfNos.map(esc).join(", ") + "</p>" : "") +
      '<div class="row">' + actionBtn("Save task", "save-task", "pri", []) +
      actionBtn("Mark done", "close-task", "", miss) +
      (d.state === "Done" ? actionBtn("Reopen", "reopen-task", "") : "") +
      (cur ? '<button class="btn danger sm" data-act="ask-del-task">Delete</button>' : "") +
      "</div>" +
      (del ? '<div class="inline-confirm">Delete this task? <button class="btn danger sm" data-act="del-task">Yes, delete</button><button class="btn sm" data-act="cancel-confirm">Keep</button></div>' : "") +
      "</div></div>" +
      table(["Task", "Unit", "State", "Title"], shown.map(function (t) {
        return [t.id, t.unitId || "—", statusPill(t.state), t.title || ""];
      }), function (t) { return "data-act='open-task' data-id='" + esc(t.id) + "'"; }, shown)
    );
  }

  function renderStore() {
    var d = state.drafts.store || { kind: "in", date: manilaDate(), item: "", qty: "", supplier: "", note: "" };
    state.drafts.store = d;
    var fuelish = R.isFuel(d.item);
    var miss = [];
    if (!String(d.item || "").trim()) miss.push("Item");
    if (!String(d.qty || "").trim()) miss.push("Qty");
    if (fuelish) miss.push("Fuel is excluded from store (receipt and issue)");
    if (d.kind === "in" && !String(d.supplier || "").trim()) miss.push("Supplier (AV receipt)");
    var moves = storeMoves();
    return (
      '<div class="card"><div class="card-h"><h3>Store</h3></div><div class="card-b">' +
      '<p class="hint">AV = receipt in. Supplier <b>MOTORPOOL INVENTORY</b> = issue out. Fuel is excluded from both.</p>' +
      '<div class="grid2">' +
      '<div class="f"><label>Movement</label><select name="stKind"><option value="in"' + (d.kind === "in" ? " selected" : "") + ">AV receipt (in)</option><option value='out'" + (d.kind === "out" ? " selected" : "") + ">Issue (MOTORPOOL INVENTORY)</option></select></div>" +
      '<div class="f"><label>Date</label><input type="date" name="stDate" value="' + esc(d.date) + '"></div>' +
      '<div class="f"><label>Item</label><input name="stItem" value="' + esc(d.item || "") + '"></div>' +
      '<div class="f"><label>Qty</label><input name="stQty" inputmode="decimal" value="' + esc(d.qty || "") + '"></div>' +
      '<div class="f"><label>Supplier</label><input name="stSup" list="sup-list" value="' + esc(d.kind === "out" ? "MOTORPOOL INVENTORY" : (d.supplier || "")) + '"></div>' +
      '<div class="f"><label>Note</label><input name="stNote" value="' + esc(d.note || "") + '"></div></div>' +
      actionBtn("Post movement", "post-store", "pri", miss) +
      "</div></div><div class='gap'></div>" +
      table(["Date", "Dir", "Item", "Qty", "Supplier"], moves.map(function (m) {
        return [m.date || "", m.kind, m.item, m.qty, m.supplier || ""];
      })) + datalists()
    );
  }

  function renderVrfLog() {
    var list = reserves().filter(function (r) { return r.vrfNo; });
    return (
      '<p class="hint">Numbered VRFs — operational status only. Peso analytics live in Office.</p>' +
      table(["VRF", "Unit", "Kind", "Status", "Purpose", "Job"], list.map(function (r) {
        var inf = R.inferJob(r.lines || [], worktypes());
        var job = r.jobTypeId ? worktypes().filter(function (t) { return t.id === r.jobTypeId; })[0] : inf.workType;
        return [r.vrfNo, r.unitId, r.kind, statusPill(r.status), r.purpose || "", job ? job.name + (inf.inferred && !r.jobTypeId ? " (inferred)" : "") : "—"];
      }), function (r) { return "data-act='open-vrf' data-id='" + esc(r.id) + "'"; }, list)
    );
  }

  function renderHistory() {
    var rows = activities().slice(0, 200);
    return table(["When", "Action", "Path", "Note"], rows.map(function (a) {
      return [a.at || "", a.action || "", a.path || "", a.note || ""];
    }));
  }

  function renderFleet() {
    var list = units();
    var chase = R.papersToChase(list);
    var id = state.unitId || state.filters.id;
    var u = unitById(id);
    return (
      '<div class="strip">' +
      tile(list.filter(function (x) { return x.status === "active"; }).length, "Active units", "Demo fleet — not the full 89", "acc") +
      tile(chase.length, "Papers to chase", "Plant = deed only", chase.length ? "warn" : "ok") +
      "</div>" +
      '<div class="sect-h"><h2>Papers to chase</h2><div class="rule"></div></div>' +
      (chase.length ? table(["Unit", "Plate", "Plant", "Missing"], chase.map(function (c) {
        return [c.code, c.plate || "(blank)", c.plant ? "deed only" : "registered", c.missing.join(", ")];
      }), function (c) { return "data-act='open-unit' data-id='" + esc(c.id) + "'"; }, chase) : '<div class="empty card">Nothing to chase.</div>') +
      '<div class="sect-h"><h2>201 file</h2><div class="rule"></div></div>' +
      table(["Code", "Name", "Type", "Plate", "Status", "Meter"], list.map(function (x) {
        return [x.code, x.name, x.type, x.plate || "—", x.status, x.meterKind];
      }), function (x) { return "data-act='open-unit' data-id='" + esc(x.id) + "'"; }, list) +
      (u ? renderUnit201(u) : "")
    );
  }

  function renderUnit201(u) {
    var needed = R.papersNeeded(u);
    var missing = R.missingPapers(u);
    var papers = u.papers || {};
    return (
      '<div class="card" style="margin-top:14px"><div class="card-h"><h3>' + esc(unitLabel(u)) + "</h3></div><div class='card-b'>" +
      '<div class="grid2">' +
      ["code", "name", "type", "plate", "status", "meterKind", "make", "model", "year", "engine", "chassis", "color", "acquired", "driveFolder"].map(function (k) {
        return '<div class="f"><label>' + esc(k) + "</label><input data-unit-k='" + k + "' value='" + esc(u[k] || "") + "'></div>";
      }).join("") +
      '<div class="f"><label>Notes</label><textarea data-unit-k="notes">' + esc(u.notes || "") + "</textarea></div></div>" +
      '<div class="sect-h"><h2>Papers</h2><div class="rule"></div></div>' +
      (R.excludeFromPapersChase(u) ? '<div class="banner">Excluded from chase (sold / AV / Equipment n).</div>' :
        (R.isPlantUnit(u) ? '<div class="banner">Plant unit (BH- / RR- / blank / NA plate) — deed only.</div>' : '<div class="banner">Registered — CR, OR, insurance. Combined OR+CR counts as both.</div>')) +
      WT.PAPER_TYPES.map(function (p) {
        var on = R.hasPaper(u, p.id);
        return '<label class="chk"><input type="checkbox" data-paper="' + p.id + '" ' + (on ? "checked" : "") + '><div class="n"><b>' + esc(p.label) + "</b>" +
          (needed.indexOf(p.id) !== -1 || (p.id === "orCrCombined") ? "<span>" + (missing.indexOf(p.id) !== -1 ? "needed" : "on file or optional") + "</span>" : "") +
          "</div></label>";
      }).join("") +
      '<div class="gap"></div>' + actionBtn("Save 201", "save-unit", "pri", []) +
      "</div></div>"
    );
  }

  function renderYardFuel() {
    return '<div class="open-decision">Open decision: yard fuel monitoring tab. Default is hidden. Owner turned this setting on. This is a watch list — economics stay in Office.</div>' +
      table(["Unit", "Last metre", "Last litres", "Kind"], fuels().map(function (f) {
        return [f.unitId, f.meter || "", f.litres || "", f.meterKind || ""];
      }));
  }

  function renderOfficeGate() {
    var hasLocal = Boolean(cfg().officePassHash);
    return (
      '<div class="gate"><h2>Office</h2>' +
      '<p>Soft gate for money and figures. Not a security boundary — the real control is who has the app link. The field never echoes what you type after you continue.</p>' +
      (hasLocal
        ? '<div class="f"><label>Office pass</label><input type="password" name="officePass" autocomplete="current-password"></div>' +
          '<div class="gap"></div><button class="btn pri" data-act="office-unlock">Unlock office</button><div class="missing" id="office-miss"></div>'
        : '<div class="banner warn">One-time setup — no hash is stored yet. Type a pass, then Store hash. The page will not show it back.</div>' +
          '<div class="f"><label>Set office pass</label><input type="password" name="officeSetup" autocomplete="new-password"></div>' +
          '<div class="gap"></div><button class="btn pri" data-act="office-setup">Store hash</button>') +
      '<p class="hint">You can also set MOTORPOOL_OFFICE_PASS_HASH on the Netlify site (SHA-256 hex). Never put the plaintext in code or chat.</p></div>'
    );
  }

  function renderApprovals() {
    var req = reserves().filter(function (r) { return r.status === "Requested"; });
    var flagged = reserves().filter(function (r) { return r.status === "Flagged"; });
    var recent = reserves().filter(function (r) { return r.vrfNo; }).slice(0, 20);
    return (
      (flagged.length ? '<div class="banner warn">Flagged notice — closed more than 10% over approved. Notice only, not a block.</div><div class="gap"></div>' +
        table(["VRF", "Unit", "Approved", "Spent"], flagged.map(function (r) {
          return [r.vrfNo || r.id, r.unitId, peso(r.approvedAmount), peso(r.spentAmount)];
        })) : "") +
      '<div class="sect-h"><h2>Requested</h2><div class="rule"></div></div>' +
      (req.length ? req.map(function (r) {
        var fuelMiss = R.missingFuelApproveFields(r);
        var amt = R.sumLines(r.lines || []);
        return '<div class="card" style="margin-bottom:10px"><div class="card-b">' +
          "<b>" + esc(r.kind) + "</b> · " + esc(r.unitId) + " · " + esc(r.purpose || "") +
          "<div class='hint'>Draft spend " + peso(amt) + " · " + (r.lines || []).length + " lines" +
          (r.gauge ? " · gauge " + esc(r.gauge) : "") + (r.gaugePhotoId ? " · photo on file" : "") + "</div>" +
          '<div class="row">' + actionBtn("Approve (assign VRF)", "approve:" + r.id, "pri ok", fuelMiss) +
          actionBtn("Reject", "reject:" + r.id, "danger", []) + "</div></div></div>";
      }).join("") : '<div class="empty card">Nothing waiting.</div>') +
      '<div class="sect-h"><h2>Numbered</h2><div class="rule"></div></div>' +
      table(["VRF", "Status", "Unit", "Approved", "Spent"], recent.map(function (r) {
        return [r.vrfNo, statusPill(r.status), r.unitId, peso(r.approvedAmount), peso(r.spentAmount || 0)];
      }))
    );
  }

  function renderSpend() {
    var closed = reserves().filter(function (r) { return r.status === "Closed" || r.status === "Flagged" || r.status === "Approved"; });
    var byUnit = {};
    var bySup = {};
    closed.forEach(function (r) {
      byUnit[r.unitId] = (byUnit[r.unitId] || 0) + (Number(r.spentAmount) || R.sumLines(r.lines));
      (r.lines || []).forEach(function (ln) {
        var s = ln.supplier || "(none)";
        bySup[s] = (bySup[s] || 0) + R.lineAmount(ln);
      });
    });
    return (
      '<p class="hint">Office analytics. Yard never shows these totals.</p>' +
      table(["Unit", "Spend"], Object.keys(byUnit).map(function (k) { return [k, peso(byUnit[k])]; })) +
      '<div class="gap"></div>' +
      table(["Supplier", "Spend"], Object.keys(bySup).map(function (k) { return [k, peso(bySup[k])]; }))
    );
  }

  function renderFuelEcon() {
    var byUnit = {};
    fuels().concat(reserves().filter(function (r) { return r.kind && r.kind.indexOf("fuel") === 0 && r.status !== "Rejected"; })).forEach(function (f) {
      var id = f.unitId;
      if (!id) return;
      byUnit[id] = byUnit[id] || [];
      byUnit[id].push(f);
    });
    var rows = [];
    Object.keys(byUnit).forEach(function (id) {
      var u = unitById(id);
      var kind = u ? R.meterKindForUnit(u) : "km";
      var fills = R.dropBadIntervals(byUnit[id].slice().sort(function (a, b) { return String(a.date || "").localeCompare(String(b.date || "")); }));
      for (var i = 1; i < fills.length; i++) {
        var rate = R.fillToFillRate({ meter: fills[i].meter, litres: fills[i].litres || (fills[i].lines && fills[i].lines[0] && fills[i].lines[0].litres) }, { meter: fills[i - 1].meter }, kind);
        if (rate == null) continue;
        rows.push([id, fills[i].date || "", kind === "hr" ? rate.toFixed(2) + " L/hr" : rate.toFixed(2) + " km/L", fills[i].badInterval ? "dropped" : "ok"]);
      }
    });
    return '<p class="hint">Road units: km/L. BH / RR / TM / MBC / Equipment: L/hr. Fill-to-fill. Bad intervals dropped.</p>' +
      table(["Unit", "Fill date", "Rate", "Interval"], rows);
  }

  function renderConsumption() {
    var job = reserves().filter(function (r) { return r.kind === "job" && r.vrfNo; });
    var fuel = reserves().filter(function (r) { return r.kind && r.kind.indexOf("fuel") === 0 && r.vrfNo; });
    return (
      '<div class="strip">' +
      tile(job.length, "Job VRFs", peso(job.reduce(function (s, r) { return s + (Number(r.spentAmount) || R.sumLines(r.lines)); }, 0)), "acc") +
      tile(fuel.length, "Fuel VRFs", peso(fuel.reduce(function (s, r) { return s + (Number(r.spentAmount) || R.sumLines(r.lines)); }, 0)), "acc") +
      "</div>" +
      table(["VRF", "Kind", "Unit", "Spend"], job.concat(fuel).map(function (r) {
        return [r.vrfNo, r.kind, r.unitId, peso(r.spentAmount || R.sumLines(r.lines))];
      }))
    );
  }

  function renderInventory() {
    var qty = {};
    storeMoves().forEach(function (m) {
      if (R.isFuel(m.item)) return;
      var n = Number(m.qty) || 0;
      qty[m.item] = (qty[m.item] || 0) + (m.kind === "in" ? n : -n);
    });
    var keys = Object.keys(qty);
    return '<p class="hint">Stock from AV receipts and MOTORPOOL INVENTORY issues. Fuel excluded. Valuation is office-only; this MVP shows qty, not invented pesos.</p>' +
      (keys.length ? table(["Item", "On hand"], keys.map(function (k) { return [k, String(qty[k])]; })) : '<div class="empty card">Store is empty — no production stock imported.</div>');
  }

  function renderMaint() {
    return (
      '<p class="hint">Plan shells for the demo fleet. Intervals are defaults — not owner-approved PM policy.</p>' +
      table(["Unit", "Meter", "Suggested"], units().filter(function (u) { return u.status === "active"; }).map(function (u) {
        var kind = R.meterKindForUnit(u);
        return [u.code, kind, kind === "hr" ? "PMS / grease" : "Change oil / PMS"];
      }))
    );
  }

  function renderHealth() {
    var c = cfg();
    var issues = [];
    reserves().forEach(function (r) {
      if (!r.unitId) issues.push("Reserve " + r.id + " has no unit");
    });
    jos().forEach(function (j) {
      if (j.state === "Closed" && R.missingJoCloseFields(j).length) issues.push("JO " + j.id + " closed without gates");
    });
    return (
      '<div class="strip">' +
      tile(units().length, "Units in master", "Demo seed", "acc") +
      tile(worktypes().length, "Work types", families().length + " families", "ok") +
      tile(reserves().length, "Reserves", "No cloned production pesos", "mut") +
      tile(issues.length, "Integrity flags", "", issues.length ? "warn" : "ok") +
      "</div>" +
      '<div class="card" style="margin:14px 0"><div class="card-h"><h3>xlsx import</h3></div><div class="card-b">' +
      '<p>Placeholder. The 46-tab <b>Motorpool. Report</b> sheet is not imported here. Do not paste fake production ledger pesos. When the owner is ready, this is the door for a future xlsx path and source-sheet repairs.</p>' +
      '<input type="file" accept=".xlsx,.xls,.csv" disabled><div class="hint">Import disabled until the owner data map is decided.</div></div></div>' +
      '<div class="card"><div class="card-h"><h3>Open decisions</h3></div><div class="card-b">' +
      '<p class="open-decision">These stay as settings. Do not treat them as owner choices until the owner says so.</p>' +
      toggle("meterReadingHardStop", c.meterReadingHardStop, "Meter reading hard stop on fuel (default off)") +
      toggle("yardFuelMonitoringTab", c.yardFuelMonitoringTab, "Yard fuel monitoring tab (default hidden)") +
      toggle("joForVerificationInVrfDropdown", c.joForVerificationInVrfDropdown, "JO For verification in VRF work-ref dropdown (default on: include In progress + For verification, exclude Closed)") +
      '<p class="hint">Spelling judgement calls: left as-on-source. No invented spellings.</p></div></div>' +
      (issues.length ? '<div class="gap"></div>' + table(["Issue"], issues.map(function (i) { return [i]; })) : "")
    );
  }

  function toggle(key, on, label) {
    return '<label class="chk"><input type="checkbox" data-cfg="' + key + '" ' + (on ? "checked" : "") + '><div class="n"><b>' + esc(label) + "</b></div></label>";
  }

  function renderView() {
    if (state.view === "office-gate") return renderOfficeGate();
    switch (state.view) {
      case "board": return renderBoard();
      case "ask": return renderAsk();
      case "reminders": return renderReminders();
      case "reserves": return renderReserves();
      case "vrf": return renderNewVrf();
      case "fuel-reserve": return renderFuelReserve();
      case "workshop": return renderWorkshop();
      case "tasks": return renderTasks();
      case "store": return renderStore();
      case "vrf-log": return renderVrfLog();
      case "history": return renderHistory();
      case "fleet": return renderFleet();
      case "yard-fuel": return renderYardFuel();
      case "approvals": return renderApprovals();
      case "spend": return renderSpend();
      case "fuel-econ": return renderFuelEcon();
      case "consumption": return renderConsumption();
      case "inventory": return renderInventory();
      case "maint": return renderMaint();
      case "health": return renderHealth();
      default: return '<div class="empty">Unknown view.</div>';
    }
  }

  function navItems() {
    var yard = [
      ["board", "Yard board"],
      ["ask", "Ask the log"],
      ["reminders", "Reminders"],
      ["reserves", "Reserves"],
      ["vrf", "New VRF"],
      ["fuel-reserve", "Fuel reserve"],
      ["workshop", "Workshop"],
      ["tasks", "Tasks"],
      ["store", "Store"],
      ["vrf-log", "VRF log"],
      ["history", "History"],
      ["fleet", "Fleet"],
    ];
    if (cfg().yardFuelMonitoringTab) yard.push(["yard-fuel", "Yard fuel"]);
    var office = [
      ["approvals", "Approvals"],
      ["spend", "Spend"],
      ["fuel-econ", "Fuel economics"],
      ["consumption", "Consumption"],
      ["inventory", "Inventory"],
      ["maint", "Maintenance plan"],
      ["health", "Data health"],
    ];
    function item(pair) {
      var n = 0;
      if (pair[0] === "approvals") n = reserves().filter(function (r) { return r.status === "Requested" || r.status === "Flagged"; }).length;
      if (pair[0] === "reserves") n = reserves().filter(function (r) { return r.status === "Requested"; }).length;
      if (pair[0] === "workshop") n = jos().filter(function (j) { return j.state !== "Closed"; }).length;
      return '<button class="nav-i' + (state.view === pair[0] ? " on" : "") + '" data-go="' + pair[0] + '">' + esc(pair[1]) +
        (n ? '<span class="cnt' + (pair[0] === "approvals" ? " alert" : "") + '">' + n + "</span>" : "") + "</button>";
    }
    return '<div class="nav-h">Yard</div>' + yard.map(item).join("") +
      '<div class="nav-h">Office</div>' + office.map(item).join("");
  }

  function paint() {
    var meta = VIEW_META[state.view] || { title: "Office", back: "Office" };
    var prev = navStack[navStack.length - 1];
    var backLabel = prev ? "← Back to " + prev.title : "";
    document.getElementById("nav").innerHTML = navItems();
    document.getElementById("crumb").innerHTML = esc(meta.title) + "<small>" + (state.zone === "office" ? "Office · figures" : "Yard · staff") + "</small>";
    var backBtn = document.getElementById("back-btn");
    backBtn.hidden = !prev;
    backBtn.textContent = backLabel;
    var pill = document.getElementById("activity-pill");
    pill.hidden = !state.newActivity;
    document.getElementById("view").innerHTML = renderView();
    document.getElementById("dbdot").className = "dbdot" + (remoteDb ? " live" : "");
    document.getElementById("dbdot").innerHTML = "<i></i>" + (remoteDb ? "Live" : "Local demo");
    bind();
  }

  function qName(n) {
    var el = document.querySelector("[name='" + n + "']");
    return el ? el.value : "";
  }

  function readLinesFromDom(d) {
    var inputs = document.querySelectorAll("[data-line]");
    if (!inputs.length) return d.lines || [];
    var map = {};
    inputs.forEach(function (el) {
      var i = Number(el.getAttribute("data-line"));
      map[i] = map[i] || { id: (d.lines && d.lines[i] && d.lines[i].id) || uid("ln") };
      map[i][el.getAttribute("data-k")] = el.value;
    });
    return Object.keys(map)
      .sort(function (a, b) { return Number(a) - Number(b); })
      .map(function (k) { return map[k]; });
  }

  function readDraftFromForm() {
    var d = state.drafts.reserve || draftReserve();
    if (document.querySelector("[name='rsvDate']")) d.date = qName("rsvDate");
    if (document.querySelector("[name='rsvKind']")) d.kind = qName("rsvKind");
    if (document.querySelector("[name='rsvProject']")) d.project = qName("rsvProject");
    if (document.querySelector("[name='rsvJob']")) d.jobTypeId = qName("rsvJob");
    if (document.querySelector("[name='rsvMeter']")) d.meter = qName("rsvMeter");
    if (document.querySelector("[name='rsvBy']")) d.requestedBy = qName("rsvBy");
    if (document.querySelector("[name='rsvPurpose']")) d.purpose = qName("rsvPurpose");
    if (document.querySelector("[name='rsvScope']")) d.scope = qName("rsvScope");
    if (document.querySelector("[name='gauge']")) d.gauge = qName("gauge");
    if (document.querySelector("[name='overrideReason']")) d.overrideReason = qName("overrideReason");
    if (document.querySelector("[name='fuelLitres']")) {
      d.lines[0] = d.lines[0] || {};
      d.lines[0].litres = qName("fuelLitres");
      d.lines[0].description = qName("fuelItem") || d.lines[0].description;
    }
    if (document.querySelector("[data-line]")) d.lines = readLinesFromDom(d);
    state.drafts.reserve = d;
    return d;
  }

  function readVrfForm() {
    var d = state.drafts.vrf || draftReserve("job");
    if (document.querySelector("[name='vrfDate']")) d.date = qName("vrfDate");
    if (document.querySelector("[name='vrfProject']")) d.project = qName("vrfProject");
    if (document.querySelector("[name='vrfJob']")) d.jobTypeId = qName("vrfJob");
    if (document.querySelector("[name='vrfMeter']")) d.meter = qName("vrfMeter");
    if (document.querySelector("[name='vrfBy']")) d.requestedBy = qName("vrfBy");
    if (document.querySelector("[name='vrfPurpose']")) d.purpose = qName("vrfPurpose");
    if (document.querySelector("[name='moneyRef']")) d.moneyRef = qName("moneyRef");
    if (document.querySelector("[name='workRef']")) {
      var wr = qName("workRef");
      if (!wr) d.workRef = null;
      else {
        var parts = wr.split(":");
        d.workRef = { type: parts[0], id: parts.slice(1).join(":") };
      }
    }
    if (document.querySelector("[data-line]")) d.lines = readLinesFromDom(d);
    state.drafts.vrf = d;
    return d;
  }

  function stampCost(ref, vrfNo) {
    if (!ref || !vrfNo) return;
    var path = ref.type === "jo" ? "ops/" + ref.id : ref.type === "task" ? "ops/" + ref.id : "";
    if (!path) return;
    var doc = store.getThawed(path);
    if (!doc) return;
    doc.costVrfNos = doc.costVrfNos || [];
    if (doc.costVrfNos.indexOf(vrfNo) === -1) doc.costVrfNos.push(vrfNo);
    store.set(path, doc);
    syncRemote(path, doc);
  }

  function stampLines(d) {
    (d.lines || []).forEach(function (ln) {
      if (d.id) ln.reserveId = d.id;
      if (d.vrfNo) ln.vrfNo = d.vrfNo;
      if (d.workRef && d.workRef.type === "jo") ln.joId = d.workRef.id;
      if (d.workRef && d.workRef.type === "task") ln.taskId = d.workRef.id;
    });
  }

  async function sha256hex(text) {
    if (window.crypto && crypto.subtle) {
      var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    }
    return R.sha256hexSync(text);
  }

  function clearSensitiveInputs() {
    document.querySelectorAll("[name='officePass'],[name='officeSetup']").forEach(function (el) {
      el.value = "";
    });
  }

  async function handle(act, el) {
    var parts = String(act || "").split(":");
    var name = parts[0];
    var arg = parts.slice(1).join(":");

    if (name === "pick-unit") {
      state.unitId = arg || el.getAttribute("data-id");
      if (state.drafts.reserve) state.drafts.reserve.unitId = state.unitId;
      if (state.drafts.vrf) state.drafts.vrf.unitId = state.unitId;
      if (state.drafts.jo) state.drafts.jo.unitId = state.unitId;
      if (state.drafts.task) state.drafts.task.unitId = state.unitId;
      state.typeahead = "";
      paint();
      return;
    }
    if (name === "lens") {
      state.lens = arg;
      paint();
      return;
    }
    if (name === "new-reserve") {
      state.drafts.reserve = null;
      state.unitId = "";
      go("reserves", { lens: "form" });
      return;
    }
    if (name === "add-line") {
      var target = state.view === "vrf" ? readVrfForm() : readDraftFromForm();
      target.lines = target.lines || [];
      target.lines.push({ id: uid("ln"), description: "", scope: "", qty: "", supplier: "", workTypeId: "" });
      paint();
      return;
    }
    if (name === "del-line") {
      var pack = state.view === "vrf" ? readVrfForm() : readDraftFromForm();
      var idx = Number(el.getAttribute("data-i"));
      pack.lines.splice(idx, 1);
      paint();
      return;
    }
    if (name === "submit-reserve") {
      var d = readDraftFromForm();
      d.unitId = d.unitId || state.unitId;
      d.status = "Requested";
      d.createdAt = d.createdAt || manilaIso();
      if (d.kind === "fuel-issue" || d.kind === "fuel-bulk") {
        var u = unitById(d.unitId);
        var hist = fuels().filter(function (f) { return f.unitId === d.unitId; });
        var gates = R.fuelGates({
          litres: d.lines[0] && d.lines[0].litres,
          meter: d.meter,
          meterKind: u ? R.meterKindForUnit(u) : "km",
        }, hist, cfg());
        if (gates.blocked) return;
        d.fuelGates = gates.issues;
      }
      var rid = saveReserve(d);
      state.drafts.reserve = null;
      go("reserves", { id: rid, lens: "open" }, { replace: true });
      return;
    }
    if (name === "open-vrf") {
      go("vrf", { id: el.getAttribute("data-id") || arg });
      return;
    }
    if (name === "save-vrf-lines") {
      var v = readVrfForm();
      if (!v.id) v.id = uid("rsv");
      stampLines(v);
      saveReserve(v);
      paint();
      return;
    }
    if (name === "close-vrf") {
      var c = readVrfForm();
      c.closedBy = qName("vrfBy") || c.closedBy || c.requestedBy;
      var miss = R.missingVrfCloseFields(c);
      if (miss.length) return;
      stampLines(c);
      c.spentAmount = R.sumLines(c.lines || []);
      c.closedAt = manilaIso();
      if (R.varianceFlag(c.approvedAmount, c.spentAmount, cfg().varianceNoticePct)) {
        c.status = "Flagged";
        c.flaggedNotice = R.varianceNotice(c.approvedAmount, c.spentAmount, cfg().varianceNoticePct);
      } else {
        c.status = "Closed";
      }
      saveReserve(c);
      stampCost(c.workRef, c.vrfNo);
      if (c.kind && c.kind.indexOf("fuel") === 0) {
        var fid = uid("fuel");
        var fill = {
          unitId: c.unitId,
          date: c.date,
          litres: c.lines[0] && c.lines[0].litres,
          meter: c.meter,
          meterKind: unitById(c.unitId) ? R.meterKindForUnit(unitById(c.unitId)) : "km",
          vrfNo: c.vrfNo,
          badInterval: false,
        };
        store.set("fuel/" + fid, fill);
        syncRemote("fuel/" + fid, fill);
      }
      go("vrf-log", {}, { replace: true });
      return;
    }
    if (name === "show-print") {
      if (state.view === "vrf") readVrfForm();
      state.lens = "print";
      paint();
      return;
    }
    if (name === "dl-vrf") {
      var pd = readVrfForm();
      pd._office = state.officeUnlocked;
      var html = vrfPrintHtml(pd, unitById(pd.unitId));
      var filename = (pd.vrfNo || "VRF-draft") + ".html";
      if (window.claude && window.claude.use) {
        try {
          var dl = await window.claude.use("downloads");
          if (dl && dl.save) {
            await dl.save({ filename: filename, data: html });
            return;
          }
        } catch (e) {}
      }
      var blob = new Blob([html], { type: "text/html;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return;
    }
    if (name === "approve") {
      var res = store.getThawed("reserves/" + arg);
      if (!res) return;
      var fuelMiss = R.missingFuelApproveFields(res);
      if (fuelMiss.length) return;
      res.status = "Approved";
      res.approvedAt = manilaIso();
      res.approvedBy = "office";
      res.vrfNo = allocateVrfNo();
      res.approvedAmount = R.sumLines(res.lines || []);
      stampLines(res);
      saveReserve(res);
      paint();
      return;
    }
    if (name === "reject") {
      var rej = store.getThawed("reserves/" + arg);
      if (!rej) return;
      rej.status = "Rejected";
      rej.rejectedAt = manilaIso();
      saveReserve(rej);
      paint();
      return;
    }
    if (name === "add-reminder") {
      var title = qName("remTitle");
      if (!title.trim()) return;
      var rem = {
        docType: "reminder",
        title: title,
        due: qName("remDue"),
        unitId: state.unitId,
        note: qName("remNote"),
        done: false,
        at: manilaIso(),
      };
      var rid2 = uid("reminder");
      store.set("ops/" + rid2, rem);
      syncRemote("ops/" + rid2, rem);
      logActivity("reminder", "ops/" + rid2, title);
      paint();
      return;
    }
    if (name === "done-reminder") {
      var rd = store.getThawed("ops/" + arg);
      if (rd) {
        rd.done = true;
        rd.doneAt = manilaIso();
        store.set("ops/" + arg, rd);
        syncRemote("ops/" + arg, rd);
      }
      paint();
      return;
    }
    if (name === "new-jo") {
      state.drafts.jo = null;
      state.filters.id = "";
      state.lens = "form";
      paint();
      return;
    }
    if (name === "open-jo") {
      go("workshop", { id: el.getAttribute("data-id") || arg, lens: "detail" });
      return;
    }
    if (name === "save-jo" || name === "close-jo" || name === "reopen-jo") {
      var jo = state.filters.id ? store.getThawed("ops/" + state.filters.id) : (state.drafts.jo || {});
      jo.docType = "jo";
      jo.kind = qName("joKind") || jo.kind || "Workshop";
      jo.state = qName("joState") || jo.state || "Open";
      jo.unitId = jo.unitId || state.unitId;
      jo.title = qName("joTitle") || jo.title;
      jo.openedBy = qName("joOpenedBy") || jo.openedBy;
      jo.offRoad = qName("joOff") !== "no";
      jo.offRoadFrom = qName("joOffFrom") || jo.offRoadFrom;
      jo.daysDown = qName("joDays") || jo.daysDown;
      jo.resolution = qName("joRes") || jo.resolution;
      jo.closerName = qName("joCloser") || jo.closerName;
      jo.checklist = jo.checklist || [];
      document.querySelectorAll("[data-chk]").forEach(function (box) {
        var i = Number(box.getAttribute("data-chk"));
        jo.checklist[i] = jo.checklist[i] || {};
        jo.checklist[i].done = box.checked;
      });
      document.querySelectorAll("[data-chk-who]").forEach(function (box) {
        var i = Number(box.getAttribute("data-chk-who"));
        jo.checklist[i] = jo.checklist[i] || {};
        jo.checklist[i].who = box.value;
      });
      document.querySelectorAll("[data-chk-when]").forEach(function (box) {
        var i = Number(box.getAttribute("data-chk-when"));
        jo.checklist[i] = jo.checklist[i] || {};
        jo.checklist[i].when = box.value;
      });
      var link = qName("linkUrl");
      if (link) {
        jo.proofs = jo.proofs || [];
        jo.proofs.push({ kind: "link", id: addLink(link, jo.id) });
      }
      if (name === "close-jo") {
        if (R.missingJoCloseFields(jo).length) return;
        jo.state = "Closed";
        jo.closedAt = manilaIso();
      }
      if (name === "reopen-jo") jo.state = "Reopened";
      var jid = jo.id || uid("jo");
      jo.id = jid;
      store.set("ops/" + jid, jo);
      syncRemote("ops/" + jid, jo);
      logActivity("jo", "ops/" + jid, jo.state + " " + (jo.title || ""));
      state.drafts.jo = null;
      state.filters.id = jid;
      state.lens = "detail";
      paint();
      return;
    }
    if (name === "open-task") {
      go("tasks", { id: el.getAttribute("data-id") || arg, lens: "detail" });
      return;
    }
    if (name === "save-task" || name === "close-task" || name === "reopen-task") {
      var task = state.filters.id ? store.getThawed("ops/" + state.filters.id) : (state.drafts.task || {});
      task.docType = "task";
      task.title = qName("taskTitle") || task.title;
      task.unitId = task.unitId || state.unitId;
      task.notes = qName("taskNotes") || task.notes;
      task.closerName = qName("taskCloser") || task.closerName;
      task.photos = task.photos || [];
      task.links = task.links || [];
      var tlink = qName("linkUrl");
      if (tlink) task.links.push({ kind: "link", id: addLink(tlink, task.id) });
      if (name === "close-task") {
        if (R.missingTaskCloseFields(task).length) return;
        task.state = "Done";
        task.closedAt = manilaIso();
      } else if (name === "reopen-task") {
        task.state = "Reopened";
      } else {
        task.state = task.state || "Open";
      }
      var tid = task.id || uid("task");
      task.id = tid;
      store.set("ops/" + tid, task);
      syncRemote("ops/" + tid, task);
      logActivity("task", "ops/" + tid, task.state + " " + (task.title || ""));
      state.drafts.task = null;
      state.filters.id = tid;
      paint();
      return;
    }
    if (name === "ask-del-task") {
      state.confirm = "del-task";
      paint();
      return;
    }
    if (name === "cancel-confirm") {
      state.confirm = null;
      paint();
      return;
    }
    if (name === "del-task") {
      if (state.filters.id) {
        store.del("ops/" + state.filters.id);
        logActivity("task-delete", "ops/" + state.filters.id, "");
      }
      state.confirm = null;
      state.filters.id = "";
      state.drafts.task = null;
      paint();
      return;
    }
    if (name === "post-store") {
      var st = state.drafts.store || {};
      st.kind = qName("stKind") || st.kind;
      st.date = qName("stDate") || st.date;
      st.item = qName("stItem") || st.item;
      st.qty = qName("stQty") || st.qty;
      st.supplier = st.kind === "out" ? "MOTORPOOL INVENTORY" : (qName("stSup") || st.supplier);
      st.note = qName("stNote") || st.note;
      if (R.isFuel(st.item)) return;
      if (!st.item || !st.qty) return;
      var sid = uid("store");
      st.docType = "store";
      store.set("ops/" + sid, st);
      syncRemote("ops/" + sid, st);
      logActivity("store", "ops/" + sid, st.kind + " " + st.item);
      state.drafts.store = { kind: st.kind, date: manilaDate(), item: "", qty: "", supplier: "", note: "" };
      paint();
      return;
    }
    if (name === "open-unit") {
      go("fleet", { unitId: el.getAttribute("data-id") || arg });
      return;
    }
    if (name === "save-unit") {
      var list = R.thaw({ units: units() }).units;
      var uidCur = state.unitId || state.filters.id;
      list.forEach(function (u, i) {
        if (u.id !== uidCur) return;
        document.querySelectorAll("[data-unit-k]").forEach(function (inp) {
          list[i][inp.getAttribute("data-unit-k")] = inp.value;
        });
        list[i].papers = list[i].papers || {};
        document.querySelectorAll("[data-paper]").forEach(function (box) {
          list[i].papers[box.getAttribute("data-paper")] = box.checked;
        });
      });
      store.set("master/units", { units: list });
      syncRemote("master/units", { units: list });
      logActivity("fleet", "master/units", uidCur);
      paint();
      return;
    }
    if (name === "office-setup") {
      var raw = qName("officeSetup");
      clearSensitiveInputs();
      if (!raw) return;
      var hash = await sha256hex(raw);
      raw = "";
      writeConfig({ officePassHash: hash });
      state.officeUnlocked = true;
      try { sessionStorage.setItem("mp-office", "1"); } catch (e) {}
      go(state.pendingOffice || "approvals", {}, { replace: true });
      return;
    }
    if (name === "office-unlock") {
      var typed = qName("officePass");
      clearSensitiveInputs();
      var entered = await sha256hex(typed);
      typed = "";
      var ok = false;
      try {
        var res2 = await fetch("/.netlify/functions/office", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "check", hash: entered }),
        });
        if (res2.ok) {
          var js = await res2.json();
          if (js.configured) ok = js.ok === true;
        }
      } catch (e) {}
      if (!ok) ok = R.checkOfficeHash(entered, cfg().officePassHash);
      var missEl = document.getElementById("office-miss");
      if (!ok) {
        if (missEl) missEl.textContent = "Does not match the stored hash.";
        return;
      }
      state.officeUnlocked = true;
      try { sessionStorage.setItem("mp-office", "1"); } catch (e) {}
      go(state.pendingOffice || "approvals", {}, { replace: true });
      return;
    }
  }

  function bind() {
    document.querySelectorAll("[data-go]").forEach(function (btn) {
      btn.onclick = function () { go(btn.getAttribute("data-go")); };
    });
    document.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.onclick = function (ev) {
        ev.preventDefault();
        handle(btn.getAttribute("data-act"), btn);
      };
    });
    var backBtn = document.getElementById("back-btn");
    backBtn.onclick = function () { back(); };
    document.getElementById("activity-pill").onclick = function () { refreshView(); };

    var ta = document.querySelector("[data-typeahead='unit']");
    if (ta) {
      ta.oninput = function () {
        state.typeahead = ta.value;
        var wrap = ta.closest(".typeahead");
        if (!wrap) return;
        var q = ta.value.toLowerCase();
        var list = units().filter(function (u) {
          return unitLabel(u).toLowerCase().indexOf(q) !== -1;
        }).slice(0, 12);
        var dd = wrap.querySelector(".dd");
        if (!dd) {
          dd = document.createElement("div");
          dd.className = "dd";
          wrap.appendChild(dd);
        }
        dd.innerHTML = list.length
          ? list.map(function (u) {
              return '<button type="button" data-act="pick-unit" data-id="' + esc(u.id) + '">' + esc(unitLabel(u)) + "</button>";
            }).join("")
          : '<div class="empty">No units match</div>';
        dd.querySelectorAll("[data-act]").forEach(function (b) {
          b.onclick = function (ev) {
            ev.preventDefault();
            handle(b.getAttribute("data-act"), b);
          };
        });
      };
    }

    document.querySelectorAll("[data-photo]").forEach(function (inp) {
      inp.onchange = function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        fileToPhoto(file, state.view).then(function (id) {
          var kind = inp.getAttribute("data-photo");
          if (kind === "gauge") {
            var d = state.drafts.reserve || draftReserve();
            d.gaugePhotoId = id;
            state.drafts.reserve = d;
          } else if (state.view === "workshop") {
            var jo = state.filters.id ? store.getThawed("ops/" + state.filters.id) : (state.drafts.jo || {});
            jo.proofs = jo.proofs || [];
            jo.proofs.push({ kind: "photo", id: id });
            if (state.filters.id) {
              store.set("ops/" + state.filters.id, jo);
            } else {
              state.drafts.jo = jo;
            }
          } else if (state.view === "tasks") {
            var task = state.filters.id ? store.getThawed("ops/" + state.filters.id) : (state.drafts.task || {});
            task.photos = task.photos || [];
            task.photos.push({ kind: "photo", id: id });
            if (state.filters.id) store.set("ops/" + state.filters.id, task);
            else state.drafts.task = task;
          }
          paint();
        });
      };
    });

    document.querySelectorAll("[data-cfg]").forEach(function (box) {
      box.onchange = function () {
        var patch = {};
        patch[box.getAttribute("data-cfg")] = box.checked;
        writeConfig(patch);
        paint();
      };
    });

    ["askQ", "joSearch"].forEach(function (n) {
      var el = document.querySelector("[name='" + n + "']");
      if (!el) return;
      el.onchange = function () {
        state.filters.q = el.value;
        paint();
      };
    });

    var stItem = document.querySelector("[name='stItem']");
    if (stItem) {
      stItem.oninput = function () {
        state.drafts.store = state.drafts.store || {};
        state.drafts.store.item = stItem.value;
        state.drafts.store.kind = qName("stKind") || state.drafts.store.kind;
        state.drafts.store.qty = qName("stQty");
        state.drafts.store.supplier = qName("stSup");
        paint();
      };
    }
  }

  function watchLive() {
    store.onChange(function () {
      var fp = store.fingerprint();
      if (state.lastFp && fp !== state.lastFp) {
        var entry = ["reserves", "vrf", "fuel-reserve", "workshop", "tasks", "store", "fleet"].indexOf(state.view) !== -1;
        if (entry) state.newActivity = true;
        else state.lastFp = fp;
        var pill = document.getElementById("activity-pill");
        if (pill && state.newActivity) pill.hidden = false;
      } else {
        state.lastFp = fp;
      }
    });
    setInterval(function () {
      if (!remoteDb) return;
      remoteDb.collection("reserves").get().then(function () {}).catch(function () {});
    }, 8000);
  }

  async function bootRemote() {
    if (!window.claude || typeof window.claude.use !== "function") return;
    try {
      var db = await window.claude.use("db");
      if (!db) return;
      remoteDb = db;
      var cols = ["master", "ledger", "ops", "reserves", "fuel", "photos", "config"];
      for (var i = 0; i < cols.length; i++) {
        try {
          var snap = await db.collection(cols[i]).get();
          (snap.docs || snap || []).forEach(function (doc) {
            var data = typeof doc.data === "function" ? doc.data() : doc.data;
            if (data) store.set(cols[i] + "/" + doc.id, data);
          });
        } catch (e) {}
      }
    } catch (e) {}
  }

  function boot() {
    var loaded = store.loadLocal();
    if (!loaded) store.seedIfEmpty(SEED.seedDocs());
    if (!store.get("master/units")) store.seedIfEmpty(SEED.seedDocs());
    try {
      if (sessionStorage.getItem("mp-office") === "1") state.officeUnlocked = true;
    } catch (e) {}
    state.lastFp = store.fingerprint();
    watchLive();
    paint();
    bootRemote().then(function () {
      state.lastFp = store.fingerprint();
      paint();
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
