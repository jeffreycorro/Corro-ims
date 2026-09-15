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

  var ARRAY_FIELDS = ["exams", "interviews", "history", "background", "linkedDocs"];

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
    return { autoSafe: false, reason: "same-email-different-names" };
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
      resumeLink: fields.resumeLink || "",
      notes: fields.notes || "",
      expected: fields.expected || "",
      education: fields.education || "",
      years: fields.years || "",
      docs: {},
      exams: [],
      interviews: [],
      history: [],
      background: [],
      linkedDocs: [],
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

  function seedApplicantDocs(applicant, opts) {
    opts = opts || {};
    var a = applicant || {};
    var docs = cloneRow(a.docs || {});
    var resume = asString(a.resumeLink);
    if (resume) {
      docs.resume = docs.resume || blankDocRow();
      if (!asString(docs.resume.link) && !(docs.resume.links || []).length) {
        docs.resume.link = resume;
        docs.resume.links = [{ url: resume, title: "CV / application", on: asString(a.appliedOn) }];
        docs.resume.s = docs.resume.s === "miss" ? "on" : docs.resume.s;
        docs.resume.filed = docs.resume.filed || asString(a.appliedOn);
      }
    }
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
    var a = applicant || {};
    push(a.resumeLink, "CV / documents", "resumeLink");
    (a.linkedDocs || []).forEach(function (x) {
      if (!x) return;
      if (typeof x === "string") push(x, "Linked file", "");
      else push(x.url || x.link, x.title, x.note);
    });
    var docs = a.docs || {};
    Object.keys(docs).forEach(function (k) {
      var v = docs[k] || {};
      push(v.link, v.title || k, k);
      (v.links || []).forEach(function (x) {
        if (typeof x === "string") push(x, k, k);
        else if (x) push(x.url, x.title || k, k);
      });
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
    findIngestMatch: findIngestMatch,
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
