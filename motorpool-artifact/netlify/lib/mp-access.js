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
 * Who may open the Motorpool artifact (corcondev-motorpool).
 * Matches portal department slugs in supabase/migrations and lib/departments.ts:
 * admin | technical | finance | procurement | motorpool | safety | site | hr
 * Roles: staff | dept_lead | hr | admin
 * There is no operations department or role. Allow admin role or department motorpool.
 */
function canAccessMotorpool(profile) {
  if (!profile || typeof profile !== "object") return false;
  const role = normalize(profile.role);
  const department = normalize(profile.department);
  return role === "admin" || department === "motorpool";
}

function deniedMessage() {
  return "This account does not have Motorpool access. Ask an administrator.";
}

module.exports = {
  canAccessMotorpool,
  deniedMessage,
  envFlag,
  normalize,
};
