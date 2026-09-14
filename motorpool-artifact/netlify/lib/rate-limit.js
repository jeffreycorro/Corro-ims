"use strict";

const { codedError } = require("./coded-error");

function clientIp(event) {
  const h = event.headers || {};
  const forwarded = h["x-forwarded-for"] || h["X-Forwarded-For"] || "";
  return String(forwarded).split(",")[0].trim() || "unknown";
}

function createLimiter({ windowMs, max, message }) {
  const hits = new Map();
  return function check(event) {
    const key = clientIp(event);
    const now = Date.now();
    const rec = hits.get(key) || { count: 0, start: now };
    if (now - rec.start > windowMs) {
      rec.count = 0;
      rec.start = now;
    }
    rec.count += 1;
    hits.set(key, rec);
    if (rec.count > max) {
      throw codedError("rate_limited", message || "Too many requests. Try again in a moment.");
    }
  };
}

module.exports = {
  clientIp,
  createLimiter,
};
