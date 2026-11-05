"use strict";

/**
 * Who may approve a Motorpool VRF, or a liquidation variance.
 *
 * Edit DEFAULT_APPROVERS, or set MOTORPOOL_APPROVER_NAMES on the function.
 * Env format, one person per semicolon. Aliases follow "=" and are separated by "|":
 *   Jeffrey James M. Corro=Jeffrey|Jeffrey Corro;Carmel
 * A name with no "=" matches only that spelling.
 *
 * Carmel's canonical name is "Carmel". No motorpool approver list in this
 * repo spells a surname for her. HR has an employee "Luzano, Carmel A."
 * who is not on an approver list — do not treat that as the approver name
 * until Jeffrey confirms it.
 */

const DEFAULT_APPROVERS = [
  {
    name: "Jeffrey James M. Corro",
    aliases: ["Jeffrey", "Jeffrey Corro", "Jeffrey James Corro"],
  },
  {
    name: "Carmel",
    aliases: [],
  },
];

function normApproverName(s) {
  return String(s == null ? "" : s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseApproverEnv(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const people = [];
  text.split(";").forEach(function (part) {
    const bit = String(part || "").trim();
    if (!bit) return;
    const eq = bit.indexOf("=");
    const name = (eq < 0 ? bit : bit.slice(0, eq)).trim();
    if (!name) return;
    const aliases =
      eq < 0
        ? []
        : bit
            .slice(eq + 1)
            .split("|")
            .map(function (a) {
              return String(a || "").trim();
            })
            .filter(Boolean);
    people.push({ name: name, aliases: aliases });
  });
  return people.length ? people : null;
}

function approverRoster(envValue) {
  const raw =
    envValue != null
      ? envValue
      : typeof process !== "undefined" && process.env
        ? process.env.MOTORPOOL_APPROVER_NAMES
        : "";
  const fromEnv = parseApproverEnv(raw);
  if (fromEnv) return fromEnv;
  return DEFAULT_APPROVERS.map(function (p) {
    return { name: p.name, aliases: (p.aliases || []).slice() };
  });
}

function approverAllowedText(roster) {
  return (roster || [])
    .map(function (p) {
      return p.name;
    })
    .join(" or ");
}

/**
 * Map a typed or API name to the canonical approver.
 * Never accepts a bare "api".
 */
function resolveApprover(input, roster) {
  const list = roster || approverRoster();
  const allowed = approverAllowedText(list);
  const raw = String(input == null ? "" : input).trim();
  if (!raw) {
    return {
      ok: false,
      code: "approver_required",
      error:
        "Name the approver in approvedBy. Approval must be " +
        allowed +
        '. A bare "api" is not an approver.',
    };
  }
  if (normApproverName(raw) === "api") {
    return {
      ok: false,
      code: "approver_not_allowed",
      error:
        'approvedBy cannot be "api". Pass the real approver in approvedBy: ' + allowed + ".",
    };
  }
  const key = normApproverName(raw);
  for (let i = 0; i < list.length; i++) {
    const person = list[i];
    const names = [person.name].concat(person.aliases || []);
    for (let j = 0; j < names.length; j++) {
      if (normApproverName(names[j]) === key) return { ok: true, name: person.name };
    }
  }
  return {
    ok: false,
    code: "approver_not_allowed",
    error: '"' + raw + '" cannot approve. Approval must be ' + allowed + ".",
  };
}

var MotorpoolApprovers = {
  DEFAULT_APPROVERS: DEFAULT_APPROVERS,
  approverRoster: approverRoster,
  resolveApprover: resolveApprover,
  parseApproverEnv: parseApproverEnv,
  normApproverName: normApproverName,
};

var approverRoot = typeof globalThis !== "undefined" ? globalThis : this;
approverRoot.MotorpoolApprovers = MotorpoolApprovers;
if (typeof module === "object" && module.exports) module.exports = MotorpoolApprovers;
