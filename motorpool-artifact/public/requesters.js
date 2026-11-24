"use strict";

/**
 * VRF requester roster.
 * The live list is the Supabase doc config/requesters (motorpool_docs),
 * read through the same /db path as master/* docs:
 *   { names: [{ name, empNo, status }], aliases: { raw: canonical } }
 * This file ships an empty roster. Do not put real names here.
 */

var EMPTY_ROSTER = { names: [], aliases: {} };
var STATUS = { active: "Active", separated: "Separated", external: "External" };

function cleanName(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function normKey(v) {
  return cleanName(v).toLowerCase();
}

function empNoValue(v) {
  if (v == null) return null;
  var s = cleanName(v);
  return s ? s : null;
}

function statusValue(v) {
  var key = cleanName(v).toLowerCase();
  return STATUS[key] || "Active";
}

function byName(a, b) {
  return String(a.name).localeCompare(String(b.name), "en", { sensitivity: "base" });
}

function normalizePerson(p) {
  if (!p) return null;
  if (typeof p === "string") p = { name: p };
  var name = cleanName(p.name);
  if (!name) return null;
  return { name: name, empNo: empNoValue(p.empNo), status: statusValue(p.status) };
}

function normalize(doc) {
  var names = [];
  var seen = {};
  var rawNames = doc && Array.isArray(doc.names) ? doc.names : [];
  rawNames.forEach(function (p) {
    var person = normalizePerson(p);
    if (!person) return;
    var key = normKey(person.name);
    if (seen[key]) return;
    seen[key] = 1;
    names.push(person);
  });
  names.sort(byName);
  var aliases = {};
  var rawAliases = doc && doc.aliases && typeof doc.aliases === "object" && !Array.isArray(doc.aliases) ? doc.aliases : {};
  Object.keys(rawAliases).forEach(function (k) {
    var target = cleanName(rawAliases[k]);
    var key = cleanName(k);
    if (!key || !target) return;
    aliases[key] = target;
  });
  return { names: names, aliases: aliases };
}

function lookupAlias(roster, key) {
  var aliases = roster.aliases || {};
  var keys = Object.keys(aliases);
  for (var i = 0; i < keys.length; i++) {
    if (normKey(keys[i]) === key) return cleanName(aliases[keys[i]]);
  }
  return "";
}

function findByKey(roster, key) {
  var names = roster.names || [];
  for (var i = 0; i < names.length; i++) {
    if (names[i] && normKey(names[i].name) === key) return names[i];
  }
  return null;
}

/** Case- and whitespace-insensitive alias and roster match. Unknown text stays trimmed. */
function canon(raw, roster) {
  var current = cleanName(raw);
  if (!current) return "";
  roster = normalize(roster);
  var seen = {};
  var hop;
  for (hop = 0; hop < 3; hop++) {
    var key = normKey(current);
    if (seen[key]) break;
    seen[key] = 1;
    var person = findByKey(roster, key);
    if (person) return person.name;
    var mapped = lookupAlias(roster, key);
    if (!mapped || normKey(mapped) === key) break;
    current = mapped;
  }
  return current;
}

function findPerson(raw, roster) {
  var name = canon(raw, roster);
  if (!name) return null;
  return findByKey(normalize(roster), normKey(name));
}

function label(person) {
  if (!person) return "";
  var name = cleanName(person.name);
  if (!name) return "";
  var emp = empNoValue(person.empNo);
  return emp ? name + " (" + emp + ")" : name;
}

/**
 * Active and External, A–Z. Separated people stay off a new VRF.
 * opts.keep puts that one person back so an old record can still show them.
 */
function choices(roster, opts) {
  opts = opts || {};
  var people = normalize(roster).names.filter(function (p) {
    return p.status !== "Separated";
  });
  var keepRaw = opts.keep != null ? opts.keep : "";
  var keepName = keepRaw ? canon(keepRaw, roster) : "";
  if (keepName && !people.some(function (p) { return normKey(p.name) === normKey(keepName); })) {
    var known = findPerson(keepName, roster);
    people.push(known || { name: keepName, empNo: null, status: "Active" });
    people.sort(byName);
  }
  return people;
}

function dedupeNames(raws, roster) {
  var seen = {};
  var out = [];
  (raws || []).forEach(function (raw) {
    var name = canon(raw, roster);
    if (!name) return;
    var key = normKey(name);
    if (seen[key]) return;
    seen[key] = 1;
    out.push(name);
  });
  out.sort(function (a, b) {
    return String(a).localeCompare(String(b), "en", { sensitivity: "base" });
  });
  return out;
}

function oneError(message, code) {
  var err = new Error(message);
  err.code = code;
  return err;
}

/** Exactly one requester. Option value is the canonical name, never a list. */
function storeOne(value, roster, opts) {
  opts = opts || {};
  if (Array.isArray(value)) throw oneError("Pick exactly one requester.", "one_requester");
  var text = String(value == null ? "" : value);
  if (/[;|\n]/.test(text)) {
    var parts = text.split(/[;|\n]/).map(cleanName).filter(Boolean);
    if (parts.length > 1) throw oneError("Pick exactly one requester.", "one_requester");
  }
  var raw = cleanName(text);
  if (!raw) return { requestedBy: "", requestedByEmpNo: null };
  var person = findPerson(raw, roster);
  if (person) return { requestedBy: person.name, requestedByEmpNo: person.empNo };
  var allow = opts.allow || [];
  var i;
  for (i = 0; i < allow.length; i++) {
    var kept = canon(allow[i], roster);
    if (kept && normKey(kept) === normKey(canon(raw, roster))) {
      return { requestedBy: kept, requestedByEmpNo: null };
    }
  }
  throw oneError("Pick a name from the roster.", "not_on_roster");
}

function matchSignedIn(signedIn, roster) {
  var person = findPerson(signedIn, roster);
  if (!person || person.status === "Separated") return null;
  return person;
}

function appendName(roster, person) {
  var next = normalize(roster);
  var p = normalizePerson(person);
  if (!p) throw oneError("Type the name as Surname, Given M.", "name_required");
  if (next.names.some(function (x) { return normKey(x.name) === normKey(p.name); })) {
    throw oneError("That name is already on the roster.", "duplicate");
  }
  next.names.push(p);
  next.names.sort(byName);
  return { names: next.names, aliases: next.aliases };
}

/**
 * Raw requester on a config/issued record or its sealed snapshot.
 * reserves/YYYY and these snapshots still store old spellings; display uses canon().
 */
function nameFromIssued(issued, vrfNo, reserveNo) {
  var nums = issued && issued.numbers && typeof issued.numbers === "object" ? issued.numbers : issued;
  if (!nums || typeof nums !== "object" || Array.isArray(nums)) return "";
  var no = cleanName(vrfNo);
  if (!no) return "";
  var want = cleanName(reserveNo);
  var keys = Object.keys(nums);
  var loose = "";
  var i, j;
  for (i = 0; i < keys.length; i++) {
    var row = nums[keys[i]];
    if (!row || typeof row !== "object") continue;
    var named = cleanName(row.no != null ? row.no : "");
    var keyNo = cleanName(String(keys[i]).split("@")[0]);
    if (named !== no && keyNo !== no) continue;
    var snap = row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
    var reserve = snap.reserve && typeof snap.reserve === "object" ? snap.reserve : {};
    var snapNo = cleanName(reserve.no != null ? reserve.no : "");
    var who = cleanName(reserve.requestedBy);
    if (!who && Array.isArray(snap.rows)) {
      for (j = 0; j < snap.rows.length; j++) {
        who = cleanName(snap.rows[j] && snap.rows[j].requestedBy);
        if (who) break;
      }
    }
    if (!who) who = cleanName(row.requestedBy);
    if (!who) continue;
    if (want && snapNo === want) return who;
    if (!want && (cleanName(keys[i]) === no || named === no)) return who;
    if (!loose) loose = who;
  }
  return loose;
}

var api = {
  EMPTY: EMPTY_ROSTER,
  appendName: appendName,
  canon: canon,
  choices: choices,
  dedupeNames: dedupeNames,
  empNoValue: empNoValue,
  findPerson: findPerson,
  label: label,
  matchSignedIn: matchSignedIn,
  nameFromIssued: nameFromIssued,
  normalize: normalize,
  storeOne: storeOne,
};

if (typeof module === "object" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.Requesters = api;
