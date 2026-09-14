"use strict";

const crypto = require("crypto");
const { envFlag } = require("./mp-access");

const COOKIE_NAME = "motorpool_session";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function gateSecret() {
  return process.env.MOTORPOOL_GATE_SECRET || "";
}

function sessionSecret() {
  const explicit =
    process.env.MOTORPOOL_SESSION_SECRET || process.env.MOTORPOOL_GATE_SECRET || "";
  if (explicit) return explicit;
  const role =
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (!role) return "";
  return crypto.createHash("sha256").update(`motorpool-session:${role}`).digest("hex");
}

function gateRequired() {
  return envFlag("MOTORPOOL_GATE_REQUIRED", false);
}

function gatePassword() {
  if (!gateRequired()) return "";
  return process.env.MOTORPOOL_GATE_PASSWORD || process.env.MOTORPOOL_GATE_SECRET || "";
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

function openYard() {
  return envFlag("MOTORPOOL_OPEN_YARD", false);
}

function configuredMethods() {
  const methods = [];
  if (supabaseAuthEnabled()) methods.push("supabase");
  if (gatePassword()) methods.push("password");
  return methods;
}

function gateOptional() {
  if (openYard()) return true;
  return configuredMethods().length === 0;
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
    throw new Error("Motorpool session signing secret is not configured");
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

const COOKIE_EXPIRES_PAST = "Thu, 01 Jan 1970 00:00:00 GMT";

function sessionCookie(token, event, { clear = false } = {}) {
  const secure = cookieSecure(event) ? "; Secure" : "";
  if (clear) {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=${COOKIE_EXPIRES_PAST}${secure}`;
  }
  const maxAge = Math.floor(MAX_AGE_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function clearSessionCookies() {
  const expired = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=${COOKIE_EXPIRES_PAST}`;
  return [expired, `${expired}; Secure`];
}

function json(statusCode, body, extraHeaders = {}) {
  const extras = { ...extraHeaders };
  const cookie = extras["set-cookie"];
  delete extras["set-cookie"];
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
    ...extras,
  };
  const result = {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
  if (cookie != null && cookie !== "") {
    const list = Array.isArray(cookie) ? cookie : [cookie];
    result.headers["set-cookie"] = list[list.length - 1];
    result.multiValueHeaders = { "Set-Cookie": list };
  }
  return result;
}

function unauthorized(message = "Authentication required") {
  const err = new Error(message);
  err.statusCode = 401;
  return err;
}

function requireSession(event) {
  if (gateOptional()) {
    return { sub: "open", method: "open" };
  }
  const session = readSession(event);
  if (!session) {
    throw unauthorized();
  }
  return session;
}

module.exports = {
  COOKIE_EXPIRES_PAST,
  COOKIE_NAME,
  MAX_AGE_MS,
  clearSessionCookies,
  configuredMethods,
  cookieSecure,
  gateOptional,
  gatePassword,
  gateRequired,
  gateSecret,
  json,
  openYard,
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
