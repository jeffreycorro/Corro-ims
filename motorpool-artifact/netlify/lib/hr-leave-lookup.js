"use strict";

/**
 * Read-only HR leave lookup for Motorpool Ask the log.
 * Queries the shared Supabase `docs` table (HR artifact), never motorpool_docs.
 * Yard-only logins are refused; admin / HR may see type, dates, status, reason.
 */

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function str(value) {
  return value == null ? "" : String(value).trim();
}

function canReadHrLeaves(session) {
  if (!session || typeof session !== "object") return false;
  const role = normalize(session.role);
  const department = normalize(session.department);
  return role === "admin" || role === "hr" || department === "hr";
}

const SYSTEM_NOTES = /^(imported from the signed form|created from the manpower report)/i;

function leaveReason(rec) {
  if (!rec || typeof rec !== "object") return "";
  const direct = str(
    rec.reason || rec.reasonForLeave || rec.leaveReason || rec.reason_for_leave
  );
  if (direct) return direct;
  const notes = str(rec.notes);
  if (notes && !SYSTEM_NOTES.test(notes)) return notes;
  return "";
}

function serializeLeave(rec) {
  rec = rec && rec.data && typeof rec.data === "object" ? rec.data : rec || {};
  const reason = leaveReason(rec);
  return {
    no: str(rec.no),
    type: str(rec.type),
    from: str(rec.from),
    to: str(rec.to || rec.from),
    days: Number(rec.days) || 0,
    half: rec.half === true,
    status: str(rec.status),
    reason,
    reasonOnForm: Boolean(reason),
    filedOn: str(rec.filedOn),
    notes: str(rec.notes),
  };
}

function tokens(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function empMatch(emp, query) {
  const q = str(query);
  if (!emp || !q) return false;
  const qNo = q.replace(/\D/g, "");
  const eNo = str(emp.empNo).replace(/\D/g, "");
  if (qNo && eNo && (qNo === eNo || eNo.endsWith(qNo) || qNo.endsWith(eNo))) {
    return true;
  }
  const qt = tokens(q);
  const nt = tokens(emp.name);
  if (!qt.length || !nt.length) return false;
  return qt.every((t) => nt.some((n) => n === t || n.indexOf(t) === 0 || t.indexOf(n) === 0));
}

function leaveNoKey(value) {
  return str(value).replace(/\s+/g, "").toUpperCase();
}

function dataOf(row) {
  if (!row) return {};
  if (row.data && typeof row.data === "object") return row.data;
  return row;
}

async function listHrCollection(rest, collection) {
  const rows = await rest({
    method: "GET",
    path: "/rest/v1/docs",
    query:
      `collection=eq.${encodeURIComponent(collection)}` +
      "&select=collection,id,data,updated_at&order=id.asc",
  });
  return Array.isArray(rows) ? rows : [];
}

async function lookupLeaves(query, { rest } = {}) {
  const q = str(query);
  if (!q) {
    return { error: "Give a name, employee number, or leave number (LRF…)." };
  }
  if (typeof rest !== "function") {
    return { error: "Leave lookup is not configured on this site." };
  }

  let empRows;
  let leaveRows;
  try {
    [empRows, leaveRows] = await Promise.all([
      listHrCollection(rest, "employees"),
      listHrCollection(rest, "leaves"),
    ]);
  } catch (err) {
    return {
      available: false,
      error:
        "Could not read HR leave records from this Motorpool site. Ask the same question in the HR portal.",
      detail: err && err.message ? String(err.message) : "",
    };
  }

  const employees = empRows
    .map((row) => {
      const data = dataOf(row);
      return {
        id: str(data.id || row.id),
        empNo: str(data.empNo),
        name: str(data.name),
      };
    })
    .filter((e) => e.id);

  const qNo = leaveNoKey(q);
  const byLeaveNo = leaveRows
    .map((row) => ({ row, data: dataOf(row) }))
    .filter((x) => x.data.no && leaveNoKey(x.data.no) === qNo);

  let matches = employees.filter((e) => empMatch(e, q));
  if (byLeaveNo.length === 1 && !matches.length) {
    const emp = employees.find((e) => e.id === str(byLeaveNo[0].data.empId));
    if (emp) matches = [emp];
  }
  if (!matches.length && !byLeaveNo.length) {
    return {
      matches: [],
      note: "Nobody on the HR register matches that, and no leave form has that number.",
    };
  }
  if (matches.length > 1 && !byLeaveNo.length) {
    return {
      matches: matches.slice(0, 8).map((e) => ({ empNo: e.empNo, name: e.name })),
      note: "Several people match. Ask again with the employee number.",
    };
  }

  const emp = matches[0] || null;
  const leaves = leaveRows
    .map((row) => dataOf(row))
    .filter((data) => {
      if (emp && str(data.empId) === emp.id) return true;
      if (byLeaveNo.length && data.no && leaveNoKey(data.no) === qNo) return true;
      return false;
    })
    .sort((a, b) => str(b.from).localeCompare(str(a.from)))
    .slice(0, 30)
    .map(serializeLeave);

  return {
    available: true,
    employee: emp ? { empNo: emp.empNo, name: emp.name } : null,
    leave: leaves,
    note:
      "reason is the Reason for Leave field on the HR leave form. " +
      "If reason is blank, none was written on that record.",
  };
}

module.exports = {
  canReadHrLeaves,
  empMatch,
  leaveReason,
  lookupLeaves,
  serializeLeave,
};
