"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function decodeDataUrl(url) {
  const s = String(url || "");
  const comma = s.indexOf(",");
  if (s.slice(0, 5).toLowerCase() !== "data:" || comma < 0) return null;
  const meta = s.slice(5, comma);
  if (!/;base64/i.test(meta)) return null;
  return {
    mime: (meta.split(";")[0] || "").trim().toLowerCase(),
    bytes: Buffer.from(s.slice(comma + 1).replace(/\s/g, ""), "base64"),
  };
}

function htmlText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h\d|li|section|header|footer)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function signatureFromHtml(html) {
  const m = String(html || "").match(/class="pay-approval-sig"[^>]*src="([^"]+)"/i)
    || String(html || "").match(/src="(data:image\/(?:png|jpeg|jpg);base64,[^"]+)"/i);
  if (!m) return null;
  return decodeDataUrl(m[1]);
}

function findChrome() {
  const env = process.env.HR_PDF_CHROME || process.env.CHROME_PATH || "";
  const candidates = [env, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i] && fs.existsSync(candidates[i])) return candidates[i];
  }
  return "";
}

function chromePdf(html) {
  const chrome = findChrome();
  if (!chrome) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-pdf-"));
  const htmlPath = path.join(dir, "report.html");
  const pdfPath = path.join(dir, "report.pdf");
  const doc = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>" + html + "</body></html>";
  fs.writeFileSync(htmlPath, doc);
  try {
    execFileSync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-pdf-header-footer",
      "--print-to-pdf-no-header",
      "--print-to-pdf=" + pdfPath,
      "file://" + htmlPath,
    ], { timeout: 20000, stdio: "ignore" });
    if (!fs.existsSync(pdfPath)) return null;
    const bytes = fs.readFileSync(pdfPath);
    if (bytes.length < 5 || bytes.slice(0, 4).toString() !== "%PDF") return null;
    return bytes;
  } catch (e) {
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) {}
  }
}

async function pdfLibPdf(html) {
  const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = htmlText(html);
  const sig = signatureFromHtml(html);
  let image = null;
  if (sig && sig.bytes && sig.bytes.length) {
    try {
      if (sig.mime.indexOf("png") >= 0) image = await pdf.embedPng(sig.bytes);
      else if (sig.mime.indexOf("jpeg") >= 0 || sig.mime.indexOf("jpg") >= 0) image = await pdf.embedJpg(sig.bytes);
    } catch (e) {
      image = null;
    }
  }
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 36;
  const size = 8;
  const lineHeight = 10;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  function nextPage() {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  }
  if (image) {
    const scale = Math.min(140 / image.width, 36 / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    if (y - h < margin) nextPage();
    page.drawImage(image, { x: margin, y: y - h, width: w, height: h });
    y -= h + 8;
  }
  const words = text.split(/\n/);
  const maxWidth = pageWidth - margin * 2;
  words.forEach(function (paragraph) {
    const line = paragraph.trim();
    if (!line) {
      y -= lineHeight;
      if (y < margin) nextPage();
      return;
    }
    const face = /APPROVED BY JEFFREY JAMES CORRO/.test(line) ? bold : font;
    let rest = line;
    while (rest) {
      let take = rest.length;
      while (take > 1 && face.widthOfTextAtSize(rest.slice(0, take), size) > maxWidth) take -= 1;
      if (face.widthOfTextAtSize(rest.slice(0, take), size) > maxWidth) {
        const cut = rest.lastIndexOf(" ", take);
        if (cut > 20) take = cut;
      }
      const chunk = rest.slice(0, take).trim();
      rest = rest.slice(take).trim();
      if (y < margin) nextPage();
      page.drawText(chunk, { x: margin, y: y, size: size, font: face, color: rgb(0.1, 0.12, 0.16) });
      y -= lineHeight;
    }
  });
  return Buffer.from(await pdf.save());
}

/**
 * The Print button saves hrPaySheet.printHTML. Chrome print-to-pdf uses that
 * same HTML when a browser is on the machine. Otherwise the PDF is the text
 * and e-signature image from that HTML, via pdf-lib.
 */
async function renderPrintPdf(html, opts) {
  opts = opts || {};
  if (typeof opts.render === "function") return Buffer.from(await opts.render(html));
  if (opts.preferChrome !== false) {
    const chrome = chromePdf(html);
    if (chrome) return chrome;
  }
  return pdfLibPdf(html);
}

module.exports = {
  decodeDataUrl,
  htmlText,
  renderPrintPdf,
};
