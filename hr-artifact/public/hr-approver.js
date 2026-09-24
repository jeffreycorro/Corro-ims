/**
 * HR Approver queue for Jeffrey's final signature.
 * Loaded by claude-shim.js. Does not replace the evaluator step
 * (Catherine A. Largo / payrollBy on Leave and Cash Advance, HR issue on
 * employment contracts). After that step, the item is Evaluated — for
 * approval. Approve stamps the existing HR e-signature store (signatory /
 * president / Jeffrey) onto the employee-signed upload when one is on file,
 * and onto the portal form only when there is no upload.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.hrApprover = api;
  if (typeof window !== "undefined" && window) window.hrApprover = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        api.attach(typeof window !== "undefined" ? window : root);
      });
    } else {
      api.attach(typeof window !== "undefined" ? window : root);
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var FOR_APPROVAL = "For approval";
  var LABEL_WAITING = "Evaluated — for approval";
  var SIGNATORY_KEYS = ["signatory", "president", "ceo", "final", "management"];
  /* Fixed password for this tab. Motorpool's office gate compares a stored
     hash and keeps the unlock on the page object (S.office). A reload clears
     it. Motorpool has no separate lock-again control. */
  var APPROVER_PASSWORD = "032589";
  var unlocked = false;

  function isApproverUnlocked() {
    return unlocked;
  }

  function resetApproverLock() {
    unlocked = false;
  }

  function tryApproverPassword(value) {
    var val = str(value).trim();
    if (!val) return { ok: false, message: "Type a password first." };
    if (val !== APPROVER_PASSWORD) return { ok: false, message: "That password does not match. Try again." };
    unlocked = true;
    return { ok: true, message: "" };
  }

  function gateHtml() {
    return (
      '<div class="hr-appr-gate" style="max-width:440px;margin:28px auto">' +
      '<div class="card"><div class="card-b">' +
      '<h2 style="font-size:18px;margin:0 0 8px">Approver</h2>' +
      '<p style="color:var(--ink2);margin:0">Final approval sits behind this password so the rest of the HR screens stay open.</p>' +
      '<div class="f" style="margin-top:14px">' +
      '<label for="hr-appr-pass">Password</label>' +
      '<input id="hr-appr-pass" type="password" autocomplete="off" enterkeyhint="go">' +
      "</div>" +
      '<div id="hr-appr-pass-err" class="hint" style="color:var(--crit);margin-top:6px;min-height:1.2em"></div>' +
      '<button type="button" class="btn pri" id="hr-appr-unlock" data-hr-appr-unlock="1" style="margin-top:14px">Unlock</button>' +
      '<p class="hint" style="margin-top:16px">This keeps final approval off the other HR screens. It is not a security boundary — anyone you share the artifact link with can open the page, so share the link itself deliberately.</p>' +
      "</div></div></div>"
    );
  }

  function focusPass(host) {
    setTimeout(function () {
      try {
        var input = host.document && host.document.getElementById && host.document.getElementById("hr-appr-pass");
        if (input && input.focus) input.focus();
      } catch (e) {}
    }, 30);
  }

  function showPassError(host, message) {
    var err = host.document && host.document.getElementById && host.document.getElementById("hr-appr-pass-err");
    if (err) err.textContent = message || "";
  }

  function applyUnlock(host) {
    var input = host.document && host.document.getElementById && host.document.getElementById("hr-appr-pass");
    var result = tryApproverPassword(input ? input.value : "");
    if (!result.ok) {
      showPassError(host, result.message);
      return;
    }
    if (typeof host.render === "function") host.render();
  }

  function str(v) {
    return v == null ? "" : String(v);
  }

  function values(map) {
    if (!map || typeof map !== "object") return [];
    if (Array.isArray(map)) return map.filter(Boolean);
    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .filter(Boolean);
  }

  function esc(s) {
    return str(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isoNow(d) {
    d = d || new Date();
    var p = function (n) {
      return String(n).padStart(2, "0");
    };
    return (
      d.getFullYear() +
      "-" +
      p(d.getMonth() + 1) +
      "-" +
      p(d.getDate()) +
      "T" +
      p(d.getHours()) +
      ":" +
      p(d.getMinutes()) +
      ":" +
      p(d.getSeconds())
    );
  }

  function isoDay(d) {
    return isoNow(d).slice(0, 10);
  }

  function bindStore(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return {};
    if (host.S && (host.S.leaves || host.S.advances || host.S.docreg || host.S.employees || host.S.settings)) {
      return host.S;
    }
    if (host.__hrS) return host.__hrS;
    try {
      if (typeof document !== "undefined" && document.createElement) {
        var s = document.createElement("script");
        s.textContent = "window.__hrS=S;";
        (document.documentElement || document.head || document.body).appendChild(s);
        if (s.parentNode) s.parentNode.removeChild(s);
      }
    } catch (e) {}
    return host.__hrS || host.S || {};
  }

  function isLegacyImport(obj) {
    if (!obj) return false;
    if (obj.fromDrive || obj.imported) return true;
    return /import/i.test(str(obj.notes));
  }

  function wasAlreadyFinal(coll, prev) {
    if (!prev) return false;
    if (prev.pdfIncludesSignature) return true;
    if (prev.approverStatus === "Approved") return true;
    if (coll === "leaves") return prev.status === "Approved" || prev.status === "Availed";
    if (coll === "advances") {
      return (
        prev.status === "Approved" ||
        prev.status === "Released" ||
        prev.status === "Partially liquidated" ||
        prev.status === "Liquidated" ||
        prev.status === "Recovered from pay"
      );
    }
    return false;
  }

  function isEmploymentContract(doc) {
    if (!doc || typeof doc !== "object") return false;
    if (doc.seriesKey === "CON") return true;
    if (doc.kind === "contract" && doc.seriesKey && doc.seriesKey !== "CON") return false;
    var name = str(doc.title || doc.name || "");
    if (/quitclaim|clearance|certificate of employment|job offer/i.test(name)) return false;
    return doc.kind === "contract" && (doc.seriesKey === "CON" || /employment contract|project-based contract/i.test(name));
  }

  function evaluatorName(S, coll) {
    var st = (S && S.settings) || {};
    if (coll === "docreg") return str(st.hrHead || "");
    return str(st.payrollBy || "Catherine A. Largo");
  }

  function signatoryName(S) {
    var st = (S && S.settings) || {};
    return str(st.signatory || st.president || "Jeffrey James M. Corro");
  }

  function markEvaluated(obj, S, coll) {
    if (!obj.evaluatedBy) obj.evaluatedBy = evaluatorName(S, coll);
    if (!obj.evaluatedAt) obj.evaluatedAt = isoNow();
    obj.approvalLabel = LABEL_WAITING;
    return obj;
  }

  /**
   * Leave / CA: a signed copy, or an attempt to mark Approved, means the
   * evaluator step is finished. That is For approval, not Approved, until
   * Jeffrey stamps. Records created already Approved (Drive/paste import) and
   * records that were already Approved stay Approved.
   * Employment contracts (CON) enter the queue when they are first issued.
   */
  function applyEvaluatorGate(coll, obj, prev, S) {
    if (!obj || typeof obj !== "object") return obj;
    var next = Object.assign({}, obj);
    if (prev) {
      if (!next.originalSignedLink && prev.originalSignedLink) next.originalSignedLink = prev.originalSignedLink;
      if (!next.approvedPdfLink && prev.approvedPdfLink) next.approvedPdfLink = prev.approvedPdfLink;
      if (!next.officialPrint && prev.officialPrint) next.officialPrint = prev.officialPrint;
      if (!next.originalLink && prev.originalLink) next.originalLink = prev.originalLink;
    }
    if (next._fromApprover) {
      delete next._fromApprover;
      return next;
    }
    if (next.pdfIncludesSignature) return next;

    if (coll === "leaves" || coll === "advances") {
      if (!prev && isLegacyImport(next)) return next;
      if (wasAlreadyFinal(coll, prev) && next.status === prev.status) return next;

      var claim =
        next.status === "Approved" ||
        next.status === "Availed" ||
        (coll === "advances" && next.status === "Released" && prev && !wasAlreadyFinal(coll, prev));
      var early =
        coll === "leaves"
          ? next.status === "Filed" || next.status === "For signature"
          : next.status === "Requested" || next.status === "For signature";
      var signed = !!str(next.signedLink || (prev && prev.signedLink));

      if (!wasAlreadyFinal(coll, prev) && claim) {
        if (signed || str(next.signedLink)) {
          next.signedLink = next.signedLink || (prev && prev.signedLink) || "";
          next.status = FOR_APPROVAL;
          return markEvaluated(next, S, coll);
        }
        next.status = (prev && prev.status && prev.status !== "Approved" && prev.status !== "Availed")
          ? prev.status
          : coll === "leaves"
            ? "Filed"
            : "Requested";
        return next;
      }
      if (early && signed && !wasAlreadyFinal(coll, prev)) {
        next.status = FOR_APPROVAL;
        return markEvaluated(next, S, coll);
      }
      if (next.status === FOR_APPROVAL) return markEvaluated(next, S, coll);
      return next;
    }

    if (coll === "docreg" && isEmploymentContract(next)) {
      if (next.approverStatus === "Approved" || next.approverStatus === "Rejected") return next;
      if (prev && prev.pdfIncludesSignature && !next.pdfIncludesSignature) {
        next.pdfIncludesSignature = true;
        next.signatureStamp = next.signatureStamp || prev.signatureStamp;
        next.approvedAt = next.approvedAt || prev.approvedAt;
        next.approvedOn = next.approvedOn || prev.approvedOn;
        next.approvedBy = next.approvedBy || prev.approvedBy;
        next.approverStatus = prev.approverStatus || "Approved";
        return next;
      }
      if (prev && prev.approverStatus === FOR_APPROVAL && next.approverStatus !== "Rejected") {
        next.approverStatus = FOR_APPROVAL;
        if (!next.evaluatedBy) next.evaluatedBy = prev.evaluatedBy;
        if (!next.evaluatedAt) next.evaluatedAt = prev.evaluatedAt;
        return markEvaluated(next, S, "docreg");
      }
      var firstIssue =
        next.status === "Issued" &&
        (!prev || prev.status === "Draft" || !prev.status || prev.approverStatus === "Draft");
      if (firstIssue && next.approverStatus !== "Rejected") {
        next.approverStatus = FOR_APPROVAL;
        return markEvaluated(next, S, "docreg");
      }
      if (next.approverStatus === FOR_APPROVAL) return markEvaluated(next, S, "docreg");
    }
    return next;
  }

  function signatureSrc(S, rec) {
    if (rec && rec.signatureStamp) return str(rec.signatureStamp);
    var st = (S && S.settings) || {};
    var map = st.hrSigs || {};
    var i;
    for (i = 0; i < SIGNATORY_KEYS.length; i++) {
      var pack = map[SIGNATORY_KEYS[i]];
      if (pack && (pack.data || pack.link)) return str(pack.data || pack.link);
    }
    var keys = Object.keys(map);
    for (i = 0; i < keys.length; i++) {
      var p = map[keys[i]];
      if (!p || !(p.data || p.link)) continue;
      var blob = (keys[i] + " " + str(p.name) + " " + str(p.title) + " " + str(p.slot)).toLowerCase();
      if (/jeffrey|corro|signatory|president|\bceo\b|final approval/.test(blob)) return str(p.data || p.link);
    }
    if (st.signatorySig) return str(st.signatorySig);
    if (st.presidentSig) return str(st.presidentSig);
    var emps = values(S && S.employees);
    for (i = 0; i < emps.length; i++) {
      var e = emps[i];
      if (!e || !(e.sigData || e.sigLink)) continue;
      var n = str(e.name).toLowerCase();
      if (n.indexOf("jeffrey") >= 0 && n.indexOf("corro") >= 0) return str(e.sigData || e.sigLink);
      if (n.indexOf("jeffrey") >= 0 || (/\bcorro\b/.test(n) && n.indexOf("jeffrey") >= 0)) return str(e.sigData || e.sigLink);
    }
    for (i = 0; i < emps.length; i++) {
      var emp = emps[i];
      if (!emp || !(emp.sigData || emp.sigLink)) continue;
      if (str(emp.name).toLowerCase().indexOf("jeffrey") >= 0) return str(emp.sigData || emp.sigLink);
    }
    return "";
  }

  function columnOf(c) {
    if (Array.isArray(c)) return { who: "", name: str(c[0]), role: str(c[1]) };
    c = c || {};
    return { who: str(c.who), name: str(c.name), role: str(c.role) };
  }

  function leaveStampTest(col) {
    return /final approval/i.test(col.who || "");
  }

  function caStampTest(col) {
    return /^approved by$/i.test(str(col.who).trim());
  }

  function contractStampTest(col, signatory) {
    var blob = (col.who + " " + col.name + " " + col.role).toLowerCase();
    if (/\bwitness\b|\bnotary\b/.test(blob) && !/president|\bceo\b/.test(blob)) return false;
    if (/president|\bceo\b|signatory|final approval/.test(blob)) return true;
    /* Project-based company form: "{{PRESIDENT}}|For CORRO CONST. …" */
    if (/for corro|for the company|corporate president/.test(blob)) return true;
    var sig = str(signatory).toLowerCase().trim();
    if (sig && str(col.name).toLowerCase().trim() === sig) return true;
    return false;
  }

  function stampColumnIndex(cols, testFn) {
    var list = cols || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (testFn(columnOf(list[i]))) return i;
    }
    return -1;
  }

  function stampSignHtml(html, index, src, dateText) {
    if (!html || index < 0 || !src) return str(html);
    var n = -1;
    var out = str(html).replace(/<td class="ink"[^>]*>[\s\S]*?<\/td>/gi, function (m) {
      n += 1;
      if (n !== index) return m;
      var open = m.slice(0, m.indexOf(">") + 1);
      return (
        open +
        '<img src="' +
        esc(src) +
        '" alt="Signature" style="max-height:48px;max-width:168px;display:block;margin:0 auto 2px">' +
        "</td>"
      );
    });
    if (dateText) {
      var d = -1;
      out = out.replace(/Date:\s*_{3,}/g, function (m) {
        d += 1;
        if (d !== index) return m;
        return "Date: " + dateText;
      });
    }
    return out;
  }

  function forApprovalBanner() {
    return (
      '<div style="text-align:center;font-weight:800;letter-spacing:.22em;color:#9c3131;' +
      'border:2px solid #9c3131;padding:3px 6px;margin:6px 0 8px;font-size:12px">FOR APPROVAL</div>'
    );
  }

  /**
   * Where Jeffrey's e-signature sits on a scanned CCD form.
   * PDF origin is the bottom-left. Fractions are of that page.
   *
   * Leave and Cash Advance scans match the portal forms: a portrait page
   * whose approval band is four columns along the bottom.
   *   Leave: Immediate Supervisor | Evaluated by | HR Department | Final Approval
   *   Cash advance: Department Head | Evaluated by | Finance | Approved by
   * The approver is the rightmost column. The image is centered in that
   * column, about 15.5% up the page, above the printed name and clear of
   * the form-number footer. Side margins are 7%; the four columns share
   * the middle 86%. The employee signature (left, above the approval band)
   * is never drawn on.
   *
   * A contract scan, when one is attached, uses a two-party sign-off.
   * The company / president block is the right half, about 20% up the page.
   * Multi-page files are stamped on the last page only.
   */
  function stampBox(kind, pageWidth, pageHeight) {
    var w = Number(pageWidth) || 595;
    var h = Number(pageHeight) || 842;
    var contract = kind === "contract";
    var marginX = w * 0.07;
    var cols = contract ? 2 : 4;
    var colW = (w - marginX * 2) / cols;
    var col = cols - 1;
    var sigW = Math.min(colW * 0.72, w * 0.22);
    var sigH = Math.min(h * 0.055, 48);
    var x = marginX + col * colW + (colW - sigW) / 2;
    var y = h * (contract ? 0.2 : 0.155);
    return { x: x, y: y, width: sigW, height: sigH };
  }

  function fitBox(img, box) {
    var iw = img.width || box.width;
    var ih = img.height || box.height;
    var scale = Math.min(box.width / iw, box.height / ih);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var dw = iw * scale;
    var dh = ih * scale;
    return {
      x: box.x + (box.width - dw) / 2,
      y: box.y + (box.height - dh) / 2,
      width: dw,
      height: dh,
    };
  }

  function globalFn(name) {
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (g && typeof g[name] === "function") return g[name];
    return null;
  }

  function bytesToBase64(bytes) {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (typeof Buffer !== "undefined" && Buffer.from) return Buffer.from(arr).toString("base64");
    var bin = "";
    var step = 0x8000;
    for (var i = 0; i < arr.length; i += step) {
      bin += String.fromCharCode.apply(null, arr.subarray(i, i + step));
    }
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    var clean = String(b64 || "").replace(/\s/g, "");
    if (typeof Buffer !== "undefined" && Buffer.from) return new Uint8Array(Buffer.from(clean, "base64"));
    var bin = atob(clean);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
    return out;
  }

  function parseDataUrl(url) {
    var s = str(url).trim();
    var comma = s.indexOf(",");
    if (s.slice(0, 5).toLowerCase() !== "data:" || comma < 0) return null;
    var meta = s.slice(5, comma);
    var body = s.slice(comma + 1);
    if (!/;base64/i.test(meta)) return null;
    var mime = (meta.split(";")[0] || "").trim();
    return { bytes: base64ToBytes(body), mime: mime };
  }

  function isPdfBytes(bytes, mime) {
    if (bytes && bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return true;
    return /pdf/i.test(mime || "");
  }

  function isPngBytes(bytes, mime) {
    if (bytes && bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
    return /^image\/png/i.test(mime || "");
  }

  function isJpegBytes(bytes, mime) {
    if (bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return true;
    return /^image\/jpe?g/i.test(mime || "");
  }

  function looksLikeUpload(url) {
    url = str(url).trim();
    if (!url) return false;
    if (/^data:(application\/pdf|image\/(png|jpeg|jpg|webp))/i.test(url)) return true;
    if (/^blob:/i.test(url)) return true;
    if (/drive\.google\.com\/file\/d\//i.test(url)) return true;
    if (/^https?:\/\//i.test(url) && /\.(pdf|png|jpe?g)(\?|#|$)/i.test(url)) return true;
    return false;
  }

  function employeeUploadUrl(rec, kind) {
    rec = rec || {};
    if (rec.officialPrint === "stamped-upload") return "";
    var signed = str(rec.signedLink).trim();
    if (kind === "leave" || kind === "ca") return signed;
    var link = str(rec.link).trim();
    if (looksLikeUpload(signed)) return signed;
    if (looksLikeUpload(link)) return link;
    if (signed) return signed;
    return "";
  }

  function driveFileId(url) {
    var s = str(url);
    if (!/drive\.google\.com/i.test(s)) return "";
    var m = s.match(/\/file\/d\/([^/?#]+)/i) || s.match(/[?&]id=([^&#]+)/i);
    if (!m) return "";
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1];
    }
  }

  function loadPdfLib() {
    var g = typeof globalThis !== "undefined" ? globalThis : {};
    if (g.PDFLib && g.PDFLib.PDFDocument) return Promise.resolve(g.PDFLib);
    var nodeRequire = null;
    try {
      nodeRequire = typeof require === "function" ? require : null;
    } catch (e) {
      nodeRequire = null;
    }
    if (nodeRequire) {
      try {
        var lib = nodeRequire("pdf-lib");
        if (lib && lib.PDFDocument) return Promise.resolve(lib);
      } catch (e2) {}
    }
    return new Promise(function (resolve, reject) {
      var doc = g.document;
      if (!doc || !doc.createElement) {
        reject(new Error("PDF tools are not loaded in this browser."));
        return;
      }
      function done() {
        if (g.PDFLib && g.PDFLib.PDFDocument) resolve(g.PDFLib);
        else reject(new Error("PDF tools did not start."));
      }
      var existing = doc.querySelector && doc.querySelector("script[data-pdf-lib='1']");
      if (existing) {
        if (g.PDFLib && g.PDFLib.PDFDocument) done();
        else if (existing.addEventListener) existing.addEventListener("load", done);
        else reject(new Error("PDF tools did not start."));
        return;
      }
      var s = doc.createElement("script");
      s.src = "/pdf-lib.min.js";
      s.async = true;
      if (s.setAttribute) s.setAttribute("data-pdf-lib", "1");
      s.onload = done;
      s.onerror = function () {
        reject(new Error("Could not load the PDF stamp tool."));
      };
      (doc.head || doc.documentElement).appendChild(s);
    });
  }

  async function embedRaster(pdf, bytes, mime) {
    if (isPngBytes(bytes, mime)) return pdf.embedPng(bytes);
    if (isJpegBytes(bytes, mime)) return pdf.embedJpg(bytes);
    throw new Error("That image has to be a PNG or JPEG.");
  }

  async function drawApproverStamp(file, opts) {
    var lib = await loadPdfLib();
    var bytes = file && file.bytes;
    var mime = (file && file.mime) || "";
    var sig = parseDataUrl(opts.signature);
    if (!sig || !sig.bytes || !sig.bytes.length) {
      throw new Error("Jeffrey's e-signature image could not be read. Check Settings → HR e-signatures.");
    }
    var pdf;
    if (isPdfBytes(bytes, mime)) {
      pdf = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
    } else if (isPngBytes(bytes, mime) || isJpegBytes(bytes, mime)) {
      pdf = await lib.PDFDocument.create();
      var scan = await embedRaster(pdf, bytes, mime);
      var page0 = pdf.addPage([scan.width, scan.height]);
      page0.drawImage(scan, { x: 0, y: 0, width: scan.width, height: scan.height });
    } else {
      throw new Error("The uploaded file is not a PDF or JPEG/PNG image, so it cannot be stamped.");
    }
    var pages = pdf.getPages();
    if (!pages.length) throw new Error("The uploaded PDF has no pages.");
    var page = pages[pages.length - 1];
    var size = page.getSize();
    var box = stampBox(opts.kind, size.width, size.height);
    var sigImg;
    try {
      sigImg = await embedRaster(pdf, sig.bytes, sig.mime);
    } catch (e) {
      throw new Error("Jeffrey's e-signature has to be a PNG or JPEG. Check Settings → HR e-signatures.");
    }
    var placed = fitBox(sigImg, box);
    page.drawImage(sigImg, placed);
    if (opts.dateText && lib.StandardFonts) {
      try {
        var font = await pdf.embedFont(lib.StandardFonts.Helvetica);
        var dateY = placed.y - 11;
        if (dateY < 8) dateY = placed.y + placed.height + 2;
        page.drawText(String(opts.dateText), { x: placed.x, y: dateY, size: 8, font: font });
      } catch (e2) {}
    }
    return pdf.save();
  }

  async function downloadDriveFile(host, fileId) {
    var getMcpFn = host && typeof host.getMcp === "function" ? host.getMcp : globalFn("getMcp");
    var mcp = null;
    if (getMcpFn) {
      try {
        mcp = await getMcpFn();
      } catch (e) {
        mcp = null;
      }
    }
    if (!mcp || typeof mcp.callTool !== "function") {
      throw new Error("The signed file is on Google Drive. The portal could not read it, so approval was not saved.");
    }
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var server = (g && typeof g.DRIVE_SERVER === "string" && g.DRIVE_SERVER) || "Google Drive";
    var out;
    try {
      out = await mcp.callTool(server, "download_file", { fileId: fileId });
    } catch (e2) {
      throw new Error((e2 && e2.message) || "Could not download the signed file from Drive.");
    }
    var payload = (out && out.payload) || out || {};
    var b64 = payload.base64Content || payload.base64 || "";
    if (!b64) throw new Error("Drive did not return the signed file.");
    return { bytes: base64ToBytes(b64), mime: payload.mimeType || "" };
  }

  async function fetchUploadBytes(host, url) {
    if (host && typeof host.fetchUploadBytes === "function") return host.fetchUploadBytes(url);
    var data = parseDataUrl(url);
    if (data) {
      if (!data.bytes || !data.bytes.length) throw new Error("The uploaded file is empty.");
      return data;
    }
    var id = driveFileId(url);
    if (id) return downloadDriveFile(host, id);
    if (typeof fetch !== "function") throw new Error("Could not download the signed file.");
    var res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error("Could not download the signed file.");
    }
    if (!res || !res.ok) {
      throw new Error("Could not download the signed file" + (res && res.status ? " (" + res.status + ")." : "."));
    }
    var buf = await res.arrayBuffer();
    var mime = "";
    try {
      mime = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
    } catch (e2) {
      mime = "";
    }
    return { bytes: new Uint8Array(buf), mime: String(mime).split(";")[0].trim() };
  }

  async function uploadStamped(host, rec, title, b64) {
    var getMcpFn = host && typeof host.getMcp === "function" ? host.getMcp : globalFn("getMcp");
    if (!getMcpFn) return null;
    var mcp = null;
    try {
      mcp = await getMcpFn();
    } catch (e) {
      return null;
    }
    if (!mcp || typeof mcp.callTool !== "function") return null;
    var S = bindStore(host);
    var emp = S.employees && rec && rec.empId ? S.employees[rec.empId] : null;
    var resolve = host && typeof host.resolveFolder === "function" ? host.resolveFolder : globalFn("resolveFolder");
    var parentId = "";
    if (emp && resolve) {
      try {
        parentId = (await resolve(emp)) || "";
      } catch (e2) {
        parentId = "";
      }
    }
    if (!parentId && S.settings) parentId = S.settings.hr201Inbox || "";
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    var server = (g && typeof g.DRIVE_SERVER === "string" && g.DRIVE_SERVER) || "Google Drive";
    var args = {
      title: title,
      base64Content: b64,
      contentMimeType: "application/pdf",
      disableConversionToGoogleType: true,
    };
    if (parentId) args.parentId = parentId;
    var result = await mcp.callTool(server, "create_file", args);
    var payload = (result && result.payload) || {};
    if (!payload.viewUrl) return null;
    return { url: payload.viewUrl, title: payload.title || title, id: payload.id || "" };
  }

  async function persistStamped(host, rec, title, bytes) {
    var b64 = bytesToBase64(bytes);
    var uploaded = null;
    try {
      uploaded = await uploadStamped(host, rec, title, b64);
    } catch (e) {
      uploaded = null;
    }
    if (uploaded && uploaded.url) return uploaded;
    return { url: "data:application/pdf;base64," + b64, title: title, inline: true };
  }

  async function stampEmployeeUpload(host, opts) {
    opts = opts || {};
    var fetched = await fetchUploadBytes(host, opts.url);
    var bytes = await drawApproverStamp(fetched, opts);
    var title = opts.title || ((opts.rec && opts.rec.no) || "FORM") + " APPROVED.pdf";
    return persistStamped(host, opts.rec, title, bytes);
  }

  function applyOfficialFile(rec, stamped, sourceUrl, kind) {
    var next = Object.assign({}, rec || {});
    var src = str(sourceUrl || next.signedLink || next.link || "");
    var url = str(stamped && stamped.url);
    if (!url) return next;
    if (!next.originalSignedLink && src && src !== url) next.originalSignedLink = src;
    if (kind === "contract") {
      var link = str(next.link);
      if (link && link !== url && !next.originalLink && (link === src || !str(rec && rec.signedLink))) {
        next.originalLink = link;
      }
      if (link && (link === src || next.originalLink)) next.link = url;
    }
    next.signedLink = url;
    next.approvedPdfLink = url;
    if (stamped.title) next.signedTitle = stamped.title;
    next.officialPrint = "stamped-upload";
    return next;
  }

  function officialUrl(rec) {
    if (!rec || rec.officialPrint !== "stamped-upload" || !rec.pdfIncludesSignature) return "";
    return str(rec.approvedPdfLink || rec.signedLink || "");
  }

  function openOfficial(host, rec) {
    var url = officialUrl(rec);
    if (!url) return false;
    var doc = host && host.document;
    var title = (rec && (rec.signedTitle || rec.no)) || "approved.pdf";
    try {
      if (doc && doc.createElement) {
        var a = doc.createElement("a");
        if (!a) return false;
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        if (url.indexOf("data:") === 0) a.download = /\.pdf$/i.test(title) ? title : title + ".pdf";
        if (doc.body && doc.body.appendChild) doc.body.appendChild(a);
        if (typeof a.click === "function") {
          a.click();
          if (a.parentNode && a.parentNode.removeChild) a.parentNode.removeChild(a);
          return true;
        }
      }
    } catch (e) {}
    if (host && typeof host.open === "function" && url.indexOf("data:") !== 0) {
      host.open(url, "_blank", "noopener");
      return true;
    }
    return false;
  }

  function approveRecord(rec, opts) {
    opts = opts || {};
    var sig = str(opts.signature);
    if (!sig) {
      return {
        ok: false,
        error: "Attach Jeffrey's e-signature in Settings → HR e-signatures (filename jeffrey, corro, ceo, or signatory) before approving.",
      };
    }
    var next = Object.assign({}, rec || {});
    var kind = opts.kind || "";
    if (kind === "contract" || isEmploymentContract(next)) {
      next.approverStatus = "Approved";
      next.approvalLabel = "Approved";
    } else {
      next.status = "Approved";
      next.approvalLabel = "Approved";
    }
    next.pdfIncludesSignature = true;
    next.approvedAt = opts.at || isoNow();
    next.approvedOn = opts.on || str(next.approvedAt).slice(0, 10);
    next.approvedBy = opts.by || "Jeffrey James M. Corro";
    next.signatureStamp = sig;
    return { ok: true, record: next };
  }

  function rejectRecord(rec, opts) {
    opts = opts || {};
    var next = Object.assign({}, rec || {});
    var kind = opts.kind || "";
    if (kind === "contract" || isEmploymentContract(next)) {
      next.approverStatus = "Rejected";
      next.approvalLabel = "Rejected";
    } else {
      next.status = "Disapproved";
      next.approvalLabel = "Rejected";
    }
    next.approverNote = str(opts.note);
    next.rejectedAt = opts.at || isoNow();
    next.rejectedBy = opts.by || "";
    next.pdfIncludesSignature = false;
    return { ok: true, record: next };
  }

  function waitingLeave(rec) {
    return !!(rec && rec.status === FOR_APPROVAL && !rec.pdfIncludesSignature);
  }

  function waitingAdvance(rec) {
    return waitingLeave(rec);
  }

  function waitingContract(rec) {
    return !!(
      rec &&
      isEmploymentContract(rec) &&
      rec.approverStatus === FOR_APPROVAL &&
      !rec.pdfIncludesSignature &&
      rec.status !== "Void" &&
      rec.status !== "Superseded"
    );
  }

  function personName(S, empId, fallback) {
    var e = S && S.employees && empId ? S.employees[empId] : null;
    return (e && e.name) || fallback || "";
  }

  function queueItems(S) {
    S = S || {};
    var rows = [];
    values(S.leaves).forEach(function (l) {
      if (!waitingLeave(l)) return;
      var emp = personName(S, l.empId, "");
      rows.push({
        kind: "leave",
        id: l.id,
        no: l.no || "",
        employee: emp,
        detail: [l.type || "", l.from || "", l.to && l.to !== l.from ? l.to : "", l.days ? l.days + " day(s)" : ""]
          .filter(Boolean)
          .join(" · "),
        evaluator: l.evaluatedBy || evaluatorName(S, "leaves"),
        pdf: l.approvedPdfLink || l.signedLink || "",
        when: l.evaluatedAt || l.filedOn || l.from || "",
      });
    });
    values(S.advances).forEach(function (a) {
      if (!waitingAdvance(a)) return;
      rows.push({
        kind: "ca",
        id: a.id,
        no: a.no || "",
        employee: personName(S, a.empId || a.filedEmpId, a.receivedBy || a.employeeName || ""),
        detail: [a.purpose || "Cash advance", a.amount != null && a.amount !== "" ? String(a.amount) : "", a.date || ""]
          .filter(Boolean)
          .join(" · "),
        evaluator: a.evaluatedBy || evaluatorName(S, "advances"),
        pdf: a.approvedPdfLink || a.signedLink || "",
        when: a.evaluatedAt || a.date || "",
      });
    });
    values(S.docreg).forEach(function (d) {
      if (!waitingContract(d)) return;
      rows.push({
        kind: "contract",
        id: d.id,
        no: d.no || "",
        employee: personName(S, d.empId, ""),
        detail: d.title || "Employment contract",
        evaluator: d.evaluatedBy || evaluatorName(S, "docreg"),
        pdf: d.approvedPdfLink || d.signedLink || d.link || "",
        when: d.evaluatedAt || d.date || "",
      });
    });
    rows.sort(function (a, b) {
      return str(a.when).localeCompare(str(b.when));
    });
    return rows;
  }

  function kindLabel(k) {
    if (k === "leave") return "Leave";
    if (k === "ca") return "Cash advance";
    if (k === "contract") return "Contract";
    return k || "";
  }

  function approverHtml(host, S) {
    var rows = queueItems(S);
    var filter = (S.ui && S.ui.apprFilter) || "all";
    var shown = rows.filter(function (r) {
      return filter === "all" || r.kind === filter;
    });
    var sig = signatureSrc(S);
    var counts = { leave: 0, ca: 0, contract: 0 };
    rows.forEach(function (r) {
      counts[r.kind] = (counts[r.kind] || 0) + 1;
    });
    if (typeof host.setCrumb === "function") {
      host.setCrumb("Approver", rows.length + " evaluated, waiting for final approval");
    }
    var h = "";
    h += '<div class="row" style="margin-bottom:14px"><div class="seg">';
    [
      ["all", "All"],
      ["leave", "Leave"],
      ["contract", "Contracts"],
      ["ca", "Cash advances"],
    ].forEach(function (pair) {
      h +=
        '<button type="button" class="' +
        (filter === pair[0] ? "on" : "") +
        '" data-hr-appr-filter="' +
        pair[0] +
        '">' +
        esc(pair[1]) +
        "</button>";
    });
    h += "</div></div>";
    h += '<div class="strip">';
    h += tile(host, rows.length, "For approval", "Evaluated, not yet signed by the approver", rows.length ? "warn" : "ok");
    h += tile(host, counts.leave, "Leave", "after the evaluator", counts.leave ? "warn" : "ok");
    h += tile(host, counts.contract, "Contracts", "issued, waiting for the president", counts.contract ? "warn" : "ok");
    h += tile(host, counts.ca, "Cash advances", "after the evaluator", counts.ca ? "warn" : "ok");
    h += "</div>";
    h +=
      '<div class="note">The evaluator signs first (Leave and Cash Advance: ' +
      esc(evaluatorName(S, "leaves")) +
      "). That is <b>Evaluated — for approval</b>, not Approved. " +
      "<b>Approve</b> stamps " +
      esc(signatoryName(S)) +
      "'s e-signature on the uploaded signed form when one is on file, so the employee ink and that signature share one sheet. " +
      "With no upload, it stamps the portal form instead. Either way the item moves to <b>Approved</b>. " +
      "Reject sends it back as Disapproved so it does not sit here.</div>";
    if (!sig) {
      h +=
        '<div class="note" style="border-left-color:var(--crit)"><b>No approver e-signature is on file.</b> ' +
        "Settings → HR e-signatures, and name the file jeffrey, corro, ceo, or signatory. " +
        "That is the same signature store Daily Manpower already uses. Approve stays disabled until it is attached.</div>";
    }
    h += '<div class="sect-h"><h2>Waiting for final approval</h2><span class="rule"></span></div><div class="card">';
    if (!shown.length) {
      h +=
        '<div class="empty">Nothing is waiting. Leave and cash advances appear here after the signed evaluator copy is on file. ' +
        "Employment contracts appear here when they are issued. Approved items stay on their own lists.</div>";
    } else {
      h +=
        '<div class="tw"><table><thead><tr><th>Type</th><th>Number</th><th>Employee</th><th>Detail</th><th>Evaluator</th><th>Form</th><th></th></tr></thead><tbody>';
      shown.forEach(function (r) {
        h +=
          "<tr><td>" +
          esc(kindLabel(r.kind)) +
          '</td><td class="mono"><b>' +
          esc(r.no || "—") +
          "</b></td><td class=\"nm\">" +
          esc(r.employee || "—") +
          "</td><td>" +
          esc(r.detail || "—") +
          "</td><td>" +
          esc(r.evaluator || "—") +
          '</td><td>' +
          (r.pdf
            ? '<a class="btn sm" href="' +
              esc(r.pdf) +
              '" target="_blank" rel="noopener noreferrer">Open PDF</a> '
            : "") +
          '<button type="button" class="btn sm" data-hr-appr-preview="' +
          esc(r.kind) +
          '" data-hr-appr-id="' +
          esc(r.id) +
          '">Preview</button></td><td style="white-space:nowrap">' +
          '<button type="button" class="btn sm pri" data-hr-appr-approve="' +
          esc(r.kind) +
          '" data-hr-appr-id="' +
          esc(r.id) +
          '"' +
          (sig ? "" : " disabled") +
          ">Approve</button> " +
          '<button type="button" class="btn sm danger" data-hr-appr-reject="' +
          esc(r.kind) +
          '" data-hr-appr-id="' +
          esc(r.id) +
          '">Reject</button></td></tr>';
      });
      h += "</tbody></table></div>";
    }
    h += "</div>";
    return h;
  }

  function tile(host, v, k, sub, sev) {
    if (typeof host.tile === "function") return host.tile(v, k, sub, sev);
    return (
      '<div class="tile ' +
      esc(sev || "") +
      '"><div class="v">' +
      esc(v) +
      '</div><div class="k">' +
      esc(k) +
      "</div>" +
      (sub ? '<div class="sub">' + esc(sub) + "</div>" : "") +
      "</div>"
    );
  }

  function contractStrip(host, S) {
    var docs = values(S && S.docreg).filter(isEmploymentContract).filter(function (d) {
      return d.approverStatus === FOR_APPROVAL || d.approverStatus === "Approved" || d.approverStatus === "Rejected";
    });
    if (!docs.length) return "";
    docs.sort(function (a, b) {
      return str(b.date || b.approvedAt).localeCompare(str(a.date || a.approvedAt));
    });
    var h =
      '<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>Final approval</h3>' +
      '<span class="lbl">evaluator issue, then the approver</span></div><div class="tw"><table><thead><tr>' +
      "<th>Number</th><th>Employee</th><th>Title</th><th>Approval</th></tr></thead><tbody>";
    docs.slice(0, 40).forEach(function (d) {
      var label =
        d.approverStatus === "Approved" ? "Approved" : d.approverStatus === "Rejected" ? "Rejected" : LABEL_WAITING;
      var sev = d.approverStatus === "Approved" ? "ok" : d.approverStatus === "Rejected" ? "mut" : "warn";
      var pill =
        typeof host.sevPill === "function"
          ? host.sevPill(sev, label)
          : '<span class="pill ' + sev + '">' + esc(label) + "</span>";
      h +=
        '<tr><td class="mono"><b>' +
        esc(d.no || "—") +
        '</b></td><td class="nm">' +
        esc(personName(S, d.empId, "")) +
        "</td><td>" +
        esc(d.title || "Employment contract") +
        "</td><td>" +
        pill +
        "</td></tr>";
    });
    h += "</tbody></table></div></div>";
    return h;
  }

  function lookup(S, kind, id) {
    var coll = kind === "leave" ? "leaves" : kind === "ca" ? "advances" : "docreg";
    return { coll: coll, rec: S && S[coll] ? S[coll][id] : null };
  }

  function withStamp(host, kind, rec, fn) {
    var prevS = host.__hrStamp;
    var prevW = host.__hrForApproval;
    var S = bindStore(host);
    try {
      if (rec && rec.pdfIncludesSignature) {
        var test = kind === "leave" ? leaveStampTest : kind === "ca" ? caStampTest : contractStampTest;
        var who = signatoryName(S);
        host.__hrStamp = {
          src: rec.signatureStamp || signatureSrc(S, rec),
          on: rec.approvedOn || "",
          test:
            kind === "contract"
              ? function (col) {
                  return contractStampTest(col, who);
                }
              : test,
        };
        host.__hrForApproval = false;
      } else if (
        rec &&
        (rec.status === FOR_APPROVAL || rec.approverStatus === FOR_APPROVAL) &&
        !rec.pdfIncludesSignature
      ) {
        host.__hrStamp = null;
        host.__hrForApproval = true;
      } else {
        host.__hrStamp = null;
        host.__hrForApproval = false;
      }
      return fn();
    } finally {
      host.__hrStamp = prevS;
      host.__hrForApproval = prevW;
    }
  }

  function previewItem(host, kind, id) {
    var S = bindStore(host);
    var found = lookup(S, kind, id);
    if (!found.rec) return;
    if (officialUrl(found.rec)) {
      if (!openOfficial(host, found.rec)) {
        toast(host, "The approved file is on the record. Use Open the approved form.", "err");
      }
      return;
    }
    if (kind === "leave" && typeof host.printLeave === "function") {
      withStamp(host, "leave", found.rec, function () {
        host.printLeave(found.rec);
      });
      return;
    }
    if (kind === "ca" && typeof host.printCA === "function") {
      withStamp(host, "ca", found.rec, function () {
        host.printCA(found.rec);
      });
      return;
    }
    if (typeof host.reopenDoc === "function") host.reopenDoc(id);
  }

  function toast(host, msg, kind) {
    if (typeof host.toast === "function") host.toast(msg, kind);
  }

  async function commit(host, coll, id, rec) {
    rec._fromApprover = true;
    if (typeof host.put === "function") await host.put(coll, id, rec);
    else {
      var S = bindStore(host);
      if (S[coll]) S[coll][id] = rec;
    }
  }

  async function approveItem(host, kind, id) {
    var S = bindStore(host);
    var found = lookup(S, kind, id);
    if (!found.rec) return;
    var sig = signatureSrc(S);
    var result = approveRecord(found.rec, {
      kind: kind,
      signature: sig,
      by: signatoryName(S),
      at: isoNow(),
      on: typeof host.TODAY === "string" ? host.TODAY : isoDay(),
    });
    if (!result.ok) {
      toast(host, result.error, "err");
      return;
    }
    var src = employeeUploadUrl(found.rec, kind);
    if (src) {
      toast(host, "Stamping the signed upload…", "");
      try {
        var stamped = await stampEmployeeUpload(host, {
          url: src,
          kind: kind,
          signature: sig,
          dateText: result.record.approvedOn || "",
          title: (found.rec.no || kindLabel(kind) || "FORM") + " APPROVED.pdf",
          rec: found.rec,
        });
        if (!stamped || !stamped.url) throw new Error("The stamped file was not saved.");
        result.record = applyOfficialFile(result.record, stamped, src, kind);
      } catch (err) {
        toast(
          host,
          (err && err.message) || "Could not stamp the uploaded form. It is still waiting for approval.",
          "err"
        );
        return;
      }
    }
    await commit(host, found.coll, id, result.record);
    if (src) {
      toast(
        host,
        "Approved. " + signatoryName(S) + "'s e-signature is on the uploaded form. Open PDF to print that copy.",
        "ok"
      );
    } else {
      toast(host, "Approved. " + signatoryName(S) + "'s signature is on the form — Save as PDF to download it.", "ok");
    }
    if (typeof host.render === "function") host.render();
    previewItem(host, kind, id);
  }

  function rejectItem(host, kind, id) {
    var S = bindStore(host);
    var found = lookup(S, kind, id);
    if (!found.rec || typeof host.openModal !== "function") {
      return doReject(host, kind, id, "");
    }
    host.openModal({
      title: "Reject " + (found.rec.no || kindLabel(kind)),
      body:
        '<div class="stack"><div class="note">This leaves the Approver queue. Leave and cash advances are marked Disapproved. ' +
        "The evaluator's signature stays; this is not a final approval.</div>" +
        '<div class="f"><label>Note (optional)</label><textarea id="hr-appr-note" style="min-height:70px"></textarea></div></div>',
      foot: '<button class="btn" id="hr-appr-cancel">Cancel</button><button class="btn danger" id="hr-appr-go">Reject</button>',
    });
    var cancel = host.document && host.document.getElementById("hr-appr-cancel");
    var go = host.document && host.document.getElementById("hr-appr-go");
    if (cancel) {
      cancel.onclick = function () {
        if (typeof host.closeModal === "function") host.closeModal();
      };
    }
    if (go) {
      go.onclick = function () {
        var noteEl = host.document.getElementById("hr-appr-note");
        var note = noteEl ? noteEl.value : "";
        if (typeof host.closeModal === "function") host.closeModal();
        doReject(host, kind, id, note);
      };
    }
  }

  async function doReject(host, kind, id, note) {
    var S = bindStore(host);
    var found = lookup(S, kind, id);
    if (!found.rec) return;
    var result = rejectRecord(found.rec, { kind: kind, note: note, by: signatoryName(S), at: isoNow() });
    await commit(host, found.coll, id, result.record);
    toast(host, (found.rec.no || "Item") + " rejected.", "ok");
    if (typeof host.render === "function") host.render();
  }

  function injectStatusOption(doc, id) {
    if (!doc || !doc.getElementById) return;
    var sel = doc.getElementById(id);
    if (!sel || !sel.options) return;
    var i;
    var has = false;
      var marked = false;
      for (i = 0; i < sel.options.length; i++) {
        var opt = sel.options[i];
        if (opt.value === FOR_APPROVAL || opt.text === FOR_APPROVAL || opt.textContent === FOR_APPROVAL) has = true;
        if (opt.hasAttribute && opt.hasAttribute("selected")) marked = true;
      }
      if (!has) {
        var el = doc.createElement("option");
        el.value = FOR_APPROVAL;
        el.textContent = FOR_APPROVAL;
        var before = null;
        for (i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text === "Approved" || sel.options[i].value === "Approved" || sel.options[i].textContent === "Approved") {
            before = sel.options[i];
            break;
          }
        }
        if (before && before.parentNode) before.parentNode.insertBefore(el, before);
        else sel.appendChild(el);
        /* No option carried the selected attribute, so the stored status is
           For approval and the browser would otherwise show Filed. */
        if (!marked) el.selected = true;
      }
  }

  function ensureNav(host) {
    var doc = host.document;
    if (!doc || !doc.getElementById) return;
    var nav = doc.getElementById("nav");
    if (!nav || !nav.querySelector) return;
    var S = bindStore(host);
    var btn = nav.querySelector('[data-nav="approver"]');
    if (!btn) {
      btn = doc.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-nav", "approver");
      var cash = nav.querySelector('[data-nav="cashadv"]');
      if (cash && cash.parentNode) cash.parentNode.insertBefore(btn, cash);
      else if (nav.appendChild) nav.appendChild(btn);
    }
    var n = queueItems(S).length;
    btn.className = "nav-i" + (S.ui && S.ui.view === "approver" ? " on" : "") + (unlocked ? "" : " locked");
    if (btn.title !== undefined) btn.title = unlocked ? "" : "Password required";
    btn.innerHTML =
      '<svg><use href="#i-check"/></svg><span>Approver</span>' +
      (n ? '<span class="cnt alert">' + n + "</span>" : "");
  }

  function bindClicks(host) {
    if (host.__hrApproverClicks) return;
    host.__hrApproverClicks = true;
    var doc = host.document;
    if (!doc || !doc.addEventListener) return;
    doc.addEventListener("keydown", function (ev) {
      if (!ev.target || ev.target.id !== "hr-appr-pass" || ev.key !== "Enter") return;
      if (ev.preventDefault) ev.preventDefault();
      applyUnlock(host);
    });
    doc.addEventListener("click", function (ev) {
      var unlockBtn = ev.target && ev.target.closest ? ev.target.closest("[data-hr-appr-unlock]") : null;
      if (unlockBtn) {
        if (ev.preventDefault) ev.preventDefault();
        applyUnlock(host);
        return;
      }
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-hr-appr-filter],[data-hr-appr-approve],[data-hr-appr-reject],[data-hr-appr-preview]") : null;
      if (!t || !unlocked) return;
      var S = bindStore(host);
      if (t.hasAttribute("data-hr-appr-filter")) {
        S.ui = S.ui || {};
        S.ui.apprFilter = t.getAttribute("data-hr-appr-filter") || "all";
        S.ui.view = "approver";
        if (typeof host.render === "function") host.render();
        return;
      }
      var kind = t.getAttribute("data-hr-appr-approve") || t.getAttribute("data-hr-appr-reject") || t.getAttribute("data-hr-appr-preview");
      var id = t.getAttribute("data-hr-appr-id");
      if (t.hasAttribute("data-hr-appr-approve")) approveItem(host, kind, id);
      else if (t.hasAttribute("data-hr-appr-reject")) rejectItem(host, kind, id);
      else if (t.hasAttribute("data-hr-appr-preview")) previewItem(host, kind, id);
    });
  }

  function patchGlobals(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return {};

    if (typeof host.put === "function" && !host.put._hrApprover) {
      var origPut = host.put;
      host.put = function (coll, id, obj) {
        var S = bindStore(host);
        if ((coll === "leaves" || coll === "advances" || coll === "docreg") && obj) {
          var prev = S && S[coll] ? S[coll][id] : undefined;
          obj = applyEvaluatorGate(coll, obj, prev, S);
        }
        return origPut.call(this, coll, id, obj);
      };
      host.put._hrApprover = true;
    }

    if (typeof host.decisionBlocked === "function" && !host.decisionBlocked._hrApprover) {
      var origBlock = host.decisionBlocked;
      host.decisionBlocked = function (r) {
        if (r && r.status === FOR_APPROVAL && !r.signedLink) return true;
        return origBlock.apply(this, arguments);
      };
      host.decisionBlocked._hrApprover = true;
    }

    if (typeof host.sevPill === "function" && !host.sevPill._hrApprover) {
      var origPill = host.sevPill;
      host.sevPill = function (sev, txt) {
        if (txt === FOR_APPROVAL) return origPill("warn", LABEL_WAITING);
        return origPill.apply(this, arguments);
      };
      host.sevPill._hrApprover = true;
    }

    if (typeof host.hrSigSlotDefs === "function" && !host.hrSigSlotDefs._hrApprover) {
      var origSlots = host.hrSigSlotDefs;
      host.hrSigSlotDefs = function () {
        var slots = origSlots.apply(this, arguments) || [];
        var S = bindStore(host);
        var st = (S && S.settings) || {};
        if (
          !slots.some(function (s) {
            return s && s.k === "signatory";
          })
        ) {
          slots.push({
            k: "signatory",
            label: "Final approval",
            role: st.signatoryTitle || st.presidentTitle || "CEO / President",
            aliases: ["signatory", "president", "ceo", "jeffrey", "corro", "final approval", "management"],
            names: [st.signatory || "", st.president || "Jeffrey James M. Corro"].filter(Boolean),
          });
        }
        return slots;
      };
      host.hrSigSlotDefs._hrApprover = true;
    }

    function wrapSign(name) {
      if (typeof host[name] !== "function" || host[name]._hrApprover) return;
      var orig = host[name];
      host[name] = function (cols) {
        var html = orig.apply(this, arguments);
        var stamp = host.__hrStamp;
        if (!stamp || !stamp.src) return html;
        var idx = stampColumnIndex(cols, stamp.test || contractStampTest);
        return stampSignHtml(html, idx, stamp.src, stamp.on || "");
      };
      host[name]._hrApprover = true;
    }
    wrapSign("pfSign");
    wrapSign("pfSignPlain");

    if (typeof host.pfHead === "function" && !host.pfHead._hrApprover) {
      var origHead = host.pfHead;
      host.pfHead = function () {
        var html = origHead.apply(this, arguments);
        if (host.__hrForApproval) html += forApprovalBanner();
        return html;
      };
      host.pfHead._hrApprover = true;
    }

    if (typeof host.printLeave === "function" && !host.printLeave._hrApprover) {
      var origLeave = host.printLeave;
      host.printLeave = function (l, opt) {
        if (officialUrl(l)) {
          if (!openOfficial(host, l)) toast(host, "The approved file is on the record. Use Open the approved form.", "err");
          return;
        }
        var args = arguments;
        return withStamp(host, "leave", l, function () {
          return origLeave.apply(host, args);
        });
      };
      host.printLeave._hrApprover = true;
    }

    if (typeof host.printCA === "function" && !host.printCA._hrApprover) {
      var origCA = host.printCA;
      host.printCA = function (a, opt) {
        if (officialUrl(a)) {
          if (!openOfficial(host, a)) toast(host, "The approved file is on the record. Use Open the approved form.", "err");
          return;
        }
        var args = arguments;
        return withStamp(host, "ca", a, function () {
          return origCA.apply(host, args);
        });
      };
      host.printCA._hrApprover = true;
    }

    if (typeof host.paperBody === "function" && !host.paperBody._hrApprover) {
      var origPaper = host.paperBody;
      host.paperBody = function (text, d) {
        var args = arguments;
        return withStamp(host, "contract", d, function () {
          if (d && isEmploymentContract(d) && /@SIGN /.test(str(text)) && typeof host.proseHTML === "function") {
            var head = typeof host.pfHead === "function" ? host.pfHead() : "";
            var title =
              typeof host.pfTitle === "function" ? host.pfTitle(str(d.title || "EMPLOYMENT CONTRACT").toUpperCase(), "") : "";
            var control = typeof host.pfControl === "function" ? host.pfControl(d.no, "Document No.", false) : "";
            var iso = typeof host.pfISO === "function" ? host.pfISO(d.formKey || "contract") : "";
            return head + title + control + '<div class="pf-doc">' + host.proseHTML(text, {}) + "</div>" + iso;
          }
          return origPaper.apply(host, args);
        });
      };
      host.paperBody._hrApprover = true;
    }

    if (typeof host.openModal === "function" && !host.openModal._hrApprover) {
      var origModal = host.openModal;
      host.openModal = function () {
        var out = origModal.apply(this, arguments);
        try {
          injectStatusOption(host.document, "l-status");
          injectStatusOption(host.document, "c-status");
        } catch (e) {}
        return out;
      };
      host.openModal._hrApprover = true;
    }

    if (typeof host.renderNav === "function" && !host.renderNav._hrApprover) {
      var origNav = host.renderNav;
      host.renderNav = function () {
        var out = origNav.apply(this, arguments);
        try {
          ensureNav(host);
        } catch (e) {}
        return out;
      };
      host.renderNav._hrApprover = true;
    }

    if (typeof host.viewContracts === "function" && !host.viewContracts._hrApprover) {
      var origContracts = host.viewContracts;
      host.viewContracts = function () {
        var html = origContracts.apply(this, arguments);
        try {
          html = contractStrip(host, bindStore(host)) + html;
        } catch (e) {}
        return html;
      };
      host.viewContracts._hrApprover = true;
    }

    if (typeof host.go === "function" && !host.go._hrApprover) {
      var origGo = host.go;
      host.go = function (view, empId, tab) {
        if (view === "approver") {
          var S = bindStore(host);
          S.ui = S.ui || {};
          S.ui.view = "approver";
          if (typeof host.scrollTo === "function") host.scrollTo(0, 0);
          if (typeof host.render === "function") host.render();
          return;
        }
        return origGo.apply(this, arguments);
      };
      host.go._hrApprover = true;
    }

    if (typeof host.render === "function" && !host.render._hrApprover) {
      var origRender = host.render;
      host.render = function () {
        var S = bindStore(host);
        if (S.ui && S.ui.view === "approver") {
          if (typeof host.renderNav === "function") host.renderNav();
          var view = host.document && host.document.getElementById("view");
          if (!unlocked) {
            if (typeof host.setCrumb === "function") host.setCrumb("Approver", "Password required");
            if (view) view.innerHTML = gateHtml();
            focusPass(host);
          } else if (view) {
            view.innerHTML = approverHtml(host, S);
          }
          if (typeof host.wire === "function") host.wire();
          bindClicks(host);
          return;
        }
        return origRender.apply(this, arguments);
      };
      host.render._hrApprover = true;
    }

    bindClicks(host);
    return host;
  }

  function attach(host) {
    host = host || (typeof window !== "undefined" ? window : null);
    if (!host) return api;
    patchGlobals(host);
    api.attached = true;
    return api;
  }

  var api = {
    attached: false,
    attach: attach,
    install: attach,
    patchGlobals: patchGlobals,
    bindStore: bindStore,
    applyEvaluatorGate: applyEvaluatorGate,
    approveRecord: approveRecord,
    rejectRecord: rejectRecord,
    queueItems: queueItems,
    signatureSrc: signatureSrc,
    stampSignHtml: stampSignHtml,
    stampColumnIndex: stampColumnIndex,
    stampBox: stampBox,
    employeeUploadUrl: employeeUploadUrl,
    applyOfficialFile: applyOfficialFile,
    stampEmployeeUpload: stampEmployeeUpload,
    approveItem: approveItem,
    officialUrl: officialUrl,
    isEmploymentContract: isEmploymentContract,
    approverHtml: approverHtml,
    gateHtml: gateHtml,
    isApproverUnlocked: isApproverUnlocked,
    tryApproverPassword: tryApproverPassword,
    resetApproverLock: resetApproverLock,
    FOR_APPROVAL: FOR_APPROVAL,
    LABEL_WAITING: LABEL_WAITING,
    leaveStampTest: leaveStampTest,
    caStampTest: caStampTest,
    contractStampTest: contractStampTest,
  };
  return api;
});
