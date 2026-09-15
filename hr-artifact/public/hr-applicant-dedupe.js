/**
 * Applicant name keys, duplicate groups, and merge rules.
 * Loaded by claude-shim.js (browser) and required by applicants-ingest (Node).
 * Does not rewrite the artifact.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.hrApplicantDedupe = api;
  if (typeof window !== "undefined" && window) window.hrApplicantDedupe = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STAGES = [
    "Applied",
    "Screening",
    "Written Exam",
    "Interview",
    "Final Interview",
    "Offer",
    "Rejected",
    "Hired",
  ];

  var STAGE_RANK = {
    Applied: 1,
    Screening: 2,
    "Written Exam": 3,
    Interview: 4,
    "Final Interview": 5,
    Offer: 6,
    Rejected: 7,
    Hired: 8,
  };

  var PREFER_NONEMPTY = [
    "email",
    "mobile",
    "resumeLink",
    "roleId",
    "position",
    "dept",
    "education",
    "years",
    "expected",
    "source",
    "aiSummary",
    "aiVerdict",
    "hrVerdict",
    "hrNotes",
    "hrBy",
    "rffiNote",
    "hiredEmpId",
    "empNo",
  ];

  var ARRAY_FIELDS = ["exams", "interviews", "history", "background", "linkedDocs", "staffNotes"];

  var SUFFIX_RE = /^(jr|sr|ii|iii|iv|junior|senior)$/;

  var RECRUITMENT_DOCS = [
    { k: "resume", n: "Resume / Biodata" },
    { k: "tor", n: "TOR" },
    { k: "certs", n: "Certificates" },
    { k: "datasheet", n: "Employee Data Sheet" },
    { k: "sketch", n: "Residential Sketch" },
    { k: "iqtest", n: "IQ Test" },
    { k: "initint", n: "Initial Interview" },
    { k: "recoletter", n: "Recommendation Letter for Final Interview" },
    { k: "endorse", n: "Endorsement Letter to Head of Department" },
  ];

  function asString(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
  }

  function foldMarks(value) {
    return asString(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function tokensOf(value) {
    return foldMarks(value)
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(function (w) {
        return w && w.length > 1 && !SUFFIX_RE.test(w);
      });
  }

  /**
   * One person, however the name was typed.
   * Drops case, punctuation, diacritics, middle initials, Jr/Sr.
   * "Last, First" and "First Last" collapse to the same sorted token key,
   * so "Dela Cerna, Yvette Lea Mae D." matches "Yvette Lea Mae Dela Cerna".
   */
  function nameKey(name) {
    var raw = asString(name);
    if (!raw) return "";
    var folded = foldMarks(raw);
    var left;
    var right;
    var comma = folded.indexOf(",");
    var parts;
    if (comma >= 0) {
      left = tokensOf(folded.slice(0, comma));
      right = tokensOf(folded.slice(comma + 1));
      parts = left.concat(right);
    } else {
      parts = tokensOf(folded);
    }
    if (!parts.length) return "";
    var seen = Object.create(null);
    var unique = [];
    parts.forEach(function (w) {
      if (seen[w]) return;
      seen[w] = true;
      unique.push(w);
    });
    unique.sort();
    return unique.join("|");
  }

  function emailKey(email) {
    var s = asString(email).toLowerCase();
    if (!s || s.indexOf("@") < 1) return "";
    return s;
  }

  function stageRank(stage) {
    var n = STAGE_RANK[asString(stage)];
    return n || 0;
  }

  function furthestStage(stages) {
    var best = "Applied";
    var bestRank = 0;
    (stages || []).forEach(function (st) {
      var r = stageRank(st);
      if (r > bestRank) {
        bestRank = r;
        best = asString(st) || best;
      }
    });
    return best;
  }

  function rolesCompatible(roleIds) {
    var nonempty = [];
    var seen = Object.create(null);
    (roleIds || []).forEach(function (id) {
      var v = asString(id);
      if (!v || seen[v]) return;
      seen[v] = true;
      nonempty.push(v);
    });
    return nonempty.length <= 1;
  }

  function emailsCompatible(emails) {
    var nonempty = [];
    var seen = Object.create(null);
    (emails || []).forEach(function (em) {
      var v = emailKey(em);
      if (!v || seen[v]) return;
      seen[v] = true;
      nonempty.push(v);
    });
    return nonempty.length <= 1;
  }

  function nameKeysEqual(names) {
    var keys = [];
    var seen = Object.create(null);
    (names || []).forEach(function (n) {
      var k = nameKey(n);
      if (!k || seen[k]) return;
      seen[k] = true;
      keys.push(k);
    });
    return keys.length <= 1 && keys.length > 0;
  }

  function classifyGroup(applicants) {
    var names = applicants.map(function (a) {
      return a && a.name;
    });
    var emails = applicants.map(function (a) {
      return a && a.email;
    });
    var roles = applicants.map(function (a) {
      return a && a.roleId;
    });
    var sameName = nameKeysEqual(names);
    var roleOk = rolesCompatible(roles);
    var emailOk = emailsCompatible(emails);
    var nonemptyRoles = roles.filter(function (r) {
      return asString(r);
    });
    var sameRole = nonemptyRoles.length > 0 && roleOk;

    if (sameName && roleOk && emailOk) {
      var someBlank = (roles || []).some(function (r) {
        return !asString(r);
      });
      return {
        autoSafe: true,
        reason: sameRole && !someBlank ? "same-name-same-role" : "same-name-blank-role",
      };
    }
    if (sameName && !roleOk) {
      return { autoSafe: false, reason: "conflicting-roles" };
    }
    if (sameName && !emailOk) {
      return { autoSafe: false, reason: "conflicting-emails" };
    }
    var emailCount = 0;
    (emails || []).forEach(function (em) {
      if (emailKey(em)) emailCount += 1;
    });
    if (!sameName && emailOk && emailCount >= 2) {
      return { autoSafe: false, reason: "same-email-different-names" };
    }
    return { autoSafe: false, reason: "similar-names" };
  }

  function parentOf(parents, id) {
    if (parents[id] !== id) parents[id] = parentOf(parents, parents[id]);
    return parents[id];
  }

  function union(parents, a, b) {
    var pa = parentOf(parents, a);
    var pb = parentOf(parents, b);
    if (pa !== pb) parents[pb] = pa;
  }

  function groupApplicants(list) {
    var rows = (list || []).filter(function (a) {
      return a && (a.id || a.name);
    });
    var parents = Object.create(null);
    rows.forEach(function (a, i) {
      var id = asString(a.id) || ("idx:" + i);
      a.__dedupeId = id;
      parents[id] = id;
    });

    var byName = Object.create(null);
    var byEmail = Object.create(null);
    rows.forEach(function (a) {
      var id = a.__dedupeId;
      var nk = nameKey(a.name);
      var ek = emailKey(a.email);
      if (nk) {
        if (byName[nk]) union(parents, byName[nk], id);
        else byName[nk] = id;
      }
      if (ek) {
        if (byEmail[ek]) union(parents, byEmail[ek], id);
        else byEmail[ek] = id;
      }
    });

    /* "Barrios, Luisa G." vs "Barrios, Luisa Mae G." — extra middle
       names only. Confirm, never auto-safe. Distinct given names
       (John Mark vs John Louie) do not subset each other. */
    var nameKeys = Object.keys(byName);
    nameKeys.forEach(function (aKey) {
      nameKeys.forEach(function (bKey) {
        if (aKey >= bKey) return;
        var aTok = aKey.split("|");
        var bTok = bKey.split("|");
        var small = aTok.length < bTok.length ? aTok : bTok;
        var large = aTok.length < bTok.length ? bTok : aTok;
        if (small.length < 2 || small.length === large.length) return;
        var subset = small.every(function (t) {
          return large.indexOf(t) >= 0;
        });
        if (subset) union(parents, byName[aKey], byName[bKey]);
      });
    });

    var buckets = Object.create(null);
    rows.forEach(function (a) {
      var rootId = parentOf(parents, a.__dedupeId);
      (buckets[rootId] = buckets[rootId] || []).push(a);
    });

    var groups = [];
    Object.keys(buckets).forEach(function (rootId) {
      var recs = buckets[rootId];
      if (recs.length < 2) return;
      recs.sort(function (a, b) {
        return asString(a.appliedOn).localeCompare(asString(b.appliedOn)) ||
          asString(a.id).localeCompare(asString(b.id));
      });
      var cls = classifyGroup(recs);
      groups.push({
        key: rootId,
        nameKey: nameKey(recs[0].name),
        name: recs[0].name,
        applicants: recs,
        autoSafe: cls.autoSafe,
        reason: cls.reason,
      });
    });

    groups.sort(function (a, b) {
      return b.applicants.length - a.applicants.length ||
        asString(a.name).localeCompare(asString(b.name));
    });
    return groups;
  }

  function pickKeeper(applicants) {
    return applicants.slice().sort(function (a, b) {
      var hired = asString(b.hiredEmpId) ? 1 : 0;
      var hiredA = asString(a.hiredEmpId) ? 1 : 0;
      if (hired !== hiredA) return hired - hiredA;
      var st = stageRank(b.stage) - stageRank(a.stage);
      if (st) return st;
      var filled = function (row) {
        return PREFER_NONEMPTY.reduce(function (n, k) {
          return n + (asString(row[k]) ? 1 : 0);
        }, 0);
      };
      var fill = filled(b) - filled(a);
      if (fill) return fill;
      return asString(a.appliedOn).localeCompare(asString(b.appliedOn)) ||
        asString(a.id).localeCompare(asString(b.id));
    })[0];
  }

  function earliestDate(dates) {
    var ok = (dates || [])
      .map(asString)
      .filter(function (d) {
        return /^\d{4}-\d{2}-\d{2}$/.test(d);
      })
      .sort();
    return ok.length ? ok[0] : "";
  }

  function uniqueDates(dates) {
    var seen = Object.create(null);
    var out = [];
    (dates || []).forEach(function (d) {
      var v = asString(d);
      if (!v || seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    out.sort();
    return out;
  }

  function mergeNotes(parts) {
    var seen = Object.create(null);
    var out = [];
    (parts || []).forEach(function (p) {
      var v = asString(p);
      if (!v) return;
      var k = v.replace(/\s+/g, " ").trim();
      if (seen[k]) return;
      seen[k] = true;
      out.push(v);
    });
    return out.join("\n\n");
  }

  function mergeArrays(lists) {
    var out = [];
    var seen = Object.create(null);
    (lists || []).forEach(function (list) {
      (list || []).forEach(function (item) {
        var key;
        try {
          key = JSON.stringify(item);
        } catch (e) {
          key = String(item);
        }
        if (seen[key]) return;
        seen[key] = true;
        out.push(item);
      });
    });
    return out;
  }

  function mergeDocs(docsList) {
    var out = {};
    (docsList || []).forEach(function (docs) {
      if (!docs || typeof docs !== "object") return;
      Object.keys(docs).forEach(function (k) {
        var src = docs[k] || {};
        var cur = out[k] || { s: "miss", link: "", links: [], filed: "", expiry: "" };
        var links = [];
        var seen = Object.create(null);
        function pushLink(url, title) {
          url = asString(url);
          if (!url || seen[url]) return;
          seen[url] = true;
          links.push({ url: url, title: asString(title), on: asString(src.filed) });
        }
        pushLink(cur.link, cur.title);
        (cur.links || []).forEach(function (x) {
          if (typeof x === "string") pushLink(x, "");
          else if (x) pushLink(x.url, x.title);
        });
        pushLink(src.link, src.title);
        (src.links || []).forEach(function (x) {
          if (typeof x === "string") pushLink(x, "");
          else if (x) pushLink(x.url, x.title);
        });
        var rank = { miss: 0, na: 1, exp: 2, on: 3 };
        var s = rank[src.s] > rank[cur.s] ? src.s : cur.s;
        if (links.length && s === "miss") s = "on";
        out[k] = {
          s: s || "miss",
          link: links[0] ? links[0].url : "",
          title: links[0] ? links[0].title : "",
          links: links,
          filed: asString(cur.filed) || asString(src.filed),
          expiry: asString(cur.expiry) || asString(src.expiry),
        };
      });
    });
    return out;
  }

  function cloneRow(row) {
    try {
      return JSON.parse(JSON.stringify(row || {}));
    } catch (e) {
      return Object.assign({}, row || {});
    }
  }

  function mergeApplicantRecords(applicants, opts) {
    opts = opts || {};
    var today = asString(opts.today) || "";
    var rows = (applicants || []).filter(Boolean);
    if (!rows.length) return null;
    var keeperSrc = opts.keeperId
      ? rows.find(function (a) {
          return asString(a.id) === asString(opts.keeperId);
        }) || pickKeeper(rows)
      : pickKeeper(rows);
    var extras = rows.filter(function (a) {
      return a !== keeperSrc && asString(a.id) !== asString(keeperSrc.id);
    });
    var merged = cloneRow(keeperSrc);
    extras.forEach(function (x) {
      PREFER_NONEMPTY.forEach(function (k) {
        if (!asString(merged[k]) && asString(x[k])) merged[k] = x[k];
      });
    });
    merged.stage = furthestStage(
      rows.map(function (a) {
        return a.stage;
      })
    );
    var dates = uniqueDates(
      rows
        .map(function (a) {
          return a.appliedOn;
        })
        .concat(
          rows.flatMap(function (a) {
            return a.appliedDates || [];
          })
        )
    );
    merged.appliedOn = earliestDate(dates) || asString(keeperSrc.appliedOn);
    merged.appliedDates = dates;
    ARRAY_FIELDS.forEach(function (k) {
      merged[k] = mergeArrays(
        rows.map(function (a) {
          return a[k];
        })
      );
    });
    merged.docs = mergeDocs(
      rows.map(function (a) {
        return a.docs;
      })
    );
    var extraIds = extras
      .map(function (a) {
        return asString(a.id);
      })
      .filter(Boolean);
    var noteLine =
      dates.length > 1
        ? "Re-applications on " + dates.join(", ") + "."
        : dates.length
          ? "Application date " + dates[0] + "."
          : "";
    if (extraIds.length) {
      noteLine +=
        (noteLine ? " " : "") +
        "Merged duplicate record" +
        (extraIds.length === 1 ? "" : "s") +
        " " +
        extraIds.join(", ") +
        (today ? " on " + today : "") +
        ".";
    }
    merged.notes = mergeNotes(
      rows
        .map(function (a) {
          return a.notes;
        })
        .concat(noteLine ? [noteLine] : [])
    );
    merged.history = (merged.history || []).concat([
      {
        on: today,
        what: "Merged duplicate applications",
        dates: dates,
        fromIds: extraIds,
      },
    ]);
    return {
      keeper: merged,
      extras: extras,
      extraIds: extraIds,
      dates: dates,
    };
  }

  /**
   * Soft-dedupe for ingest. Same email wins; else same name with compatible
   * emails. Conflicting emails on the same name are treated as different people
   * (ingest has no confirm step). Prefer an Applied row, then earliest appliedOn.
   */
  function findIngestMatch(incoming, existing, opts) {
    opts = opts || {};
    if (opts.forceNew === true) return null;
    var wantName = nameKey(incoming && incoming.name);
    var wantEmail = emailKey(incoming && incoming.email);
    if (!wantName && !wantEmail) return null;
    var hits = (existing || []).filter(function (row) {
      if (!row) return false;
      var haveName = nameKey(row.name);
      var haveEmail = emailKey(row.email);
      if (wantEmail && haveEmail && wantEmail === haveEmail) return true;
      if (wantName && haveName && wantName === haveName) {
        if (!wantEmail || !haveEmail || wantEmail === haveEmail) return true;
      }
      return false;
    });
    if (!hits.length) return null;
    hits.sort(function (a, b) {
      var aApplied = asString(a.stage) === "Applied" ? 0 : 1;
      var bApplied = asString(b.stage) === "Applied" ? 0 : 1;
      if (aApplied !== bApplied) return aApplied - bApplied;
      return asString(a.appliedOn).localeCompare(asString(b.appliedOn)) ||
        asString(a.id).localeCompare(asString(b.id));
    });
    return hits[0];
  }

  function incomingAsApplicant(norm) {
    var fields = (norm && norm.fields) || {};
    var files = ingestFileFields(norm && norm.item ? norm.item : fields);
    return {
      id: "",
      name: (norm && norm.name) || "",
      stage: (norm && norm.stage) || "Applied",
      source: (norm && norm.source) || "",
      appliedOn: (norm && norm.appliedOn) || "",
      email: fields.email || "",
      mobile: fields.mobile || "",
      roleId: fields.roleId || "",
      position: fields.position || "",
      dept: fields.dept || "",
      resumeLink: files.resumeLink || fields.resumeLink || "",
      notes: fields.notes || "",
      expected: fields.expected || "",
      education: fields.education || "",
      years: fields.years || "",
      docs: files.docs || {},
      exams: [],
      interviews: [],
      history: [],
      background: [],
      linkedDocs: files.linkedDocs || [],
      staffNotes: [],
    };
  }

  function applyIngestOnto(existing, norm, opts) {
    opts = opts || {};
    var incoming = incomingAsApplicant(norm);
    incoming.id = "";
    var existingCopy = cloneRow(existing);
    var result = mergeApplicantRecords([existingCopy, incoming], {
      today: opts.today,
      keeperId: existingCopy.id,
    });
    var merged = result.keeper;
    merged.id = existing.id;
    merged.name = asString(norm && norm.name) || merged.name;
    if (asString(norm && norm.source)) merged.source = norm.source;
    if (asString(incoming.roleId)) merged.roleId = incoming.roleId;
    if (asString(incoming.position)) merged.position = incoming.position;
    if (asString(incoming.dept)) merged.dept = incoming.dept;
    var dates = result.dates || [];
    var hist = (existing.history || []).slice();
    hist.push({
      on: asString(opts.today),
      what: "Re-ingested application",
      dates: dates,
    });
    merged.history = hist;
    var reapp =
      dates.length > 1
        ? "Re-applied " + dates[dates.length - 1] + " (earlier: " + dates.slice(0, -1).join(", ") + ")."
        : "";
    if (reapp && (merged.notes || "").indexOf(reapp) < 0) {
      merged.notes = mergeNotes([existing.notes, incoming.notes, reapp]);
    }
    return merged;
  }

  function recruitmentDocs(DOCS) {
    if (Array.isArray(DOCS) && DOCS.length) {
      return DOCS.filter(function (d) {
        return d && d.g === "Recruitment";
      }).map(function (d) {
        return { k: d.k, n: d.n, code: d.code || "", opt: !!d.opt, cond: !!d.cond };
      });
    }
    return RECRUITMENT_DOCS.slice();
  }

  function blankDocRow() {
    return { s: "miss", link: "", links: [], filed: "", expiry: "", title: "" };
  }

  var DRIVE_FILE_RE =
    /(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/)([A-Za-z0-9_-]+)/i;
  var DRIVE_FOLDER_RE = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/i;
  var DRIVE_ID_RE = /^[A-Za-z0-9_-]{20,}$/;

  function driveFileUrl(id) {
    var key = asString(id);
    if (!key) return "";
    return "https://drive.google.com/file/d/" + key + "/view";
  }

  function parseDriveRef(value) {
    var s = asString(value);
    if (!s) return null;
    var m = s.match(DRIVE_FOLDER_RE);
    if (m) {
      return {
        kind: "folder",
        id: m[1],
        url: "https://drive.google.com/drive/folders/" + m[1],
      };
    }
    m = s.match(DRIVE_FILE_RE);
    if (m) return { kind: "file", id: m[1], url: driveFileUrl(m[1]) };
    if (DRIVE_ID_RE.test(s) && !/^https?:\/\//i.test(s)) {
      return { kind: "file", id: s, url: driveFileUrl(s) };
    }
    if (/^https?:\/\//i.test(s)) return { kind: "url", id: "", url: s };
    return null;
  }

  function normalizeFileRef(raw, fallbackTitle) {
    if (raw == null || raw === "") return null;
    if (typeof raw === "string" || typeof raw === "number") {
      var parsed = parseDriveRef(raw);
      if (!parsed) return null;
      return {
        url: parsed.url,
        title: asString(fallbackTitle) || (parsed.kind === "folder" ? "Application folder" : "Application file"),
        note: "",
        kind: parsed.kind,
        id: parsed.id,
        docKey: "",
      };
    }
    if (typeof raw !== "object") return null;
    var url = asString(raw.url || raw.link || raw.href || raw.webViewLink || raw.viewUrl);
    var id = asString(raw.id || raw.fileId || raw.driveFileId || raw.driveId);
    if (!url && id) {
      var fromId = parseDriveRef(id);
      if (fromId) {
        url = fromId.url;
        id = fromId.id;
      }
    }
    if (!url) return null;
    var parsedUrl = parseDriveRef(url) || { kind: "url", id: id, url: url };
    return {
      url: parsedUrl.url || url,
      title: asString(raw.title || raw.name || raw.filename || fallbackTitle) || "Application file",
      note: asString(raw.note || raw.source),
      kind: parsedUrl.kind || "url",
      id: parsedUrl.id || id,
      docKey: asString(raw.docKey || raw.k || raw.kind),
    };
  }

  function lastNameToken(name) {
    var raw = asString(name);
    if (!raw) return "";
    var comma = raw.indexOf(",");
    if (comma >= 0) return tokensOf(raw.slice(0, comma))[0] || "";
    var parts = tokensOf(raw);
    return parts.length ? parts[parts.length - 1] : "";
  }

  function fileMatchesApplicant(title, name) {
    var nameTokens = tokensOf(name);
    if (!nameTokens.length) return false;
    var hay = foldMarks(title).replace(/[_./-]+/g, " ");
    var hits = nameTokens.filter(function (tok) {
      return hay.indexOf(tok) >= 0;
    });
    if (nameTokens.length === 1) return hits.length === 1 && nameTokens[0].length >= 5;
    return hits.length >= 2;
  }

  function guessApplicantDocKey(title) {
    var t = foldMarks(title).replace(/[_./-]+/g, " ");
    if (/transcript|\btor\b/.test(t)) return "tor";
    if (/data\s*sheet|\bpds\b/.test(t)) return "datasheet";
    if (/residential\s*sketch|sketch\s*of/.test(t)) return "sketch";
    if (/iq\s*test|aptitude/.test(t)) return "iqtest";
    if (/initial\s*interview/.test(t)) return "initint";
    if (/recommend|rffi/.test(t)) return "recoletter";
    if (/endorsement/.test(t)) return "endorse";
    if (/diploma|certificate of|\bcoc\b|\bnc\s*ii\b/.test(t)) return "certs";
    return "resume";
  }

  function collectApplicationFiles(applicant) {
    var a = applicant || {};
    var out = [];
    var seen = Object.create(null);
    function push(raw, fallbackTitle, note) {
      var n = normalizeFileRef(raw, fallbackTitle);
      if (!n || !n.url || seen[n.url]) return;
      seen[n.url] = true;
      if (note && !n.note) n.note = note;
      out.push(n);
    }
    push(a.resumeLink, "CV / application", "resumeLink");
    push(a.cvLink, "CV / application", "cvLink");
    push(a.cv, "CV / application", "cv");
    push(a.applicationLink, "Application file", "applicationLink");
    push(a.driveUrl, "Drive file", "driveUrl");
    push(a.fileUrl, "Application file", "fileUrl");
    push(a.driveFileId || a.fileId || a.resumeFileId || a.driveId, "CV / application", "driveFileId");
    ;["attachments", "files", "linkedDocs"].forEach(function (key) {
      var list = a[key];
      if (!Array.isArray(list)) return;
      list.forEach(function (x) {
        push(x, key === "linkedDocs" ? "Linked file" : "Attachment", key);
      });
    });
    var docs = a.docs && typeof a.docs === "object" ? a.docs : {};
    Object.keys(docs).forEach(function (k) {
      var v = docs[k] || {};
      push(v.link, v.title || k, k);
      (v.links || []).forEach(function (x) {
        push(x, (x && x.title) || k, k);
      });
    });
    return out;
  }

  function addLinkToDocRow(row, file, filedOn) {
    var cur = row || blankDocRow();
    var url = asString(file && file.url);
    if (!url) return cur;
    var links = [];
    var seen = Object.create(null);
    function pushLink(u, title) {
      u = asString(u);
      if (!u || seen[u]) return;
      seen[u] = true;
      links.push({ url: u, title: asString(title), on: asString(filedOn) });
    }
    pushLink(cur.link, cur.title);
    (cur.links || []).forEach(function (x) {
      if (typeof x === "string") pushLink(x, "");
      else if (x) pushLink(x.url, x.title);
    });
    pushLink(url, file.title);
    if (links.length && cur.s === "miss") cur.s = "on";
    cur.link = links[0] ? links[0].url : "";
    cur.title = links[0] ? links[0].title : cur.title;
    cur.links = links;
    cur.filed = asString(cur.filed) || asString(filedOn);
    return cur;
  }

  function ingestFileFields(item) {
    var src = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    var files = collectApplicationFiles(src);
    var resume = "";
    var linked = [];
    files.forEach(function (f) {
      if (!resume && f.url && f.kind !== "folder") resume = f.url;
      linked.push({
        title: f.title,
        url: f.url,
        note: f.note || "ingest",
        added: asString(src.appliedOn),
      });
    });
    if (!resume && files[0] && files[0].url) resume = files[0].url;
    var docs = seedApplicantDocs({
      resumeLink: resume,
      linkedDocs: linked,
      docs: src.docs && typeof src.docs === "object" ? src.docs : {},
      appliedOn: src.appliedOn,
    });
    return { resumeLink: resume, linkedDocs: linked, docs: docs };
  }

  function attachFilesToApplicant(applicant, files, opts) {
    opts = opts || {};
    var a = applicant || {};
    var incoming = (files || []).map(function (f) {
      return normalizeFileRef(f, f && f.title);
    }).filter(Boolean);
    var linked = (a.linkedDocs || []).slice();
    var seen = Object.create(null);
    linked.forEach(function (x) {
      var n = normalizeFileRef(x);
      if (n && n.url) seen[n.url] = true;
    });
    incoming.forEach(function (f) {
      if (!f.url || seen[f.url]) return;
      seen[f.url] = true;
      linked.push({
        title: f.title,
        url: f.url,
        note: f.note || opts.note || "Drive match",
        added: asString(opts.today || a.appliedOn),
      });
    });
    if (!asString(a.resumeLink)) {
      var first = incoming.find(function (f) {
        return f.kind !== "folder";
      }) || incoming[0];
      if (first) a.resumeLink = first.url;
    }
    a.linkedDocs = linked;
    a.docs = seedApplicantDocs(a, opts);
    return a;
  }

  function seedApplicantDocs(applicant, opts) {
    opts = opts || {};
    var a = applicant || {};
    var docs = cloneRow(a.docs || {});
    collectApplicationFiles(a).forEach(function (f) {
      if (f.kind === "folder") return;
      var k = f.docKey && RECRUITMENT_DOCS.some(function (d) { return d.k === f.docKey; })
        ? f.docKey
        : guessApplicantDocKey(f.title || f.url);
      docs[k] = addLinkToDocRow(docs[k], f, a.appliedOn);
    });
    if ((a.exams || []).length) {
      docs.iqtest = docs.iqtest || blankDocRow();
      if (docs.iqtest.s === "miss") docs.iqtest.s = "on";
      docs.iqtest.filed = docs.iqtest.filed || asString((a.exams[0] && a.exams[0].takenOn) || a.appliedOn);
    }
    if ((a.interviews || []).length) {
      docs.initint = docs.initint || blankDocRow();
      if (docs.initint.s === "miss") docs.initint.s = "on";
      docs.initint.filed = docs.initint.filed || asString((a.interviews[0] && a.interviews[0].date) || a.appliedOn);
    }
    if (asString(a.rffiNote) || opts.hasRffi) {
      docs.recoletter = docs.recoletter || blankDocRow();
      if (docs.recoletter.s === "miss") docs.recoletter.s = "on";
    }
    return docs;
  }

  function extraLinks(applicant) {
    var out = [];
    var seen = Object.create(null);
    function push(url, title, note) {
      url = asString(url);
      if (!url || seen[url]) return;
      seen[url] = true;
      out.push({ url: url, title: asString(title) || "Attachment", note: asString(note) });
    }
    collectApplicationFiles(applicant).forEach(function (f) {
      push(f.url, f.title, f.note);
    });
    return out;
  }

  return {
    ARRAY_FIELDS: ARRAY_FIELDS,
    PREFER_NONEMPTY: PREFER_NONEMPTY,
    RECRUITMENT_DOCS: RECRUITMENT_DOCS,
    STAGE_RANK: STAGE_RANK,
    STAGES: STAGES,
    applyIngestOnto: applyIngestOnto,
    asString: asString,
    classifyGroup: classifyGroup,
    emailKey: emailKey,
    emailsCompatible: emailsCompatible,
    extraLinks: extraLinks,
    attachFilesToApplicant: attachFilesToApplicant,
    collectApplicationFiles: collectApplicationFiles,
    driveFileUrl: driveFileUrl,
    fileMatchesApplicant: fileMatchesApplicant,
    findIngestMatch: findIngestMatch,
    guessApplicantDocKey: guessApplicantDocKey,
    ingestFileFields: ingestFileFields,
    lastNameToken: lastNameToken,
    normalizeFileRef: normalizeFileRef,
    parseDriveRef: parseDriveRef,
    furthestStage: furthestStage,
    groupApplicants: groupApplicants,
    incomingAsApplicant: incomingAsApplicant,
    mergeApplicantRecords: mergeApplicantRecords,
    mergeDocs: mergeDocs,
    nameKey: nameKey,
    pickKeeper: pickKeeper,
    recruitmentDocs: recruitmentDocs,
    rolesCompatible: rolesCompatible,
    seedApplicantDocs: seedApplicantDocs,
    stageRank: stageRank,
    uniqueDates: uniqueDates,
  };
});
