"use strict";

const {
  configuredMethods,
  gatePassword,
  json,
  readSession,
  safeEqual,
  sessionCookie,
  signSession,
  supabaseAuthEnabled,
} = require("../lib/session");
const { verifySupabaseJwt, verifySupabasePassword } = require("../lib/supabase");
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
    timezone: "Asia/Manila",
    serverTime: formatManilaIso(),
    capabilities: capabilities(),
  };
}

function statusBody(event) {
  const session = readSession(event);
  return {
    authenticated: Boolean(session),
    sub: session ? session.sub : null,
    method: session ? session.method : null,
    ...methodsPayload(),
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
          "No access gate configured. Set HR_GATE_SECRET (and optionally SUPABASE_AUTH_ENABLED) on this Netlify site.",
      });
    }

    rateLimitLogin(event);

    let sessionPayload = null;

    if (body.password != null && gatePassword()) {
      if (safeEqual(body.password, gatePassword())) {
        sessionPayload = { sub: "gate", method: "password" };
      }
    }

    if (!sessionPayload && supabaseAuthEnabled()) {
      if (body.email && body.password) {
        const token = await verifySupabasePassword(body.email, body.password);
        sessionPayload = {
          sub: (token.user && token.user.id) || "supabase",
          method: "supabase",
        };
      } else if (body.access_token) {
        const user = await verifySupabaseJwt(body.access_token);
        if (user && user.id) {
          sessionPayload = { sub: user.id, method: "supabase" };
        }
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
        sub: sessionPayload.sub,
        method: sessionPayload.method,
        ...methodsPayload(),
      },
      { "set-cookie": sessionCookie(token, event) }
    );
  } catch (err) {
    const status = err.statusCode || 500;
    return json(status, { error: err.message || "Auth error" });
  }
};
