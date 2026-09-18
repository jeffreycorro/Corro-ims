"use strict";

const crypto = require("crypto");
const { formatManilaDate } = require("./manila");
const { readSession, safeEqual, unauthorized } = require("./session");
const {
  applyIngestOnto,
  emailKey,
  findIngestMatch,
} = require("../../public/hr-applicant-dedupe");
const {
  looksLikeCsv,
  looksLikeExtractor,
  parseApplicantsExport,
} = require("../../public/hr-applicants-export");

const MAX_BATCH = 100;
const ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
const APPLIED_ON_RE = /^\d{4}-\d{2}-\d{2}$/;

const STAGES = Object.freeze([
  "Applied",
  "Screening",
  "Written Exam",
  "Interview",
  "Final Interview",
  "Offer",
  "Hired",
  "Rejected",
]);

const OPTIONAL_STRINGS = Object.freeze([
  "email",
  "mobile",
  "roleId",
  "position",
  "dept",
  "resumeLink",
  "notes",
  "expected",
  "education",
  "years",
]);

function ingestKey() {
  return String(process.env.HR_APPLICANTS_INGEST_KEY || "").trim();
}

function header(event, name) {
  const headers = event && event.headers ? event.headers : {};
  const want = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === want) return String(value || "");
  }
  return "";
}

function presentedIngestKey(event) {
  const raw = header(event, "x-hr-ingest-key").trim();
  if (raw) return raw;
  const auth = header(event, "authorization");
  const match = auth.match(/^Bearer\s+(\S+)/i);
  return match ? match[1].trim() : "";
}

/**
 * Humans use the HR session cookie. The GoDaddy extractor uses
 * X-HR-Ingest-Key or Authorization: Bearer, backed by HR_APPLICANTS_INGEST_KEY.
 * There is no default key — unset env means key auth always fails.
 */
function authorizeIngest(event) {
  const session = readSession(event);
  if (session) {
    return { method: "session", session };
  }
  const expected = ingestKey();
  const presented = presentedIngestKey(event);
  if (expected && presented && safeEqual(presented, expected)) {
    return { method: "ingest-key" };
  }
  throw unauthorized();
}

function newApplicantId() {
  return `a_${crypto.randomBytes(4).toString("hex")}${Date.now().toString(36).slice(-4)}`;
}

function asString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function blankApplicant(id, today) {
  return {
    id,
    name: "",
    roleId: "",
    position: "",
    dept: "",
    source: "Email",
    appliedOn: today,
    stage: "Applied",
    mobile: "",
    email: "",
    resumeLink: "",
    expected: "",
    notes: "",
    exams: [],
    interviews: [],
    aiSummary: "",
    aiVerdict: "",
    aiOn: "",
    education: "",
    years: "",
    history: [],
    background: [],
    staffNotes: [],
    rffiNote: "",
    hrVerdict: "",
    hrRating: "3",
    hrNotes: "",
    hrBy: "",
    hrOn: "",
    hiredEmpId: "",
  };
}

function parseIngestBody(raw) {
  if (typeof raw === "string" && looksLikeCsv(raw)) {
    let parsed;
    try {
      parsed = parseApplicantsExport(raw, { format: "csv" });
    } catch (cause) {
      const err = new Error(cause && cause.message ? cause.message : "CSV must include applicants");
      err.statusCode = 400;
      throw err;
    }
    if (parsed.applicants.length > MAX_BATCH) {
      const err = new Error(`At most ${MAX_BATCH} applicants per request`);
      err.statusCode = 400;
      throw err;
    }
    return {
      applicants: parsed.applicants,
      overwrite: parsed.overwrite === true,
      forceNew: parsed.forceNew === true,
      updateOnly: parsed.updateOnly === true,
    };
  }

  let body;
  try {
    body = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
  } catch {
    const err = new Error("Body must be JSON or CSV");
    err.statusCode = 400;
    throw err;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const err = new Error('Body must be { "applicants": [ ... ] }');
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(body.applicants)) {
    const err = new Error('Body must include an "applicants" array');
    err.statusCode = 400;
    throw err;
  }
  if (body.applicants.length === 0) {
    const err = new Error("applicants must not be empty");
    err.statusCode = 400;
    throw err;
  }
  if (body.applicants.length > MAX_BATCH) {
    const err = new Error(`At most ${MAX_BATCH} applicants per request`);
    err.statusCode = 400;
    throw err;
  }
  const extractor = looksLikeExtractor(body);
  const updateOnly =
    body.updateOnly === true || body.overwriteExistingOnly === true || extractor;
  return {
    applicants: body.applicants,
    overwrite: body.overwrite === true || updateOnly,
    forceNew: body.forceNew === true,
    updateOnly,
  };
}

function normalizeItem(item, index, { today, batchOverwrite, batchUpdateOnly } = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { ok: false, index, error: "applicant must be an object" };
  }
  const name = asString(item.name);
  if (!name) {
    return { ok: false, index, error: "name is required" };
  }

  const id = asString(item.id);
  const explicitId = Boolean(id);
  if (id && !ID_RE.test(id)) {
    return {
      ok: false,
      index,
      error: "id must be 1–80 letters, numbers, dot, underscore, or hyphen",
    };
  }

  const updateOnly =
    item.updateOnly === true || item.overwriteExistingOnly === true || batchUpdateOnly === true;
  if ((item.overwrite === true || updateOnly) && !explicitId) {
    return {
      ok: false,
      index,
      error: updateOnly ? "updateOnly requires an explicit id" : "overwrite requires an explicit id",
    };
  }
  const overwrite = item.overwrite === true || updateOnly || (batchOverwrite === true && explicitId);
  const forceNew = item.forceNew === true;

  let appliedOn = asString(item.appliedOn);
  if (appliedOn) {
    if (!APPLIED_ON_RE.test(appliedOn)) {
      return { ok: false, index, error: "appliedOn must be YYYY-MM-DD" };
    }
  } else {
    appliedOn = today;
  }

  const warnings = [];
  let stage = asString(item.stage) || "Applied";
  if (!STAGES.includes(stage)) {
    warnings.push(`unknown stage "${stage}", defaulted to Applied`);
    stage = "Applied";
  }

  const fields = {};
  for (const key of OPTIONAL_STRINGS) {
    if (item[key] != null) fields[key] = asString(item[key]);
  }

  return {
    ok: true,
    index,
    name,
    id: id || null,
    explicitId,
    overwrite,
    updateOnly,
    forceNew,
    appliedOn,
    stage,
    source: asString(item.source) || "Email",
    provided: {
      source: item.source != null && asString(item.source) !== "",
      appliedOn: Boolean(asString(item.appliedOn)),
      stage: Boolean(asString(item.stage)),
    },
    fields,
    warnings,
  };
}

function existingData(row) {
  if (!row) return null;
  if (row.data && typeof row.data === "object") return row.data;
  if (row.name || row.id) return row;
  return null;
}

function collectExisting(rows) {
  const out = [];
  (rows || []).forEach((row) => {
    const data = existingData(row);
    if (!data) return;
    if (!data.id && row && row.id) data.id = row.id;
    out.push(data);
  });
  return out;
}

async function ingestApplicants(items, deps) {
  const getDoc = deps.getDoc;
  const setDoc = deps.setDoc;
  const listCollection = deps.listCollection;
  const today = deps.today || formatManilaDate();
  const batchOverwrite = deps.batchOverwrite === true;
  const batchForceNew = deps.batchForceNew === true;
  const batchUpdateOnly = deps.batchUpdateOnly === true;
  const created = [];
  const updated = [];
  const errors = [];
  const roleCache = new Map();
  let known = [];
  if (typeof listCollection === "function") {
    try {
      known = collectExisting(await listCollection("applicants"));
    } catch {
      known = [];
    }
  }

  async function loadRole(roleId) {
    if (!roleId) return null;
    if (roleCache.has(roleId)) return roleCache.get(roleId);
    const row = await getDoc("roles", roleId);
    const role = existingData(row);
    roleCache.set(roleId, role);
    return role;
  }

  async function allocateId() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = newApplicantId();
      const row = await getDoc("applicants", id);
      if (!row) return id;
    }
    return null;
  }

  for (let i = 0; i < items.length; i += 1) {
    const norm = normalizeItem(items[i], i, { today, batchOverwrite, batchUpdateOnly });
    if (!norm.ok) {
      errors.push({ index: i, error: norm.error });
      continue;
    }

    try {
      const warnings = norm.warnings.slice();
      const forceNew = norm.forceNew === true || batchForceNew === true;
      let id = norm.id;
      let prior = null;
      let matchedBy = "";

      if (id) {
        const row = await getDoc("applicants", id);
        if (row) {
          if (!norm.overwrite) {
            errors.push({
              index: i,
              error: `id ${id} already exists (set overwrite:true to replace)`,
            });
            continue;
          }
          prior = existingData(row);
          matchedBy = "id";
        } else if (norm.updateOnly) {
          errors.push({
            index: i,
            id,
            error: `id ${id} is not on Pipeline; skipped (updateOnly)`,
          });
          continue;
        }
      } else if (norm.updateOnly) {
        errors.push({ index: i, error: "updateOnly requires an explicit id" });
        continue;
      } else if (!forceNew) {
        const match = findIngestMatch(
          { name: norm.name, email: norm.fields.email, roleId: norm.fields.roleId },
          known
        );
        if (match && match.id) {
          prior = match;
          id = match.id;
          matchedBy = emailKey(norm.fields.email) && emailKey(match.email)
            ? "email"
            : "name";
        }
      }

      if (!id) {
        id = await allocateId();
        if (!id) {
          errors.push({ index: i, error: "could not allocate a unique id" });
          continue;
        }
      }

      let doc;
      if (prior && matchedBy && matchedBy !== "id") {
        doc = applyIngestOnto(prior, norm, { today });
        doc.id = id;
      } else if (prior && norm.overwrite) {
        doc = { ...blankApplicant(id, today), ...prior, id };
        doc.name = norm.name;
        if (norm.provided && norm.provided.source) doc.source = norm.source;
        if (norm.provided && norm.provided.appliedOn) doc.appliedOn = norm.appliedOn;
        if (norm.provided && norm.provided.stage) doc.stage = norm.stage;
        Object.assign(doc, norm.fields);
      } else {
        doc = blankApplicant(id, today);
        doc.name = norm.name;
        doc.source = norm.source;
        doc.appliedOn = norm.appliedOn;
        doc.stage = norm.stage;
        Object.assign(doc, norm.fields);
      }
      for (const key of ["exams", "interviews", "history", "background", "staffNotes"]) {
        if (!Array.isArray(doc[key])) doc[key] = [];
      }

      const incomingRoleId = asString(norm.fields.roleId);
      const roleId = incomingRoleId || asString(doc.roleId);
      if (roleId) {
        const role = await loadRole(roleId);
        if (!role) {
          warnings.push(`roleId ${roleId} not found; left unlinked`);
          if (incomingRoleId && incomingRoleId === roleId) {
            doc.roleId = asString(prior && prior.roleId) || "";
          } else if (!asString(doc.roleId)) {
            doc.roleId = "";
          }
        } else {
          doc.roleId = roleId;
          if (!asString(doc.position)) doc.position = asString(role.title);
          if (!asString(doc.dept)) doc.dept = asString(role.dept);
        }
      } else if (!prior) {
        doc.roleId = "";
      }

      await setDoc("applicants", id, doc);
      const idx = known.findIndex((row) => row && row.id === id);
      if (idx >= 0) known[idx] = doc;
      else known.push(doc);
      const entry = { id, name: doc.name };
      if (warnings.length) entry.warning = warnings.join("; ");
      if (prior) {
        entry.matchedBy = matchedBy || "id";
        updated.push(entry);
      } else {
        created.push(entry);
      }
    } catch (err) {
      errors.push({ index: i, error: (err && err.message) || "persist failed" });
    }
  }

  return {
    ok: errors.length === 0,
    created,
    updated,
    errors,
  };
}

module.exports = {
  MAX_BATCH,
  OPTIONAL_STRINGS,
  STAGES,
  authorizeIngest,
  blankApplicant,
  ingestApplicants,
  ingestKey,
  newApplicantId,
  normalizeItem,
  parseIngestBody,
  presentedIngestKey,
};
