/**
 * Parse the GoDaddy HR application extractor JSON/CSV into an
 * applicants-ingest payload. Browser (claude-shim) and Node (ingest).
 * Does not rewrite the artifact.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) root.hrApplicantsExport = api;
  if (typeof window !== "undefined" && window) window.hrApplicantsExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DRIVE_FOLDER_ID = "1G1TJ5rmI_rGEQcXjKLfYfy2dx9gtZRgC";
  var DRIVE_FOLDER_URL =
    "https://drive.google.com/drive/folders/1G1TJ5rmI_rGEQcXjKLfYfy2dx9gtZRgC";
  var EXPORT_JSON = "builder-latest-applicants-export.json";
  var EXPORT_CSV = "builder-latest-applicants-export.csv";

  var HEADER_MAP = {
    id: "id",
    name: "name",
    email: "email",
    mobile: "mobile",
    roleid: "roleId",
    position: "position",
    dept: "dept",
    resumelink: "resumeLink",
    notes: "notes",
    expected: "expected",
    education: "education",
    years: "years",
    source: "source",
    appliedon: "appliedOn",
    stage: "stage",
    overwrite: "overwrite",
    forcenew: "forceNew",
    updateonly: "updateOnly",
    overwriteexistingonly: "updateOnly",
  };

  function asString(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    return "";
  }

  function headerKey(raw) {
    return HEADER_MAP[String(raw || "").replace(/[\s_-]/g, "").toLowerCase()] || "";
  }

  function parseBool(value) {
    return /^(1|true|yes)$/i.test(asString(value));
  }

  function looksLikeExtractor(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    if (!Array.isArray(data.applicants)) return false;
    if (data.driveFolderId || data.driveFolderUrl || data.asOf) return true;
    if (data.counts && (data.counts.totalApplicants != null || data.counts.backfillPatched != null)) {
      return true;
    }
    var notes = Array.isArray(data.notes) ? data.notes.join(" ") : asString(data.notes);
    return /overwrite[- ]by[- ]id/i.test(notes);
  }

  function allHaveIds(applicants) {
    if (!applicants || !applicants.length) return false;
    return applicants.every(function (row) {
      return row && asString(row.id);
    });
  }

  function looksLikeExtractorCsvHeaders(headers) {
    var keys = (headers || []).map(function (h) {
      return headerKey(h);
    });
    return keys.indexOf("id") >= 0 && keys.indexOf("name") >= 0 && keys.indexOf("resumeLink") >= 0;
  }

  function parseCsvRows(text) {
    var rows = [];
    var row = [];
    var field = "";
    var i = 0;
    var inQuotes = false;
    var s = String(text || "").replace(/^\uFEFF/, "");
    while (i < s.length) {
      var ch = s.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        row.push(field);
        field = "";
        i += 1;
        continue;
      }
      if (ch === "\r") {
        i += 1;
        continue;
      }
      if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function parseCsv(text) {
    var rows = parseCsvRows(text);
    if (!rows.length) throw new Error("CSV has no rows.");
    var headers = rows[0].map(function (h) {
      return String(h || "").trim();
    });
    if (!looksLikeExtractorCsvHeaders(headers) && headers.map(headerKey).indexOf("name") < 0) {
      throw new Error("CSV must have a header row with at least name (and id to overwrite).");
    }
    var out = [];
    for (var r = 1; r < rows.length; r += 1) {
      var cells = rows[r];
      if (!cells || !cells.length) continue;
      if (
        cells.every(function (c) {
          return String(c || "").trim() === "";
        })
      ) {
        continue;
      }
      var obj = {};
      for (var c = 0; c < headers.length; c += 1) {
        var key = headerKey(headers[c]);
        if (!key) continue;
        var val = cells[c] == null ? "" : String(cells[c]).trim();
        if (key === "overwrite" || key === "forceNew" || key === "updateOnly") {
          obj[key] = parseBool(val);
        } else {
          obj[key] = val;
        }
      }
      if (asString(obj.name) || asString(obj.id)) out.push(obj);
    }
    if (!out.length) throw new Error("CSV must include at least one applicant row.");
    return { applicants: out, headers: headers };
  }

  function looksLikeCsv(text) {
    var raw = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!raw) return false;
    var first = raw.split(/\r?\n/)[0] || "";
    if (!first || first.charAt(0) === "{" || first.charAt(0) === "[") return false;
    return first.indexOf(",") >= 0 && /name/i.test(first);
  }

  function parseApplicantsExport(text, opts) {
    opts = opts || {};
    var raw = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!raw) throw new Error('Paste JSON or CSV from the extractor export.');
    var data;
    var fromCsv = false;
    var csvHeaders = [];

    if (opts.format === "csv" || looksLikeCsv(raw)) {
      var csv = parseCsv(raw);
      data = { applicants: csv.applicants };
      csvHeaders = csv.headers;
      fromCsv = true;
    } else if (raw.charAt(0) === "{" || raw.charAt(0) === "[") {
      try {
        data = JSON.parse(raw);
      } catch (e) {
        throw new Error("That is not valid JSON.");
      }
      if (Array.isArray(data)) data = { applicants: data };
      if (!data || typeof data !== "object" || !Array.isArray(data.applicants)) {
        throw new Error('JSON must be { "applicants": [ … ] } or an array of applicants.');
      }
    } else {
      try {
        var fallback = parseCsv(raw);
        data = { applicants: fallback.applicants };
        csvHeaders = fallback.headers;
        fromCsv = true;
      } catch (e) {
        throw new Error('Paste JSON ({ "applicants": [ … ] }) or a CSV with id,name,resumeLink.');
      }
    }

    if (!data.applicants.length) throw new Error("applicants must not be empty");

    var extractor =
      looksLikeExtractor(data) || (fromCsv && looksLikeExtractorCsvHeaders(csvHeaders) && allHaveIds(data.applicants));
    var updateOnly =
      opts.updateOnly === true ||
      data.updateOnly === true ||
      data.overwriteExistingOnly === true ||
      extractor;
    var overwrite = opts.overwrite === true || data.overwrite === true || updateOnly;

    return {
      applicants: data.applicants,
      overwrite: overwrite,
      updateOnly: updateOnly,
      forceNew: data.forceNew === true,
      extractor: extractor,
      fromCsv: fromCsv,
      asOf: asString(data.asOf),
      driveFolderUrl: asString(data.driveFolderUrl) || (extractor ? DRIVE_FOLDER_URL : ""),
      driveFolderId: asString(data.driveFolderId) || (extractor ? DRIVE_FOLDER_ID : ""),
      counts: data.counts && typeof data.counts === "object" ? data.counts : null,
    };
  }

  return {
    DRIVE_FOLDER_ID: DRIVE_FOLDER_ID,
    DRIVE_FOLDER_URL: DRIVE_FOLDER_URL,
    EXPORT_JSON: EXPORT_JSON,
    EXPORT_CSV: EXPORT_CSV,
    parseApplicantsExport: parseApplicantsExport,
    parseCsv: parseCsv,
    looksLikeCsv: looksLikeCsv,
    looksLikeExtractor: looksLikeExtractor,
    allHaveIds: allHaveIds,
  };
});
