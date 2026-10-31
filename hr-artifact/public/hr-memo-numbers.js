/**
 * Company memorandum numbers for the CorConDev HR artifact.
 * Loaded by claude-shim.js (browser) and required by the db function (Node).
 *
 * Filed memoranda are numbered C.M. {year} - {seq} with a two-digit sequence
 * (C.M. 2026 - 15). The series resets each calendar year.
 *
 * Rule (2026-10-31): the next number is the LOWEST sequence for that year
 * that no saved memo record holds (draft, issued, signed or read off Drive,
 * i.e. a row in the memos collection). Document-register rows, filed forms,
 * the series counter and abandoned draws do not consume numbers — a memo
 * that drew 16, 22, 23, 25, 28 and 29 before it was saved leaves those
 * numbers free for the next memo.
 *
 * An existing memo keeps its number when it is edited, re-saved or gets its
 * signed scan; it never draws a new one and no new register row is written
 * for it. A number held by a different memo is refused and the warning names
 * the next free number. Two saves in one browser cannot take the same
 * sequence; the database unique index on memos is the backstop.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.hrMemoNumbers = api;
  if (typeof window !== "undefined" && window) window.hrMemoNumbers = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CM = "CM";
  var DUP_CODE = "duplicate_memo_number";
  var inflight = {};

  function str(v) {
    return v == null ? "" : String(v);
  }

  function values(map) {
    if (!map || typeof map !== "object") return [];
    if (Array.isArray(map)) return map.filter(Boolean);
    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .filter(Boolean);
  }

  function rowsToMap(rows) {
    var out = {};
    (rows || []).forEach(function (row) {
      if (!row) return;
      var id = row.id;
      var data = row.data != null ? row.data : row;
      if (!id && data && data.id) id = data.id;
      if (!id) return;
      if (data && typeof data === "object" && !data.id) {
        data = Object.assign({ id: id }, data);
      }
      out[id] = data;
    });
    return out;
  }

  function storeFromLists(lists) {
    lists = lists || {};
    return {
      memos: rowsToMap(lists.memos),
      docreg: rowsToMap(lists.docreg),
      filed: rowsToMap(lists.filed),
      series: lists.series || {},
      counters: lists.counters || {},
    };
  }

  function seriesOf(S) {
    var ser = S && S.series && S.series[CM];
    return (
      ser || {
        key: CM,
        prefix: "C.M.",
        pad: 2,
        pattern: "{PREFIX} {YYYY} - {NNNN}",
      }
    );
  }

  function parseCm(no) {
    var flat = str(no).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!flat) return null;
    var m = /^CM((?:19|20)\d{2})0*(\d{1,6})$/.exec(flat);
    if (!m) return null;
    var year = +m[1];
    var seq = parseInt(m[2], 10);
    if (!year || !seq) return null;
    return { year: year, seq: seq, key: "CM|" + year + "|" + seq };
  }

  function formatCm(year, seq, S) {
    var ser = seriesOf(S);
    var prefix = ser.prefix || "C.M.";
    var pad = ser.pad || 2;
    var pattern = ser.pattern || "{PREFIX} {YYYY} - {NNNN}";
    return String(pattern)
      .replace(/\{ORG\}-?/g, "")
      .replace(/\{PREFIX\}/g, prefix)
      .replace(/\{YYYY\}/g, String(year))
      .replace(/\{YY\}/g, String(year).slice(-2))
      .replace(/\{NNNN\}/g, String(seq).padStart(pad, "0"));
  }

  function canonical(no, S) {
    var parsed = parseCm(no);
    if (!parsed) return str(no).trim();
    return formatCm(parsed.year, parsed.seq, S);
  }

  function sameNo(a, b) {
    var pa = parseCm(a);
    var pb = parseCm(b);
    if (pa && pb) return pa.year === pb.year && pa.seq === pb.seq;
    var na = str(a).trim().toUpperCase().replace(/\s+/g, " ");
    var nb = str(b).trim().toUpperCase().replace(/\s+/g, " ");
    return !!na && na === nb;
  }

  function isCmDoc(d) {
    if (!d) return false;
    if (str(d.seriesKey).toUpperCase() === CM) return true;
    return !!parseCm(d.no);
  }

  function hold(no, id) {
    var p = parseCm(no);
    if (!p) return;
    inflight[p.key] = str(id || "");
  }

  function release(no, id) {
    var p = parseCm(no);
    if (!p) return;
    if (!id || inflight[p.key] === str(id)) delete inflight[p.key];
  }

  function heldByOther(no, id) {
    var p = parseCm(no);
    if (!p || !Object.prototype.hasOwnProperty.call(inflight, p.key)) return false;
    return inflight[p.key] !== str(id || "");
  }

  function memoSeq(rec, year) {
    if (!rec) return 0;
    var p = parseCm(rec.no);
    if (p) return p.year === (year | 0) ? p.seq : 0;
    return 0;
  }

  function usedSeqs(S, year, exceptId) {
    var y = year | 0;
    var used = {};
    var except = str(exceptId);
    values(S && S.memos).forEach(function (m) {
      if (except && str(m.id) === except) return;
      var n = memoSeq(m, y);
      if (n) used[n] = true;
    });
    Object.keys(inflight).forEach(function (k) {
      var parts = k.split("|");
      if (parts[0] !== CM || (parts[1] | 0) !== y) return;
      if (except && inflight[k] === except) return;
      used[parts[2] | 0] = true;
    });
    return used;
  }

  /* Highest sequence on a saved memo (for display/diagnostics only). */
  function highSeq(S, year) {
    var mx = 0;
    var used = usedSeqs(S, year);
    Object.keys(used).forEach(function (k) {
      if ((k | 0) > mx) mx = k | 0;
    });
    return mx;
  }

  function seqTaken(S, year, seq, exceptId) {
    var n = seq | 0;
    if (!n) return false;
    return !!usedSeqs(S, year, exceptId)[n];
  }

  function nextNo(S, year, exceptId) {
    var y = (year | 0) || new Date().getFullYear();
    var used = usedSeqs(S, y, exceptId);
    var seq = 1;
    while (used[seq] && seq < 1000000) seq += 1;
    return { year: y, seq: seq, no: formatCm(y, seq, S) };
  }

  /* Memos and CM register rows whose numbers look wrong: a memo past the
     first gap, two memos on one number, a memo with several register rows,
     register rows whose number no memo holds. Read-only. */
  function suspects(S, year) {
    var y = (year | 0) || new Date().getFullYear();
    var out = [];
    var memos = values(S && S.memos);
    var bySeq = {};
    memos.forEach(function (m) {
      var n = memoSeq(m, y);
      if (!n) return;
      (bySeq[n] = bySeq[n] || []).push(m);
    });
    var gap = 1;
    while (bySeq[gap]) gap += 1;
    Object.keys(bySeq).forEach(function (k) {
      var n = k | 0;
      if (bySeq[n].length > 1) {
        bySeq[n].forEach(function (m) {
          out.push({ kind: "memo", id: m.id, no: m.no, reason: "number shared by " + bySeq[n].length + " memos" });
        });
      }
      if (n > gap) {
        bySeq[n].forEach(function (m) {
          out.push({ kind: "memo", id: m.id, no: m.no, date: m.date || "", subject: labelOf(m),
            reason: "past the gap — " + formatCm(y, gap, S) + " is unused by any memo" });
        });
      }
    });
    values(S && S.docreg).forEach(function (d) {
      if (!isCmDoc(d)) return;
      var p = parseCm(d.no);
      if (!p || p.year !== y) return;
      var memo = d.refId && S.memos ? S.memos[d.refId] : null;
      var reason = "";
      if (!memo) reason = "register row for a memo that is not saved";
      else if (!sameNo(memo.no, d.no)) reason = "leftover draw — memo " + d.refId + " is " + (memo.no || "unnumbered");
      if (reason) out.push({ kind: "docreg", id: d.id, no: d.no, refId: d.refId || "", status: d.status || "", reason: reason });
    });
    return out;
  }

  function labelOf(rec) {
    if (!rec) return "";
    return str(rec.subject || rec.title || rec.fileTitle || rec.no).trim();
  }

  function findMemo(S, no, exceptId) {
    var hit = null;
    var except = str(exceptId);
    values(S && S.memos).forEach(function (m) {
      if (!m || !m.no) return;
      if (except && str(m.id) === except) return;
      if (sameNo(m.no, no)) hit = m;
    });
    return hit;
  }

  function conflictMessage(no, where, who, S) {
    var parsed = parseCm(no);
    var year = parsed ? parsed.year : new Date().getFullYear();
    var next = nextNo(S, year);
    var tail = who ? " (" + who + ")" : "";
    return (
      str(no) +
      " is already on the " +
      where +
      tail +
      ". Each company memorandum number is used once in a year. The next free number is " +
      next.no +
      "."
    );
  }

  function conflictForWrite(coll, id, data, S) {
    if (!data || !str(data.no).trim()) return null;
    S = S || {};
    var no = canonical(data.no, S);
    if (coll === "memos") {
      var prev = S.memos && S.memos[id];
      if (prev && sameNo(prev.no, no)) return null;
      if (heldByOther(no, id)) {
        return {
          code: DUP_CODE,
          message: conflictMessage(no, "memo being saved", "", S),
          holder: null,
        };
      }
      var memo = findMemo(S, no, id);
      if (memo) {
        return {
          code: DUP_CODE,
          message: conflictMessage(no, "memo register", labelOf(memo), S),
          holder: memo,
        };
      }
      return null;
    }
    if (coll === "docreg" && isCmDoc(data)) {
      var prevReg = S.docreg && S.docreg[id];
      if (prevReg && sameNo(prevReg.no, no)) return null;
      var otherMemo = findMemo(S, no, data.refId);
      if (otherMemo) {
        return {
          code: DUP_CODE,
          message: conflictMessage(no, "memo register", labelOf(otherMemo), S),
          holder: otherMemo,
        };
      }
    }
    return null;
  }

  function applyTypedNumber(S, id, obj, prev) {
    obj = obj && typeof obj === "object" ? obj : {};
    var raw = str(obj.no).trim();
    if (!raw || raw === "assigned when you save") {
      obj.no = "";
      return { memo: obj, conflict: null };
    }
    obj.no = canonical(raw, S);
    if (prev && sameNo(prev.no, obj.no)) return { memo: obj, conflict: null };
    return { memo: obj, conflict: conflictForWrite("memos", id, obj, S) };
  }

  function readSnap(snap) {
    var rows = [];
    var docs = snap && snap.docs;
    if (!docs || !docs.forEach) return rows;
    docs.forEach(function (d) {
      if (!d) return;
      var data = typeof d.data === "function" ? d.data() : d.data;
      rows.push({ id: d.id, data: data });
    });
    return rows;
  }

  function refresh(host) {
    var S = host && host.S;
    if (!S || !S.db || !S.db.collection) return Promise.resolve(S || null);
    return Promise.all([
      S.db.collection("memos").get(),
      S.db.collection("docreg").get(),
      S.db.collection("filed").get(),
    ])
      .then(function (snaps) {
        ["memos", "docreg", "filed"].forEach(function (name, i) {
          if (!S[name] || typeof S[name] !== "object") S[name] = {};
          readSnap(snaps[i]).forEach(function (row) {
            var data = row.data && typeof row.data === "object" ? row.data : {};
            if (!data.id) data.id = row.id;
            S[name][row.id] = data;
          });
        });
        return S;
      })
      .catch(function () {
        return S;
      });
  }

  function memoNumberInput(host) {
    var doc = host && host.document;
    if (!doc || !doc.getElementById) return null;
    return doc.getElementById("m-no");
  }

  function paintSuggestion(host) {
    var input = memoNumberInput(host);
    if (!input || input.disabled) return "";
    if (str(input.getAttribute && input.getAttribute("data-suggest")) !== "1") return "";
    var next = nextNo(host && host.S, new Date().getFullYear());
    if (next && next.no && input.value !== next.no) input.value = next.no;
    return next ? next.no : "";
  }

  function advanceSuggestion(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return Promise.resolve("");
    return refresh(host).then(function () {
      return paintSuggestion(host);
    });
  }

  function syncDocreg(host, memo, prev) {
    if (!host || typeof host.put !== "function" || !memo || !memo.id || !str(memo.no).trim()) {
      return Promise.resolve(null);
    }
    var S = host.S || {};
    var parsed = parseCm(memo.no);
    var match = null;
    values(S.docreg).forEach(function (d) {
      if (!d || str(d.refId) !== str(memo.id)) return;
      if (!isCmDoc(d)) return;
      if (sameNo(d.no, memo.no)) match = d;
    });
    /* An existing memo keeps its number: refresh its matching register row,
       never write a new register number for it. */
    if (!match && prev && str(prev.no).trim()) return Promise.resolve(null);
    var row = match
      ? Object.assign({}, match)
      : {
          id: typeof host.uid === "function" ? host.uid("d") : "d_" + Date.now().toString(36),
          seriesKey: CM,
          module: "memo",
          refId: memo.id,
          tags: [],
          link: memo.link || "",
          notes: "",
          issuedBy: (S.settings && S.settings.hrHead) || "",
        };
    row.no = memo.no;
    row.seriesKey = CM;
    row.module = row.module || "memo";
    row.refId = memo.id;
    row.title = memo.subject || row.title || "";
    row.tags = memo.tags || row.tags || [];
    row.status = memo.status || row.status || "Draft";
    row.date = memo.date || row.date || "";
    if (memo.audience === "Individual") row.empId = memo.audienceDetail || "";
    if (parsed) {
      row.year = parsed.year;
      row.seq = parsed.seq;
    }
    if (!S.docreg || typeof S.docreg !== "object") S.docreg = {};
    S.docreg[row.id] = row;
    return Promise.resolve(host.put("docreg", row.id, row)).then(function () {
      return row;
    });
  }

  return {
    CM: CM,
    DUP_CODE: DUP_CODE,
    parseCm: parseCm,
    formatCm: formatCm,
    canonical: canonical,
    sameNo: sameNo,
    isCmDoc: isCmDoc,
    highSeq: highSeq,
    usedSeqs: usedSeqs,
    suspects: suspects,
    nextNo: nextNo,
    conflictForWrite: conflictForWrite,
    conflictMessage: conflictMessage,
    applyTypedNumber: applyTypedNumber,
    rowsToMap: rowsToMap,
    storeFromLists: storeFromLists,
    refresh: refresh,
    paintSuggestion: paintSuggestion,
    advanceSuggestion: advanceSuggestion,
    syncDocreg: syncDocreg,
    hold: hold,
    release: release,
    heldByOther: heldByOther,
  };
});
