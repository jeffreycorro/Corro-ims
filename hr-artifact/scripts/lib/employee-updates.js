"use strict";

/**
 * Status-only / deduction patches for HR employee docs.
 * Never deletes a row. Match on empNo (string), including duplicates.
 */

function normEmpNo(value) {
  return String(value == null ? "" : value).trim();
}

function rowData(row) {
  return row && row.data && typeof row.data === "object" ? row.data : {};
}

function rowEmpNo(row) {
  const data = rowData(row);
  return normEmpNo(data.empNo != null ? data.empNo : data.emp_no);
}

function matchRows(rows, empNo) {
  const want = normEmpNo(empNo);
  if (!want) return [];
  return (rows || []).filter((row) => rowEmpNo(row) === want);
}

function uniqueByEmpNo(records) {
  const seen = new Map();
  for (const rec of records || []) {
    const no = normEmpNo(rec && rec.empNo);
    if (!no) continue;
    seen.set(no, rec);
  }
  return [...seen.values()];
}

function applySeparatedPatch(data, rec) {
  const next = { ...(data && typeof data === "object" ? data : {}) };
  next.status = "Separated";
  if (rec && rec.separatedOn) next.separatedOn = rec.separatedOn;
  if (rec && rec.separationReason) next.separationReason = rec.separationReason;
  return next;
}

function applyDedPatch(data, ded) {
  const next = { ...(data && typeof data === "object" ? data : {}) };
  const src = ded && typeof ded === "object" ? ded : {};
  next.ded = {
    sss: Number(src.sss),
    phic: Number(src.phic),
    hdmf: Number(src.hdmf),
  };
  return next;
}

function changedFields(before, after) {
  const fields = {};
  if ((before && before.status) !== (after && after.status)) fields.status = after.status;
  if ((before && before.separatedOn) !== (after && after.separatedOn)) {
    fields.separatedOn = after.separatedOn;
  }
  if ((before && before.separationReason) !== (after && after.separationReason)) {
    fields.separationReason = after.separationReason;
  }
  if (JSON.stringify((before && before.ded) || null) !== JSON.stringify((after && after.ded) || null)) {
    fields.ded = after.ded;
  }
  return fields;
}

function planUpdates(rows, roster, contributions) {
  const byId = new Map();

  function touch(row) {
    if (!byId.has(row.id)) {
      const data = rowData(row);
      byId.set(row.id, {
        id: row.id,
        empNo: rowEmpNo(row),
        name: data.name || "",
        before: data,
        after: { ...data },
        actions: [],
      });
    }
    return byId.get(row.id);
  }

  const missingSeparated = [];
  const missingContrib = [];
  let separatedRowHits = 0;
  let contribRowHits = 0;

  for (const rec of uniqueByEmpNo(roster)) {
    const matches = matchRows(rows, rec.empNo);
    if (!matches.length) {
      missingSeparated.push({ empNo: rec.empNo, name: rec.name || "" });
      continue;
    }
    separatedRowHits += matches.length;
    for (const row of matches) {
      const item = touch(row);
      item.after = applySeparatedPatch(item.after, rec);
      item.actions.push("separated");
    }
  }

  for (const rec of uniqueByEmpNo(contributions)) {
    const matches = matchRows(rows, rec.empNo);
    if (!matches.length) {
      missingContrib.push({ empNo: rec.empNo, name: rec.name || "" });
      continue;
    }
    contribRowHits += matches.length;
    for (const row of matches) {
      const item = touch(row);
      item.after = applyDedPatch(item.after, rec.ded);
      item.actions.push("ded");
    }
  }

  const updates = [...byId.values()]
    .map((item) => ({
      ...item,
      fields: changedFields(item.before, item.after),
    }))
    .filter((item) => Object.keys(item.fields).length > 0);

  return {
    updates,
    missingSeparated,
    missingContrib,
    separatedRowHits,
    contribRowHits,
    rosterListed: (roster || []).length,
    rosterUnique: uniqueByEmpNo(roster).length,
    contribListed: (contributions || []).length,
  };
}

module.exports = {
  applyDedPatch,
  applySeparatedPatch,
  changedFields,
  matchRows,
  normEmpNo,
  planUpdates,
  rowEmpNo,
  uniqueByEmpNo,
};
