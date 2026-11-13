/**
 * Written-reminder numbers for the CorConDev HR artifact.
 * Loaded by claude-shim.js (browser) and required by the db function (Node).
 *
 * The register number is RM + year + a sequence that only moves forward
 * (RM2026-001, RM2026-002). A number that was issued, voided, or deleted is
 * not given out again. The high-water mark lives on the RM series as
 * lastByYear, so deleting the row does not put the number back in the pool.
 *
 * HR's own paper number (WR2026-04) is a separate field. When one was typed,
 * or the subject already cites one, that is the number the list, the print,
 * and the 201 file show, with the register number beside it. The register
 * number itself is not rewritten.
 *
 * A reminder names every employee it is for (empId and empIds). Each of those
 * people has it on their 201 file. A checklist scan whose title is a written
 * reminder is listed as well, on the person it was filed under.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.hrReminderNumbers = api;
  if (typeof window !== "undefined" && window) window.hrReminderNumbers = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var RM = "RM";
  var DUP_CODE = "duplicate_reminder_number";

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
      if (data && typeof data === "object" && !data.id) data = Object.assign({ id: id }, data);
      out[id] = data;
    });
    return out;
  }

  function storeFromLists(lists) {
    lists = lists || {};
    return {
      reminders: rowsToMap(lists.reminders),
      docreg: rowsToMap(lists.docreg),
      filed: rowsToMap(lists.filed),
      employees: rowsToMap(lists.employees),
      series: lists.series || {},
    };
  }

  function seriesOf(S) {
    var cur = (S && S.series && S.series[RM]) || {};
    return Object.assign(
      {
        key: RM,
        label: "Written Reminder",
        prefix: "RM",
        pad: 3,
        resetYearly: true,
        pattern: "{PREFIX}{YYYY}-{NNNN}",
      },
      cur
    );
  }

  function formatRm(year, seq, S) {
    var ser = seriesOf(S);
    var prefix = ser.prefix || "RM";
    var pad = ser.pad || 3;
    var pattern = ser.pattern || "{PREFIX}{YYYY}-{NNNN}";
    return String(pattern)
      .replace(/\{ORG\}-?/g, "")
      .replace(/\{PREFIX\}/g, prefix)
      .replace(/\{YYYY\}/g, String(year))
      .replace(/\{YY\}/g, String(year).slice(-2))
      .replace(/\{NNNN\}/g, String(seq).padStart(pad, "0"));
  }

  function formatWr(year, seq) {
    return "WR" + year + "-" + String(seq).padStart(2, "0");
  }

  function parseRm(no) {
    var flat = str(no).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!flat) return null;
    var m = /^RM((?:19|20)\d{2})0*(\d{1,6})$/.exec(flat);
    if (!m) return null;
    var year = +m[1];
    var seq = parseInt(m[2], 10);
    if (!year || !seq) return null;
    return { year: year, seq: seq, key: "RM|" + year + "|" + seq };
  }

  function parseWr(no) {
    var raw = str(no).toUpperCase();
    if (!raw) return null;
    var m = raw.match(/WR\s*-?\s*((?:19|20)\d{2})\s*[-–]\s*0*(\d{1,6})/);
    if (!m) {
      var flat = raw.replace(/[^A-Z0-9]/g, "");
      m = /^.*?WR((?:19|20)\d{2})0*(\d{1,6}).*$/.exec(flat);
    }
    if (!m) return null;
    var year = +m[1];
    var seq = parseInt(m[2], 10);
    if (!year || !seq) return null;
    return { year: year, seq: seq, key: "WR|" + year + "|" + seq };
  }

  function canonicalPaper(no) {
    var wr = parseWr(no);
    if (wr) return formatWr(wr.year, wr.seq);
    return str(no).trim();
  }

  function looseKey(no) {
    return str(no).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function sameLoose(a, b) {
    var wa = parseWr(a);
    var wb = parseWr(b);
    if (wa && wb) return wa.key === wb.key;
    var ra = parseRm(a);
    var rb = parseRm(b);
    if (ra && rb) return ra.key === rb.key;
    var ka = looseKey(a);
    var kb = looseKey(b);
    return !!ka && ka === kb;
  }

  /* The paper number HR already used. The field wins. Otherwise the first
     WR number written in the subject counts — that is how WR2026-04 was
     recorded before this field existed. The body is not scanned. */
  function paperNoOf(r) {
    if (!r) return "";
    var explicit = str(r.paperNo).trim();
    if (explicit) return canonicalPaper(explicit);
    var wr = parseWr(r.subject);
    return wr ? formatWr(wr.year, wr.seq) : "";
  }

  function paperKey(r) {
    var p = paperNoOf(r);
    var wr = parseWr(p);
    return wr ? wr.key : looseKey(p);
  }

  function displayNo(r) {
    if (!r) return "";
    var paper = paperNoOf(r);
    var reg = str(r.no).trim();
    if (paper && reg && !sameLoose(paper, reg)) return paper + " · " + reg;
    return paper || reg;
  }

  function taggedEmpIds(r) {
    var ids = [];
    function add(id) {
      id = str(id);
      if (!id || ids.indexOf(id) >= 0) return;
      ids.push(id);
    }
    if (!r) return ids;
    add(r.empId);
    var list = r.empIds || [];
    var i;
    for (i = 0; i < list.length; i += 1) add(list[i]);
    return ids;
  }

  function tagsEmp(r, empId) {
    if (!r || !empId) return false;
    return taggedEmpIds(r).indexOf(str(empId)) >= 0;
  }

  /* Keep every person HR named. Does not expand Department or Everyone —
     those are not a named list unless empIds was filled in. */
  function stampPeople(r, extraIds) {
    var ids = taggedEmpIds(r);
    var extra = extraIds || [];
    var i;
    if (!r || !r.audience || r.audience === "Individual" || r.audience === "Selected people") {
      for (i = 0; i < extra.length; i += 1) {
        var id = str(extra[i]);
        if (id && ids.indexOf(id) < 0) ids.push(id);
      }
    }
    return ids;
  }

  function isRmDoc(d) {
    if (!d) return false;
    if (str(d.seriesKey).toUpperCase() === RM) return true;
    return !!(parseRm(d.no) && str(d.module).toLowerCase() === "reminder");
  }

  function yearMapHigh(map, year) {
    if (!map || typeof map !== "object") return 0;
    var n = map[year] != null ? map[year] : map[String(year)];
    return n | 0;
  }

  function bumpSeq(mx, no, year) {
    var p = parseRm(no);
    if (p && p.year === (year | 0) && p.seq > mx) return p.seq;
    return mx;
  }

  function highSeq(S, year) {
    var y = year | 0;
    var mx = 0;
    var ser = seriesOf(S);
    mx = Math.max(mx, yearMapHigh(ser.lastByYear, y));
    if ((ser.year | 0) === y && (ser.lastSeq | 0) > mx) mx = ser.lastSeq | 0;
    var retired = ser.retired || [];
    var i;
    for (i = 0; i < retired.length; i += 1) mx = bumpSeq(mx, retired[i], y);
    values(S && S.reminders).forEach(function (r) {
      mx = bumpSeq(mx, r && r.no, y);
    });
    values(S && S.docreg).forEach(function (d) {
      if (!isRmDoc(d)) return;
      if ((d.year | 0) === y && (d.seq | 0) > mx) mx = d.seq | 0;
      mx = bumpSeq(mx, d && d.no, y);
    });
    values(S && S.filed).forEach(function (f) {
      mx = bumpSeq(mx, f && f.no, y);
    });
    return mx;
  }

  function nextNo(S, year, exceptId) {
    var y = (year | 0) || new Date().getFullYear();
    var seq = highSeq(S, y) + 1;
    var guard = 0;
    while (rmHeldByOther(S, formatRm(y, seq, S), exceptId) && guard++ < 500) seq += 1;
    return { year: y, seq: seq, no: formatRm(y, seq, S) };
  }

  function rmHeldByOther(S, no, exceptId) {
    var want = parseRm(no);
    if (!want) return null;
    var except = str(exceptId);
    var hit = null;
    values(S && S.reminders).forEach(function (r) {
      if (!r || hit) return;
      if (except && str(r.id) === except) return;
      var p = parseRm(r.no);
      if (p && p.key === want.key) hit = r;
    });
    if (hit) return hit;
    values(S && S.docreg).forEach(function (d) {
      if (!d || hit || !isRmDoc(d)) return;
      if (except && (str(d.id) === except || str(d.refId) === except)) return;
      var p = parseRm(d.no);
      if (p && p.key === want.key) hit = d;
    });
    return hit;
  }

  function paperHeldByOther(S, paper, exceptId) {
    var key = paperKey({ paperNo: paper });
    if (!key) return null;
    var except = str(exceptId);
    var hit = null;
    values(S && S.reminders).forEach(function (r) {
      if (!r || hit) return;
      if (except && str(r.id) === except) return;
      if (paperKey(r) === key) hit = r;
    });
    return hit;
  }

  function bumpSeries(S, year, seq) {
    var ser = seriesOf(S);
    var map = Object.assign({}, ser.lastByYear || {});
    var prev = yearMapHigh(map, year);
    if ((seq | 0) > prev) map[String(year | 0)] = seq | 0;
    ser.lastByYear = map;
    if ((seq | 0) > (ser.lastSeq | 0)) ser.lastSeq = seq | 0;
    ser.year = year | 0;
    return ser;
  }

  function labelOf(rec) {
    if (!rec) return "another record";
    return str(rec.subject || rec.title || rec.no || rec.id);
  }

  function assign(S, rec, opts) {
    opts = opts || {};
    rec = rec || {};
    var issue = opts.issue === true || (rec.status && rec.status !== "Draft" && !rec.no);
    var paper = paperNoOf(rec);
    var otherPaper = paperHeldByOther(S, paper, rec.id);
    if (otherPaper) {
      return {
        ok: false,
        code: DUP_CODE,
        message:
          "Paper number " +
          paper +
          " is already on " +
          labelOf(otherPaper) +
          ". A written reminder number is used once.",
      };
    }
    var no = str(rec.no).trim();
    var parsed = parseRm(no);
    if (no && !parsed) {
      return {
        ok: false,
        code: DUP_CODE,
        message: "Register number " + no + " is not an RM number. Leave it blank to take the next one.",
      };
    }
    if (parsed) {
      var other = rmHeldByOther(S, no, rec.id);
      if (other) {
        var nxt = nextNo(S, parsed.year, rec.id);
        return {
          ok: false,
          code: DUP_CODE,
          message:
            "Register number " +
            formatRm(parsed.year, parsed.seq, S) +
            " is already on " +
            labelOf(other) +
            ". The next free number is " +
            nxt.no +
            ".",
        };
      }
      return {
        ok: true,
        no: formatRm(parsed.year, parsed.seq, S),
        seq: parsed.seq,
        year: parsed.year,
        paperNo: paper,
        series: bumpSeries(S, parsed.year, parsed.seq),
        minted: false,
      };
    }
    if (!issue) {
      return { ok: true, no: "", seq: 0, year: 0, paperNo: paper, series: null, minted: false };
    }
    var year = (opts.year | 0) || new Date().getFullYear();
    var minted = nextNo(S, year, rec.id);
    return {
      ok: true,
      no: minted.no,
      seq: minted.seq,
      year: minted.year,
      paperNo: paper,
      series: bumpSeries(S, minted.year, minted.seq),
      minted: true,
    };
  }

  function retireSeries(stored, rec) {
    var p = parseRm(rec && rec.no);
    if (!p) return null;
    var ser = Object.assign(
      {
        key: RM,
        label: "Written Reminder",
        prefix: "RM",
        pad: 3,
        resetYearly: true,
        pattern: "{PREFIX}{YYYY}-{NNNN}",
      },
      stored || {}
    );
    var map = Object.assign({}, ser.lastByYear || {});
    if (p.seq > yearMapHigh(map, p.year)) map[String(p.year)] = p.seq;
    ser.lastByYear = map;
    if (p.seq > (ser.lastSeq | 0)) ser.lastSeq = p.seq;
    return ser;
  }

  /* A stale save must not lower the high-water mark. */
  function guardSeriesWrite(stored, incoming) {
    var base = Object.assign({}, stored || {});
    var next = Object.assign({}, base, incoming || {});
    var map = Object.assign({}, (stored && stored.lastByYear) || {});
    var inc = (incoming && incoming.lastByYear) || {};
    Object.keys(map).forEach(function (k) {
      if ((map[k] | 0) > (inc[k] | 0)) inc[k] = map[k] | 0;
    });
    Object.keys(inc).forEach(function (k) {
      if ((inc[k] | 0) > (map[k] | 0)) map[k] = inc[k] | 0;
    });
    next.lastByYear = map;
    if ((stored && stored.lastSeq | 0) > (next.lastSeq | 0)) next.lastSeq = stored.lastSeq | 0;
    next.key = RM;
    return next;
  }

  function conflictForWrite(collection, id, data, S) {
    if (!data) return null;
    var isRem = collection === "reminders";
    var isRm = collection === "docreg" && isRmDoc(data);
    if (!isRem && !isRm) return null;
    if (isRem) {
      var got = assign(S, Object.assign({}, data, { id: id }), {
        issue: false,
      });
      if (!got.ok) return { code: got.code || DUP_CODE, message: got.message, holder: null };
      if (data.no) {
        var parsed = parseRm(data.no);
        if (parsed && rmHeldByOther(S, data.no, id)) {
          return {
            code: DUP_CODE,
            message: "Register number " + formatRm(parsed.year, parsed.seq, S) + " is already in use.",
          };
        }
      }
      return null;
    }
    var other = rmHeldByOther(S, data.no, data.refId || id);
    if (!other) return null;
    if (str(other.id) === str(id)) return null;
    return {
      code: DUP_CODE,
      message: "Register number " + str(data.no) + " is already on " + labelOf(other) + ".",
      holder: other,
    };
  }

  function linkUrl(x) {
    if (!x) return "";
    if (typeof x === "string") return x.trim();
    return str(x.url || x.link).trim();
  }

  function linkTitle(x) {
    if (!x || typeof x !== "object") return "";
    return str(x.title || x.name).trim();
  }

  function looksLikeReminderTitle(title) {
    var t = str(title);
    if (/written\s+reminder/i.test(t)) return true;
    return !!parseWr(t);
  }

  function checklistReminders(S) {
    var out = [];
    var seen = {};
    function consider(e, slot, file, on) {
      var title = linkTitle(file);
      var url = linkUrl(file);
      if (!looksLikeReminderTitle(title)) return;
      var wr = parseWr(title);
      var paper = wr ? formatWr(wr.year, wr.seq) : "";
      var key = (wr ? wr.key : looseKey(title)) + "|" + str(e.id) + "|" + url;
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        empId: e.id,
        empName: e.name || "",
        title: title,
        url: url,
        on: on,
        paperNo: paper,
        paperKey: wr ? wr.key : "",
        slot: slot,
      });
    }
    values(S && S.employees).forEach(function (e) {
      if (!e) return;
      var docs = e.docs || {};
      Object.keys(docs).forEach(function (slot) {
        var v = docs[slot];
        if (!v || typeof v !== "object") return;
        var files = [];
        if (Array.isArray(v.links)) files = files.concat(v.links);
        if (v.link || v.title) files.push({ url: v.link, title: v.title, on: v.filed });
        files.forEach(function (file) {
          consider(e, slot, file, str((file && file.on) || v.filed || ""));
        });
      });
      (e.linkedDocs || []).forEach(function (file, idx) {
        consider(e, "linked:" + idx, file, str(file && (file.added || file.on)));
      });
    });
    return out;
  }

  function checklistForEmp(S, empId) {
    return checklistReminders(S).filter(function (h) {
      return str(h.empId) === str(empId);
    });
  }

  /* What a data fix would change. Does not write. */
  function dryRun(S) {
    var proposals = [];
    values(S && S.reminders).forEach(function (r) {
      if (!r) return;
      var fromSubject = parseWr(r.subject);
      var explicit = str(r.paperNo).trim();
      if (fromSubject && !explicit) {
        proposals.push({
          action: "set paperNo",
          collection: "reminders",
          id: r.id,
          registerNo: r.no || "",
          from: "",
          to: formatWr(fromSubject.year, fromSubject.seq),
          note: "Copied from the subject. The register number stays " + (r.no || "blank") + ".",
        });
      }
      proposals.push({
        action: "leave register number",
        collection: "reminders",
        id: r.id,
        registerNo: r.no || "",
        paperNo: explicit || (fromSubject ? formatWr(fromSubject.year, fromSubject.seq) : ""),
        note: "No renumber. RM numbers already stored are kept.",
      });
    });
    var present = {};
    values(S && S.reminders).forEach(function (r) {
      var k = paperKey(r);
      if (k) present[k] = r.id;
    });
    checklistReminders(S).forEach(function (h) {
      if (h.paperKey && present[h.paperKey]) return;
      proposals.push({
        action: "checklist only",
        collection: "employees",
        id: h.empId,
        paperNo: h.paperNo,
        title: h.title,
        url: h.url,
        note: "A scan on this 201 checklist, not a reminder record. Not copied to anyone else by this listing.",
      });
    });
    ["WR|2026|1", "WR|2026|2", "WR|2026|3", "WR|2026|4", "WR|2026|5"].forEach(function (key) {
      var seq = +key.split("|")[2];
      var label = formatWr(2026, seq);
      var held = false;
      values(S && S.reminders).forEach(function (r) {
        if (paperKey(r) === key) held = true;
      });
      checklistReminders(S).forEach(function (h) {
        if (h.paperKey === key) held = true;
      });
      if (!held) {
        proposals.push({
          action: "missing",
          paperNo: label,
          note: label + " is not on a reminder and not on a checklist title. It has to be entered.",
        });
      }
    });
    return proposals;
  }

  return {
    DUP_CODE: DUP_CODE,
    parseRm: parseRm,
    parseWr: parseWr,
    formatRm: formatRm,
    formatWr: formatWr,
    canonicalPaper: canonicalPaper,
    paperNoOf: paperNoOf,
    paperKey: paperKey,
    displayNo: displayNo,
    taggedEmpIds: taggedEmpIds,
    tagsEmp: tagsEmp,
    stampPeople: stampPeople,
    isRmDoc: isRmDoc,
    highSeq: highSeq,
    nextNo: nextNo,
    assign: assign,
    retireSeries: retireSeries,
    guardSeriesWrite: guardSeriesWrite,
    conflictForWrite: conflictForWrite,
    checklistReminders: checklistReminders,
    checklistForEmp: checklistForEmp,
    dryRun: dryRun,
    rowsToMap: rowsToMap,
    storeFromLists: storeFromLists,
    sameLoose: sameLoose,
  };
});
