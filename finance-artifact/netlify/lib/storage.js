"use strict";

const { serviceRole, supabaseUrl } = require("./supabase");

const BUCKET = "finance-uploads";
const FILE_SIZE_LIMIT = 52428800;

function requireStorage() {
  const url = supabaseUrl();
  const key = serviceRole();
  if (!url || !key) {
    const err = new Error("Supabase Storage is not configured on this site.");
    err.statusCode = 503;
    err.code = "server_not_connected";
    throw err;
  }
  return { url, key };
}

async function storageFetch(method, path, body, contentType) {
  const { url, key } = requireStorage();
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  if (!(body instanceof Uint8Array) && !Buffer.isBuffer(body)) {
    headers["content-type"] = "application/json";
    headers.accept = "application/json";
  } else if (contentType) headers["content-type"] = contentType;
  const res = await fetch(`${url}/storage/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : Buffer.isBuffer(body) || body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { res, json };
}

function alreadyExists(status, json) {
  if (status === 409) return true;
  const msg = json && (json.message || json.error || json.raw || "");
  return /already exists/i.test(String(msg));
}

async function ensureBucket() {
  const { res, json } = await storageFetch("POST", "/bucket", {
    id: BUCKET,
    name: BUCKET,
    public: false,
    file_size_limit: FILE_SIZE_LIMIT,
  });
  if (res.ok || alreadyExists(res.status, json)) return { id: BUCKET, public: false };
  const err = new Error((json && (json.message || json.error)) || "Could not open the finance uploads bucket.");
  err.statusCode = 502;
  throw err;
}

function encodeObjectPath(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function putObject(path, bytes, contentType) {
  await ensureBucket();
  const clean = String(path || "").replace(/^\/+/, "");
  const { res, json } = await storageFetch(
    "POST",
    `/object/${BUCKET}/${encodeObjectPath(clean)}`,
    Buffer.from(bytes),
    contentType || "application/octet-stream"
  );
  if (!res.ok && !alreadyExists(res.status, json)) {
    const err = new Error((json && (json.message || json.error)) || "Upload failed.");
    err.statusCode = 502;
    throw err;
  }
  return { path: clean };
}

async function signDownload(path, expiresIn) {
  const clean = String(path || "").replace(/^\/+/, "");
  const seconds = Number(expiresIn) > 0 ? Math.floor(Number(expiresIn)) : 120;
  const { res, json } = await storageFetch("POST", `/object/sign/${BUCKET}/${encodeObjectPath(clean)}`, { expiresIn: seconds });
  if (!res.ok) {
    const err = new Error((json && (json.message || json.error)) || "Could not sign that file.");
    err.statusCode = 502;
    throw err;
  }
  const raw = (json && (json.signedUrl || json.signedURL || json.url)) || "";
  const signedUrl = /^https?:\/\//i.test(raw) ? raw : `${supabaseUrl()}/storage/v1${raw.startsWith("/") ? "" : "/"}${raw}`;
  return { signedUrl, path: clean, expiresIn: seconds };
}

module.exports = { BUCKET, FILE_SIZE_LIMIT, ensureBucket, putObject, signDownload };
