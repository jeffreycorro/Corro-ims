"use strict";

/* OT requests are one row per request. A save used to replace that row
   outright, so a copy that had lost its file (or never received the other
   files) erased what was already stored. This union keeps every file and
   refuses a blank shell. It does not delete rows. */

function isEphemeralUrl(url) {
  return /^blob:/i.test(String(url || "").trim());
}

function durableDriveUrl(url) {
  const s = String(url || "").trim();
  if (!s || isEphemeralUrl(s)) return "";
  const file = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/.exec(s);
  if (file) return "https://drive.google.com/file/d/" + file[1] + "/view";
  const folder = /drive\.google\.com\/(?:drive\/)?folders\/([a-zA-Z0-9_-]+)/.exec(s);
  if (folder) return "https://drive.google.com/drive/folders/" + folder[1];
  const id = /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(s);
  if (id && /drive\.google\.com|docs\.google\.com/.test(s))
    return "https://drive.google.com/file/d/" + id[1] + "/view";
  return s;
}

function otFileList(req) {
  const out = [];
  const seen = new Set();
  function add(url, title) {
    const raw = String(url || "").trim();
    if (!raw || isEphemeralUrl(raw)) return;
    const drive = /^data:/i.test(raw) ? raw : durableDriveUrl(raw);
    if (!drive || seen.has(drive)) return;
    seen.add(drive);
    out.push({ url: drive, title: String(title || "").trim() });
  }
  if (req && Array.isArray(req.files)) {
    req.files.forEach((f) => add(f && f.url, f && (f.title || f.name)));
  }
  add(req && req.formUrl, req && req.formTitle);
  add(req && req.link, req && req.formTitle);
  return out;
}

function stripClientFlags(req) {
  if (!req || typeof req !== "object") return req;
  const next = Object.assign({}, req);
  delete next._otShared;
  delete next._otPending;
  if (Array.isArray(req.empIds)) next.empIds = req.empIds.slice();
  if (Array.isArray(req.files)) next.files = req.files.map((f) => Object.assign({}, f));
  return next;
}

function blankOtShell(req) {
  if (!req || typeof req !== "object") return true;
  return (
    !String(req.from || "").trim() &&
    !String(req.status || "").trim() &&
    otFileList(req).length === 0
  );
}

function mergeStoredOtRequest(stored, incoming) {
  if (!incoming || typeof incoming !== "object") return stored || incoming;
  if (!stored || typeof stored !== "object") return stripClientFlags(incoming);
  const next = stripClientFlags(Object.assign({}, stored, incoming));
  const files = otFileList(stored).concat(otFileList(incoming));
  const list = otFileList({ files: files });
  if (list.length) {
    next.files = list.map((f) => ({ url: f.url, title: f.title || "" }));
    const primary =
      [...list].reverse().find((f) => f.url && !/^data:/i.test(f.url)) || list[list.length - 1];
    next.formUrl = primary.url;
    next.formTitle = primary.title || next.formTitle || stored.formTitle || "";
  }
  if (blankOtShell(incoming)) {
    ["from", "to", "site", "reason", "status", "formTitle"].forEach((k) => {
      if (!String(next[k] || "").trim() && String(stored[k] || "").trim()) next[k] = stored[k];
    });
    if ((!next.empIds || !next.empIds.length) && (stored.empIds || []).length)
      next.empIds = stored.empIds.slice();
    if (stored.wholeSite && !next.wholeSite && !(next.empIds || []).length) next.wholeSite = true;
    if (
      (next.hoursEach == null || next.hoursEach === "") &&
      stored.hoursEach != null &&
      stored.hoursEach !== ""
    )
      next.hoursEach = stored.hoursEach;
  }
  delete next._otShared;
  delete next._otPending;
  return next;
}

module.exports = {
  isEphemeralUrl,
  durableDriveUrl,
  otFileList,
  blankOtShell,
  mergeStoredOtRequest,
};
