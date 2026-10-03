/**
 * Corcondev Motorpool business rules.
 * Frozen reads, fuel/papers/variance/infer, missing-field lists.
 * Works in the browser and under node --test (UMD).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MotorpoolRules = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ZERO_SCORE =
    /labour|labor|fastener|bolt|nut|washer|rag|consumable|sundry|helper|overtime|screws?/i;

  var HOUR_PREFIXES = { BH: 1, RR: 1, TM: 1, MBC: 1, EQ: 1, EQUIPMENT: 1 };

  var EXCLUDED_PAPER_STATUS = { sold: 1, av: 1, "equipment-n": 1 };

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (value === null || typeof value !== "object") return value;
    if (!Object.isFrozen(value)) Object.freeze(value);
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) deepFreeze(value[i]);
    } else {
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k++) deepFreeze(value[keys[k]]);
    }
    return value;
  }

  function freezeRead(value) {
    return deepFreeze(clone(value));
  }

  function thaw(value) {
    return clone(value);
  }

  function isFrozenDeep(value) {
    if (value === null || typeof value !== "object") return true;
    if (!Object.isFrozen(value)) return false;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) {
        if (!isFrozenDeep(value[i])) return false;
      }
      return true;
    }
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      if (!isFrozenDeep(value[keys[k]])) return false;
    }
    return true;
  }

  /**
   * Artifact rule: isFuel requires a dash after "fuel"
   *   /^\s*fuel\s*[—–-]/i
   * so "Fuel Filter" is never fuel. "Fuel — Diesel" is.
   */
  function isFuel(text) {
    return /^\s*fuel\s*[—–-]/i.test(text == null ? "" : text);
  }

  function unitCodePrefix(unit) {
    var code = String((unit && (unit.code || unit.id)) || "").toUpperCase();
    return code.split("-")[0] || "";
  }

  function meterKindForUnit(unit) {
    if (unit && unit.meterKind) return unit.meterKind;
    var prefix = unitCodePrefix(unit);
    if (HOUR_PREFIXES[prefix]) return "hr";
    if (unit && /equipment|backhoe|roller|mixer|mbc/i.test(String(unit.type || ""))) {
      return "hr";
    }
    return "km";
  }

  function normalizePlate(plate) {
    return String(plate == null ? "" : plate)
      .trim()
      .toUpperCase();
  }

  /** Plant: code starting BH- / RR-, or blank / NA plate. Deed only. */
  function isPlantUnit(unit) {
    var code = String((unit && (unit.code || unit.id)) || "").toUpperCase();
    if (code.indexOf("BH-") === 0 || code.indexOf("RR-") === 0) return true;
    var plate = normalizePlate(unit && unit.plate);
    if (!plate || plate === "NA" || plate === "N/A" || plate === "-" || plate === "NONE") {
      return true;
    }
    if (/^BH-/.test(plate) || /^RR-/.test(plate)) return true;
    return false;
  }

  function isEquipmentNName(unit) {
    var name = String((unit && unit.name) || "").trim();
    return /^equipment\s+\d+$/i.test(name);
  }

  function excludeFromPapersChase(unit) {
    if (!unit) return true;
    var status = String(unit.status || "").toLowerCase();
    if (EXCLUDED_PAPER_STATUS[status]) return true;
    if (isEquipmentNName(unit)) return true;
    return false;
  }

  function papersNeeded(unit) {
    if (excludeFromPapersChase(unit)) return [];
    if (isPlantUnit(unit)) return ["deed"];
    return ["cr", "or", "insurance"];
  }

  function hasPaper(unit, key) {
    var papers = (unit && unit.papers) || {};
    if (key === "cr" || key === "or") {
      if (papers.orCrCombined || papers.orcr) return true;
    }
    var val = papers[key];
    if (val === true) return true;
    if (val && typeof val === "object" && (val.onFile || val.url || val.photoId)) return true;
    if (typeof val === "string" && val.trim()) return true;
    return false;
  }

  function missingPapers(unit) {
    return papersNeeded(unit).filter(function (key) {
      return !hasPaper(unit, key);
    });
  }

  function papersToChase(units) {
    var list = Array.isArray(units) ? units : [];
    return list
      .filter(function (u) {
        return !excludeFromPapersChase(u);
      })
      .map(function (u) {
        return {
          id: u.id,
          code: u.code || u.id,
          name: u.name,
          plate: u.plate,
          plant: isPlantUnit(u),
          needed: papersNeeded(u),
          missing: missingPapers(u),
        };
      })
      .filter(function (row) {
        return row.missing.length > 0;
      });
  }

  function lineAmount(line) {
    if (!line) return 0;
    if (line.amount != null && line.amount !== "") return Number(line.amount) || 0;
    var qty = line.litres != null && line.litres !== "" ? Number(line.litres) : Number(line.qty);
    var price = Number(line.unitPrice);
    if (!isFinite(qty) || !isFinite(price)) return 0;
    return Math.round(qty * price * 100) / 100;
  }

  function sumLines(lines) {
    var total = 0;
    (lines || []).forEach(function (line) {
      total += lineAmount(line);
    });
    return Math.round(total * 100) / 100;
  }

  /** >10% over approved → Flagged notice (not a block). */
  function varianceFlag(approved, spent, pct) {
    var a = Number(approved);
    var s = Number(spent);
    var p = pct == null ? 10 : Number(pct);
    if (!isFinite(a) || a <= 0) return false;
    if (!isFinite(s)) return false;
    return s > a * (1 + p / 100);
  }

  function varianceNotice(approved, spent, pct) {
    if (!varianceFlag(approved, spent, pct)) return null;
    return {
      kind: "Flagged",
      notice: true,
      block: false,
      approved: Number(approved),
      spent: Number(spent),
      overPct: Math.round(((Number(spent) - Number(approved)) / Number(approved)) * 1000) / 10,
    };
  }

  function longestPhraseMatch(text, worktypes) {
    var hay = String(text || "").toLowerCase();
    var best = null;
    var bestLen = 0;
    (worktypes || []).forEach(function (t) {
      var name = String(t.name || "").toLowerCase();
      if (name && hay.indexOf(name) !== -1 && name.length > bestLen) {
        best = t;
        bestLen = name.length;
      }
    });
    return best ? { type: best, phraseLen: bestLen } : null;
  }

  /**
   * Workbook LTO lines rarely use the job-type name "LTO registration renewal".
   * They land as item "LTO Renewal" under part category "LTO Processing / Delivery F"
   * and sub "Registration". Phrase-in-name matching therefore misses them.
   */
  var LTO_JOB_LABEL = "LTO Registration/Renewal/Name Change";
  var LTO_RENEW_RE =
    /lto\s*(registration\s*[/]?\s*)?renew|registration\s*[/]?\s*renew|lto\s*registration\s*[/]\s*renewal(?:\s*[/]\s*name\s*change)?|lto\s*processing|lto\s*reg(?:istration)?\b/i;

  function lineHaystack(line) {
    if (!line) return "";
    return [line.cat, line.sub, line.item, line.notes, line.grp, line.description]
      .filter(Boolean)
      .join(" ");
  }

  function isLtoRenewalLine(line) {
    if (!line) return false;
    var hay = lineHaystack(line);
    if (LTO_RENEW_RE.test(hay)) return true;
    var cat = String(line.cat || "");
    var sub = String(line.sub || "");
    var item = String(line.item || "");
    if (/lto/i.test(cat) && /regist/i.test(sub)) return true;
    if (/lto/i.test(cat) && /lto/i.test(item)) return true;
    if (/lto/i.test(item) && /regist/i.test(sub + " " + cat)) return true;
    if (/\blto\b/i.test(item)) return true;
    return false;
  }

  function findLtoWorktype(worktypes) {
    var best = null;
    var bestScore = 0;
    (worktypes || []).forEach(function (w) {
      var name = String(w.name || "").toLowerCase();
      var code = String(w.code || w.id || "").toLowerCase();
      var blob = name + " " + code + " " + String(w.family || w.familyId || "").toLowerCase();
      var score = 0;
      if (/lto/.test(blob) && /renew|regist|name change/.test(blob)) score += 3;
      if (/registration\s*[/]?\s*renew/.test(name)) score += 2;
      if (name === "lto registration renewal" || name === "lto registration/renewal/name change") score += 4;
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    });
    return bestScore > 0 ? best : null;
  }

  function ltoWorkCode(worktypes) {
    var w = findLtoWorktype(worktypes);
    if (!w) return null;
    return w.code || w.id || null;
  }

  /** 2026-08-03 → 2027-08-03. Feb 29 clamps to Feb 28. PH LTO renewal is typically 1 year. */
  function addCalendarYear(isoDate) {
    var s = String(isoDate || "");
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return "";
    var y = Number(m[1]) + 1;
    var mo = Number(m[2]);
    var day = Number(m[3]);
    var next = new Date(y, mo - 1, day);
    if (next.getMonth() !== mo - 1) {
      next = new Date(y, mo, 0);
    }
    var mm = String(next.getMonth() + 1).padStart(2, "0");
    var dd = String(next.getDate()).padStart(2, "0");
    return next.getFullYear() + "-" + mm + "-" + dd;
  }

  function ltoProposalFromLine(line) {
    if (!line || !isLtoRenewalLine(line)) return null;
    var issued = String(line.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issued)) return null;
    var monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return {
      regDate: issued,
      regExpiry: addCalendarYear(issued),
      regMonth: monthNames[Number(issued.slice(5, 7)) - 1] || "",
      vrf: line.vrf || "",
      item: line.item || line.cat || "LTO Renewal",
      assumption: "Expiry is registration date + 1 year (typical PH LTO private-vehicle renewal). Change it if the OR shows a different stamp.",
    };
  }

  function ltoDetailsStale(unit, proposal) {
    if (!proposal) return false;
    if (!unit) return true;
    var haveDate = String(unit.regDate || "").slice(0, 10);
    var haveExp = String(unit.regExpiry || "").slice(0, 10);
    if (!haveDate || !haveExp) return true;
    return haveDate !== proposal.regDate;
  }

  /**
   * VRF log search: "5604" hits 5604; a padded typo "56004" also hits 5604.
   * Leading zeros are ignored. Non-numeric needles still substring-match.
   */
  /** Empty array is truthy — do not treat a first-paint [] as a built index. */
  function vrfIndexStale(cached, lineCount) {
    if (cached == null) return true;
    if (!cached.length && lineCount > 0) return true;
    return false;
  }

  function vrfSearchHits(vrf, term) {
    var v = String(vrf == null ? "" : vrf).toLowerCase();
    var t = String(term == null ? "" : term).toLowerCase().trim();
    if (!t) return true;
    if (v.indexOf(t) >= 0) return true;
    var vd = v.replace(/\D/g, "");
    var td = t.replace(/\D/g, "");
    if (!td || !vd) return false;
    if (vd === td) return true;
    var vs = vd.replace(/^0+/, "") || "0";
    var ts = td.replace(/^0+/, "") || "0";
    if (vs === ts) return true;
    if (td.length === vd.length + 1) {
      for (var i = 0; i < td.length; i++) {
        if (td.charAt(i) === "0" && td.slice(0, i) + td.slice(i + 1) === vd) return true;
      }
    }
    return false;
  }

  var LTO_EXTRA_KEYS = [
    "LTO Processing / Delivery F",
    "LTO Processing / Delivery",
    "LTO Processing",
    "LTO Renewal",
  ];
  var LTO_EXTRA_WORDS = [
    "lto renewal",
    "lto registration renewal",
    "registration renewal",
    "lto processing",
    "lto renew",
    "lto registration/renewal/name change",
    "name change",
  ];

  function enrichLtoWorktype(worktypes) {
    var w = findLtoWorktype(worktypes);
    if (!w) return null;
    function merge(arr, extra) {
      var out = (arr || []).slice();
      extra.forEach(function (x) {
        var needle = String(x).toLowerCase();
        var has = out.some(function (y) {
          return String(y).toLowerCase() === needle;
        });
        if (!has) out.push(x);
      });
      return out;
    }
    w.key = merge(w.key, LTO_EXTRA_KEYS);
    w.cats = merge(w.cats, LTO_EXTRA_KEYS);
    w.words = merge(w.words, LTO_EXTRA_WORDS);
    return w;
  }

  function legacyLtoJobName(name) {
    var n = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    return n === "lto registration renewal" || n === "lto registration/renewal";
  }

  /** Display label only. code / id stay so existing job orders keep resolving. */
  function renameLtoJobLabel(worktypes) {
    var w = findLtoWorktype(worktypes);
    if (!w) return false;
    if (String(w.name || "").trim() === LTO_JOB_LABEL) return false;
    if (!legacyLtoJobName(w.name)) return false;
    w.name = LTO_JOB_LABEL;
    return true;
  }

  /* Same ink rules as the VRF print path in public/index.html. */
  var VRF_SIG_PRINT_H = 56;
  var VRF_SIG_PRINT_W = 180;

  function signatureInkBounds(data, width, height) {
    var minX = width;
    var minY = height;
    var maxX = -1;
    var maxY = -1;
    var y, x, i, a, r, g, b;
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        i = (y * width + x) * 4;
        a = data[i + 3];
        r = data[i];
        g = data[i + 1];
        b = data[i + 2];
        if (a < 16) continue;
        if (r > 240 && g > 240 && b > 240) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function knockOutSignaturePixels(px) {
    var i;
    for (i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 16 || (px[i] > 240 && px[i + 1] > 240 && px[i + 2] > 240)) px[i + 3] = 0;
    }
    return px;
  }

  function cropSignaturePixels(data, width, height, pad) {
    knockOutSignaturePixels(data);
    var box = signatureInkBounds(data, width, height);
    var p = pad == null ? 6 : pad;
    if (!box) return { data: data, width: width, height: height, x: 0, y: 0 };
    var x0 = Math.max(0, box.minX - p);
    var y0 = Math.max(0, box.minY - p);
    var x1 = Math.min(width - 1, box.maxX + p);
    var y1 = Math.min(height - 1, box.maxY + p);
    var tw = Math.max(1, x1 - x0 + 1);
    var th = Math.max(1, y1 - y0 + 1);
    var out = new Uint8ClampedArray(tw * th * 4);
    var y, x, si, di;
    for (y = 0; y < th; y++) {
      for (x = 0; x < tw; x++) {
        si = ((y0 + y) * width + (x0 + x)) * 4;
        di = (y * tw + x) * 4;
        out[di] = data[si];
        out[di + 1] = data[si + 1];
        out[di + 2] = data[si + 2];
        out[di + 3] = data[si + 3];
      }
    }
    return { data: out, width: tw, height: th, x: x0, y: y0 };
  }

  /**
   * Infer job from lines: key category 3, supporting 1, longest phrase wins.
   * Labour / fasteners / rags score 0.
   */
  function inferJob(lines, worktypes) {
    var types = worktypes || [];
    var matches = [];
    (lines || []).forEach(function (line) {
      var text = [line.description, line.item, line.workTypeOverride, line.workTypeName]
        .filter(Boolean)
        .join(" ");
      var zero = ZERO_SCORE.test(text);
      var type = null;
      var phraseLen = 0;
      if (line.workTypeId) {
        type = types.filter(function (t) {
          return t.id === line.workTypeId;
        })[0] || null;
        phraseLen = type ? String(type.name).length : 0;
      } else {
        var hit = longestPhraseMatch(text, types);
        if (hit) {
          type = hit.type;
          phraseLen = hit.phraseLen;
        }
      }
      matches.push({ type: type, phraseLen: phraseLen, zero: zero && !line.workTypeId });
    });

    var keyTypeId = null;
    var keyPhraseLen = -1;
    matches.forEach(function (m) {
      if (m.type && !m.zero && m.phraseLen > keyPhraseLen) {
        keyPhraseLen = m.phraseLen;
        keyTypeId = m.type.id;
      }
    });

    var familyScores = {};
    var typeScores = {};
    matches.forEach(function (m) {
      if (!m.type || m.zero) return;
      var add = m.type.id === keyTypeId ? 3 : 1;
      var fam = m.type.familyId;
      familyScores[fam] = (familyScores[fam] || 0) + add;
      typeScores[m.type.id] = (typeScores[m.type.id] || 0) + add;
    });

    var winner = null;
    var winScore = -1;
    types.forEach(function (t) {
      var sc = typeScores[t.id] || 0;
      if (sc > winScore) {
        winScore = sc;
        winner = t;
      } else if (sc === winScore && winner && String(t.name).length > String(winner.name).length) {
        winner = t;
      }
    });

    if (!winner || winScore <= 0) {
      return { workType: null, family: null, inferred: true, scores: familyScores };
    }
    return {
      workType: winner,
      family: winner.familyId,
      inferred: true,
      scores: familyScores,
    };
  }

  function average(nums) {
    var list = (nums || []).filter(function (n) {
      return isFinite(n);
    });
    if (!list.length) return null;
    var s = 0;
    list.forEach(function (n) {
      s += n;
    });
    return s / list.length;
  }

  function fillToFillRate(curr, prev, meterKind) {
    if (!curr || !prev) return null;
    var delta = Number(curr.meter) - Number(prev.meter);
    var litres = Number(curr.litres);
    if (!isFinite(delta) || delta <= 0 || !isFinite(litres) || litres <= 0) return null;
    if (meterKind === "hr") return litres / delta;
    return delta / litres;
  }

  function typicalBand(meterKind) {
    if (meterKind === "hr") return { lo: 4, hi: 18, unit: "L/hr" };
    return { lo: 3, hi: 12, unit: "km/L" };
  }

  /**
   * Fuel request gates. Override with reason. Meter hard-stop is an OPEN
   * decision (default off) — never invent an owner choice.
   */
  function fuelGates(input, history, settings) {
    settings = settings || {};
    var issues = [];
    var litres = Number(input && input.litres);
    var meter = Number(input && input.meter);
    var kind = (input && input.meterKind) || "km";
    var fills = (history || []).filter(function (h) {
      return !h.badInterval;
    });
    var prev = fills.length ? fills[fills.length - 1] : null;

    if (prev && isFinite(meter) && isFinite(Number(prev.meter))) {
      if (meter < Number(prev.meter)) {
        issues.push({ code: "reverse", label: "Meter went backwards" });
      } else if (meter === Number(prev.meter)) {
        issues.push({ code: "no-move", label: "Meter did not move" });
      }
    }

    var floor = Number(settings.fuelFloorLitres || 0);
    if (isFinite(litres) && litres < floor) {
      issues.push({ code: "under-floor", label: "Litres under floor" });
    }

    var avgLitres = average(
      fills.map(function (h) {
        return Number(h.litres);
      })
    );
    var overPct = settings.litresOverAvgPct == null ? 60 : Number(settings.litresOverAvgPct);
    if (avgLitres && isFinite(litres) && litres > avgLitres * (1 + overPct / 100)) {
      issues.push({
        code: "litres-over-avg",
        label: "Litres more than " + overPct + "% over average",
      });
    }

    var rate = fillToFillRate(input, prev, kind);
    var band = typicalBand(kind);
    var bandPct = settings.rateBandPct == null ? 40 : Number(settings.rateBandPct);
    if (rate != null && band) {
      var mid = (band.lo + band.hi) / 2;
      if (rate < mid * (1 - bandPct / 100) || rate > mid * (1 + bandPct / 100)) {
        issues.push({
          code: "rate-band",
          label: "Rate more than " + bandPct + "% outside band (" + band.unit + ")",
        });
      }
    }

    var hard = settings.meterReadingHardStop === true;
    var meterIssue = issues.some(function (i) {
      return i.code === "reverse" || i.code === "no-move";
    });

    return {
      issues: issues,
      rate: rate,
      band: band,
      blocked: hard && meterIssue,
      needsOverride: issues.length > 0,
      meterReadingHardStop: hard,
    };
  }

  function dropBadIntervals(fills) {
    return (fills || []).filter(function (f) {
      return !f.badInterval;
    });
  }

  function missingList(pairs) {
    var out = [];
    (pairs || []).forEach(function (p) {
      if (!p.ok) out.push(p.label);
    });
    return out;
  }

  function missingReserveFields(doc) {
    var fuel = doc && (doc.kind === "fuel-issue" || doc.kind === "fuel-bulk");
    return missingList([
      { ok: Boolean(doc && doc.unitId), label: "Unit" },
      { ok: Boolean(doc && (doc.jobTypeId || fuel)), label: "Type of job" },
      { ok: Boolean(doc && String(doc.purpose || "").trim()), label: "Purpose" },
      { ok: Boolean(doc && String(doc.requestedBy || "").trim()), label: "Requested by" },
      {
        ok: Boolean(doc && doc.lines && doc.lines.length),
        label: fuel ? "Fuel line (litres)" : "At least one line",
      },
    ]);
  }

  function missingFuelApproveFields(doc) {
    var fuel = doc && (doc.kind === "fuel-issue" || doc.kind === "fuel-bulk");
    if (!fuel) return [];
    return missingList([]);
  }

  function masterList(doc, key) {
    if (!doc) return [];
    if (Array.isArray(doc.rows)) return doc.rows;
    if (key && Array.isArray(doc[key])) return doc[key];
    if (Array.isArray(doc.projects)) return doc.projects;
    if (Array.isArray(doc.suppliers)) return doc.suppliers;
    return [];
  }

  function projectStatusOf(p) {
    if (p == null || typeof p === "string") return "Active";
    if (p.archived === true || p.active === false) return "Archived";
    var st = String(p.status || "").trim();
    if (/^(archived|inactive|closed|retired)$/i.test(st)) return "Archived";
    return "Active";
  }

  function asProject(p) {
    if (p == null || p === "") return null;
    if (typeof p === "string") {
      var s = String(p).trim();
      return s ? { code: s, name: s, status: "Active" } : null;
    }
    var code = String(p.code || p.name || p.id || "").trim();
    if (!code) return null;
    return {
      code: code,
      name: (p.name && String(p.name).trim()) || code,
      status: projectStatusOf(p),
    };
  }

  function isProjectArchived(p) {
    var row = asProject(p);
    return Boolean(row && row.status === "Archived");
  }

  function projectCodeOf(p) {
    var row = asProject(p);
    return row ? row.code : "";
  }

  function projectStamp(list) {
    return (list || [])
      .map(function (p) {
        var row = asProject(p);
        return row ? row.code + "\t" + row.name + "\t" + row.status : "";
      })
      .sort()
      .join("\0");
  }

  function harvestProjectCodes(sources) {
    var seen = {};
    var out = [];
    function add(raw) {
      var row = asProject(raw);
      if (!row || seen[row.code]) return;
      seen[row.code] = 1;
      out.push(row.code);
    }
    sources = sources || {};
    (sources.vehicles || []).forEach(function (v) {
      if (v && v.site) add(v.site);
    });
    (sources.reserves || []).forEach(function (r) {
      if (r && r.project) add(r.project);
    });
    (sources.withdrawals || []).forEach(function (d) {
      if (d && d.project) add(d.project);
    });
    (sources.purchases || []).forEach(function (d) {
      if (d && d.project) add(d.project);
    });
    Object.keys(sources.ledger || {}).forEach(function (mk) {
      (sources.ledger[mk] || []).forEach(function (r) {
        if (r && r.project) add(r.project);
      });
    });
    (sources.extra || []).forEach(add);
    return out;
  }

  function mergeProjectStore(managed, harvestedCodes) {
    var byCode = {};
    var out = [];
    function put(p) {
      var row = asProject(p);
      if (!row || byCode[row.code]) return;
      byCode[row.code] = row;
      out.push(row);
    }
    (managed || []).forEach(put);
    (harvestedCodes || []).forEach(function (code) {
      put(typeof code === "string" ? { code: code, name: code, status: "Active" } : code);
    });
    out.sort(function (a, b) {
      return String(a.code).localeCompare(String(b.code));
    });
    return out;
  }

  function pickerProjectList(projects, opts) {
    opts = opts || {};
    var includeArchived = Boolean(opts.includeArchived);
    var current = opts.current != null ? String(opts.current).trim() : "";
    var out = [];
    (projects || []).forEach(function (p) {
      var row = asProject(p);
      if (!row) return;
      if (row.status === "Archived" && !includeArchived && row.code !== current) return;
      out.push(row);
    });
    return out;
  }

  function upsertManagedProject(managed, patch) {
    var next = asProject(patch);
    if (!next) return { ok: false, reason: "code required", projects: (managed || []).map(asProject).filter(Boolean) };
    if (patch && patch.archived === true) next.status = "Archived";
    if (patch && patch.archived === false) next.status = "Active";
    var list = (managed || []).map(asProject).filter(Boolean);
    var prevCode = patch && patch.prevCode ? String(patch.prevCode).trim() : next.code;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].code === prevCode || list[i].code === next.code) {
        idx = i;
        break;
      }
    }
    if (idx >= 0 && list[idx].code !== next.code) {
      for (var j = 0; j < list.length; j++) {
        if (j !== idx && list[j].code === next.code) {
          return { ok: false, reason: "code already on file", projects: list };
        }
      }
      list[idx] = next;
    } else if (idx >= 0) {
      list[idx] = next;
    } else {
      list.push(next);
    }
    list.sort(function (a, b) {
      return String(a.code).localeCompare(String(b.code));
    });
    return { ok: true, project: next, projects: list };
  }

  function recordProjectLabel(stored) {
    return stored == null || stored === "" ? "" : String(stored);
  }

  function photoOwnersForReserve(r) {
    if (!r) return [];
    var owners = ["RSV-" + r.no];
    if (r.vrfNo) owners.push(String(r.vrfNo));
    (r.vrfs || []).forEach(function (no) {
      if (no) owners.push(String(no));
    });
    return owners.filter(function (x, i, a) {
      return x && a.indexOf(x) === i;
    });
  }

  function photoOwnersForVrf(entry) {
    if (entry == null) return [];
    var no = typeof entry === "object" ? entry.vrf : entry;
    no = String(no == null ? "" : no).trim();
    return no ? [no] : [];
  }

  function spendEndStatus(raw) {
    raw = String(raw || "").trim();
    if (/^not[- ]bought$/i.test(raw)) return "Not bought";
    if (/^duplicate\b/i.test(raw)) return "Duplicate";
    if (/^cancel(?:led|ed)$/i.test(raw)) return "Cancelled";
    return "";
  }

  function reserveSpendClosed(reserve) {
    if (!reserve) return false;
    if (String(reserve.status || "") === "Cancelled" || reserve.cancelledAt) return true;
    var outcome = String(reserve.cancelOutcome || "");
    return outcome === "cancelled" || outcome === "not-bought" || outcome === "duplicate";
  }

  /** A cancelled or not-bought hold must not come back at the approved budget. */
  function heldLineAmount(reserve, line) {
    if (reserveSpendClosed(reserve)) return 0;
    if (line) return lineMoney(line);
    return moneyNum(reserve && (reserve.approvedBudget != null ? reserve.approvedBudget : reserve.budget));
  }

  function heldVrfStatus(reserve, fallback) {
    if (!reserve) return fallback || "Open";
    if (reserve.status === "Requested") return "Requested";
    if (reserveSpendClosed(reserve)) {
      var outcome = String(reserve.cancelOutcome || "");
      if (outcome === "not-bought") return "Not bought";
      if (outcome === "duplicate") return "Duplicate";
      return "Cancelled";
    }
    if (
      reserve.status === "Closed" ||
      reserve.status === "Rejected" ||
      reserve.status === "Flagged" ||
      reserve.liquidatedAt
    ) {
      return "Closed";
    }
    return fallback || "Open";
  }

  function liquidationOutcome(rows, edits, added) {
    var list = rows || [];
    if (!list.length) return "bought";
    var allOff = list.every(function (row, i) {
      return edits && edits[i] && edits[i].remove;
    });
    var addedSpend = (added || []).some(function (a) {
      return a && a.cat && (parseFloat(a.qty) || 0) * (parseFloat(a.price) || 0) > 0;
    });
    if (allOff && !addedSpend) return "not-bought";
    return "bought";
  }

  function vrfStatusForOutcome(outcome) {
    if (outcome === "not-bought") return "Not bought";
    if (outcome === "duplicate") return "Duplicate";
    if (outcome === "cancelled") return "Cancelled";
    return "Closed";
  }

  function lineWasNotPurchased(row) {
    if (!row) return false;
    if (row.notBought) return true;
    return !!spendEndStatus(row.vstatus);
  }

  /** Not bought / cancelled keeps the line and zeroes it. Bought keeps the receipt amounts. */
  function applyLiquidationLine(row, edit, stamp, outcome) {
    var e = edit || {};
    var drop = outcome === "cancelled" || outcome === "not-bought" || outcome === "duplicate" || !!e.remove;
    if (drop) {
      var st =
        outcome === "duplicate"
          ? "Duplicate"
          : outcome === "cancelled"
            ? "Cancelled"
            : outcome === "not-bought"
              ? "Not bought"
              : "Closed";
      return Object.assign({}, row || {}, {
        qty: 0,
        price: 0,
        total: 0,
        liters: null,
        notBought: true,
        vstatus: st,
        liq: stamp || null,
      });
    }
    var qty = e.qty != null ? e.qty : row && row.qty;
    var price = e.price != null ? e.price : row && row.price;
    var total = qty != null && price != null ? qty * price : row && row.total;
    var next = Object.assign({}, row || {}, {
      qty: qty,
      price: price,
      total: total,
      notBought: false,
      vstatus: "Closed",
      liq: stamp || null,
    });
    if (e.supplier != null) next.supplier = e.supplier;
    return next;
  }

  function auditMoney(n) {
    var v = moneyNum(n);
    return (Math.round(v * 100) / 100).toFixed(2);
  }

  function reopenAuditNote(by, at, oldAmount, prevLiq) {
    var note = "";
    if (prevLiq && (prevLiq.at || prevLiq.by)) {
      note = "Was liquidated" + (prevLiq.at ? " on " + prevLiq.at : "") + (prevLiq.by ? " by " + prevLiq.by : "");
    }
    return {
      at: at || "",
      by: String(by || "").trim(),
      field: "reopen",
      from: auditMoney(oldAmount),
      to: "awaiting liquidation",
      note: note,
    };
  }

  /** Clear liq and keep the closed amounts. A leftover liq stamp stays Closed. */
  function reopenClosedLedgerRow(row, by, at, oldAmount, prevLiq) {
    var next = Object.assign({}, row || {});
    next.vrf = String(next.vrf || "").trim();
    next.vstatus = "Open";
    next.notBought = false;
    delete next.liq;
    if (next.src === "reserve-hold") delete next.src;
    next.audit = ((row && row.audit) || []).concat([
      reopenAuditNote(by, at, oldAmount, prevLiq || (row && row.liq)),
    ]);
    return next;
  }

  function reserveNeedsReopen(reserve) {
    if (!reserve || reserveSpendClosed(reserve)) return false;
    if (reserve.status === "Closed" || reserve.status === "Flagged") return true;
    return !!reserve.liquidatedAt;
  }

  /** Same VRF number stays sealed via vrfs so a reload does not mint another. */
  function applyReserveReopen(reserve, by, at, oldAmount, prevLiq) {
    if (!reserveNeedsReopen(reserve)) return false;
    var no = String(reserve.vrfNo || "").trim();
    reserve.status = "Approved";
    reserve.liquidatedAt = "";
    reserve.actual = null;
    if (no) {
      var list = (reserve.vrfs || []).map(function (x) {
        return String(x);
      });
      if (list.indexOf(no) < 0) reserve.vrfs = list.concat([no]);
    }
    reserve.audit = (reserve.audit || []).concat([reopenAuditNote(by, at, oldAmount, prevLiq)]);
    return true;
  }

  function priorReopenNote(rows, reserve) {
    var prior = null;
    function scan(list) {
      (list || []).forEach(function (n) {
        if (n && n.field === "reopen") prior = n;
      });
    }
    (rows || []).forEach(function (r) {
      scan(r && r.audit);
    });
    scan(reserve && reserve.audit);
    return prior;
  }

  function recloseAmountAudit(rows, reserve, newTotal, by, at) {
    var prior = priorReopenNote(rows, reserve);
    if (!prior) return null;
    var who = String(prior.by || "").trim();
    var when = String(prior.at || "").trim();
    var extra = "";
    if (who || when) extra = "Reopened by " + (who || "—") + (when ? " on " + when : "");
    return {
      at: at || "",
      by: String(by || "").trim() || who,
      field: "amount",
      from: prior.from || auditMoney(0),
      to: auditMoney(newTotal),
      note: extra,
    };
  }

  function liquidationNewTotal(entry, edits, added, outcome) {
    if (outcome === "not-bought" || outcome === "cancelled" || outcome === "duplicate") return 0;
    var t = 0;
    ((entry && entry.rows) || []).forEach(function (r, i) {
      var e = edits && edits[i];
      if (e && e.remove) return;
      var q = e && e.qty != null ? e.qty : r && r.qty;
      var p = e && e.price != null ? e.price : r && r.price;
      if (q != null && p != null && (moneyNum(q) || moneyNum(p))) t += moneyNum(q) * moneyNum(p);
      else t += moneyNum(r && r.total);
    });
    (added || []).forEach(function (a) {
      if (!a || !a.cat) return;
      t += (parseFloat(a.qty) || 0) * (parseFloat(a.price) || 0);
    });
    return t;
  }

  /**
   * An approved VRF that is still open may be written onto the ledger at
   * liquidation even when approval never posted it. A draft still for approval
   * may not.
   */
  function approvedVrfMayJoinLedger(entry, reserve) {
    if (!entry) return false;
    if (vrfAwaitingApproval(entry, reserve)) return false;
    return !!vrfCanLiquidate(entry, reserve);
  }

  /** "update" existing spend rows, "seed" them for an approved hold, or "refuse". */
  function planLiquidationLedgerWrite(entry, reserve, ledgerHitCount) {
    if (!entry) return "refuse";
    if ((ledgerHitCount || 0) > 0) return "update";
    if (!approvedVrfMayJoinLedger(entry, reserve)) return "refuse";
    return "seed";
  }

  function ledgerMonthKey(s, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    if (m) return m[1] + "-" + m[2];
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || ""));
    if (m) return m[3] + "-" + String(+m[1]).padStart(2, "0");
    var t = String(today || "");
    return /^\d{4}-\d{2}/.test(t) ? t.slice(0, 7) : "";
  }

  /** Real ledger row for one hold line. Does not copy src:"reserve-hold". */
  function ledgerLineFromHoldRow(entry, row, today) {
    row = row || {};
    entry = entry || {};
    var qty = moneyNum(row.qty);
    var price = moneyNum(row.price);
    var total = qty || price ? qty * price : moneyNum(row.total);
    var cat = row.cat || "";
    return {
      month: row.month || ledgerMonthKey(row.date, today) || ledgerMonthKey(entry.date, today) || ledgerMonthKey(today, today),
      date: row.date || entry.date || today || "",
      vrf: String(entry.vrf || row.vrf || ""),
      veh: entry.veh || row.veh || "",
      name: row.name || "",
      cat: cat,
      sub: isFuel(cat) ? "Fuel" : row.sub || "",
      grp: isFuel(cat) ? "Fuel" : row.grp || "Maintenance",
      work: row.work || "",
      item: row.item || "",
      qty: qty,
      price: price,
      total: total,
      supplier: row.supplier || "",
      unit: row.unit || "pc",
      project: row.project || entry.project || "",
      liters: row.liters != null && row.liters !== "" ? row.liters : null,
      odo: row.odo != null ? row.odo : entry.odo != null ? entry.odo : null,
      reserve: String(entry.reserve || row.reserve || ""),
      vstatus: "Open",
      requestedBy: entry.requestedBy || row.requestedBy || "",
      notes: row.notes || entry.notes || "",
    };
  }

  function lineIdentity(line) {
    return [
      String((line && line.cat) || "")
        .trim()
        .toLowerCase(),
      String((line && line.item) || "")
        .trim()
        .toLowerCase(),
      String((line && line.supplier) || "")
        .trim()
        .toLowerCase(),
      String((line && line.work) || "")
        .trim()
        .toLowerCase(),
    ].join("\u0001");
  }

  /**
   * A draft line may fill blanks on a hold row only when it is the same line
   * (lineKey or cat/item/supplier/work) or the only draft left. Never drafts[i].
   */
  function matchDraftLine(row, drafts, used) {
    drafts = drafts || [];
    used = used || {};
    var i;
    if (row && row.lineKey) {
      for (i = 0; i < drafts.length; i++) {
        if (used[i]) continue;
        if (drafts[i] && String(drafts[i].lineKey || "") === String(row.lineKey)) {
          used[i] = 1;
          return drafts[i];
        }
      }
    }
    var hasOwn =
      row &&
      (String(row.cat || "").trim() ||
        String(row.item || "").trim() ||
        String(row.supplier || "").trim());
    if (hasOwn) {
      var id = lineIdentity(row);
      for (i = 0; i < drafts.length; i++) {
        if (used[i]) continue;
        if (lineIdentity(drafts[i]) === id) {
          used[i] = 1;
          return drafts[i];
        }
      }
      return null;
    }
    var left = [];
    for (i = 0; i < drafts.length; i++) if (!used[i]) left.push(i);
    if (left.length === 1) {
      used[left[0]] = 1;
      return drafts[left[0]];
    }
    return null;
  }

  function closedLedgerLinesFromHold(entry, edits, stamp, today, reserve) {
    var drafts = ((reserve && reserve.draftLines) || []).filter(function (l) {
      return l && (l.cat || l.item);
    });
    var used = {};
    var rows =
      entry && entry.rows && entry.rows.length
        ? entry.rows
        : [
            {
              date: entry && entry.date,
              vrf: entry && entry.vrf,
              qty: 0,
              price: 0,
              total: entry && entry.total,
              reserve: entry && entry.reserve,
            },
          ];
    var want = String((entry && entry.vrf) || "").trim();
    return rows
      .map(function (row, i) {
        var draft = matchDraftLine(row, drafts, used) || {};
        var merged = Object.assign({}, row || {});
        if (!merged.cat && draft.cat) merged.cat = draft.cat;
        if ((merged.liters == null || merged.liters === "") && draft.liters != null) merged.liters = draft.liters;
        if (!merged.item && draft.item) merged.item = draft.item;
        if (!merged.supplier && draft.supplier) merged.supplier = draft.supplier;
        if (!merged.unit && draft.unit) merged.unit = draft.unit;
        if (!merged.work && draft.work) merged.work = draft.work;
        var base = ledgerLineFromHoldRow(entry, merged, today);
        if (want) base.vrf = want;
        var next = applyLiquidationLine(base, edits && edits[i], stamp, "bought");
        delete next.src;
        return next;
      })
      .filter(function (row) {
        return row && String(row.vrf || "").trim() && (!want || String(row.vrf) === want);
      });
  }

  /**
   * Re-read ledger rows, then keep every other VRF byte-for-byte.
   * mode "replace" swaps this VRF's rows; "append" adds lines for this VRF only.
   * Throws if a row's vrf is not the one being saved.
   */
  function mergeLedgerRows(existing, vrfNo, incoming, mode) {
    var no = String(vrfNo == null ? "" : vrfNo).trim();
    if (!no) {
      var missing = new Error("VRF number is required");
      missing.code = "vrf_mismatch";
      throw missing;
    }
    (incoming || []).forEach(function (row) {
      if (!row || String(row.vrf) !== no) {
        var err = new Error(
          "Refusing to write VRF " + (row && row.vrf) + " while saving VRF " + no
        );
        err.code = "vrf_mismatch";
        throw err;
      }
    });
    var kept = (existing || []).filter(function (row) {
      return !row || String(row.vrf) !== no;
    });
    var mine = (existing || []).filter(function (row) {
      return row && String(row.vrf) === no;
    });
    var nextMine = mode === "replace" ? incoming || [] : mine.concat(incoming || []);
    return kept.concat(nextMine);
  }

  function reservesClaimingVrf(reserves, vrfNo) {
    var no = String(vrfNo == null ? "" : vrfNo).trim();
    if (!no) return [];
    return (reserves || []).filter(function (r) {
      if (!r || String(r.status || "") === "Rejected") return false;
      return reserveOwnsVrfNo(r, no);
    });
  }

  function headerAuditNotes(before, patch, by, at) {
    var fields = [
      ["vehicle", "veh"],
      ["project", "project"],
      ["date", "date"],
      ["odometer", "odo"],
      ["requestedBy", "requestedBy"],
      ["purpose", "purpose"],
      ["job", "work"],
    ];
    var notes = [];
    fields.forEach(function (pair) {
      var from = before ? before[pair[1]] : "";
      var to = patch ? patch[pair[1]] : "";
      if (String(from == null ? "" : from) === String(to == null ? "" : to)) return;
      notes.push({
        at: at || "",
        by: by || "",
        field: pair[0],
        from: String(from == null ? "" : from),
        to: String(to == null ? "" : to),
      });
    });
    return notes;
  }

  /** Header correction. Totals, line amounts, and approval/liquidation status stay. */
  function applyVrfHeaderPatch(rows, patch, notes) {
    patch = patch || {};
    return (rows || []).map(function (row) {
      var copy = Object.assign({}, row);
      if (patch.veh != null) copy.veh = patch.veh;
      if (patch.name != null) copy.name = patch.name;
      if (patch.project != null) copy.project = patch.project;
      if (patch.date != null) copy.date = patch.date;
      if (patch.month != null) copy.month = patch.month;
      if (patch.odo !== undefined) copy.odo = patch.odo;
      if (patch.requestedBy != null) copy.requestedBy = patch.requestedBy;
      if (patch.purpose != null) copy.notes = patch.purpose;
      if (patch.work) copy.work = patch.work;
      copy.qty = row.qty;
      copy.price = row.price;
      copy.total = row.total;
      copy.vstatus = row.vstatus;
      copy.liq = row.liq;
      copy.vrf = row.vrf;
      copy.audit = (row.audit || []).concat(notes || []);
      return copy;
    });
  }

  function vrfPrintWatermark(entry) {
    if (!entry) return "FOR APPROVAL";
    var st = String(entry.status || "").trim();
    if (!st || st === "Requested" || /^for approval$/i.test(st) || /^sent for approval$/i.test(st)) {
      return "FOR APPROVAL";
    }
    var ended = spendEndStatus(st);
    if (ended === "Not bought") return "NOT BOUGHT";
    if (ended === "Duplicate") return "DUPLICATE";
    if (ended === "Cancelled") return "CANCELLED";
    if (/^rejected$/i.test(st) || /^disapproved$/i.test(st)) return "FOR APPROVAL";
    /* held / reserve-hold means "not in the ledger yet", not "still waiting".
       An approved Open hold prints APPROVED. Only a real hold stays FOR APPROVAL. */
    if (
      (entry.held || entry.src === "reserve-hold") &&
      st !== "Open" &&
      st !== "Closed" &&
      st !== "Legacy" &&
      !/^approved$/i.test(st) &&
      !/^posted$/i.test(st)
    ) {
      return "FOR APPROVAL";
    }
    return "APPROVED";
  }

  function parseOdo(v) {
    if (v == null || String(v).trim() === "") return null;
    var n = parseFloat(String(v).replace(/,/g, "").trim());
    return isFinite(n) ? n : null;
  }

  function reserveMeter(reserve) {
    if (!reserve) return null;
    var n = parseOdo(reserve.draftOdo);
    if (n == null) n = parseOdo(reserve.odoAtRequest);
    if (n == null) n = parseOdo(reserve.odo);
    return n;
  }

  function reserveOwnsVrfNo(reserve, no) {
    no = String(no == null ? "" : no).trim();
    if (!reserve || !no) return false;
    if (String(reserve.vrfNo || "").trim() === no) return true;
    return (reserve.vrfs || []).some(function (x) {
      return String(x) === no;
    });
  }

  /** Reading stored on this VRF. A reserve is used only when it owns this number. */
  function vrfMeter(entry, reserve) {
    if (!entry) return null;
    var rows = entry.rows || [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var n = parseOdo(rows[i] && rows[i].odo);
      if (n != null) return n;
    }
    var top = parseOdo(entry.odo);
    if (top != null) return top;
    if (!reserve) return null;
    var no = String(entry.vrf || "").trim();
    if (no && !reserveOwnsVrfNo(reserve, no)) return null;
    if (entry.reserve && String(reserve.no) !== String(entry.reserve) && !reserveOwnsVrfNo(reserve, no)) {
      return null;
    }
    return reserveMeter(reserve);
  }

  function canonicalVrfStatus(st, reserve, liq, vrfNo) {
    var ended = spendEndStatus(st) || spendEndStatus(liq && (liq.outcome || liq.status));
    if (ended) return { status: ended, legacy: false };
    if (liq) return { status: "Closed", legacy: false };
    var raw = String(st || "").trim();
    if (/^closed$/i.test(raw) || /^liquidated$/i.test(raw)) return { status: "Closed", legacy: false };
    if (/^rejected$/i.test(raw) || /^disapproved$/i.test(raw)) return { status: "Rejected", legacy: false };
    if (/^requested$/i.test(raw) || /^for approval$/i.test(raw) || /^sent for approval$/i.test(raw)) {
      return { status: "Requested", legacy: false };
    }
    if (
      /^open\b/i.test(raw) ||
      /^approved$/i.test(raw) ||
      /^posted$/i.test(raw) ||
      /awaiting liquidation/i.test(raw)
    ) {
      return { status: "Open", legacy: false };
    }
    if (
      (!raw || /^legacy$/i.test(raw)) &&
      reserve &&
      String(reserve.status || "") === "Approved" &&
      !reserve.liquidatedAt &&
      reserveOwnsVrfNo(reserve, vrfNo)
    ) {
      return { status: "Open", legacy: false };
    }
    return { status: "Legacy", legacy: true };
  }

  function vrfAwaitingApproval(entry, reserve) {
    if (!entry) return true;
    var st = String(entry.status || "").trim();
    if (st === "Requested" || /^for approval$/i.test(st) || /^sent for approval$/i.test(st)) return true;
    if (
      st === "Open" ||
      st === "Closed" ||
      st === "Rejected" ||
      st === "Not bought" ||
      st === "Cancelled" ||
      /^approved$/i.test(st) ||
      /^posted$/i.test(st) ||
      /awaiting liquidation/i.test(st) ||
      spendEndStatus(st)
    ) {
      return false;
    }
    var rs = reserve ? String(reserve.status || "") : "";
    if (rs === "Approved" || rs === "Closed" || rs === "Flagged") return false;
    if (rs === "Requested") return true;
    if ((entry.held || entry.src === "reserve-hold") && st !== "Legacy") return true;
    return false;
  }

  function vrfCanLiquidate(entry, reserve) {
    if (!entry || vrfAwaitingApproval(entry, reserve)) return false;
    var st = String(entry.status || "").trim();
    if (
      st === "Closed" ||
      st === "Rejected" ||
      st === "Not bought" ||
      st === "Cancelled" ||
      /^liquidated$/i.test(st) ||
      /^disapproved$/i.test(st) ||
      spendEndStatus(st)
    ) {
      return false;
    }
    if (entry.liq) return false;
    if (st === "Open" || /^approved$/i.test(st) || /^posted$/i.test(st) || /awaiting liquidation/i.test(st)) {
      return true;
    }
    return canonicalVrfStatus(st, reserve, entry.liq, entry.vrf).status === "Open";
  }

  function foldSigName(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** prepared = this slot; other = a different signatory; unmatched files still fit this slot. */
  function classifyPreparedSigFilename(filename) {
    var key = foldSigName(filename);
    if (!key) return "prepared";
    var prepared = ["prepared", "purchased", "sophie", "batas", "motor vehicle"];
    var other = ["jeffrey", "approved by", "cristine", "belocura", "checked", "released", "finance", "ceo"];
    var i;
    for (i = 0; i < prepared.length; i++) {
      if (key === prepared[i] || key.indexOf(prepared[i]) >= 0) return "prepared";
    }
    for (i = 0; i < other.length; i++) {
      if (key === other[i] || key.indexOf(other[i]) >= 0) return "other";
    }
    if (/\bcorro\b/.test(key) && key.indexOf("sophie") < 0 && key.indexOf("batas") < 0) return "other";
    return "prepared";
  }

  function photoOwnersForOpenVrf(entry, reserve, counts) {
    var owners = photoOwnersForVrf(entry).slice();
    var vrfNo = owners[0];
    var have = counts && vrfNo ? Number(counts[vrfNo] || 0) : 0;
    if (entry && vrfAwaitingApproval(entry, reserve) && reserve && !have) {
      owners = owners.concat(photoOwnersForReserve(reserve));
    }
    return owners.filter(function (x, i, a) {
      return x && a.indexOf(x) === i;
    });
  }

  function moneyNum(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var n = parseFloat(String(v).replace(/[₱,\s]/g, "").trim());
    return isFinite(n) ? n : 0;
  }

  function lineMoney(l) {
    if (!l) return 0;
    var q = moneyNum(l.qty);
    var p = moneyNum(l.price);
    if (q || p) return q * p;
    return moneyNum(l.total);
  }

  /* Same threshold the artifact uses on Send for approval. Strictly under 1000. */
  var VRF_AUTO_APPROVE_UNDER = 1000;

  function vrfSpendTotal(lines) {
    return (lines || [])
      .filter(function (l) {
        return l && l.cat && (moneyNum(l.qty) || moneyNum(l.price));
      })
      .reduce(function (a, l) {
        return a + lineMoney(l);
      }, 0);
  }

  function vrfTotalAutoApproves(total) {
    var n = moneyNum(total);
    return n > 0 && n < VRF_AUTO_APPROVE_UNDER;
  }

  function applyVrfAutoApproval(hold, total, at) {
    if (!hold || !vrfTotalAutoApproves(total)) return false;
    hold.status = "Approved";
    hold.approvedBudget = moneyNum(total);
    hold.approvedBy = "CEO policy";
    hold.approvedAt = at || "";
    hold.decisionNote = "Auto-approved — purchase total under ₱1,000";
    return true;
  }

  function vrfRequestedBy(entry, signedIn, reserves) {
    function clean(v) {
      var s = String(v == null ? "" : v).trim();
      if (!s || s === "MOTORPOOL DEPT.") return "";
      return s;
    }
    var who = clean(entry && entry.requestedBy);
    if (who) return who;
    var rows = (entry && entry.rows) || [];
    var i;
    for (i = 0; i < rows.length; i++) {
      who = clean(rows[i] && rows[i].requestedBy);
      if (who) return who;
    }
    var no = String((entry && entry.vrf) || "");
    var reserveNo = String((entry && entry.reserve) || "");
    var list = reserves || [];
    for (i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r) continue;
      var hit = false;
      if (reserveNo && String(r.no) === reserveNo) hit = true;
      if (no && String(r.vrfNo || "") === no) hit = true;
      if (
        no &&
        (r.vrfs || []).some(function (x) {
          return String(x) === no;
        })
      ) {
        hit = true;
      }
      if (hit) {
        who = clean(r.requestedBy);
        if (who) return who;
      }
    }
    return clean(signedIn);
  }

  function blankVrfDraft(now, signedIn) {
    return {
      date: now || "",
      veh: "",
      project: "",
      projectOverridden: false,
      vehicleSiteDefault: "",
      purpose: "",
      odo: "",
      work: "",
      requestedBy: String(signedIn || "").trim(),
      lines: [{}, {}, {}],
      photos: [],
      gateOverride: null,
      reserve: "",
      jo: "",
      vrfNo: "",
    };
  }

  function requestFingerprint(rec) {
    var jobs = rec && (rec.jobs || rec.works) || [];
    if (!Array.isArray(jobs)) jobs = jobs ? [jobs] : [];
    var odo = rec && rec.odo;
    if ((odo == null || odo === "") && rec) odo = rec.draftOdo != null ? rec.draftOdo : rec.odoAtRequest;
    var total = rec && rec.total != null ? rec.total : rec && rec.budget;
    return [
      String((rec && rec.veh) || "").trim(),
      String((rec && rec.date) || "").trim(),
      String(parseOdo(odo) == null ? "" : parseOdo(odo)),
      String(Math.round(moneyNum(total) * 100)),
      jobs
        .map(function (w) {
          return String(w || "").trim();
        })
        .filter(Boolean)
        .sort()
        .join("|"),
    ].join("\u0001");
  }

  function findSameOpenRequests(list, rec, exceptVrf) {
    var key = requestFingerprint(rec);
    var except = String(exceptVrf || "");
    return (list || []).filter(function (v) {
      if (!v || String(v.vrf || "") === except) return false;
      var st = String(v.status || "");
      if (st !== "Open" && st !== "Requested") return false;
      return requestFingerprint(v) === key;
    });
  }

  function earliestVrfNumber(list) {
    var best = null;
    var bestN = Infinity;
    (list || []).forEach(function (v) {
      var n = parseInt(String((v && v.vrf) || "").replace(/\D/g, ""), 10);
      if (!isFinite(n) || n >= bestN) return;
      bestN = n;
      best = v;
    });
    return best;
  }

  function reuseSubmissionHold(reserves, submissionId) {
    var id = String(submissionId || "").trim();
    if (!id) return null;
    var i;
    for (i = 0; i < (reserves || []).length; i++) {
      var r = reserves[i];
      if (!r || String(r.submissionId || "") !== id) continue;
      if (String(r.status || "") === "Rejected") continue;
      if (String(r.vrfNo || "").trim()) return r;
    }
    return null;
  }

  function normProjCode(p) {
    return String(p == null ? "" : p).trim();
  }

  function vehicleSiteCode(vehicle) {
    if (!vehicle) return "";
    return normProjCode(vehicle.site || vehicle.project || "");
  }

  function projectFieldLocked() {
    return false;
  }

  function applyVehicleProjectDefault(draft, vehicle) {
    draft = draft || {};
    var site = vehicleSiteCode(vehicle);
    var current = normProjCode(draft.project);
    var overridden = Boolean(draft.projectOverridden);
    var prevDefault = normProjCode(draft.vehicleSiteDefault);
    if (overridden && current !== prevDefault) {
      return {
        project: current,
        projectOverridden: true,
        overridden: true,
        applied: false,
        locked: false,
        vehicleSiteDefault: site,
      };
    }
    if (!site) {
      return {
        project: current,
        projectOverridden: overridden,
        overridden: overridden,
        applied: false,
        locked: false,
        vehicleSiteDefault: "",
      };
    }
    if (current === site) {
      return {
        project: site,
        projectOverridden: false,
        overridden: false,
        applied: false,
        locked: false,
        vehicleSiteDefault: site,
      };
    }
    if (!overridden || !current || current === prevDefault) {
      return {
        project: site,
        projectOverridden: false,
        overridden: false,
        applied: current !== site,
        locked: false,
        vehicleSiteDefault: site,
      };
    }
    return {
      project: current,
      projectOverridden: true,
      overridden: true,
      applied: false,
      locked: false,
      vehicleSiteDefault: site,
    };
  }

  function markProjectOverride(draft, nextProject, vehicle) {
    var site = vehicleSiteCode(vehicle);
    var next = normProjCode(nextProject);
    var overridden = next !== site;
    return {
      project: next,
      projectOverridden: overridden,
      overridden: overridden,
      locked: false,
      vehicleSiteDefault: site,
    };
  }

  function isFuelReserveSupplier(s) {
    return String(s == null ? "" : s)
      .trim()
      .toUpperCase() === "FUEL RESERVE";
  }

  function fuelSpendKind(draft) {
    draft = draft || {};
    var work = String(draft.work || "").toUpperCase();
    var lines = draft.lines || [];
    var hasFuel = false;
    var fromReserve = work === "FUEL-RES";
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i] || {};
      if (isFuel(l.cat)) hasFuel = true;
      if (isFuelReserveSupplier(l.supplier)) fromReserve = true;
    }
    if (work === "FUEL-BULK") return "fuel-bulk";
    if (fromReserve && work !== "FUEL-STN") return "fuel-issue";
    if (hasFuel || work === "FUEL-STN") return "fuel-bulk";
    return "job";
  }

  function normVrfNo(n) {
    return String(n == null ? "" : n).trim();
  }

  function isPostedVrfRow(v) {
    if (!v) return false;
    if (v.held || v.src === "reserve-hold") return false;
    return Boolean(normVrfNo(v.vrf || v));
  }

  function reserveOwnsPostedVrf(r) {
    var no = normVrfNo(r && r.vrfNo);
    if (!no) return false;
    return (r.vrfs || []).some(function (x) {
      return String(x) === no;
    });
  }

  function liveReserveStatus(status) {
    var st = String(status || "");
    return st !== "Rejected";
  }

  /** Ledger rows plus pending/approved reserve holds. Rejected numbers may be reused. */
  function usedVrfNumbers(vrfs, reserves, opts) {
    opts = opts || {};
    var used = {};
    function add(n) {
      n = normVrfNo(n);
      if (n) used[n] = 1;
    }
    (vrfs || []).forEach(function (v) {
      add(v && (v.vrf || v));
    });
    (reserves || []).forEach(function (r) {
      if (!r) return;
      if (opts.exceptReserve != null && String(r.no) === String(opts.exceptReserve)) return;
      if (!liveReserveStatus(r.status) && !opts.includeRejected) return;
      add(r.vrfNo);
      (r.vrfs || []).forEach(add);
    });
    return used;
  }

  function vrfNumberTaken(no, vrfs, reserves, opts) {
    no = normVrfNo(no);
    if (!no) return false;
    return !!usedVrfNumbers(vrfs, reserves, opts)[no];
  }

  function postedVrfNumbers(vrfs) {
    var used = {};
    (vrfs || []).forEach(function (v) {
      if (!isPostedVrfRow(v)) return;
      used[normVrfNo(v.vrf || v)] = 1;
    });
    return used;
  }

  function nextFreeVrf(from, used) {
    var n = parseInt(from, 10);
    if (!isFinite(n) || n < 1) n = 1;
    used = used || {};
    while (used[String(n)]) n += 1;
    return n;
  }

  /** Staff (and admin) raise a VRF; only office approval may post it. */
  function staffMayDirectPostVrf() {
    return false;
  }

  function canDirectPostVrf() {
    return false;
  }

  /** Posted, printed, or liquidated holds keep their number. Do not remint them. */
  function holdIsSealed(r) {
    if (!r) return false;
    var st = String(r.status || "");
    if (st === "Closed" || st === "Cancelled" || st === "Rejected") return true;
    if (r.liquidatedAt || r.printedAt) return true;
    if (reserveOwnsPostedVrf(r)) return true;
    return false;
  }

  function shouldRemintHeldVrf(r, vrfs, reserves) {
    if (!r || !normVrfNo(r.vrfNo)) return false;
    if (holdIsSealed(r)) return false;
    var no = normVrfNo(r.vrfNo);
    var posted = !!postedVrfNumbers(vrfs)[no];
    var others = (reserves || []).filter(function (o) {
      if (!o || String(o.no) === String(r.no)) return false;
      if (!liveReserveStatus(o.status)) return false;
      if (normVrfNo(o.vrfNo) === no) return true;
      return (o.vrfs || []).some(function (x) {
        return String(x) === no;
      });
    });
    if (posted) return true;
    if (!others.length) return false;
    /* Another sealed reserve keeps the number. Two unsealed holds: do not guess. */
    return others.some(function (o) {
      return holdIsSealed(o);
    });
  }

  function remintHeldVrf(r, vrfs, reserves, from) {
    if (!shouldRemintHeldVrf(r, vrfs, reserves)) return null;
    var used = usedVrfNumbers(vrfs, reserves, { exceptReserve: r.no });
    var next = nextFreeVrf(from || r.vrfNo || 1, used);
    var prev = normVrfNo(r.vrfNo);
    r.vrfNo = String(next);
    return { from: prev, to: String(next), reserve: String(r.no) };
  }

  function repairDuplicateHeldVrfs(reserves, vrfs, from) {
    var changes = [];
    var start = parseInt(from, 10);
    if (!isFinite(start) || start < 1) start = 1;
    (reserves || []).forEach(function (r) {
      var ch = remintHeldVrf(r, vrfs, reserves, start);
      if (!ch) return;
      changes.push(ch);
      var n = parseInt(ch.to, 10);
      if (isFinite(n) && n + 1 > start) start = n + 1;
    });
    return changes;
  }

  function heldReserveVrfs(reserves, existing) {
    var have = {};
    (existing || []).forEach(function (v) {
      if (v && v.vrf) have[String(v.vrf)] = 1;
    });
    var out = [];
    function add(no) {
      no = String(no || "").trim();
      if (!no || have[no]) return;
      out.push(no);
      have[no] = 1;
    }
    (reserves || []).forEach(function (r) {
      if (!r) return;
      add(r.vrfNo);
      (r.vrfs || []).forEach(add);
    });
    return out;
  }

  function vrfWhenMs(v) {
    if (!v) return 0;
    var raw = v.date || v.createdAt || v.at || "";
    var s = String(raw);
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
    var t = Date.parse(s);
    return isFinite(t) ? t : 0;
  }

  function vrfNoNum(v) {
    var n = parseInt(String((v && v.vrf) || "").replace(/\D/g, ""), 10);
    return isFinite(n) ? n : 0;
  }

  function vrfLogSortNewestFirst(list) {
    return (list || []).slice().sort(function (a, b) {
      var db = vrfWhenMs(b);
      var da = vrfWhenMs(a);
      if (db !== da) return db - da;
      return vrfNoNum(b) - vrfNoNum(a);
    });
  }

  /* Every numbered VRF stays on the log. A window around the counter plus a
     300-row cap hid posted duplicates once held forms filled the list. */
  function vrfLogVisible(list) {
    var sorted = vrfLogSortNewestFirst(list);
    var seen = {};
    var kept = [];
    sorted.forEach(function (v) {
      var k = String((v && v.vrf) || "").trim();
      if (!k || seen[k]) return;
      seen[k] = 1;
      kept.push(v);
    });
    return kept;
  }

  function vrfLogAmount(v) {
    if (!v) return 0;
    if (String(v.status || "") === "Duplicate") return 0;
    return moneyNum(v.total);
  }

  function vrfCountsTowardPostedTotal(v) {
    if (!v) return false;
    var st = String(v.status || "");
    if (st === "Duplicate" || st === "Requested") return false;
    if (vrfAwaitingApproval(v)) return false;
    return true;
  }

  function postedLogTotal(list) {
    return (list || []).reduce(function (a, v) {
      return a + (vrfCountsTowardPostedTotal(v) ? vrfLogAmount(v) : 0);
    }, 0);
  }

  function otherVrfNos(rows, vrfNo) {
    var no = String(vrfNo == null ? "" : vrfNo).trim();
    var seen = {};
    var out = [];
    (rows || []).forEach(function (row) {
      if (!row) return;
      var v = String(row.vrf || "").trim();
      if (!v || v === no || seen[v]) return;
      seen[v] = 1;
      out.push(v);
    });
    return out;
  }

  /* serverRows null means the live document did not come back. An empty list
     that is missing VRFs this device already has must not be written back —
     that is how saving VRF 5890 could replace the month and drop 5903. */
  function ledgerReplaceBase(serverRows, localRows, vrfNo) {
    var localOthers = otherVrfNos(localRows, vrfNo);
    var label = String(vrfNo || "").trim() || "this VRF";
    if (serverRows == null) {
      if (localOthers.length) {
        var missing = new Error(
          "The shared ledger did not come back. VRF " +
            label +
            " was not saved, and no other VRF was changed."
        );
        missing.code = "ledger_unreadable";
        throw missing;
      }
      return [];
    }
    if (!otherVrfNos(serverRows, vrfNo).length && localOthers.length) {
      var short = new Error(
        "The shared ledger came back without the other VRFs. VRF " +
          label +
          " was not saved, and no other VRF was changed."
      );
      short.code = "ledger_unreadable";
      throw short;
    }
    return serverRows;
  }

  function reserveNos(rows) {
    var seen = {};
    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || r.no == null || String(r.no) === "") return;
      var n = String(r.no);
      if (seen[n]) return;
      seen[n] = 1;
      out.push(n);
    });
    return out;
  }

  /* Same guard for the reserve year. Reopen saves one reserve; it must not
     publish a year file that no longer contains the other reserves. */
  function reserveReplaceBase(serverRows, localRows, incomingNos) {
    var incoming = {};
    (incomingNos || []).forEach(function (n) {
      if (n != null && String(n) !== "") incoming[String(n)] = 1;
    });
    var localKeep = reserveNos(localRows).filter(function (n) {
      return !incoming[n];
    });
    if (serverRows == null) {
      if (localKeep.length) {
        var missing = new Error(
          "The shared reserve year did not come back. Nothing was saved, so other VRFs were left as they are."
        );
        missing.code = "ledger_unreadable";
        throw missing;
      }
      return [];
    }
    var serverSet = {};
    reserveNos(serverRows).forEach(function (n) {
      serverSet[n] = 1;
    });
    var gone = localKeep.filter(function (n) {
      return !serverSet[n];
    });
    if (gone.length) {
      var short = new Error(
        "The shared reserve year came back without the other reserves. Nothing was saved, so other VRFs were left as they are."
      );
      short.code = "ledger_unreadable";
      throw short;
    }
    return serverRows;
  }

  function photoFingerprint(x) {
    if (!x) return "";
    if (x.data) {
      return (
        "img:" +
        (x.bytes || 0) +
        "|" +
        (x.w || "") +
        "x" +
        (x.h || "") +
        "|" +
        String(x.caption || "") +
        "|" +
        String(x.data).length +
        "|" +
        String(x.data).slice(-48)
      );
    }
    if (x.url) return "url:" + String(x.url);
    return String(x.id || x.vrf + "__" + (x.idx || "") + "__" + (x.at || ""));
  }

  function mergePhotoLists(lists) {
    var seen = {};
    var out = [];
    (lists || []).forEach(function (list) {
      (list || []).forEach(function (x) {
        if (!x) return;
        var id = String(x.id || x.vrf + "__" + (x.idx || "") + "__" + (x.at || ""));
        var fp = photoFingerprint(x);
        if (seen[id] || seen[fp]) return;
        seen[id] = 1;
        seen[fp] = 1;
        out.push(x);
      });
    });
    out.sort(function (a, b) {
      return (a.idx || 0) - (b.idx || 0);
    });
    return out;
  }

  function isFuelBypass(override) {
    return Boolean(
      override &&
        override.bypass &&
        String(override.reason || "").trim() &&
        String(override.by || "").trim()
    );
  }

  function bypassAttribution(override, extra) {
    extra = extra || {};
    var who = (override && override.by) || extra.by || "";
    var when = (override && override.at) || extra.at || "";
    var reason = (override && override.reason) || extra.reason || "";
    var note = (override && override.note) || extra.note || "";
    var unit = extra.unit || extra.veh || "";
    var litres = extra.litres != null ? extra.litres : extra.liters;
    var parts = ["Bypass — no office approval"];
    if (who) parts.push("by " + who);
    if (when) parts.push("on " + when);
    if (unit) parts.push("unit " + unit);
    if (litres != null && litres !== "" && isFinite(Number(litres))) {
      parts.push(Number(litres) + " L");
    }
    if (reason) parts.push(reason);
    if (note) parts.push(note);
    return parts.join(" · ");
  }

  function fuelAskApprovalBlockedByPhoto() {
    return false;
  }

  function fuelVrfGatesEnabled() {
    return false;
  }

  function fuelVrfRequiresApprovedReserve() {
    return false;
  }

  function fuelVrfRequiresBypass() {
    return false;
  }

  function reserveCreatePathAllowed() {
    return false;
  }

  function reservesAreLogOnly() {
    return true;
  }

  function fuelPostBlocked(doc) {
    if (fuelVrfGatesEnabled()) return true;
    if (fuelVrfRequiresApprovedReserve() && doc && !doc.reserve) return true;
    if (fuelVrfRequiresBypass() && doc && !isFuelBypass(doc.gateOverride)) return true;
    return false;
  }

  function missingVrfCloseFields(doc) {
    return missingList([
      { ok: Boolean(doc && doc.vrfNo), label: "VRF number (approve first)" },
      { ok: Boolean(doc && doc.lines && doc.lines.length), label: "At least one spend line" },
      {
        ok: Boolean(doc && String(doc.closedBy || doc.liquidatedBy || "").trim()),
        label: "Closed by / liquidated by",
      },
    ]);
  }

  function missingJoCloseFields(jo) {
    var ticks = (jo && jo.checklist) || [];
    var allTicked = ticks.length > 0 && ticks.every(function (c) {
      return c.done && String(c.who || "").trim() && c.when;
    });
    var proofs = (jo && jo.proofs) || [];
    return missingList([
      { ok: allTicked, label: "All checklist ticks (who + when)" },
      { ok: proofs.length >= 1, label: "At least one proof (photo or link)" },
      { ok: Boolean(jo && String(jo.resolution || "").trim()), label: "Resolution" },
      { ok: Boolean(jo && String(jo.closerName || "").trim()), label: "Closer name" },
    ]);
  }

  function missingTaskCloseFields(task) {
    var photos = (task && task.photos) || [];
    var links = (task && task.links) || [];
    return missingList([
      { ok: Boolean(task && String(task.closerName || "").trim()), label: "Closer name" },
      { ok: photos.length + links.length >= 1, label: "Photo or link" },
    ]);
  }

  function sha256hexSync(text) {
    if (typeof require === "function") {
      try {
        var nodeCrypto = require("crypto");
        return nodeCrypto.createHash("sha256").update(String(text), "utf8").digest("hex");
      } catch (e) {}
    }
    return null;
  }

  function checkOfficeHash(enteredHash, storedHash) {
    var a = String(enteredHash || "").trim().toLowerCase();
    var b = String(storedHash || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
    return a === b;
  }

  function workRefStates(settings) {
    var includeVerify = !settings || settings.joForVerificationInVrfDropdown !== false;
    var states = ["Open", "In progress"];
    if (includeVerify) states.push("For verification");
    return states;
  }

  function defaultConfig() {
    return {
      company: "Corro Const. Development and Trade Corp.",
      city: "Cebu City, Philippines",
      siteName: "corcondev-motorpool",
      timezone: "Asia/Manila",
      vrfPrefix: "VRF",
      varianceNoticePct: 10,
      fuelFloorLitres: 0,
      litresOverAvgPct: 60,
      rateBandPct: 40,
      officePassHash: "",
      driveRootFolder: "Motorpool",
      spelling: "as-on-source",
      meterReadingHardStop: false,
      yardFuelMonitoringTab: false,
      joForVerificationInVrfDropdown: true,
      openDecisions: [
        "meterReadingHardStop",
        "yardFuelMonitoringTab",
        "joForVerificationInVrfDropdown",
        "spelling",
      ],
    };
  }

  return {
    ZERO_SCORE: ZERO_SCORE,
    checkOfficeHash: checkOfficeHash,
    clone: clone,
    defaultConfig: defaultConfig,
    deepFreeze: deepFreeze,
    dropBadIntervals: dropBadIntervals,
    excludeFromPapersChase: excludeFromPapersChase,
    fillToFillRate: fillToFillRate,
    freezeRead: freezeRead,
    fuelGates: fuelGates,
    hasPaper: hasPaper,
    addCalendarYear: addCalendarYear,
    enrichLtoWorktype: enrichLtoWorktype,
    findLtoWorktype: findLtoWorktype,
    LTO_JOB_LABEL: LTO_JOB_LABEL,
    legacyLtoJobName: legacyLtoJobName,
    renameLtoJobLabel: renameLtoJobLabel,
    VRF_SIG_PRINT_H: VRF_SIG_PRINT_H,
    VRF_SIG_PRINT_W: VRF_SIG_PRINT_W,
    signatureInkBounds: signatureInkBounds,
    knockOutSignaturePixels: knockOutSignaturePixels,
    cropSignaturePixels: cropSignaturePixels,
    inferJob: inferJob,
    isEquipmentNName: isEquipmentNName,
    isFuel: isFuel,
    isLtoRenewalLine: isLtoRenewalLine,
    lineHaystack: lineHaystack,
    ltoDetailsStale: ltoDetailsStale,
    ltoProposalFromLine: ltoProposalFromLine,
    ltoWorkCode: ltoWorkCode,
    isFrozenDeep: isFrozenDeep,
    isPlantUnit: isPlantUnit,
    lineAmount: lineAmount,
    longestPhraseMatch: longestPhraseMatch,
    meterKindForUnit: meterKindForUnit,
    bypassAttribution: bypassAttribution,
    fuelAskApprovalBlockedByPhoto: fuelAskApprovalBlockedByPhoto,
    fuelPostBlocked: fuelPostBlocked,
    fuelVrfGatesEnabled: fuelVrfGatesEnabled,
    fuelVrfRequiresApprovedReserve: fuelVrfRequiresApprovedReserve,
    fuelVrfRequiresBypass: fuelVrfRequiresBypass,
    reserveCreatePathAllowed: reserveCreatePathAllowed,
    reservesAreLogOnly: reservesAreLogOnly,
    isFuelBypass: isFuelBypass,
    asProject: asProject,
    harvestProjectCodes: harvestProjectCodes,
    isProjectArchived: isProjectArchived,
    masterList: masterList,
    mergeProjectStore: mergeProjectStore,
    pickerProjectList: pickerProjectList,
    projectCodeOf: projectCodeOf,
    projectStamp: projectStamp,
    projectStatusOf: projectStatusOf,
    recordProjectLabel: recordProjectLabel,
    upsertManagedProject: upsertManagedProject,
    missingFuelApproveFields: missingFuelApproveFields,
    photoOwnersForReserve: photoOwnersForReserve,
    photoOwnersForVrf: photoOwnersForVrf,
    photoOwnersForOpenVrf: photoOwnersForOpenVrf,
    spendEndStatus: spendEndStatus,
    reserveSpendClosed: reserveSpendClosed,
    heldLineAmount: heldLineAmount,
    heldVrfStatus: heldVrfStatus,
    liquidationOutcome: liquidationOutcome,
    vrfStatusForOutcome: vrfStatusForOutcome,
    lineWasNotPurchased: lineWasNotPurchased,
    applyLiquidationLine: applyLiquidationLine,
    auditMoney: auditMoney,
    reopenAuditNote: reopenAuditNote,
    reopenClosedLedgerRow: reopenClosedLedgerRow,
    reserveNeedsReopen: reserveNeedsReopen,
    applyReserveReopen: applyReserveReopen,
    recloseAmountAudit: recloseAmountAudit,
    liquidationNewTotal: liquidationNewTotal,
    approvedVrfMayJoinLedger: approvedVrfMayJoinLedger,
    planLiquidationLedgerWrite: planLiquidationLedgerWrite,
    ledgerLineFromHoldRow: ledgerLineFromHoldRow,
    closedLedgerLinesFromHold: closedLedgerLinesFromHold,
    matchDraftLine: matchDraftLine,
    mergeLedgerRows: mergeLedgerRows,
    reservesClaimingVrf: reservesClaimingVrf,
    headerAuditNotes: headerAuditNotes,
    applyVrfHeaderPatch: applyVrfHeaderPatch,
    holdIsSealed: holdIsSealed,
    vrfPrintWatermark: vrfPrintWatermark,
    parseOdo: parseOdo,
    reserveMeter: reserveMeter,
    reserveOwnsVrfNo: reserveOwnsVrfNo,
    vrfMeter: vrfMeter,
    canonicalVrfStatus: canonicalVrfStatus,
    vrfAwaitingApproval: vrfAwaitingApproval,
    vrfCanLiquidate: vrfCanLiquidate,
    classifyPreparedSigFilename: classifyPreparedSigFilename,
    moneyNum: moneyNum,
    lineMoney: lineMoney,
    VRF_AUTO_APPROVE_UNDER: VRF_AUTO_APPROVE_UNDER,
    vrfSpendTotal: vrfSpendTotal,
    vrfTotalAutoApproves: vrfTotalAutoApproves,
    applyVrfAutoApproval: applyVrfAutoApproval,
    vrfRequestedBy: vrfRequestedBy,
    blankVrfDraft: blankVrfDraft,
    applyVehicleProjectDefault: applyVehicleProjectDefault,
    markProjectOverride: markProjectOverride,
    projectFieldLocked: projectFieldLocked,
    fuelSpendKind: fuelSpendKind,
    isFuelReserveSupplier: isFuelReserveSupplier,
    usedVrfNumbers: usedVrfNumbers,
    vrfNumberTaken: vrfNumberTaken,
    postedVrfNumbers: postedVrfNumbers,
    isPostedVrfRow: isPostedVrfRow,
    staffMayDirectPostVrf: staffMayDirectPostVrf,
    canDirectPostVrf: canDirectPostVrf,
    shouldRemintHeldVrf: shouldRemintHeldVrf,
    remintHeldVrf: remintHeldVrf,
    repairDuplicateHeldVrfs: repairDuplicateHeldVrfs,
    nextFreeVrf: nextFreeVrf,
    requestFingerprint: requestFingerprint,
    findSameOpenRequests: findSameOpenRequests,
    earliestVrfNumber: earliestVrfNumber,
    reuseSubmissionHold: reuseSubmissionHold,
    heldReserveVrfs: heldReserveVrfs,
    vrfLogVisible: vrfLogVisible,
    vrfLogSortNewestFirst: vrfLogSortNewestFirst,
    vrfLogAmount: vrfLogAmount,
    vrfCountsTowardPostedTotal: vrfCountsTowardPostedTotal,
    postedLogTotal: postedLogTotal,
    ledgerReplaceBase: ledgerReplaceBase,
    reserveReplaceBase: reserveReplaceBase,
    mergePhotoLists: mergePhotoLists,
    missingJoCloseFields: missingJoCloseFields,
    missingList: missingList,
    missingPapers: missingPapers,
    missingReserveFields: missingReserveFields,
    missingTaskCloseFields: missingTaskCloseFields,
    missingVrfCloseFields: missingVrfCloseFields,
    papersNeeded: papersNeeded,
    papersToChase: papersToChase,
    sha256hexSync: sha256hexSync,
    sumLines: sumLines,
    thaw: thaw,
    typicalBand: typicalBand,
    varianceFlag: varianceFlag,
    varianceNotice: varianceNotice,
    vrfIndexStale: vrfIndexStale,
    vrfSearchHits: vrfSearchHits,
    workRefStates: workRefStates,
  };
});
