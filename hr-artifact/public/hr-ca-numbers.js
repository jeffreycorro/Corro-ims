/**
 * Cash Advance control numbers for the CorConDev HR artifact.
 * Loaded by claude-shim.js (browser) and required by the db function (Node).
 * Does not rewrite the artifact.
 *
 * The number is CAF + year + a running sequence (CAF2026-0001), the same
 * prefix and pattern the register already uses. It is chosen when the cash
 * advance is saved, not when the form is opened. A preview must not claim one.
 * Two saves at once cannot take the same number or leave a hole, because the
 * write is read back and a second copy moves on. An edit keeps the number it
 * was saved with. Cancelling or deleting does not put that number back in the
 * pool. A number already shared by two saved advances is left alone: the
 * oldest record keeps it, and the others are listed for HR.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.hrCaNumbers = api;
  if (typeof window !== "undefined" && window) window.hrCaNumbers = api;
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

  var CA = "CA";
  var DUP_CODE = "duplicate_ca_number";
  var BUSY_CODE = "ca_number_busy";
  var CLOSED = {
    Cancelled: 1,
    Disapproved: 1,
    Liquidated: 1,
    Recovered: 1,
    "Recovered from pay": 1,
  };

  function str(v) {
    return v == null ? "" : String(v);
  }

  function clone(v) {
    if (v == null || typeof v !== "object") return v;
    return JSON.parse(JSON.stringify(v));
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
      out[id] = data;
    });
    return out;
  }

  function parseCaf(no) {
    var raw = str(no).toUpperCase();
    if (!raw) return null;
    var m = raw.match(/\b(CAF|CA)\s*-?\s*((?:19|20)\d{2})\s*[-–]\s*(\d{1,6})\b/);
    if (!m) {
      var flat = raw.replace(/[^A-Z0-9]/g, "");
      var m2 = /^(CAF|CA)((?:19|20)\d{2})(\d{1,6})$/.exec(flat);
      if (!m2) return null;
      m = m2;
    }
    var year = +m[2];
    var seq = parseInt(m[3], 10);
    if (!year || !seq) return null;
    return { prefix: m[1], year: year, seq: seq, key: "CAF|" + year + "|" + seq };
  }

  function sameNo(a, b) {
    var pa = parseCaf(a);
    var pb = parseCaf(b);
    if (pa && pb) return pa.year === pb.year && pa.seq === pb.seq;
    var na = str(a).toUpperCase().replace(/[^A-Z0-9]/g, "");
    var nb = str(b).toUpperCase().replace(/[^A-Z0-9]/g, "");
    return !!na && na === nb;
  }

  function seriesOf(S) {
    var ser = S && S.series && S.series[CA];
    return ser || { key: CA, prefix: "CAF", pad: 4, pattern: "{PREFIX}{YYYY}-{NNNN}" };
  }

  function formatCaf(year, seq, S) {
    var ser = seriesOf(S);
    var prefix = ser.prefix || "CAF";
    var pad = ser.pad || 4;
    var pattern = ser.pattern || "{PREFIX}{YYYY}-{NNNN}";
    return String(pattern)
      .replace(/\{ORG\}-?/g, "")
      .replace(/\{PREFIX\}/g, prefix)
      .replace(/\{YYYY\}/g, String(year))
      .replace(/\{YY\}/g, String(year).slice(-2))
      .replace(/\{NNNN\}/g, String(seq).padStart(pad, "0"));
  }

  function isCaDoc(d) {
    if (!d) return false;
    if (str(d.seriesKey).toUpperCase() === CA) return true;
    return !!(parseCaf(d.no) && str(d.module).toLowerCase() === "ca");
  }

  function isPaper(rec) {
    if (!rec || !str(rec.no)) return false;
    if (rec.paperNo || rec.fromDrive || rec.imported) return true;
    var notes = str(rec.notes);
    if (/imported from drive/i.test(notes)) return true;
    if (/signed form/i.test(notes)) return true;
    if (/read off the signed/i.test(notes)) return true;
    var tags = rec.tags || [];
    var i;
    for (i = 0; i < tags.length; i += 1) {
      if (/import|paper|signed form/i.test(str(tags[i]))) return true;
    }
    return false;
  }

  function advanceHolds(S, no, exceptId) {
    var hit = null;
    values(S && S.advances).forEach(function (a) {
      if (!a || !a.no) return;
      if (exceptId && str(a.id) === str(exceptId)) return;
      if (sameNo(a.no, no)) hit = a;
    });
    return hit;
  }

  function consumedKeySet(S) {
    var set = {};
    function add(no) {
      var p = parseCaf(no);
      if (p) set[p.key] = p.seq;
      else if (str(no)) set["RAW|" + str(no).toUpperCase().replace(/\s+/g, "")] = 0;
    }
    values(S && S.advances).forEach(function (a) {
      if (a && a.no) add(a.no);
    });
    values(S && S.docreg).forEach(function (d) {
      if (!d || !d.no || !isCaDoc(d)) return;
      if (d.status === "Void" || advanceHolds(S, d.no)) add(d.no);
    });
    values(S && S.filed).forEach(function (f) {
      if (f && f.no && parseCaf(f.no)) add(f.no);
    });
    var retired = (seriesOf(S).retired) || [];
    retired.forEach(add);
    return set;
  }

  function counterFloor(S, year) {
    var y = year | 0;
    var ser = seriesOf(S);
    var mx = 0;
    var map = ser.lastByYear || {};
    var n = map[y] != null ? map[y] : map[String(y)];
    if ((n | 0) > mx) mx = n | 0;
    if ((ser.year | 0) === y && (ser.lastSeq | 0) > mx) mx = ser.lastSeq | 0;
    if ((ser.year | 0) === y && (ser.seq | 0) > mx) mx = ser.seq | 0;
    var counters = S && S.counters && S.counters[CA];
    if (counters) {
      var cm = counters.lastByYear || {};
      var c = cm[y] != null ? cm[y] : cm[String(y)];
      if ((c | 0) > mx) mx = c | 0;
      if ((counters.year | 0) === y && (counters.lastSeq | 0) > mx) mx = counters.lastSeq | 0;
      if ((counters.year | 0) === y && (counters.seq | 0) > mx) mx = counters.seq | 0;
    }
    return mx;
  }

  function highSeq(S, year) {
    var y = year | 0;
    var mx = counterFloor(S, y);
    var set = consumedKeySet(S);
    Object.keys(set).forEach(function (k) {
      var parts = k.split("|");
      if (parts[0] === "CAF" && (parts[1] | 0) === y && (set[k] | 0) > mx) mx = set[k] | 0;
    });
    return mx;
  }

  function takenByOther(S, no, exceptId) {
    if (!str(no) || !parseCaf(no)) return false;
    if (advanceHolds(S, no, exceptId)) return true;
    var p = parseCaf(no);
    var retired = (seriesOf(S).retired) || [];
    var i;
    for (i = 0; i < retired.length; i += 1) {
      if (retired[i] === p.key || sameNo(retired[i], no)) return true;
    }
    var hit = false;
    values(S && S.docreg).forEach(function (d) {
      if (!d || !isCaDoc(d) || !sameNo(d.no, no)) return;
      if (exceptId && str(d.refId) === str(exceptId)) return;
      /* A draft or issued row with no cash advance was a number claimed before
         save. It is not part of the sequence. A voided row was a real number. */
      if (d.status === "Void") hit = true;
    });
    values(S && S.filed).forEach(function (f) {
      if (f && f.no && sameNo(f.no, no)) hit = true;
    });
    return hit;
  }

  function nextNumber(S, year, exceptId) {
    var y = year | 0;
    var seq = highSeq(S, y) + 1;
    if (seq < 1) seq = 1;
    var guard = 0;
    var no = formatCaf(y, seq, S);
    while (takenByOther(S, no, exceptId) && guard < 500) {
      seq += 1;
      no = formatCaf(y, seq, S);
      guard += 1;
    }
    return { year: y, seq: seq, no: no };
  }

  function stampCreated(rec, stored) {
    if (stored && stored.createdAt) rec.createdAt = stored.createdAt;
    else if (!rec.createdAt) rec.createdAt = new Date().toISOString();
    return rec;
  }

  function seriesBump(S, year, seq, retiredKey) {
    var base = clone(seriesOf(S));
    base.key = CA;
    var patch = { lastByYear: {} };
    patch.lastByYear[year] = seq;
    if (retiredKey) patch.retired = [retiredKey];
    return mergeSeriesCounter(base, patch);
  }

  function docregFor(S, advance, parsed, uid) {
    var existing = null;
    values(S && S.docreg).forEach(function (d) {
      if (!d || !isCaDoc(d)) return;
      if (str(d.refId) === str(advance.id)) existing = d;
    });
    var id = existing && existing.id ? existing.id : uid ? uid("d") : "d" + Date.now().toString(36);
    return {
      id: id,
      no: advance.no,
      seriesKey: CA,
      year: parsed.year,
      seq: parsed.seq,
      title: (advance.purpose || "Cash Advance") + (advance.project ? " — " + advance.project : ""),
      tags: ["cash advance"].concat(advance.project ? [advance.project] : []),
      empId: advance.empId || "",
      date: advance.date || "",
      status: advance.status === "Cancelled" ? "Void" : existing && existing.status === "Void" ? "Void" : "Issued",
      module: "ca",
      refId: advance.id,
      link: advance.signedLink || "",
      notes: existing && existing.notes ? existing.notes : "",
      issuedBy: (S && S.settings && S.settings.hrHead) || "",
    };
  }

  /**
   * Decide the control number for one save. Does not write, and does not
   * change any other cash advance.
   */
  function planSave(S, incoming, opts) {
    opts = opts || {};
    S = S || {};
    var rec = clone(incoming || {});
    if (!rec.id) rec.id = opts.id || "";
    var stored = S.advances && rec.id ? S.advances[rec.id] : null;
    var year = opts.year || new Date().getFullYear();

    if (stored && str(stored.no)) {
      var ignored = str(rec.no) && !sameNo(rec.no, stored.no) ? rec.no : "";
      rec.no = stored.no;
      stampCreated(rec, stored);
      var edit = { kind: "edit", advance: rec, ignored: ignored, minted: false };
      if (rec.status === "Cancelled") {
        var cancelled = parseCaf(rec.no);
        if (cancelled) {
          edit.year = cancelled.year;
          edit.seq = cancelled.seq;
          edit.entry = docregFor(S, rec, cancelled, opts.uid);
          edit.entry.status = "Void";
          edit.series = seriesBump(S, cancelled.year, cancelled.seq, cancelled.key);
        }
      }
      return edit;
    }

    if (isPaper(rec)) {
      var holder = advanceHolds(S, rec.no, rec.id);
      if (holder || takenByOther(S, rec.no, rec.id)) {
        return {
          kind: "error",
          error: "Cash advance number " + rec.no + " is already on another record.",
          code: DUP_CODE,
        };
      }
      var parsedPaper = parseCaf(rec.no);
      rec.no = str(rec.no);
      stampCreated(rec, stored);
      var paperPlan = { kind: "paper", advance: rec, minted: false };
      if (parsedPaper) {
        paperPlan.seq = parsedPaper.seq;
        paperPlan.year = parsedPaper.year;
        paperPlan.entry = docregFor(S, rec, parsedPaper, opts.uid);
        paperPlan.series = seriesBump(S, parsedPaper.year, parsedPaper.seq);
      }
      return paperPlan;
    }

    if (!(Number(rec.amount) > 0)) {
      rec.no = "";
      return { kind: "draft", advance: rec, minted: false };
    }

    var nxt = nextNumber(S, year, rec.id);
    rec.no = nxt.no;
    stampCreated(rec, stored);
    return {
      kind: "mint",
      advance: rec,
      minted: true,
      seq: nxt.seq,
      year: nxt.year,
      entry: docregFor(S, rec, nxt, opts.uid),
      series: seriesBump(S, nxt.year, nxt.seq),
    };
  }

  function mergeSeriesCounter(stored, incoming) {
    var base = Object.assign({}, stored || {}, incoming || {});
    var last = Object.assign({}, (stored && stored.lastByYear) || {});
    var inc = (incoming && incoming.lastByYear) || {};
    Object.keys(inc).forEach(function (y) {
      var n = inc[y] | 0;
      if (n > (last[y] | 0)) last[y] = n;
    });
    base.lastByYear = last;
    var bag = {};
    ((stored && stored.retired) || []).concat((incoming && incoming.retired) || []).forEach(function (k) {
      if (k) bag[str(k)] = 1;
    });
    base.retired = Object.keys(bag);
    if (stored && (stored.lastSeq | 0) > (base.lastSeq | 0)) base.lastSeq = stored.lastSeq | 0;
    base.key = CA;
    if (!base.prefix) base.prefix = "CAF";
    if (!base.pad) base.pad = 4;
    if (!base.pattern) base.pattern = "{PREFIX}{YYYY}-{NNNN}";
    return base;
  }

  /** A browser save may update the series label or pattern. It may not move the counter. */
  function guardSeriesWrite(stored, incoming) {
    var merged = Object.assign({}, stored || {}, incoming || {});
    merged.lastByYear = Object.assign({}, (stored && stored.lastByYear) || {});
    merged.retired = ((stored && stored.retired) || []).slice();
    if (stored && stored.lastSeq != null) merged.lastSeq = stored.lastSeq;
    if (stored && stored.seq != null && incoming && incoming.seq !== stored.seq) merged.seq = stored.seq;
    merged.key = CA;
    return merged;
  }

  function ageKey(a) {
    return str((a && (a.createdAt || a.date)) || "") + "|" + str(a && a.id);
  }

  function byAge(a, b) {
    var ad = str(a && (a.createdAt || a.date));
    var bd = str(b && (b.createdAt || b.date));
    if (ad !== bd) return ad < bd ? -1 : 1;
    return str(a && a.id).localeCompare(str(b && b.id));
  }

  function othersWithNo(S, no, selfId) {
    if (!str(no)) return [];
    return values(S && S.advances).filter(function (a) {
      return a && str(a.id) !== str(selfId) && a.no && sameNo(a.no, no);
    });
  }

  function shouldMove(rows, selfId) {
    var list = (rows || []).filter(Boolean).slice().sort(byAge);
    if (!list.length) return false;
    return str(list[0].id) !== str(selfId);
  }

  /**
   * Existing duplicates stay numbered as they are. The oldest is the keeper.
   * The rest are for HR to review. Nothing is renumbered.
   */
  function reviewDuplicates(S) {
    var groups = {};
    values(S && S.advances).forEach(function (a) {
      if (!a || !a.no) return;
      var p = parseCaf(a.no);
      var key = p ? p.key : "RAW|" + str(a.no).toUpperCase();
      (groups[key] = groups[key] || []).push(a);
    });
    return Object.keys(groups)
      .filter(function (k) {
        return groups[k].length > 1;
      })
      .map(function (k) {
        var rows = groups[k].slice().sort(byAge);
        return {
          no: rows[0].no,
          keeper: rows[0],
          review: rows.slice(1),
        };
      });
  }

  function applyPlanToStore(S, plan) {
    if (!S.advances) S.advances = {};
    if (!S.docreg) S.docreg = {};
    if (!S.series) S.series = {};
    S.advances[plan.advance.id] = clone(plan.advance);
    if (plan.entry) S.docreg[plan.entry.id] = clone(plan.entry);
    if (plan.series) S.series[CA] = mergeSeriesCounter(S.series[CA], plan.series);
  }

  async function assignCashAdvance(io, advance) {
    if (!advance || !advance.id) {
      var missing = new Error("Cash advance id is required.");
      missing.statusCode = 400;
      throw missing;
    }
    var run = async function () {
      try {
        if (io.lock) await io.lock();
      } catch (e) {}
      var incoming = clone(advance);
      var attempt;
      for (attempt = 0; attempt < 6; attempt += 1) {
        var S = await io.load();
        var plan = planSave(S, incoming, { year: io.year || new Date().getFullYear(), uid: io.uid });
        if (plan.kind === "error") {
          var err = new Error(plan.error);
          err.code = plan.code || DUP_CODE;
          err.statusCode = 409;
          throw err;
        }
        await io.writeAdvance(plan.advance);
        if (plan.entry && io.writeDocreg) await io.writeDocreg(plan.entry);
        if (plan.series && io.writeSeries) await io.writeSeries(plan.series);
        var back = io.readAdvance ? await io.readAdvance(plan.advance.id) : plan.advance;
        var fresh = await io.load();
        if (!back || str(back.no) !== str(plan.advance.no)) {
          incoming = Object.assign({}, plan.advance, { no: "" });
          continue;
        }
        if (plan.kind !== "mint") {
          return { advance: back, kind: plan.kind, docreg: plan.entry || null, series: plan.series || null, ignored: plan.ignored || "" };
        }
        var clash = othersWithNo(fresh, back.no, back.id);
        if (!clash.length || !shouldMove(clash.concat([back]), back.id)) {
          return { advance: back, kind: plan.kind, docreg: plan.entry || null, series: (fresh.series && fresh.series[CA]) || plan.series };
        }
        var cleared = Object.assign({}, back, { no: "" });
        await io.writeAdvance(cleared);
        incoming = cleared;
      }
      var busy = new Error("Could not assign a cash advance number. Wait a moment and try again.");
      busy.code = BUSY_CODE;
      busy.statusCode = 409;
      throw busy;
    };
    if (io.serialize) return io.serialize(run);
    return run();
  }

  async function retireNumber(io, rec) {
    if (!rec || !parseCaf(rec.no)) return { retired: false };
    var parsed = parseCaf(rec.no);
    var S = await io.load();
    var voided = [];
    values(S.docreg).forEach(function (d) {
      if (!d || !isCaDoc(d) || !sameNo(d.no, rec.no)) return;
      if (d.status === "Void") return;
      voided.push(Object.assign({}, d, { status: "Void", notes: (d.notes ? d.notes + " — " : "") + "Number retired so it is not issued again" }));
    });
    if (!voided.length && !values(S.docreg).some(function (d) { return d && isCaDoc(d) && sameNo(d.no, rec.no); })) {
      var id = io.uid ? io.uid("d") : "d" + Date.now().toString(36);
      voided.push({
        id: id,
        no: rec.no,
        seriesKey: CA,
        year: parsed.year,
        seq: parsed.seq,
        status: "Void",
        module: "ca",
        refId: rec.id || "",
        title: "Cash Advance Request Form",
        notes: "Number retired so it is not issued again",
        date: rec.date || "",
        empId: rec.empId || "",
      });
    }
    var i;
    for (i = 0; i < voided.length; i += 1) {
      if (io.writeDocreg) await io.writeDocreg(voided[i]);
    }
    var series = seriesBump(S, parsed.year, parsed.seq, parsed.key);
    if (io.writeSeries) await io.writeSeries(series);
    return { retired: true, no: rec.no, series: series };
  }

  function memoryIo(S) {
    var chain = Promise.resolve();
    function serialize(fn) {
      var run = chain.then(fn, fn);
      chain = run.then(
        function () {},
        function () {}
      );
      return run;
    }
    var n = 0;
    return {
      serialize: serialize,
      lock: function () {
        return Promise.resolve(true);
      },
      load: function () {
        return Promise.resolve(S);
      },
      readAdvance: function (id) {
        return Promise.resolve((S.advances && S.advances[id]) || null);
      },
      readSeries: function () {
        return Promise.resolve((S.series && S.series[CA]) || null);
      },
      writeAdvance: function (rec) {
        S.advances = S.advances || {};
        S.advances[rec.id] = clone(rec);
        return Promise.resolve(S.advances[rec.id]);
      },
      writeDocreg: function (rec) {
        S.docreg = S.docreg || {};
        S.docreg[rec.id] = clone(rec);
        return Promise.resolve(rec);
      },
      writeSeries: function (rec) {
        S.series = S.series || {};
        S.series[CA] = mergeSeriesCounter(S.series[CA], rec);
        return Promise.resolve(S.series[CA]);
      },
      uid: function (p) {
        n += 1;
        return (p || "d") + "m" + n;
      },
      year: 2026,
    };
  }

  function slugNo(no) {
    return str(no || "doc").replace(/[^A-Za-z0-9_-]+/g, "-");
  }

  function formControlNo(rec) {
    return rec && str(rec.no) ? str(rec.no) : "";
  }

  function pdfFileName(rec) {
    var no = formControlNo(rec);
    return no ? slugNo(no) + ".pdf" : "";
  }

  function driveFileName(rec, emp) {
    var no = formControlNo(rec);
    if (!no) return "";
    var empNo = emp && (emp.empNo || emp.no) ? str(emp.empNo || emp.no) + "-" : "";
    return empNo + no + " SIGNED.pdf";
  }

  function approvedFileName(rec) {
    var no = formControlNo(rec);
    return (no ? slugNo(no) : "FORM") + " APPROVED.pdf";
  }

  function exportNumber(rec) {
    return formControlNo(rec);
  }

  function surfaces(rec, emp) {
    var no = formControlNo(rec);
    return {
      form: no,
      print: no,
      pdf: pdfFileName(rec),
      fileName: pdfFileName(rec),
      drive: driveFileName(rec, emp),
      export: exportNumber(rec),
      approved: approvedFileName(rec),
    };
  }

  function sheetControlNo(body) {
    var html = str(body);
    if (!/CASH ADVANCE REQUEST FORM/i.test(html)) return "";
    var m = html.match(/Cash Advance Request Form No\.<\/td>\s*<td[^>]*>([^<]*)/i);
    if (!m) m = html.match(/class="no"[^>]*>([^<]*)/);
    if (!m) return "";
    var text = m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
    if (!parseCaf(text)) return "";
    return text;
  }

  function closedStatus(status) {
    return !!CLOSED[str(status)];
  }

  function deductControlNos(S, empId) {
    return values(S && S.advances)
      .filter(function (a) {
        if (!a || str(a.empId) !== str(empId)) return false;
        if (!a.no) return false;
        if (closedStatus(a.status)) return false;
        var liq = ((a.liquidations) || []).reduce(function (s, l) {
          return s + (Number(l && l.amount) || 0);
        }, 0);
        var bal = (Number(a.amount) || 0) - liq - (Number(a.deducted) || 0);
        return bal > 0.005;
      })
      .sort(byAge)
      .map(function (a) {
        return str(a.no);
      });
  }

  function noteWithControlNos(base, nos) {
    base = str(base);
    nos = (nos || []).filter(Boolean);
    if (!base || !nos.length) return base;
    var list = nos.join(", ");
    if (base.indexOf(list) >= 0) return base;
    return base.replace(/\s*$/, "").replace(/\.$/, "") + ". Control " + (nos.length > 1 ? "numbers " : "number ") + list + ".";
  }

  function storeOf(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return {};
    if (host.S && (host.S.advances || host.S.employees || host.S.docreg || host.S.series)) return host.S;
    try {
      if (typeof document !== "undefined" && document.createElement) {
        var s = document.createElement("script");
        s.textContent = "window.__hrS=typeof S!=='undefined'?S:window.__hrS;";
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

  function remember(S, result) {
    if (!result || !result.advance) return;
    S.advances = S.advances || {};
    S.advances[result.advance.id] = result.advance;
    if (result.docreg && result.docreg.id) {
      S.docreg = S.docreg || {};
      S.docreg[result.docreg.id] = result.docreg;
    }
    if (result.series) {
      S.series = S.series || {};
      S.series[CA] = mergeSeriesCounter(S.series[CA], result.series);
    }
  }

  var storeQueues = typeof WeakMap === "function" ? new WeakMap() : null;

  function queueFor(S) {
    if (!storeQueues || !S || typeof S !== "object") {
      var chain = Promise.resolve();
      return function (fn) {
        var run = chain.then(fn, fn);
        chain = run.then(
          function () {},
          function () {}
        );
        return run;
      };
    }
    var existing = storeQueues.get(S);
    if (existing) return existing;
    var chain = Promise.resolve();
    var q = function (fn) {
      var run = chain.then(fn, fn);
      chain = run.then(
        function () {},
        function () {}
      );
      return run;
    };
    storeQueues.set(S, q);
    return q;
  }

  function localIo(S, year) {
    var io = memoryIo(S);
    io.year = year || new Date().getFullYear();
    io.serialize = queueFor(S);
    return io;
  }

  async function commitFromClient(host, id, obj) {
    var S = storeOf(host);
    host.S = S;
    var rec = clone(obj || {});
    rec.id = id || rec.id;
    if (S.db && typeof S.db.assignCa === "function") {
      var res = await S.db.assignCa(rec, host.SESSION);
      var advance = (res && (res.advance || res.data)) || null;
      if (advance && advance.no == null && res && res.data) advance = res.data;
      var packed = {
        advance: advance,
        docreg: res && res.docreg,
        series: res && res.series,
        kind: res && res.kind,
        ignored: res && res.ignored,
      };
      remember(S, packed);
      if (packed.ignored && host.toast) {
        host.toast("Control number " + packed.advance.no + " stays on this cash advance.", "ok");
      }
      return packed.advance;
    }
    var io = localIo(S);
    var out = await assignCashAdvance(io, rec);
    remember(S, out);
    if (out.ignored && host.toast) host.toast("Control number " + out.advance.no + " stays on this cash advance.", "ok");
    return out.advance;
  }

  function canIssue(a) {
    return !!(a && Number(a.amount) > 0 && (a.empId || a.receivedBy));
  }

  function esc(s) {
    return str(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function empLabel(S, a) {
    var e = S && S.employees && a && a.empId ? S.employees[a.empId] : null;
    return (e && e.name) || (a && a.receivedBy) || (a && a.id) || "another record";
  }

  function injectReview(host) {
    var S = storeOf(host);
    var doc = host && host.document;
    if (!doc || !S || !S.ui || S.ui.view !== "cashadv") return;
    var view = doc.getElementById ? doc.getElementById("view") : null;
    if (!view) return;
    var groups = reviewDuplicates(S);
    var existing = doc.getElementById("hr-ca-review");
    if (!groups.length) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    var html =
      '<div class="card" id="hr-ca-review" style="margin:14px 0;border-left:3px solid var(--crit)"><div class="card-b">' +
      "<b>Cash advance control numbers to review</b>" +
      '<div class="note">Each cash advance should have its own control number. The oldest record keeps the number it was saved with. The others are listed here and are not renumbered.</div>' +
      groups
        .map(function (g) {
          return (
            '<div class="note" style="margin-top:6px"><b class="mono">' +
            esc(g.no) +
            "</b> stays on " +
            esc(empLabel(S, g.keeper)) +
            " (" +
            esc(g.keeper.status || "") +
            "). Review: " +
            g.review
              .map(function (a) {
                return esc(empLabel(S, a)) + " (" + esc(a.status || "") + ", same number " + esc(a.no) + ")";
              })
              .join("; ") +
            "</div>"
          );
        })
        .join("") +
      "</div></div>";
    if (existing) {
      existing.outerHTML = html;
      return;
    }
    var bar = view.querySelector ? view.querySelector(".row") : null;
    var wrap = doc.createElement("div");
    wrap.innerHTML = html;
    if (bar && bar.parentNode) bar.parentNode.insertBefore(wrap.firstChild, bar.nextSibling);
    else if (view.insertBefore && view.firstChild) view.insertBefore(wrap.firstChild, view.firstChild);
  }

  function lockControlField(doc) {
    if (!doc || !doc.querySelector) return null;
    var modal = doc.querySelector(".modal");
    if (!modal) return null;
    var h = modal.querySelector("h3");
    var title = h ? str(h.textContent) : "";
    if (!/cash advance/i.test(title)) return null;
    var labels = modal.querySelectorAll("label");
    var i;
    var input = null;
    for (i = 0; i < labels.length; i += 1) {
      if (!/number/i.test(labels[i].textContent || "")) continue;
      if (/petty|or \/|receipt/i.test(labels[i].textContent || "")) continue;
      labels[i].textContent = "Control number";
      var box = labels[i].parentNode;
      input = box && box.querySelector ? box.querySelector("input") : null;
      if (input) break;
    }
    if (!input) {
      var disabled = modal.querySelectorAll("input[disabled]");
      input = disabled && disabled[0] ? disabled[0] : null;
    }
    if (!input) return null;
    input.disabled = true;
    input.readOnly = true;
    if (input.setAttribute) {
      input.setAttribute("disabled", "disabled");
      input.setAttribute("readonly", "readonly");
    }
    input.title = "Assigned when the cash advance is saved. It does not change.";
    return input;
  }

  function patchGlobals(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return {};
    storeOf(host);

    if (typeof host.peekNo === "function" && !host.peekNo._hrCa) {
      var origPeek = host.peekNo;
      host.peekNo = function (key) {
        if (str(key) === CA) return "";
        return origPeek.apply(this, arguments);
      };
      host.peekNo._hrCa = true;
    }

    if (typeof host.allocate === "function" && !host.allocate._hrCa) {
      var origAlloc = host.allocate;
      host.allocate = function (key, meta) {
        if (str(key) !== CA) return origAlloc.apply(this, arguments);
        return Promise.resolve({ id: "", no: "", pending: true, seriesKey: CA, meta: meta || null });
      };
      host.allocate._hrCa = true;
    }

    if (typeof host.put === "function" && !host.put._hrCa) {
      var origPut = host.put;
      host.put._hrCaOrig = origPut;
      host.put = function (coll, id, obj) {
        var self = this;
        if (coll === "series" && str(id) === CA && obj) {
          var guarded = guardSeriesWrite(seriesOf(storeOf(host)), obj);
          return origPut.call(self, coll, id, guarded);
        }
        if (coll !== "advances") return origPut.call(self, coll, id, obj);
        return commitFromClient(host, id, obj)
          .then(function (saved) {
            if (obj && saved && saved.no) obj.no = saved.no;
            return origPut.call(self, coll, id, saved || obj);
          })
          .catch(function (e) {
            if (host.toast) host.toast((e && e.message) || "The cash advance number could not be saved.", "err");
            throw e;
          });
      };
      host.put._hrCa = true;
    }

    if (typeof host.drop === "function" && !host.drop._hrCa) {
      var origDrop = host.drop;
      host.drop = function (coll, id) {
        var S = storeOf(host);
        var job = Promise.resolve();
        if (coll === "advances" && S.advances && S.advances[id] && S.advances[id].no) {
          var advance = S.advances[id];
          job = queueFor(S)(function () {
            return retireNumber(localIo(S), advance);
          });
        } else if (coll === "docreg" && S.docreg && isCaDoc(S.docreg[id]) && S.docreg[id].no) {
          var doc = S.docreg[id];
          job = queueFor(S)(function () {
            return retireNumber(localIo(S), { no: doc.no, id: doc.refId, empId: doc.empId, date: doc.date });
          });
        }
        var self = this;
        var args = arguments;
        return job.then(function () {
          return origDrop.apply(self, args);
        });
      };
      host.drop._hrCa = true;
    }

    if (typeof host.printCA === "function" && !host.printCA._hrCa) {
      var origPrint = host.printCA;
      host.printCA = function (a, opt) {
        var self = this;
        var S = storeOf(host);
        var stored = a && S.advances ? S.advances[a.id] : null;
        var no = stored && stored.no ? stored.no : "";
        function go(rec, draft) {
          return origPrint.call(self, rec, Object.assign({}, opt || {}, { draft: !!draft }));
        }
        if (no) {
          var fixed = Object.assign({}, a, { no: no });
          return go(fixed, false);
        }
        if (canIssue(a)) {
          return commitFromClient(host, a.id, Object.assign({}, a, { no: "" })).then(function (saved) {
            if (!saved) return go(Object.assign({}, a, { no: "" }), true);
            if (a) a.no = saved.no;
            return go(Object.assign({}, a, saved), false);
          });
        }
        return go(Object.assign({}, a, { no: "" }), true);
      };
      host.printCA._hrCa = true;
    }

    if (typeof host.savePDF === "function" && !host.savePDF._hrCa) {
      var origPdf = host.savePDF;
      host.savePDF = function (no, body, preview) {
        if (/CASH ADVANCE REQUEST FORM/i.test(str(body))) {
          var shown = sheetControlNo(body);
          if (!shown) {
            if (host.toast) host.toast("Save the cash advance first. The PDF uses the control number assigned then.", "err");
            return Promise.resolve(false);
          }
          no = shown;
        }
        return origPdf.call(this, no, body, preview);
      };
      host.savePDF._hrCa = true;
    }

    if (typeof host.payslipCaNote === "function" && !host.payslipCaNote._hrCa) {
      var origNote = host.payslipCaNote;
      host.payslipCaNote = function (L) {
        var text = origNote.apply(this, arguments);
        var nos = deductControlNos(storeOf(host), L && L.empId);
        return noteWithControlNos(text, nos);
      };
      host.payslipCaNote._hrCa = true;
    }

    if (typeof host.openModal === "function" && !host.openModal._hrCa) {
      var origModal = host.openModal;
      host.openModal = function () {
        var out = origModal.apply(this, arguments);
        try {
          lockControlField(host.document);
        } catch (e) {}
        return out;
      };
      host.openModal._hrCa = true;
    }

    if (typeof host.render === "function" && !host.render._hrCa) {
      var origRender = host.render;
      host.render = function () {
        var out = origRender.apply(this, arguments);
        try {
          patchGlobals(host);
          injectReview(host);
          lockControlField(host.document);
        } catch (e) {}
        return out;
      };
      host.render._hrCa = true;
    }

    return { ok: true };
  }

  function attach(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return api;
    patchGlobals(host);
    try {
      injectReview(host);
    } catch (e) {}
    api.attached = true;
    return api;
  }

  var api = {
    attached: false,
    CA: CA,
    DUP_CODE: DUP_CODE,
    BUSY_CODE: BUSY_CODE,
    attach: attach,
    install: attach,
    patchGlobals: patchGlobals,
    parseCaf: parseCaf,
    sameNo: sameNo,
    formatCaf: formatCaf,
    isCaDoc: isCaDoc,
    isPaper: isPaper,
    planSave: planSave,
    nextNumber: nextNumber,
    highSeq: highSeq,
    mergeSeriesCounter: mergeSeriesCounter,
    guardSeriesWrite: guardSeriesWrite,
    reviewDuplicates: reviewDuplicates,
    shouldMove: shouldMove,
    assignCashAdvance: assignCashAdvance,
    retireNumber: retireNumber,
    memoryIo: memoryIo,
    rowsToMap: rowsToMap,
    formControlNo: formControlNo,
    pdfFileName: pdfFileName,
    driveFileName: driveFileName,
    approvedFileName: approvedFileName,
    exportNumber: exportNumber,
    surfaces: surfaces,
    sheetControlNo: sheetControlNo,
    slugNo: slugNo,
    deductControlNos: deductControlNos,
    noteWithControlNos: noteWithControlNos,
    closedStatus: closedStatus,
    lockControlField: lockControlField,
    takenByOther: takenByOther,
    ageKey: ageKey,
  };

  return api;
});
