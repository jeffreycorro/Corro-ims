"use strict";

const crypto = require("crypto");
const { envFlag } = require("./hr-access");

const COOKIE_NAME = "hr_session";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function gateSecret() {
  return process.env.HR_GATE_SECRET || "";
}

function sessionSecret() {
  const explicit = process.env.HR_SESSION_SECRET || "";
  if (explicit) return explicit;
  const role =
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (role) {
    return crypto.createHash("sha256").update(`hr-session:${role}`).digest("hex");
  }
  // Last resort for local tests / legacy sites. Do not Functions-scope
  // HR_GATE_SECRET on production — it is not a login password.
  return process.env.HR_GATE_SECRET || "";
}

function gateRequired() {
  return envFlag("HR_GATE_REQUIRED", false);
}

function gatePassword() {
  if (!gateRequired()) return "";
  return process.env.HR_GATE_PASSWORD || process.env.HR_GATE_SECRET || "";
}

function supabaseConfigured() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).trim();
  const anon = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();
  return Boolean(url && anon);
}

function supabaseAuthEnabled() {
  if (!supabaseConfigured()) return false;
  return envFlag("SUPABASE_AUTH_ENABLED", true);
}

function configuredMethods() {
  const methods = [];
  if (supabaseAuthEnabled()) methods.push("supabase");
  if (gatePassword()) methods.push("password");
  return methods;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length !== right.length) {
    if (left.length > 0) crypto.timingSafeEqual(left, left);
    return false;
  }
  if (left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function signSession(payload, secret = sessionSecret()) {
  if (!secret) {
    throw new Error("HR session signing secret is not configured");
  }
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      exp: payload.exp || Date.now() + MAX_AGE_MS,
    }),
    "utf8"
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifySession(token, secret = sessionSecret()) {
  if (!token || !secret) return null;
  const parts = String(token).split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return null;
  }
  return payload;
}

function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function readSession(event) {
  const headers = event.headers || {};
  const cookie = headers.cookie || headers.Cookie || "";
  const parsed = parseCookieHeader(cookie);
  return verifySession(parsed[COOKIE_NAME]);
}

function cookieSecure(event) {
  const proto = String(
    (event.headers && (event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"])) ||
      ""
  );
  return proto.split(",")[0].trim() === "https";
}

function sessionCookie(token, event, { clear = false } = {}) {
  const secure = cookieSecure(event) ? "; Secure" : "";
  if (clear) {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  }
  const maxAge = Math.floor(MAX_AGE_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function unauthorized(message = "Authentication required") {
  const err = new Error(message);
  err.statusCode = 401;
  return err;
}

function requireSession(event) {
  const session = readSession(event);
  if (!session) {
    throw unauthorized();
  }
  return session;
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_MS,
  configuredMethods,
  cookieSecure,
  gatePassword,
  gateRequired,
  gateSecret,
  json,
  parseCookieHeader,
  readSession,
  requireSession,
  safeEqual,
  sessionCookie,
  sessionSecret,
  signSession,
  supabaseAuthEnabled,
  supabaseConfigured,
  unauthorized,
  verifySession,
};
