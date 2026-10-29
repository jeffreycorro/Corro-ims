/**
 * Company memorandum numbers for the CorConDev HR artifact.
 * Loaded by claude-shim.js (browser) and required by the db function (Node).
 *
 * Filed memoranda are numbered C.M. {year} - {seq} with a two-digit sequence
 * (C.M. 2026 - 15). The series resets each calendar year. The next number is
 * one past the highest sequence already stored for that year on a memo, on
 * the CM document register (including a signed or Drive-filed row and a draft
 * register row), or on a filed form. Gaps are not reused.
 *
 * New memo shows that number. HR can type a different one. A number already
 * held by another memo, register row, or filed form is refused. The memo this
 * record already has is kept. Two saves in one browser cannot take the same
 * sequence; the database unique index is the backstop when two browsers save
 * together.
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

  function yearMapHigh(map, year) {
    if (!map || typeof map !== "object") return 0;
    var n = map[year] != null ? map[year] : map[String(year)];
    return n | 0;
  }

  function counterFloor(S, year) {
    var y = year | 0;
    var mx = 0;
    var ser = S && S.series && S.series[CM];
    if (ser) {
      mx = Math.max(mx, yearMapHigh(ser.lastByYear, y));
      if ((ser.year | 0) === y && (ser.lastSeq | 0) > mx) mx = ser.lastSeq | 0;
      if ((ser.year | 0) === y && (ser.seq | 0) > mx) mx = ser.seq | 0;
    }
    var counters = S && S.counters && S.counters[CM];
    if (counters) {
      mx = Math.max(mx, yearMapHigh(counters.lastByYear, y));
      if ((counters.year | 0) === y && (counters.lastSeq | 0) > mx) mx = counters.lastSeq | 0;
      if ((counters.year | 0) === y && (counters.seq | 0) > mx) mx = counters.seq | 0;
    }
    return mx;
  }

  function consider(mx, year, rec) {
    if (!rec) return mx;
    var y = year | 0;
    if (str(rec.seriesKey).toUpperCase() === CM && (rec.year | 0) === y && (rec.seq | 0) > mx) {
      mx = rec.seq | 0;
    }
    var p = parseCm(rec.no);
    if (p && p.year === y && p.seq > mx) mx = p.seq;
    return mx;
  }

  function highSeq(S, year) {
    var y = year | 0;
    var mx = counterFloor(S, y);
    values(S && S.memos).forEach(function (m) {
      mx = consider(mx, y, m);
    });
    values(S && S.docreg).forEach(function (d) {
      if (!isCmDoc(d)) return;
      mx = consider(mx, y, d);
    });
    values(S && S.filed).forEach(function (f) {
      mx = consider(mx, y, f);
    });
    Object.keys(inflight).forEach(function (k) {
      var parts = k.split("|");
      if (parts[0] === CM && (parts[1] | 0) === y && (parts[2] | 0) > mx) mx = parts[2] | 0;
    });
    return mx;
  }

  function seqTaken(S, year, seq) {
    var y = year | 0;
    var n = seq | 0;
    if (!n) return false;
    if (Object.prototype.hasOwnProperty.call(inflight, "CM|" + y + "|" + n)) return true;
    function hit(rec) {
      if (!rec) return false;
      if (str(rec.seriesKey).toUpperCase() === CM && (rec.year | 0) === y && (rec.seq | 0) === n) return true;
      var p = parseCm(rec.no);
      return !!(p && p.year === y && p.seq === n);
    }
    if (values(S && S.memos).some(hit)) return true;
    if (values(S && S.docreg).some(function (d) { return isCmDoc(d) && hit(d); })) return true;
    if (values(S && S.filed).some(hit)) return true;
    return false;
  }

  function nextNo(S, year) {
    var y = (year | 0) || new Date().getFullYear();
    var seq = highSeq(S, y) + 1;
    if (seq < 1) seq = 1;
    var guard = 0;
    while (seqTaken(S, y, seq) && guard++ < 500) seq += 1;
    return { year: y, seq: seq, no: formatCm(y, seq, S) };
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

  function findReg(S, no, except) {
    except = except || {};
    var hit = null;
    values(S && S.docreg).forEach(function (d) {
      if (!d || !d.no || !isCmDoc(d)) return;
      if (except.docId && str(d.id) === str(except.docId)) return;
      if (except.refId && d.refId && str(d.refId) === str(except.refId)) return;
      if (sameNo(d.no, no)) hit = d;
    });
    return hit;
  }

  function findFiled(S, no) {
    var hit = null;
    values(S && S.filed).forEach(function (f) {
      if (f && f.no && sameNo(f.no, no)) hit = f;
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
      var reg = findReg(S, no, { refId: id });
      if (reg) {
        return {
          code: DUP_CODE,
          message: conflictMessage(no, "document register", labelOf(reg), S),
          holder: reg,
        };
      }
      var filed = findFiled(S, no);
      if (filed) {
        return {
          code: DUP_CODE,
          message: conflictMessage(no, "filed forms", labelOf(filed), S),
          holder: filed,
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
      var otherReg = findReg(S, no, { docId: id, refId: data.refId });
      if (otherReg) {
        return {
          code: DUP_CODE,
          message: conflictMessage(no, "document register", labelOf(otherReg), S),
          holder: otherReg,
        };
      }
      var filedReg = findFiled(S, no);
      if (filedReg) {
        return {
          code: DUP_CODE,
          message: conflictMessage(no, "filed forms", labelOf(filedReg), S),
          holder: filedReg,
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

  function syncDocreg(host, memo) {
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
