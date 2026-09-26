"use strict";

const crypto = require("crypto");
const { formatManilaDate } = require("./manila");
const { readSession, safeEqual, unauthorized } = require("./session");
const {
  applyIngestOnto,
  findIngestMatch,
  ingestMatchedBy,
  mergeDocs,
  mergeNoteText,
  stageRank,
  syncResumeDoc,
} = require("../../public/hr-applicant-dedupe");
const {
  looksLikeCsv,
  looksLikeExtractor,
  parseApplicantsExport,
} = require("../../public/hr-applicants-export");

const MAX_BATCH = 100;
const ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
const APPLIED_ON_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_KEY_RE = /^[A-Za-z0-9._-]{1,40}$/;
const DOC_STATUS = new Set(["miss", "na", "exp", "on"]);
const CONTACT_REFRESH = Object.freeze([
  "email",
  "mobile",
  "position",
  "dept",
  "expected",
  "education",
  "years",
]);
const HR_TEXT_FIELDS = Object.freeze([
  "hrNotes",
  "hrVerdict",
  "hrBy",
  "rffiNote",
  "aiSummary",
  "aiVerdict",
]);

const STAGES = Object.freeze([
  "Applied",
  "Screening",
  "Shortlisted",
  "On Hold",
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
    docs: {},
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
  if (body.op === "mergeInto") {
    return parseMergeInto(body);
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

function parseMergeInto(body) {
  const merges = [];
  if (body.strayId != null || body.keepId != null) {
    merges.push({ strayId: asString(body.strayId), keepId: asString(body.keepId) });
  }
  if (Array.isArray(body.merges)) {
    body.merges.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      merges.push({ strayId: asString(item.strayId), keepId: asString(item.keepId) });
    });
  }
  if (!merges.length) {
    const err = new Error("mergeInto requires strayId and keepId");
    err.statusCode = 400;
    throw err;
  }
  if (merges.length > MAX_BATCH) {
    const err = new Error(`At most ${MAX_BATCH} merges per request`);
    err.statusCode = 400;
    throw err;
  }
  return { op: "mergeInto", merges };
}

function normalizeDocEntry(value, appliedOn) {
  if (typeof value === "string") {
    const link = asString(value);
    if (!link) return null;
    return {
      s: "on",
      link,
      links: [{ url: link, title: "", on: appliedOn || "" }],
      filed: appliedOn || "",
      expiry: "",
      title: "",
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const link = asString(value.link || value.url || value.href);
  const links = [];
  if (Array.isArray(value.links)) {
    value.links.forEach((item) => {
      if (typeof item === "string") {
        const url = asString(item);
        if (url) links.push({ url, title: "", on: "" });
      } else if (item && typeof item === "object") {
        const url = asString(item.url || item.link);
        if (url) links.push({ url, title: asString(item.title), on: asString(item.on) });
      }
    });
  }
  if (link && !links.some((item) => item.url === link)) {
    links.unshift({
      url: link,
      title: asString(value.title),
      on: asString(value.filed) || appliedOn || "",
    });
  }
  const status = asString(value.s);
  if (!link && !links.length && !status && !asString(value.filed) && !asString(value.title)) {
    return null;
  }
  return {
    s: DOC_STATUS.has(status) ? status : link ? "on" : "miss",
    link: link || (links[0] ? links[0].url : ""),
    links,
    filed: asString(value.filed),
    expiry: asString(value.expiry),
    title: asString(value.title),
  };
}

function normalizeDocs(raw, appliedOn) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  Object.keys(raw).forEach((key) => {
    if (!DOC_KEY_RE.test(key)) return;
    const entry = normalizeDocEntry(raw[key], appliedOn);
    if (entry) out[key] = entry;
  });
  return Object.keys(out).length ? out : null;
}

function earlierDate(a, b) {
  const left = asString(a);
  const right = asString(b);
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
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
  const docs = normalizeDocs(item.docs, appliedOn);
  if (docs && docs.resume && !asString(fields.resumeLink)) {
    const fromDocs = asString(docs.resume.link);
    if (fromDocs) fields.resumeLink = fromDocs;
  }
  const replaceHrFields = item.replaceHrFields === true;
  const hrFields = {};
  if (replaceHrFields) {
    for (const key of HR_TEXT_FIELDS) {
      if (item[key] != null) hrFields[key] = asString(item[key]);
    }
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
    replaceHrFields,
    appliedOn,
    stage,
    source: asString(item.source) || "Email",
    provided: {
      source: item.source != null && asString(item.source) !== "",
      appliedOn: Boolean(asString(item.appliedOn)),
      stage: Boolean(asString(item.stage)),
    },
    fields,
    docs,
    hrFields,
    warnings,
  };
}

/**
 * Overwrite keeps the Pipeline row. Notes are merged. Empty incoming values
 * do not clear filled fields. Stage and HR evaluation fields stay unless
 * replaceHrFields is set, and stage never moves backwards. resumeLink may refresh.
 */
function applyOverwriteOnto(prior, norm, { today } = {}) {
  const doc = JSON.parse(JSON.stringify(prior || {}));
  doc.id = prior.id;
  if (asString(norm.name)) doc.name = norm.name;
  doc.notes = mergeNoteText(prior.notes, norm.fields && norm.fields.notes);
  const fields = norm.fields || {};
  for (const key of CONTACT_REFRESH) {
    const incoming = asString(fields[key]);
    if (incoming) doc[key] = incoming;
  }
  if (asString(fields.roleId)) doc.roleId = asString(fields.roleId);
  const previousResume = asString(doc.resumeLink);
  if (asString(fields.resumeLink)) doc.resumeLink = asString(fields.resumeLink);
  if (norm.provided && norm.provided.source && asString(norm.source)) doc.source = norm.source;
  if (norm.provided && norm.provided.appliedOn) {
    doc.appliedOn = earlierDate(prior.appliedOn, norm.appliedOn) || asString(prior.appliedOn);
  }
  const priorStage = asString(prior.stage) || "Applied";
  if (!norm.replaceHrFields) {
    doc.stage = priorStage;
  } else if (norm.provided && norm.provided.stage) {
    if (stageRank(norm.stage) >= stageRank(priorStage) && stageRank(norm.stage) > 0) {
      doc.stage = norm.stage;
    } else {
      doc.stage = priorStage;
    }
  } else {
    doc.stage = priorStage;
  }
  if (norm.replaceHrFields && norm.hrFields) {
    for (const key of HR_TEXT_FIELDS) {
      const incoming = asString(norm.hrFields[key]);
      if (incoming) doc[key] = incoming;
    }
  }
  if (norm.docs) doc.docs = mergeDocs([prior.docs, norm.docs]);
  syncResumeDoc(doc, doc.resumeLink, previousResume);
  const hist = Array.isArray(prior.history) ? prior.history.slice() : [];
  hist.push({ on: today || "", what: "Re-ingested application" });
  doc.history = hist;
  for (const key of ["exams", "interviews", "background", "staffNotes"]) {
    if (!Array.isArray(doc[key])) doc[key] = [];
  }
  return doc;
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
      const requestedId = norm.id || "";

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
          if (prior && !prior.id) prior.id = id;
          matchedBy = "id";
        }
      }

      if (!prior && !forceNew) {
        const probe = {
          name: norm.name,
          email: norm.fields.email,
          mobile: norm.fields.mobile,
        };
        const match = findIngestMatch(probe, known);
        if (match && match.id) {
          prior = match;
          id = match.id;
          matchedBy = ingestMatchedBy(probe, match) || "name";
        }
      }

      if (!prior && norm.updateOnly) {
        errors.push({
          index: i,
          id: requestedId || undefined,
          error: requestedId
            ? `id ${requestedId} is not on Pipeline; skipped (updateOnly)`
            : "updateOnly requires an explicit id",
        });
        continue;
      }

      if (!prior) {
        id = await allocateId();
        if (!id) {
          errors.push({ index: i, error: "could not allocate a unique id" });
          continue;
        }
        matchedBy = "new";
      }

      let doc;
      if (prior && norm.overwrite) {
        doc = applyOverwriteOnto(prior, norm, { today });
        doc.id = id;
      } else if (prior) {
        doc = applyIngestOnto(prior, norm, { today });
        doc.id = id;
      } else {
        doc = blankApplicant(id, today);
        doc.name = norm.name;
        doc.source = norm.source;
        doc.appliedOn = norm.appliedOn;
        doc.stage = norm.stage;
        Object.assign(doc, norm.fields);
        if (norm.docs) doc.docs = mergeDocs([norm.docs]);
        syncResumeDoc(doc, doc.resumeLink);
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
      const entry = { id, name: doc.name, matchedBy: matchedBy || (prior ? "id" : "new") };
      if (requestedId && requestedId !== id) entry.requestedId = requestedId;
      if (warnings.length) entry.warning = warnings.join("; ");
      if (prior) updated.push(entry);
      else created.push(entry);
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

function strayBlockedReason(row) {
  const stage = asString(row && row.stage);
  if (stage && stage !== "Applied") {
    return `stray is at stage ${stage}; refused (past Applied)`;
  }
  if (
    asString(row.hrNotes) ||
    asString(row.hrVerdict) ||
    asString(row.hrOn) ||
    asString(row.hiredEmpId)
  ) {
    return "stray has HR evaluation fields; refused";
  }
  if (
    asString(row.rffiNote) ||
    asString(row.aiSummary) ||
    asString(row.aiOn) ||
    asString(row.editedBy) ||
    asString(row.updatedBy) ||
    asString(row.lastEditedBy) ||
    row.portalEdited === true
  ) {
    return "stray was edited in the portal; refused";
  }
  if (Array.isArray(row.exams) && row.exams.length) return "stray has exam scores; refused";
  if (Array.isArray(row.interviews) && row.interviews.length) return "stray has interviews; refused";
  if (Array.isArray(row.staffNotes) && row.staffNotes.length) return "stray has staff notes; refused";
  if (Array.isArray(row.background) && row.background.length) return "stray has background-check notes; refused";
  return "";
}

/**
 * Fold a bot-made stray into the keeper (notes + resumeLink) and delete the stray.
 * Refuses when the stray has left Applied or carries portal evaluation fields.
 * There is no separate per-field edit log on applicants; those HR fields are the signal.
 */
async function mergeApplicantsInto(merges, deps) {
  const getDoc = deps.getDoc;
  const setDoc = deps.setDoc;
  const remove = deps.deleteDoc;
  const today = deps.today || formatManilaDate();
  const merged = [];
  const errors = [];
  if (typeof remove !== "function") {
    const err = new Error("delete is not available");
    err.statusCode = 500;
    throw err;
  }
  for (let i = 0; i < (merges || []).length; i += 1) {
    const spec = merges[i] || {};
    const strayId = asString(spec.strayId);
    const keepId = asString(spec.keepId);
    if (!strayId || !keepId || !ID_RE.test(strayId) || !ID_RE.test(keepId)) {
      errors.push({ index: i, strayId, keepId, error: "strayId and keepId must be applicant ids" });
      continue;
    }
    if (strayId === keepId) {
      errors.push({ index: i, strayId, keepId, error: "strayId and keepId must differ" });
      continue;
    }
    try {
      const strayRow = await getDoc("applicants", strayId);
      const keepRow = await getDoc("applicants", keepId);
      if (!strayRow) {
        errors.push({ index: i, strayId, keepId, error: `stray ${strayId} is not on Pipeline` });
        continue;
      }
      if (!keepRow) {
        errors.push({ index: i, strayId, keepId, error: `keeper ${keepId} is not on Pipeline` });
        continue;
      }
      const stray = existingData(strayRow) || {};
      const keep = existingData(keepRow) || {};
      if (!stray.id) stray.id = strayId;
      if (!keep.id) keep.id = keepId;
      const blocked = strayBlockedReason(stray);
      if (blocked) {
        errors.push({ index: i, strayId, keepId, error: blocked });
        continue;
      }
      const keeper = JSON.parse(JSON.stringify(keep));
      keeper.id = keepId;
      keeper.notes = mergeNoteText(keeper.notes, stray.notes);
      keeper.notes = mergeNoteText(
        keeper.notes,
        `Merged duplicate record ${strayId} on ${today}.`
      );
      const strayResume = asString(stray.resumeLink);
      if (strayResume && !asString(keeper.resumeLink)) keeper.resumeLink = strayResume;
      keeper.docs = mergeDocs([keeper.docs, stray.docs]);
      if (strayResume && asString(keeper.resumeLink) && strayResume !== asString(keeper.resumeLink)) {
        const docs = keeper.docs && typeof keeper.docs === "object" ? keeper.docs : {};
        const resume =
          docs.resume && typeof docs.resume === "object"
            ? docs.resume
            : { s: "on", link: "", links: [], filed: "", expiry: "", title: "" };
        resume.links = Array.isArray(resume.links) ? resume.links.slice() : [];
        if (!resume.links.some((item) => item && (item.url === strayResume || item.link === strayResume))) {
          resume.links.push({ url: strayResume, title: "CV from merged duplicate", on: today });
        }
        docs.resume = resume;
        keeper.docs = docs;
      }
      syncResumeDoc(keeper, keeper.resumeLink);
      const hist = Array.isArray(keeper.history) ? keeper.history.slice() : [];
      hist.push({ on: today, what: "Merged stray applicant", fromIds: [strayId] });
      keeper.history = hist;
      await setDoc("applicants", keepId, keeper);
      await remove("applicants", strayId);
      merged.push({
        ok: true,
        strayId,
        keepId,
        id: keepId,
        name: asString(keeper.name),
        deleted: strayId,
      });
    } catch (err) {
      errors.push({
        index: i,
        strayId,
        keepId,
        error: (err && err.message) || "merge failed",
      });
    }
  }
  return { ok: errors.length === 0, op: "mergeInto", merged, errors };
}

module.exports = {
  MAX_BATCH,
  OPTIONAL_STRINGS,
  STAGES,
  authorizeIngest,
  blankApplicant,
  ingestApplicants,
  ingestKey,
  mergeApplicantsInto,
  newApplicantId,
  normalizeItem,
  parseIngestBody,
  presentedIngestKey,
};
