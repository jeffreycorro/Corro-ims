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
  var LTO_RENEW_RE =
    /lto\s*(registration\s*)?renew|registration\s*renew|lto\s*processing|lto\s*reg(?:istration)?\b/i;

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
      if (/lto/.test(blob) && /renew|regist/.test(blob)) score += 3;
      if (/registration renew/.test(name)) score += 2;
      if (name === "lto registration renewal") score += 2;
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
    return missingList([
      { ok: doc.gauge != null && String(doc.gauge) !== "", label: "Gauge level" },
    ]);
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
    isFuelBypass: isFuelBypass,
    missingFuelApproveFields: missingFuelApproveFields,
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
