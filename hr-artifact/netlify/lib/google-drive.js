"use strict";

const crypto = require("crypto");
const { codedError } = require("./coded-error");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,webViewLink,parents,modifiedTime";
const MAX_READ_BYTES = 12 * 1024 * 1024;

let tokenCache = null;

function parseServiceAccount(raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  let text = String(raw || "").trim();
  if (!text) return null;
  if (!text.startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf8").trim();
    } catch {
      throw codedError("server_not_connected", "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw codedError("server_not_connected", "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!json.client_email || !json.private_key) {
    throw codedError(
      "server_not_connected",
      "GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key."
    );
  }
  json.private_key = String(json.private_key).replace(/\\n/g, "\n");
  return json;
}

function delegatedUser() {
  return String(process.env.GOOGLE_DRIVE_DELEGATED_USER || "").trim();
}

function ocrEnabled() {
  const flag = String(process.env.GOOGLE_DRIVE_OCR || "").toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function signServiceJwt(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: account.client_email,
    scope: DRIVE_SCOPE,
    aud: account.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const subject = delegatedUser();
  if (subject) payload.sub = subject;
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const sig = signer.sign(account.private_key, "base64url");
  return `${unsigned}.${sig}`;
}

async function getAccessToken({ force = false } = {}) {
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const account = parseServiceAccount();
  if (!account) {
    throw codedError("server_not_connected", "Google Drive is not configured on this site.");
  }
  const assertion = signServiceJwt(account);
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
  } catch {
    throw codedError("server_unavailable", "Google Drive did not answer.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const msg = json.error_description || json.error || `token ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw codedError("needs_reauth", String(msg));
    }
    throw codedError("server_not_connected", String(msg));
  }
  const expiresIn = Number(json.expires_in) || 3600;
  tokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return tokenCache.token;
}

function resetTokenCache() {
  tokenCache = null;
}

function escapeDriveValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function splitLogical(query) {
  const parts = [];
  let buf = "";
  let quote = null;
  let escaped = false;
  const push = () => {
    const text = buf.trim();
    if (text) parts.push({ text });
    buf = "";
  };
  for (let i = 0; i < query.length; i += 1) {
    const ch = query[i];
    if (quote) {
      buf += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    const rest = query.slice(i);
    const and = rest.match(/^\s+and\s+/i);
    const or = rest.match(/^\s+or\s+/i);
    if (and) {
      push();
      parts.push({ op: "and" });
      i += and[0].length - 1;
      continue;
    }
    if (or) {
      push();
      parts.push({ op: "or" });
      i += or[0].length - 1;
      continue;
    }
    buf += ch;
  }
  push();
  return parts;
}

function takeQuoted(s, start) {
  const q = s[start];
  if (q !== "'" && q !== '"') return null;
  let out = "";
  for (let i = start + 1; i < s.length; i += 1) {
    if (s[i] === "\\" && i + 1 < s.length) {
      out += s[i + 1];
      i += 1;
      continue;
    }
    if (s[i] === q) return { value: out, end: i + 1 };
    out += s[i];
  }
  return null;
}

function mapClause(text) {
  const t = String(text || "").trim();
  const field = t.match(/^(parentId|title|mimeType)\s+/i);
  if (!field) return t;
  const rest = t.slice(field[0].length);
  const opMatch = rest.match(/^(contains|=|!=|<>)\s*/i);
  if (!opMatch) return t;
  const quoted = takeQuoted(rest, opMatch[0].length);
  if (!quoted || quoted.end !== rest.length) return t;
  const fieldName = field[1].toLowerCase();
  const op = opMatch[1].toLowerCase();
  const value = quoted.value;
  if (fieldName === "parentid" && op === "=") {
    return `'${escapeDriveValue(value)}' in parents`;
  }
  if (fieldName === "title" && op === "contains") {
    return `name contains '${escapeDriveValue(value)}'`;
  }
  if (fieldName === "title" && op === "=") {
    return `name = '${escapeDriveValue(value)}'`;
  }
  if (fieldName === "mimetype") {
    const driveOp = op === "<>" ? "!=" : op;
    return `mimeType ${driveOp} '${escapeDriveValue(value)}'`;
  }
  return t;
}

function translateDriveQuery(query) {
  const raw = String(query || "").trim();
  if (!raw) return "trashed = false";
  const parts = splitLogical(raw);
  const mapped = parts.map((p) => (p.op ? p.op : mapClause(p.text))).filter(Boolean);
  const driveQ = mapped.join(" ") || "trashed = false";
  if (/\btrashed\b/i.test(driveQ)) return driveQ;
  return `(${driveQ}) and trashed = false`;
}

function viewUrlFor(file) {
  if (file.webViewLink) return file.webViewLink;
  if (!file.id) return "";
  if (file.mimeType === FOLDER_MIME) {
    return `https://drive.google.com/drive/folders/${file.id}`;
  }
  return `https://drive.google.com/file/d/${file.id}/view`;
}

function mapFile(file) {
  if (!file || !file.id) return null;
  return {
    id: file.id,
    title: file.name || file.title || "",
    mimeType: file.mimeType || "application/octet-stream",
    viewUrl: viewUrlFor(file),
    parentId: Array.isArray(file.parents) && file.parents[0] ? file.parents[0] : file.parentId || "",
    modifiedTime: file.modifiedTime || "",
  };
}

function mapDriveHttpError(status, json) {
  const msg =
    (json && json.error && (json.error.message || json.error.status)) ||
    (json && json.error_description) ||
    `Google Drive ${status}`;
  if (status === 401) return codedError("needs_reauth", String(msg));
  if (status === 403) return codedError("tool_error", String(msg));
  if (status === 404) {
    return codedError(
      "tool_error",
      "File not found or not shared with the service account. Share the HR Drive folders with the service account email."
    );
  }
  if (status === 400) return codedError("bad_request", String(msg));
  if (status >= 500) return codedError("upstream_error", "Google Drive did not answer.");
  return codedError("tool_error", String(msg));
}

async function driveFetch(path, { method = "GET", query, body, headers, raw = false, token } = {}) {
  const access = token || (await getAccessToken());
  const qs = query ? `?${query}` : "";
  const url = path.startsWith("http") ? path : `${DRIVE_API}${path}${qs}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${access}`,
        ...(body && !headers?.["content-type"] ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
  } catch {
    throw codedError("server_unavailable", "Google Drive did not answer.");
  }
  if (raw) return res;
  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  if (!res.ok) throw mapDriveHttpError(res.status, json);
  return json;
}

async function searchFiles(args = {}) {
  const pageSize = Math.min(100, Math.max(1, Number(args.pageSize) || 20));
  const q = translateDriveQuery(args.query);
  const params = new URLSearchParams({
    q,
    pageSize: String(pageSize),
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    corpora: "allDrives",
    spaces: "drive",
  });
  if (args.pageToken) params.set("pageToken", String(args.pageToken));
  const json = await driveFetch("/files", { query: params.toString() });
  const files = (json.files || []).map(mapFile).filter(Boolean);
  const next = json.nextPageToken || "";
  return {
    payload: {
      files,
      nextPageToken: next,
      next_page_token: next,
    },
  };
}

function unescapePdfString(s) {
  return String(s)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, " ")
    .replace(/\\f/g, " ")
    .replace(/\\([()\\])/g, "$1");
}

function extractPdfText(buffer) {
  const src = Buffer.isBuffer(buffer) ? buffer.toString("latin1") : String(buffer || "");
  const chunks = [];
  const tj = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let m;
  while ((m = tj.exec(src))) {
    chunks.push(unescapePdfString(m[1]));
  }
  const arr = /\[([\s\S]*?)\]\s*TJ/g;
  while ((m = arr.exec(src))) {
    const inner = m[1];
    const parts = /\(((?:\\.|[^\\)])*)\)/g;
    let p;
    while ((p = parts.exec(inner))) {
      chunks.push(unescapePdfString(p[1]));
    }
  }
  return chunks.join(" ").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

function exportMimeFor(mimeType) {
  if (mimeType === "application/vnd.google-apps.document") return "text/plain";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "text/csv";
  if (mimeType === "application/vnd.google-apps.presentation") return "text/plain";
  return "";
}

function isTextMime(mimeType) {
  const m = String(mimeType || "");
  return (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/javascript" ||
    m.endsWith("+json") ||
    m.endsWith("+xml")
  );
}

function isImageMime(mimeType) {
  return /^image\/(jpeg|jpg|png|gif|webp)$/i.test(String(mimeType || ""));
}

async function downloadMedia(fileId, { exportMime } = {}) {
  const access = await getAccessToken();
  const path = exportMime
    ? `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  let res;
  try {
    res = await fetch(path, { headers: { authorization: `Bearer ${access}` } });
  } catch {
    throw codedError("server_unavailable", "Google Drive did not answer.");
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw mapDriveHttpError(res.status, json);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_READ_BYTES) {
    throw codedError("bad_request", "The file is too large to read in this view.");
  }
  return buf;
}

async function ocrWithAnthropic(buffer, mimeType) {
  const key = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) return "";
  const { callAnthropic } = require("./anthropic");
  const b64 = buffer.toString("base64");
  const isPdf = mimeType === "application/pdf";
  const block = isPdf
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: b64 },
      }
    : {
        type: "image",
        source: { type: "base64", media_type: mimeType, data: b64 },
      };
  const result = await callAnthropic({
    messages: [
      {
        role: "user",
        content: [
          block,
          {
            type: "text",
            text:
              "Extract all readable text from this file. Return plain text only — no markdown, no commentary. If there is no readable text, return an empty string.",
          },
        ],
      },
    ],
    modelTier: "default",
  });
  return String(result.text || "").trim();
}

async function readFileContent(args = {}) {
  const fileId = String(args.fileId || args.id || "").trim();
  if (!fileId) throw codedError("bad_request", "fileId is required");
  const meta = await driveFetch(`/files/${encodeURIComponent(fileId)}`, {
    query: new URLSearchParams({
      fields: FILE_FIELDS,
      supportsAllDrives: "true",
    }).toString(),
  });
  if (meta.mimeType === FOLDER_MIME) {
    throw codedError("bad_request", "That id is a folder, not a file.");
  }
  let text = "";
  const exportMime = exportMimeFor(meta.mimeType);
  if (exportMime) {
    text = (await downloadMedia(fileId, { exportMime })).toString("utf8");
  } else {
    const buf = await downloadMedia(fileId);
    if (isTextMime(meta.mimeType) || meta.mimeType === "application/javascript") {
      text = buf.toString("utf8");
    } else if (meta.mimeType === "application/pdf") {
      text = extractPdfText(buf);
      if (!text && ocrEnabled() && buf.length <= 5 * 1024 * 1024) {
        try {
          text = await ocrWithAnthropic(buf, "application/pdf");
        } catch {
          text = "";
        }
      }
    } else if (isImageMime(meta.mimeType) && ocrEnabled() && buf.length <= 5 * 1024 * 1024) {
      try {
        text = await ocrWithAnthropic(buf, meta.mimeType);
      } catch {
        text = "";
      }
    }
  }
  const payload = { text, content: text, fileContent: text, title: meta.name || "", mimeType: meta.mimeType };
  return { payload };
}

function decodeBase64(data) {
  const clean = String(data || "").replace(/\s/g, "");
  if (!clean) return Buffer.alloc(0);
  return Buffer.from(clean, "base64");
}

function base64DecodedLength(data) {
  const s = String(data || "").replace(/\s/g, "");
  if (!s) return 0;
  let pad = 0;
  if (s.endsWith("==")) pad = 2;
  else if (s.endsWith("=")) pad = 1;
  return Math.floor((s.length * 3) / 4) - pad;
}

function metadataBody({ title, parentId, contentMimeType }) {
  const body = {
    name: String(title || "untitled").trim() || "untitled",
    mimeType: contentMimeType || "application/octet-stream",
  };
  if (parentId) body.parents = [String(parentId)];
  return body;
}

async function createFolder(args) {
  const json = await driveFetch("/files", {
    method: "POST",
    query: "supportsAllDrives=true&fields=" + encodeURIComponent(FILE_FIELDS),
    body: metadataBody({
      title: args.title,
      parentId: args.parentId,
      contentMimeType: FOLDER_MIME,
    }),
  });
  const mapped = mapFile(json);
  if (!mapped || !mapped.id) {
    throw codedError("tool_error", "Drive did not return the new folder");
  }
  if (!mapped.viewUrl) {
    mapped.viewUrl = `https://drive.google.com/drive/folders/${mapped.id}`;
  }
  return { payload: mapped };
}

async function createFileOneshoot(args) {
  const mime = args.contentMimeType || "application/octet-stream";
  const bytes = decodeBase64(args.base64Content);
  const boundary = `hr_${crypto.randomBytes(12).toString("hex")}`;
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadataBody({ title: args.title, parentId: args.parentId, contentMimeType: mime }))}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mime}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(head, "utf8"), bytes, Buffer.from(tail, "utf8")]);
  const access = await getAccessToken();
  let res;
  try {
    res = await fetch(
      `${DRIVE_UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
  } catch {
    throw codedError("server_unavailable", "Google Drive did not answer.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw mapDriveHttpError(res.status, json);
  const mapped = mapFile(json);
  if (!mapped || !mapped.viewUrl) {
    throw codedError("tool_error", "Drive did not return a link for the file");
  }
  return { payload: mapped };
}

function sealUpload(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function unsealUpload(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !secret) {
    throw codedError("bad_request", "Invalid upload session");
  }
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw codedError("bad_request", "Invalid upload session");
  }
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw codedError("bad_request", "Invalid upload session");
  }
}

async function createFileInit(args, secret) {
  const mime = args.contentMimeType || "application/octet-stream";
  const size = Number(args.size);
  if (!Number.isFinite(size) || size < 0) {
    throw codedError("bad_request", "size is required for a resumable upload");
  }
  const access = await getAccessToken();
  let res;
  try {
    res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=resumable&supportsAllDrives=true`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime,
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify(metadataBody({ title: args.title, parentId: args.parentId, contentMimeType: mime })),
    });
  } catch {
    throw codedError("server_unavailable", "Google Drive did not answer.");
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw mapDriveHttpError(res.status, json);
  }
  const uri = res.headers.get("location") || res.headers.get("Location");
  if (!uri) throw codedError("upstream_error", "Drive did not start the upload.");
  return {
    uploadToken: sealUpload({ uri, size, sent: 0 }, secret),
    ok: true,
  };
}

async function createFileChunk(args, secret) {
  const session = unsealUpload(args.uploadToken, secret);
  const bytes = decodeBase64(args.data);
  const start = Number(session.sent) || 0;
  const end = start + bytes.length - 1;
  const size = Number(session.size);
  const last = args.last === true || end >= size - 1;
  const access = await getAccessToken();
  let res;
  try {
    res = await fetch(session.uri, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${access}`,
        "content-length": String(bytes.length),
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-type": "application/octet-stream",
      },
      body: bytes,
    });
  } catch {
    throw codedError("server_unavailable", "Google Drive did not answer.");
  }
  if (res.status === 308) {
    return {
      ok: true,
      uploadToken: sealUpload({ ...session, sent: end + 1 }, secret),
    };
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw mapDriveHttpError(res.status, json);
  if (!last && res.status !== 200) {
    return {
      ok: true,
      uploadToken: sealUpload({ ...session, sent: end + 1 }, secret),
    };
  }
  const mapped = mapFile(json);
  if (!mapped || !mapped.viewUrl) {
    throw codedError("tool_error", "Drive did not return a link for the file");
  }
  return { payload: mapped };
}

async function createFile(args = {}) {
  const mime = args.contentMimeType || "application/octet-stream";
  if (mime === FOLDER_MIME) return createFolder(args);
  if (!args.base64Content) {
    throw codedError("bad_request", "base64Content is required");
  }
  return createFileOneshoot(args);
}

module.exports = {
  FOLDER_MIME,
  MAX_READ_BYTES,
  base64DecodedLength,
  createFile,
  createFileChunk,
  createFileInit,
  delegatedUser,
  extractPdfText,
  getAccessToken,
  mapFile,
  mapDriveHttpError,
  ocrEnabled,
  parseServiceAccount,
  readFileContent,
  resetTokenCache,
  searchFiles,
  translateDriveQuery,
  viewUrlFor,
};
