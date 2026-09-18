/**
 * Drive-first import of signed leave and cash-advance scans.
 * Loaded by claude-shim.js. Does not rewrite the artifact.
 *
 * The Leave / Cash Advance buttons used to open a paste box. Jeffrey does not
 * paste spreadsheets — the scans already sit in Drive. This companion searches
 * those files, keeps the LRF/CAF printed on the paper, skips numbers already
 * on file, and leaves paste behind "Paste rows instead".
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.hrFormDriveImport = api;
  if (typeof window !== "undefined" && window) window.hrFormDriveImport = api;
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

  var LEAVE = "leave";
  var CA = "ca";
  var FOLDER_HINT = {
    leave: /leave\s*files?/i,
    ca: /cash\s*advance\s*files?/i,
  };
  var TITLE_KIND = {
    leave: /\bLRF\b|leave\s*request|\bleave\b/i,
    ca: /\bCAF\b|cash\s*advance/i,
  };
  var SKIP_NAME = /template|blank|\bform\s*$|sample/i;
  var IMG_OR_PDF = /^(image\/(jpeg|jpg|png|gif|webp|heic|heif)|application\/pdf)$/i;
  var ISO_DATE = /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/;
  var LONG_DATE =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/i;
  var SLASH_DATE = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-]((?:19|20)\d{2})\b/;
  var MONTHS = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

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

  function digits(v) {
    return str(v).replace(/\D/g, "");
  }

  function foldName(s) {
    return str(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function cleanTitle(title) {
    return str(title)
      .replace(/\.[A-Za-z0-9]{1,5}$/, "")
      .replace(/_/g, " ")
      .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
      .replace(/\s+copy\s*\d*\s*$/i, "")
      .replace(/\s+\d{12,}\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function kindPhrases(kind) {
    if (kind === CA) {
      return ["CAF", "CASH ADVANCE", "Cash Advance", "Cash Advance Files", "Cash Advance File"];
    }
    return ["LRF", "LEAVE", "Leave Request", "Leave Files", "Leave File"];
  }

  function folderPhrases(kind) {
    return kind === CA ? ["Cash Advance Files", "Cash Advance File"] : ["Leave Files", "Leave File"];
  }

  function isKindTitle(title, kind) {
    var t = cleanTitle(title);
    if (!t) return false;
    return TITLE_KIND[kind === CA ? CA : LEAVE].test(t);
  }

  function isFolderName(title, kind) {
    return FOLDER_HINT[kind === CA ? CA : LEAVE].test(cleanTitle(title));
  }

  function parseFormNo(no, kind) {
    var raw = str(no).trim();
    if (!raw) return null;
    var want = kind === CA ? ["CAF", "CA"] : ["LRF", "LV"];
    var shown = kind === CA ? "CAF" : "LRF";
    var spaced = raw.toUpperCase().match(/\b(LRF|LV|CAF|CA)\s*-?\s*((?:19|20)\d{2})\s*[-–]\s*(\d{1,6})\b/);
    if (spaced && want.indexOf(spaced[1]) >= 0) {
      var yearS = +spaced[2];
      var seqS = parseInt(spaced[3], 10);
      if (yearS && seqS) {
        return {
          prefix: shown,
          year: yearS,
          seq: seqS,
          no: shown + yearS + "-" + String(seqS).padStart(4, "0"),
        };
      }
    }
    var compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    var rx = /(LRF|LV|CAF|CA)((?:19|20)\d{2})(\d{1,6})/;
    var m = rx.exec(compact);
    if (m && want.indexOf(m[1]) >= 0) {
      var year = +m[2];
      var seq = parseInt(m[3], 10);
      if (!year || !seq) return null;
      return {
        prefix: shown,
        year: year,
        seq: seq,
        no: shown + year + "-" + String(seq).padStart(4, "0"),
      };
    }
    var whole = compact.match(/^((?:19|20)\d{2})(\d{1,6})$/);
    if (whole && !/[A-Z]/.test(raw)) {
      return null;
    }
    return null;
  }

  function formNoKey(no, kind) {
    var p = parseFormNo(no, kind);
    if (p) return p.prefix + "|" + p.year + "|" + p.seq;
    var n = str(no).toUpperCase().replace(/\s+/g, "");
    return n || "";
  }

  function sameFormNo(a, b, kind) {
    var ka = formNoKey(a, kind);
    var kb = formNoKey(b, kind);
    return !!ka && ka === kb;
  }

  function guessKindFromTitle(title) {
    var t = cleanTitle(title);
    if (TITLE_KIND.ca.test(t) && !/\bLRF\b|\bleave\s*request\b/i.test(t)) return CA;
    if (TITLE_KIND.leave.test(t)) return LEAVE;
    return "";
  }

  function parseFormScanTitle(title, kind) {
    var raw = cleanTitle(title);
    if (!raw) return null;
    var guessed = guessKindFromTitle(raw);
    var want = kind === CA ? CA : kind === LEAVE ? LEAVE : guessed;
    if (!want) return null;
    if (kind && guessed && guessed !== want) return null;
    if (SKIP_NAME.test(raw) && !/\b(?:LRF|CAF)\b/i.test(raw) && !/\b1[0-9]{3}\b/.test(raw)) {
      return null;
    }
    var form = parseFormNo(raw, want);
    var lead = raw.match(/^\s*(\d{3,5})\s*[-_ ,]/);
    var tail = raw.match(/[-_ ](\d{3,5})\s*$/);
    var mid = raw.match(/(?:^|[^0-9])(1[0-9]{3})(?:[^0-9]|$)/);
    var empNo = lead ? lead[1] : tail ? tail[1] : mid ? mid[1] : "";
    var NAME = /^[A-Z][A-Za-zÀ-ɏ.'-]+(\s+[A-Z][A-Za-zÀ-ɏ.'-]+){1,3}$/;
    var who = "";
    var parts = raw.split(",").map(function (x) {
      return x.trim();
    }).filter(Boolean);
    if (parts.length >= 2) {
      var last = parts[parts.length - 1];
      if (NAME.test(last) && !/\d/.test(last)) who = last;
    }
    if (!who) {
      var rest = raw
        .replace(/\b(?:LRF|CAF|LV|CA)\s*-?\s*(?:19|20)\d{2}\s*[-–]\s*\d{1,6}\b/gi, " ")
        .replace(/\b(?:LEAVE|CASH\s*ADVANCE|LEAVE\s*REQUEST|SIGNED|SCAN)\b/gi, " ")
        .replace(/^\s*\d{3,5}\s*[-_ ,]+/, " ")
        .replace(/[-_ ]\d{3,5}\s*$/, " ")
        .replace(/[_]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
        .replace(/^[-–,\s]+|[-–,\s]+$/g, "");
      if (NAME.test(rest) && !/\d/.test(rest)) who = rest;
    }
    var date = "";
    var long = raw.match(LONG_DATE);
    if (long) {
      var mo = MONTHS.indexOf(long[1].toLowerCase()) + 1;
      var d = +long[2];
      if (mo >= 1 && d >= 1 && d <= 31) {
        date = long[3] + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      }
    }
    if (!form && !empNo) return null;
    return {
      kind: want,
      empNo: empNo,
      who: who,
      no: form ? form.no : "",
      date: date,
      from: want === LEAVE ? date : "",
      to: want === LEAVE ? date : "",
      amount: "",
      reason: "",
      purpose: "",
      type: "",
      title: raw,
    };
  }

  function parseIsoOrLong(chunk) {
    var iso = str(chunk).match(ISO_DATE);
    if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
    var long = str(chunk).match(LONG_DATE);
    if (long) {
      var mo = MONTHS.indexOf(long[1].toLowerCase()) + 1;
      var d = +long[2];
      if (mo >= 1 && d >= 1 && d <= 31) {
        return long[3] + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      }
    }
    var slash = str(chunk).match(SLASH_DATE);
    if (slash) {
      var a = +slash[1];
      var b = +slash[2];
      var y = slash[3];
      var month = a > 12 ? b : a;
      var day = a > 12 ? a : b;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return y + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      }
    }
    return "";
  }

  function parseMoney(chunk) {
    var m = str(chunk).replace(/,/g, "").match(/(?:₱|php|p(?:eso)?s?\s*)?\s*(\d{3,7}(?:\.\d{1,2})?)/i);
    if (!m) return "";
    var n = parseFloat(m[1]);
    return n > 0 ? n : "";
  }

  function scanLeaveType(t, types) {
    var x = str(t).trim().toLowerCase();
    if (!x) return "";
    var list = types || [];
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (str(list[i].k).toLowerCase() === x) return list[i].k;
    }
    for (i = 0; i < list.length; i += 1) {
      var n = str(list[i].n).toLowerCase();
      if (n && (x.indexOf(n) >= 0 || n.indexOf(x) >= 0)) return list[i].k;
    }
    if (/sick/.test(x)) return "SL";
    if (/vacation/.test(x)) return "VL";
    if (/emergen/.test(x)) return "EL";
    if (/service incentive|\bsil\b/.test(x)) return "SIL";
    if (/without pay|lwop/.test(x)) return "LWOP";
    if (/bereav/.test(x)) return "BEREV";
    if (/matern/.test(x)) return "ML";
    if (/patern/.test(x)) return "PL";
    return "";
  }

  function parseFormScanText(text, kind, types) {
    var raw = str(text)
      .replace(/CamScanner|https:\/\/v3\.camscanner\.com\S*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    var out = {
      kind: kind === CA ? CA : LEAVE,
      no: "",
      empNo: "",
      who: "",
      type: "",
      from: "",
      to: "",
      date: "",
      amount: "",
      reason: "",
      purpose: "",
      particulars: "",
      project: "",
      status: "",
    };
    if (!raw) return out;
    var form = parseFormNo(raw, out.kind);
    if (form) out.no = form.no;
    var emp = raw.match(
      /(?:employee(?:\s*(?:no|number|#))?|emp(?:loyee)?\s*no\.?)\s*[:#]?\s*(\d{3,5})/i
    );
    if (emp) out.empNo = emp[1];
    if (!out.empNo) {
      var any = raw.match(/(?:^|[^0-9])(1[0-9]{3})(?:[^0-9]|$)/);
      if (any) out.empNo = any[1];
    }
    if (out.kind === LEAVE) {
      var typeHit = raw.match(
        /(?:type of leave|leave type|kind of leave)\s*[:#]?\s*([A-Za-z][A-Za-z /-]{1,40})/i
      );
      out.type = scanLeaveType(typeHit ? typeHit[1] : raw, types);
      var fromHit = raw.match(/(?:from|inclusive dates?|date of leave)\s*[:#]?\s*([^.]{4,40})/i);
      var toHit = raw.match(/(?:to|until|upto|up to)\s*[:#]?\s*([^.]{4,40})/i);
      out.from = parseIsoOrLong(fromHit ? fromHit[1] : "") || parseIsoOrLong(raw);
      out.to = parseIsoOrLong(toHit ? toHit[1] : "") || out.from;
      var reasonHit = raw.match(/(?:reason(?:\s*for\s*leave)?|purpose)\s*[:#]?\s*([^.]{2,80})/i);
      if (reasonHit) out.reason = reasonHit[1].trim();
    } else {
      out.date = parseIsoOrLong(raw);
      var amtHit = raw.match(/(?:amount|sum\s*of|php|pesos?)\s*[:#]?\s*([₱P]?\s*[\d,]{3,12}(?:\.\d{1,2})?)/i);
      out.amount = parseMoney(amtHit ? amtHit[1] : raw);
      var purposeHit = raw.match(/(?:purpose|particulars)\s*[:#]?\s*([^.]{2,80})/i);
      if (purposeHit) {
        out.purpose = purposeHit[1].trim();
        out.particulars = purposeHit[1].trim();
      }
      var projHit = raw.match(/(?:project|charge\s*to)\s*[:#]?\s*([^.]{2,60})/i);
      if (projHit) out.project = projHit[1].trim();
    }
    if (/disapprov|denied|reject/i.test(raw)) out.status = "Disapproved";
    else if (out.kind === CA && /releas/i.test(raw)) out.status = "Released";
    else if (/approv/i.test(raw)) out.status = "Approved";
    return out;
  }

  function mergeScanFields(base, extra) {
    var out = Object.assign({}, base || {});
    var extraObj = extra || {};
    ["no", "empNo", "who", "type", "from", "to", "date", "reason", "purpose", "particulars", "project", "status"].forEach(
      function (k) {
        if (!str(out[k]) && str(extraObj[k])) out[k] = extraObj[k];
      }
    );
    if (!(Number(out.amount) > 0) && Number(extraObj.amount) > 0) out.amount = extraObj.amount;
    return out;
  }

  function formNoOnFile(S, kind, no) {
    if (!str(no).trim()) return null;
    var coll = kind === CA ? "advances" : "leaves";
    var hit = null;
    values(S && S[coll]).forEach(function (r) {
      if (r && r.no && sameFormNo(r.no, no, kind)) hit = r;
    });
    return hit;
  }

  function fileAlreadyLinked(S, kind, url) {
    var link = str(url).trim();
    if (!link) return null;
    var coll = kind === CA ? "advances" : "leaves";
    var hit = null;
    values(S && S[coll]).forEach(function (r) {
      if (!r) return;
      if (r.signedLink === link || r.driveLink === link || r.link === link) hit = r;
    });
    return hit;
  }

  function matchEmployee(S, empNo, who, host) {
    var list = values(S && S.employees);
    var no = digits(empNo);
    var i;
    if (no) {
      for (i = 0; i < list.length; i += 1) {
        var e = list[i];
        var have = host && typeof host.normNo === "function" ? host.normNo(e.empNo) : digits(e.empNo);
        if (have && have === no) return e;
      }
    }
    var name = str(who).trim();
    if (!name) return null;
    if (host && typeof host.empMatch === "function") {
      var hits = list.filter(function (e) {
        return host.empMatch(e, name.toLowerCase());
      });
      if (hits.length === 1) return hits[0];
    }
    var folded = foldName(name);
    if (!folded) return null;
    var named = list.filter(function (e) {
      return foldName(e.name).indexOf(folded) >= 0 || foldName(e.name).indexOf(foldName(name.split(/\s+/).reverse().join(" "))) >= 0;
    });
    return named.length === 1 ? named[0] : null;
  }

  function buildLeaveRecord(emp, fields, file, host) {
    var f = fields || {};
    var no = str(f.no).trim();
    if (no && parseFormNo(no, LEAVE)) no = parseFormNo(no, LEAVE).no;
    var from = str(f.from || f.date || "");
    var to = str(f.to || from);
    var type = str(f.type || "VL") || "VL";
    var daysFn = host && typeof host.leaveDays === "function" ? host.leaveDays : function () {
      return 0;
    };
    var today = (host && host.TODAY) || "";
    return {
      id: host && host.uid ? host.uid("lv") : "lv" + Date.now().toString(36),
      no: no,
      empId: emp.id,
      type: type,
      from: from,
      to: to,
      half: f.half === true,
      days: Number(f.days) || daysFn(from, to, f.half === true),
      reason: str(f.reason || ""),
      status: str(f.status || "Approved") || "Approved",
      filedOn: str(f.filedOn || from || today),
      approvedBy: str(f.approvedBy || ""),
      approvedOn: str(f.approvedOn || f.filedOn || ""),
      covering: "",
      notes: "Imported from Drive",
      signedLink: (file && (file.viewUrl || file.link)) || "",
      signedTitle: (file && (file.title || file.fileTitle)) || "",
      signedOn: today,
    };
  }

  function buildAdvanceRecord(emp, fields, file, host) {
    var f = fields || {};
    var no = str(f.no).trim();
    if (no && parseFormNo(no, CA)) no = parseFormNo(no, CA).no;
    var date = str(f.date || "");
    var today = (host && host.TODAY) || "";
    var amount = Number(String(f.amount == null ? "" : f.amount).replace(/[^0-9.\-]/g, "")) || 0;
    return {
      id: host && host.uid ? host.uid("ca") : "ca" + Date.now().toString(36),
      no: no,
      date: date || today,
      empId: emp.id,
      requestedBy: "",
      receivedBy: emp.name || "",
      purpose: str(f.purpose || "Cash Advance") || "Cash Advance",
      particulars: str(f.particulars || f.reason || ""),
      project: str(f.project || emp.project || ""),
      amount: amount,
      chargeTo: "Project cost",
      mode: "Cash",
      releasedBy: "",
      releasedOn: str(f.releasedOn || date || ""),
      pcNo: "",
      status: str(f.status || "Released") || "Released",
      liquidations: [],
      deducted: 0,
      deductPerPeriod: 0,
      notes: "Imported from Drive",
      signedLink: (file && (file.viewUrl || file.link)) || "",
      signedTitle: (file && (file.title || file.fileTitle)) || "",
      signedOn: today,
    };
  }

  function rowReady(row) {
    return !!(row && row.emp && str(row.no).trim() && !row.already);
  }

  function classifyRow(S, kind, file, parsed, host) {
    var fields = Object.assign({}, parsed || {});
    var emp = matchEmployee(S, fields.empNo, fields.who, host);
    var already = formNoOnFile(S, kind, fields.no) || fileAlreadyLinked(S, kind, file && (file.viewUrl || file.link));
    return {
      file: file,
      fields: fields,
      emp: emp,
      no: fields.no || "",
      already: already || null,
      fromFolder: !!(file && file.fromFolder),
    };
  }

  function payloadFiles(host, r) {
    if (host && typeof host.payloadFiles === "function") return host.payloadFiles(r) || [];
    var p = r && r.payload;
    if (typeof p === "string") {
      try {
        p = JSON.parse(p);
      } catch (e) {
        p = {};
      }
    }
    p = p || {};
    return p.files || p.items || [];
  }

  function payloadText(host, r) {
    if (host && typeof host.payloadText === "function") return str(host.payloadText(r));
    var p = r && r.payload;
    if (typeof p === "string") return p;
    p = p || {};
    return str(p.fileContent || p.content || p.text || "");
  }

  function nextToken(host, r) {
    var p = host && typeof host.mcpPayload === "function" ? host.mcpPayload(r) : (r && r.payload) || {};
    if (typeof p === "string") {
      try {
        p = JSON.parse(p);
      } catch (e) {
        p = {};
      }
    }
    return (p && (p.nextPageToken || p.next_page_token)) || "";
  }

  function folderMime(host) {
    return (host && host.FOLDER_MIME) || "application/vnd.google-apps.folder";
  }

  function driveServer(host) {
    return (host && host.DRIVE_SERVER) || "Google Drive";
  }

  function isReadableFile(f, host) {
    if (!f || !f.id) return false;
    if (f.mimeType === folderMime(host)) return false;
    return true;
  }

  function looksLikeScan(f) {
    var mime = str(f && f.mimeType);
    if (!mime) return true;
    if (IMG_OR_PDF.test(mime)) return true;
    if (/google-apps\.(document|spreadsheet)/i.test(mime)) return false;
    return /pdf|image|octet-stream|msword|officedocument/i.test(mime);
  }

  async function searchPages(host, mcp, query, onPage) {
    var token = "";
    var page = 0;
    do {
      var req = { query: query, pageSize: 100, excludeContentSnippets: true };
      if (token) req.pageToken = token;
      var r = await mcp.callTool(driveServer(host), "search_files", req);
      var files = payloadFiles(host, r);
      if (typeof onPage === "function") onPage(files);
      token = nextToken(host, r);
    } while (token && ++page < 8);
  }

  function acceptScan(kind, file, fromFolder) {
    if (!file || !file.id) return false;
    if (!looksLikeScan(file)) return false;
    var title = file.title || "";
    if (isFolderName(title, kind)) return false;
    if (fromFolder) {
      if (SKIP_NAME.test(cleanTitle(title)) && !parseFormNo(title, kind) && !/\d{3,5}/.test(title)) {
        return false;
      }
      return true;
    }
    return !!parseFormScanTitle(title, kind);
  }

  async function searchFormScanFiles(kind, host, mcp, onProgress) {
    var seen = {};
    var folders = {};
    var files = [];
    var phrases = kindPhrases(kind);
    var i;
    function addFile(f, fromFolder) {
      if (!isReadableFile(f, host) || !acceptScan(kind, f, fromFolder)) return;
      if (seen[f.id]) {
        if (fromFolder) seen[f.id].fromFolder = true;
        return;
      }
      var row = {
        id: f.id,
        title: f.title || "",
        mimeType: f.mimeType || "",
        viewUrl: f.viewUrl || (f.id ? "https://drive.google.com/file/d/" + f.id + "/view" : ""),
        modifiedTime: f.modifiedTime || "",
        fromFolder: !!fromFolder,
      };
      seen[f.id] = row;
      files.push(row);
    }
    function addFolder(f) {
      if (!f || !f.id || f.mimeType !== folderMime(host)) return;
      if (!isFolderName(f.title || "", kind)) return;
      folders[f.id] = f;
    }
    for (i = 0; i < phrases.length; i += 1) {
      if (onProgress) onProgress("Looking for “" + phrases[i] + "”…", Math.round(6 + (i / phrases.length) * 50));
      await searchPages(
        host,
        mcp,
        "title contains '" + String(phrases[i]).replace(/'/g, "\\'") + "'",
        function (list) {
          (list || []).forEach(function (f) {
            addFolder(f);
            addFile(f, false);
          });
        }
      );
    }
    var folderIds = Object.keys(folders);
    for (i = 0; i < folderIds.length; i += 1) {
      if (onProgress) {
        onProgress(
          "Opening " + (folders[folderIds[i]].title || "the form folder") + "…",
          Math.round(58 + (i / Math.max(1, folderIds.length)) * 30)
        );
      }
      await searchPages(host, mcp, "parentId = '" + folderIds[i] + "'", function (list) {
        (list || []).forEach(function (f) {
          addFolder(f);
          addFile(f, true);
        });
      });
    }
    return { files: files, folders: folderIds.length };
  }

  function rowsFromFiles(S, kind, files, host) {
    return (files || []).map(function (f) {
      var parsed = parseFormScanTitle(f.title, kind) || {
        kind: kind,
        empNo: "",
        who: "",
        no: "",
        date: "",
        from: "",
        to: "",
        amount: "",
        reason: "",
        purpose: "",
        type: "",
        title: cleanTitle(f.title),
      };
      return classifyRow(S, kind, f, parsed, host);
    });
  }

  function hostOf(host) {
    return host || (typeof window !== "undefined" ? window : null);
  }

  function esc(host, s) {
    if (host && typeof host.esc === "function") return host.esc(s);
    return str(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function flip(host, name) {
    if (host && typeof host.flipName === "function") return host.flipName(name);
    var p = str(name).split(",");
    return p.length > 1 ? p[1].trim() + " " + p[0].trim() : str(name);
  }

  function $(host, sel) {
    if (host && typeof host.$ === "function") return host.$(sel);
    var doc = host && host.document;
    return doc && doc.querySelector ? doc.querySelector(sel) : null;
  }

  function $$(host, sel) {
    if (host && typeof host.$$ === "function") return host.$$(sel);
    var doc = host && host.document;
    return doc && doc.querySelectorAll ? Array.prototype.slice.call(doc.querySelectorAll(sel)) : [];
  }

  function peso(host, n) {
    if (host && typeof host.peso === "function") return host.peso(n);
    var x = Number(n);
    if (!x) return "";
    return "₱" + x.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function leaveTypeName(host, k) {
    if (host && typeof host.leaveType === "function") {
      var t = host.leaveType(k);
      return (t && t.n) || k || "";
    }
    return k || "";
  }

  function ensureStyles(doc) {
    if (!doc || !doc.createElement || (doc.getElementById && doc.getElementById("hr-form-drive-styles"))) {
      return;
    }
    var style = doc.createElement("style");
    style.id = "hr-form-drive-styles";
    style.textContent =
      ".hr-fd-row.already{opacity:.62}" +
      ".hr-fd-miss{color:var(--warn,#9a6b1a);font-size:12px}" +
      ".hr-fd-ok{color:var(--ok,#2f7d55)}" +
      ".hr-fd-paste{margin-top:10px}" +
      ".hr-fd-paste summary{cursor:pointer;color:var(--ink2,#5b5e5e);font-size:12.5px}";
    (doc.head || doc.documentElement).appendChild(style);
  }

  function describeRow(host, kind, row) {
    var bits = [];
    if (row.emp) bits.push(flip(host, row.emp.name) + (row.emp.empNo ? " · " + row.emp.empNo : ""));
    else if (row.fields.empNo || row.fields.who) {
      bits.push("Not on file: " + (row.fields.who || ("employee " + row.fields.empNo)));
    } else bits.push("Employee not read from the file name");
    if (row.no) bits.push(row.no);
    else bits.push("Form number not on the file name");
    if (kind === LEAVE) {
      if (row.fields.type) bits.push(leaveTypeName(host, row.fields.type));
      if (row.fields.from) {
        bits.push(row.fields.from + (row.fields.to && row.fields.to !== row.fields.from ? " to " + row.fields.to : ""));
      }
      if (row.fields.reason) bits.push(row.fields.reason);
    } else {
      if (Number(row.fields.amount) > 0) bits.push(peso(host, row.fields.amount));
      if (row.fields.date) bits.push(row.fields.date);
      if (row.fields.purpose || row.fields.particulars || row.fields.reason) {
        bits.push(row.fields.purpose || row.fields.particulars || row.fields.reason);
      }
    }
    return bits.join(" · ");
  }

  function renderChecklist(host, kind, rows) {
    var isLeave = kind !== CA;
    var ready = rows.filter(rowReady).length;
    var already = rows.filter(function (r) {
      return !!r.already;
    }).length;
    var h =
      '<div class="stack">' +
      '<div class="note">These are the signed forms found in Drive. Tick the ones to add. ' +
      "A number already printed on the paper is kept. Forms already on the register stay off.</div>" +
      '<div class="note"><b>' +
      rows.length +
      "</b> file" +
      (rows.length === 1 ? "" : "s") +
      " · <b>" +
      ready +
      "</b> new and ready · <b>" +
      already +
      "</b> already on file</div>" +
      '<div class="tw" style="max-height:52vh;overflow:auto"><table><thead><tr>' +
      '<th style="width:34px"></th><th style="width:210px">File</th><th>What was read</th>' +
      "<th style=\"width:150px\">" +
      (isLeave ? "Dates / reason" : "Amount / date") +
      "</th></tr></thead><tbody>";
    rows.forEach(function (row, i) {
      var readyRow = rowReady(row);
      var needNo = !str(row.no);
      var needEmp = !row.emp;
      h +=
        '<tr class="' +
        (row.already ? "hr-fd-row already" : "") +
        '"><td><input type="checkbox" data-fd-i="' +
        i +
        '"' +
        (readyRow ? " checked" : " disabled") +
        "></td>" +
        '<td><a href="' +
        esc(host, row.file.viewUrl || "#") +
        '" target="_blank" rel="noopener noreferrer">' +
        esc(host, row.file.title || "scan") +
        "</a></td>" +
        "<td>" +
        (row.emp
          ? "<b>" + esc(host, flip(host, row.emp.name)) + "</b>" + (row.emp.empNo ? ' <span class="mono">' + esc(host, row.emp.empNo) + "</span>" : "")
          : "") +
        (needEmp
          ? '<div class="f" style="margin:4px 0 0"><label>Employee number on the paper</label>' +
            '<input data-fd-emp="' +
            i +
            '" inputmode="numeric" placeholder="e.g. 1241"></div>'
          : "") +
        (row.no
          ? '<div class="mono">' + esc(host, row.no) + "</div>"
          : '<div class="f" style="margin:4px 0 0"><label>Form number on the paper</label>' +
            '<input data-fd-no="' +
            i +
            '" placeholder="' +
            (isLeave ? "LRF2026-0123" : "CAF2026-0042") +
            '"></div>') +
        (row.already
          ? '<div class="hr-fd-miss">Already on file' +
            (row.already.no ? " as " + esc(host, row.already.no) : "") +
            "</div>"
          : readyRow
            ? '<div class="hr-fd-ok">New</div>'
            : "") +
        "</td><td>" +
        esc(host, describeRow(host, kind, row).split(" · ").slice(2).join(" · ") || "—") +
        "</td></tr>";
    });
    h +=
      "</tbody></table></div>" +
      '<details class="hr-fd-paste" id="ir-paste-box"><summary id="ir-paste">Paste rows instead</summary>' +
      '<div class="note" style="margin-top:8px">Only if the forms are already in a list. ' +
      "Each line is one form. Start with the paper form number, then the employee number.</div></details></div>";
    return h;
  }

  function bindRowEdits(host, kind, rows) {
    function refreshBox(i) {
      var row = rows[i];
      if (!row) return;
      var noEl = $$(host, '[data-fd-no="' + i + '"]')[0];
      var empEl = $$(host, '[data-fd-emp="' + i + '"]')[0];
      if (noEl) {
        var parsed = parseFormNo(noEl.value, kind);
        row.no = parsed ? parsed.no : str(noEl.value).trim();
        row.fields.no = row.no;
        row.already = formNoOnFile(host.S, kind, row.no);
      }
      if (empEl) {
        row.fields.empNo = str(empEl.value).trim();
        row.emp = matchEmployee(host.S, row.fields.empNo, row.fields.who, host);
      }
      var cb = $$(host, '[data-fd-i="' + i + '"]')[0];
      if (cb) {
        var ok = rowReady(row);
        cb.disabled = !ok;
        cb.checked = ok;
      }
    }
    $$(host, "[data-fd-no], [data-fd-emp]").forEach(function (el) {
      el.oninput = function () {
        refreshBox(el.getAttribute("data-fd-no") || el.getAttribute("data-fd-emp"));
      };
      el.onchange = el.oninput;
    });
  }

  async function enrichRow(host, mcp, kind, row) {
    if (!row || !row.file || !row.file.id) return row;
    if (row.no && row.emp && ((kind === LEAVE && row.fields.from && row.fields.reason) || (kind === CA && Number(row.fields.amount) > 0))) {
      return row;
    }
    var txt = "";
    try {
      var rr = await mcp.callTool(driveServer(host), "read_file_content", { fileId: row.file.id });
      txt = payloadText(host, rr);
    } catch (e) {
      txt = "";
    }
    if (str(txt).replace(/\s+/g, "").length < 12) return row;
    var parsed = parseFormScanText(txt, kind, host.LEAVE_TYPES);
    row.fields = mergeScanFields(row.fields, parsed);
    if (!row.no && row.fields.no) row.no = row.fields.no;
    if (!row.emp) row.emp = matchEmployee(host.S, row.fields.empNo, row.fields.who, host);
    if (row.no) row.already = formNoOnFile(host.S, kind, row.no) || row.already;
    return row;
  }

  async function writeRow(host, kind, row) {
    if (!rowReady(row)) return { made: false, skipped: true, why: "incomplete" };
    if (formNoOnFile(host.S, kind, row.no) || fileAlreadyLinked(host.S, kind, row.file && row.file.viewUrl)) {
      return { made: false, skipped: true, why: "duplicate" };
    }
    var isLeave = kind !== CA;
    var rec = isLeave
      ? buildLeaveRecord(row.emp, Object.assign({}, row.fields, { no: row.no }), row.file, host)
      : buildAdvanceRecord(row.emp, Object.assign({}, row.fields, { no: row.no }), row.file, host);
    if (!str(rec.no)) return { made: false, skipped: true, why: "no-number" };
    var coll = isLeave ? "leaves" : "advances";
    await host.put(coll, rec.id, rec);
    var haveReg = values(host.S && host.S.docreg).some(function (x) {
      return x && x.no && sameFormNo(x.no, rec.no, kind);
    });
    if (!haveReg) {
      var pp = parseFormNo(rec.no, kind);
      var entry = {
        id: host.uid ? host.uid("d") : "d" + Date.now().toString(36),
        no: rec.no,
        seriesKey: isLeave ? "LV" : "CA",
        year: pp ? pp.year : new Date().getFullYear(),
        seq: pp ? pp.seq : 0,
        title: isLeave ? "Leave Request Form" : "Cash Advance Request Form",
        tags: ["imported", "from Drive"],
        empId: row.emp.id,
        date: rec.filedOn || rec.date || host.TODAY || "",
        status: "Issued",
        module: isLeave ? "leave" : "ca",
        refId: rec.id,
        link: rec.signedLink || "",
        notes: "Imported from Drive — number kept from the form",
        issuedBy: "",
      };
      await host.put("docreg", entry.id, entry);
    }
    var key = isLeave ? "leaveform" : "ca";
    var e2 = host.clone ? host.clone(host.S.employees[row.emp.id]) : Object.assign({}, host.S.employees[row.emp.id]);
    if (e2) {
      e2.docs = e2.docs || (host.blankDocs ? host.blankDocs() : {});
      e2.docs[key] = e2.docs[key] || { s: "miss", link: "", links: [], filed: "", expiry: "" };
      if (host.docAddLink && rec.signedLink) host.docAddLink(e2.docs[key], rec.signedLink, rec.signedTitle || "", host.TODAY);
      if (e2.docs[key].s !== "exp") e2.docs[key].s = "on";
      if (!e2.docs[key].filed) e2.docs[key].filed = host.TODAY || "";
      await host.put("employees", e2.id, e2);
    }
    return { made: true, skipped: false, rec: rec };
  }

  async function importPicked(host, mcp, kind, rows, picked) {
    var made = 0;
    var skipped = 0;
    var i;
    for (i = 0; i < picked.length; i += 1) {
      var row = picked[i];
      await enrichRow(host, mcp, kind, row);
      if (row.no) row.already = formNoOnFile(host.S, kind, row.no) || row.already;
      if (!row.emp) row.emp = matchEmployee(host.S, row.fields.empNo, row.fields.who, host);
      var out = await writeRow(host, kind, row);
      if (out.made) made += 1;
      else skipped += 1;
    }
    return { made: made, skipped: skipped };
  }

  function selectedRows(host, rows, onlyReadyNew) {
    var out = [];
    $$(host, "[data-fd-i]").forEach(function (cb) {
      var i = +cb.getAttribute("data-fd-i");
      var row = rows[i];
      if (!row) return;
      if (onlyReadyNew) {
        if (rowReady(row)) out.push(row);
        return;
      }
      if (cb.checked) out.push(row);
    });
    return out;
  }

  function showChecklist(host, kind, rows, mcp) {
    var isLeave = kind !== CA;
    ensureStyles(host.document);
    host.openModal({
      title: isLeave ? "Import leave forms from Drive" : "Import cash advances from Drive",
      wide: true,
      body: renderChecklist(host, kind, rows),
      foot:
        '<button class="btn" id="fd-cancel">Close</button>' +
        '<button class="btn" id="fd-all">Import all new</button>' +
        '<button class="btn pri" id="fd-go">Import selected</button>',
    });
    bindRowEdits(host, kind, rows);
    var paste = $(host, "#ir-paste");
    if (paste) {
      paste.onclick = function (ev) {
        if (ev) ev.preventDefault();
        if (typeof host.importRecordsPaste === "function") host.importRecordsPaste(kind);
      };
    }
    var cancel = $(host, "#fd-cancel");
    if (cancel) cancel.onclick = host.closeModal;
    async function go(onlyNew) {
      var picked = selectedRows(host, rows, onlyNew);
      if (!picked.length) {
        host.toast("Tick at least one new form, or type the missing employee / form number.", "err");
        return;
      }
      var btn = $(host, onlyNew ? "#fd-all" : "#fd-go");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Importing…";
      }
      try {
        var out = await importPicked(host, mcp, kind, rows, picked);
        host.closeModal();
        host.toast(
          out.made +
            " imported" +
            (out.skipped ? ", " + out.skipped + " skipped (already on file or still missing a number / employee)" : ""),
          out.made ? "ok" : undefined
        );
        if (host.render) host.render();
      } catch (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = onlyNew ? "Import all new" : "Import selected";
        }
        var msg = host.driveMessage ? host.driveMessage(err) : "";
        host.toast(msg || str(err && err.message) || "The import did not finish.", "err");
      }
    }
    var all = $(host, "#fd-all");
    if (all) all.onclick = function () {
      go(true);
    };
    var goBtn = $(host, "#fd-go");
    if (goBtn) goBtn.onclick = function () {
      go(false);
    };
  }

  async function open(kind, host) {
    host = hostOf(host);
    if (!host) return;
    kind = kind === CA || kind === "advances" ? CA : LEAVE;
    if (typeof host.getMcp !== "function") {
      if (typeof host.importRecordsPaste === "function") return host.importRecordsPaste(kind);
      return;
    }
    var mcp;
    try {
      mcp = await host.getMcp();
    } catch (e) {
      mcp = null;
    }
    if (!mcp) {
      host.toast(host.driveMessage ? host.driveMessage({ code: "not_granted" }) : "Google Drive is not available.", "err");
      return;
    }
    var stop = false;
    host.openModal({
      title: kind === LEAVE ? "Looking for leave forms in Drive" : "Looking for cash advance forms in Drive",
      wide: true,
      body:
        '<div class="stack"><div class="lbl" id="fd-msg">Starting…</div>' +
        '<div id="fd-bar">' +
        (host.meterBar ? host.meterBar(4) : "") +
        "</div></div>",
      foot: '<button class="btn" id="fd-stop">Stop</button>',
    });
    var stopBtn = $(host, "#fd-stop");
    if (stopBtn) stopBtn.onclick = function () {
      stop = true;
    };
    var say = function (t, pct) {
      var a = $(host, "#fd-msg");
      if (a) a.textContent = t;
      var b = $(host, "#fd-bar");
      if (b && pct != null && host.meterBar) b.innerHTML = host.meterBar(pct);
    };
    try {
      var found = await searchFormScanFiles(kind, host, mcp, function (t, pct) {
        if (!stop) say(t, pct);
      });
      if (stop) {
        host.closeModal();
        return;
      }
      say("Matching to people on file…", 94);
      var rows = rowsFromFiles(host.S, kind, found.files, host);
      rows.sort(function (a, b) {
        var ar = rowReady(a) ? 0 : a.already ? 2 : 1;
        var br = rowReady(b) ? 0 : b.already ? 2 : 1;
        if (ar !== br) return ar - br;
        return str(b.file && b.file.modifiedTime).localeCompare(str(a.file && a.file.modifiedTime));
      });
      if (!rows.length) {
        host.closeModal();
        host.toast(
          kind === LEAVE
            ? "No leave forms were found. The portal looks for file names with LRF or LEAVE, and for a folder called Leave Files."
            : "No cash advance forms were found. The portal looks for file names with CAF or CASH ADVANCE, and for a folder called Cash Advance Files.",
          "err"
        );
        return;
      }
      showChecklist(host, kind, rows, mcp);
    } catch (err) {
      host.closeModal();
      host.toast(host.driveMessage ? host.driveMessage(err) : str(err && err.message) || "Drive could not be read.", "err");
    }
  }

  function wrapImportRecords(host) {
    if (!host || typeof host.importRecords !== "function" || host.importRecords._hrFormDrive) return false;
    if (typeof host.importRecordsPaste !== "function") {
      host.importRecordsPaste = host.importRecords;
    }
    host.importRecords = function (kind) {
      return open(kind, host);
    };
    host.importRecords._hrFormDrive = true;
    return true;
  }

  function attach(host) {
    host = hostOf(host);
    if (!host) return api;
    wrapImportRecords(host);
    api.attached = true;
    return api;
  }

  var api = {
    attached: false,
    attach: attach,
    install: attach,
    open: open,
    kindPhrases: kindPhrases,
    folderPhrases: folderPhrases,
    isKindTitle: isKindTitle,
    isFolderName: isFolderName,
    parseFormNo: parseFormNo,
    formNoKey: formNoKey,
    sameFormNo: sameFormNo,
    parseFormScanTitle: parseFormScanTitle,
    parseFormScanText: parseFormScanText,
    mergeScanFields: mergeScanFields,
    formNoOnFile: formNoOnFile,
    fileAlreadyLinked: fileAlreadyLinked,
    matchEmployee: matchEmployee,
    buildLeaveRecord: buildLeaveRecord,
    buildAdvanceRecord: buildAdvanceRecord,
    classifyRow: classifyRow,
    rowsFromFiles: rowsFromFiles,
    rowReady: rowReady,
    writeRow: writeRow,
    searchFormScanFiles: searchFormScanFiles,
  };
  return api;
});
