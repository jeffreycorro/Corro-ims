/**
 * Unique LRF / LV series numbers for the CorConDev HR artifact.
 * Loaded by claude-shim.js (browser) and required by the db function (Node).
 * Does not rewrite the artifact.
 *
 * Why this exists: nextSeq / allocate only look at docreg. A Filed leave can
 * hold an LRF without a matching register row, and two allocate() calls that
 * miss the counters/LV lock write the same number onto two leaves. Import and
 * the manpower-report create path also skip a uniqueness check across both
 * stores. This companion refuses a second LRF2026-0169 (or any LV number) and
 * gives Jeffrey a one-shot renumber that updates the leave, its register row,
 * and signed-copy metadata.
 *
 * The artifact keeps `const S` — that is not window.S. An earlier wrap of
 * nextSeq / peekNo / allocate read host.S (empty on the live site) and
 * proposed LRF2026-0001 after a crash even when LRF2026-0142+ were on file.
 * Mint now binds the real store, takes max(original nextSeq, paper high,
 * series/counter lastByYear), and Drive-imported paper numbers bump that
 * high-water mark.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.hrLeaveNumbers = api;
  if (typeof window !== "undefined" && window) window.hrLeaveNumbers = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        api.attach(typeof window !== "undefined" ? window : root);
      });
    } else {
      api.attach(typeof window !== "undefined" ? window : root);
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LV = "LV";
  var DUP_CODE = "duplicate_leave_number";

  function values(map) {
    if (!map || typeof map !== "object") return [];
    if (Array.isArray(map)) return map.filter(Boolean);
    return Object.keys(map).map(function (k) {
      return map[k];
    }).filter(Boolean);
  }

  function str(v) {
    return v == null ? "" : String(v);
  }

  function foldName(s) {
    return str(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function nameLooksLike(empOrName, needle) {
    var n = typeof empOrName === "string" ? empOrName : (empOrName && empOrName.name) || "";
    var hay = foldName(n);
    var q = foldName(needle);
    return !!q && hay.indexOf(q) >= 0;
  }

  function normLeaveNo(no) {
    return str(no).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function sameLeaveNo(a, b) {
    var pa = parseLrf(a);
    var pb = parseLrf(b);
    if (pa && pb) return pa.year === pb.year && pa.seq === pb.seq;
    var na = normLeaveNo(a);
    var nb = normLeaveNo(b);
    return !!na && na === nb;
  }

  function parseLrf(no) {
    var n = normLeaveNo(no);
    if (!n) return null;
    var m = /^(?:LRF|LV)?((?:19|20)\d{2})(\d{1,6})$/.exec(n);
    if (!m) return null;
    var year = +m[1];
    var seq = parseInt(m[2], 10);
    if (!year || !seq) return null;
    return {
      year: year,
      seq: seq,
      key: "LRF" + year + "-" + String(seq).padStart(4, "0"),
    };
  }

  function formatLrf(year, seq, S, host) {
    if (host && typeof host.fmtNo === "function" && S && S.series && S.series[LV]) {
      return host.fmtNo(S.series[LV], seq, year);
    }
    return "LRF" + year + "-" + String(seq).padStart(4, "0");
  }

  function isLvDocreg(d) {
    if (!d) return false;
    if (str(d.seriesKey).toUpperCase() === LV) return true;
    return !!(d.no && parseLrf(d.no) && str(d.module).toLowerCase() === "leave");
  }

  function empName(S, rec) {
    if (!rec) return "another record";
    var e = S && S.employees && rec.empId ? S.employees[rec.empId] : null;
    return (e && e.name) || rec.title || rec.no || rec.id || "another record";
  }

  function findLeaveByNo(S, no, exceptId) {
    var except = str(exceptId);
    var hit = null;
    values(S && S.leaves).forEach(function (l) {
      if (!l || !l.no) return;
      if (except && str(l.id) === except) return;
      if (sameLeaveNo(l.no, no)) hit = l;
    });
    return hit;
  }

  function findLvDocregByNo(S, no, exceptId) {
    var except = str(exceptId);
    var hit = null;
    values(S && S.docreg).forEach(function (d) {
      if (!isLvDocreg(d) || !d.no) return;
      if (except && str(d.id) === except) return;
      if (sameLeaveNo(d.no, no)) hit = d;
    });
    return hit;
  }

  function numberInUse(S, no, except) {
    except = except || {};
    return findLeaveByNo(S, no, except.leaveId) || findLvDocregByNo(S, no, except.docregId);
  }

  function conflictMessage(no, where, who) {
    return (
      "Leave number " +
      str(no) +
      " is already on the " +
      where +
      " (" +
      who +
      "). Each LRF / LV series number can be issued once."
    );
  }

  function conflictForWrite(coll, id, data, S) {
    if (!data || !data.no) return null;
    if (coll === "leaves") {
      var otherLeave = findLeaveByNo(S, data.no, id);
      if (!otherLeave) return null;
      var currentLeave = S && S.leaves && id ? S.leaves[id] : null;
      if (currentLeave && sameLeaveNo(currentLeave.no, data.no)) return null;
      return {
        code: DUP_CODE,
        message: conflictMessage(data.no, "leave register", empName(S, otherLeave)),
        holder: otherLeave,
      };
    }
    if (coll === "docreg" && isLvDocreg(data)) {
      var otherReg = findLvDocregByNo(S, data.no, id);
      if (!otherReg) return null;
      var currentReg = S && S.docreg && id ? S.docreg[id] : null;
      if (currentReg && sameLeaveNo(currentReg.no, data.no)) return null;
      return {
        code: DUP_CODE,
        message: conflictMessage(data.no, "document register", empName(S, otherReg) || otherReg.no),
        holder: otherReg,
      };
    }
    return null;
  }

  function bumpSeq(mx, rec, year) {
    if (!rec) return mx;
    if ((rec.year | 0) === (year | 0) && (rec.seq | 0) > mx) mx = rec.seq | 0;
    var p = parseLrf(rec.no);
    if (p && p.year === (year | 0) && p.seq > mx) mx = p.seq;
    return mx;
  }

  function yearMapHigh(map, year) {
    if (!map || typeof map !== "object") return 0;
    var n = map[year] != null ? map[year] : map[String(year)];
    return n | 0;
  }

  function counterHigh(S, year) {
    var mx = 0;
    var y = year | 0;
    var ser = S && S.series && S.series[LV];
    if (ser) {
      mx = Math.max(mx, yearMapHigh(ser.lastByYear, y));
      if ((ser.year | 0) === y && (ser.lastSeq | 0) > mx) mx = ser.lastSeq | 0;
      if ((ser.year | 0) === y && (ser.seq | 0) > mx) mx = ser.seq | 0;
    }
    var c = S && S.counters;
    var lv = c && (c[LV] || c.LV || c.lv);
    if (lv && typeof lv === "object") {
      mx = Math.max(mx, bumpSeq(mx, lv, y), yearMapHigh(lv.lastByYear, y), lv.lastSeq | 0);
      if ((lv.year | 0) === y && (lv.seq | 0) > mx) mx = lv.seq | 0;
    }
    if (c && c[String(y)] != null) mx = Math.max(mx, c[String(y)] | 0);
    if (c && c[y] != null) mx = Math.max(mx, c[y] | 0);
    return mx;
  }

  function leavePaperHigh(S, year) {
    var mx = 0;
    values(S && S.leaves).forEach(function (l) {
      mx = bumpSeq(mx, l, year);
    });
    values(S && S.docreg).forEach(function (d) {
      if (!isLvDocreg(d)) return;
      mx = bumpSeq(mx, d, year);
    });
    values(S && S.filed).forEach(function (f) {
      var p = parseLrf(f && f.no);
      if (p && p.year === (year | 0) && p.seq > mx) mx = p.seq;
    });
    return Math.max(mx, counterHigh(S, year));
  }

  function noteUsedLeaveNo(no, hostOrS) {
    var p = parseLrf(no);
    if (!p) return 0;
    var S = hostOrS && hostOrS.S ? storeOf(hostOrS) : hostOrS || {};
    if (!S || typeof S !== "object") return p.seq;
    S.series = S.series || {};
    S.series[LV] = S.series[LV] || { key: LV, prefix: "LRF", pad: 4 };
    var ser = S.series[LV];
    ser.lastByYear = ser.lastByYear || {};
    if ((ser.lastByYear[p.year] | 0) < p.seq) ser.lastByYear[p.year] = p.seq;
    S.counters = S.counters || {};
    var lv = S.counters[LV] || {};
    lv.lastByYear = lv.lastByYear || {};
    if ((lv.lastByYear[p.year] | 0) < p.seq) lv.lastByYear[p.year] = p.seq;
    if ((lv.year | 0) === p.year || !lv.year) {
      lv.year = p.year;
      if ((lv.seq | 0) < p.seq) lv.seq = p.seq;
      if ((lv.lastSeq | 0) < p.seq) lv.lastSeq = p.seq;
    }
    S.counters[LV] = lv;
    return p.seq;
  }

  /* Artifact state is `const S` — a global lexical binding, not window.S.
     Attendance / payroll inject a classic script so companions can see it.
     Without that bind, nextSeq wraps read an empty store and restart at 0001. */
  function bindArtifactStore(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return {};
    if (host.__hrS && (host.__hrS.leaves || host.__hrS.docreg || host.__hrS.employees)) {
      host.S = host.__hrS;
      return host.__hrS;
    }
    if (host.S && (host.S.leaves || host.S.docreg || host.S.employees || host.S.series)) {
      return host.S;
    }
    try {
      if (typeof document !== "undefined" && document.createElement) {
        var s = document.createElement("script");
        s.textContent = "window.__hrS=S;window.S=S;";
        (document.documentElement || document.head || document.body).appendChild(s);
        if (s.parentNode) s.parentNode.removeChild(s);
      }
    } catch (e) {}
    if (host.__hrS) {
      host.S = host.__hrS;
      return host.__hrS;
    }
    return host.S || {};
  }

  function storeOf(host) {
    if (host && host.S && typeof host.S === "object" && (host.S.leaves || host.S.docreg || host.S.series || host.S.employees)) {
      return host.S;
    }
    return bindArtifactStore(host);
  }

  function nextFreeLeave(S, year, host) {
    year = year | 0 || new Date().getFullYear();
    var seq = leavePaperHigh(S, year) + 1;
    if (seq < 1) seq = 1;
    var guard = 0;
    var no = formatLrf(year, seq, S, host);
    while (numberInUse(S, no) && guard++ < 200) {
      seq += 1;
      no = formatLrf(year, seq, S, host);
    }
    return { year: year, seq: seq, no: no };
  }

  function listDuplicateLeaveNos(S) {
    var groups = {};
    values(S && S.leaves).forEach(function (l) {
      var p = parseLrf(l && l.no);
      if (!p) return;
      (groups[p.key] = groups[p.key] || []).push(l);
    });
    return Object.keys(groups)
      .filter(function (k) {
        return groups[k].length > 1;
      })
      .map(function (k) {
        return { no: k, leaves: groups[k] };
      });
  }

  function rowsToStore(rows) {
    var out = {};
    (rows || []).forEach(function (row) {
      if (!row) return;
      var id = row.id;
      var data = row.data != null ? row.data : row;
      if (id == null && data && data.id != null) id = data.id;
      if (id == null) return;
      out[id] = data;
    });
    return out;
  }

  function storesFromRows(leavesRows, docregRows, filedRows) {
    return {
      leaves: rowsToStore(leavesRows),
      docreg: rowsToStore(docregRows),
      filed: rowsToStore(filedRows),
    };
  }

  function replaceNoInText(text, fromNo, toNo) {
    var s = str(text);
    if (!s || !fromNo || !toNo) return s;
    var p = parseLrf(fromNo);
    if (!p) return s;
    return s.replace(
      /LRF\s*[-–]?\s*(?:19|20)\d{2}\s*[-–]?\s*\d{1,6}/gi,
      function (m) {
        return sameLeaveNo(m, fromNo) ? toNo : m;
      }
    );
  }

  function containsNo(text, no) {
    var s = str(text);
    if (!s || !no) return false;
    if (s.toUpperCase().indexOf(str(no).toUpperCase()) >= 0) return true;
    var p = parseLrf(no);
    return !!(p && sameLeaveNo(s, p.key));
  }

  function matchingDocreg(S, leave, fromNo) {
    var out = [];
    values(S && S.docreg).forEach(function (d) {
      if (!isLvDocreg(d) || !sameLeaveNo(d.no, fromNo)) return;
      if (d.refId && str(d.refId) === str(leave.id)) {
        out.push(d);
        return;
      }
      if (d.refId && str(d.refId) !== str(leave.id)) return;
      if (d.empId && str(d.empId) === str(leave.empId)) out.push(d);
    });
    return out;
  }

  function matchingFiled(S, leave, fromNo) {
    var out = [];
    values(S && S.filed).forEach(function (f) {
      if (!f || !sameLeaveNo(f.no, fromNo)) return;
      if (f.empId && str(f.empId) !== str(leave.empId)) return;
      out.push(f);
    });
    return out;
  }

  function rewriteLeaveformTitles(docsRow, fromNo, toNo) {
    if (!docsRow) return false;
    var hit = false;
    if (containsNo(docsRow.link, fromNo) || containsNo(docsRow.title, fromNo)) {
      if (docsRow.title) docsRow.title = replaceNoInText(docsRow.title, fromNo, toNo);
      hit = true;
    }
    (docsRow.links || []).forEach(function (x) {
      if (!x) return;
      if (containsNo(x.title, fromNo) || containsNo(x.url, fromNo)) {
        if (x.title) x.title = replaceNoInText(x.title, fromNo, toNo);
        hit = true;
      }
    });
    return hit;
  }

  function appendNote(notes, line) {
    notes = str(notes);
    if (notes.indexOf(line) >= 0) return notes;
    return notes ? notes + " — " + line : line;
  }

  function todayISO(host) {
    if (host && host.TODAY) return host.TODAY;
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function cloneOf(host, obj) {
    if (host && typeof host.clone === "function") return host.clone(obj);
    return JSON.parse(JSON.stringify(obj));
  }

  function planRenumber(S, opts, host) {
    opts = opts || {};
    var leave = null;
    if (opts.leaveId && S && S.leaves) leave = S.leaves[opts.leaveId];
    if (!leave && (opts.no || opts.employeeHint)) {
      values(S && S.leaves).forEach(function (l) {
        if (leave) return;
        if (opts.no && !sameLeaveNo(l.no, opts.no)) return;
        if (opts.employeeHint) {
          var e = S.employees && S.employees[l.empId];
          if (!nameLooksLike(e || l, opts.employeeHint)) return;
        }
        leave = l;
      });
    }
    if (!leave) {
      return { error: "Could not find that leave application." };
    }
    var year = (parseLrf(leave.no) || {}).year || new Date().getFullYear();
    var next = opts.toNo
      ? { no: str(opts.toNo).trim(), year: (parseLrf(opts.toNo) || {}).year || year, seq: (parseLrf(opts.toNo) || {}).seq }
      : nextFreeLeave(S, year, host);
    if (!next || !parseLrf(next.no)) {
      return { error: "The new leave number is not a valid LRF / LV series number." };
    }
    if (sameLeaveNo(leave.no, next.no)) {
      return { error: leave.no + " is already this application's number." };
    }
    if (numberInUse(S, next.no, { leaveId: leave.id })) {
      var holder = numberInUse(S, next.no, { leaveId: leave.id });
      return { error: conflictMessage(next.no, "portal", empName(S, holder)) };
    }
    return {
      leave: leave,
      from: leave.no,
      to: formatLrf(next.year || year, next.seq || parseLrf(next.no).seq, S, host),
      year: next.year || year,
      seq: next.seq || parseLrf(next.no).seq,
      docreg: matchingDocreg(S, leave, leave.no),
      filed: matchingFiled(S, leave, leave.no),
    };
  }

  function planLiveDuplicate169(S, host) {
    var dups = values(S && S.leaves).filter(function (l) {
      return sameLeaveNo(l.no, "LRF2026-0169");
    });
    var jaranilla = dups.filter(function (l) {
      return nameLooksLike((S.employees && S.employees[l.empId]) || l, "jaranilla");
    })[0];
    var cartuciano = dups.filter(function (l) {
      return nameLooksLike((S.employees && S.employees[l.empId]) || l, "cartuciano");
    })[0];
    if (!jaranilla) {
      return {
        error:
          "Could not find Jaranilla's LRF2026-0169. Open Leave and use Renumber leave, or call hrLeaveNumbers.renumber({ leaveId, toNo }).",
        duplicates: dups,
        cartuciano: cartuciano || null,
      };
    }
    var plan = planRenumber(
      S,
      { leaveId: jaranilla.id, toNo: (host && host.toNo) || undefined },
      host
    );
    plan.keep = cartuciano || null;
    plan.keepNo = "LRF2026-0169";
    return plan;
  }

  async function applyRenumber(host, plan) {
    if (!plan || plan.error) throw new Error((plan && plan.error) || "Nothing to renumber.");
    var S = host.S;
    var leave = S.leaves[plan.leave.id];
    if (!leave) throw new Error("That leave is no longer on file.");
    var toNo = plan.to;
    var parsed = parseLrf(toNo);
    var fromNo = leave.no;
    var next = cloneOf(host, leave);
    next.no = toNo;
    next.notes = appendNote(next.notes, "Renumbered from " + fromNo + " to " + toNo + " on " + todayISO(host));
    if (containsNo(next.signedTitle, fromNo)) {
      next.signedTitle = replaceNoInText(next.signedTitle, fromNo, toNo);
    }
    await host.put("leaves", next.id, next);

    var regs = matchingDocreg(S, next, fromNo);
    var i;
    for (i = 0; i < regs.length; i += 1) {
      var nd = cloneOf(host, regs[i]);
      nd.no = toNo;
      nd.year = parsed.year;
      nd.seq = parsed.seq;
      nd.refId = nd.refId || next.id;
      nd.empId = nd.empId || next.empId;
      nd.notes = appendNote(nd.notes, "Renumbered from " + fromNo + " to " + toNo);
      await host.put("docreg", nd.id, nd);
    }
    if (!regs.length && typeof host.uid === "function") {
      var rid = host.uid("d");
      await host.put("docreg", rid, {
        id: rid,
        no: toNo,
        seriesKey: LV,
        year: parsed.year,
        seq: parsed.seq,
        title: "Leave Request Form",
        tags: ["leave", "renumbered"],
        empId: next.empId || "",
        date: next.filedOn || todayISO(host),
        status: "Issued",
        module: "leave",
        refId: next.id,
        link: next.signedLink || "",
        notes: "Created when " + fromNo + " was renumbered to " + toNo,
        issuedBy: (S.settings && S.settings.hrHead) || "",
      });
    }

    var filed = matchingFiled(S, next, fromNo);
    for (i = 0; i < filed.length; i += 1) {
      var nf = cloneOf(host, filed[i]);
      nf.no = toNo;
      await host.put("filed", nf.id, nf);
    }

    var emp = S.employees && S.employees[next.empId];
    if (emp && emp.docs && emp.docs.leaveform) {
      var e2 = cloneOf(host, emp);
      if (rewriteLeaveformTitles(e2.docs.leaveform, fromNo, toNo)) {
        await host.put("employees", e2.id, e2);
      }
    }

    return { from: fromNo, to: toNo, leaveId: next.id, seq: parsed.seq };
  }

  function parseImportRows(raw) {
    raw = str(raw).trim();
    if (!raw) return [];
    var first = raw.split("\n")[0];
    var d = first.split("\t").length > first.split(",").length ? "\t" : ",";
    return raw
      .split("\n")
      .map(function (l) {
        return l.split(d).map(function (x) {
          return x.trim();
        });
      })
      .filter(function (r) {
        return r.length > 2 && r[0] && !/^form\s*no/i.test(r[0]);
      });
  }

  function importClashNos(S, rows) {
    var seen = {};
    var clashes = [];
    (rows || []).forEach(function (r) {
      var no = r && r[0];
      if (!no) return;
      var key = (parseLrf(no) || {}).key || normLeaveNo(no);
      if (seen[key] || numberInUse(S, no)) clashes.push(no);
      seen[key] = true;
    });
    return clashes;
  }

  function filterCitedJobs(jobs, S) {
    return (jobs || []).filter(function (j) {
      if (!j || !j.no) return true;
      return !findLeaveByNo(S, j.no);
    });
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  async function refreshStores(host) {
    var S = host.S;
    if (!S || !S.db) return;
    async function pull(name) {
      var snap = await S.db.collection(name).get();
      var nx = {};
      (snap.docs || []).forEach(function (d) {
        nx[d.id] = host.clone ? host.clone(d.data()) : d.data();
      });
      S[name] = nx;
    }
    try {
      await pull("docreg");
    } catch (e) {}
    try {
      await pull("leaves");
    } catch (e2) {}
  }

  async function allocateLeave(host, orig, meta) {
    var S = storeOf(host);
    host.S = S;
    var s = S.series && S.series[LV];
    if (!s) return orig.call(host, LV, meta);

    if (S.db) {
      var ref = S.db.doc("counters/" + LV);
      var lease = null;
      var i;
      for (i = 0; i < 8 && !(lease && lease.acquired); i += 1) {
        try {
          lease = await ref.acquire({
            holder: host.SESSION,
            ttlMs: 8000,
            ttlSeconds: 8,
          });
        } catch (e) {
          lease = null;
          break;
        }
        if (!(lease && lease.acquired)) await sleep(280);
      }
      if (!(lease && lease.acquired)) {
        if (host.toast) {
          host.toast(
            "Could not reserve a leave number — another save is using the LV series. Wait a moment and try again.",
            "err"
          );
        }
        return null;
      }
      await refreshStores(host);
    }

    var year = new Date().getFullYear();
    var next = nextFreeLeave(S, year, host);
    if (typeof host.nextSeq === "function") {
      var fromSeq = host.nextSeq._hrLeaveNo
        ? next.seq
        : Math.max(next.seq, host.nextSeq(LV, year) | 0);
      if (fromSeq > next.seq) next = { year: year, seq: fromSeq, no: formatLrf(year, fromSeq, S, host) };
    }
    var clash = numberInUse(S, next.no, { leaveId: meta && meta.refId });
    if (clash) {
      if (host.toast) host.toast(conflictMessage(next.no, "portal", empName(S, clash)), "err");
      return null;
    }

    var entry = Object.assign(
      {
        id: host.uid ? host.uid("d") : "d" + Date.now().toString(36),
        no: next.no,
        seriesKey: LV,
        year: next.year,
        seq: next.seq,
        title: "",
        tags: [],
        empId: "",
        date: host.TODAY || todayISO(host),
        status: "Draft",
        module: "",
        refId: "",
        link: "",
        notes: "",
        issuedBy: (S.settings && S.settings.hrHead) || "",
      },
      meta || {}
    );
    entry.no = next.no;
    entry.seriesKey = LV;
    entry.year = next.year;
    entry.seq = next.seq;
    await host.put("docreg", entry.id, entry);
    noteUsedLeaveNo(entry.no, S);
    return entry;
  }

  function isDupError(err) {
    if (!err) return false;
    if (err.code === DUP_CODE) return true;
    if (err.body && err.body.code === DUP_CODE) return true;
    return Number(err.status) === 409;
  }

  function wrapPaperHigh(host) {
    var orig = host.paperHigh;
    if (typeof orig !== "function" || orig._hrLeaveNo) return false;
    host.paperHigh = function (key, year) {
      var mx = orig.apply(this, arguments) || 0;
      if (str(key) !== LV) return mx;
      return Math.max(mx, leavePaperHigh(storeOf(host), year));
    };
    host.paperHigh._hrLeaveNo = true;
    return true;
  }

  function wrapNextSeq(host) {
    var orig = host.nextSeq;
    if (typeof orig !== "function" || orig._hrLeaveNo) return false;
    host.nextSeq = function (key, year) {
      var fromOrig = orig.apply(this, arguments) | 0;
      if (str(key) !== LV) return fromOrig;
      /* Always keep the artifact's own max(leaves/docreg)+1, even when
         host.S is empty after a crash/reload. Never restart at 0001
         while a higher number is already on file. */
      var fromPaper = nextFreeLeave(storeOf(host), year, host).seq | 0;
      return Math.max(1, fromOrig, fromPaper);
    };
    host.nextSeq._hrLeaveNo = true;
    return true;
  }

  function wrapPeekNo(host) {
    var orig = host.peekNo;
    if (typeof orig !== "function" || orig._hrLeaveNo) return false;
    host.peekNo = function (key) {
      var fromOrig = orig.apply(this, arguments);
      if (str(key) !== LV) return fromOrig;
      var S = storeOf(host);
      var year = new Date().getFullYear();
      var next = nextFreeLeave(S, year, host);
      var origP = parseLrf(fromOrig);
      if (origP && origP.year === next.year && origP.seq > next.seq) {
        return formatLrf(origP.year, origP.seq, S, host);
      }
      if ((!fromOrig || parseLrf(fromOrig)) && next.seq >= 1) return next.no;
      return fromOrig || next.no;
    };
    host.peekNo._hrLeaveNo = true;
    return true;
  }

  function wrapAllocate(host) {
    var orig = host.allocate;
    if (typeof orig !== "function" || orig._hrLeaveNo) return false;
    host.allocate = function (key, meta) {
      if (str(key) !== LV) return orig.apply(this, arguments);
      return allocateLeave(host, orig, meta);
    };
    host.allocate._hrLeaveNo = true;
    return true;
  }

  function wrapPut(host) {
    var orig = host.put;
    if (typeof orig !== "function" || orig._hrLeaveNo) return false;
    host.put = function (coll, id, obj) {
      var S = storeOf(host);
      var conflict = conflictForWrite(coll, id, obj, S);
      if (conflict) {
        if (host.toast) host.toast(conflict.message, "err");
        var err = new Error(conflict.message);
        err.code = DUP_CODE;
        return Promise.reject(err);
      }
      var prev = S && S[coll] ? S[coll][id] : undefined;
      var had = !!(S && S[coll] && Object.prototype.hasOwnProperty.call(S[coll], id));
      return Promise.resolve(orig.apply(this, arguments)).then(function (out) {
        if (obj && obj.no && (coll === "leaves" || (coll === "docreg" && isLvDocreg(obj)))) {
          noteUsedLeaveNo(obj.no, S);
        }
        return out;
      }).catch(function (e) {
        if (isDupError(e) && S && S[coll]) {
          if (had) S[coll][id] = prev;
          else delete S[coll][id];
          if (host.toast) {
            host.toast(
              (e.body && e.body.error) || e.message || "That leave number is already in use.",
              "err"
            );
          }
        }
        throw e;
      });
    };
    host.put._hrLeaveNo = true;
    return true;
  }

  function wrapPutMany(host) {
    var orig = host.putMany;
    if (typeof orig !== "function" || orig._hrLeaveNo) return false;
    host.putMany = function (coll, entries, onProgress) {
      var S = storeOf(host);
      var seen = {};
      var i;
      for (i = 0; i < (entries || []).length; i += 1) {
        var pair = entries[i];
        var id = pair && pair[0];
        var obj = pair && pair[1];
        var conflict = conflictForWrite(coll, id, obj, S);
        if (!conflict && obj && obj.no && (coll === "leaves" || (coll === "docreg" && isLvDocreg(obj)))) {
          var key = (parseLrf(obj.no) || {}).key || normLeaveNo(obj.no);
          if (key && seen[key]) {
            conflict = {
              code: DUP_CODE,
              message: conflictMessage(obj.no, "same import", "another row in this batch"),
            };
          }
          if (key) seen[key] = true;
        }
        if (conflict) {
          if (host.toast) host.toast(conflict.message, "err");
          var err = new Error(conflict.message);
          err.code = DUP_CODE;
          return Promise.reject(err);
        }
      }
      return Promise.resolve(orig.apply(this, arguments)).then(function (out) {
        for (i = 0; i < (entries || []).length; i += 1) {
          var rec = entries[i] && entries[i][1];
          if (rec && rec.no && (coll === "leaves" || (coll === "docreg" && isLvDocreg(rec)))) {
            noteUsedLeaveNo(rec.no, S);
          }
        }
        return out;
      });
    };
    host.putMany._hrLeaveNo = true;
    return true;
  }

  function wrapCitedLeaveJobs(host) {
    var orig = host.citedLeaveJobs;
    if (typeof orig !== "function" || orig._hrLeaveNo) return false;
    host.citedLeaveJobs = function () {
      return filterCitedJobs(orig.apply(this, arguments) || [], storeOf(host));
    };
    host.citedLeaveJobs._hrLeaveNo = true;
    return true;
  }

  function wrapImportRecords(host) {
    var name = typeof host.importRecordsPaste === "function" ? "importRecordsPaste" : "importRecords";
    var orig = host[name];
    if (typeof orig !== "function" || orig._hrLeaveNo) return false;
    host[name] = function (kind) {
      var out = orig.apply(this, arguments);
      var go = host.document && host.document.getElementById("ir-go");
      if (go && !go._hrLeaveNo && str(kind) === "leave") {
        var prev = go.onclick;
        go._hrLeaveNo = true;
        go.onclick = function () {
          var ta = host.document.getElementById("ir-data");
          var clashes = importClashNos(storeOf(host), parseImportRows(ta && ta.value));
          if (clashes.length) {
            if (host.toast) {
              host.toast(
                "These leave numbers are already on file (or repeated in the paste) and were not imported: " +
                  clashes.join(", "),
                "err"
              );
            }
            return null;
          }
          return prev ? prev.apply(this, arguments) : null;
        };
      }
      return out;
    };
    host[name]._hrLeaveNo = true;
    return true;
  }

  function esc(s) {
    return str(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureStyles(doc) {
    if (!doc || !doc.createElement || (doc.getElementById && doc.getElementById("hr-leave-no-styles"))) {
      return;
    }
    var style = doc.createElement("style");
    style.id = "hr-leave-no-styles";
    style.textContent =
      ".hr-lv-dup{margin:0 0 14px;border-left:3px solid var(--crit,#9c3131);padding:10px 12px}" +
      ".hr-lv-dup b{display:block;margin-bottom:4px}";
    (doc.head || doc.documentElement).appendChild(style);
  }

  function injectChrome(host) {
    var S = storeOf(host);
    host.S = S;
    var doc = host.document;
    if (!S || !S.ui || S.ui.view !== "leave" || !doc) return;
    var view = doc.getElementById("view") || doc.body;
    if (!view || !view.querySelector) return;
    ensureStyles(doc);

    var bar = view.querySelector(".row");
    if (bar && !doc.getElementById("hr-lv-renumber")) {
      var btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.id = "hr-lv-renumber";
      btn.textContent = "Renumber leave";
      btn.title = "Operator tool: change one Filed/issued LRF and its register row";
      btn.onclick = function () {
        openRenumberModal(host, {});
      };
      bar.appendChild(btn);
    }

    var dups = listDuplicateLeaveNos(S);
    var existing = doc.getElementById("hr-lv-dup-banner");
    if (!dups.length) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    var html =
      '<div class="card hr-lv-dup" id="hr-lv-dup-banner"><div class="card-b">' +
      "<b>Duplicate leave numbers on file</b>" +
      dups
        .map(function (g) {
          return (
            '<div class="note" style="margin-top:6px"><b class="mono">' +
            esc(g.no) +
            "</b> is on " +
            g.leaves
              .map(function (l) {
                return esc(empName(S, l)) + " (" + esc(l.status || "") + ")";
              })
              .join(" · ") +
            "</div>"
          );
        })
        .join("") +
      '<div class="row" style="margin-top:8px"><button type="button" class="btn sm pri" id="hr-lv-fix-dups">Renumber the extra copy</button>' +
      "<span class=\"hint\">Keep Cartuciano on LRF2026-0169; Jaranilla takes the next free number.</span></div>" +
      "</div></div>";
    if (existing) {
      existing.outerHTML = html;
    } else if (bar && bar.parentNode) {
      var wrap = doc.createElement("div");
      wrap.innerHTML = html;
      bar.parentNode.insertBefore(wrap.firstChild, bar.nextSibling);
    }
    var fix = doc.getElementById("hr-lv-fix-dups");
    if (fix) {
      fix.onclick = function () {
        var live = planLiveDuplicate169(S, host);
        if (live && live.leave) openRenumberModal(host, { leaveId: live.leave.id, toNo: live.to });
        else openRenumberModal(host, {});
      };
    }
  }

  function openRenumberModal(host, opts) {
    var S = storeOf(host);
    host.S = S;
    var leaves = values(S && S.leaves).slice().sort(function (a, b) {
      return str(b.from).localeCompare(str(a.from)) || str(a.no).localeCompare(str(b.no));
    });
    var preset = opts && opts.leaveId;
    if (!preset) {
      var live = planLiveDuplicate169(S, host);
      if (live && live.leave) preset = live.leave.id;
    }
    var year = new Date().getFullYear();
    var suggested = (opts && opts.toNo) || nextFreeLeave(S, year, host).no;
    var options = leaves
      .map(function (l) {
        return (
          '<option value="' +
          esc(l.id) +
          '"' +
          (l.id === preset ? " selected" : "") +
          ">" +
          esc(l.no || "(no number)") +
          " — " +
          esc(empName(S, l)) +
          " — " +
          esc(l.status || "") +
          "</option>"
        );
      })
      .join("");
    if (!host.openModal) {
      if (host.toast) host.toast("Open the leave page in the portal to renumber.", "err");
      return;
    }
    host.openModal({
      title: "Renumber a leave",
      body:
        '<div class="stack">' +
        '<div class="note">The number field on a Filed leave is not editable. This updates the leave row, ' +
        "the matching LV register entry, and signed-copy titles that still carry the old LRF. " +
        "Cartuciano keeps <b>LRF2026-0169</b>. Jaranilla should take the next free number " +
        "(likely <b>LRF2026-0171</b> if 0170 is already issued).</div>" +
        '<div class="f"><label>Leave to renumber</label><select id="hr-lv-ren-id">' +
        (options || "<option value=\"\">No leave records</option>") +
        "</select></div>" +
        '<div class="f"><label>New number</label><input id="hr-lv-ren-to" class="mono" value="' +
        esc(suggested) +
        '">' +
        '<span class="hint">Must be unused on leaves and on the LV document register. Next new leave after this becomes max(seq)+1.</span></div>' +
        "</div>",
      foot:
        '<button class="btn" id="hr-lv-ren-cancel">Cancel</button>' +
        '<button class="btn pri" id="hr-lv-ren-go">Renumber</button>',
    });
    var cancel = host.document.getElementById("hr-lv-ren-cancel");
    if (cancel) cancel.onclick = function () { if (host.closeModal) host.closeModal(); };
    var go = host.document.getElementById("hr-lv-ren-go");
    if (go) {
      go.onclick = function () {
        return runRenumberFromModal(host);
      };
    }
  }

  async function runRenumberFromModal(host) {
    var idEl = host.document.getElementById("hr-lv-ren-id");
    var toEl = host.document.getElementById("hr-lv-ren-to");
    var plan = planRenumber(
      storeOf(host),
      { leaveId: idEl && idEl.value, toNo: toEl && toEl.value },
      host
    );
    if (plan.error) {
      if (host.toast) host.toast(plan.error, "err");
      return;
    }
    var ok = true;
    if (typeof host.askConfirm === "function") {
      ok = await host.askConfirm(
        "Renumber " +
          plan.from +
          " (" +
          empName(host.S, plan.leave) +
          ") to " +
          plan.to +
          "?\n\nThe old number stays unused. The next new leave will be " +
          formatLrf(plan.year, plan.seq + 1, host.S, host) +
          ".",
        { yes: "Renumber" }
      );
    }
    if (!ok) return;
    try {
      var out = await applyRenumber(host, plan);
      if (host.closeModal) host.closeModal();
      if (host.toast) host.toast("Renumbered " + out.from + " → " + out.to, "ok");
      if (typeof host.render === "function") host.render();
      return out;
    } catch (e) {
      if (host.toast) host.toast(e.message || "Could not renumber.", "err");
    }
  }

  async function renumber(opts, host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host || !host.S) throw new Error("Open the HR portal and sign in first.");
    var plan = planRenumber(host.S, opts || {}, host);
    return applyRenumber(host, plan);
  }

  async function fixLiveDuplicate169(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host || !host.S) throw new Error("Open the HR portal and sign in first.");
    var plan = planLiveDuplicate169(host.S, host);
    var out = await applyRenumber(host, plan);
    if (typeof host.render === "function") host.render();
    if (host.toast) {
      host.toast(
        "Jaranilla is now " +
          out.to +
          ". Cartuciano keeps LRF2026-0169. Next new leave: " +
          formatLrf(parseLrf(out.to).year, out.seq + 1, host.S, host) +
          ".",
        "ok"
      );
    }
    return out;
  }

  function wrapRender(host) {
    if (typeof host.render !== "function" || host.render._hrLeaveNo) return false;
    var orig = host.render;
    host.render = function () {
      var r = orig.apply(this, arguments);
      try {
        patchGlobals(host);
        injectChrome(host);
      } catch (e) {}
      return r;
    };
    host.render._hrLeaveNo = true;
    return true;
  }

  function patchGlobals(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return {};
    bindArtifactStore(host);
    return {
      paperHigh: wrapPaperHigh(host),
      nextSeq: wrapNextSeq(host),
      peekNo: wrapPeekNo(host),
      allocate: wrapAllocate(host),
      put: wrapPut(host),
      putMany: wrapPutMany(host),
      citedLeaveJobs: wrapCitedLeaveJobs(host),
      importRecords: wrapImportRecords(host),
      render: wrapRender(host),
    };
  }

  function attach(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return api;
    if (api.attached && host.hrLeaveNumbers === api && host.put && host.put._hrLeaveNo) {
      injectChrome(host);
      return api;
    }
    patchGlobals(host);
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
          patchGlobals(host);
          injectChrome(host);
        });
      } else {
        injectChrome(host);
      }
    }
    api.attached = true;
    return api;
  }

  var api = {
    attached: false,
    attach: attach,
    install: attach,
    patchGlobals: patchGlobals,
    injectChrome: injectChrome,
    openRenumberModal: openRenumberModal,
    renumber: renumber,
    fixLiveDuplicate169: fixLiveDuplicate169,
    planRenumber: planRenumber,
    planLiveDuplicate169: planLiveDuplicate169,
    applyRenumber: applyRenumber,
    parseLrf: parseLrf,
    sameLeaveNo: sameLeaveNo,
    normLeaveNo: normLeaveNo,
    formatLrf: formatLrf,
    isLvDocreg: isLvDocreg,
    findLeaveByNo: findLeaveByNo,
    findLvDocregByNo: findLvDocregByNo,
    numberInUse: numberInUse,
    conflictForWrite: conflictForWrite,
    leavePaperHigh: leavePaperHigh,
    nextFreeLeave: nextFreeLeave,
    noteUsedLeaveNo: noteUsedLeaveNo,
    bindArtifactStore: bindArtifactStore,
    storeOf: storeOf,
    counterHigh: counterHigh,
    listDuplicateLeaveNos: listDuplicateLeaveNos,
    matchingDocreg: matchingDocreg,
    replaceNoInText: replaceNoInText,
    importClashNos: importClashNos,
    parseImportRows: parseImportRows,
    filterCitedJobs: filterCitedJobs,
    rowsToStore: rowsToStore,
    storesFromRows: storesFromRows,
    nameLooksLike: nameLooksLike,
    DUP_CODE: DUP_CODE,
  };

  return api;
});
