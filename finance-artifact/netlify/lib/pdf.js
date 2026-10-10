"use strict";

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { fail } = require("./errors");
const { peso } = require("./money");

/** Helvetica cannot draw ₱. The screen uses the symbol; the PDF spells PHP. */
function pdfPeso(value) {
  return peso(value).replace("₱", "PHP ");
}

const NAVY = rgb(0.07, 0.12, 0.18);
const RULE = rgb(0.75, 0.72, 0.66);
const INK = rgb(0.12, 0.14, 0.16);

function decodeImage(dataUrl) {
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  return { kind: match[1].toLowerCase() === "png" ? "png" : "jpg", bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
}

async function embed(doc, dataUrl) {
  const image = decodeImage(dataUrl);
  if (!image) return null;
  try {
    return image.kind === "png" ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
  } catch {
    return null;
  }
}

function need(signatories, slot, label, required) {
  const row = (signatories || []).find((item) => item.slot === slot);
  if (required && (!row || !row.image_data)) {
    const person = (row && row.person_name) || label;
    fail("bad_request", `Missing e-signature for ${person} (${label}). Add it under Settings before printing.`);
  }
  return row || { person_name: label, title: label, image_data: "" };
}

/**
 * A4 disbursement voucher. Stamps Prepared, Checked, Approved, and Received.
 * A released or cleared voucher will not print until those images are on file.
 */
async function renderDvPdf(voucher, signatories) {
  if (!voucher) fail("not_found", "Voucher not found.");
  const status = voucher.status;
  const pastDraft = status !== "Draft" && status !== "Cancelled";
  const pastCheck = ["For Approval", "Approved", "Released", "Cleared"].includes(status);
  const pastApprove = ["Approved", "Released", "Cleared"].includes(status);
  const released = status === "Released" || status === "Cleared";
  const prepared = need(signatories, "prepared", "Prepared by", pastDraft);
  const checked = need(signatories, "checked", "Checked by", pastCheck);
  const approved = need(signatories, "approved", "Approved by", pastApprove);

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = page.getWidth();

  page.drawRectangle({ x: 0, y: 790, width, height: 52, color: NAVY });
  page.drawText("CORRO CONSTRUCTION DEVELOPMENT AND TRADE CORPORATION", {
    x: 36,
    y: 816,
    size: 9,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText("Cebu  ·  Disbursement Voucher", {
    x: 36,
    y: 800,
    size: 11,
    font,
    color: rgb(0.93, 0.78, 0.45),
  });

  const right = (text, y, size = 11) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: width - 36 - w, y, size, font: bold, color: rgb(1, 1, 1) });
  };
  right(String(voucher.dv_no || "DRAFT"), 812);

  let y = 760;
  const line = (label, value) => {
    page.drawText(label, { x: 36, y, size: 9, font: bold, color: NAVY });
    page.drawText(String(value || "—"), { x: 150, y, size: 10, font, color: INK });
    y -= 18;
  };
  line("Status", status);
  line("Payee", voucher.payee);
  line("Project / site", voucher.project_name);
  line("Account", [voucher.account_code, voucher.account_name].filter(Boolean).join("  "));
  line("Particulars", "");
  const particulars = String(voucher.particulars || "");
  for (const part of wrap(particulars, 78)) {
    page.drawText(part, { x: 150, y, size: 10, font, color: INK });
    y -= 14;
  }
  y -= 8;
  page.drawRectangle({ x: 36, y: y - 78, width: width - 72, height: 86, borderColor: RULE, borderWidth: 1 });
  const money = [
    ["Amount", pdfPeso(voucher.amount)],
    ["VAT", pdfPeso(voucher.vat_amount)],
    ["EWT withheld", pdfPeso(voucher.ewt_amount)],
    ["Net payable", pdfPeso(voucher.net_amount)],
  ];
  money.forEach((pair, index) => {
    const yy = y - 8 - index * 18;
    page.drawText(pair[0], { x: 48, y: yy, size: 10, font, color: INK });
    const w = bold.widthOfTextAtSize(pair[1], 11);
    page.drawText(pair[1], { x: width - 48 - w, y: yy, size: 11, font: bold, color: INK });
  });
  y -= 100;
  if (voucher.release_method) {
    line("Release", voucher.release_method);
    if (voucher.release_method === "Check") {
      line("Bank", voucher.check_bank);
      line("Check no.", voucher.check_no);
      line("Check date", voucher.check_date);
    }
  }

  const slots = [
    { label: "Prepared by", person: voucher.prepared_by || prepared.person_name, image: prepared.image_data },
    { label: "Checked by", person: voucher.checked_by || checked.person_name, image: checked.image_data },
    { label: "Approved by", person: voucher.approved_by || approved.person_name, image: approved.image_data },
    {
      label: "Received by",
      person: voucher.receiver_name || "",
      image: voucher.receiver_signature || "",
      required: released,
    },
  ];
  if (released && !voucher.receiver_signature) {
    fail("bad_request", "Missing e-signature for the receiver (Received by). Release the voucher with a signature before printing.");
  }

  const boxW = 120;
  const gap = 16;
  const startX = 36;
  const baseY = 70;
  for (let i = 0; i < slots.length; i += 1) {
    const x = startX + i * (boxW + gap);
    const slot = slots[i];
    const img = await embed(doc, slot.image);
    if (img) {
      const scale = Math.min(90 / img.width, 36 / img.height, 1);
      page.drawImage(img, { x: x + 8, y: baseY + 28, width: img.width * scale, height: img.height * scale });
    }
    page.drawLine({ start: { x, y: baseY + 22 }, end: { x: x + boxW, y: baseY + 22 }, thickness: 0.6, color: INK });
    page.drawText(slot.person || " ", { x, y: baseY + 8, size: 8, font, color: INK });
    page.drawText(slot.label, { x, y: baseY - 6, size: 8, font: bold, color: NAVY });
  }

  page.drawText("Amounts in Philippine pesos. Times shown in Asia/Manila.", {
    x: 36,
    y: 36,
    size: 8,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  return Buffer.from(await doc.save());
}

function wrap(text, size) {
  const words = String(text || "—").split(/\s+/);
  const lines = [];
  let cur = "";
  words.forEach((word) => {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > size) {
      if (cur) lines.push(cur);
      cur = word;
    } else cur = next;
  });
  if (cur) lines.push(cur);
  return lines.slice(0, 6);
}

module.exports = { renderDvPdf };
