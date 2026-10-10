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
 * Who may open the Finance artifact (corcondev-finance).
 * Matches the company portal: admin role, or department finance.
 * Roles on the portal are staff | dept_lead | hr | admin.
 */
function canAccessFinance(profile) {
  if (!profile || typeof profile !== "object") return false;
  const role = normalize(profile.role);
  const department = normalize(profile.department);
  return role === "admin" || role === "finance" || department === "finance";
}

function deniedMessage() {
  return "This account does not have Finance access. Ask an administrator.";
}

module.exports = { canAccessFinance, deniedMessage, envFlag, normalize };
