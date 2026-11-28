"use strict";

const { supabaseUrl, serviceRole } = require("./supabase");
const { codedError } = require("./coded-error");

const BUCKET = "hr-uploads";
const FILE_SIZE_LIMIT = 52428800;

function requireStorage() {
  const url = supabaseUrl();
  const key = serviceRole();
  if (!url || !key) {
    throw codedError(
      "server_not_connected",
      "Supabase Storage is not configured on this site."
    );
  }
  return { url, key };
}

function storageMessage(json, status) {
  if (json && typeof json === "object") {
    const msg = json.message || json.error_description || json.error || json.raw;
    if (msg) return String(msg);
  }
  return `Supabase Storage ${status}`;
}

function alreadyExists(status, json) {
  if (status === 409) return true;
  return /already exists/i.test(storageMessage(json, status));
}

async function storageFetch(method, path, body) {
  const { url, key } = requireStorage();
  let res;
  try {
    res = await fetch(`${url}/storage/v1${path}`, {
      method,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw codedError("server_unavailable", "Supabase Storage did not answer.");
  }
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

function absoluteStorageUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const base = supabaseUrl().replace(/\/$/, "");
  if (value.startsWith("/storage/v1/")) return base + value;
  if (value.startsWith("storage/v1/")) return `${base}/${value}`;
  if (value.startsWith("/object/")) return `${base}/storage/v1${value}`;
  if (value.startsWith("object/")) return `${base}/storage/v1/${value}`;
  return `${base}${value.startsWith("/") ? "" : "/"}${value}`;
}

function signedField(json) {
  if (!json || typeof json !== "object") return "";
  return json.signedUrl || json.signedURL || json.url || "";
}

function encodeObjectPath(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function ensureBucket() {
  const { res, json } = await storageFetch("POST", "/bucket", {
    id: BUCKET,
    name: BUCKET,
    public: false,
    file_size_limit: FILE_SIZE_LIMIT,
  });
  if (res.ok || alreadyExists(res.status, json)) return { id: BUCKET };
  throw codedError("upstream_error", storageMessage(json, res.status));
}

async function signUpload(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  const { res, json } = await storageFetch(
    "POST",
    `/object/upload/sign/${BUCKET}/${encodeObjectPath(clean)}`,
    {}
  );
  if (!res.ok) throw codedError("upstream_error", storageMessage(json, res.status));
  let uploadUrl = absoluteStorageUrl(signedField(json));
  if (!uploadUrl && json && json.token) {
    uploadUrl = absoluteStorageUrl(
      `/object/upload/sign/${BUCKET}/${encodeObjectPath(clean)}?token=${encodeURIComponent(json.token)}`
    );
  }
  if (!uploadUrl) throw codedError("upstream_error", "Supabase did not return an upload URL.");
  return { uploadUrl, path: clean, token: (json && json.token) || "" };
}

async function signDownload(path, expiresIn) {
  const clean = String(path || "").replace(/^\/+/, "");
  const seconds = Number(expiresIn) > 0 ? Math.floor(Number(expiresIn)) : 120;
  const { res, json } = await storageFetch(
    "POST",
    `/object/sign/${BUCKET}/${encodeObjectPath(clean)}`,
    { expiresIn: seconds }
  );
  if (!res.ok) throw codedError("upstream_error", storageMessage(json, res.status));
  const signedUrl = absoluteStorageUrl(signedField(json));
  if (!signedUrl) throw codedError("upstream_error", "Supabase did not return a download URL.");
  return { signedUrl, path: clean, expiresIn: seconds };
}

async function putObject(path, bytes, contentType) {
  const clean = String(path || "").replace(/^\/+/, "");
  if (!clean) throw codedError("bad_request", "A file path is required.");
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (body.length > FILE_SIZE_LIMIT) throw codedError("bad_request", "That file is over 50 MB.");
  await ensureBucket();
  const { url, key } = requireStorage();
  let res;
  try {
    res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeObjectPath(clean)}`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": contentType || "application/octet-stream",
        "x-upsert": "true",
      },
      body,
    });
  } catch {
    throw codedError("server_unavailable", "Supabase Storage did not answer.");
  }
  if (!res.ok) {
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }
    throw codedError("upstream_error", storageMessage(json, res.status));
  }
  return { path: clean, size: body.length };
}

async function readObject(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  if (!clean || clean.length > 512 || clean.includes("..") || clean.includes("\\") || !/^[A-Za-z0-9._/-]+$/.test(clean)) {
    throw codedError("bad_request", "That file path is not allowed.");
  }
  const { url, key } = requireStorage();
  let res;
  try {
    res = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeObjectPath(clean)}`, {
      method: "GET",
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
  } catch {
    throw codedError("server_unavailable", "Supabase Storage did not answer.");
  }
  if (!res.ok) {
    const text = await res.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
    }
    throw codedError("upstream_error", storageMessage(json, res.status));
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const header = (res.headers.get("content-type") || "").split(";")[0].trim();
  let mime = header;
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
  else if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) mime = "image/png";
  else if (buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) mime = "application/pdf";
  return { bytes: new Uint8Array(buf), mime: mime || "application/octet-stream" };
}

module.exports = {
  BUCKET,
  FILE_SIZE_LIMIT,
  absoluteStorageUrl,
  alreadyExists,
  ensureBucket,
  putObject,
  readObject,
  signDownload,
  signUpload,
};
