"use strict";

const {
  configuredMethods,
  gatePassword,
  gateRequired,
  json,
  readSession,
  safeEqual,
  sessionCookie,
  signSession,
  supabaseAuthEnabled,
} = require("../lib/session");
const { getProfile, verifySupabaseJwt, verifySupabasePassword } = require("../lib/supabase");
const { canAccessHr, deniedMessage } = require("../lib/hr-access");
const { formatManilaIso } = require("../lib/manila");
const { capabilities } = require("../lib/capabilities");

const loginAttempts = new Map();

function clientIp(event) {
  const h = event.headers || {};
  const forwarded = h["x-forwarded-for"] || h["X-Forwarded-For"] || "";
  return String(forwarded).split(",")[0].trim() || "unknown";
}

function rateLimitLogin(event) {
  const ip = clientIp(event);
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const rec = loginAttempts.get(ip) || { count: 0, start: now };
  if (now - rec.start > windowMs) {
    rec.count = 0;
    rec.start = now;
  }
  rec.count += 1;
  loginAttempts.set(ip, rec);
  if (rec.count > 8) {
    const err = new Error("Too many login attempts. Try again later.");
    err.statusCode = 429;
    throw err;
  }
}

function methodsPayload() {
  return {
    methods: configuredMethods(),
    gateRequired: gateRequired() && Boolean(gatePassword()),
    timezone: "Asia/Manila",
    serverTime: formatManilaIso(),
    capabilities: capabilities(),
  };
}

function sessionPublicFields(session) {
  if (!session) {
    return { sub: null, method: null, email: null, role: null, department: null };
  }
  return {
    sub: session.sub || null,
    method: session.method || null,
    email: session.email || null,
    role: session.role || null,
    department: session.department || null,
  };
}

function statusBody(event) {
  const session = readSession(event);
  return {
    authenticated: Boolean(session),
    ...sessionPublicFields(session),
    ...methodsPayload(),
  };
}

async function sessionFromSupabaseUser(user, accessToken) {
  if (!user || !user.id) return null;
  const profile = await getProfile(user.id, accessToken);
  if (!canAccessHr(profile)) {
    const err = new Error(deniedMessage());
    err.statusCode = 403;
    throw err;
  }
  return {
    sub: user.id,
    method: "supabase",
    email: user.email || (profile && profile.email) || null,
    role: profile.role,
    department: profile.department,
    name: profile.full_name || null,
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: { "cache-control": "no-store" }, body: "" };
    }

    if (event.httpMethod === "GET") {
      return json(200, statusBody(event));
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const action = body.action || "status";

    if (action === "status") {
      return json(200, statusBody(event));
    }

    if (action === "logout") {
      return json(
        200,
        { authenticated: false, ...methodsPayload() },
        { "set-cookie": sessionCookie("", event, { clear: true }) }
      );
    }

    if (action !== "login") {
      return json(400, { error: "Unknown action" });
    }

    const methods = configuredMethods();
    if (methods.length === 0) {
      return json(503, {
        error:
          "HR login is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on this Netlify site (same project as the company portal).",
      });
    }

    rateLimitLogin(event);

    let sessionPayload = null;

    if (supabaseAuthEnabled()) {
      if (body.email && body.password) {
        const token = await verifySupabasePassword(body.email, body.password);
        sessionPayload = await sessionFromSupabaseUser(token.user, token.access_token);
      } else if (body.access_token) {
        const user = await verifySupabaseJwt(body.access_token);
        sessionPayload = await sessionFromSupabaseUser(user, body.access_token);
      }
    }

    if (!sessionPayload && gatePassword() && body.password != null && !body.email && !body.access_token) {
      if (safeEqual(body.password, gatePassword())) {
        sessionPayload = { sub: "gate", method: "password" };
      }
    }

    if (!sessionPayload) {
      return json(401, { error: "Invalid credentials", ...methodsPayload() });
    }

    const token = signSession(sessionPayload);
    return json(
      200,
      {
        authenticated: true,
        ...sessionPublicFields(sessionPayload),
        ...methodsPayload(),
      },
      { "set-cookie": sessionCookie(token, event) }
    );
  } catch (err) {
    const status = err.statusCode || 500;
    return json(status, { error: err.message || "Auth error", ...methodsPayload() });
  }
};
