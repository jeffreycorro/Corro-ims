"use strict";

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes" || value === "on") return true;
  if (value === "false" || value === "0" || value === "no" || value === "off") return false;
  return defaultValue;
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Who may open the full HR artifact (corcondev-hr).
 * Matches portal policy: admins, HR-role staff, or profiles assigned to department HR.
 * Other department logins can use the company portal but not this site.
 */
function canAccessHr(profile) {
  if (!profile || typeof profile !== "object") return false;
  const role = normalize(profile.role);
  const department = normalize(profile.department);
  return role === "admin" || role === "hr" || department === "hr";
}

function deniedMessage() {
  return "This account does not have HR access. Ask an administrator.";
}

module.exports = {
  canAccessHr,
  deniedMessage,
  envFlag,
  normalize,
};
