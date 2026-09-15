"use strict";

function supabaseUrl() {
  return (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
}

function serviceRole() {
  return (
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

function anonKey() {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  );
}

function requireServiceConfig() {
  const url = supabaseUrl();
  const key = serviceRole();
  if (!url || !key) {
    const err = new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set on this Netlify site"
    );
    err.statusCode = 500;
    throw err;
  }
  return { url, key };
}

async function rest({ method, path, query, body, prefer }) {
  const { url, key } = requireServiceConfig();
  const qs = query ? `?${query}` : "";
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  if (prefer) headers.prefer = prefer;
  const res = await fetch(`${url}${path}${qs}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
  if (!res.ok) {
    const err = new Error(
      (json && (json.message || json.error_description || json.error)) ||
        `Supabase ${res.status}`
    );
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.details = json;
    throw err;
  }
  return json;
}

async function getDoc(collection, id) {
  const rows = await rest({
    method: "GET",
    path: "/rest/v1/motorpool_docs",
    query: `collection=eq.${encodeURIComponent(collection)}&id=eq.${encodeURIComponent(id)}&select=collection,id,data,updated_at`,
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function setDoc(collection, id, data, { merge = false } = {}) {
  let payload = data;
  if (merge) {
    const existing = await getDoc(collection, id);
    payload = {
      ...(existing && existing.data && typeof existing.data === "object"
        ? existing.data
        : {}),
      ...data,
    };
  }
  const rows = await rest({
    method: "POST",
    path: "/rest/v1/motorpool_docs",
    query: "on_conflict=collection,id",
    prefer: "resolution=merge-duplicates,return=representation",
    body: {
      collection,
      id,
      data: payload,
    },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function deleteDoc(collection, id) {
  await rest({
    method: "DELETE",
    path: "/rest/v1/motorpool_docs",
    query: `collection=eq.${encodeURIComponent(collection)}&id=eq.${encodeURIComponent(id)}`,
  });
  return { ok: true };
}

async function listCollection(collection, filters) {
  const { listFilterQuery, rowMatchesFilters } = require("./collections");
  const extra = listFilterQuery(filters);
  const rows = await rest({
    method: "GET",
    path: "/rest/v1/motorpool_docs",
    query: `collection=eq.${encodeURIComponent(collection)}&select=collection,id,data,updated_at&order=id.asc${extra}`,
  });
  const list = Array.isArray(rows) ? rows : [];
  return extra ? list.filter((row) => rowMatchesFilters(row, filters)) : list;
}

async function acquireLock(collection, id, holder, ttlSeconds) {
  const json = await rest({
    method: "POST",
    path: "/rest/v1/rpc/acquire_motorpool_doc_lock",
    body: {
      p_collection: collection,
      p_id: id,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds || 20,
    },
  });
  return json;
}

async function verifySupabasePassword(email, password) {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key) {
    const err = new Error("Supabase Auth is not configured");
    err.statusCode = 500;
    throw err;
  }
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: key,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.msg || "Invalid credentials");
    err.statusCode = 401;
    throw err;
  }
  return json;
}

async function verifySupabaseJwt(accessToken) {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key || !accessToken) return null;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: key,
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchProfileWithUserJwt(userId, accessToken) {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key || !userId || !accessToken) return null;
  const res = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,department,role`,
    {
      headers: {
        apikey: key,
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getProfile(userId, accessToken) {
  if (!userId) return null;
  try {
    const rows = await rest({
      method: "GET",
      path: "/rest/v1/profiles",
      query: `id=eq.${encodeURIComponent(userId)}&select=id,full_name,department,role`,
    });
    if (Array.isArray(rows) && rows[0]) return rows[0];
  } catch {
    // Service role may be missing in Auth-only local tests; fall back to the user JWT.
  }
  return fetchProfileWithUserJwt(userId, accessToken);
}

module.exports = {
  acquireLock,
  anonKey,
  deleteDoc,
  fetchProfileWithUserJwt,
  getDoc,
  getProfile,
  listCollection,
  rest,
  serviceRole,
  setDoc,
  supabaseUrl,
  verifySupabaseJwt,
  verifySupabasePassword,
};
