"use strict";

/**
 * Lock decision mirrored by acquire_doc_lock in SQL.
 * Never returns acquired:true while another holder still owns an unexpired lock.
 */
function decideLock(existing, holder, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!holder || String(holder).trim() === "") {
    return { acquired: false, reason: "holder_required" };
  }
  if (!existing) {
    return { acquired: true, holder: String(holder).trim() };
  }
  const expMs = Date.parse(existing.expires_at || existing.expiresAt || 0);
  if (!Number.isFinite(expMs) || expMs <= nowMs) {
    return { acquired: true, holder: String(holder).trim() };
  }
  if (existing.holder === holder) {
    return { acquired: true, holder: String(holder).trim(), refreshed: true };
  }
  return {
    acquired: false,
    holder: existing.holder,
    expires_at: existing.expires_at || existing.expiresAt,
  };
}

module.exports = { decideLock };
